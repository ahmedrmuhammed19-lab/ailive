#!/usr/bin/env python3
"""
Global EIS — flush the email outbox.

Queued emails are written by the portal upload route to
upload/portal/_outbox/*.json (status QUEUED) whenever SMTP credentials
are missing or a send fails. Once config/mail_credentials.json exists,
run this to deliver everything pending:

    python3 scripts/flush_outbox.py            # send all QUEUED, mark SENT
    python3 scripts/flush_outbox.py --dry-run  # list what would be sent
"""

import json
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

PROJECT = Path("/home/z/my-project")
CREDS = PROJECT / "config" / "mail_credentials.json"
OUTBOX = PROJECT / "upload" / "portal" / "_outbox"


def smtp_target(d):
    """(host, port, secure) — defaults to Gmail for backward compatibility."""
    host = (d.get("host") or "smtp.gmail.com").strip()
    port = int(d.get("port") or (465 if host == "smtp.gmail.com" else 587))
    secure = bool(d.get("secure", port == 465))
    return host, port, secure


def smtp_connect(host, port, secure):
    if secure:
        return smtplib.SMTP_SSL(host, port, timeout=30)
    s = smtplib.SMTP(host, port, timeout=30)
    s.starttls()
    return s


def load_creds():
    if not CREDS.exists():
        return None
    try:
        d = json.loads(CREDS.read_text())
        if not (d.get("email") and d.get("app_password")):
            return None
        host, port, secure = smtp_target(d)
        return {"email": d["email"], "pw": d["app_password"], "host": host, "port": port, "secure": secure}
    except Exception:
        return None


def main():
    dry = "--dry-run" in sys.argv
    creds = load_creds()
    if not creds:
        print("No SMTP credentials (config/mail_credentials.json missing/incomplete).")
        print("Copy config/mail_credentials.json.example, pick Brevo or SendGrid, fill it in, then re-run.")
        return 1

    if not OUTBOX.exists():
        print("Outbox empty — nothing queued.")
        return 0

    pending = sorted(OUTBOX.glob("*.json"))
    queue = []
    for f in pending:
        try:
            mail = json.loads(f.read_text())
        except Exception:
            continue
        if mail.get("status") == "QUEUED" and mail.get("to") and "@" in mail["to"] \
                and not mail["to"].endswith(".pending"):
            queue.append((f, mail))

    if not queue:
        print("Outbox empty — no deliverable QUEUED emails.")
        return 0

    print(f"{len(queue)} email(s) pending:")
    for f, m in queue:
        print(f"  [{m.get('kind')}] -> {m['to']} :: {m.get('subject')}")

    if dry:
        print("\nDry run — nothing sent.")
        return 0

    sent = 0
    try:
        s = smtp_connect(creds["host"], creds["port"], creds["secure"])
    except Exception as e:
        print(f"CONNECT FAILED ({creds['host']}:{creds['port']}): {e}")
        print("Check host/port/secure in config/mail_credentials.json and your network.")
        return 1
    with s:
        try:
            s.login(creds["email"], creds["pw"])
        except Exception as e:
            print(f"LOGIN FAILED as {creds['email']}: {e}")
            print("Check 'email' and 'app_password' (SMTP key) in config/mail_credentials.json.")
            return 1
        for f, m in queue:
            msg = EmailMessage()
            msg["From"] = f"Global EIS <{creds['email']}>"
            msg["To"] = m["to"]
            msg["Subject"] = m["subject"]
            msg.set_content(m.get("body") or "")
            try:
                s.send_message(msg)
                m["status"] = "SENT"
                m["sentAt"] = __import__("datetime").datetime.now(__import__("datetime").UTC).isoformat()
                f.write_text(json.dumps(m, indent=2))
                sent += 1
                print(f"  SENT -> {m['to']}")
            except Exception as e:
                print(f"  FAIL -> {m['to']}: {e}")
    with (OUTBOX / "NOTIFICATIONS.log").open("a") as lg:
        lg.write(f"[flush_outbox] delivered {sent}/{len(queue)} queued emails\n")
    print(f"\nDelivered {sent}/{len(queue)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
