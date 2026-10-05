#!/usr/bin/env python3
"""Phase C2 — align cell reads (1200dpi) with v8 ledger rows on affected pages.
Print side-by-side: ledger row vs cell reads, to rebuild each failing segment."""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
d = json.load(open(f"{WORK}/report_data.json"))
rows = d["rows"]
cells = json.load(open(f"{WORK}/solveC/cells_pages.json"))

V_OPEN, V_CLOSE = 467525.43, 631182.24


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s or "")
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    neg = (s or "").startswith("-")
    return float(f"{'-' if neg else ''}{ip}.{m.group(2)}")


# ledger walk to mark verified rows (same as finalize2)
prev_bal = None
pending = []
ledger = []
for e in rows:
    if e["bal"] is None:
        pending.append(e)
        ledger.append((e, None, "pending"))
        continue
    if prev_bal is None:
        ledger.append((e, True, "opening" if abs(e["bal"] - V_OPEN) < 0.011 else "first"))
        prev_bal, pending = e["bal"], []
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
    ledger.append((e, ok, f"delta={delta:,.2f}"))
    prev_bal, pending = e["bal"], []

for page in (3, 4, 9, 10, 13, 16, 17, 18, 20):
    print(f"\n{'='*100}\nPAGE {page}")
    print(f"{'y450':>5} {'y1200':>6} | LEDGER (v8) {'':38s} | CELL 1200dpi reads")
    led = [(e, st, info) for e, st, info in ledger if e["page"] == page]
    cl = cells.get(str(page), [])
    used = set()
    for e, st, info in led:
        y450 = round((e["y"] or 0))
        # nearest cell row
        near = None
        for i, c in enumerate(cl):
            y450c = round(c["y1200"] / (1200 / 450))
            if i in used:
                continue
            if abs(y450c - y450) <= 45:
                near = (i, c)
                used.add(i)
                break
        cstr = ""
        if near:
            i, c = near
            cstr = (f"y={c['y1200']:5d} [{c['date']}] amt={c['amt_txt']!r:>14s} "
                    f"bal={c['bal_txt']!r:>14s} ref={c['ref'][:18]}")
        print(f"{y450:5d} {'':6s} | [{e['date'] or '':10s}] amt={e['amt']!s:>10s} "
              f"bal={e['bal']!s:>12s} {st!s:7s} {info:18s} | {cstr}")
        print(f"      |   src={e['src']:8s} {(e['desc'] or '')[:58]:58s} |")
    # unmatched cell rows
    for i, c in enumerate(cl):
        if i not in used:
            print(f"  CELL-ONLY: y={c['y1200']:5d} [{c['date']}] amt={c['amt_txt']!r} "
                  f"bal={c['bal_txt']!r} ref={c['ref'][:20]}")
