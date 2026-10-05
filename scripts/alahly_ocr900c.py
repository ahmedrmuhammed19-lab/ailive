#!/usr/bin/env python3
"""900dpi credit-column pass: crop x band around the Credit column per page,
OCR digits, save tokens. Credit band defaults 2150-2650 @450 coords, widened
per page by detected balance position (balance_x - ~700)."""
import io
import json
import os
import re
import sys

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
WORK = "/home/z/my-project/scripts/alahly_work"
S = 450 / 72.0

first = int(sys.argv[1]) if len(sys.argv) > 1 else 1
last = int(sys.argv[2]) if len(sys.argv) > 2 else 23

doc = fitz.open(PATH)
for i in range(first - 1, min(last, len(doc))):
    out = f"{WORK}/p900c_{i+1:02d}.json"
    if os.path.exists(out):
        print(f"page {i+1}: cached", flush=True)
        continue
    page = doc[i]
    W = page.rect.width
    # find balance x from 450 data to anchor the credit band
    d450 = json.load(open(f"{WORK}/page_{i+1:02d}.json"))
    M = re.compile(r"^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$")

    def money(s):
        return bool(M.match(s))

    bxs = [w["x"] for w in d450["words"] if w["x"] > 2000 and money(w["t"])]
    bc = max(set(bxs), key=bxs.count) if bxs else 2890
    x0 = max(1500, bc - 820) / S
    x1 = (bc - 330) / S
    clip = fitz.Rect(x0, 0, min(x1, W), page.rect.height)
    pix = page.get_pixmap(dpi=900, clip=clip)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    tsv = pytesseract.image_to_data(
        img, lang="eng", config="--psm 6 -c tessedit_char_whitelist=0123456789.,",
        output_type=pytesseract.Output.DICT)
    words = []
    for j in range(len(tsv["text"])):
        t = tsv["text"][j].strip()
        if not t or not money(t) and not re.fullmatch(r"\d{1,7}", t):
            continue
        x450 = int((tsv["left"][j] / (900 / 72.0) + x0) * S)
        words.append({"x": x450, "y": int(tsv["top"][j] * (450 / 900.0)),
                      "t": t, "conf": tsv["conf"][j]})
    words = [w for w in words if w["conf"] > 30]
    json.dump({"page": i + 1, "words": words}, open(out, "w"), ensure_ascii=False)
    print(f"page {i+1}: {len(words)} credit-zone tokens (bal_x={bc})", flush=True)
print("DONE")
