#!/usr/bin/env python3
"""Targeted re-OCR of a page region at 600 dpi, full width, psm 4.
Usage: python3 scripts/alahly_region.py <page> <y0> <y1>   (450dpi coords)"""
import sys

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"

pno, y0, y1 = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
S = 450 / 72.0
doc = fitz.open(PATH)
page = doc[pno - 1]
clip = fitz.Rect(0, y0 / S, page.rect.width, y1 / S)
pix = page.get_pixmap(dpi=600, clip=clip)
img = Image.open(io_bytes(pix)) if False else Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
txt = pytesseract.image_to_string(img, lang="eng", config="--psm 4")
for l in txt.splitlines():
    if l.strip():
        print("|", l.rstrip()[:150])
