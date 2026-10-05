#!/usr/bin/env python3
"""600 dpi re-OCR of the numeric band (right part of the table) per page.
Saves words with x mapped to the 450-dpi full-page coordinate system.
Usage: python3 scripts/alahly_ocr600.py <first> <last>"""
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
S600 = 600 / 72.0
S450 = 450 / 72.0

first = int(sys.argv[1]) if len(sys.argv) > 1 else 1
last = int(sys.argv[2]) if len(sys.argv) > 2 else 23

doc = fitz.open(PATH)
for i in range(first - 1, min(last, len(doc))):
    out = f"{WORK}/p600_{i+1:02d}.json"
    if os.path.exists(out):
        print(f"page {i+1}: cached", flush=True)
        continue
    page = doc[i]
    W = page.rect.width
    x0 = W * 0.36  # crop from 36% width (catches all amounts/balances)
    clip = fitz.Rect(x0, 0, W, page.rect.height)
    pix = page.get_pixmap(dpi=600, clip=clip)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    tsv = pytesseract.image_to_data(
        img, lang="eng", config="--psm 6 -c tessedit_char_whitelist=0123456789.,-|",
        output_type=pytesseract.Output.DICT)
    words = []
    for j in range(len(tsv["text"])):
        t = tsv["text"][j].strip()
        if not t or not re.fullmatch(r"[-|\d][\d.,|-]*", t):
            continue
        x450 = int((tsv["left"][j] / S600 + x0) * S450)
        words.append({
            "x": x450, "y": int(tsv["top"][j] * (450 / 600.0)),
            "w": int(tsv["width"][j] * (450 / 600.0)),
            "h": int(tsv["height"][j] * (450 / 600.0)),
            "conf": tsv["conf"][j], "t": t,
        })
    with open(out, "w", encoding="utf8") as fh:
        json.dump({"page": i + 1, "words": words}, fh, ensure_ascii=False)
    print(f"page {i+1}: {len(words)} numeric words", flush=True)
print("CHUNK DONE")
