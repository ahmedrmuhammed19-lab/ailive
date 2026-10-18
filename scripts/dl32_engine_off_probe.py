#!/usr/bin/env python3
"""DL-32 probe — prove the engine is OFF by default after the code flip.

Runs against a local dev server started WITHOUT AUTO_WORK=1:
  1. login as op.eis
  2. upload the digital green PDF (the case that used to auto-DONE)
  3. assert response carries autoWork=false
  4. wait 8s -> DB status must STILL be WAITING with no ParseLog row
     (previously the engine had auto-fired within ~2s)
  5. cleanup: clear the queue (operator + confirm)
Exit 0 iff every check passes.
"""
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
FX = "/home/z/my-project/tests/e2e_fixtures"
OP = ("op.eis", "Op-Test-2026!")

fails = []


def http(method, path, body=None, raw=None, cookie=None, timeout=120):
    req = urllib.request.Request(BASE + path, method=method)
    if cookie:
        req.add_header("Cookie", cookie)
    data = None
    if raw:
        d, hdr = raw
        req.add_header("Content-Type", hdr)
        data = d
    elif body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
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


def sql(q):
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return (row[0] if row else "") if isinstance(row, tuple) else str(row)
    finally:
        con.close()


def main() -> None:
    st, body, hdrs = http("POST", "/api/login", body={"username": OP[0], "password": OP[1]})
    cookie = (hdrs.get("Set-Cookie") or "").split(";")[0]
    if st != 200 or not cookie:
        print("FAIL login op.eis", st, body[:120])
        sys.exit(1)
    print("PASS login op.eis")

    mb, mh = multipart(
        {"userId": "DL32-ENGINE-OFF", "email": "eis.autowork@example.com",
         "country": "Canada", "visaType": "Work Permit", "travelers": "1"},
        [("statement_green_B.pdf", open(f"{FX}/statement_green_B.pdf", "rb").read(),
          "application/pdf")],
    )
    st, body, _ = http("POST", "/api/upload", raw=(mb, mh), cookie=cookie)
    j = json.loads(body or b"{}")
    sid = j.get("submissionId") or ""
    aw = j.get("autoWork")
    ok = bool(sid) and aw is False and (j.get("status") == "WAITING")
    print(("PASS" if ok else "FAIL"),
          f"upload response autoWork=false status=WAITING (autoWork={aw}, sid={sid[:10]})")
    if not ok:
        fails.append("upload flag")

    time.sleep(8)  # the old auto-run fired within ~2s; give it 4x that
    status = sql(f"SELECT status FROM Submission WHERE id='{sid}';")
    parselog = sql(
        f"SELECT COUNT(*) FROM ParseLog WHERE submissionId='{sid}';")
    ok2 = status == "WAITING" and int(parselog or 0) == 0
    print(("PASS" if ok2 else "FAIL"),
          f"engine did NOT fire after 8s (status={status}, parseLogs={parselog})")
    if not ok2:
        fails.append("auto-fired")

    st, body, _ = http("POST", "/api/queue/clear", body={"confirm": True}, cookie=cookie)
    left = sql("SELECT COUNT(*) FROM Submission;")
    ok3 = st in (200, 201) and int(left or 0) == 0
    print(("PASS" if ok3 else "FAIL"), f"queue cleanup (HTTP {st}, submissions left={left})")
    if not ok3:
        fails.append("cleanup")

    if fails:
        print("RESULT: FAIL", fails)
        sys.exit(1)
    print("RESULT: ENGINE-OFF PROVEN — default is manual Start Analysis only")


if __name__ == "__main__":
    main()
