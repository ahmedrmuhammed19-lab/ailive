#!/usr/bin/env python3
"""Linear chain diagnostic over the 402 rows using:
- closed rows: balance from v4_final_rows.json (machine)
- flagged rows: balance = VISUAL (printed truth read by agent)
Prints every row's delta, token satisfaction, and flags the first hard break.
"""
import json

WORK = "/home/z/my-project/scripts/alahly_work"
PRT_D, PRT_C = 1341824.35, 1505491.16

final_rows = json.load(open(f"{WORK}/v4_final_rows.json"))
rowsA = json.load(open(f"{WORK}/v4_rows.json"))
passB = json.load(open(f"{WORK}/v4_rows_pB.json"))
passC = {int(k): v for k, v in json.load(open(f"{WORK}/v4_rows_pC.json")).items()}
flags = {f["i"]: f for f in json.load(open(f"{WORK}/v4_final.json"))["flags"]}

import importlib.util
spec = importlib.util.spec_from_file_location(
    "solver_vis", "/home/z/my-project/scripts/nbe_v4_solver.py")
# reuse VISUAL by parsing it out (avoid running the whole solver)
src = open("/home/z/my-project/scripts/nbe_v4_solver.py").read()
ns = {}
exec(src[src.index("VISUAL = {"):src.index("\ndef flat") + 1], {}, ns)
VISUAL = ns["VISUAL"]


def flat(cands):
    return [v for line in cands for v in line] if cands else []


prev = None
D = C = 0.0
problems = []
for i, r in enumerate(final_rows):
    A = [a["v"] for a in rowsA[i]["amounts"]]
    B = flat(passB.get(str(i), []))
    Cc = flat(passC.get(i, []))
    tokens, bal_machine = [], None
    for vals in (A, B, Cc):
        if vals:
            bal_machine = vals[-1]
            tokens += vals[:-1]
    if i in flags:
        bal = VISUAL[i][0]
    else:
        fr = final_rows[i]
        bal = fr.get("balance", bal_machine)
    if bal is None:
        problems.append((i, "NO BALANCE", tokens, None))
        prev = None
        continue
    if prev is None:
        prev = bal
        continue
    delta = round(bal - prev, 2)
    dirn = "debit" if delta < 0 else ("credit" if delta > 0 else "bf")
    mv = abs(delta)
    tok_ok = (not tokens) or any(abs(abs(delta) - t) <= 0.005 for t in tokens)
    if not tok_ok:
        problems.append((i, f"TOKEN MISMATCH delta={delta} tokens={tokens}",
                         flags[i]["desc"][:80] if i in flags else "", bal))
    if dirn == "debit":
        D += mv
    elif dirn == "credit":
        C += mv
    prev = bal

print("rows walked:", len(final_rows))
print("sumD:", round(D, 2), "vs printed", PRT_D, " residual", round(PRT_D - D, 2))
print("sumC:", round(C, 2), "vs printed", PRT_C, " residual", round(PRT_C - C, 2))
print("problems:", len(problems))
for p in problems[:20]:
    print("  ", p)
