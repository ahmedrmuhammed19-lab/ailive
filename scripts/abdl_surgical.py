#!/usr/bin/env python3
"""DL-27 — surgical 900dpi per-line re-OCR of every ledger row (Al Ahly 900c
lineage). For each tx row y from the full pass: crop the numeric band at 900dpi
(x >= 28%, y +/- 44px), OCR with digit whitelist + psm 7, classify tokens into
Debit/Credit/Balance by x (columns scaled x2 from the 450-space centers).
Output: scripts/abdl_work/patch_{key}.json  [{page, y, debit, credit, balance}]
Usage: python3 scripts/abdl_surgical.py <dollar|egy> [first] [last]"""
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

key = sys.argv[1]
first = int(sys.argv[2]) if len(sys.argv) > 2 else 1
last = int(sys.argv[3]) if len(sys.argv) > 3 else 9999
DPI = 900
S = DPI / 450.0

doc = fitz.open(JOBS[key])
patches = []
for i in range(len(doc)):
    pno = i + 1
    if pno < first or pno > last:
        continue
    fp_path = f"{WORK}/xrows_{key}_p{pno:02d}.json"
    if not os.path.exists(fp_path):
        continue
    fp = json.load(open(fp_path))
    cols = fp.get("columns") or []
    if len(cols) < 3:
        print(f"page {pno:02d}: skipped (cols={len(cols)})", flush=True)
        continue
    cols9 = [c * S for c in cols]
    pw9 = fp["page_w"] * S
    debC, credC, balC = cols9[-3], cols9[-2], cols9[-1]
    pix = doc[i].get_pixmap(dpi=DPI)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    for r in fp.get("rows", []):
        if not r.get("date"):
            continue
        y9 = r["y"] * S
        crop = img.crop((int(0.28 * img.width), max(0, int(y9 - 46)), img.width, min(img.height, int(y9 + 46))))
        tsv = pytesseract.image_to_data(
            crop, lang="eng", config="--psm 7 -c tessedit_char_whitelist=0123456789.,",
            output_type=pytesseract.Output.DICT)
        toks = []
        for j in range(len(tsv["text"])):
            t = tsv["text"][j].strip().rstrip(".")
            if not t or not AMT_RE.match(t):
                continue
            x = tsv["left"][j] + tsv["width"][j] / 2.0 + int(0.28 * img.width)
            toks.append((t, x))
        rec = {"page": pno, "y": r["y"], "date": r["date"],
               "debit": None, "credit": None, "balance": None}
        for t, x in toks:
            if abs(x - balC) < 0.035 * pw9:
                rec["balance"] = t
            elif abs(x - credC) < 0.035 * pw9:
                rec["credit"] = t
            elif abs(x - debC) < 0.035 * pw9:
                rec["debit"] = t
            else:
                # stray token: closest column wins
                d = min(abs(x - debC), abs(x - credC), abs(x - balC))
                if d < 0.06 * pw9:
                    if d == abs(x - balC):
                        rec["balance"] = rec["balance"] or t
                    elif d == abs(x - credC):
                        rec["credit"] = rec["credit"] or t
                    else:
                        rec["debit"] = rec["debit"] or t
        patches.append(rec)
    print(f"page {pno:02d}: patched {sum(1 for p in patches if p['page']==pno)}", flush=True)
doc.close()
with open(f"{WORK}/patch_{key}.json", "w") as f:
    json.dump(patches, f)
print(f"{key}: {len(patches)} surgical patches -> patch_{key}.json", flush=True)
