#!/usr/bin/env python3
"""Phase C7 — colscan pages 21-23 + strips/surgical for p17 24may, p13 pocket, p21/22."""
import os
import re
import subprocess
import csv

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveG"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
os.makedirs(OUT, exist_ok=True)
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s or "")
    if not m:
        return None
    return float(f"{'-' if s.startswith('-') else ''}{re.sub(r'[.,]', '', m.group(1))}.{m.group(2)}")


def full_tsv(page, tag):
    png = f"{OUT}/full_{tag}"
    actual = f"{png}-{page:02d}.png"
    if not os.path.exists(actual):
        subprocess.run(["pdftoppm", "-r", "1200", "-gray", "-f", str(page), "-l", str(page),
                        "-png", PDF, png], check=True)
    tsv = png + ".tsv"
    if not os.path.exists(tsv):
        subprocess.run(["tesseract", actual, png, "--psm", "6", "tsv"],
                       capture_output=True, check=True)
    words = []
    with open(tsv) as fh:
        next(fh)
        for line in fh:
            c = line.rstrip("\n").split("\t")
            if len(c) < 12 or not c[11].strip():
                continue
            words.append({"l": int(c[6]), "t": int(c[7]), "h": int(c[9]),
                          "conf": float(c[10]), "x": c[11]})
    return words


# --- colscan p21, p22, p23
for page in (21, 22, 23):
    words = full_tsv(page, f"p{page}")
    dates = sorted([w for w in words if DATE_RE.match(w["x"]) and 850 <= w["l"] < 1500
                    and w["conf"] > 25], key=lambda w: w["t"])
    anchors = []
    for d in dates:
        if anchors and abs(d["t"] - anchors[-1]["t"]) < 90:
            continue
        anchors.append(d)
    amts = sorted([w for w in words if 4450 <= w["l"] < 5850 and fnum(w["x"]) is not None],
                  key=lambda w: w["t"])
    bals = sorted([w for w in words if 7100 <= w["l"] < 8300 and fnum(w["x"]) is not None],
                  key=lambda w: w["t"])
    print(f"\n===== PAGE {page} colscan ({len(anchors)} anchors) =====")
    for i, a in enumerate(anchors):
        y0 = a["t"] - 60
        y1 = anchors[i + 1]["t"] - 60 if i + 1 < len(anchors) else 10**9
        sa = [(w["x"], w["t"], round(w["conf"])) for w in amts if y0 <= w["t"] < y1]
        sb = [(w["x"], w["t"], round(w["conf"])) for w in bals if y0 <= w["t"] < y1]
        print(f" r{i:02d} y={a['t']:5d} [{a['x']}] amt={sa} bal={sb}")

# --- strip printer
def strip(page, y0, y1, label):
    png = f"{OUT}/strip_{label}"
    subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", str(page), "-l", str(page),
                    "-x", "0", "-y", str(y0 * 2), "-W", "9600", "-H", str((y1 - y0) * 2),
                    "-png", PDF, png], check=True)
    prod = [f for f in os.listdir(OUT) if f.startswith(f"strip_{label}-") and f.endswith(".png")]
    actual = os.path.join(OUT, sorted(prod)[0])
    subprocess.run(["tesseract", actual, png, "--psm", "6", "tsv"], capture_output=True, check=True)
    words = []
    with open(png + ".tsv") as fh:
        r = csv.DictReader(fh, delimiter="\t")
        for c in r:
            if not (c["text"] or "").strip() or float(c["conf"]) < 12:
                continue
            words.append((y0 + int(c["top"]) // 2, int(c["left"]) // 2, c["text"]))
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
        toks = []
        for _, x, t in ln:
            zone = "AMT" if 4400 <= x < 5850 else ("BAL" if 7100 <= x < 8300 else
                   ("DATE" if x < 1500 else "d"))
            toks.append(f"{zone}:{t}")
        print(f"  y={ln[0][0]:5d} | " + " ".join(toks)[:155])


strip(17, 2400, 5700, "p17_24may")
strip(13, 3200, 5800, "p13_pocket")
strip(21, 1500, 4200, "p21_pocket")
strip(22, 700, 2200, "p22_top")
print("\nDONE")
