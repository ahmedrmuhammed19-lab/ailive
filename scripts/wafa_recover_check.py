#!/usr/bin/env python3
"""WAFA-RECOVER-1: compare the regenerated rows_ledger.json against the
worklog-recorded figures of the original (delivered) analysis, to judge
fidelity of the recovered edition."""
import json, re
from collections import defaultdict

WORK = "/home/z/my-project/scripts/wafa_work"
led = json.load(open(f"{WORK}/rows_ledger.json"))
rows = led["rows"]

# worklog-recorded (original delivered edition) figures
ORIG = {
    "instant_out_n": 687, "instant_out_sum": 2796973.25,
    "reversal_n": 92, "reversal_sum": 423040.65,
    "big_ge_100k": 8,
    "opening": 545904.67, "closing": 523295.93,
    "printed_d": 4122781.15, "printed_c": 4100172.41,
    "orig_ledger_d": 4073809.19, "orig_ledger_c": 4089085.77,
}

def cat(r):
    full = ((r.get("desc") or "") + " " + " ".join(r.get("memo") or [])).upper()
    if "REVERSAL" in full: return "reversal"
    if "INSTANT TRANSFER" in full:
        return "instant_in" if ("PROM" in full or "FROM" in full) and "TO" not in full else "instant_out"
    if "CASH DEPOSIT" in full: return "cash_dep"
    if "CASH WITHDRAWAL" in full: return "cash_wd"
    if "CHEQUE" in full and ("COLLECT" in full or "INWARD" in full): return "chq_in"
    if "CHEQUE" in full: return "chq_out"
    if "ACH" in full: return "ach"
    return "other"

cat_n, cat_sum = defaultdict(int), defaultdict(float)
for r in rows:
    c = cat(r)
    cat_n[c] += 1
    cat_sum[c] += (r.get("debit") or 0) + (r.get("credit") or 0)

sd = round(sum(r.get("debit") or 0 for r in rows), 2)
sc = round(sum(r.get("credit") or 0 for r in rows), 2)
print(f"rows={len(rows)}  D={sd:,.2f} ({sd/ORIG['printed_d']*100:.2f}% of printed)  "
      f"C={sc:,.2f} ({sc/ORIG['printed_c']*100:.2f}% of printed)")
print(f"orig ledger: D={ORIG['orig_ledger_d']:,.2f}  C={ORIG['orig_ledger_c']:,.2f}")
print(f"delta vs orig ledger: D{sd-ORIG['orig_ledger_d']:+,.2f}  C{sc-ORIG['orig_ledger_c']:+,.2f}")
print("--- categories (current vs worklog) ---")
print(f"instant_out : n={cat_n['instant_out']} (orig 687)  sum={cat_sum['instant_out']:,.2f} (orig {ORIG['instant_out_sum']:,.2f})")
print(f"instant_in  : n={cat_n['instant_in']}  sum={cat_sum['instant_in']:,.2f}")
print(f"reversal    : n={cat_n['reversal']} (orig 92)  sum={cat_sum['reversal']:,.2f} (orig {ORIG['reversal_sum']:,.2f})")
print(f"cash_dep    : n={cat_n['cash_dep']}  sum={cat_sum['cash_dep']:,.2f}")
print(f"chq_in      : n={cat_n['chq_in']}  sum={cat_sum['chq_in']:,.2f}")
print(f"chq_out     : n={cat_n['chq_out']}  sum={cat_sum['chq_out']:,.2f}")
print(f"ach         : n={cat_n['ach']}  sum={cat_sum['ach']:,.2f}")
big = [((r.get("debit") or 0) + (r.get("credit") or 0), r) for r in rows]
big = [b for b in big if b[0] >= 100000]
print(f"txns >= 100k: {len(big)} (orig 8)")
for v, r in sorted(big, key=lambda x: -x[0]):
    print(f"   {v:>12,.2f}  p{r['page']:02d} {r.get('date','')} {(r.get('desc') or '')[:40]}")

# monthly buckets
mon = defaultdict(lambda: [0, 0.0, 0.0])
for r in rows:
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", r.get("date") or "")
    if not m: continue
    key = f"{m.group(3)}-{m.group(2)}"
    mon[key][0] += 1
    mon[key][1] += r.get("debit") or 0
    mon[key][2] += r.get("credit") or 0
print("--- monthly buckets ---")
for k in sorted(mon):
    n, d, c = mon[k]
    print(f"  {k}: n={n:4d}  D={d:,.2f}  C={c:,.2f}")
