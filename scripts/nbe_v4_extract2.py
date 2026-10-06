#!/usr/bin/env python3
"""NBE v4 Stage A v2 — LINE-AWARE ROW EXTRACTION.

Fixes v1: keeps pytesseract LINE structure (block/par/line + word y) so a
strip that contains [desc-wrap + row] or [row + row] can be split into
LOGICAL LINES. Each line: serial? date? ref? amounts[] -> logical rows.
Wrap lines (text, no date, no amounts) attach to the row above.

Output: scripts/alahly_work/v4_lines_pNN.json
  bands: [ {idx, y0_150, y1_150, lines: [ {y, text, serial, dates[], amounts[{v,cx}], kind} ] } ]
"""
import io, json, os, re

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"

AMT_RE = re.compile(r"^[()\[\]«»_=—\-~'\"|.,]*?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})[()\[\]«»_=—\-~'\"|]*?$")
DATE_RE = re.compile(r"^(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})[.,;:]?$")


def parse_amt(tok):
    """OCR-tolerant amount parser (dot/comma flip safe):
    1,341,824.35 / 10,00 (=10.00) / 457,696,03 (=457696.03) / 457.696,03 / 10.00"""
    t = tok.strip().strip("|[]()«»\"'=—-~.,_;")
    m = re.fullmatch(r"(\d{1,3}(?:,\d{3})*)[.,](\d{2})", t)
    if m:
        return round(float(m.group(1).replace(",", "") + "." + m.group(2)), 2)
    m = re.fullmatch(r"(\d{1,3}(?:\.\d{3})+),(\d{2})", t)
    if m:
        return round(float(m.group(1).replace(".", "") + "." + m.group(2)), 2)
    m = re.fullmatch(r"(\d{1,3}(?:,\d{3})+)", t)
    if m:
        return round(float(m.group(1).replace(",", "")), 2)
    return None


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


def strip_lines(strip):
    """OCR strip -> list of visual lines with word data."""
    d = pytesseract.image_to_data(strip, lang="eng", config="--psm 6",
                                  output_type=pytesseract.Output.DICT)
    n = len(d["text"])
    lines = {}
    SW = strip.size[0]
    for i in range(n):
        t = (d["text"][i] or "").strip()
        if not t:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        cx = d["left"][i] + d["width"][i] / 2
        lines.setdefault(key, {"y": d["top"][i], "words": []})
        lines[key]["words"].append({"t": t, "cx": cx / SW})
    out = []
    for key in sorted(lines, key=lambda k: lines[k]["y"]):
        L = lines[key]
        amounts, dates, serial = [], [], None
        texts = []
        for w in L["words"]:
            t = w["t"]
            texts.append(t)
            m = DATE_RE.match(t)
            if m:
                dates.append(m.group(1))
                continue
            v = parse_amt(t)
            if v is not None:
                amounts.append({"v": v, "cx": round(w["cx"], 4)})
                continue
            if serial is None and w["cx"] < 0.10:
                ts = t.strip("|[]()'\" .,")
                if ts.isdigit() and 1 <= int(ts) <= 499:
                    serial = int(ts)
        out.append({"y": L["y"], "text": " ".join(texts)[:300], "serial": serial,
                    "dates": dates, "amounts": amounts,
                    "raw_cx_first": L["words"][0]["cx"]})
    return out


doc = fitz.open(PATH)
for i in range(min(last := 23, len(doc))):
    page_no = i + 1
    out_json = f"{WORK}/v4_lines_p{page_no:02d}.json"
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
    for a, b in zip(rules, rules[1:]):
        h = b - a
        if not (14 <= h <= 90):
            continue
        seg = prof[int(a) + 3:int(b) - 3]
        if not seg or max(seg) < 8:
            continue
        y0, y1 = int(a * scale), int(b * scale)
        strip = bimg.crop((0, max(0, y0 + 2), BW, min(BH, y1 - 2)))
        lines = strip_lines(strip)
        bands.append({"idx": len(bands), "y0_150": round(a, 1), "y1_150": round(b, 1),
                      "lines": lines, "nlines": len(lines)})

    json.dump({"page": page_no, "bands": bands}, open(out_json, "w"))
    nl = sum(bd["nlines"] for bd in bands)
    print(f"page {page_no}: bands={len(bands)} lines={nl}", flush=True)

print("EXTRACT v2 DONE")
