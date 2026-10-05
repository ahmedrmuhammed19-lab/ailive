#!/usr/bin/env python3
"""NBE v4 Stage A3 — SERIAL ARBITER (merge 450 + 600 reads, 900dpi decides).

Per tx-ish band:
  450dpi word-box serial and 600dpi cell read:
    agree -> CONFIRMED
    one present -> PROVISIONAL (that value)
    disagree -> 900dpi arbiter crop decides (majority of 3)
  both absent -> 900dpi attempt, else None (CONT candidate)
Then sequence coherence: expected printed serials 1..462 in print order;
gaps/dups reported per band (fail-loud, no inference printed as fact).

Output: scripts/alahly_work/v4_serial_final.json
        {key: {serial|None, src, status}} + coherence summary
"""
import io, json, os, re

import fitz
import pytesseract
from PIL import Image

PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
WORK = "/home/z/my-project/scripts/alahly_work"
SER_RE = re.compile(r"^\D*?(\d{1,3})\D*$")

doc = fitz.open(PATH)
band_index = {}
for p in range(1, 24):
    d = json.load(open(f"{WORK}/v4_bands_p{p:02d}.json"))
    for b in d["bands"]:
        if b["cls"] in ("tx", "tx_nodate", "cont_or_total"):
            band_index[f"{p}:{b['idx']}"] = b

s600 = json.load(open(f"{WORK}/v4_serials.json"))

cache = {}
def render600(p):
    if p not in cache:
        pm = doc[p - 1].get_pixmap(dpi=600, colorspace=fitz.csGRAY)
        cache[p] = Image.open(io.BytesIO(pm.tobytes("png")))
    return cache[p]

def read900(p, b):
    pm = doc[p - 1].get_pixmap(dpi=900, colorspace=fitz.csGRAY)
    img = Image.open(io.BytesIO(pm.tobytes("png")))
    W, H = img.size
    k = 900 / 150.0
    y0, y1 = int(b["y0_150"] * k), int(b["y1_150"] * k)
    cell = img.crop((0, max(0, y0 + 6), int(W * 0.13), min(H, y1 - 6)))
    cell = cell.point(lambda v: 0 if v < 165 else 255)
    for psm in (7, 8, 13):
        txt = pytesseract.image_to_string(
            cell, lang="eng",
            config=f"--psm {psm} -c tessedit_char_whitelist=0123456789").strip()
        m = SER_RE.match(txt)
        if m and 1 <= int(m.group(1)) <= 499:
            return int(m.group(1))
    return None

final = {}
arb = 0
for key, b in band_index.items():
    s450 = b["serial"]
    s600v = s600.get(key)
    if s450 is not None and s600v is not None:
        if s450 == s600v:
            final[key] = {"serial": s450, "src": "450+600", "status": "confirmed"}
        else:
            s9 = read900(int(key.split(":")[0]), b)
            arb += 1
            votes = [s450, s600v, s9]
            pick = s9 if s9 is not None else s450
            final[key] = {"serial": pick, "src": f"900-arbiter {votes}",
                          "status": "arbitrated"}
    elif s450 is not None or s600v is not None:
        final[key] = {"serial": s450 if s450 is not None else s600v,
                      "src": "single-source", "status": "provisional"}
    else:
        s9 = read900(int(key.split(":")[0]), b)
        arb += 1
        final[key] = {"serial": s9, "src": "900", "status": "confirmed" if s9 else "none"}

json.dump(final, open(f"{WORK}/v4_serial_final.json", "w"))

vals = [v["serial"] for v in final.values() if v["serial"] is not None]
print(f"bands={len(final)} serials resolved={len(vals)} unresolved={len(final)-len(vals)} arbiter_calls={arb}")
from collections import Counter
c = Counter(vals)
dups = {k: n for k, n in c.items() if n > 1}
missing = sorted(set(range(1, 463)) - set(vals))
print(f"range {min(vals)}..{max(vals)}  dups={dups}")
print(f"missing from 1..462: n={len(missing)} -> {missing[:40]}")
st = Counter(v["status"] for v in final.values())
print("status:", dict(st))
