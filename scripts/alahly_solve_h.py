#!/usr/bin/env python3
"""Phase C8 — last surgical mini-batch: p17 tail cells + p23 summary block."""
import os
import subprocess

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveH"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"
os.makedirs(OUT, exist_ok=True)

CELLS = [
    (17, 2100, 2100, 3200, "p17_interest_wide"),   # wide crop for interest row
    (17, 2491, "p17_24may_bal"),
    (17, 6809, "p17_8760"), (17, 7253, "p17_290row"),
    (17, 9058, "p17_950row"),
    (20, 11600, "p20_nextbal"),
]
# p23 summary: Current/Available/Hold block + final rows — full-width strips
STRIPS = [(23, 900, 2400, "p23_head"), (23, 2400, 4200, "p23_rows")]


def ocr3(base):
    outs = []
    for psm in ("7", "6", "11"):
        subprocess.run(["tesseract", base, base + f".{psm}", "--psm", psm,
                        "-c", "tessedit_char_whitelist=0123456789.,-"],
                       capture_output=True, text=True)
        try:
            outs.append(open(base + f".{psm}.txt").read().strip().replace("\n", " "))
        except FileNotFoundError:
            outs.append("")
    return outs


for item in CELLS:
    if len(item) == 5:
        page, y0, y1, _, label = item
        X, Y, W, H = 0, y0 * 2, 9600, (y1 - y0) * 2
    else:
        page, y12, label = item
        X, Y, W, H = 4300 * 2 // 2 * 0 + 4350, max(0, (y12 - 130) * 2), 4000, 500
        # wide: amount+balance zones together (x 4350..8350 at 1200dpi)
        X, Y, W, H = 4350, max(0, (y12 - 130) * 2), 4000, 500
    base = f"{OUT}/{label}"
    subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", str(page), "-l", str(page),
                    "-x", str(X), "-y", str(Y), "-W", str(W), "-H", str(H),
                    "-png", PDF, base], check=True)
    prod = [f for f in os.listdir(OUT) if f.startswith(label + "-") and f.endswith(".png")]
    actual = os.path.join(OUT, sorted(prod)[0])
    r7, r6, r11 = ocr3(actual)
    print(f"{label:22s}: psm7={r7!r}  psm6={r6!r}  psm11={r11!r}")

for page, y0, y1, label in STRIPS:
    base = f"{OUT}/{label}"
    subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", str(page), "-l", str(page),
                    "-x", "0", "-y", str(y0 * 2), "-W", "9600", "-H", str((y1 - y0) * 2),
                    "-png", PDF, base], check=True)
    prod = [f for f in os.listdir(OUT) if f.startswith(label + "-") and f.endswith(".png")]
    actual = os.path.join(OUT, sorted(prod)[0])
    for psm in ("6",):
        subprocess.run(["tesseract", actual, base + f".{psm}", "--psm", psm],
                       capture_output=True, text=True)
        try:
            txt = open(base + f".{psm}.txt").read()
        except FileNotFoundError:
            txt = ""
        print(f"\n########## {label} psm{psm} ##########")
        print(txt[:1800])
print("DONE")
