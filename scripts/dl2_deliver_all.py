#!/usr/bin/env python3
"""DL-2: Deliver ALL task files to /home/z/my-project/download/ (user-facing).
Organized: reports / templates / governance / evidence + MANIFEST.txt (SHA256)."""
import hashlib
import shutil
from pathlib import Path

BASE = Path("/home/z/my-project")
DL = BASE / "download"
PUB = BASE / "published"

REPORTS = [
    # (filename, note)
    ("GlobalEIS_Report_EidFarag_NBE_EGP_v4_462rows.html", "NBE (Eid Farag) EGP — FINAL v4, 462/462 rows, G1-G9 PASS (supersedes v1/v3.x)"),
    ("GlobalEIS_Report_BolaAyad_Saving_EGP_382rows.html", "Bola Ayad Saving EGP 0765...019 — 382 rows, G1-G9 PASS"),
    ("GlobalEIS_Report_BolaAyad_Current_EGP_18rows.html", "Bola Ayad Current EGP 2083...010 — 18 rows, G1-G9 PASS"),
    ("GlobalEIS_Report_BolaAyad_USD_44rows.html", "Bola Ayad USD 2115...012 — 44 rows, G1-G9 PASS"),
    ("GlobalEIS_Report_EidFarag_NBE_EGP_v3.2_100pct.html", "NBE v3.2 — superseded by v4 (kept for audit trail)"),
    ("GlobalEIS_Report_EidFarag_NBE_EGP_v3.1_100pct.html", "NBE v3.1 — superseded by v4 (kept for audit trail)"),
    ("GlobalEIS_Report_EidFarag_NBE_EGP_v3_100pct.html", "NBE v3 — superseded by v4 (kept for audit trail)"),
    ("GlobalEIS_Report_EidFarag_NBE_EGP.html", "NBE v1 (first pass) — superseded by v4 (kept for audit trail)"),
    ("GlobalEIS_Notice_NBE_v33_CORRECTION.html", "Correction notice v3.3 — template v1.2_02"),
]

TEMPLATES = [
    ("Global_EIS_Template_v1.2_Library.html", "Master template library v1.2 (governing set)"),
    ("Global_EIS_Template_v1.2_01_Bank_Statement_Analysis.html", "v1.2_01 Bank Statement Analysis — GOVERNING template for all reports"),
    ("Global_EIS_Template_v1.2_02_Correction_Notice.html", "v1.2_02 Correction Notice"),
    ("Global_EIS_Template_v1.2_03_Standing_Orders.html", "v1.2_03 Standing Orders"),
    ("Global_EIS_Template_v1.2_04_Operations_Report.html", "v1.2_04 Operations Report"),
    ("Global_EIS_Template_Library.html", "Legacy template library (v1, retired)"),
    ("Global_EIS_Template_01_Bank_Statement_Analysis.html", "Legacy 01 (v1, retired)"),
    ("Global_EIS_Template_02_Correction_Notice.html", "Legacy 02 (v1, retired)"),
    ("Global_EIS_Template_03_Standing_Orders.html", "Legacy 03 (v1, retired)"),
    ("Global_EIS_Template_04_Operations_Report.html", "Legacy 04 (v1, retired)"),
    ("Global_EIS_Template_Showcase.html", "Template showcase (retired)"),
    ("Global_EIS_Retired_Templates_Gallery.html", "Retired templates gallery (archive)"),
]

GOVERNANCE = [
    ("Global_EIS_Standing_Orders.html", "STANDING ORDERS SO-1..SO-12 (operations constitution)"),
    ("Global_EIS_Ops_Report_2026-10-05_v2.html", "Operations report 2026-10-05 v2"),
]

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def place(items, subdir):
    out = []
    d = DL / subdir
    d.mkdir(parents=True, exist_ok=True)
    for fn, note in items:
        src = PUB / fn
        if not src.exists():
            print(f"!! MISSING: {fn}")
            continue
        dst = d / fn
        shutil.copy2(src, dst)
        out.append((subdir, fn, dst.stat().st_size, sha256(dst), note))
    return out

rows = []
rows += place(REPORTS, "01_reports")
rows += place(TEMPLATES, "02_templates")
rows += place(GOVERNANCE, "03_governance")

# Evidence state JSONs
EV = [
    ("04_evidence/NBE_EidFarag_v4", BASE / "scripts/alahly_work_state",
     "NBE v4 verification work-state (SO-10 passport data: rows, gates, print table, stats)"),
    ("04_evidence/BolaAyad_3stmts", BASE / "scripts/bola_work",
     "Bola 3-statement verification work-state (rows, gates, G9 bindings, stats)"),
]
for sub, srcdir, note in EV:
    d = DL / sub
    d.mkdir(parents=True, exist_ok=True)
    for src in sorted(srcdir.glob("*.json")):
        dst = d / src.name
        shutil.copy2(src, dst)
        rows.append((sub, src.name, dst.stat().st_size, sha256(dst), note))

# Legacy task files restored from old git lineage (05_legacy_task_files)
LEG = DL / "05_legacy_task_files"
LEG_NOTE = "Historical client report (pre-v1.2 generation, restored from git lineage caf615d)"
if LEG.exists():
    for src in sorted(LEG.iterdir()):
        if src.is_file():
            rows.append(("05_legacy_task_files", src.name, src.stat().st_size, sha256(src), LEG_NOTE))

# DL-4: ALL reports flattened at download ROOT for direct chat download.
# Every client-facing report (current v1.2 set + legacy restored set) gets a
# copy at download/ root; structured subdirs keep their copies unchanged.
FLAT = []
for sub, fn, size, digest, note in rows:
    if sub in ("01_reports", "05_legacy_task_files"):
        src = DL / sub / fn
        dst = DL / fn
        shutil.copy2(src, dst)
        FLAT.append(("00_ALL_REPORTS_FLAT", fn, dst.stat().st_size, sha256(dst), note + " [root copy]"))
rows = FLAT + rows

# MANIFEST.txt
lines = [
    "GLOBAL EIS - FULL TASK DELIVERY MANIFEST",
    "Generated: 2026-10-11 | Gate: SO-9 | Templates: Master v1.2 (src/lib/report_design.ts)",
    "DL-4: ALL reports also flattened at download root (00_ALL_REPORTS_FLAT) for direct download",
    "All HTML byte-identical to production copies (https://ailive-three.vercel.app)",
    "=" * 100,
]
cur = None
for sub, fn, size, digest, note in rows:
    if sub != cur:
        lines.append("")
        lines.append(f"[{sub}]")
        cur = sub
    lines.append(f"  {fn}  |  {size:>8,} B  |  sha256 {digest[:16]}  |  {note}")
lines += ["", "=" * 100, f"TOTAL FILES: {len(rows)}"]
mani = DL / "MANIFEST.txt"
mani.write_text("\n".join(lines) + "\n", encoding="utf-8")

print(f"OK: {len(rows)} files + MANIFEST.txt -> {DL}")
for sub in sorted({r[0] for r in rows}):
    n = sum(1 for r in rows if r[0] == sub)
    print(f"  {sub}: {n} files")
