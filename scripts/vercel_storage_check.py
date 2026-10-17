#!/usr/bin/env python3
"""DL-22 status sweep: retained Vercel deployments (ailive + translation-portal) + prod smoke.

Reads VERCEL_TOKEN from env or untracked .env. Prints a compact, paste-safe report.
No secrets are printed.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TOKEN = os.environ.get("VERCEL_TOKEN", "")
if not TOKEN:
    try:
        with open("/home/z/my-project/.env") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("VERCEL_TOKEN="):
                    TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    except FileNotFoundError:
        pass
if not TOKEN:
    sys.exit("NO_TOKEN: set VERCEL_TOKEN env or add to .env")

API = "https://api.vercel.com"


def get(path, params=None):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    # 1) projects
    projects = get("/v9/projects", {"limit": 100}).get("projects", [])
    print("== PROJECTS ==")
    targets = []
    for p in projects:
        print(f"  {p['name']:24s} id={p['id']}  created={datetime.fromtimestamp(p['createdAt']/1000, tz=timezone.utc):%Y-%m-%d}")
        if p["name"] in ("ailive", "translation-portal"):
            targets.append(p)

    # 2) retained deployments per target project
    for p in targets:
        deps = get("/v6/deployments", {"projectId": p["id"], "limit": 20, "state": "READY,ERROR,BUILDING,INITIALIZING"}).get("deployments", [])
        print(f"\n== DEPLOYMENTS {p['name']} (retained={len(deps)}) ==")
        for d in deps:
            when = datetime.fromtimestamp(d["createdAt"] / 1000, tz=timezone.utc)
            print(f"  {d['uid']}  {d.get('readyState','?'):9s} target={d.get('target','-'):10s} {when:%Y-%m-%d %H:%M}  {d.get('url','')}")

    # 3) prod smoke
    print("\n== PROD SMOKE ailive-three.vercel.app ==")
    try:
        req = urllib.request.Request("https://ailive-three.vercel.app/")
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            code = r.status
    except Exception as exc:  # noqa: BLE001
        print(f"  GET / -> ERROR {exc}")
        code, body = None, ""
    else:
        print(f"  GET / -> {code}")
    if body:
        hit = "Master v1.4.0" in body
        print(f"  footer 'Master v1.4.0' present: {hit}")
    try:
        req = urllib.request.Request(
            "https://ailive-three.vercel.app/api/login",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"  POST /api/login (empty body) -> {r.status} (400 expected)")
    except urllib.error.HTTPError as exc:
        print(f"  POST /api/login (empty body) -> {exc.code} (400 expected)")
    except Exception as exc:  # noqa: BLE001
        print(f"  POST /api/login -> ERROR {exc}")


if __name__ == "__main__":
    main()
