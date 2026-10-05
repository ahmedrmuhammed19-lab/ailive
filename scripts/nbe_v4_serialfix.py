#!/usr/bin/env python3
"""NBE v4 Stage A2 — SERIAL CELL RE-READ @600dpi (G1 evidence pass).

For EVERY tx/tx_nodate/cont_or_total band: crop the serial-cell region
(left 13% of the band) at 600dpi, OCR psm 7/8 with digit whitelist.
One consistent high-quality read per band replaces the 450dpi left-9%
heuristic — kills both missing serials and duplicate claims.

Output: scripts/alahly_work/v4_serials.json  {(page,idx): serial|null, ...}
"""
import io, json, os, re

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"

OUT = f"{WORK}/v4_serials.json"
if os.path.exists(OUT):
    have = json.load(open(OUT))
    print(f"cached {len(have)} serial reads")
    raise SystemExit

SER_RE = re.compile(r"^\D*?(\d{1,3})\D*$")

doc = fitz.open(PATH)
pages = {}
for p in range(1, 24):
    d = json.load(open(f"{WORK}/v4_bands_p{p:02d}.json"))
    pages[p] = d

# 600dpi renders cached per page
big_cache = {}
scale150to600 = 600 / 150.0

results = {}
for p in range(1, 24):
    if p not in big_cache:
        pm = doc[p - 1].get_pixmap(dpi=600, colorspace=fitz.csGRAY)
        big_cache[p] = Image.open(io.BytesIO(pm.tobytes("png")))
    bimg = big_cache[p]
    BW, BH = bimg.size
    for b in pages[p]["bands"]:
        if b["cls"] not in ("tx", "tx_nodate", "cont_or_total"):
            continue
        y0 = int(b["y0_150"] * scale150to600)
        y1 = int(b["y1_150"] * scale150to600)
        cell = bimg.crop((0, max(0, y0 + 4), int(BW * 0.13), min(BH, y1 - 4)))
        # upscale x2 + binarize for crisp digits
        cell = cell.resize((cell.width * 2, cell.height * 2), Image.LANCZOS)
        best = None
        for psm in (7, 8, 6):
            txt = pytesseract.image_to_string(
                cell, lang="eng",
                config=f"--psm {psm} -c tessedit_char_whitelist=0123456789",
            ).strip()
            m = SER_RE.match(txt)
            if m:
                v = int(m.group(1))
                if 1 <= v <= 499:
                    best = v
                    break
        results[f"{p}:{b['idx']}"] = best
    print(f"page {p}: serial cells read", flush=True)

json.dump(results, open(OUT, "w"))
got = sum(1 for v in results.values() if v is not None)
print(f"SERIAL RE-READ DONE: {got}/{len(results)} resolved")
