#!/usr/bin/env python3
"""WAFA-1: upload the real 48-page scanned Wafa Bank statement (Arabic,
CamScanner producer, no text layer) as abdo and watch the zero-tap engine
classify it end-to-end. Prints color verdict, ParseLog telemetry, published
reports and outbox mails."""
import json
import sqlite3
import sys
import time
import urllib.request
import uuid

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
PDF = "/home/z/my-project/upload/كشف حساب شخصي لمدة 6 شهور من بنك وفا التجاري.pdf"
FNAME = "wafa_6months_scanned.pdf"  # ASCII alias for the multipart header; original Arabic name noted here


def sql(q):
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return (row[0] if row else "") if isinstance(row, tuple) else str(row)
    finally:
        con.close()


def http(method, path, body=None, raw=None, cookie=None, timeout=180):
    req = urllib.request.Request(BASE + path, method=method)
    if cookie:
        req.add_header("Cookie", cookie)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    if raw:
        data, hdr = raw
        req.add_header("Content-Type", hdr)
    try:
        r = urllib.request.urlopen(req, data, timeout=timeout)
        return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def login(user, pw):
    st, body, hdrs = http("POST", "/api/login", body={"username": user, "password": pw})
    setc = hdrs.get("Set-Cookie") or ""
    return setc.split(";")[0] if setc else ""


def main():
    st, body, _ = http("GET", "/", cookie=None)
    print(f"server probe: {st}")

    cookie = login("abdo", "boda2026")
    print("login abdo:", "OK" if cookie else "FAIL")
    if not cookie:
        sys.exit(1)

    b = uuid.uuid4().hex
    fields = {
        "userId": "WAFA-6M-ABDO",
        "email": "abdo.client@example.com",
        "country": "Canada",
        "visaType": "Work Permit",
        "travelers": "1",
    }
    parts = b""
    for k, v in fields.items():
        parts += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    content = open(PDF, "rb").read()
    parts += (
        f'--{b}\r\nContent-Disposition: form-data; name="files"; '
        f'filename="{FNAME}"\r\nContent-Type: application/pdf\r\n\r\n'
    ).encode() + content + b"\r\n"
    parts += f"--{b}--\r\n".encode()

    st, body, _ = http("POST", "/api/upload", raw=(parts, f"multipart/form-data; boundary={b}"), cookie=cookie, timeout=300)
    j = json.loads(body or b"{}")
    sid = j.get("submissionId") or ""
    print(f"upload: HTTP {st} submissionId={sid} autoWork={j.get('autoWork')}")
    if not sid:
        print("upload failed:", body[:400])
        sys.exit(1)

    print("--- watching zero-tap engine (poll 5s, max 8min) ---")
    dl = time.time() + 480
    last = ""
    outcome = ""
    while time.time() < dl:
        s = sql(f"SELECT status FROM Submission WHERE id='{sid}';")
        outcome = sql(f"SELECT outcome FROM ParseLog WHERE submissionId='{sid}' ORDER BY createdAt DESC LIMIT 1;")
        line = f"status={s} outcome={outcome}"
        if line != last:
            t = time.strftime("%H:%M:%S")
            print(f"[{t}] {line}")
            last = line
        if outcome in ("draft-review", "unrecognized", "no-files") or s == "DONE":
            break
        time.sleep(5)

    s = sql(f"SELECT status FROM Submission WHERE id='{sid}';")
    print("\n===== RESULT =====")
    print("final status :", s)
    print("outcome      :", outcome)
    print("parse modes  :", sql(f"SELECT COALESCE(modes,'') FROM ParseLog WHERE submissionId='{sid}' ORDER BY createdAt DESC LIMIT 1;"))
    print("integrity    :", sql(f"SELECT COALESCE(integrityMin,'') FROM ParseLog WHERE submissionId='{sid}' ORDER BY createdAt DESC LIMIT 1;"))
    print("reports      :", sql(f"SELECT COUNT(*) FROM ReportFile WHERE submissionId='{sid}';"))
    print("files        :", sql(f"SELECT COUNT(*) || ' file(s): ' || COALESCE(GROUP_CONCAT(originalName), '') FROM StatementFile WHERE submissionId='{sid}';"))
    print("--- outbox mails ---")
    con = sqlite3.connect(DB)
    for row in con.execute(
        "SELECT kind, intendedTo, subject FROM Outbox WHERE submissionId=? ORDER BY createdAt DESC LIMIT 5;", (sid,)
    ):
        print(" ", row)
    con.close()


if __name__ == "__main__":
    main()
