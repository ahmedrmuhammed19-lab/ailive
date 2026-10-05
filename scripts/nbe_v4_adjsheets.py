#!/usr/bin/env python3
"""NBE v4 Stage F — VISUAL ADJUDICATION SHEETS.

Render every flagged row's FULL band (450dpi strip, full width) into
stacked composite sheets (max 6 bands per sheet, 300px label bar above
each) so the operator (or the agent's own vision) can read the printed
amounts directly. Sheets: scripts/alahly_work/adj/sheet_NN.png
Also writes adj/manifest.json (which i on which sheet at which slot).
"""
import json, os

import fitz
from PIL import Image, ImageDraw

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"
ADJ = f"{WORK}/adj"
os.makedirs(ADJ, exist_ok=True)

fin = json.load(open(f"{WORK}/v4_final.json"))
rowsA = json.load(open(f"{WORK}/v4_rows.json"))
bands = {p: json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))["bands"] for p in range(1, 24)}

doc = fitz.open(PATH)
page_cache = {}


def page_img(p):
    if p not in page_cache:
        pm = doc[p - 1].get_pixmap(dpi=450, colorspace=fitz.csGRAY)
        page_cache[p] = Image.open(io.BytesIO(pm.tobytes("png")))
    return page_cache[p]


import io
flags = fin["flags"]
SHEET_H = 900
items = []
for f in flags:
    r = rowsA[f["i"]]
    items.append((f["i"], r["page"], r["band"], f["why"][:70]))

sheets = []
cur = []
for it in items:
    cur.append(it)
    if len(cur) == 6:
        sheets.append(cur)
        cur = []
if cur:
    sheets.append(cur)

manifest = []
for si, group in enumerate(sheets):
    strips = []
    for i, p, band, why in group:
        img = page_img(p)
        W, H = img.size
        k = 450 / 150.0
        b = bands[p][band]
        y0 = max(0, int(b["y0_150"] * k) - 6)
        y1 = min(H, int(b["y1_150"] * k) + 6)
        crop = img.crop((0, y0, W, y1))
        label = Image.new("L", (crop.width, 70), 255)
        d = ImageDraw.Draw(label)
        d.text((10, 20), f"i={i} page={p} band={band} {why}", fill=0)
        strips.append((i, label, crop))
    W = max(s[2].width for s in strips)
    H = sum(70 + s[2].height + 10 for s in strips)
    sheet = Image.new("L", (W, H), 255)
    y = 0
    for i, label, crop in strips:
        sheet.paste(label, (0, y))
        sheet.paste(crop, (0, y + 70))
        manifest.append({"i": i, "sheet": si, "y": y + 70})
        y += 70 + crop.height + 10
    sheet.save(f"{ADJ}/sheet_{si:02d}.png")

json.dump(manifest, open(f"{ADJ}/manifest.json", "w"))
print(f"adjudication sheets: {len(sheets)} for {len(items)} flagged rows -> {ADJ}/")
