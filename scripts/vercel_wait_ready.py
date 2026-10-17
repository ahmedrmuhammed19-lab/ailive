#!/usr/bin/env python3
"""DL-24 — wait for the newest ailive production deployment to be READY.

Reads VERCEL_TOKEN from .env; polls v6/deployments?projectId=<ailive>&limit=3
until the newest production deployment reports readyState READY (or an error
state / timeout). Prints the deployment uid + created timestamp. No secrets
are printed.
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE = Path("/home/z/my-project")
TOKEN = os.environ.get("VERCEL_TOKEN", "")
if not TOKEN:
    for line in (BASE / ".env").read_text().splitlines():
        if line.startswith("VERCEL_TOKEN="):
            TOKEN = line.split("=", 1)[1].strip()
if not TOKEN:
    print("ABORT: VERCEL_TOKEN not found in .env", file=sys.stderr)
    sys.exit(1)


def call(path: str):
    req = urllib.request.Request(
        f"https://api.vercel.com{path}", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main() -> None:
    projects = call("/v9/projects?search=ailive")
    pid = next(p["id"] for p in projects["projects"] if p["name"] == "ailive")
    deadline = time.time() + 480  # 8 min cap
    last = None
    while time.time() < deadline:
        deps = call(f"/v6/deployments?projectId={pid}&limit=3&target=production")
        newest = deps["deployments"][0]
        state = newest.get("readyState")
        uid = newest["uid"]
        created = time.strftime("%H:%M:%S UTC", time.gmtime(newest["createdAt"] / 1000))
        if (uid, state) != last:
            print(f"  {uid} created {created} state={state}")
            last = (uid, state)
        if state == "READY":
            print(f"READY: {uid}")
            return
        if state in ("ERROR", "CANCELED"):
            print(f"ABORT: deployment {uid} entered {state}", file=sys.stderr)
            sys.exit(1)
        time.sleep(15)
    print("ABORT: timeout waiting for READY", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
