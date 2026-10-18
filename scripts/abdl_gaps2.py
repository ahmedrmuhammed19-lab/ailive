#!/usr/bin/env python3
"""DL-27 — Class-A sibling recovery: for every UNVERIFIED row in the fused
ledger, crop the FULL-WIDTH 900dpi span from the previous ledger row to this
row and OCR it (psm 6, no whitelist) — recover missing sibling rows with
dates + D/C/B by column geometry.
Input: fuse_{key}.json — Output: recover2_{key}.json
Usage: python3 scripts/abdl_gaps2.py <dollar|egy>"""
import io
import json
import os
import re
import sys

import fitz
import pytesseract
from PIL import Image

WORK = "/home/z/my-project/scripts/abdl_work"
UPLOAD = "/home/z/my-project/upload"
JOBS = {
    "dollar": f"{UPLOAD}/Dollar Account Statement.pdf",
    "egy": f"{UPLOAD}/Egyptian Account Statement.pdf",
}
AMT_RE = re.compile(r"^[\(]?[\d]{1,3}(?:,\d{3})*\.\d{2}[\)]?$|^[\d]{1,3}(?:,\d{3})*\.\d{2}$")
DATE_RE = re.compile(r"(\d{1,2}/\d{1,2}/\d{4})")
DPI = 900

key = sys.argv[1]
S = DPI / 450.0
fuse = json.load(open(f"{WORK}/fuse_{key}.json"))
ledger = fuse["ledger"]
bad_ys = {b["y"] for b in fuse["bad"]}
doc = fitz.open(JOBS[key])

def num(s):
    if not s:
        return None
    try:
        return float(str(s).replace(",", ""))
    except ValueError:
        return None

page_cache = {}
out = []
# for each unverified row, crop from its predecessor to it
for i in range(1, len(ledger)):
    if ledger[i]["y"] not in bad_ys:
        continue
    a, b = ledger[i - 1], ledger[i]
    if a["page"] != b["page"]:
        continue
    pno = a["page"]
    y0 = (a["y"] + 22) * S
    y1 = (b["y"] - 10) * S
    if y1 - y0 < 50:
        continue
    if pno not in page_cache:
        page_cache.clear()  # keep ONE 900dpi page in RAM (200MB each)
        pix = doc[pno - 1].get_pixmap(dpi=DPI)
        page_cache[pno] = Image.open(io.BytesIO(pix.tobytes("png")))
    img = page_cache[pno]
    fp = json.load(open(f"{WORK}/xrows_{key}_p{pno:02d}.json"))
    cols9 = [c * S for c in (fp.get("columns") or [])]
    if len(cols9) < 3:
        continue
    debC, credC, balC = cols9[-3], cols9[-2], cols9[-1]
    pw9 = fp["page_w"] * S
    crop = img.crop((0, int(y0), img.width, int(y1)))
    tsv = pytesseract.image_to_data(crop, lang="eng", config="--psm 6",
                                    output_type=pytesseract.Output.DICT)
    lines = {}
    for j in range(len(tsv["text"])):
        t = tsv["text"][j].strip()
        if not t:
            continue
        y = tsv["top"][j] + tsv["height"][j] / 2.0
        x = tsv["left"][j] + tsv["width"][j] / 2.0
        lines.setdefault(round(y / 40), []).append((t, x, y))
    found = 0
    for _, toks in sorted(lines.items()):
        amts = [(t, x) for t, x, _ in toks if AMT_RE.match(t)]
        dates = [DATE_RE.search(t).group(1) for t, _, _ in toks if DATE_RE.search(t)]
        if not amts:
            continue
        rec = {"page": pno, "y_anchor": b["y"],
               "y": round((y0 + sorted(toks, key=lambda w: w[2])[0][2]) / S, 1),
               "date": dates[0] if dates else b.get("date"), "desc": " ".join(t for t, _, _ in toks if not DATE_RE.search(t) and not AMT_RE.match(t))[:120],
               "debit": None, "credit": None, "balance": None}
        for t, x in amts:
            if abs(x - balC) < 0.035 * pw9:
                rec["balance"] = t
            elif abs(x - credC) < 0.035 * pw9:
                rec["credit"] = t
            elif abs(x - debC) < 0.035 * pw9:
                rec["debit"] = t
        if rec["balance"] and (rec["credit"] or rec["debit"]):
            out.append(rec)
            found += 1
    if found:
        print(f"p{pno} y{round(a['y'])}->y{round(b['y'])}: recovered {found}: {[(r['date'], r['debit'], r['credit'], r['balance']) for r in out[-found:]]}", flush=True)

doc.close()
with open(f"{WORK}/recover2_{key}.json", "w") as f:
    json.dump(out, f)
print(f"{key}: {len(out)} sibling rows recovered -> recover2_{key}.json", flush=True)
