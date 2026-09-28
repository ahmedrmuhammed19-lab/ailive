#!/usr/bin/env python3
"""
NUDGE-1 — signed "Ask client to re-upload" action, end-to-end (local server).

Covers:
  N1  operator login
  N2  upload a WRONG document (insurance T&C pdf) with a client email
  N3  start link -> engine cannot parse -> "manual work needed" page
  N4  work-all magic link page shows the blue "Ask client to re-upload" link
  N5  tapping the nudge link -> ok page "Re-upload request emailed to the client"
  N6  outbox gains a client_nudge mail (right recipient/subject/file name)
  N7  outbox gains the operator copy ("Re-upload request sent")
  N8  nudge is reminder-semantic: a second tap sends another client_nudge
  N9  case with no client email -> warn page "No client email on file", no mail
  N10 forged nudge token -> 403
  N11 nudge never touches status (stays ANALYZING)
"""
import glob
import hmac as hmaclib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
from http.cookiejar import CookieJar

BASE = "http://localhost:3000"
SECRET = "e2e-local-secret-0123456789abcdef0123456789abcdef"
WRONG_PDF = "/home/z/my-project/download/Online_Insurance_Conditions.pdf"
OUTBOX = "/home/z/my-project/upload/portal/_outbox"
DB = "/home/z/my-project/db/custom.db"
CLIENT_EMAIL = "client.nudge@example.com"
QUEUE_ID = "NUDGE-01"

results = []
SESSION_COOKIE = {"v": ""}


def _cookie_header():
    return {"Cookie": SESSION_COOKIE["v"]} if SESSION_COOKIE["v"] else {}


def ck(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))


def action_tok(sid, action):
    return hmaclib.new(SECRET.encode(), f"{sid}:{action}".encode(), "sha256").hexdigest()[:32]


def strip_base(url):
    """Minted links carry PORTAL_BASE_URL — request them locally instead."""
    return re.sub(r"^https?://[^/]+", "", url)


def new_op():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def post_json(op, path, payload, timeout=60):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **_cookie_header()},
        method="POST",
    )
    try:
        resp = op.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        resp = e
    sc = resp.headers.get("set-cookie")
    if sc:
        SESSION_COOKIE["v"] = sc.split(";")[0]
    return resp


def get(op, url, timeout=120):
    try:
        req = urllib.request.Request(url if url.startswith("http") else BASE + url, headers=_cookie_header())
        return op.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return e


def multipart(files, fields):
    boundary = "----nudge" + uuid.uuid4().hex
    body = b""
    for k, v in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for fname, fpath in files:
        with open(fpath, "rb") as fh:
            data = fh.read()
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; "
            f"filename=\"{fname}\"\r\nContent-Type: application/pdf\r\n\r\n"
        ).encode() + data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, boundary


def outbox_mails(kind=None):
    mails = []
    for f in sorted(glob.glob(os.path.join(OUTBOX, "*.json"))):
        try:
            m = json.load(open(f))
        except Exception:
            continue
        if kind is None or m.get("kind") == kind:
            mails.append(m)
    return mails


def db_row(submission_id):
    con = sqlite3.connect(DB)
    try:
        return con.execute(
            "SELECT id, status, email FROM Submission WHERE id=?", (submission_id,)
        ).fetchone()
    finally:
        con.close()


