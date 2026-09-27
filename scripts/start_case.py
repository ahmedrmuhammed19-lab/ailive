#!/usr/bin/env python3
"""
Global EIS — START command: full intake brief for the latest portal submission.

Usage:
    python3 scripts/start_case.py            # brief the newest unprocessed submission
    python3 scripts/start_case.py --id <submissionId>
    python3 scripts/start_case.py --list     # show all submissions + processed state
    python3 scripts/start_case.py --force    # re-brief even if already processed

This is the "start" trigger of the operating flow:
  client uploads via portal -> email/outbox alert -> operator says "start"
  -> THIS SCRIPT produces the full case brief -> agent runs deep analysis + v1.3 report.
"""

import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path("/home/z/my-project")
DB_PATH = PROJECT / "db" / "custom.db"
PORTAL_DIR = PROJECT / "upload" / "portal"
STATE_PATH = PORTAL_DIR / "_state.json"
BRIEF_NAME = "CASE_BRIEF.md"

# ---------------------------------------------------------------- benchmarks
# Canonical project thresholds (EGP-equivalent, per traveller)
BENCHMARKS = {
    "baseline": 250_000.0,
    "united kingdom": 205_440.0,
    "uk": 205_440.0,
    "schengen": 154_080.0,
    "usa": 256_800.0,
    "us": 256_800.0,
    "united states": 256_800.0,
    "america": 256_800.0,
}

BANK_SIGNATURES = [
    ("CIB", ["Commercial International Bank", "CIB", "البنك التجاري الدولي"]),
    ("NBE", ["National Bank of Egypt", "البنك الأهلي المصري"]),
    ("AAIB", ["Arab African International Bank", "AAIB"]),
    ("Banque Misr", ["Banque Misr", "بنك مصر"]),
    ("AlexBank", ["Bank of Alexandria", "بنك الإسكندرية"]),
    ("QNB", ["Qatar National Bank", "QNB"]),
    ("FIB", ["First Abu Dhabi Bank", "FAB"]),
    ("CIB-legacy-compact", []),  # fallback style seen on older CIB exports
]


def load_state():
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            return {}
    return {}


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2))


