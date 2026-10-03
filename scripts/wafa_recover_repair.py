#!/usr/bin/env python3
"""WAFA-RECOVER-2: targeted repair of the regenerated rows_ledger.json.

1. Re-verify every closure-added row (src in {y-oracle, 300only}) by re-OCR of
   its amount strip at 600dpi (tight zones, digit whitelist) — keeps real
   transfers, drops reference-number fragments misread as amounts.
2. Re-OCR the date cell of rows whose date is impossible (garbage years /
   month 00) at 600dpi; repair when readable, else blank (undated bucket).
3. Recompute sums, back up the pre-repair ledger, write the repaired one.
Oracle: printed statement totals (unchanged).
"""
import json, os, re, shutil, sys

sys.path.insert(0, os.path.dirname(__file__))
from wafa_parse import try_amount, DATE_RE, fix_date, WORK  # noqa
from wafa_parse2 import PT, DEBIT_X_PT  # noqa
from PIL import Image

LEDGER = f"{WORK}/rows_ledger.json"


def strip_amounts_600(page, top450, h450=40):
    """Crop the amount-column strip for a 450dpi y at 600dpi; rightmost amount
    per zone (2x upscale, psm 7, digit whitelist). Returns (debit, credit)."""
    import csv, subprocess, tempfile
    png = f"{WORK}/c600-{page:02d}.png"
    if not os.path.exists(png):
        return None, None
    img = Image.open(png)
    W, H = img.size
    s = 600 / 450.0
    y0 = max(0, int(top450 * s) - 10)
    y1 = min(H, int((top450 + h450) * s) + 10)
    # strip from 410pt (before debit col) to right edge, 2x upscale
    crop_x0 = int(410 * 600 / PT)
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
                words.append((int(rr["left"]) + int(rr["width"]) // 2, t))
    finally:
        for ext in (".png", ".tsv", ".txt"):
            try:
                os.remove(tmp[:-4] + ext)
            except OSError:
                pass
    bx = (DEBIT_X_PT * (600 / PT) - crop_x0) * 2  # boundary in strip coords
    amts = [(x, a) for x, t in words if (a := try_amount(t)) is not None]
    dz = [a for x, a in amts if x < bx]
    cz = [a for x, a in amts if x >= bx]
    return (max(dz) if dz else None), (max(cz) if cz else None)


def ocr_date_600(page, top450, h450=40):
    """Re-OCR the leftmost date cell of a row at 600dpi; returns dd/mm/yyyy or ''. """
    import csv, subprocess, tempfile
    png = f"{WORK}/c600-{page:02d}.png"
    if not os.path.exists(png):
        return ""
    img = Image.open(png)
    W, H = img.size
    s = 600 / 450.0
    y0 = max(0, int(top450 * s) - 8)
    y1 = min(H, int((top450 + h450) * s) + 8)
    strip = img.crop((0, y0, int(200 * 600 / PT), y1))  # date col: leftmost 200pt
    strip = strip.resize((strip.width * 2, strip.height * 2), 1)
    with tempfile.NamedTemporaryFile(suffix=".png", dir=WORK, delete=False) as f:
        strip.save(f.name)
        tmp = f.name
    try:
        subprocess.run(["tesseract", tmp, tmp[:-4], "--psm", "7",
                        "-c", "tessedit_char_whitelist=0123456789/"],
                       capture_output=True, timeout=90)
        txt = open(tmp[:-4] + ".txt", encoding="utf-8", errors="replace").read()
    finally:
        for ext in (".png", ".tsv", ".txt"):
            try:
                os.remove(tmp[:-4] + ext)
            except OSError:
                pass
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", txt.replace("S", "5").replace("s", "5"))
    if not m:
        return ""
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if 1 <= d <= 31 and 1 <= mo <= 12 and y == 2026:
        return f"{d:02d}/{mo:02d}/{y}"
    return ""


def bad_date(s):
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s or "")
    if not m:
        return bool(s)  # non-empty but unparseable -> bad
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return not (1 <= d <= 31 and 1 <= mo <= 12 and y == 2026)


def main():
    led = json.load(open(LEDGER))
    rows = led["rows"]
    shutil.copy(LEDGER, LEDGER + ".prerepair")

    # --- 1. re-verify closure additions ---
    kept, dropped, fixed = 0, 0, 0
    for r in rows:
        if r.get("src") not in ("y-oracle", "300only"):
            continue
        d, c = strip_amounts_600(r["page"], r.get("top") or 0)
        if d is None and c is None:
            dropped += 1
            r["debit"] = r["credit"] = None
            r["src"] += "+dropped"
            continue
        if d != r.get("debit") or c != r.get("credit"):
            fixed += 1
        r["debit"], r["credit"] = d, c
        kept += 1
    print(f"closure additions: kept={kept} dropped={dropped} corrected={fixed}")

    # --- 2. garbage-date repair ---
    dfixed = dbanked = 0
    for r in rows:
        dt = r.get("date") or ""
        if r.get("src", "").endswith("dropped"):
            continue
        if bad_date(dt) and r.get("top") is not None:
            nd = ocr_date_600(r["page"], r["top"])
            if nd and nd != dt:
                r["date"] = nd
                dfixed += 1
            elif not nd:
                r["date"] = ""
                dbanked += 1
    print(f"garbage dates: repaired={dfixed} blanked={dbanked}")

    # --- 3. recompute + write ---
    rows = [r for r in rows if r["debit"] is not None or r["credit"] is not None]
    led["rows"] = rows
    led["sumDebits"] = round(sum(r["debit"] or 0 for r in rows), 2)
    led["sumCredits"] = round(sum(r["credit"] or 0 for r in rows), 2)
    td, tc = led["totalDebits"], led["totalCredits"]
    print(f"\nfinal rows={len(rows)}")
    print(f"debits : {led['sumDebits']:,.2f} vs {td:,.2f} ({led['sumDebits']/td*100:.2f}%)")
    print(f"credits: {led['sumCredits']:,.2f} vs {tc:,.2f} ({led['sumCredits']/tc*100:.2f}%)")
    json.dump(led, open(LEDGER, "w"), indent=1)
    print(f"written: {LEDGER} (backup at .prerepair)")


if __name__ == "__main__":
    main()
