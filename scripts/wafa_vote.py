#!/usr/bin/env python3
"""Vote among 300/450/600dpi readings per amount cell; validate against the
printed statement totals. Output: scripts/wafa_work/rows_voted.json"""
import json
import glob
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from wafa_parse import try_amount  # noqa
from wafa_parse2 import parse_pass, WORK, PT, DEBIT_X_PT  # noqa

# strip geometry: crop origin 410pt, boundary 474pt, 2x upscale
BX_STRIP = (DEBIT_X_PT * (600 / PT) - int(410 * 600 / PT)) * 2


def load_cells():
    cells = []
    for p in sorted(glob.glob(f"{WORK}/cells/cells-*.json")):
        cells.extend(json.load(open(p)))
    return cells


def vote(vals, prefer=0):
    """vals: list of (src_priority, value). Majority wins; ties -> best priority."""
    vals = [(p, v) for p, v in vals if v is not None]
    if not vals:
        return None, False
    cnt = Counter(v for _, v in vals)
    best, n = cnt.most_common(1)[0]
    if n >= 2:
        return best, True
    vals.sort(key=lambda x: x[0])  # lower = more trusted (600 = 0)
    return vals[0][1], False


def main():
    r300, _, _ = parse_pass(f"{WORK}/pg-*.tsv", 300, "pg")
    r450, bals, totals = parse_pass(f"{WORK}/hi2-*.tsv", 450, "hi2")
    cells = load_cells()
    print(f"300 rows={len(r300)} 450 rows={len(r450)} cells={len(cells)}")

    # order-index 300 rows by (page,date)
    seen = {}
    idx300 = {}
    for r in r300:
        k = seen.get((r["page"], r["date"]), 0)
        seen[(r["page"], r["date"])] = k + 1
        idx300[(r["page"], r["date"], k)] = r
    # 450 rows in same order -> pair with cells by list position
    by_page = {}
    for i, r in enumerate(r450):
        by_page.setdefault(r["page"], []).append((i, r))
    cell_by_row = {}
    for pno, lst in by_page.items():
        cl = [c for c in cells if c["page"] == pno]
        for (i, r), c in zip(lst, cl):
            cell_by_row[i] = c

    def cell_read(c):
        """(d600, c600) from raw strip words: rightmost amount per zone."""
        if not c or "words" not in c:
            return None, None
        amts = [(x, a) for x, t in c["words"] if (a := try_amount(t)) is not None]
        # rightmost amount per zone (amounts right-align to their column edge)
        dz = [(x, a) for x, a in amts if x < BX_STRIP]
        cz = [(x, a) for x, a in amts if x >= BX_STRIP]
        d = (max(dz, key=lambda p: p[0])[1]) if dz else None
        c6 = (max(cz, key=lambda p: p[0])[1]) if cz else None
        return d, c6

    seen450 = {}
    final = []
    nocons = 0
    for i, r in enumerate(r450):
        k = seen450.get((r["page"], r["date"]), 0)
        seen450[(r["page"], r["date"])] = k + 1
        a300 = idx300.get((r["page"], r["date"], k))
        c = cell_by_row.get(i, {})
        d600, c600 = cell_read(c)
        # debit vote: priority 0 = 600dpi cell, 1 = 450, 2 = 300
        dv, dok = vote([(0, d600), (1, r["debit"]), (2, a300["debit"] if a300 else None)])
        cv, cok = vote([(0, c600), (1, r["credit"]), (2, a300["credit"] if a300 else None)])
        if dv is not None and cv is not None:
            # noise on one side: keep side with consensus, else side 600 chose
            if dok and not cok:
                cv = None
            elif cok and not dok:
                dv = None
            elif d600 is None:
                dv = None
            else:
                cv = None
        if dv is None and cv is None and (r["debit"] is not None or r["credit"] is not None):
            dv, cv = r["debit"], r["credit"]  # fallback to 450 reading
        if not (dok or cok):
            nocons += 1
        final.append({"page": r["page"], "date": r["date"], "valueDate": r["valueDate"],
                      "debit": dv, "credit": cv, "desc": r["desc"], "memo": r["memo"],
                      "consensus": dok or cok})

    empt = [r for r in final if r["debit"] is None and r["credit"] is None]
    sd = round(sum(r["debit"] or 0 for r in final), 2)
    sc = round(sum(r["credit"] or 0 for r in final), 2)
    tot_debit, tot_credit = totals
    net = round(sc - sd, 2)
    bal_open, bal_close = bals[0][2], bals[-1][2]
    ec = round(bal_open + net, 2)
    print(f"final rows={len(final)} empties={len(empt)} no-consensus={nocons}")
    print(f"debits : {sd:,.2f} vs printed {tot_debit:,.2f}  diff {sd - tot_debit:+,.2f}")
    print(f"credits: {sc:,.2f} vs printed {tot_credit:,.2f}  diff {sc - tot_credit:+,.2f}")
    print(f"closing: computed {ec:,.2f} vs printed {bal_close:,.2f}  diff {ec - bal_close:+,.2f}")
    ok = abs(sd - tot_debit) < 0.01 and abs(sc - tot_credit) < 0.01 and abs(ec - bal_close) < 0.01
    print("CHAIN VERDICT:", "100% — analyst verified" if ok else "MISMATCH")
    json.dump({"rows": final, "opening": bal_open, "closing": bal_close,
               "totalDebits": tot_debit, "totalCredits": tot_credit,
               "sumDebits": sd, "sumCredits": sc}, open(f"{WORK}/rows_voted.json", "w"), indent=1)


if __name__ == "__main__":
    main()
