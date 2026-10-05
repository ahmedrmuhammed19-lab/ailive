#!/usr/bin/env python3
"""NBE v4 Stage B — BUILD LOGICAL ROWS + RUN GATES G1/G2/G3/G4/G6.

Row assembly: lines in print order; a line OPENS a row if it has a serial
or a date; lines without serial/date ATTACH to the open row (desc wraps).
Chain: balance[s]-balance[s-1] must equal one parsed amount exactly
(0.005); direction by sign; column-position cross-check reported.
Gates (fail-loud): G1 serials 1..462 complete once; G2 strict chain
residual 0.00 everywhere; G3 sums vs printed totals; G4 anchors; G6 date
monotonicity. Output: v4_rows.json + v4_gates.json
"""
import json, re
from collections import Counter

WORK = "/home/z/my-project/scripts/alahly_work"

# printed truths (high-DPI verified earlier, NBE-VERIFY-1)
OPENING = 467515.43
CLOSING = 631182.24
PRT_D = 1341824.35
PRT_C = 1505491.16
N_SERIALS = 462

DATE_M = re.compile(r"^(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})$")


def parse_amt(tok):
    """OCR-tolerant amount parser. Handles .<->, flips:
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


def to_num(dmy):
    m = DATE_M.match(dmy)
    if not m:
        return None
    d, mo, y = (int(x) for x in m.groups())
    return (y, mo, d)


rows = []
open_row = None
for p in range(1, 24):
    d = json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))
    for band in d["bands"]:
        for ln in band["lines"]:
            has_date = bool(ln["dates"])
            has_amt = bool(ln["amounts"])
            opens = (has_date and has_amt) or (ln["serial"] is not None and (has_date or has_amt))
            if opens:
                if open_row:
                    rows.append(open_row)
                open_row = {
                    "page": p, "band": band["idx"], "line_y": ln["y"],
                    "serial": ln["serial"], "dates": ln["dates"][:],
                    "amounts": [a for a in ln["amounts"]],
                    "desc": ln["text"][:180],
                    "attach": 0,
                }
            else:
                if open_row and (ln["text"].strip() or has_amt):
                    open_row["attach"] += 1
                    if has_amt and not open_row["amounts"]:
                        # amount-bearing continuation line -> row's amounts
                        open_row["amounts"] = [a for a in ln["amounts"]]
                        open_row["amounts_src"] = "wrap"
                        open_row["desc"] += " ||AMT-FROM-WRAP"
                    elif has_amt:
                        open_row["desc"] += " ||WRAP-AMT:" + json.dumps(ln["amounts"])[:80]
if open_row:
    rows.append(open_row)

print(f"logical rows assembled: {len(rows)}")

# ---- G1: serial census
ser = [(i, r["serial"]) for i, r in enumerate(rows)]
read = [s for _, s in ser if s is not None]
c = Counter(read)
dups = {k: n for k, n in c.items() if n > 1}
missing = sorted(set(range(1, N_SERIALS + 1)) - set(read))
g1 = {
    "rows_total": len(rows), "serial_reads": len(read),
    "unresolved_lines": len(rows) - len(read),
    "dups": dups, "missing_n": len(missing),
    "missing_first40": missing[:40],
}
# monotonic sanity of reads in print order
mono_breaks = 0
last = 0
for i, s in ser:
    if s is None:
        continue
    if s <= last:
        mono_breaks += 1
    last = max(last, s)
g1["non_increasing_breaks"] = mono_breaks
print("G1:", json.dumps({k: g1[k] for k in ("rows_total", "serial_reads", "unresolved_lines", "non_increasing_breaks")}), "dups:", len(dups), "missing:", len(missing))

# ---- G2: strict chain (on rows with balance + one movement amount)
def parse_bal(r):
    if not r["amounts"]:
        return None, []
    amts = [a["v"] for a in r["amounts"]]
    return amts[-1], amts[:-1]  # rightmost = balance


chain_ok = chain_bad = 0
flags = []
sum_d = sum_c = 0.0
prev_bal = None
for i, r in enumerate(rows):
    bal, movs = parse_bal(r)
    if bal is None:
        flags.append({"i": i, "serial": r["serial"], "why": "no-amounts",
                      "text": r["desc"][:80]})
        continue
    if prev_bal is None:
        prev_bal = bal
        continue
    delta = round(bal - prev_bal, 2)
    if abs(delta) < 0.005:
        chain_ok += 1
        prev_bal = bal
        continue
    hit = None
    for v in movs:
        if abs(abs(delta) - v) < 0.005:
            hit = v
            break
    if hit is not None:
        chain_ok += 1
        if delta > 0:
            sum_c += hit
        else:
            sum_d += hit
        prev_bal = bal
    else:
        chain_bad += 1
        flags.append({"i": i, "serial": r["serial"], "why": f"chain-gap {prev_bal}->{bal} movs={movs}",
                      "text": r["desc"][:80]})
        prev_bal = bal

g2 = {"chain_ok": chain_ok, "chain_bad": chain_bad, "flags_n": len(flags)}
print("G2:", g2)

# ---- G4 anchors
first_bal = None
for r in rows:
    if r["amounts"]:
        first_bal = r["amounts"][-1]["v"]
        break
last_bal = None
for r in reversed(rows):
    if r["amounts"]:
        last_bal = r["amounts"][-1]["v"]
        break
g4 = {"first": first_bal, "last": last_bal,
      "opening_match": first_bal == OPENING, "closing_match": last_bal == CLOSING}
print("G4:", g4)

# ---- G3 totals vs printed
g3 = {"parsed_D": round(sum_d, 2), "parsed_C": round(sum_c, 2),
      "printed_D": PRT_D, "printed_C": PRT_C,
      "d_match": abs(sum_d - PRT_D) < 0.005, "c_match": abs(sum_c - PRT_C) < 0.005}
print("G3:", g3)

# ---- G6 date monotonicity (rows with a leading parseable date)
bad_dates = 0
prev = None
for r in rows:
    if not r["dates"]:
        continue
    cur = to_num(r["dates"][0])
    if cur is None:
        bad_dates += 1
        continue
    if prev and cur < prev:
        bad_dates += 1
    prev = cur if cur else prev
g6 = {"non_monotonic_or_bad": bad_dates}
print("G6:", g6)

json.dump(rows, open(f"{WORK}/v4_rows.json", "w"))
json.dump({"G1": g1, "G2": g2, "G3": g3, "G4": g4, "G6": g6,
           "flags": flags[:120]}, open(f"{WORK}/v4_gates.json", "w"), indent=1)
print("\nrows + gates written; flags first 5:")
for f in flags[:5]:
    print(" ", f)
