#!/usr/bin/env python3
"""Phase E — FULL CHAIN WALK of the final ledger.
Rule: for consecutive rows with printed balances, delta must equal the sum of
signed amounts in between (rows without printed balance are pending).
Report: closed pairs, failures, telescope check, flow masses."""
import json

WORK = "/home/z/my-project/scripts/alahly_work"
OPENING, CLOSING = 467525.43, 631182.24

d = json.load(open(f"{WORK}/final_ledger.json"))
rows = d["rows"]

# sort by (page, y)
rows.sort(key=lambda r: (r["page"], r["y"] or 0))

fails = []
prev_bal = OPENING
prev_ref = "OPENING"
pending = []
closed = 0
total_pairs = 0

for idx, r in enumerate(rows):
    if r["bal"] is None:
        pending.append(r)
        continue
    total_pairs += 1
    delta = round(r["bal"] - prev_bal, 2)
    sums = round(sum(p["signed"] or 0 for p in pending) +
                 (r["signed"] or 0), 2)
    if abs(delta - sums) <= 0.011:
        closed += 1
    else:
        fails.append({
            "after": prev_ref, "at": f"p{r['page']} y{r['y']} [{r['date']}] {r['desc'][:60]}",
            "prev_bal": prev_bal, "bal": r["bal"], "delta": delta, "sum": sums,
            "gap": round(delta - sums, 2),
            "pending": [f"p{p['page']} y{p['y']} {p['desc'][:40]} amt={p['amt']}" for p in pending],
        })
    prev_bal = r["bal"]
    prev_ref = f"p{r['page']} y{r['y']}"
    pending = []

# closing check
final_bal = prev_bal
telescope_ok = abs(final_bal - CLOSING) < 0.011

print(f"total rows: {len(rows)}")
print(f"printed-balance rows: {total_pairs}")
print(f"closed pairs: {closed}")
print(f"FAILED pairs: {len(fails)}")
print(f"final balance: {final_bal:,.2f}  (target {CLOSING:,.2f})  telescope: {'OK' if telescope_ok else 'FAIL'}")
for f in fails[:20]:
    print(f"\nFAIL after {f['after']}")
    print(f"  at {f['at']}")
    print(f"  prev={f['prev_bal']:,.2f} bal={f['bal']:,.2f} delta={f['delta']:,.2f} sum={f['sum']:,.2f} GAP={f['gap']:,.2f}")
    for p in f["pending"]:
        print(f"    pending: {p}")
