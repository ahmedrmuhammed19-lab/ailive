#!/usr/bin/env python3
"""NBE v4 Stage E — 900dpi PASS C on flagged rows only.

Crops the amount region (x 40-92%) of each flagged row's band at 900dpi,
psm 7/6, digits whitelist. Output: v4_rows_pC.json {i: [lines of vals]}
"""
import io, json, re

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"

fin = json.load(open(f"{WORK}/v4_final.json"))
flagged = [f["i"] for f in fin["flags"]]
rowsA = json.load(open(f"{WORK}/v4_rows.json"))
bands = {p: json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))["bands"] for p in range(1, 24)}

doc = fitz.open(PATH)


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
    m = re.fullmatch(r"(\d{4,9})\.(\d{2})", t)
    if m:
        return round(float(m.group(1) + "." + m.group(2)), 2)
    return None


def ocr_region(img, box, psm):
    crop = img.crop(box)
    cfg = f"--psm {psm} -c tessedit_char_whitelist=0123456789.,-"
    d = pytesseract.image_to_data(crop, lang="eng", config=cfg,
                                  output_type=pytesseract.Output.DICT)
    lines = {}
    for i in range(len(d["text"])):
        t = (d["text"][i] or "").strip()
        if not t:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        lines.setdefault(key, []).append((d["left"][i], t))
    out = []
    for key in sorted(lines, key=lambda k: min(x for x, _ in lines[k])):
        toks = [t for _, t in sorted(lines[key])]
        vals = [v for v in (parse_amt(t) for t in toks) if v is not None]
        if vals:
            out.append(vals)
    return out


outC = {}
for i in flagged:
    r = rowsA[i]
    p = r["page"]
    pm = doc[p - 1].get_pixmap(dpi=900, colorspace=fitz.csGRAY)
    img = Image.open(io.BytesIO(pm.tobytes("png")))
    W, H = img.size
    k = 900 / 150.0
    b = bands[p][r["band"]]
    box = (int(W * 0.40), max(0, int(b["y0_150"] * k) + 6),
           int(W * 0.92), min(H, int(b["y1_150"] * k) - 6))
    cands = ocr_region(img, box, 7) or ocr_region(img, box, 6)
    outC[i] = cands

json.dump(outC, open(f"{WORK}/v4_rows_pC.json", "w"))
resolved = sum(1 for v in outC.values() if v)
print(f"PASS C done: {resolved}/{len(flagged)} flagged rows produced candidates")
