#!/usr/bin/env python3
"""Chunked OCR of the NBE statement @ 450 dpi (text + TSV words), per-page JSON.
Usage: python3 scripts/alahly_ocr.py <first_page> <last_page>"""
import io
import json
import os
import sys

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
WORK = "/home/z/my-project/scripts/alahly_work"
os.makedirs(WORK, exist_ok=True)

first = int(sys.argv[1]) if len(sys.argv) > 1 else 1
last = int(sys.argv[2]) if len(sys.argv) > 2 else 23

doc = fitz.open(PATH)
for i in range(first - 1, min(last, len(doc))):
    out = f"{WORK}/page_{i+1:02d}.json"
    if os.path.exists(out):
        print(f"page {i+1}: cached", flush=True)
        continue
    pix = doc[i].get_pixmap(dpi=450)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    txt = pytesseract.image_to_string(img, lang="eng", config="--psm 6")
    tsv = pytesseract.image_to_data(img, lang="eng", config="--psm 6",
                                    output_type=pytesseract.Output.DICT)
    words = []
    for j in range(len(tsv["text"])):
        w = tsv["text"][j].strip()
        if not w:
            continue
        words.append({"x": tsv["left"][j], "y": tsv["top"][j],
                      "w": tsv["width"][j], "h": tsv["height"][j],
                      "conf": tsv["conf"][j], "t": w})
    with open(out, "w", encoding="utf8") as fh:
        json.dump({"page": i + 1, "text": txt, "words": words}, fh, ensure_ascii=False)
    print(f"page {i+1}: {len(words)} words", flush=True)
print("CHUNK DONE")
