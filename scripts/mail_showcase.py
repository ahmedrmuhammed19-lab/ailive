#!/usr/bin/env python3
"""
MAIL-SHOWCASE — full end-to-end flow against the live portal (localhost:3000),
firing the COMPLETE real-mail sequence through Gmail SMTP.

Uses signed /api/queue/action links (start / nudge) instead of work-all, so
only the two showcase cases run — no stale queue cases, no extra mails.
TEST_MAIL_TO lock redirects every mail to the operator inbox (audit banner):
nothing is ever delivered to the example.com dummy client addresses.

Mail sequence produced (7):
  GREEN case  1. operator_alert  "New bank statement uploaded"
              2. report_ready    "analysis report ready"     (client)
              3. operator_alert  "Analysis finished"
  RED case    4. operator_alert  "New bank statement uploaded"
              5. operator_alert  "Auto-analysis needs manual work"
              6. client_nudge    "action required: bank statement needed" (client)
              7. operator_alert  "Re-upload request sent"
"""
import hashlib
import hmac as H
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
GREEN_PDF = "/home/z/my-project/tests/e2e_fixtures/statement_green_B.pdf"
RED_PDF = "/home/z/my-project/tests/e2e_fixtures/insurance_red.pdf"
OP = ("op.eis", "Op-Test-2026!")
GREEN_MAIL = "eis.mailshow.green@example.com"
RED_MAIL = "eis.mailshow.red@example.com"

SESSION_SECRET = None
for _l in open("/home/z/my-project/.env"):
    if _l.startswith("SESSION_SECRET="):
        SESSION_SECRET = _l.split("=", 1)[1].strip()


def http(method, path, body=None, raw=None, cookie=None):
    req = urllib.request.Request(BASE + path, method=method)
    if cookie:
        req.add_header("Cookie", cookie)
    data = None
    if raw:
        data, hdr = raw
        req.add_header("Content-Type", hdr)
    elif body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=90) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def multipart(fields, files):
    b = uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for name, content, ctype in files:
        out += (
            f'--{b}\r\nContent-Disposition: form-data; name="files"; '
            f'filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'
        ).encode()
        out += content + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return out, f"multipart/form-data; boundary={b}"


def ck(label, ok, detail=""):
    print(("PASS" if ok else "FAIL"), f"{label}", detail if not ok else detail)
    if not ok and label.startswith(("login", "upload")):
        sys.exit(1)


def login(user, pw):
    st, body, hdrs = http("POST", "/api/login", body={"username": user, "password": pw})
    setc = hdrs.get("Set-Cookie") or ""
    ckie = setc.split(";")[0] if setc else ""
    ck(f"login {user}", st == 200 and ckie, f"st={st} {body.decode()[:120]}")
    return ckie


def sql(q):
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return (row[0] if row else "") if isinstance(row, tuple) else str(row)
    finally:
        con.close()


def wait(pred, timeout, every=2):
    dl = time.time() + timeout
    while time.time() < dl:
        v = pred()
        if v:
            return v
        time.sleep(every)
    return pred()


def hmac_token(sid, action):
    return H.new(SESSION_SECRET.encode(), f"{sid}:{action}".encode(), hashlib.sha256).hexdigest()[:32]


def upload(cookie, label, email, fname, path, green):
    mb, mh = multipart(
        {
            "userId": label,
            "email": email,
            "country": "Canada" if green else "",
            "visaType": "Work Permit" if green else "",
            "travelers": "1",
        },
        [(fname, open(path, "rb").read(), "application/pdf")],
    )
    st, body, _ = http("POST", "/api/upload", raw=(mb, mh), cookie=cookie)
    j = json.loads(body or b"{}")
    sid = j.get("submissionId") or j.get("id") or ""
    ck(f"upload {label}", st == 200 and bool(sid), f"st={st} {str(j)[:140]}")
    return sid


def start(cookie, sid, label):
    tok = hmac_token(sid, "start")
    st, body, _ = http("GET", f"/api/queue/action?id={sid}&action=start&token={tok}", cookie=cookie)
    ck(f"engine start {label}", st == 200, f"st={st}")


print("=== MAIL SHOWCASE — full real-mail sequence via Gmail SMTP ===")
op = login(*OP)

print("\n--- GREEN PATH (auto DONE 100%) ---")
g = upload(op, "MAILSHOW-GREEN", GREEN_MAIL, "statement_green_B.pdf", GREEN_PDF, True)
start(op, g, "GREEN")
g_status = wait(lambda: sql(f"SELECT status FROM Submission WHERE id='{g}';"), 120)
ck("green case DONE", g_status == "DONE", g_status)
pl = sql(
    f"SELECT outcome || ' ' || integrityMin || '/' || integrityAvg FROM ParseLog "
    f"WHERE submissionId='{g}' ORDER BY createdAt DESC LIMIT 1;"
)
ck("green ParseLog auto-delivered", "auto-delivered" in pl, pl[:80])

print("\n--- RED PATH (not a statement -> needs-manual -> nudge) ---")
r = upload(op, "MAILSHOW-RED", RED_MAIL, "insurance_red.pdf", RED_PDF, False)
start(op, r, "RED")
r_status = wait(lambda: sql(f"SELECT status FROM Submission WHERE id='{r}';"), 120)
ck("red case NOT DONE", r_status != "DONE", r_status)
rpl = wait(
    lambda: (
        lambda v: v if "unrecognized" in v else ""
    )(
        sql(
            f"SELECT outcome FROM ParseLog WHERE submissionId='{r}' "
            f"ORDER BY createdAt DESC LIMIT 1;"
        )
    ),
    90,
)
ck("red ParseLog unrecognized", bool(rpl), rpl[:80])

tok = hmac_token(r, "nudge")
st, body, _ = http("GET", f"/api/queue/action?id={r}&action=nudge&token={tok}")
ck("signed nudge link 200", st == 200, f"st={st}")

print("\n=== SHOWCASE COMPLETE — mail trail follows ===")
