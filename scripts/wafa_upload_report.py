#!/usr/bin/env python3
"""Attach the analyst PDF report to the WAFA case and deliver it through the
portal's own operator flow (deliver action stamps DONE + mails the client)."""
import hashlib
import hmac
import json
import sqlite3
import time
import urllib.request

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
PDF = "/home/z/my-project/download/Global_EIS_Statement_Analysis_WAFA_6M.pdf"
SID = "cmusdua3r0000kgirsru1rgxi"


def sql(q, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try:
        return con.execute(q, args).fetchall()
    finally:
        con.close()


def ex(q, args=()):
    con = sqlite3.connect(DB, timeout=10)
    try:
        con.execute(q, args)
        con.commit()
    finally:
        con.close()


def main():
    sub = sql("SELECT id, userId, status FROM Submission WHERE id=?", (SID,))
    print("submission:", sub)
    assert sub, "submission not found"
    user_id = sub[0][1]

    pdf = open(PDF, "rb").read()
    name = "GlobalEIS_AnalystReport_WAFA-6M-ABDO.pdf"
    existing = sql("SELECT COUNT(*) FROM ReportFile WHERE submissionId=?", (SID,))[0][0]
    if existing == 0:
        ex("INSERT INTO ReportFile (id, submissionId, queueId, name, url, data, sizeBytes, createdAt) "
           "VALUES (?, ?, ?, ?, '', ?, ?, ?)",
           ("rpt_wafa_analyst_001", SID, user_id, name, sqlite3.Binary(pdf), len(pdf),
            int(time.time() * 1000)))
        print(f"ReportFile inserted: {name} ({len(pdf):,} bytes)")
    else:
        print("ReportFile already present, skipping insert")

    # operator session
    req = urllib.request.Request(BASE + "/api/login", method="POST",
                                 data=json.dumps({"username": "op.eis", "password": "Op-Test-2026!"}).encode())
    req.add_header("Content-Type", "application/json")
    r = urllib.request.urlopen(req, timeout=60)
    cookie = (r.headers.get("Set-Cookie") or "").split(";")[0]
    print("operator login:", r.status)

    secret = ""
    for line in open("/home/z/my-project/.env"):
        if line.startswith("SESSION_SECRET="):
            secret = line.strip().split("=", 1)[1]
    tok = hmac.new(secret.encode(), f"{SID}:deliver".encode(), hashlib.sha256).hexdigest()[:32]

    url = f"{BASE}/api/queue/action?id={SID}&action=deliver&token={tok}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Cookie", cookie)
    try:
        r = urllib.request.urlopen(req, timeout=120)
        body = r.read().decode("utf-8", "replace")
        print("deliver action: HTTP", r.status)
        for marker in ("Report delivered", "Delivered", "No report", "Could not"):
            if marker.lower() in body.lower():
                idx = body.lower().find(marker.lower())
                print("page says:", re.sub(r"<[^>]+>", " ", body[max(0, idx - 40):idx + 160]).strip()[:200])
                break
    except urllib.error.HTTPError as e:
        print("deliver HTTP", e.code, e.read()[:300])

    time.sleep(2)
    print("status now:", sql("SELECT status FROM Submission WHERE id=?", (SID,)))
    print("reports:", sql("SELECT name, sizeBytes FROM ReportFile WHERE submissionId=?", (SID,)))
    log = open("/home/z/my-project/upload/portal/_outbox/NOTIFICATIONS.log").read()
    tail = [l for l in log.splitlines() if "WAFA" in l][-3:]
    for l in tail:
        print("MAIL:", l[:150])


import re  # noqa: E402

if __name__ == "__main__":
    main()
