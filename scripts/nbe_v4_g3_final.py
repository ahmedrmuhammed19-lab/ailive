#!/usr/bin/env python3
"""NBE v4 G3 FINAL RECONCILIATION — line-capture + print-verified recoveries.

true_D = capture_unsigned - 2*(captured reversal values) + (missing lines' signed debits)
true_C = capture_credit + (missing credit lines)

All recovered amounts are from full-resolution page/band reads (G9 audit),
chain-verified against neighbouring printed balances.
"""
import json
from collections import Counter

WORK = "/home/z/my-project/scripts/alahly_work"
PRT_D, PRT_C = 1341824.35, 1505491.16

# ---- line-level capture (debit column unsigned, credit column) ----
cap_d = {p: Counter() for p in range(1, 24)}
cap_c = {p: Counter() for p in range(1, 24)}
for p in range(1, 24):
    d = json.load(open(f"{WORK}/v4_lines_p{p:02d}.json"))
    for b in d["bands"]:
        for l in b["lines"]:
            for a in l["amounts"]:
                if 0.48 <= a["cx"] < 0.60:
                    cap_d[p][a["v"]] += 1
                elif 0.60 <= a["cx"] < 0.72:
                    cap_c[p][a["v"]] += 1
sum_d_unsigned = sum(v * n for p in cap_d for v, n in cap_d[p].items())
sum_c = sum(v * n for p in cap_c for v, n in cap_c[p].items())

# ---- verified minus-printed reversals (page, value) from full-res reads ----
REVERSALS = [
    (1, 10.00), (1, 10000.00), (1, 9.80), (1, 9800.00),
    (3, 6.50), (3, 6500.00),
    (4, 0.50), (4, 5.37), (4, 5370.00), (4, 5350.00), (4, 5.35), (4, 5.30), (4, 5300.00),
    (5, 0.50), (5, 500.00), (5, 1.00), (5, 1000.00), (5, 0.50), (5, 500.00),
    (7, 1500.00), (7, 0.50), (7, 500.00), (7, 0.50), (7, 300.00),
    (7, 3.00), (7, 3000.00), (7, 1.00), (7, 1000.00), (7, 2.50), (7, 2500.00),
    (8, 1.50), (8, 1500.00), (8, 2.00), (8, 2000.00),
    (10, 3.00), (10, 3000.00),
    (13, 2.00), (13, 2000.00),
]
cap_rev, miss_rev = [], []
for p, v in REVERSALS:
    if cap_d[p][v] > 0:
        cap_d[p][v] -= 1
        cap_rev.append((p, v))
    else:
        miss_rev.append((p, v))
sum_cap_rev = sum(v for _, v in cap_rev)

# ---- missing lines recovered from page reads (signed debit / credit) ----
MISSING = [
    # page, signed debit, credit, serial, source
    (10, 8300.00, 0, "s210", "p10 stamp zone"),
    (10, 448.00, 0, "s211", "p10 stamp zone"),
    (10, 8588.00, 0, "s212", "p10 stamp zone"),
    (10, 0, 100.00, "s209", "p10 stamp zone (credit)"),
    (11, 20.00, 0, "s228", "p11 bottom"),
    (11, 70000.00, 0, "s229", "p11 bottom"),
    (11, 20.00, 0, "s230", "p11 bottom"),
    (13, 2000.00, 0, "s257", "p13 merge"),
    (13, -2.00, 0, "s258", "p13 reversal"),
    (13, -2000.00, 0, "s259", "p13 reversal"),
    (17, 1000.00, 0, "s346", "p17 absorbed"),
    (17, 1500.00, 0, "s348", "p17 absorbed"),
    (17, 290.00, 0, "s352", "p17 absorbed"),
    (17, 0.95, 0, "s355", "p17 absorbed"),
    (17, 950.00, 0, "s356", "p17 absorbed"),
    (17, 0.50, 0, "s342", "p17 absorbed"),
    (17, 0.50, 0, "s344", "p17 absorbed"),
    (17, 0.50, 0, "s350", "p17 absorbed"),
    (17, 0.50, 0, "s351", "p17 absorbed"),
    (17, 0.50, 0, "s353", "p17 absorbed"),
    (18, 300.00, 0, "s358", "p18 absorbed"),
    (18, 0.50, 0, "s359", "p18 absorbed"),
    (22, 5073.00, 0, "s442", "p22 absorbed"),
    (22, 0.50, 0, "s443", "p22 absorbed"),
    (22, 600.00, 0, "s444", "p22 absorbed"),
    (22, 1.00, 0, "s445", "p22 absorbed"),
    (22, 1000.00, 0, "s446", "p22 absorbed"),
    (22, 0.50, 0, "s447", "p22 absorbed"),
    (22, 500.00, 0, "s448", "p22 absorbed"),
    (22, 0.50, 0, "s441", "p21 bottom"),
]
miss_d = sum(r[1] for r in MISSING)
miss_c = sum(r[2] for r in MISSING)

true_D = sum_d_unsigned - 2 * sum_cap_rev + miss_d
true_C = sum_c + miss_c

print("capture: D_unsigned=%.2f  C=%.2f" % (sum_d_unsigned, sum_c))
print("captured reversals: %d  sum=%.2f" % (len(cap_rev), sum_cap_rev))
print("missing reversals (line absent): %s" % miss_rev)
print("recovered lines: %d  signed_D=%.2f  C=%.2f" % (len(MISSING), miss_d, miss_c))
print()
print("TRUE: D=%.2f  C=%.2f" % (true_D, true_C))
print("PRINT: D=%.2f  C=%.2f" % (PRT_D, PRT_C))
print("RESIDUAL: D=%+.2f  C=%+.2f" % (PRT_D - true_D, PRT_C - true_C))
