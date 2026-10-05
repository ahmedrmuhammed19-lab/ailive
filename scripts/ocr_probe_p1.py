#!/usr/bin/env python3
"""OCR probe: render page 1 at 300dpi, try eng OCR, dump lines."""
import fitz, pytesseract
from PIL import Image
import io

PATH = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
doc = fitz.open(PATH)
page = doc[0]
pix = page.get_pixmap(dpi=300)
img = Image.open(io.BytesIO(pix.tobytes("png")))
print(f"rendered {img.size}")
txt = pytesseract.image_to_string(img, lang="eng", config="--psm 6")
lines = [l.rstrip() for l in txt.splitlines() if l.strip()]
print(f"lines={len(lines)}")
for l in lines:
    print("|", l[:150])
