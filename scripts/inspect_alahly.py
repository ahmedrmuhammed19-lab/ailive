#!/usr/bin/env python3
"""Inspect the Al Ahly statement PDF: pages, text layer, samples, balance columns."""
import sys
import fitz

PATH = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"

doc = fitz.open(PATH)
print(f"pages={len(doc)}  encrypted={doc.is_encrypted}")
total_chars = 0
for i, page in enumerate(doc):
    txt = page.get_text("text")
    total_chars += len(txt.strip())
    if i < 3:
        print(f"--- page {i+1}: rect={page.rect.width:.0f}x{page.rect.height:.0f} chars={len(txt.strip())} images={len(page.get_images())}")
        lines = [l.strip() for l in txt.splitlines() if l.strip()]
        for l in lines[:14]:
            print("   |", l[:110])
print(f"TOTAL_TEXT_CHARS={total_chars}")
