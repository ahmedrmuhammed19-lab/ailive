#!/usr/bin/env python3
"""Re-fire the engine on the Wafa case (operator start action) and confirm the
red 'needs manual work' operator alert reaches the test inbox."""
import hashlib
import hmac
import json
import sqlite3
import sys
import time
import urllib.request

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
LOG = "/home/z/my-project/upload/portal/_outbox/NOTIFICATIONS.log"


def sql(q):
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return row[0] if row else ""
    finally:
        con.close()


def http(method, path, body=None, cookie=None, timeout=120):
    req = urllib.request.Request(BASE + path, method=method)
    if cookie:
        req.add_header("Cookie", cookie)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        r = urllib.request.urlopen(req, data, timeout=timeout)
        return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main():
    sid = sql("SELECT id FROM Submission ORDER BY createdAt DESC LIMIT 1;")
    secret = ""
    for line in open("/home/z/my-project/.env"):
        if line.startswith("SESSION_SECRET="):
            secret = line.strip().split("=", 1)[1]
    tok = hmac.new(secret.encode(), f"{sid}:start".encode(), hashlib.sha256).hexdigest()[:32]
    print("sid:", sid, "| token:", tok[:8], "...")

    st, body = http("POST", "/api/login", body={"username": "op.eis", "password": "Op-Test-2026!"})
    setc = ""
    print("login op.eis:", st)
    # grab cookie via raw urllib (headers)
    req = urllib.request.Request(BASE + "/api/login", method="POST", data=json.dumps({"username": "op.eis", "password": "Op-Test-2026!"}).encode())
    req.add_header("Content-Type", "application/json")
    r = urllib.request.urlopen(req, timeout=60)
    setc = (r.headers.get("Set-Cookie") or "").split(";")[0]
    print("cookie:", bool(setc))

    st, body = http("GET", f"/api/queue/action?id={sid}&action=start&token={tok}", cookie=setc, timeout=300)
    print("start action: HTTP", st, body[:120])

    print("--- waiting for red alert mail in NOTIFICATIONS.log (max 180s) ---")
    dl = time.time() + 180
    while time.time() < dl:
        log = open(LOG).read()
        if "needs manual work" in log and "WAFA" in log:
            for line in log.splitlines():
                if "WAFA" in line:
                    print("MAIL:", line[:160])
            print("RED MAIL CONFIRMED")
            return
        time.sleep(4)
    print("red mail not seen in time")


if __name__ == "__main__":
    sys.exit(main())
