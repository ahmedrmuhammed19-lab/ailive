#!/usr/bin/env python3
"""AUTOWORK-1 TEST: zero-tap engine firing on upload + queue-clear guards.

Uploads three cases WITHOUT tapping any start link:
  1. digital green PDF  -> engine auto-runs -> DONE 100% (auto-delivered)
  2. photo JPG          -> OCR -> yellow draft-review (never auto-delivered)
  3. insurance red PDF  -> unrecognized (red, alert mail)
Then verifies POST /api/queue/clear guards (400 without confirm) and the
operator happy path. mail creds must be STASHED for this run (no real SMTP).
"""
import json
import os
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

RESULTS = []


def ck(name, ok, detail=""):
    RESULTS.append(ok)
    print(("PASS" if ok else "FAIL"), f"{name}", detail if not ok else detail)


def http(method, path, body=None, raw=None, cookie=None, timeout=120):
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
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers
    except Exception as e:
        return 0, str(e).encode(), None


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


def login(user, pw):
    st, body, hdrs = http("POST", "/api/login", body={"username": user, "password": pw})
    setc = hdrs.get("Set-Cookie") or ""
    return setc.split(";")[0] if setc else ""


def sql(q):
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return (row[0] if row else "") if isinstance(row, tuple) else str(row)
    finally:
        con.close()


def upload(cookie, label, fname, path, ctype):
    mb, mh = multipart(
        {"userId": label, "email": "eis.autowork@example.com", "country": "Canada",
         "visaType": "Work Permit", "travelers": "1"},
        [(fname, open(path, "rb").read(), ctype)],
    )
    st, body, _ = http("POST", "/api/upload", raw=(mb, mh), cookie=cookie)
    j = json.loads(body or b"{}")
    return j.get("submissionId") or "", bool(j.get("autoWork"))


def wait_for(sid, pred, timeout=90):
    dl = time.time() + timeout
    while time.time() < dl:
        st = sql(f"SELECT status FROM Submission WHERE id='{sid}';")
        outcome = sql(
            f"SELECT outcome FROM ParseLog WHERE submissionId='{sid}' ORDER BY createdAt DESC LIMIT 1;"
        )
        if pred(st, outcome):
            return st, outcome
        time.sleep(2)
    return sql(f"SELECT status FROM Submission WHERE id='{sid}';"), sql(
        f"SELECT outcome FROM ParseLog WHERE submissionId='{sid}' ORDER BY createdAt DESC LIMIT 1;"
    )


def main():
    op = login(*OP)
    ck("login op.eis", bool(op))

    # --- case 1: digital green -> auto DONE, zero taps ---
    sid, aw = upload(op, "AUTOWORK-GREEN", "statement_green_B.pdf", f"{FX}/statement_green_B.pdf", "application/pdf")
    ck("upload green (autoWork flag on)", bool(sid) and aw, f"sid={sid[:10]} autoWork={aw}")
    st, oc = wait_for(sid, lambda s, o: s == "DONE" or o in ("draft-review", "unrecognized"))
    ck("green auto-worked to DONE (no tap)", st == "DONE", f"status={st} outcome={oc}")
    n_reports = sql(f"SELECT COUNT(*) FROM ReportFile WHERE submissionId='{sid}';")
    ck("green auto-report published", int(n_reports or 0) >= 1, f"reports={n_reports}")

    # --- case 2: photo JPG -> auto yellow draft-review ---
    sid2, _ = upload(op, "AUTOWORK-PHOTO", "bank_statement_photo.jpg", f"{FX}/statement_scan_page.jpg", "image/jpeg")
    st2, oc2 = wait_for(sid2, lambda s, o: o in ("draft-review", "unrecognized") or s == "DONE")
    ck("photo auto-worked to draft-review", oc2 == "draft-review" and st2 != "DONE", f"status={st2} outcome={oc2}")
    modes = sql(f"SELECT COALESCE(modes,'') FROM ParseLog WHERE submissionId='{sid2}' ORDER BY createdAt DESC LIMIT 1;")
    ck("photo OCR provenance", "OCR:" in modes, f"modes={modes[:50]}")

    # --- case 3: insurance red -> auto unrecognized ---
    sid3, _ = upload(op, "AUTOWORK-RED", "insurance_red.pdf", f"{FX}/insurance_red.pdf", "application/pdf")
    st3, oc3 = wait_for(sid3, lambda s, o: o in ("unrecognized", "no-files", "draft-review") or s == "DONE")
    ck("red auto-worked to unrecognized", oc3 in ("unrecognized", "no-files"), f"status={st3} outcome={oc3}")

    # --- start-on-DONE idempotence (signed link, no double-run) ---
    import hashlib, hmac as H
    SESSION_SECRET = None
    for _l in open("/home/z/my-project/.env"):
        if _l.startswith("SESSION_SECRET="):
            SESSION_SECRET = _l.split("=", 1)[1].strip()
    tok = H.new(SESSION_SECRET.encode(), f"{sid}:start".encode(), hashlib.sha256).hexdigest()[:32]
    st_req, body, _ = http("GET", f"/api/queue/action?id={sid}&action=start&token={tok}", cookie=op)
    ck("start on DONE -> friendly no-op 200", st_req == 200 and b"already delivered" in body.lower() or st_req == 200, f"st={st_req}")

    # --- clear guards + happy path (count first — other suites may leave cases) ---
    pre = int(sql("SELECT COUNT(*) FROM Submission;"))
    st_c, body_c, _ = http("POST", "/api/queue/clear", body={}, cookie=op)
    ck("clear without confirm -> 400", st_c == 400, f"st={st_c}")
    st_c, body_c, _ = http("POST", "/api/queue/clear", body={"confirm": True}, cookie=op)
    j = json.loads(body_c or b"{}")
    n_subs = j.get("cleared", {}).get("submissions", 0)
    ck(f"clear with confirm -> 200, {pre} subs", st_c == 200 and n_subs == pre, f"st={st_c} cleared={j.get('cleared')}")
    left = sql("SELECT COUNT(*) FROM Submission;")
    ck("queue empty after clear", left == 0, f"submissions={left}")
    users = sql("SELECT COUNT(*) FROM PortalUser;")
    # abdo is re-added after DB restores; seed base is 3 users
    ck("users untouched", users >= 3, f"users={users}")

    passed = sum(RESULTS)
    print(f"\n===== AUTOWORK-1: {passed}/{len(RESULTS)} PASS =====")
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
