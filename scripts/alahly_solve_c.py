#!/usr/bin/env python3
"""Phase C — cell-level 1200dpi reconstruction of affected pages.
For each date-anchored row: crop amount cell + balance cell, OCR with digit
whitelist (psm 7). Output: clean per-page row tables -> cells_pages.json"""
import json
import os
import re
import subprocess
from PIL import Image

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveC"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
os.makedirs(OUT, exist_ok=True)

PAGES = [3, 4, 9, 10, 13, 16, 17, 18, 20]
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
MONEY = re.compile(r"^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^-?\d+[.,]\d{2}$")

# 1200dpi column windows (x)
AMT_X = (4450, 5800)
BAL_X = (7150, 8250)
DATE_X_MIN, DATE_X_MAX = 850, 1500  # movement-date column band


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s or "")
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    neg = (s or "").startswith("-")
    return float(f"{'-' if neg else ''}{ip}.{m.group(2)}")


def ocr_cell(img, x0, y0, x1, y1, tag):
    cell = img.crop((x0, y0, x1, y1))
    # upscale x2 for tiny numbers
    cell = cell.resize((cell.width * 2, cell.height * 2), Image.LANCZOS)
    p = f"{OUT}/{tag}.png"
    cell.save(p)
    r = subprocess.run(["tesseract", p, p[:-4], "--psm", "7",
                        "-c", "tessedit_char_whitelist=0123456789.,-"],
                       capture_output=True, text=True)
    txt = ""
    try:
        txt = open(p[:-4] + ".txt").read().strip()
    except FileNotFoundError:
        pass
    return txt


result = {}
for page in PAGES:
    png = f"{OUT}/full_p{page:02d}"
    actual_png = f"{png}-{page:02d}.png"
    if not os.path.exists(actual_png):
        subprocess.run(["pdftoppm", "-r", "1200", "-gray", "-f", str(page),
                        "-l", str(page), "-png", PDF, png], check=True)
    img = Image.open(actual_png)
    tsv = png + ".tsv"
    if not os.path.exists(tsv):
        subprocess.run(["tesseract", actual_png, png, "--psm", "6", "tsv"],
                       capture_output=True, check=True)
    words = []
    with open(tsv) as fh:
        next(fh)
        for line in fh:
            c = line.rstrip("\n").split("\t")
            if len(c) < 12 or not c[11].strip():
                continue
            words.append({"l": int(c[6]), "t": int(c[7]), "w": int(c[8]),
                          "h": int(c[9]), "conf": float(c[10]), "x": c[11]})
    # date anchors in movement-date column
    dates = [w for w in words if DATE_RE.match(w["x"]) and DATE_X_MIN <= w["l"] < DATE_X_MAX
             and w["conf"] > 30]
    dates.sort(key=lambda w: w["t"])
    # dedupe near-identical y (psm6 double-reads)
    anchors = []
    for d in dates:
        if anchors and abs(d["t"] - anchors[-1]["t"]) < 90:
            continue
        anchors.append(d)
    rows = []
    for i, d in enumerate(anchors):
        y0 = d["t"] - 50
        y1 = d["t"] + d["h"] + 60
        amt_txt = ocr_cell(img, AMT_X[0], y0, AMT_X[1], y1, f"p{page}_r{i:02d}_amt")
        bal_txt = ocr_cell(img, BAL_X[0], y0, BAL_X[1], y1, f"p{page}_r{i:02d}_bal")
        # desc: words between date col and amount col on same line band
        descs = [w["x"] for w in words
                 if DATE_X_MAX < w["l"] < AMT_X[0] and -40 < (w["t"] - d["t"]) < 120]
        ref = next((w["x"] for w in words
                    if DATE_X_MAX < w["l"] < 3200 and DATE_X_MAX < w["l"]
                    and -40 < (w["t"] - d["t"]) < 120 and re.match(r"^244", w["x"])), "")
        rows.append({"i": i, "date": d["x"], "y1200": d["t"], "ref": ref,
                     "amt_txt": amt_txt, "bal_txt": bal_txt,
                     "amt": fnum(amt_txt), "bal": fnum(bal_txt),
                     "desc": " ".join(descs)[:70]})
    result[page] = rows
    print(f"\n===== PAGE {page}: {len(rows)} date-anchored rows =====")
    for r in rows:
        print(f"  r{r['i']:02d} y={r['y1200']:5d} [{r['date']}] ref={r['ref'][:22]:22s} "
              f"amt={r['amt_txt']!r:16s}->{r['amt']} bal={r['bal_txt']!r:16s}->{r['bal']}")

json.dump(result, open(f"{OUT}/cells_pages.json", "w"), ensure_ascii=False, indent=1)
print("\nWROTE cells_pages.json")
