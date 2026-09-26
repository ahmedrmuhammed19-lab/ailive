#!/usr/bin/env python3
"""Global EIS - statement email fetcher (email-in, temporary/backup channel).

Fetches bank-statement attachments from the dedicated Gmail mailbox via IMAP,
saves them to upload/email/, prints the arrival handshake (filename/size/MD5),
and appends an index line to upload/email/_index.jsonl.

Credential file (gitignored): config/mail_credentials.json
  {
    "email": "globaleis.reports@gmail.com",
    "app_password": "abcdefghijklmnop"
  }

Usage:
  python3 scripts/statement_fetcher.py                 # fetch unseen messages
  python3 scripts/statement_fetcher.py --since 3d      # look back 3 days
  python3 scripts/statement_fetcher.py --mark-seen     # mark fetched as seen
  python3 scripts/statement_fetcher.py --dry-run       # list, do not save

Notes:
- Clients must attach statements as DOCUMENTS (never inline photos).
- If login fails: check the app password, and enable IMAP in Gmail settings
  (Settings -> Forwarding and POP/IMAP -> Enable IMAP).
"""

from __future__ import annotations

import argparse
import email
import email.header
import hashlib
import imaplib
import json
import re
import sys
from datetime import datetime, timedelta
from email.utils import parseaddr
from pathlib import Path

WORKSPACE = Path("/home/z/my-project")
UPLOAD_DIR = WORKSPACE / "upload" / "email"
CRED_FILE = WORKSPACE / "config" / "mail_credentials.json"
INDEX_FILE = UPLOAD_DIR / "_index.jsonl"
ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg"}
IMAP_HOST, IMAP_PORT = "imap.gmail.com", 993


def load_creds() -> tuple[str, str]:
    if not CRED_FILE.exists():
        sys.exit(
            f"NO CREDS: {CRED_FILE} not found.\n"
            'Create it: {"email": "<dedicated gmail>", "app_password": "<16-char>"} '
            "(chmod 600). The moment this file exists, email-in is armed."
        )
    data = json.loads(CRED_FILE.read_text(encoding="utf-8"))
    addr, pwd = data.get("email", "").strip(), data.get("app_password", "").replace(" ", "")
    if not addr or not pwd:
        sys.exit("NO CREDS: email/app_password missing in " + str(CRED_FILE))
    return addr, pwd


def decode_hdr(v: str | None) -> str:
    if not v:
        return ""
    parts = email.header.decode_header(v)
    out = ""
    for chunk, enc in parts:
        out += chunk.decode(enc or "utf-8", "replace") if isinstance(chunk, bytes) else chunk
    return out


def slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_")[:40] or "sender"


def save_name(name: str) -> str:
    p = Path(name)
    ext = p.suffix.lower()
    base = re.sub(r"[^a-zA-Z0-9._-]+", "_", p.stem).strip("_")[:80] or "attachment"
    return f"{base}{ext if ext in ALLOWED_EXT else '.pdf'}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=None, help="look back N days, e.g. 7d")
    ap.add_argument("--mark-seen", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    addr, pwd = load_creds()
    since_date = None
    if args.since:
        m = re.fullmatch(r"(\d+)d", args.since.strip())
        days = int(m.group(1)) if m else 7
        since_date = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")

    print(f"Connecting {IMAP_HOST}:{IMAP_PORT} as {addr} ...")
    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(addr, pwd)
    except imaplib.IMAP4.error as e:
        sys.exit(f"AUTH FAILED: {e}\nCheck the app password (16 chars, 2FA enabled) and IMAP setting.")
    mail.select("INBOX", readonly=not args.mark_seen)

    query = f'(SINCE {since_date})' if since_date else "(UNSEEN)"
    status, data = mail.search(None, query)
    if status != "OK":
        sys.exit("SEARCH FAILED")
    ids = data[0].split()
    print(f"{len(ids)} message(s) matched [{query}]")

    saved, handshake = 0, []
    for num in ids:
        status, msg_data = mail.fetch(num, "(RFC822)")
        if status != "OK":
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        sender = parseaddr(decode_hdr(msg.get("From")))[1] or "unknown"
        subject = decode_hdr(msg.get("Subject")) or "(no subject)"
        date_hdr = decode_hdr(msg.get("Date"))

        for part in msg.walk():
            fname = part.get_filename()
            if not fname:
                continue
            fname = decode_hdr(fname)
            ext = Path(fname).suffix.lower()
            if ext not in ALLOWED_EXT:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue

            digest = hashlib.md5(payload).hexdigest()
            if args.dry_run:
                handshake.append((fname, len(payload), digest, sender))
                continue

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            out_dir = UPLOAD_DIR / f"{ts}_{slug(sender)}"
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / save_name(fname)
            out_path.write_bytes(payload)

            record = {
                "ts": datetime.now().isoformat(timespec="seconds"),
                "sender": sender,
                "subject": subject,
                "date_header": date_hdr,
                "file": str(out_path.relative_to(WORKSPACE)),
                "original_name": fname,
                "size_bytes": len(payload),
                "md5": digest,
            }
            with INDEX_FILE.open("a", encoding="utf-8") as idx:
                idx.write(json.dumps(record, ensure_ascii=False) + "\n")
            handshake.append((out_path.name, len(payload), digest, sender))
            saved += 1

    try:
        if args.mark_seen and not args.dry_run and ids:
            mail.store(b",".join(ids), "+FLAGS", "\\Seen")
        mail.logout()
    except Exception:
        pass

    if not handshake:
        print("No statement attachments found in matched mail.")
        return
    print("\n=== ARRIVAL HANDSHAKE ===")
    for name, size, digest, sender in handshake:
        print(f"VERIFIED  {name}  {size:,} B  MD5 {digest}  from {sender}")
    print(f"\n{saved} file(s) saved under {UPLOAD_DIR} · index: {INDEX_FILE}")


if __name__ == "__main__":
    main()
