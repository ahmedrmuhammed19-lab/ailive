#!/usr/bin/env python3
"""Phase C8b — fixed-coords surgical for p17 + full p23 summary strips."""
import os
import subprocess

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveH"
PDF = "/home/z/my-project/upload/كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf"

CELLS = [
    (17, 2491, "p17_24may_bal"), (17, 6809, "p17_8760"),
    (17, 7253, "p17_290row"), (17, 9058, "p17_950row"),
    (17, 1402, "p17_10942"), (17, 5443, "p17_1500row"),
    (20, 11600, "p20_nextbal"),
]


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


for page, y12, label in CELLS:
    X, Y, W, H = 4350 * 2, max(0, (y12 - 130) * 2), 4000 * 2 // 2 * 2, 520
    X, W = 4350 * 2, 4000  # x1200 4350..6350?? no -- want AMT+BAL: x1200 4400..8300 -> X=8800 W=7800
    X, W = 8800, 7800
    base = f"{OUT}/{label}_fix"
    for old in os.listdir(OUT):
        if old.startswith(label + "_fix"):
            os.remove(os.path.join(OUT, old))
    subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", str(page), "-l", str(page),
                    "-x", str(X), "-y", str(Y), "-W", str(W), "-H", str(H),
                    "-png", PDF, base], check=True)
    prod = [f for f in os.listdir(OUT) if f.startswith(label + "_fix-") and f.endswith(".png")]
    actual = os.path.join(OUT, sorted(prod)[0])
    r7, r6, r11 = ocr3(actual)
    print(f"{label:18s}: psm7={r7!r}  psm6={r6!r}  psm11={r11!r}")

# p23 summary full strips
for (y0, y1, label) in [(2100, 3400, "p23_sum1"), (3300, 4700, "p23_sum2"),
                        (4600, 6200, "p23_sum3"), (6100, 8000, "p23_sum4"),
                        (7900, 9800, "p23_sum5"), (9700, 11600, "p23_sum6"),
                        (11500, 13300, "p23_sum7")]:
    base = f"{OUT}/{label}"
    subprocess.run(["pdftoppm", "-r", "2400", "-gray", "-f", "23", "-l", "23",
                    "-x", "0", "-y", str(y0 * 2), "-W", "9600", "-H", str((y1 - y0) * 2),
                    "-png", PDF, base], check=True)
    prod = [f for f in os.listdir(OUT) if f.startswith(label + "-") and f.endswith(".png")]
    actual = os.path.join(OUT, sorted(prod)[0])
    subprocess.run(["tesseract", actual, base + ".p6", "--psm", "6"],
                   capture_output=True, text=True)
    try:
        txt = open(base + ".p6.txt").read()
    except FileNotFoundError:
        txt = ""
    print(f"\n########## {label} (p23 y1200 {y0}-{y1}) ##########")
    print(txt[:1400])
print("DONE")
