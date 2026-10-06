#!/usr/bin/env python3
"""
delivery_gate.py — SO-9 PRE-DELIVERY GATE (rebuilt 2026-10-06 after untracked wipe).

Usage: python3 scripts/delivery_gate.py <manifest.json>

Manifest format (receipts/manifest_*.json):
{
  "task_id": "ORD-1006-C1",
  "report_html": "published/....html",
  "chain_required": true,
  "publish_receipt": "receipts/publish_latest.json",
  "mail_receipt": "receipts/mail_v31.json",
  "forbidden": ["a.imam@beta.com.eg"]
}

Checks (all must PASS; any FAIL exits non-zero and BLOCKS the delivery):
  1. MANIFEST    — required keys present, report_html exists on disk
  2. TEMPLATE    — locked design markers in the report bytes (SO-1):
                   --primary:#005677, --secondary:#008DCB, Segoe UI
  3. CHAIN       — if chain_required: chain/verification block printed in the
                   report (SO-4): pairs closed + residual disclosed
  4. MAIL LOCK   — receipt recipient == TEST_MAIL_TO (SO-3); sent or queued;
                   forbidden address appears NOWHERE in any gate input
  5. PORTAL      — publish receipt ok=true and this exact filename in published[]
  6. WORKLOG     — task_id has a row in worklog.md (SO-6)

Fail-loud: a check that cannot be evaluated is a FAIL, never skipped.
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REQUIRED_KEYS = ["task_id", "report_html", "chain_required",
                 "publish_receipt", "mail_receipt", "forbidden"]

TEMPLATE_MARKERS = ["#005677", "#008DCB", "Segoe UI"]
CHAIN_MARKERS = ["closed", "residual"]  # case-insensitive, both required


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def read_text(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def test_mail_to():
    env_path = os.path.join(BASE, ".env")
    if os.path.exists(env_path):
        for line in read_text(env_path).splitlines():
            if line.startswith("TEST_MAIL_TO="):
                return line.split("=", 1)[1].strip()
    return "ahmedr.muhammed19@gmail.com"


def main():
    if len(sys.argv) != 2:
        print("GATE: FAIL — usage: delivery_gate.py <manifest.json>")
        return 2

    results = []

    def check(name, ok, detail=""):
        results.append((name, bool(ok), detail))

    # 1. MANIFEST
    manifest_path = os.path.join(BASE, sys.argv[1])
    manifest = None
    try:
        manifest = load_json(manifest_path)
        missing = [k for k in REQUIRED_KEYS if k not in manifest]
        check("MANIFEST.keys", not missing, f"missing={missing}" if missing else "all keys present")
    except Exception as e:
        check("MANIFEST.keys", False, f"cannot load manifest: {e}")
        manifest = None

    report_path = None
    if manifest:
        report_path = os.path.join(BASE, manifest.get("report_html", ""))
        check("MANIFEST.report_exists", bool(report_path) and os.path.isfile(report_path),
              manifest.get("report_html", "?"))

    html = read_text(report_path) if (report_path and os.path.isfile(report_path)) else ""

    # 2. TEMPLATE markers (SO-1)
    if html:
        missing_markers = [m for m in TEMPLATE_MARKERS if m not in html]
        check("TEMPLATE.markers", not missing_markers,
              "ok" if not missing_markers else f"missing {missing_markers}")
    else:
        check("TEMPLATE.markers", False, "no report bytes")

    # 3. CHAIN block (SO-4) — only when the report carries chain content
    chain_required = bool(manifest and manifest.get("chain_required"))
    if chain_required:
        low = html.lower()
        hit = all(m in low for m in CHAIN_MARKERS)
        check("CHAIN.block", hit, "pairs-closed + residual disclosed"
              if hit else "chain language not found in report")
    else:
        check("CHAIN.block", True, "not required for this artifact")

    # 4. MAIL LOCK (SO-3)
    mail = None
    mail_path = os.path.join(BASE, manifest["mail_receipt"]) if manifest else None
    try:
        mail = load_json(mail_path)
    except Exception as e:
        check("MAIL.receipt", False, f"cannot load mail receipt: {e}")
    if mail:
        expect = test_mail_to()
        to = (mail.get("to") or "").strip()
        ok_to = (to == expect)
        ok_sent = bool(mail.get("sent")) or bool(mail.get("queued"))
        check("MAIL.recipient", ok_to, f"to={to!r} expected={expect!r}")
        check("MAIL.delivered", ok_sent, "sent or outbox-queued")
    forbidden_hits = []
    # NOTE: the manifest itself DECLARES the forbidden list — scanning its own
    # declaration would be a guaranteed false positive. Scan the manifest with
    # its forbidden values stripped, plus every receipt and the report bytes.
    man_blob = read_text(manifest_path) if os.path.isfile(manifest_path) else ""
    for addr in (manifest or {}).get("forbidden", ["a.imam@beta.com.eg"]):
        man_blob = man_blob.replace(addr, "")
    scan_targets = [man_blob]
    if report_path and os.path.isfile(report_path):
        scan_targets.append(read_text(report_path))
    if manifest:
        for key in ("publish_receipt", "mail_receipt"):
            p = os.path.join(BASE, manifest[key])
            if os.path.isfile(p):
                scan_targets.append(read_text(p))
    blob = "\n".join(scan_targets).lower()
    for addr in (manifest or {}).get("forbidden", ["a.imam@beta.com.eg"]):
        if addr.lower() in blob:
            forbidden_hits.append(addr)
    check("MAIL.forbidden_absent", not forbidden_hits,
          "clean" if not forbidden_hits else f"FORBIDDEN ADDRESS PRESENT: {forbidden_hits}")

    # 5. PORTAL receipt
    pub = None
    pub_path = os.path.join(BASE, manifest["publish_receipt"]) if manifest else None
    try:
        pub = load_json(pub_path)
    except Exception as e:
        check("PORTAL.receipt", False, f"cannot load publish receipt: {e}")
    if pub and manifest:
        ok_flag = pub.get("ok") is True
        name = os.path.basename(manifest["report_html"])
        listed = any(p.get("name") == name for p in pub.get("published", []))
        check("PORTAL.published", ok_flag and listed,
              f"ok={pub.get('ok')} name_listed={listed} ({name})")

    # 6. WORKLOG row (SO-6)
    wl_path = os.path.join(BASE, "worklog.md")
    wl = read_text(wl_path) if os.path.isfile(wl_path) else ""
    task = (manifest or {}).get("task_id", "")
    check("WORKLOG.row", bool(task) and task in wl,
          f"task_id={task!r} {'found' if task and task in wl else 'NOT in worklog'}")

    # verdict
    print(f"SO-9 GATE — {task or os.path.basename(sys.argv[1])}")
    failed = False
    for name, ok, detail in results:
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failed = True
        print(f"  [{mark}] {name:<22} {detail}")
    if failed:
        print("GATE: FAIL — delivery BLOCKED (fix, re-run, then deliver)")
        return 1
    print("GATE: PASS — all channels evidenced; delivery may proceed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
