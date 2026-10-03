#!/usr/bin/env python3
"""Cell-level amount OCR: tight per-row crop of the two amount columns at
600dpi with digit whitelist; votes among 300/450/600 readings. Cached per
page in scripts/wafa_work/cells/cells-<page>.json"""
import csv
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
from wafa_parse import try_amount, WORK  # noqa
from wafa_parse2 import parse_pass, PT, DEBIT_X_PT  # noqa


def ocr_cells_for_page(pno, rows450, rows300):
    png = f"{WORK}/c600-{pno:02d}.png"
    if not os.path.exists(png):
        png = f"{WORK}/c600-{pno}.png"
    from PIL import Image
    img = Image.open(png)
    W, H = img.size
    s = 600 / 450.0
    crop_x0 = int(410 * 600 / PT)          # strip origin in full-image px (410pt < debit col start ~419pt)
    bx_strip = (DEBIT_X_PT * (600 / PT) - crop_x0) * 2  # boundary in 2x-upscaled strip coords
    out = []
    for r in rows450:
        if r["page"] != pno:
            continue
        y0 = max(0, int(r["top"] * s) - 4)
        y1 = min(H, int((r["top"] + r["h"]) * s) + 4)
        strip = img.crop((crop_x0, y0, W, y1))
        strip = strip.resize((strip.width * 2, strip.height * 2), 1)
        with tempfile.NamedTemporaryFile(suffix=".png", dir=WORK, delete=False) as f:
            strip.save(f.name)
            tmp = f.name
        try:
            subprocess.run(["tesseract", tmp, tmp[:-4], "--psm", "7",
                            "-c", "tessedit_char_whitelist=0123456789.,",
                            "tsv"], capture_output=True, timeout=90)
            words = []
            for rr in csv.DictReader(open(tmp[:-4] + ".tsv"), delimiter="\t", quoting=csv.QUOTE_NONE):
                t = (rr["text"] or "").strip()
                if t and float(rr["conf"]) >= 0:
                    words.append([int(rr["left"]) + int(rr["width"]) // 2, t])
        finally:
            for ext in (".png", ".tsv", ".txt"):
                try:
                    os.remove(tmp[:-4] + ext)
                except OSError:
                    pass
        out.append({"page": pno, "date": r["date"], "words": words,
                    "desc": r["desc"][:60], "d450": r["debit"], "c450": r["credit"]})
    return out


def main():
    lo = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    hi = int(sys.argv[2]) if len(sys.argv) > 2 else 48
    os.makedirs(f"{WORK}/cells", exist_ok=True)
    r450, _, _ = parse_pass(f"{WORK}/hi2-*.tsv", 450, "hi2")
    for pno in range(lo, hi + 1):
        outp = f"{WORK}/cells/cells-{pno:02d}.json"
        if os.path.exists(outp):
            continue
        rows = ocr_cells_for_page(pno, r450, None)
        json.dump(rows, open(outp, "w"))
        print(f"page {pno:02d}: {len(rows)} cells", flush=True)


if __name__ == "__main__":
    main()
