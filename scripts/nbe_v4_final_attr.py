#!/usr/bin/env python3
"""NBE v4 FINAL ATTRIBUTION — print-sign-correct D/C bucketing (AUDIT-1).

Rules established from full-res print evidence (G9 adversarial audit):
  R-A  delta < 0                     -> Debit  += |delta|
  R-B  delta > 0, credit-col token   -> Credit += delta
  R-C  delta > 0, VERIFIED reversal  -> Debit -= delta   (bank prints reversals
       as minus amounts INSIDE its Debit column; they reduce the bank's D total)
  R-D  delta > 0 otherwise           -> Credit += delta (true incoming)
Absorption recoveries (mixed-direction merges, amounts re-split from print):
  s209-s213 zone: +100.00 both sides   (s209 credit 100 netted into debit run)
  s339-s341 zone: D += 370.50, C += 320.50
  s348-s349 zone: +205.83 both sides
Merged reversal zones (fee+reversal nets counted as C by delta sign):
  i=9(s10) 1,499-pairs at i=121/i=122, i=127, i=140, i=239 — each C-=d, D-=d.
"""
import json

WORK = "/home/z/my-project/scripts/alahly_work"
PRT_D, PRT_C = 1341824.35, 1505491.16

final_rows = json.load(open(f"{WORK}/v4_final_rows.json"))
rowsA = json.load(open(f"{WORK}/v4_rows.json"))
src = open("/home/z/my-project/scripts/nbe_v4_solver.py").read()
ns = {}
exec(src[src.index("VISUAL = {"):src.index("\ndef flat") + 1], {}, ns)
VISUAL = ns["VISUAL"]

# 38 rows verified as minus-printed debit-column reversals (reversal_check_0/1.png)
# Pure reversals: walk buckets +delta into C; bank signs them INTO D as negatives.
# Correction per row: D -= d (C never receives them in this loop).
REVERSALS = {1, 2, 10, 18, 19, 20, 21, 26, 27, 30, 31, 34, 35, 39, 40, 64,
             65, 68, 69, 72, 73, 89, 90, 91, 92, 97, 98, 121, 124, 128, 129,
             134, 135, 138, 139, 144, 145, 180, 181}
# Merged reversal-net zones verified on page prints: the walk's positive delta
# is the NET of (reversals + a real fee). Bank signed-D = zone net (negative);
# walk put the net in C. Correction: C -= d AND D -= d.
MERGED_REV = {9: 9.80, 122: 1499.00, 127: 0.50, 140: 1499.00}
# Zone with a WRONG machine balance (i=238 read 151,389.78; print s259=151,391.78):
# i=239's true movement is 1.64 DEBIT but walk delta = +0.36 (C).
# Correction: D += 0.36, C -= 0.36.
ZONE_239 = {"D": -0.36, "C": -0.36}  # bank signed-D = -0.36 (rev 2,000 outweighs)
# absorption recoveries (mixed-direction merges re-split from print)
ABS_D = {198: 100.00, 318: 370.50, 324: 205.83}
ABS_C = {198: 100.00, 318: 320.50, 324: 205.83}

deltas = {}
for i in range(1, len(final_rows)):
    bal = VISUAL[i][0] if i in VISUAL else final_rows[i].get("balance")
    prev = VISUAL[i - 1][0] if (i - 1) in VISUAL else final_rows[i - 1].get("balance")
    deltas[i] = None if (bal is None or prev is None) else round(bal - prev, 2)

D = C = 0.0
unattributed = []
for i, d in deltas.items():
    if d is None or abs(d) < 0.005:
        continue
    if d < 0:
        D += -d
        continue
    amts = rowsA[i]["amounts"]
    c_own = [a["v"] for a in amts if 0.60 <= a["cx"] < 0.72]
    if i in REVERSALS:
        D -= d
    elif i in MERGED_REV:
        D -= d
        C -= d
    elif any(abs(d - v) <= 0.005 for v in c_own):
        C += d
    else:
        C += d
        unattributed.append((i, d))
for i, v in ABS_D.items():
    D += v
for i, v in ABS_C.items():
    C += v
D += ZONE_239["D"]
C += ZONE_239["C"]

print("attribution: D=%.2f  C=%.2f" % (D, C))
print("printed:     D=%.2f  C=%.2f" % (PRT_D, PRT_C))
print("residual:    D=%+.2f  C=%+.2f" % (PRT_D - D, PRT_C - C))
print("positive-delta rows bucketed as credit without token match:", len(unattributed))
for i, d in unattributed:
    print("   i=%3d +%10.2f  %s" % (i, d, (final_rows[i].get("desc") or "")[:56]))
