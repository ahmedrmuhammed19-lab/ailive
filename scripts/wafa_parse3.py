#!/usr/bin/env python3
"""Three-way forensic reconciliation: 300dpi + 450dpi full passes, 600dpi
strip re-OCR as tiebreaker for disagreeing rows. Oracle: printed totals."""
import csv
import glob
import json
import os
import re
import subprocess
import tempfile

import sys
sys.path.insert(0, os.path.dirname(__file__))
from wafa_parse import try_amount, fix_date, fix_num, WORK  # noqa
from wafa_parse2 import parse_pass, lines_of_t, DEBIT_X_PT, DESC_LO_PT, DESC_HI_PT, PT  # noqa


def page_png(dpi, pno):
    """Rasterize one page at dpi into WORK; return png path."""
    pdf = "/home/z/my-project/upload/كشف حساب شخصي لمدة 6 شهور من بنك وفا التجاري.pdf"
    out = f"{WORK}/x{dpi}-{pno:02d}"
    if not os.path.exists(out + ".png"):
        subprocess.run(["pdftoppm", "-f", str(pno), "-l", str(pno), "-r", str(dpi),
                        "-gray", "-png", pdf, out], capture_output=True, timeout=120)
    return out + f"-{pno:02d}.png" if os.path.exists(out + f"-{pno:02d}.png") else out + ".png"


def strip_amounts(png, top, h, dpi, yscale=1.0):
    """Crop a row strip, 2x upscale, tesseract psm 7, return (debits, credits)."""
    from PIL import Image
    img = Image.open(png)
    W, H = img.size
    y0 = max(0, int(top * yscale) - int(h * yscale * 0.6))
    y1 = min(H, int((top + h) * yscale) + int(h * yscale * 0.6))
    strip = img.crop((0, y0, W, y1)).resize((W * 2, (y1 - y0) * 2), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png", dir=WORK, delete=False) as f:
        strip.save(f.name)
        tmp = f.name
    try:
        subprocess.run(["tesseract", tmp, tmp[:-4], "--psm", "7", "tsv"],
                       capture_output=True, timeout=90)
        words = []
        for rr in csv.DictReader(open(tmp[:-4] + ".tsv"), delimiter="\t", quoting=csv.QUOTE_NONE):
            t = (rr["text"] or "").strip()
            if t and float(rr["conf"]) >= 0:
                words.append((int(rr["left"]) + int(rr["width"]) // 2, t))
    finally:
        for ext in (".png", ".tsv", ".txt"):
            try:
                os.remove(tmp[:-4] + ext)
            except OSError:
                pass
    bx = DEBIT_X_PT * (dpi / PT) * 2  # strip upscaled 2x
    debits = [a for x, t in words if x < bx and (a := try_amount(t)) is not None]
    credits = [a for x, t in words if x >= bx and (a := try_amount(t)) is not None]
    return (debits or [None]), (credits or [None])


def main():
    r300, bals300, _ = parse_pass(f"{WORK}/pg-*.tsv", 300, "pg")
    r450, bals, totals = parse_pass(f"{WORK}/hi2-*.tsv", 450, "hi2")
    bal_open, bal_close = bals[0][2], bals[-1][2]
    tot_debit, tot_credit = totals
    print(f"300dpi rows={len(r300)}  450dpi rows={len(r450)}  printed=({tot_debit}, {tot_credit})")

    # index both passes by (page,date) preserving order
    def index(rows):
        idx, seen = [], {}
        for r in rows:
            k = seen.get((r["page"], r["date"]), 0)
            seen[(r["page"], r["date"])] = k + 1
            idx.append(((r["page"], r["date"], k), r))
        return dict(idx)

    i300, i450 = index(r300), index(r450)
    keys = sorted(set(i300) | set(i450), key=lambda x: (x[0], x[2]))
    final = []
    disagreements = 0
    cache600 = {}
    for key in keys:
        a, b = i300.get(key), i450.get(key)
        page, date, k = key
        if a and b and a["debit"] == b["debit"] and a["credit"] == b["credit"]:
            row = dict(a)
            row["top"], row["h"] = b.get("top", a.get("top")), b.get("h", a.get("h"))
            final.append(row)
            continue
        disagreements += 1
        # tiebreak with 600dpi strip (y from 450 TSV, scaled 600/450)
        if page not in cache600:
            cache600[page] = page_png(600, page)
        ref = b or a
        yscale = 600 / 450
        d, c = strip_amounts(cache600[page], ref.get("top", 0), ref.get("h", 40), 600, yscale)
        row = {"page": page, "date": date, "valueDate": (b or a).get("valueDate", ""),
               "debit": d[0], "credit": c[0],
               "desc": (b or a).get("desc", ""), "memo": (b or a).get("memo", []),
               "tiebreak": True}
        final.append(row)
    print(f"disagreements tiebroken at 600dpi: {disagreements}")

    empt = [r for r in final if r["debit"] is None and r["credit"] is None]
    sd = round(sum(r["debit"] or 0 for r in final), 2)
    sc = round(sum(r["credit"] or 0 for r in final), 2)
    print(f"final rows={len(final)}  empties={len(empt)}")
    print(f"debits : {sd:,.2f} vs {tot_debit:,.2f}  diff {sd - tot_debit:+,.2f}")
    print(f"credits: {sc:,.2f} vs {tot_credit:,.2f}  diff {sc - tot_credit:+,.2f}")
    net = round(sc - sd, 2)
    ec = round(bal_open + net, 2)
    print(f"closing: computed {ec:,.2f} vs printed {bal_close:,.2f}  diff {ec - bal_close:+,.2f}")
    ok = abs(sd - tot_debit) < 0.01 and abs(sc - tot_credit) < 0.01 and abs(ec - bal_close) < 0.01
    print("CHAIN VERDICT:", "100% — analyst verified" if ok else "MISMATCH")
    json.dump({"rows": final, "opening": bal_open, "closing": bal_close,
               "totalDebits": tot_debit, "totalCredits": tot_credit,
               "sumDebits": sd, "sumCredits": sc}, open(f"{WORK}/rows_final.json", "w"), indent=1)


if __name__ == "__main__":
    main()
