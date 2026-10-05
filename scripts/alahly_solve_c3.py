#!/usr/bin/env python3
"""Phase C3 — column-strip token extraction: ALL numeric tokens in amount band
and balance band (1200dpi full-page TSVs), y-sorted, aligned to date-anchor row
spans. Row's amount = topmost token in span; row's balance = bottom-most token
in span (NBE prints balance on row end-line)."""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/solveC"
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
MONEY = re.compile(r"^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^-?\d+[.,]\d{2}$")


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s or "")
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    neg = (s or "").startswith("-")
    return float(f"{'-' if neg else ''}{ip}.{m.group(2)}")


PAGES = [3, 4, 9, 10, 13, 16, 17, 18, 20]
out = {}
for page in PAGES:
    words = []
    with open(f"{OUT}/full_p{page:02d}.tsv") as fh:
        next(fh)
        for line in fh:
            c = line.rstrip("\n").split("\t")
            if len(c) < 12 or not c[11].strip():
                continue
            words.append({"l": int(c[6]), "t": int(c[7]), "w": int(c[8]),
                          "h": int(c[9]), "conf": float(c[10]), "x": c[11]})
    dates = sorted([w for w in words if DATE_RE.match(w["x"]) and
                    850 <= w["l"] < 1500 and w["conf"] > 30],
                   key=lambda w: w["t"])
    anchors = []
    for d in dates:
        if anchors and abs(d["t"] - anchors[-1]["t"]) < 90:
            continue
        anchors.append(d)
    amts = sorted([w for w in words if 4450 <= w["l"] < 5800 and fnum(w["x"]) is not None],
                  key=lambda w: w["t"])
    bals = sorted([w for w in words if 7150 <= w["l"] < 8250 and fnum(w["x"]) is not None],
                  key=lambda w: w["t"])
    rows = []
    for i, a in enumerate(anchors):
        y0 = a["t"] - 60
        y1 = anchors[i + 1]["t"] - 60 if i + 1 < len(anchors) else 10**9
        sa = [w for w in amts if y0 <= w["t"] < y1]
        sb = [w for w in bals if y0 <= w["t"] < y1]
        rows.append({
            "i": i, "date": a["x"], "y": a["t"],
            "amts": [(w["x"], round(w["t"]), round(w["conf"])) for w in sa],
            "bals": [(w["x"], round(w["t"]), round(w["conf"])) for w in sb],
            "amt_pick": sa[0]["x"] if sa else None,
            "bal_pick": sb[-1]["x"] if sb else None,
        })
    out[page] = rows
    print(f"\n===== PAGE {page} ({len(rows)} rows) =====")
    for r in rows:
        amt_s = " | ".join(f"{t}@y{y}c{cf}" for t, y, cf in r["amts"])
        bal_s = " | ".join(f"{t}@y{y}c{cf}" for t, y, cf in r["bals"])
        print(f" r{r['i']:02d} y={r['y']:5d} [{r['date']}]")
        print(f"     AMT: {amt_s or '—'}")
        print(f"     BAL: {bal_s or '—'}")
json.dump(out, open(f"{OUT}/colscan.json", "w"), ensure_ascii=False, indent=1)
print("\nWROTE colscan.json")
