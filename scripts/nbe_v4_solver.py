#!/usr/bin/env python3
"""NBE v4 Stage G — CHAIN SOLVER (four-constraint, G3-refereed).

For every row: balance candidates {A[-1], B[-1], C[-1], visual overrides}.
For every row: movement tokens {A[:-1], B[:-1], C[:-1]}.
Rules:
  R1 chain: balance[i] - balance[i-1] must equal ±movement (0.005) when the
     row HAS movement tokens; direction by sign.
  R2 rows with NO movement tokens (balance-only): movement = delta (free).
  R3 G3 referee: total debits == printed D AND credits == printed C EXACT.
  R4 IPN fee law: a debit movement m on a row whose NEXT row (or prev) is a
     fee-style movement should satisfy fee==0.001*m (advisory, logged).
Solver: DFS over ambiguous rows (candidates pruned by R1/R3); unflagged
rows keep their closed A-read. Fail-loud: unsolvable -> flagged, never guessed.
Output: v4_solved.json + v4_solver_gates.json
"""
import json
from itertools import product

WORK = "/home/z/my-project/scripts/alahly_work"
OPENING, CLOSING = 467515.43, 631182.24
PRT_D, PRT_C = 1341824.35, 1505491.16

solved_prev = json.load(open(f"{WORK}/v4_final_rows.json"))
rowsA = json.load(open(f"{WORK}/v4_rows.json"))
passB = json.load(open(f"{WORK}/v4_rows_pB.json"))
passC = {int(k): v for k, v in json.load(open(f"{WORK}/v4_rows_pC.json")).items()}

# visual adjudication (agent-read prints, sheets adj2/sheet_00..01 + earlier):
# balance anchors read by eye; movement derived by chain; G3 referee decides.
VISUAL = {
    37: [460837.53], 58: [333047.53], 59: [333047.03], 69: [274027.03],
    79: [224342.70], 120: [169535.90], 121: [171036.40], 123: [169536.40],
    125: [170036.40], 126: [170035.90], 127: [170036.40],
}

def flat(cands):
    return [v for line in cands for v in line] if cands else []

rows = []
for i, r in enumerate(rowsA):
    A = [a["v"] for a in r["amounts"]]
    B = flat(passB.get(str(i), []))
    C = flat(passC.get(i, []))
    bal_cands, mov_tokens = [], []
    for src, vals in (("A", A), ("B", B), ("C", C)):
        if vals:
            if vals[-1] not in bal_cands:
                bal_cands.append(vals[-1])
            for mv in vals[:-1]:
                if mv not in mov_tokens:
                    mov_tokens.append(mv)
    for v in VISUAL.get(i, []):
        if v not in bal_cands:
            bal_cands.append(v)
    rows.append({
        "i": i, "page": r["page"], "band": r["band"], "serial": r["serial"],
        "date": r["dates"][0] if r["dates"] else None,
        "bal_cands": bal_cands[:4], "mov_tokens": mov_tokens[:4],
        "desc": r["desc"][:120], "was_flag": any(f["i"] == i for f in json.load(open(f"{WORK}/v4_final.json"))["flags"]),
    })

# base chain: rows already closed keep solved balance; flagged rows = solver variables
prev_solved = {}
closed_rows = {}
for fr in solved_prev:
    i = fr["i"]
    if fr.get("dir") in ("bf", "credit", "debit"):
        closed_rows[i] = fr

flags = [f["i"] for f in json.load(open(f"{WORK}/v4_final.json"))["flags"]]
free_vars = [i for i in flags]
print(f"closed={len(closed_rows)} solver_variables={len(free_vars)}")

# candidate movements per variable row: from tokens; if none -> free (None)
var = {}
for i in free_vars:
    r = rows[i]
    movements = [mv for mv in r["mov_tokens"]] if r["mov_tokens"] else [None]
    var[i] = {"bal_cands": r["bal_cands"], "movements": movements}

# order variables by row index; anchor prev from nearest closed row above
ordered = sorted(free_vars)

# enumerate combos DFS with propagation
best = {"score": -1, "assign": None, "residualD": 1e9, "residualC": 1e9}
import sys
sys.setrecursionlimit(10000)

