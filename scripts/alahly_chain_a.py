#!/usr/bin/env python3
"""Phase A — canonical chain walk: dump every FAILING segment with raw OCR
candidates from all 3 passes (450/600/900) so each can be attacked at cell level."""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
OPENING, CLOSING = 467525.43, 631182.24

d = json.load(open(f"{WORK}/report_data.json"))
rows = d["rows"]


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s or "")
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    neg = (s or "").startswith("-")
    return float(f"{'-' if neg else ''}{ip}.{m.group(2)}")


def raw_cands(page, y0, y1):
    """all numeric words from the 3 passes within y-span, with x + conf"""
    out = []
    for tag, fn, hfix in (("450", "page_%02d.json", 0),
                          ("600", "p600_%02d.json", 0),
                          ("900", "p900c_%02d.json", 20)):
        try:
            dd = json.load(open(f"{WORK}/{fn}" % page))
        except FileNotFoundError:
            continue
        words = dd["words"]
        for w in words:
            y = w["y"] + (hfix / 2 if hfix else w["h"] / 2)
            if y0 - 12 <= y < y1 + 12:
                v = fnum(w["t"])
                if v is not None:
                    out.append((tag, round(w["x"]), round(w["y"]), w["t"], v,
                                w.get("conf")))
    return sorted(out, key=lambda t: (t[0], t[2], t[1]))


# walk chain exactly as finalize2
fails = []
prev_bal = None
prev_row = None
pending = []
for e in rows:
    if e["bal"] is None:
        pending.append(e)
        continue
    if prev_bal is None:
        if abs(e["bal"] - OPENING) < 0.011 or e["src"] == "opening":
            print(f"OPEN p{e['page']} y{e['y']} bal {e['bal']:,.2f}")
        else:
            print(f"!! FIRST ROW NOT OPENING: {e['bal']}")
        prev_bal, prev_row, pending = e["bal"], e, []
        continue
    delta = round(e["bal"] - prev_bal, 2)
    amounts = [(p["amt"], p) for p in pending if p["amt"]] + \
              ([(e["amt"], e)] if e["amt"] else [])
    ok = False
    if len(amounts) == 1 and abs(abs(amounts[0][0]) - abs(delta)) <= 0.011:
        ok = True
    elif not amounts and 0 < abs(delta) <= 2000:
        ok = True
    elif abs(delta) <= 0.011:
        ok = True
    if not ok:
        y_lo = min([p["y"] for p in pending] + [e["y"]]) - 30
        y_hi = e["y"] + 40
        fails.append({
            "prev": {"page": prev_row["page"], "y": prev_row["y"], "bal": prev_bal},
            "next": {"page": e["page"], "y": e["y"], "bal": e["bal"], "date": e["date"],
                     "desc": (e["desc"] or "")[:80], "amt": e["amt"]},
            "delta": delta,
            "pending": [{"page": p["page"], "y": p["y"], "date": p["date"],
                         "desc": (p["desc"] or "")[:70], "amt": p["amt"],
                         "credit": p["credit"], "src": p["src"]} for p in pending],
            "y_lo": y_lo, "y_hi": y_hi,
        })
    prev_bal, prev_row, pending = e["bal"], e, []

print(f"\nFAILING SEGMENTS: {len(fails)}")
tot = 0.0
for i, f in enumerate(fails):
    miss = round(sum(p["signed"] or 0 for p in [] ), 2)  # placeholder
    print(f"\n=== SEG {i}  delta {f['delta']:>+15,.2f} ===")
    print(f"  prev bal p{f['prev']['page']} y{f['prev']['y']} = {f['prev']['bal']:,.2f}")
    print(f"  next bal p{f['next']['page']} y{f['next']['y']} = {f['next']['bal']:,.2f}  [{f['next']['date']}] {f['next']['desc'][:60]} amt={f['next']['amt']}")
    for p in f["pending"]:
        print(f"    row p{p['page']} y{p['y']} [{p['date']}] amt={p['amt']} cr={p['credit']} src={p['src']} :: {p['desc'][:60]}")
    if not f["pending"]:
        print("    (no pending rows — direct pair)")
json.dump(fails, open(f"{WORK}/fails_phase_a.json", "w"), ensure_ascii=False, indent=1)
print("\nWROTE fails_phase_a.json")

# also: the 13 rows with signed=None
nosign = [r for r in rows if r.get("signed") is None]
print(f"\nROWS WITH signed=None: {len(nosign)}")
for r in nosign:
    print(f"  p{r['page']} y{r['y']} [{r['date']}] amt={r['amt']} bal={r['bal']} src={r['src']} :: {(r['desc'] or '')[:60]}")
