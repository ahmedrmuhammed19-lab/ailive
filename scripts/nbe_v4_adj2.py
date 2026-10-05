#!/usr/bin/env python3
"""NBE v4 Stage F2 — FOCUSED ADJUDICATION SHEETS (sharp).

Per flagged row, side-by-side crops at 600dpi:
  [serial+date chip x0-16%]  [amount zone x50-97%]
Stacked 7 rows per sheet with i= labels. Sheets: adj2/sheet_NN.png
"""
import io, json, os

import fitz
from PIL import Image, ImageDraw

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"
ADJ = f"{WORK}/adj2"
os.makedirs(ADJ, exist_ok=True)

fin = json.load(open(f"{WORK}/v4_final.json"))
rowsA = json.load(open(f"{WORK}/v4_rows.json"))
bands = {p: json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))["bands"] for p in range(1, 24)}

doc = fitz.open(PATH)
cache = {}


def page_img(p):
    if p not in cache:
        pm = doc[p - 1].get_pixmap(dpi=600, colorspace=fitz.csGRAY)
        cache[p] = Image.open(io.BytesIO(pm.tobytes("png")))
    return cache[p]


flags = fin["flags"]
groups = [flags[i:i + 7] for i in range(0, len(flags), 7)]
manifest = []
for si, group in enumerate(groups):
    strips = []
    Wtot = 0
    Htot = 0
    for f in group:
        i = f["i"]
        r = rowsA[i]
        p = r["page"]
        img = page_img(p)
        W, H = img.size
        k = 600 / 150.0
        b = bands[p][r["band"]]
        y0 = max(0, int(b["y0_150"] * k) + 2)
        y1 = min(H, int(b["y1_150"] * k) - 2)
        left = img.crop((0, y0, int(W * 0.16), y1))
        right = img.crop((int(W * 0.50), y0, int(W * 0.97), y1))
        hmax = max(left.height, right.height)
        label = Image.new("L", (left.width + right.width + 20, 46), 255)
        d = ImageDraw.Draw(label)
        d.text((8, 14), f"i={i} p{p} prev_flag={f['why'][:60]}", fill=0)
        row = Image.new("L", (left.width + right.width + 20, hmax + 50), 255)
        row.paste(label, (0, 0))
        row.paste(left, (0, 46))
        row.paste(right, (left.width + 20, 46))
        strips.append(row)
    W = max(s.width for s in strips)
    H = sum(s.height + 8 for s in strips)
    sheet = Image.new("L", (W, H), 255)
    y = 0
    for s in strips:
        sheet.paste(s, (0, y))
        y += s.height + 8
    sheet.save(f"{ADJ}/sheet_{si:02d}.png")
    for f in group:
        manifest.append({"i": f["i"], "sheet": si})
    print(f"sheet {si}: {len(group)} rows, {W}x{H}")

json.dump(manifest, open(f"{ADJ}/manifest.json", "w"))
print(f"FOCUSED SHEETS: {len(groups)}")
