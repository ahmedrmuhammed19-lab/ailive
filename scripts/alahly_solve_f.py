#!/usr/bin/env python3
"""Phase C6 — final surgical batch: pocket-deciding cells + p16 middle strip."""
import os
import re
import subprocess
import csv

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveF"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
os.makedirs(OUT, exist_ok=True)

# surgical cells: (page, y1200, label)
CELLS = [
    (16, 7782, "p16_r04_400row"),
    (16, 9000, "p16_gap_a"), (16, 9500, "p16_gap_b"),
    (17, 1757, "p17_320row"), (17, 2100, "p17_interest"),
    (17, 2491, "p17_24may"),
    (18, 2948, "p18_r00"), (18, 3800, "p18_gap1"),
    (18, 4376, "p18_r01_fee"), (18, 6364, "p18_230row"),
    (18, 7815, "p18_r08"), (18, 8217, "p18_r09"),
    (20, 8830, "p20_interp050"), (20, 9728, "p20_fee20"),
    (20, 10126, "p20_endpoint"), (20, 11600, "p20_next"),
    (10, 6763, "p10_stmtfee"), (10, 10166, "p10_230pur"),
    (4, 2980, "p4_top"), (4, 3512, "p4_fee"),
    (13, 3342, "p13_2000row"), (13, 5718, "p13_nextbal"),
]
AMT = (4400, 5850)
BAL = (7100, 8300)


def ocr(png_base, psm):
    r = subprocess.run(["tesseract", png_base, png_base + f".{psm}", "--psm", psm,
                        "-c", "tessedit_char_whitelist=0123456789.,-"],
                       capture_output=True, text=True)
    try:
        return open(png_base + f".{psm}.txt").read().strip().replace("\n", " ")
    except FileNotFoundError:
        return ""


for page, y12, label in CELLS:
    for tag, (x0, x1) in (("amt", AMT), ("bal", BAL)):
        X, Y = x0 * 2, max(0, (y12 - 120) * 2)
        W, H = (x1 - x0) * 2, 480
        base = f"{OUT}/{label}_{tag}"
        for old in os.listdir(OUT):
            if old.startswith(os.path.basename(base)):
                os.remove(os.path.join(OUT, old))
        subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", str(page), "-l", str(page),
                        "-x", str(X), "-y", str(Y), "-W", str(W), "-H", str(H),
                        "-png", PDF, base], check=True)
        prod = [f for f in os.listdir(OUT) if f.startswith(os.path.basename(base)) and f.endswith(".png")]
        if not prod:
            print(f"{label:16s} {tag}: RENDER FAIL")
            continue
        actual = os.path.join(OUT, sorted(prod)[0])
        r7, r6, r11 = ocr(actual, "7"), ocr(actual, "6"), ocr(actual, "11")
        print(f"{label:16s} {tag.upper()}: psm7={r7!r}  psm6={r6!r}  psm11={r11!r}")

# p16 middle strip y7700-10600 full width
png = f"{OUT}/strip_p16mid"
subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", "16", "-l", "16",
                "-x", "0", "-y", str(7700 * 2), "-W", "9600",
                "-H", str((10600 - 7700) * 2), "-png", PDF, png], check=True)
prod = [f for f in os.listdir(OUT) if f.startswith("strip_p16mid-") and f.endswith(".png")]
actual = os.path.join(OUT, sorted(prod)[0])
subprocess.run(["tesseract", actual, png, "--psm", "6", "tsv"], capture_output=True, check=True)
words = []
with open(png + ".tsv") as fh:
    r = csv.DictReader(fh, delimiter="\t")
    for c in r:
        if not (c["text"] or "").strip() or float(c["conf"]) < 15:
            continue
        words.append((7700 + int(c["top"]) // 2, int(c["left"]) // 2, c["text"]))
words.sort(key=lambda w: (w[0], w[1]))
lines = []
for w in words:
    if lines and abs(w[0] - lines[-1][0][0]) <= 55:
        lines[-1].append(w)
    else:
        lines.append([w])
print("\n########## p16 middle strip (y1200 7700-10600) ##########")
for ln in lines:
    ln.sort(key=lambda w: w[1])
    toks = []
    for _, x, t in ln:
        zone = "AMT" if 4400 <= x < 5850 else ("BAL" if 7100 <= x < 8300 else ("DATE" if x < 1500 else "d"))
        toks.append(f"{zone}:{t}")
    print(f"  y={ln[0][0]:5d} | " + " ".join(toks)[:150])
print("DONE")
