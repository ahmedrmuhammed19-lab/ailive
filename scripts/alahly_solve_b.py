#!/usr/bin/env python3
"""Phase B — render failing-segment strips at 1200dpi, OCR, reconstruct printed rows.
Ground truth: what is ACTUALLY printed between the two printed balances."""
import json
import os
import re
import subprocess

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveB"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
S = 1200 / 450.0
os.makedirs(OUT, exist_ok=True)

# page heights at 450dpi from page_XX.json
ph = {}
for p in range(1, 24):
    try:
        d = json.load(open(f"{WORK}/page_{p:02d}.json"))
        ph[p] = max(w["y"] + w["h"] for w in d["words"])
    except FileNotFoundError:
        pass

# segments: (id, [(page, y0, y1)]) strips at 450dpi, inclusive of balance rows
STRIPS = [
    ("seg0", [(3, 1900, 2900)]),
    ("seg1", [(3, 3500, ph.get(3, 5263)), (4, 600, 1250)]),
    ("seg2", [(9, 520, 1720)]),
    ("seg3", [(9, 3320, ph.get(9, 5263)), (10, 600, 1050)]),
    ("seg4", [(13, 700, 2200)]),
    ("seg5", [(16, 2840, ph.get(16, 5263)), (17, 400, 800)]),
    ("seg6", [(18, 1560, 2500)]),
    ("seg7", [(18, 2500, 3050)]),
    ("seg8", [(20, 3030, 3850)]),
]

MONEY = re.compile(r"^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^-?\d+[.,]\d{2}$")


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s or "")
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    neg = (s or "").startswith("-")
    return float(f"{'-' if neg else ''}{ip}.{m.group(2)}")


def group_lines(words, ytol=40):
    words = sorted(words, key=lambda w: (w["top"] + w["height"] / 2, w["left"]))
    lines, cur, cy = [], [], None
    for w in words:
        yc = w["top"] + w["height"] / 2
        if cy is None or abs(yc - cy) <= ytol:
            cur.append(w)
            cy = yc if cy is None else (cy * (len(cur) - 1) + yc) / len(cur)
        else:
            lines.append(cur)
            cur, cy = [w], yc
    if cur:
        lines.append(cur)
    for ln in lines:
        ln.sort(key=lambda w: w["left"])
    return sorted(lines, key=lambda ln: ln[0]["top"])


report = []
for sid, strips in STRIPS:
    print(f"\n########## {sid} ##########")
    for page, y0, y1 in strips:
        y0c, y1c = max(0, int(y0 - 40)), min(int(ph.get(page, 5300)), int(y1 + 40))
        X, Y = 0, int(y0c * S)
        W, H = 9567, max(200, int((y1c - y0c) * S))
        png = f"{OUT}/{sid}_p{page:02d}.png"
        subprocess.run(["pdftoppm", "-r", "1200", "-f", str(page), "-l", str(page),
                        "-x", str(X), "-y", str(Y), "-W", str(W), "-H", str(H),
                        "-png", PDF, png[:-4]], check=True)
        # pdftoppm may add page number suffix; find actual file
        cand = [f for f in os.listdir(OUT) if f.startswith(os.path.basename(png[:-4])) and f.endswith(".png")]
        if not cand:
            print(f"  !! render failed p{page}")
            continue
        actual = os.path.join(OUT, sorted(cand)[0])
        tsv = actual[:-4]
        subprocess.run(["tesseract", actual, tsv, "--psm", "6", "tsv"],
                       capture_output=True, check=True)
        words = []
        with open(tsv + ".tsv") as fh:
            next(fh)
            for line in fh:
                c = line.rstrip("\n").split("\t")
                if len(c) < 12 or c[11].strip() == "" or float(c[10]) < 20:
                    continue
                words.append({"left": int(c[6]), "top": int(c[7]),
                              "width": int(c[8]), "height": int(c[9]),
                              "conf": float(c[10]), "t": c[11]})
        print(f"\n--- p{page} y{y0c}..{y1c} (450dpi ref) ---")
        for ln in group_lines(words):
            toks = [(w["t"], round(w["left"] / S)) for w in ln]
            nums = [(t, x) for t, x in toks if fnum(t) is not None]
            txt = " ".join(t for t, _ in toks)
            print(f"  y450={y0c + round(ln[0]['top'] / S):4d} | {txt[:110]}")
            if nums:
                print(f"      nums: {nums}")
        report.append({"sid": sid, "page": page, "words": words})
json.dump([{k: v for k, v in r.items()} for r in report],
          open(f"{OUT}/raw_words.json", "w"), ensure_ascii=False)
print("\nDONE — strips in", OUT)
