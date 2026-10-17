#!/usr/bin/env bash
# DL-25 — pull MAIL_CREDS_JSON from Vercel into the gitignored local config
# file, then run the locked live-fire mail smoke through the real mailer.
# Secrets never printed; local file is gitignored (config/mail_credentials.json).
set -euo pipefail
cd /home/z/my-project

[ -n "${VERCEL_TOKEN:-}" ] || { echo "ABORT: VERCEL_TOKEN not set" >&2; exit 2; }

mkdir -p config

python3 - <<'PY'
import json, os, urllib.request

TOKEN = os.environ["VERCEL_TOKEN"]

def call(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

projs = call("https://api.vercel.com/v9/projects?search=ailive")["projects"]
pid = projs[0]["id"]
envs = call(f"https://api.vercel.com/v10/projects/{pid}/env")["envs"]
target = next((e for e in envs if e["key"] == "MAIL_CREDS_JSON"), None)
if not target:
    raise SystemExit("MAIL_CREDS_JSON not found on Vercel")
detail = call(f"https://api.vercel.com/v10/projects/{pid}/env/{target['id']}?decrypt=true")
raw = (detail.get("value") or "").strip()
if not raw:
    raise SystemExit("MAIL_CREDS_JSON empty on Vercel")
creds = json.loads(raw)
assert creds.get("email") and creds.get("app_password"), "shape invalid"

out = {
    "email": creds["email"],
    "app_password": creds["app_password"],
    "notify_to": creds.get("notify_to", "ahmedr.muhammed19@gmail.com"),
}
for k in ("host", "port", "secure"):
    if creds.get(k) is not None:
        out[k] = creds[k]

p = "/home/z/my-project/config/mail_credentials.json"
with open(p, "w") as f:
    json.dump(out, f, indent=2)
os.chmod(p, 0o600)
print("local creds file written:", p, "(chmod 600, gitignored)")
print("smtp login:", out["email"][:2] + "***@" + out["email"].split("@")[-1])
PY

# Belt & braces: hard-lock every send to the operator mailbox for this test.
export TEST_MAIL_TO="ahmedr.muhammed19@gmail.com"

echo "--- running mail smoke (real mailer, TEST_MAIL_TO lock engaged) ---"
bun scripts/mail_smoke.ts
