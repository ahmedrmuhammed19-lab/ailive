#!/usr/bin/env python3
"""DL-27 — OCR the two Abdulrahman Ali statements (image-only scans).
Dollar: 2 pages, 1.8MB. Egyptian: 30 pages, 42MB.
Renders via fitz @300dpi, OCRs via tesseract CLI (psm 6), caches per page.
Re-runnable: cached pages are skipped. Progress printed with flush.
Usage: python3 scripts/abdl_ocr.py [dollar|egy|all] [dpi]"""
import io
import os
import sys
import time

import fitz
import pytesseract
from PIL import Image

UPLOAD = "/home/z/my-project/upload"
WORK = "/home/z/my-project/scripts/abdl_work"
JOBS = {
    "dollar": f"{UPLOAD}/Dollar Account Statement.pdf",
    "egy": f"{UPLOAD}/Egyptian Account Statement.pdf",
}

which = sys.argv[1] if len(sys.argv) > 1 else "all"
dpi = int(sys.argv[2]) if len(sys.argv) > 2 else 300

os.makedirs(WORK, exist_ok=True)

for key in JOBS:
    if which not in ("all", key):
        continue
    path = JOBS[key]
    doc = fitz.open(path)
    n = len(doc)
    print(f"[{key}] {path} pages={n} dpi={dpi}", flush=True)
    for i in range(n):
        out = f"{WORK}/{key}_p{i+1:02d}.txt"
        if os.path.exists(out) and os.path.getsize(out) > 20:
            print(f"  page {i+1:02d}: cached ({os.path.getsize(out)} bytes)", flush=True)
            continue
        t0 = time.time()
        pix = doc[i].get_pixmap(dpi=dpi)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        # psm 6 = uniform block of text (statement tables); eng only
        txt = pytesseract.image_to_string(img, lang="eng", config="--psm 6")
        with open(out, "w") as f:
            f.write(txt)
        dt = time.time() - t0
        print(f"  page {i+1:02d}: {len(txt)} chars in {dt:.1f}s", flush=True)
    doc.close()
    # combined text
    combined = f"{WORK}/{key}.txt"
    with open(combined, "w") as cf:
        for i in range(n):
            p = f"{WORK}/{key}_p{i+1:02d}.txt"
            if os.path.exists(p):
                cf.write(f"\n===== PAGE {i+1} =====\n")
                cf.write(open(p).read())
    print(f"[{key}] combined -> {combined}", flush=True)

print("OCR DONE", flush=True)
