#!/usr/bin/env python3
"""Phase C5 — generic strip solver: full-width 2400dpi strips, line-grouped
tokens with column classification. Sweeps all remaining failing pockets."""
import os
import re
import subprocess
import csv

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveE"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
os.makedirs(OUT, exist_ok=True)

MONEY = re.compile(r"^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^-?\d+[.,]\d{2}$")
DATE = re.compile(r"^\d{2}/\d{2}/\d{4}")

# (page, y1200_from, y1200_to, label)
TARGETS = [
    (13, 3260, 5800, "p13_seg4"),
    (16, 10200, 12000, "p16_seg5a"),
    (16, 12000, 14030, "p16_seg5b"),
    (17, 300, 2600, "p17_seg5c"),
    (18, 2850, 5000, "p18_seg6"),
    (18, 5000, 8900, "p18_seg7"),
    (20, 9550, 10500, "p20_seg8"),
    (9, 1450, 2350, "p9_r00_fee"),
    (3, 4850, 6350, "p3_atm"),
]


def classify(x, t):
    if DATE.match(t) and x < 1500:
        return "DATE"
    if x < 1500:
        return "d?"
    if 1500 <= x < 4400:
        return "desc"
    if 4400 <= x < 5850:
        return "AMT"
    if 5850 <= x < 7100:
        return "mid"
    if 7100 <= x < 8300:
        return "BAL"
    if x >= 8300 and DATE.match(t):
        return "VDATE"
    return "r"


for page, y0, y1, label in TARGETS:
    png = f"{OUT}/{label}"
    subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", str(page), "-l", str(page),
                    "-x", "0", "-y", str(y0 * 2), "-W", "9600",
                    "-H", str((y1 - y0) * 2), "-png", PDF, png], check=True)
    prod = [f for f in os.listdir(OUT) if f.startswith(label + "-") and f.endswith(".png")]
    actual = os.path.join(OUT, sorted(prod)[0])
    subprocess.run(["tesseract", actual, png, "--psm", "6", "tsv"],
                   capture_output=True, check=True)
    words = []
    with open(png + ".tsv") as fh:
        r = csv.DictReader(fh, delimiter="\t")
        for c in r:
            if not (c["text"] or "").strip() or float(c["conf"]) < 15:
                continue
            x1200 = int(c["left"]) // 2
            y1200 = y0 + int(c["top"]) // 2
            words.append((y1200, x1200, c["text"], float(c["conf"])))
    # group into lines
    words.sort(key=lambda w: (w[0], w[1]))
    lines = []
    for w in words:
        if lines and abs(w[0] - lines[-1][0][0]) <= 55:
            lines[-1].append(w)
        else:
            lines.append([w])
    print(f"\n########## {label} (p{page} y1200 {y0}-{y1}) ##########")
    for ln in lines:
        ln.sort(key=lambda w: w[1])
        parts = [f"{classify(x, t)}:{t}" for _, x, t, cf in ln]
        print(f"  y={ln[0][0]:5d} | " + " ".join(parts)[:160])
print("\nDONE")
