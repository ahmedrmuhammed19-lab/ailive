#!/usr/bin/env python3
"""Compose compact adjudication sheets: right columns (serial|amounts|balance)
of every flagged row, stacked with row-index labels. ~20 rows per sheet.
Output: scripts/alahly_work/adj2/evidence_0.png ..."""
import json

import fitz
import io
from PIL import Image, ImageDraw

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"

flags = json.load(open(f"{WORK}/v4_final.json"))["flags"]
lines_by_page = {p: json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))["bands"]
                 for p in range(1, 24)}
doc = fitz.open(PATH)
pc = {}


def page_img(p):
    if p not in pc:
        pm = doc[p - 1].get_pixmap(dpi=450, colorspace=fitz.csGRAY)
        pc[p] = Image.open(io.BytesIO(pm.tobytes("png")))
    return pc[p]


LABEL_W = 150
COL_W = 1670  # x 2050..3719 -> serial through value date
ROW_H = 120
PER = 20
groups = [flags[k:k + PER] for k in range(0, len(flags), PER)]
for gi, group in enumerate(groups):
    sheet = Image.new("L", (LABEL_W + COL_W, len(group) * (ROW_H + 6)), 255)
    dr = ImageDraw.Draw(sheet)
    y = 0
    for f in group:
        i, p, band = f["i"], f["page"], f["band"]
        b = lines_by_page[p][band]
        img = page_img(p)
        k = 3.0
        y0 = max(0, int(b["y0_150"] * k) - 4)
        y1 = min(img.size[1], int(b["y1_150"] * k) + 4)
        crop = img.crop((0, y0, img.size[0], y1))
        # serial zone + amount/balance zone side by side
        serial = crop.crop((150, 0, 560, crop.size[1]))
        right = crop.crop((2050, 0, 3719, crop.size[1]))
        cell = Image.new("L", (COL_W, ROW_H), 255)
        sh = serial.size[1]
        cell.paste(serial.resize((int(410 * sh / max(sh, 1)) or 410, ROW_H - 4)
                                 if sh else (410, ROW_H - 4)), (0, 2))
        rh = right.size[1]
        rw = max(1, int(right.size[0] * (ROW_H - 4) / rh))
        cell.paste(right.resize((min(rw, COL_W - 420), ROW_H - 4)), (420, 2))
        sheet.paste(cell, (LABEL_W, y))
        dr.rectangle([0, y, LABEL_W - 2, y + ROW_H], fill=255, outline=0)
        dr.text((10, y + ROW_H // 2 - 14), f"i={i}", fill=0)
        dr.text((10, y + ROW_H // 2 + 6), f"p{p}b{band}", fill=60)
        y += ROW_H + 6
    out = f"{WORK}/adj2/evidence_{gi}.png"
    sheet.save(out)
    print(out, sheet.size)
