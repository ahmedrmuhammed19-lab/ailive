#!/usr/bin/env python3
"""DL-32 — disable the portal engine (owner model: portal = upload/share
surface ONLY; every statement is worked personally by the agent on the
owner's explicit order).

Actions:
  1. Upsert AUTO_WORK=0 on the ailive Vercel project (production/preview/
     development) — this is the documented kill switch in
     src/app/api/upload/route.ts ("AUTO_WORK=0 restores the manual
     Start Analysis flow").
  2. Trigger a production redeploy from the git-connected main branch so the
     env change takes effect immediately (env edits alone need a deploy).
  3. Poll the new deployment until READY (bounded).

Token is read from .env VERCEL_TOKEN and never printed.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

API = "https://api.vercel.com"


def token() -> str:
    tok = os.environ.get("VERCEL_TOKEN", "")
    if tok:
        return tok
    for line in open("/home/z/my-project/.env"):
        if line.startswith("VERCEL_TOKEN="):
            return line.split("=", 1)[1].strip()
    print("ABORT: VERCEL_TOKEN not found", file=sys.stderr)
    sys.exit(2)


def call(method: str, url: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token()}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def main() -> None:
    # 1. locate project
    st, projs = call("GET", f"{API}/v9/projects?search=ailive")
    if st != 200 or not projs.get("projects"):
        print(f"ABORT: project lookup failed (HTTP {st})", file=sys.stderr)
        sys.exit(2)
    pid = projs["projects"][0]["id"]
    print(f"project ailive found: {pid[:12]}...")

    # 2. current env state
    st, envs = call("GET", f"{API}/v10/projects/{pid}/env")
    if st != 200:
        print(f"ABORT: env list failed (HTTP {st})", file=sys.stderr)
        sys.exit(2)
    existing = [e for e in envs.get("envs", []) if e["key"] == "AUTO_WORK"]
    body = {
        "key": "AUTO_WORK",
        "value": "0",
        "type": "encrypted",
        "target": ["production", "preview", "development"],
    }
    if existing:
        env_id = existing[0]["id"]
        st, res = call(
            "PATCH",
            f"{API}/v9/projects/{pid}/env/{env_id}?upsert=true",
            body,
        )
        action = "updated existing AUTO_WORK"
    else:
        st, res = call("POST", f"{API}/v10/projects/{pid}/env", body)
        action = "created AUTO_WORK"
    ok = st in (200, 201)
    print(f"{action}=0 on prod: HTTP {st} -> {'OK' if ok else 'FAILED ' + json.dumps(res)[:200]}")
    if not ok:
        sys.exit(3)

    # 3. redeploy production from main so the change is live
    st, deps = call(
        "GET", f"{API}/v6/deployments?projectId={pid}&target=production&limit=1"
    )
    ref = "main"
    if st == 200 and deps.get("deployments"):
        meta = deps["deployments"][0].get("meta") or {}
        sha = meta.get("githubCommitRef") or meta.get("githubCommitSha")
        if meta.get("githubCommitRef"):
            ref = meta["githubCommitRef"]
        print(f"latest prod deploy ref: {ref} (sha {str(meta.get('githubCommitSha'))[:10]})")
    dep_body = {
        "name": "ailive",
        "project": pid,
        "target": "production",
        "gitSource": {"type": "branch", "org": "ahmedrmuhammed19-lab", "repo": "ailive", "ref": ref},
    }
    st, dep = call("POST", f"{API}/v13/deployments", dep_body)
    if st not in (200, 201):
        print(f"redeploy trigger FAILED: HTTP {st} {json.dumps(dep)[:300]}", file=sys.stderr)
        sys.exit(4)
    dep_id = dep.get("id", "?")
    dep_url = dep.get("url", "?")
    print(f"redeploy triggered: {dep_id} ({dep_url})")

    # 4. bounded poll (max ~240s)
    deadline = time.time() + 240
    final = "TIMEOUT-STILL-BUILDING"
    while time.time() < deadline:
        time.sleep(12)
        st, d = call("GET", f"{API}/v13/deployments/{dep_id}")
        if st != 200:
            continue
        rstate = d.get("readyState") or d.get("state")
        print(f"  deploy state: {rstate}")
        if rstate in ("READY", "ERROR", "CANCELED"):
            final = rstate
            break
    print(f"FINAL: AUTO_WORK=0 set; deploy {dep_id} -> {final}")


if __name__ == "__main__":
    main()
