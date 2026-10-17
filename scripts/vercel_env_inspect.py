#!/usr/bin/env python3
"""DL-25 — inspect ailive Vercel env vars (keys only, never values).
Reads VERCEL_TOKEN from env var or .env; prints only env key names."""
import json
import os
import sys
import urllib.request

TOKEN = os.environ.get("VERCEL_TOKEN", "")
if not TOKEN:
    try:
        for line in open("/home/z/my-project/.env"):
            if line.startswith("VERCEL_TOKEN="):
                TOKEN = line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
if not TOKEN:
    print("ABORT: VERCEL_TOKEN not found in env or .env", file=sys.stderr)
    sys.exit(2)


def call(url: str):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> None:
    projs = call("https://api.vercel.com/v9/projects?search=ailive")["projects"]
    if not projs:
        print("ABORT: ailive project not found", file=sys.stderr)
        sys.exit(2)
    pid = projs[0]["id"]
    envs = call(f"https://api.vercel.com/v10/projects/{pid}/env")["envs"]
    names = sorted(e["key"] for e in envs)
    print(f"ailive ({pid}) env vars: {len(names)}")
    for n in names:
        print("  -", n)
    print()
    print("MAIL_CREDS_JSON present:", "MAIL_CREDS_JSON" in names)
    print("TEST_MAIL_TO present:", "TEST_MAIL_TO" in names)
    print("GH_VAULT_TOKEN present:", "GH_VAULT_TOKEN" in names)


if __name__ == "__main__":
    main()
