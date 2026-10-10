#!/usr/bin/env python3
"""Bola Ayad 3-report delivery: repo-publish lane + outbox mail + gate manifests.

Lane proven on NBE-V4-SHIP-1: copy HTML to public/, commit, push (Vercel serves
public/ at prod root), poll prod URLs for HTTP 200, write receipts, queue outbox
mail (SMTP key still owner-side), build SO-9 manifests, run delivery_gate.py.
"""
import json, os, shutil, subprocess, sys, time, urllib.request
from datetime import datetime, timezone

ROOT = "/home/z/my-project"
PUB = f"{ROOT}/published"
PUBLIC = f"{ROOT}/public"
OUTBOX = f"{ROOT}/upload/portal/_outbox"
BASE = "https://ailive-three.vercel.app"
REPORTS = [
    ("saving",  "GlobalEIS_Report_BolaAyad_Saving_EGP_382rows.html",  "GLEIS-BOLA-2026-SAV-01",
     "Global EIS — Bank Statement Analysis (Savings 0765…019 EGP · 382/382 rows · full SO-10 passport)"),
    ("current", "GlobalEIS_Report_BolaAyad_Current_EGP_18rows.html", "GLEIS-BOLA-2026-CUR-01",
     "Global EIS — Bank Statement Analysis (Current 2083…010 EGP · 18/18 rows · full SO-10 passport)"),
    ("usd",     "GlobalEIS_Report_BolaAyad_USD_44rows.html",         "GLEIS-BOLA-2026-USD-01",
     "Global EIS — Bank Statement Analysis (USD 2115…012 · 44/44 rows · full SO-10 passport)"),
]
NOW = datetime.now(timezone.utc).isoformat()

# 1) copy to public/
for _, name, _, _ in REPORTS:
    shutil.copyfile(f"{PUB}/{name}", f"{PUBLIC}/{name}")
print("copied 3 reports to public/")

# 2) commit + push (SO-12: force-track gate-relevant artifacts even if gitignored)
subprocess.run(["git", "add", "-A", "public/", "published/", "receipts/"], cwd=ROOT, check=True)
subprocess.run(["git", "add", "-f",
                "scripts/bola_parse.py", "scripts/bola_verify.py", "scripts/bola_g9.py",
                "scripts/bola_final.py", "scripts/bola_report.ts", "scripts/bola_probe.py",
                "scripts/bola_deliver.py", "scripts/bola_work/",
                "upload/saving.pdf", "upload/current check.pdf", "upload/USD.pdf"],
               cwd=ROOT, check=True)
subprocess.run(["git", "commit", "-m",
                "BOLA-1: 3 CIB digital statements (Bola Ayad) — 444 rows glyph-exact, "
                "G1-G9 passports, 3 Master v1.2 reports; state+receipts tracked (SO-12)"],
               cwd=ROOT, check=False)
p = subprocess.run(["git", "push", "origin", "HEAD:main"], cwd=ROOT, capture_output=True, text=True)
print("push:", (p.stdout + p.stderr).strip().splitlines()[-1:] or "ok")

# 3) poll prod URLs
ok_all = True
for _, name, _, _ in REPORTS:
    url = f"{BASE}/{name}"
    code = None
    for _ in range(30):
        try:
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "GlobalEIS-gate/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                code = resp.status
            if code == 200:
                break
        except Exception as e:
            code = str(e)[:40]
        time.sleep(4)
    print("prod", name, "->", code)
    if code != 200:
        ok_all = False

publish_receipt = {
    "ok": ok_all, "published": [{"name": n, "sizeBytes": os.path.getsize(f"{PUB}/{n}")} for _, n, _, _ in REPORTS],
    "skipped": [], "note": "Bola Ayad 3-statement delivery via repo lane",
    "at": NOW,
}
json.dump(publish_receipt, open(f"{ROOT}/receipts/publish_bola.json", "w"), indent=1)

# 4) outbox mail ×3 + receipts
os.makedirs(OUTBOX, exist_ok=True)
for key, name, ref, subject in REPORTS:
    mail = {
        "kind": f"report_bola_{key}", "to": "ahmedr.muhammed19@gmail.com",
        "subject": subject, "hasHtml": True, "status": "QUEUED",
        "error": "SMTP credentials not re-supplied after wipe — outbox mode (SO-3 lock intact)",
        "at": NOW,
        "note": "outbox mode; flush_outbox.py replays when SMTP key returns; recipient locked to TEST_MAIL_TO",
        "html": None,
        "attachment": f"published/{name}",
        "body": (f"Dear Client,\n\nPlease find the completed bank statement analysis report for account "
                 f"{ref} (Bola Ayad Salama Awad Gerges).\n\n"
                 f"Verification: strict balance chain closed on every row (residual 0.00); SO-10 passport "
                 f"G1-G9 all PASS with measured values; report rendered on the firm's Master v1.2 standard.\n"
                 f"Prod URL: {BASE}/{name}\n\n"
                 f"Global EIS - Financial Intelligence Services\n"),
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    json.dump(mail, open(f"{OUTBOX}/{stamp}_report_bola_{key}_out.json", "w"), indent=1)
    json.dump({"kind": f"report_bola_{key}", "to": "ahmedr.muhammed19@gmail.com", "subject": subject,
               "hasHtml": True, "status": "QUEUED", "error": mail["error"], "at": NOW,
               "note": mail["note"], "queued": True, "sent": False},
              open(f"{ROOT}/receipts/mail_bola_{key}.json", "w"), indent=1)
print("outbox mail queued x3")

# 5) gate manifests ×3
for key, name, ref, _ in REPORTS:
    manifest = {
        "task_id": f"BOLA-1-{key.upper()}",
        "report_html": f"published/{name}",
        "chain_required": True,
        "publish_receipt": "receipts/publish_bola.json",
        "mail_receipt": f"receipts/mail_bola_{key}.json",
        "forbidden": ["a.imam@beta.com.eg"],
    }
    json.dump(manifest, open(f"{ROOT}/receipts/manifest_bola_{key}.json", "w"), indent=1)
print("manifests x3")

# 6) gate
fails = 0
for key, name, ref, _ in REPORTS:
    r = subprocess.run([sys.executable, f"{ROOT}/scripts/delivery_gate.py",
                        f"{ROOT}/receipts/manifest_bola_{key}.json"], capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()
    print(f"GATE {key}: rc={r.returncode} | " + " | ".join(tail[-3:]))
    fails += r.returncode != 0
print("DELIVERY DONE, gate fails:", fails)
sys.exit(1 if fails or not ok_all else 0)
