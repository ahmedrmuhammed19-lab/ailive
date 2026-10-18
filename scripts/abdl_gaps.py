#!/usr/bin/env python3
"""DL-27 — gap-directed recovery. Wherever the fused ledger doesn't chain
(next.balance != prev.balance + credit - debit), crop that y-zone at 900dpi
(numeric band, digit whitelist) and harvest the missing row(s).
Input: fuse_{key}.json (from abdl_fuse5.ts) — Output: recover_{key}.json
Usage: python3 scripts/abdl_gaps.py <dollar|egy>"""
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
doc = fitz.open(JOBS[key])

def r2(n):
    return round(n * 100) / 100

def num(s):
    if not s:
        return None
    v = float(s.replace(",", ""))
    return v

recs = []
page_cache = {}
for i in range(len(ledger) - 1):
    a, b = ledger[i], ledger[i + 1]
    bal_a = num(a.get("balance"))
    bal_b = num(b.get("balance"))
    if bal_a is None or bal_b is None:
        continue
    c = num(a.get("credit")) or 0
    d = num(a.get("debit")) or 0
    expected = r2(bal_a + c - d)
    if abs(expected - bal_b) < 0.015:
        continue  # chains fine
    # chain broken between a and b — scan the zone
    if a["page"] != b["page"]:
        continue  # page boundary: closing-position rows, skip
    y0 = (a["y"] + 24) * S
    y1 = (b["y"] - 24) * S
    if y1 - y0 < 40:
        continue
    pno = a["page"]
    if pno not in page_cache:
        pix = doc[pno - 1].get_pixmap(dpi=DPI)
        page_cache[pno] = Image.open(io.BytesIO(pix.tobytes("png")))
    img = page_cache[pno]
    fp = json.load(open(f"{WORK}/xrows_{key}_p{pno:02d}.json"))
    cols9 = [c * S for c in (fp.get("columns") or [])]
    if len(cols9) < 3:
        continue
    debC, credC, balC = cols9[-3], cols9[-2], cols9[-1]
    pw9 = fp["page_w"] * S
    crop = img.crop((int(0.28 * img.width), int(y0), img.width, int(y1)))
    # line-level OCR
    tsv = pytesseract.image_to_data(
        crop, lang="eng", config="--psm 6 -c tessedit_char_whitelist=0123456789.,/",
        output_type=pytesseract.Output.DICT)
    lines = {}
    for j in range(len(tsv["text"])):
        t = tsv["text"][j].strip()
        if not t:
            continue
        y = tsv["top"][j] + tsv["height"][j] / 2.0
        x = tsv["left"][j] + tsv["width"][j] / 2.0 + int(0.28 * img.width)
        lines.setdefault(round(y / 30), []).append((t, x, y))
    found = 0
    for _, toks in sorted(lines.items()):
        amts = [(t, x) for t, x, _ in toks if AMT_RE.match(t)]
        dates = [DATE_RE.search(t).group(1) for t, _, _ in toks if DATE_RE.search(t)]
        if not amts:
            continue
        rec = {"page": pno, "y": round((y0 + toks[0][2]) / S, 1),
               "date": dates[0] if dates else None,
               "debit": None, "credit": None, "balance": None}
        for t, x in amts:
            if abs(x - balC) < 0.035 * pw9:
                rec["balance"] = t
            elif abs(x - credC) < 0.035 * pw9:
                rec["credit"] = t
            elif abs(x - debC) < 0.035 * pw9:
                rec["debit"] = t
        if rec["balance"] or rec["credit"] or rec["debit"]:
            recs.append(rec)
            found += 1
    print(f"gap after ledger#{i} (p{pno} y{round(a['y'])}->y{round(b['y'])}): {found} recovered row(s)", flush=True)

doc.close()
with open(f"{WORK}/recover_{key}.json", "w") as f:
    json.dump(recs, f)
print(f"{key}: {len(recs)} recovered candidate rows -> recover_{key}.json", flush=True)