def main():
    op = new_op()

    # N1 login
    r = post_json(op, "/api/login", {"username": "op.eis", "password": "Op-Test-2026!"})
    ck("N1 operator login", r.status == 200, f"status={getattr(r,'status',r)}")

    # N2 upload the wrong document (insurance T&C) with client email
    body, boundary = multipart(
        [("Online_Insurance_Conditions.pdf", WRONG_PDF)],
        {"userId": QUEUE_ID, "email": CLIENT_EMAIL},
    )
    req = urllib.request.Request(
        BASE + "/api/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", **_cookie_header()},
        method="POST",
    )
    r = op.open(req, timeout=120)
    up = json.load(r)
    ck("N2 upload wrong-document case", up.get("ok") is True, json.dumps(up)[:200])
    sid = (up.get("submissionId") or up.get("id") or "").strip()
    if not sid:
        con = sqlite3.connect(DB)
        sid = con.execute(
            "SELECT id FROM Submission WHERE userId=? ORDER BY createdAt DESC LIMIT 1", (QUEUE_ID,)
        ).fetchone()[0]
        con.close()
    print(f"   submission id: {sid}")

    # N3 start -> engine cannot parse -> manual work needed
    r = get(op, f"/api/queue/action?id={sid}&action=start&token={action_tok(sid, 'start')}")
    html = r.read().decode()
    ck("N3 start -> manual work needed page", "manual work needed" in html, html[:300])

    # N4 work-all page shows the nudge link
    r = get(op, f"/api/queue/work-all?token={action_tok('__queue__', 'workall')}")
    page_html = r.read().decode()
    ck("N4 work-all page has Ask-client link", "Ask client to re-upload" in page_html)
    # anchor on THIS case's id — other red cases in the queue also mint nudge links
    m = re.search(rf'href="([^"]+id={sid}[^"]+action=nudge[^"]*)"', page_html) or re.search(
        rf'href="([^"]+action=nudge[^"]*id={sid}[^"]*)"', page_html)
    ck("N4b nudge href minted with token", bool(m) and "token=" in (m.group(1) if m else ""))
    nudge_url = strip_base(m.group(1)) if m else ""

    # N5 tap the nudge link
    r = get(op, nudge_url)
    nudge_html = r.read().decode()
    ck("N5 nudge -> ok page", "Re-upload request emailed to the client" in nudge_html, nudge_html[:300])

    # N6 client_nudge mail in outbox (lock-parity aware: with TEST_MAIL_TO
    # active every mail's `to` is the lock target — the original recipient
    # is preserved in the `intendedTo` audit field, so accept either)
    time.sleep(1)
    nudges = outbox_mails("client_nudge")
    ok_mail = next(
        (m for m in nudges if m.get("to") == CLIENT_EMAIL or m.get("intendedTo") == CLIENT_EMAIL),
        None,
    )
    ck("N6 client_nudge mail in outbox", ok_mail is not None, f"count={len(nudges)}")
    if ok_mail:
        ck("N6b subject mentions bank statement", "bank statement needed" in ok_mail.get("subject", ""))
        ck("N6c body cites the wrong file", "Online_Insurance_Conditions.pdf" in ok_mail.get("body", ""))
        ck("N6d rich HTML twin present", ok_mail.get("hasHtml") is True)

    # N7 operator copy
    ops = [m for m in outbox_mails("operator_alert") if "Re-upload request sent" in m.get("subject", "")]
    ck("N7 operator copy sent", len(ops) >= 1)

    # N8 reminder semantics: second tap -> second mail
    get(op, nudge_url)
    time.sleep(1)
    ck("N8 second nudge sends another mail", len(outbox_mails("client_nudge")) >= 2)

    # N9 no client email -> warn, no new mail
    con = sqlite3.connect(DB)
    con.execute("UPDATE Submission SET email=NULL WHERE id=?", (sid,))
    con.commit()
    con.close()
    before = len(outbox_mails("client_nudge"))
    r = get(op, nudge_url)
    ck("N9 no-email nudge -> warn page", "No client email on file" in r.read().decode())
    ck("N9b nothing sent without email", len(outbox_mails("client_nudge")) == before)

    # N10 forged token
    r = get(op, nudge_url.replace("token=" + nudge_url.split("token=")[1], "token=" + "0" * 32))
    ck("N10 forged nudge token -> 403", getattr(r, "status", 200) == 403)

    # N11 status untouched
    row = db_row(sid)
    ck("N11 status still ANALYZING (nudge never re-stamps)", row and row[1] == "ANALYZING", str(row))

    # summary
    fails = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(fails)}/{len(results)} checks passed" + (f" — FAILURES: {fails}" if fails else ""))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
