#!/usr/bin/env python3
"""DL-22 Vercel deployment sweep — delete superseded deployments across ALL projects.

Safety protocol (from the DL-21 correction incident):
  1. Only delete deployments strictly OLDER than the project's latest READY
     production deployment (the successor must already be READY).
  2. Before deleting, verify the keeper is actually serving: its `alias` list
     must be non-empty (production aliases are attached when it becomes READY).
     If the alias check is inconclusive, the project is SKIPPED, not touched.
  3. Never delete the newest deployment of any project.

No secrets printed. Read-only except the DELETE calls, which are printed first.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

TOKEN = os.environ.get("VERCEL_TOKEN", "")
if not TOKEN:
    sys.exit("NO_TOKEN: set VERCEL_TOKEN env")

API = "https://api.vercel.com"
DRY = "--apply" not in sys.argv


def call(path, params=None, method="GET"):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOKEN}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")[:200]


def main():
    status, data = call("/v9/projects", {"limit": 100})
    if status != 200:
        sys.exit(f"projects list failed: {status} {data}")
    projects = data.get("projects", [])
    print(f"{'DRY RUN' if DRY else 'APPLY MODE'} — {len(projects)} projects\n")

    total_deleted, total_kept = 0, 0
    for p in projects:
        name, pid = p["name"], p["id"]
        status, data = call("/v6/deployments", {"projectId": pid, "limit": 100})
        if status != 200:
            print(f"[{name}] deployments list failed: {status} — SKIP")
            continue
        deps = data.get("deployments", [])
        if len(deps) <= 1:
            print(f"[{name}] {len(deps)} deployment(s) retained — nothing to sweep")
            total_kept += len(deps)
            continue

        deps.sort(key=lambda d: d["createdAt"], reverse=True)
        keeper = next(
            (d for d in deps if d.get("target") == "production" and d.get("readyState") == "READY"),
            None,
        )
        if keeper is None:
            print(f"[{name}] no READY production deployment found — SKIP (unsafe)")
            continue

        # verify keeper is serving (alias attached)
        status, kd = call(f"/v13/deployments/{keeper['uid']}")
        alias_attached = False
        if status == 200 and isinstance(kd, dict):
            aliases = kd.get("alias") or []
            alias_attached = len(aliases) > 0
            if not alias_attached and kd.get("aliasAssigned"):
                alias_attached = True
        if not alias_attached:
            print(f"[{name}] keeper {keeper['uid']} alias check inconclusive — SKIP (unsafe)")
            continue

        keep_when = datetime.fromtimestamp(keeper["createdAt"] / 1000, tz=timezone.utc)
        print(f"[{name}] keeper {keeper['uid']} READY@{keep_when:%m-%d %H:%M} alias=OK")
        total_kept += 1

        for d in deps:
            if d["uid"] == keeper["uid"]:
                continue
            if d["createdAt"] >= keeper["createdAt"]:
                print(f"    keep  {d['uid']} (not older than keeper)")
                total_kept += 1
                continue
            when = datetime.fromtimestamp(d["createdAt"] / 1000, tz=timezone.utc)
            if DRY:
                print(f"    WOULD DELETE {d['uid']} {d.get('readyState','?'):7s} target={d.get('target','-'):10s} {when:%m-%d %H:%M}")
            else:
                st, _ = call(f"/v13/deployments/{d['uid']}", method="DELETE")
                mark = "DELETED" if st in (200, 204) else f"FAIL({st})"
                print(f"    {mark:13s} {d['uid']} {d.get('readyState','?'):7s} target={d.get('target','-'):10s} {when:%m-%d %H:%M}")
                if st in (200, 204):
                    total_deleted += 1
                time.sleep(0.4)
        print()

    print(f"== SUMMARY: kept={total_kept} deleted={total_deleted if not DRY else 0} (dry={'yes' if DRY else 'no'}) ==")


if __name__ == "__main__":
    main()
