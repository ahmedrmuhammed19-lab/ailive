#!/usr/bin/env python3
"""DL-4b: rebuild direct-download ZIP bundles from current download/ tree.
  1) GlobalEIS_BolaAyad_Reports_v12.zip   -> Bola x3 v1.2 reports (root copies, byte-verified vs public/)
  2) GlobalEIS_All_Files_2026-10-11.zip   -> full delivery tree (5 subdirs + MANIFEST.txt)
Bundles are written to public/ (git-tracked source of truth) and copied to download/ root."""
import shutil
import zipfile
from pathlib import Path

BASE = Path("/home/z/my-project")
DL = BASE / "download"
PUB = BASE / "public"

BOLA = [
    "GlobalEIS_Report_BolaAyad_Saving_EGP_382rows.html",
    "GlobalEIS_Report_BolaAyad_Current_EGP_18rows.html",
    "GlobalEIS_Report_BolaAyad_USD_44rows.html",
]
SUBDIRS = ["01_reports", "02_templates", "03_governance", "04_evidence", "05_legacy_task_files"]

# 1) Bola bundle
bola_zip = PUB / "GlobalEIS_BolaAyad_Reports_v12.zip"
with zipfile.ZipFile(bola_zip, "w", zipfile.ZIP_DEFLATED) as z:
    for fn in BOLA:
        z.write(DL / fn, arcname=fn)
shutil.copy2(bola_zip, DL / bola_zip.name)
print(f"OK {bola_zip.name}: {bola_zip.stat().st_size:,} B")

# 2) Full corpus bundle (subdirs + MANIFEST; flat root copies are duplicates -> excluded)
all_zip = PUB / "GlobalEIS_All_Files_2026-10-11.zip"
with zipfile.ZipFile(all_zip, "w", zipfile.ZIP_DEFLATED) as z:
    for sub in SUBDIRS:
        for src in sorted((DL / sub).iterdir()):
            if src.is_file():
                z.write(src, arcname=f"{sub}/{src.name}")
    z.write(DL / "MANIFEST.txt", arcname="MANIFEST.txt")
shutil.copy2(all_zip, DL / all_zip.name)
print(f"OK {all_zip.name}: {all_zip.stat().st_size:,} B")

# integrity check
for zp in (bola_zip, all_zip):
    bad = zipfile.ZipFile(zp).testzip()
    assert bad is None, f"CORRUPT member in {zp.name}: {bad}"
    n = len(zipfile.ZipFile(zp).namelist())
    print(f"   verified: {zp.name} -> {n} members, CRC OK")
