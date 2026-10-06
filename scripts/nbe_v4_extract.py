#!/usr/bin/env python3
"""NBE v4 — SERIAL-INDEXED ROW EXTRACTION (the 462-row rebuild).

Stage A of v4. Reuses the PROVEN census2 geometry (150dpi horizontal-rule
gaps) but this time:
  - keeps band GEOMETRY (y-ranges) in the output
  - OCR every band @450dpi with image_to_data -> WORD BOXES (x,y per word)
  - tokenizes numbers/dates/serials with x-positions -> column analysis
Output per page: scripts/alahly_work/v4_bands_pNN.json
  { page, bands: [ {idx, y0_150, y1_150, cls, words:[{t,x,cx,cy,conf}],
                     text, amounts:[{v,cx}], dates:[{v,cx}], serial? } ] }

Field parsing is deliberately conservative: garbage-tolerant, and the CHAIN
gates (stage B) adjudicate direction. Anything unparseable is flagged, never
guessed (fail-loud, SO-10).
"""
import io, json, os, re, sys

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"
os.makedirs(WORK, exist_ok=True)

first = int(sys.argv[1]) if len(sys.argv) > 1 else 1
last = int(sys.argv[2]) if len(sys.argv) > 2 else 23

AMT_RE = re.compile(r"^[()\[\]«»_=—\-~'\"|]*?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})[()\[\]«»_=—\-~'\"|]*?$")
DATE_RE = re.compile(r"^(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})[.,;:]?$")
SERIAL_RE = re.compile(r"^[\[\(|\"']?(\d{1,3})[\]\)|\"']?[.,;:]?$")


def rules_of(page_img):
    W, H = page_img.size
    px = page_img.load()
    prof = []
    for y in range(H):
        c = sum(1 for x in range(0, W, 2) if px[x, y] < 128)
        prof.append(c)
    # adaptive rule threshold (AUDIT-1): pages 11/17 have light rules (~0.315
    # coverage) that the fixed 0.35 cut misses entirely -> whole-page collapse.
    # Ladder falls back only when detection collapses (<8 rules); healthy pages
    # keep the historical 0.35 bands byte-identical.
    def _rules_at(thr):
        rr = [y for y, c in enumerate(prof) if c > thr * W / 2]
        groups = []
        for y in rr:
            if groups and y - groups[-1][-1] <= 2:
                groups[-1].append(y)
            else:
                groups.append([y])
        return [sum(g) / len(g) for g in groups]

    base = _rules_at(0.35)
    # rescue: pages 11/17 scans fade down-page; their rule coverage drops below
    # the historical 0.35 partway, merging table rows into mega-bands. Pick the
    # fallback threshold that yields the most plausible table bands. All other
    # pages keep the historical 0.35 behavior byte-identical.
    if getattr(rules_of, "rescue", False) and len(base) < 14:
        rr = _rules_at(0.18)
        nb = sum(1 for a, b in zip(rr, rr[1:]) if 14 <= b - a <= 90)
        if nb > len(base):
            return rr, prof
    return base, prof


def ocr_words(strip, psm):
    cfg = f"--psm {psm}"
    d = pytesseract.image_to_data(strip, lang="eng", config=cfg,
                                  output_type=pytesseract.Output.DICT)
    words = []
    n = len(d["text"])
    for i in range(n):
        t = (d["text"][i] or "").strip()
        if not t:
            continue
        words.append({
            "t": t,
            "x": d["left"][i],
            "w": d["width"][i],
            "cx": d["left"][i] + d["width"][i] / 2,
            "conf": int(d["conf"][i]) if str(d["conf"][i]).lstrip("-").isdigit() else -1,
        })
    return words


def classify_band(band):
    if band["dates"]:
        return "tx"
    if band["amounts"] and len(band["amounts"]) >= 1 and band["serial"] is not None:
        return "tx_nodate"
    if band["amounts"]:
        return "cont_or_total"
    return "struct"


doc = fitz.open(PATH)
for i in range(first - 1, min(last, len(doc))):
    page_no = i + 1
    out_json = f"{WORK}/v4_bands_p{page_no:02d}.json"
    if os.path.exists(out_json):
        print(f"page {page_no}: cached", flush=True)
        continue

    small = doc[i].get_pixmap(dpi=150, colorspace=fitz.csGRAY)
    simg = Image.open(io.BytesIO(small.tobytes("png")))
    rules_of.rescue = (page_no in (7, 10, 11, 14, 16, 17, 21, 22))  # AUDIT-1:
    # light-rule / stamp-corrupted pages verified by serial-continuity gaps
    rules, prof = rules_of(simg)

    big = doc[i].get_pixmap(dpi=450, colorspace=fitz.csGRAY)
    bimg = Image.open(io.BytesIO(big.tobytes("png")))
    BW, BH = bimg.size
    scale = BH / simg.size[1]

    bands = []
    idx = 0
    for a, b in zip(rules, rules[1:]):
        h = b - a
        if not (14 <= h <= 90):
            continue
        seg = prof[int(a) + 3:int(b) - 3]
        if not seg or max(seg) < 8:
            continue
        y0, y1 = int(a * scale), int(b * scale)
        strip = bimg.crop((0, max(0, y0 + 2), BW, min(BH, y1 - 2)))
        words = ocr_words(strip, 7)
        if not words:
            words = ocr_words(strip, 6)

        amounts, dates, serial = [], [], None
        SW = strip.size[0]
        for w in words:
            t = w["t"]
            m = AMT_RE.match(t)
            if m:
                try:
                    v = float(m.group(1).replace(",", ""))
                    amounts.append({"v": round(v, 2), "cx": w["cx"] / SW})
                    continue
                except ValueError:
                    pass
            m = DATE_RE.match(t)
            if m:
                dates.append({"v": m.group(1), "cx": w["cx"] / SW})
                continue
            if serial is None and w["cx"] / SW < 0.09:
                m = SERIAL_RE.match(t)
                if m and 1 <= int(m.group(1)) <= 499:
                    serial = int(m.group(1))

        band = {
            "idx": idx,
            "y0_150": round(a, 1), "y1_150": round(b, 1),
            "words": words,
            "text": " ".join(w["t"] for w in words)[:400],
            "amounts": amounts,
            "dates": dates,
            "serial": serial,
            "nwords": len(words),
        }
        band["cls"] = classify_band(band)
        bands.append(band)
        idx += 1

    json.dump({"page": page_no, "bands": bands}, open(out_json, "w"))
    types = {}
    for bd in bands:
        types[bd["cls"]] = types.get(bd["cls"], 0) + 1
    print(f"page {page_no}: bands={len(bands)} {types}", flush=True)

print("EXTRACT DONE")
