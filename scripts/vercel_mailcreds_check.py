#!/usr/bin/env python3
"""DL-25 — fetch MAIL_CREDS_JSON from Vercel env (in-memory only), validate
shape, and report diagnostics WITHOUT printing any secret.
Outputs nothing sensitive: only booleans, host, port, email domain, lengths."""
import json
import os
import sys
import urllib.request

TOKEN = os.environ.get("VERCEL_TOKEN", "")
if not TOKEN:
    print("ABORT: VERCEL_TOKEN not set", file=sys.stderr)
    sys.exit(2)


def call(url: str):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> None:
    projs = call("https://api.vercel.com/v9/projects?search=ailive")["projects"]
    pid = projs["id"] if False else projs[0]["id"]
    envs = call(f"https://api.vercel.com/v10/projects/{pid}/env")["envs"]
    target = next((e for e in envs if e["key"] == "MAIL_CREDS_JSON"), None)
    if not target:
        print("MAIL_CREDS_JSON: MISSING")
        return
    eid = target["id"]
    try:
        detail = call(
            f"https://api.vercel.com/v10/projects/{pid}/env/{eid}?decrypt=true"
        )
    except Exception as exc:  # noqa: BLE001
        print(f"MAIL_CREDS_JSON: present but decrypt failed ({exc.__class__.__name__})")
        return
    raw = detail.get("value") or ""
    if not raw.strip():
        print("MAIL_CREDS_JSON: present but EMPTY value")
        return
    try:
        creds = json.loads(raw)
    except json.JSONDecodeError:
        print("MAIL_CREDS_JSON: present but NOT valid JSON "
              f"(length={len(raw)})")
        return
    email = creds.get("email", "")
    print("MAIL_CREDS_JSON: valid JSON, shape OK:",
          bool(creds.get("email") and creds.get("app_password")))
    print("  email domain:", email.split("@")[-1] if "@" in email else "(none)")
    print("  host:", creds.get("host", "smtp.gmail.com (default)"))
    print("  port:", creds.get("port", "465 (gmail default)"))
    print("  app_password length:", len(creds.get("app_password", "")))
    print("  notify_to set:", bool(creds.get("notify_to")))
    print("  gmail-shape (16-char app password):",
          len(creds.get("app_password", "")) == 16
          and " " not in creds.get("app_password", ""))


if __name__ == "__main__":
    main()
