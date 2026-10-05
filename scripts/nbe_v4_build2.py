#!/usr/bin/env python3
"""NBE v4 Stage D — A/B RECONCILIATION + CHAIN ADJUDICATION + FINAL GATES.

Per row: amountsA (450dpi lines) vs amountsB (600dpi region read).
Chain coherence decides: movement candidates from A then B; the movement
that closes balance[i]-balance[i-1] exactly wins; direction by sign.
Gates re-run on the adjudicated table. Fail-loud: rows that cannot close
under ANY read are flagged (never guessed).
Output: v4_final.json (rows + gates)
"""
import json, re
from collections import Counter

WORK = "/home/z/my-project/scripts/alahly_work"
OPENING, CLOSING = 467515.43, 631182.24
PRT_D, PRT_C = 1341824.35, 1505491.16
N = 462

rowsA = json.load(open(f"{WORK}/v4_rows.json"))
passB = json.load(open(f"{WORK}/v4_rows_pB.json"))
try:
    passC = {int(k): v for k, v in json.load(open(f"{WORK}/v4_rows_pC.json")).items()}
except FileNotFoundError:
    passC = {}

DATE_M = re.compile(r"^(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})$")


def dnum(dmy):
    m = DATE_M.match(dmy or "")
    return (int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def flat(cands):
    """passB candidates: list of lines of vals -> best flat list per line."""
    return [v for line in cands for v in line] if cands else []


final_rows = []
for i, r in enumerate(rowsA):
    b_lines = passB.get(str(i), [])
    b_flat = flat(b_lines)
    c_flat = flat(passC.get(i, []))
    final_rows.append({
        "i": i, "page": r["page"], "band": r["band"], "serial": r["serial"],
        "date": r["dates"][0] if r["dates"] else None,
        "A": [a["v"] for a in r["amounts"]],
        "B": b_flat,
        "C": c_flat,
        "desc": r["desc"][:150],
        "attach": r.get("attach", 0),
        "src": r.get("amounts_src", "main"),
    })

# chain adjudication
solved = []
flags = []
prev = None
sum_d = sum_c = 0.0
for fr in final_rows:
    bal = mov = None
    direction = None
    cands = []
    if fr["A"]:
        cands.append(("A", fr["A"][-1], fr["A"][:-1]))
    if fr["B"]:
        cands.append(("B", fr["B"][-1], fr["B"][:-1]))
    if fr["C"]:
        cands.append(("C", fr["C"][-1], fr["C"][:-1]))
    if prev is None:
        # opening row: take first available balance
        for src, bal_c, movs in cands:
            if abs(bal_c - OPENING) < 0.005:
                bal, mov, direction = bal_c, None, "bf"
                used = src
                break
        else:
            bal = cands[0][1] if cands else None
            used = cands[0][0] if cands else None
        fr.update({"balance": bal, "movement": None, "dir": "bf", "used": used})
        if bal is None:
            flags.append({**fr, "why": "opening-unreadable"})
        prev = bal if bal is not None else OPENING
        solved.append(fr)
        continue
    delta = None
    chosen = None
    for src, bal_c, movs in cands:
        d = round(bal_c - prev, 2)
        hit = next((mv for mv in movs if abs(abs(d) - mv) < 0.005), None)
        if hit is not None:
            chosen = (src, bal_c, hit, d)
            break
    if chosen is None:
        # maybe balance correct but movement token lost -> if B has only balance
        for src, bal_c, movs in cands:
            if not movs:
                continue
        flags.append({**fr, "why": f"no-close prev={prev} A={fr['A']} B={fr['B']}"})
        # carry forward with A/B best guess balance (prefer A) but DO NOT sum
        bal = fr["A"][-1] if fr["A"] else (fr["B"][-1] if fr["B"] else None)
        prev = bal if bal is not None else prev
        fr.update({"balance": bal, "movement": None, "dir": "?", "used": "flagged"})
        solved.append(fr)
        continue
    src, bal, hit, d = chosen
    direction = "credit" if d > 0 else "debit"
    if direction == "credit":
        sum_c += hit
    else:
        sum_d += hit
    prev = bal
    fr.update({"balance": bal, "movement": hit, "dir": direction, "used": src})
    solved.append(fr)

# gates
reads = [r["serial"] for r in solved if r["serial"] is not None]
c = Counter(reads)
dups = {k: n for k, n in c.items() if n > 1}
missing = sorted(set(range(1, N + 1)) - set(reads))
mono_breaks = 0
last = 0
for r in solved:
    s = r["serial"]
    if s is None:
        continue
    if s <= last:
        mono_breaks += 1
    last = max(last, s)

closed = sum(1 for r in solved if r["dir"] in ("credit", "debit", "bf"))
unclosed = sum(1 for r in solved if r["dir"] == "?")
first_bal = next((r["balance"] for r in solved if r["balance"] is not None), None)
last_bal = next((r["balance"] for r in reversed(solved) if r["balance"] is not None), None)

bad_dates = 0
pd = None
for r in solved:
    cur = dnum(r["date"])
    if r["date"] and cur is None:
        bad_dates += 1
    if cur and pd and cur < pd:
        bad_dates += 1
    if cur:
        pd = cur

gates = {
    "rows_assembled": len(solved),
    "G1": {"serial_reads": len(reads), "dups": dups, "missing_n": len(missing),
           "missing_first30": missing[:30], "mono_breaks": mono_breaks},
    "G2": {"closed": closed, "unclosed": unclosed},
    "G3": {"parsed_D": round(sum_d, 2), "parsed_C": round(sum_c, 2),
           "printed_D": PRT_D, "printed_C": PRT_C,
           "D_match": abs(sum_d - PRT_D) < 0.005, "C_match": abs(sum_c - PRT_C) < 0.005},
    "G4": {"first": first_bal, "last": last_bal,
           "opening_match": first_bal == OPENING, "closing_match": last_bal == CLOSING},
    "G6": {"date_issues": bad_dates},
}
json.dump(solved, open(f"{WORK}/v4_final_rows.json", "w"))
json.dump({"gates": gates, "flags": flags[:150]}, open(f"{WORK}/v4_final.json", "w"), indent=1)
print(json.dumps(gates, indent=1))
print(f"\nflags: {len(flags)} (first 8):")
for f in flags[:8]:
    print("  i=%s s=%s %s" % (f["i"], f["serial"], f["why"][:90]))
