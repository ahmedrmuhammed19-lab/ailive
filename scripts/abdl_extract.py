#!/usr/bin/env python3
"""DL-27 v3 — coordinate extraction for the two NBE scans (Abdulrahman Ali).
FULL pass  (450dpi, no crop): dates + desc + amounts + LINE Y (fusion anchor).
BAND pass  (600dpi, crop 30%): clean amounts + Y (600-space) — no numbers.
Fusion (abdl_fuse3.ts) matches band->full by y-proximity (y450 = y600 * 0.75).
Usage: python3 scripts/abdl_extract.py <dollar|egy|all> <dpi> [first] [last] [band]
Caches: xrows_{key}_pNN.json (full) / xrows_{key}_pNN_band.json (band)."""
import io
import json
import os
import re
import sys
import time

import fitz
import pytesseract
from PIL import Image

UPLOAD = "/home/z/my-project/upload"
WORK = "/home/z/my-project/scripts/abdl_work"
JOBS = {
    "dollar": f"{UPLOAD}/Dollar Account Statement.pdf",
    "egy": f"{UPLOAD}/Egyptian Account Statement.pdf",
}
AMT_RE = re.compile(r"^[\(]?[\d]{1,3}(?:,\d{3})*\.\d{2}[\)]?$|^[\d]+\.\d{2}$")
DATE_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$|^\d{1,2}-\d{1,2}-\d{4}$")

which = sys.argv[1] if len(sys.argv) > 1 else "all"
dpi = int(sys.argv[2]) if len(sys.argv) > 2 else 450
first = int(sys.argv[3]) if len(sys.argv) > 3 else 1
last = int(sys.argv[4]) if len(sys.argv) > 4 else 9999
band = len(sys.argv) > 5 and sys.argv[5] == "band"
CROP = 0.30 if band else 0.0
SUFFIX = "_band" if band else ""

os.makedirs(WORK, exist_ok=True)


def page_words(doc, i, dpi, crop_frac=0.0):
    """Render page, optional right-band crop, OCR with word coordinates.
    Returns (words, page_w) with x in ORIGINAL page pixel space."""
    pix = doc[i].get_pixmap(dpi=dpi)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    orig_w = img.width
    crop_px = round(orig_w * crop_frac)
    if crop_px:
        img = img.crop((crop_px, 0, orig_w, img.height))
    tsv = pytesseract.image_to_data(
        img, lang="eng", config="--psm 6", output_type=pytesseract.Output.DICT
    )
    words = []
    for j in range(len(tsv["text"])):
        t = tsv["text"][j].strip()
        if not t:
            continue
        x = tsv["left"][j] + tsv["width"][j] / 2.0 + crop_px
        y = tsv["top"][j] + tsv["height"][j] / 2.0
        words.append({"t": t, "x": round(x, 1), "y": round(y, 1), "conf": tsv["conf"][j]})
    return words, orig_w


def visual_lines(words, tol):
    ws = sorted(words, key=lambda w: (w["y"], w["x"]))
    lines = []
    for w in ws:
        if lines and w["y"] - lines[-1]["_y"] <= tol:
            lines[-1]["ws"].append(w)
            lines[-1]["_y"] = max(lines[-1]["_y"], w["y"])
        else:
            lines.append({"_y": w["y"], "ws": [w]})
    return [sorted(ln["ws"], key=lambda w: w["x"]) for ln in lines]


def cluster_columns(amount_xs, page_w):
    if not amount_xs:
        return []
    xs = sorted(amount_xs)
    clusters = [[xs[0]]]
    for x in xs[1:]:
        if x - clusters[-1][-1] > 0.06 * page_w:
            clusters.append([])
        clusters[-1].append(x)
    return sorted(sum(c) / len(c) for c in clusters)


for key in JOBS:
    if which not in ("all", key):
        continue
    path = JOBS[key]
    doc = fitz.open(path)
    n = len(doc)
    print(f"[{key}] pages={n} dpi={dpi} band={band}", flush=True)
    for i in range(n):
        if i + 1 < first or i + 1 > last:
            continue
        out = f"{WORK}/xrows_{key}_p{i+1:02d}{SUFFIX}.json"
        if os.path.exists(out) and os.path.getsize(out) > 50:
            print(f"  page {i+1:02d}: cached", flush=True)
            continue
        t0 = time.time()
        words, PAGE_W = page_words(doc, i, dpi, CROP)
        data = None
        if band:
            lines = visual_lines(words, 18)
            rows = []
            for line in lines:
                amts = [w for w in line if AMT_RE.match(w["t"].replace(" ", ""))]
                if not amts:
                    continue
                rows.append({
                    "y": line[0]["_y"] if False else round(line[0][0]["y"], 1) if False else round(amts[0]["y"], 1),
                    "amounts": [w["t"] for w in amts],
                    "xs": [w["x"] for w in amts],
                })
            data = {"page": i + 1, "band": True, "page_w": PAGE_W, "rows": rows}
        else:
            lines = visual_lines(words, 16)

            def line_date(line):
                ds = [w for w in line if DATE_RE.match(w["t"])]
                return ds[0] if ds and ds[0]["x"] < 0.25 * PAGE_W else None

            tx = []
            for line in lines:
                d = line_date(line)
                if d is None:
                    continue
                amts = [w for w in line if AMT_RE.match(w["t"].replace(" ", ""))]
                tx.append((line, d, amts))
            centers = cluster_columns([w["x"] for _, _, amts in tx for w in amts], PAGE_W)
            rows = []
            for line, d, amts in tx:
                a = list(amts)
                rest = [w for w in line if w not in a and w["t"] != d["t"]]
                rec = {
                    "y": round(d["y"], 1),
                    "date": d["t"],
                    "desc": " ".join(w["t"] for w in rest)[:200],
                }
                if len(centers) >= 3:
                    bal_c, cred_c, deb_c = centers[-1], centers[-2], centers[-3]
                    rec["debit"] = next((w["t"] for w in a if abs(w["x"] - deb_c) < 0.035 * PAGE_W), None)
                    rec["credit"] = next((w["t"] for w in a if abs(w["x"] - cred_c) < 0.035 * PAGE_W), None)
                    rec["balance"] = next((w["t"] for w in a if abs(w["x"] - bal_c) < 0.035 * PAGE_W), None)
                elif len(centers) == 2:
                    rec["debit"] = None
                    rec["credit"] = next((w["t"] for w in a if abs(w["x"] - centers[0]) < 0.035 * PAGE_W), None)
                    rec["balance"] = next((w["t"] for w in a if abs(w["x"] - centers[1]) < 0.035 * PAGE_W), None)
                    extra = [w["t"] for w in a if w["t"] not in (rec["credit"], rec["balance"])]
                    rec["amount2"] = extra[0] if extra else None
                else:
                    vals = [w["t"] for w in a]
                    rec["balance"] = vals[-1] if vals else None
                    rec["credit"] = vals[-2] if len(vals) >= 2 else None
                    rec["debit"] = None
                vd = [w for w in line if DATE_RE.match(w["t"]) and w is not d]
                rec["value_date"] = vd[-1]["t"] if vd else None
                rows.append(rec)
            data = {"page": i + 1, "columns": centers, "page_w": PAGE_W, "rows": rows,
                    "lines": [{"y": round(ln[0]["y"], 1), "text": " ".join(w["t"] for w in ln)[:200]} for ln in lines]}
        with open(out, "w") as f:
            json.dump(data, f)
        print(f"  page {i+1:02d}: rows={len(data['rows'])} in {time.time()-t0:.1f}s", flush=True)
    doc.close()

print("EXTRACT DONE", flush=True)