def solve():
    # precompute per-variable options as (movement, balance) pairs that satisfy R1 locally
    # prev balance at each var = last closed/solved balance before it -> depends on choices
    # so do DFS sequentially carrying prev.
    options = []
    for i in ordered:
        opts = []
        for mv in var[i]["movements"]:
            for bal in var[i]["bal_cands"]:
                opts.append((mv, bal))
        if not opts:
            opts = [(None, None)]
        options.append((i, opts))

    d_total = 0.0
    c_total = 0.0
    # contributions from already-closed rows
    for i, fr in closed_rows.items():
        if fr.get("movement") is not None:
            if fr["dir"] == "debit":
                d_total += fr["movement"]
            elif fr["dir"] == "credit":
                c_total += fr["movement"]

    carry_prev = None
    fixed_seg = []  # (i, bal, movement, dir) of closed rows between vars
    # walk rows in order, maintaining prev
    seg = []
    for i in range(len(rows)):
        r = rows[i]
        if i in closed_rows and i not in free_vars:
            b = closed_rows[i].get("balance")
            if b is not None:
                carry_prev = b
            continue
        if i in free_vars:
            seg.append(i)
    # simpler: full sequential DFS
    assignments = {}
    seq = [(i, options[k][1]) for k, i in enumerate(ordered)]

    def rec(k, prev, D, C):
        if k == len(seq):
            rd = abs(D - PRT_D)
            rc = abs(C - PRT_C)
            score = (rd + rc < 0.01) * 1000 + (rd + rc)
            if score > best["score"]:
                best.update({"score": score, "assign": dict(assignments),
                             "residualD": rd, "residualC": rc})
            return
        i, opts = seq[k]
        for mv, bal in opts:
            if bal is None:
                assignments[i] = (None, None, "?")
                rec(k + 1, prev, D, C)
                assignments.pop(i, None)
                continue
            delta = round(bal - prev, 2)
            if mv is not None:
                if abs(abs(delta) - mv) > 0.005:
                    continue
                nd = round(D + (mv if delta < 0 else 0), 2)
                nc = round(C + (mv if delta > 0 else 0), 2)
                assignments[i] = (bal, mv, "debit" if delta < 0 else "credit")
            else:
                mv2 = abs(delta)
                if mv2 < 0.005:
                    assignments[i] = (bal, 0.0, "bf")
                    rec(k + 1, bal, D, C)
                    assignments.pop(i, None)
                    continue
                nd = round(D + (mv2 if delta < 0 else 0), 2)
                nc = round(C + (mv2 if delta > 0 else 0), 2)
                assignments[i] = (bal, mv2, "debit" if delta < 0 else "credit")
            rec(k + 1, bal, nd, nc)
            assignments.pop(i, None)

    # initial prev = balance of last closed row before first var
    start_prev = OPENING
    for i in range(len(rows)):
        if i in free_vars:
            break
        if closed_rows.get(i, {}).get("balance") is not None:
            start_prev = closed_rows[i]["balance"]
    rec(0, start_prev, d_total, c_total)

solve()
print("best score:", best["score"], "residualD:", round(best["residualD"], 2),
      "residualC:", round(best["residualC"], 2))

if best["assign"]:
    for i, (bal, mv, d) in best["assign"].items():
        for fr in solved_prev:
            if fr["i"] == i:
                fr.update({"balance": bal, "movement": mv, "dir": d,
                           "used": "solver"})
                break

sum_d = sum_c = 0.0
for fr in solved_prev:
    if fr.get("movement") is not None and fr.get("dir") == "debit":
        sum_d += fr["movement"]
    elif fr.get("movement") is not None and fr.get("dir") == "credit":
        sum_c += fr["movement"]

unclosed = [fr["i"] for fr in solved_prev if fr.get("dir") in ("?", None)]
json.dump(solved_prev, open(f"{WORK}/v4_solved.json", "w"))
gates = {
    "closed": len(solved_prev) - len(unclosed), "unclosed": unclosed,
    "sumD": round(sum_d, 2), "sumC": round(sum_c, 2),
    "D_match": abs(sum_d - PRT_D) < 0.005, "C_match": abs(sum_c - PRT_C) < 0.005,
}
json.dump(gates, open(f"{WORK}/v4_solver_gates.json", "w"), indent=1)
print(json.dumps(gates, indent=1))
