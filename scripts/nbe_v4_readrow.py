#!/usr/bin/env python3
"""Render individual flagged-row bands at 450dpi full width for visual reads.
Usage: python3 scripts/nbe_v4_readrow.py i1 [i2 ...]   (row indices into v4_final flags)
Output: scripts/alahly_work/adj2/row_<i>.png  (450dpi band crop, full width)
"""
import io
import json
import sys

import fitz
from PIL import Image

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"

flags = json.load(open(f"{WORK}/v4_final.json"))["flags"]
by_i = {f["i"]: f for f in flags}
lines_by_page = {}
for p in range(1, 24):
    lines_by_page[p] = json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))["bands"]

doc = fitz.open(PATH)
page_cache = {}


def page_img(p):
    if p not in page_cache:
        pm = doc[p - 1].get_pixmap(dpi=450, colorspace=fitz.csGRAY)
        page_cache[p] = Image.open(io.BytesIO(pm.tobytes("png")))
    return page_cache[p]


for arg in sys.argv[1:]:
    i = int(arg)
    f = by_i[i]
    p, band = f["page"], f["band"]
    b = lines_by_page[p][band]
    img = page_img(p)
    k = 3.0  # 150->450
    y0 = max(0, int(b["y0_150"] * k) - 6)
    y1 = min(img.size[1], int(b["y1_150"] * k) + 6)
    crop = img.crop((0, y0, img.size[0], y1))
    out = f"{WORK}/adj2/row_{i:03d}.png"
    crop.save(out)
    print(f"row {i} -> {out}  ({crop.size[0]}x{crop.size[1]})")
