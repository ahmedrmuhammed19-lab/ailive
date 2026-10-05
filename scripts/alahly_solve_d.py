#!/usr/bin/env python3
"""Phase C4b — surgical 2400dpi cell crops via pdftoppm -x-y-W-H (low memory)."""
import os
import re
import subprocess

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveD"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
os.makedirs(OUT, exist_ok=True)

TARGETS = [
    (9, 10106, "p9_r17_fee300"),
    (9, 10502, "p9_r18_3000"),
    (9, 8576, "p9_r14_9800"),
    (10, 2772, "p10_r00_top"),
    (10, 3156, "p10_r00_sub"),
    (10, 3972, "p10_r01_bal1"),
    (10, 4411, "p10_r01_bal2"),
    (10, 4900, "p10_r01_bal3"),
    (10, 5340, "p10_r01_bal4"),
    (10, 5748, "p10_r01_bal5"),
    (10, 6146, "p10_r01_bal6"),
    (10, 6961, "p10_r02_66814"),
    (10, 8433, "p10_r05_35k"),
    (10, 8951, "p10_r06_31793"),
]
AMT = (4400, 5850)
BAL = (7100, 8300)
PAD = 130  # px at 1200dpi


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s or "")
    if not m:
        return None
    return float(f"{'-' if s.startswith('-') else ''}{re.sub(r'[.,]', '', m.group(1))}.{m.group(2)}")


for page, y12, label in TARGETS:
    for tag, (x0, x1) in (("amt", AMT), ("bal", BAL)):
        X, Y = x0 * 2, max(0, (y12 - PAD) * 2)
        W, H = (x1 - x0) * 2, PAD * 4
        cp = f"{OUT}/{label}_{tag}"
        subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", str(page),
                        "-l", str(page), "-x", str(X), "-y", str(Y),
                        "-W", str(W), "-H", str(H), "-png", PDF, cp],
                       check=True)
        # find produced file
        prod = [f for f in os.listdir(OUT) if f.startswith(os.path.basename(cp)) and f.endswith(".png")]
        if not prod:
            print(f"{label} {tag}: RENDER FAIL")
            continue
        actual = os.path.join(OUT, sorted(prod)[0])
        outs = []
        for psm in ("7", "6", "11"):
            r = subprocess.run(["tesseract", actual, actual + f".{psm}", "--psm", psm,
                                "-c", "tessedit_char_whitelist=0123456789.,-"],
                               capture_output=True, text=True)
            txt = ""
            try:
                txt = open(f"{actual}.{psm}.txt").read().strip().replace("\n", " | ")
            except FileNotFoundError:
                pass
            outs.append(f"psm{psm}={txt!r}")
        print(f"{label:18s} {tag.upper()}: {'  '.join(outs)}")
print("DONE")