def md5_of(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def db_connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def fetch_submissions():
    con = db_connect()
    rows = con.execute(
        """SELECT s.id, s.userId, s.status, s.clientName, s.caseRef, s.country, s.visaType, s.travelers, s.email, s.createdAt,
                  COUNT(f.id) AS fileCount
           FROM Submission s LEFT JOIN StatementFile f ON f.submissionId = s.id
           GROUP BY s.id ORDER BY s.createdAt DESC"""
    ).fetchall()
    con.close()
    return rows


def fetch_files(submission_id):
    con = db_connect()
    rows = con.execute(
        "SELECT id, originalName, storedPath, sizeBytes, md5 FROM StatementFile "
        "WHERE submissionId = ? ORDER BY createdAt",
        (submission_id,),
    ).fetchall()
    con.close()
    return rows


def detect_bank(text: str):
    hits = []
    low = text.lower()
    for bank, needles in BANK_SIGNATURES:
        for n in needles:
            if n and n.lower() in low:
                hits.append((bank, n))
                break
    return hits


def probe_pdf(path: Path):
    """Return dict of probe facts for one statement PDF."""
    facts = {"pages": None, "text_pages": 0, "chars_first_pages": 0, "bank_hits": [],
             "holder": None, "account": None, "period": None, "currency": None,
             "text_layer": "unknown", "error": None}
    try:
        from pypdf import PdfReader
    except ImportError:
        facts["error"] = "pypdf not installed"
        return facts
    try:
        reader = PdfReader(str(path))
        facts["pages"] = len(reader.pages)
        sample_text = []
        for i, page in enumerate(reader.pages[:5]):
            try:
                t = page.extract_text() or ""
            except Exception:
                t = ""
            if t.strip():
                facts["text_pages"] += 1
            sample_text.append(t)
        blob = "\n".join(sample_text)
        facts["chars_first_pages"] = len(blob.strip())
        facts["text_layer"] = "YES" if facts["chars_first_pages"] > 200 else "NO (image-only scan — visual extraction required)"
        facts["bank_hits"] = detect_bank(blob)

        # --- field hints (only meaningful when a text layer exists) ---
        if facts["chars_first_pages"] > 200:
            m = re.search(
                r"(?:account\s*(?:holder|name|title)|customer\s*name)\s*[:\-]?\s*([A-Z][A-Za-z .'\-]{4,60})",
                blob, re.I)
            if m:
                facts["holder"] = m.group(1).strip()
            m = re.search(r"(?:account|acct)\s*(?:no|number|#)?\s*[:\-]?\s*((?:\d[\s-]?){9,20})", blob, re.I)
            if m:
                facts["account"] = re.sub(r"\D", "", m.group(1))
            m = re.search(
                r"(from|period)\s*:?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\s*(?:to|-|–)\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})",
                blob, re.I)
            if m:
                facts["period"] = f"{m.group(2)} → {m.group(3)}"
            for cur in ("EGP", "USD", "EUR", "GBP"):
                if cur in blob:
                    facts["currency"] = cur
                    break
    except Exception as e:
        facts["error"] = str(e)
    return facts


def pick_benchmark(country, visa_type, travelers=None):
    key = (country or "").strip().lower()
    # Real joint-applicants count from intake wins; fall back to legacy regex guess.
    if travelers is not None:
        try:
            persons = max(1, int(travelers))
        except (TypeError, ValueError):
            persons = 1
    else:
        persons = 2 if re.search(r"joint|2\s*(travellers?|persons?|people|applicants?)", (visa_type or "") + " " + (country or ""), re.I) else 1
    for k, v in BENCHMARKS.items():
        if k and k in key:
            return v, persons, k
    return BENCHMARKS["baseline"], persons, "baseline"


def fmt_ts(v):
    """Prisma/SQLite stores createdAt as epoch millis; ISO strings pass through."""
    try:
        n = float(v)
        return datetime.fromtimestamp(n / 1000, tz=timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    except (TypeError, ValueError):
        return str(v)


def brief_submission(row, force=False):
    sub_id = row["id"]
    state = load_state()
    processed = state.get(sub_id, {}).get("processedAt") if isinstance(state.get(sub_id), dict) else None
    if processed and not force:
        print(f"⚠  Submission {sub_id} ({row['clientName']}) was already briefed at {processed}.")
        print("   Use --force to re-brief, or check its CASE_BRIEF.md in the submission folder.\n")

    files = fetch_files(sub_id)
    lines = []
    add = lines.append

    add("# GLOBAL EIS — CASE INTAKE BRIEF")
    add(f"_Generated {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')} by start_case.py (the \"start\" command)_\n")

    add("## 1 · Submission")
    add(f"- **Submission ID** : `{sub_id}`")
    add(f"- **Queue/User ID** : {row['userId'] or '—'}")
    add(f"- **Queue status**  : {row['status'] or 'WAITING'}")
    add(f"- **Client**        : {row['clientName'] or '— (details pending — attach from portal Queue tab)'}")
    add(f"- **Case ref**      : {row['caseRef'] or '—'}")
    add(f"- **Destination**   : {row['country'] or '—'}")
    add(f"- **Visa type**     : {row['visaType'] or '—'}")
    add(f"- **Joint applicants**: {row['travelers'] if row['travelers'] not in (None, 0) else 1} (people using this same statement)")
    add(f"- **Client email**  : {row['email'] or '—'}")
    add(f"- **Arrived**       : {fmt_ts(row['createdAt'])}")
    add(f"- **Previously briefed**: {processed or 'no'}\n")

    add("## 2 · Files & integrity (MD5 chain)")
    ok_all = True
    probe_results = []
    for f in files:
        p = Path(f["storedPath"])
        exists = p.exists()
        disk_md5 = md5_of(p) if exists else "MISSING"
        match = exists and disk_md5 == f["md5"]
        ok_all &= bool(match)
        add(f"- **{f['originalName']}**")
        add(f"  - stored: `{p}` ({f['sizeBytes']:,} bytes)")
        add(f"  - MD5 DB  : `{f['md5']}`")
        add(f"  - MD5 disk: `{disk_md5 if exists else 'FILE MISSING'}`")
        add(f"  - integrity: {'✅ MATCH' if match else '❌ MISMATCH/MISSING'}")
        if exists and p.suffix.lower() == ".pdf":
            probe = probe_pdf(p)
            probe_results.append((f["originalName"], probe))
    add(f"\n**Integrity verdict: {'PASS — all files byte-perfect' if ok_all and files else 'FAIL — investigate before analysis'}**\n")

    add("## 3 · Statement probe (per PDF)")
    for name, pr in probe_results:
        add(f"### {name}")
        add(f"- Pages: {pr['pages']}")
        add(f"- Text layer: {pr['text_layer']}")
        add(f"- Bank signature: {', '.join(f'{b} (matched \"{n}\")' for b, n in pr['bank_hits']) or 'none detected'}")
        if pr["text_layer"].startswith("YES"):
            add(f"- Holder hint : {pr['holder'] or 'not auto-detected'}")
            add(f"- Account hint: {pr['account'] or 'not auto-detected'}")
            add(f"- Period hint : {pr['period'] or 'not auto-detected'}")
            add(f"- Currency    : {pr['currency'] or 'not auto-detected'}")
        if pr["error"]:
            add(f"- Probe error : {pr['error']}")
        add("")

    bench, persons, bkey = pick_benchmark(row["country"], row["visaType"], row["travelers"])
    target = bench * persons
    add("## 4 · Benchmark board (from intake metadata)")
    add(f"- Profile detected: **{bkey}** · joint applicants: **{persons}**")
    add(f"- Per-traveller benchmark: EGP {bench:,.2f}")
    add(f"- **Case target (closing balance must clear, ×{persons} joint applicants): EGP {target:,.2f}**")
    add(f"- (Project baseline for unmapped destinations: EGP 250,000.00)\n")

    add("## 5 · Recommended pipeline")
    banks = {b for _, pr in probe_results for b, _ in pr["bank_hits"]}
    if "CIB" in banks or "CIB-legacy-compact" in banks:
        add("- Parser family: CIB (ref scripts/cib_extract.py; legacy compact layout handled separately)")
    elif "AAIB" in banks:
        add("- Parser family: AAIB visual extraction (ref: كشف الحساب task — 445 txns page-by-page)")
    elif "Banque Misr" in banks:
        add("- Parser family: Banque Misr scan (ref: 1.pdf task — Xerox scan, visual extraction)")
    else:
        add("- Parser family: bespoke — inspect first pages visually, then build parser")
    if any(pr["text_layer"].startswith("NO") for _, pr in probe_results):
        add("- ⚠ Image-only scan detected: visual page-by-page extraction required (agent step)")
    add("- Then: extract → reconcile (chain + checkpoints + grand recon) → 9-flag pattern analysis")
    add("- Then: Standard v1.3 report (CSS from templates/global_eis_standard_v1.3.html) → preflight S1–S6 → deliver\n")

    brief = "\n".join(lines)
    out_dir = PORTAL_DIR
    if files and files[0]["storedPath"]:
        out_dir = Path(files[0]["storedPath"]).parent
    (out_dir / BRIEF_NAME).write_text(brief)

    st = load_state()
    entry = st.get(sub_id) if isinstance(st.get(sub_id), dict) else {}
    st[sub_id] = {"processedAt": datetime.now(timezone.utc).isoformat(), "client": row["clientName"],
                  "brief": str(out_dir / BRIEF_NAME)}
    save_state(st)

    print(brief)
    print(f"\n{'='*70}\nBrief saved  : {out_dir / BRIEF_NAME}")
    print(f"Briefed state: {STATE_PATH}")


def main():
    args = sys.argv[1:]
    rows = fetch_submissions()
    if not rows:
        print("No submissions in the portal database yet.")
        return
    if "--list" in args:
        state = load_state()
        print(f"{'SUBMISSION':<28}{'QUEUE ID':<14}{'STATUS':<11}{'CLIENT':<24}{'FILES':<6}{'ARRIVED':<21}BRIEFED")
        for r in rows:
            e = state.get(r["id"])
            briefed = e.get("processedAt", "yes")[:19] if e else "-"
            print(
                f"{r['id']:<28}{(r['userId'] or '—'):<14}{(r['status'] or 'WAITING'):<11}{(r['clientName'] or '—')[:22]:<24}{r['fileCount']:<6}{fmt_ts(r['createdAt']):<21}{briefed}"
            )
        return
    if "--id" in args:
        i = args.index("--id")
        wanted = args[i + 1] if i + 1 < len(args) else None
        row = next((r for r in rows if r["id"] == wanted), None)
        if not row:
            print(f"Submission '{wanted}' not found. Use --list.")
            return
    else:
        row = rows[0]  # newest
    brief_submission(row, force="--force" in args)


if __name__ == "__main__":
    main()
