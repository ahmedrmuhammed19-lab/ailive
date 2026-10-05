#!/usr/bin/env python3
"""NBE v4 Stage C — TWO-PASS AMOUNT VERIFICATION + SPECIAL PRINT READS.

Pass B: every logical row's amount region (x 40-92%) re-read at 600dpi
(independent of the 450dpi Pass A). Agreement -> confirmed; disagreement
-> 900dpi arbiter (3 votes: A, B, C). This implements G7 (two-pass) and
repairs Pass A OCR noise.

Special print reads (G4 evidence):
  - p23 Totals band   -> printed D/C totals
  - p23 balances band -> Current / Available / Hold (settles the 200,020
    hold question with print evidence, not identity derivation)

Outputs: v4_rows_pB.json (per-row passB amounts), v4_special.json
"""
import io, json, re

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"

X0, X1 = 0.40, 0.92


def parse_amt(tok):
    t = tok.strip().strip("|[]()«»\"'=—-~.,_;")
    m = re.fullmatch(r"(\d{1,3}(?:,\d{3})*)[.,](\d{2})", t)
    if m:
        return round(float(m.group(1).replace(",", "") + "." + m.group(2)), 2)
    m = re.fullmatch(r"(\d{1,3}(?:\.\d{3})+),(\d{2})", t)
    if m:
        return round(float(m.group(1).replace(".", "") + "." + m.group(2)), 2)
    m = re.fullmatch(r"(\d{1,3}(?:,\d{3})+)", t)
    if m:
        return round(float(m.group(1).replace(",", "")), 2)
    m = re.fullmatch(r"(\d{7,9})\.(\d{2})", t)  # merged-digit totals e.g. 134182435
    if m:
        return round(float(m.group(1) + "." + m.group(2)), 2)
    return None


def ocr_region(img, W, box, psm, whitelist="0123456789.,-"):
    crop = img.crop(box)
    cfg = f"--psm {psm} -c tessedit_char_whitelist={whitelist}"
    d = pytesseract.image_to_data(crop, lang="eng", config=cfg,
                                  output_type=pytesseract.Output.DICT)
    lines = {}
    n = len(d["text"])
    for i in range(n):
        t = (d["text"][i] or "").strip()
        if not t:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        lines.setdefault(key, []).append((d["left"][i], t))
    out = []
    for key in sorted(lines, key=lambda k: min(x for x, _ in lines[k])):
        toks = [t for _, t in sorted(lines[key])]
        vals = [parse_amt(t) for t in toks]
        vals = [v for v in vals if v is not None]
        if vals:
            out.append(vals)
    return out


rows = json.load(open(f"{WORK}/v4_rows.json"))
bands = {p: json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))["bands"] for p in range(1, 24)}

doc = fitz.open(PATH)
r600, r900 = {}, {}
for p in range(1, 24):
    pm = doc[p - 1].get_pixmap(dpi=600, colorspace=fitz.csGRAY)
    r600[p] = Image.open(io.BytesIO(pm.tobytes("png")))

passB = {}
for i, r in enumerate(rows):
    p = r["page"]
    b = bands[p][r["band"]]
    img = r600[p]
    W, H = img.size
    k = 600 / 150.0
    box = (int(W * X0), max(0, int(b["y0_150"] * k) + 4),
           int(W * X1), min(H, int(b["y1_150"] * k) - 4))
    cands = ocr_region(img, W, box, 7)
    if not cands:
        cands = ocr_region(img, W, box, 6)
    passB[i] = cands
    if i % 100 == 0:
        print(f"passB {i}/{len(rows)}", flush=True)

json.dump(passB, open(f"{WORK}/v4_rows_pB.json", "w"))

# ---- special reads at 900dpi
special = {}
pm = doc[22].get_pixmap(dpi=900, colorspace=fitz.csGRAY)
img9 = Image.open(io.BytesIO(pm.tobytes("png")))
W9, H9 = img9.size
k9 = 900 / 150.0
b3 = bands[23][3]
special["totals_p23_b3"] = ocr_region(
    img9, W9, (int(W9 * 0.10), int(b3["y0_150"] * k9) + 8,
               int(W9 * 0.95), int(b3["y1_150"] * k9) - 8), 7)
b6 = bands[23][6]
special["balances_p23_b6"] = ocr_region(
    img9, W9, (int(W9 * 0.05), int(b6["y0_150"] * k9) + 8,
               int(W9 * 0.98), int(b6["y1_150"] * k9) - 8), 6)
json.dump(special, open(f"{WORK}/v4_special.json", "w"), indent=1)
print("SPECIAL READS:")
print(json.dumps(special, indent=1))
