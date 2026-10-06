#!/usr/bin/env python3
"""NBE v4 STAGE 3 FINAL — 462-row print table from chain + visual transcription.

Everything below the line of the solved walk is now PRINT-VERIFIED (600dpi
crops read visually, adj3/*.png). Method:
  1. Backbone = solved 424-row walk minus 2 spurious wrap rows.
  2. Serial overrides where the print identity of a walk row is proven.
  3. Balance overrides where the walk's OCR read the amount column as balance.
  4. 39 print-transcribed inserts (absorbed / page-boundary rows).
  5. Table sorted by serial -> full chain re-derivation from b/f 467,515.43.
  6. Gates G1 (census 1..462 exactly once), G2 (strict chain, residual 0.00),
     G3 (sumD == 1,341,824.35, sumC == 1,505,491.16), G4 (anchors).
"""
import json
from collections import Counter

ST = "/home/z/my-project/scripts/alahly_work_state"
PRT_D, PRT_C = 1341824.35, 1505491.16
BF, CLOSE = 467515.43, 631182.24

CREDITS = {37: 5241.00, 55: 41861.00, 80: 791.67, 163: 205.83, 209: 100.00,
           225: 791.67, 227: 300000.00, 242: 205.83, 341: 791.67, 349: 205.83,
           374: 791.67, 375: 50000.00, 376: 50000.00, 377: 150000.00,
           382: 205.83, 385: 27500.00, 388: 718.75, 393: 80000.00,
           397: 44950.00, 398: 205.83, 450: 500000.00, 454: 250000.00,
           456: 718.75, 457: 205.83}

SPURIOUS_I = {322, 367}
# walk_i -> (serial, balance|None)  print-proven identity/amount corrections
OVERRIDES = {58: (59, 333047.03),    # p4 crop: s59 fee 0.50 -> 333,047.03
             125: (129, 170035.90),  # p7 crop: IBAN 51339997B4751BC0 = s129, 0.50 -> 170,035.90
             126: (133, None),       # p7 crop: IBAN C810D4211395CF49 = s133
             140: (151, None),       # p8 crop: bal 167,030.90 = s151
             141: (152, None),       # p8 crop: bal 164,530.90 = s152
             142: (153, None),       # p8 crop: bal 164,528.90 = s153
             143: (154, None),       # p8 crop: bal 162,528.90 = s154
             162: (173, 95212.45),   # p9 crop: walk had read amount 3.30 as balance
             165: (176, 91111.65),   # p9 crop: walk had read 400.0 garbage
             255: (276, 86741.84),   # p14 crop: 8->9 misread; s276 ATM debit 5,000
             256: (277, 86740.54),   # p14 crop: 8->9 misread
             257: (278, 85440.54),   # p14 crop: 8->9 misread
             277: (298, 39739.45),   # p15 crop: walk had read 10,000 as balance
             389: (420, 59132.91)}   # p20/21 crop: walk had read fee 1.70 as balance

# (serial, signed_debit, credit, balance, page, source) — all print-transcribed
INSERTS = [
    (60, -0.50, 0.00, 333047.53, 4, "p4 crop: fee reversal"),
    (81, 0.50, 0.00, 224793.20, 5, "p5 crop: IPN balance-inq fee"),
    (82, 0.50, 0.00, 224792.70, 5, "p5 crop: outgoing transfer fee"),
    (126, -1500.00, 0.00, 171037.40, 7, "p7: transfer reversal (chain+print consistent)"),
    (128, 1000.00, 0.00, 170036.40, 7, "p7 crop"),
    (130, 500.00, 0.00, 169535.90, 7, "p7 crop"),
    (134, 300.00, 0.00, 169735.90, 7, "p7 crop"),
    (135, -0.50, 0.00, 169736.40, 7, "p7 crop: fee reversal"),
    (149, -1.50, 0.00, 165533.40, 8, "p8 crop: fee reversal"),
    (150, -1500.00, 0.00, 167033.40, 8, "p8 crop: transfer reversal"),
    (209, 0.00, 100.00, None, 10, "G9: p10 stamp zone credit"),
    (210, 8300.00, 0.00, None, 10, "G9: p10 stamp zone"),
    (211, 448.00, 0.00, None, 10, "G9: p10 stamp zone"),
    (212, 8588.00, 0.00, None, 10, "G9: p10 stamp zone"),
    (228, 20.00, 0.00, None, 11, "G9: p11 bottom"),
    (229, 70000.00, 0.00, None, 11, "G9: p11 bottom"),
    (230, 20.00, 0.00, None, 11, "G9: p11 bottom"),
    (257, 2000.00, 0.00, None, 13, "G9: p13 merge"),
    (258, -2.00, 0.00, None, 13, "G9: p13 fee reversal"),
    (259, -2000.00, 0.00, None, 13, "G9: p13 transfer reversal"),
    (339, 0.50, 0.00, 10942.63, 17, "p17 top crop"),
    (340, 320.00, 0.00, 10622.63, 17, "p17 top crop"),
    (342, 0.50, 0.00, 11413.80, 17, "p17 crop"),
    (346, 1000.00, 0.00, None, 17, "G9: p17 absorbed"),
    (348, 1500.00, 0.00, None, 17, "G9: p17 absorbed"),
    (351, 0.50, 0.00, None, 17, "G9: p17 absorbed"),
    (352, 290.00, 0.00, None, 17, "G9: p17 absorbed"),
    (353, 0.50, 0.00, None, 17, "G9: p17 absorbed"),
    (355, 0.95, 0.00, None, 17, "G9: p17 absorbed"),
    (356, 950.00, 0.00, None, 17, "G9: p17 absorbed"),
    (358, 300.00, 0.00, None, 18, "G9: p18 absorbed"),
    (359, 0.50, 0.00, None, 18, "G9: p18 absorbed"),
    (441, 5.08, 0.00, 7786.26, 21, "p21 tail crop (was 0.50 in v4 draft)"),
    (442, 5075.00, 0.00, 2711.26, 22, "p22 head crop (was 5073.00)"),
    (443, 0.60, 0.00, 2710.66, 22, "p22 head crop (was 0.50)"),
    (444, 600.00, 0.00, 2110.66, 22, "p22 head crop"),
    (445, 1.00, 0.00, 2109.66, 22, "p22 head crop"),
    (446, 1000.00, 0.00, 1109.66, 22, "p22 head crop"),
    (447, 0.50, 0.00, 1109.16, 22, "p22 head crop"),
    (448, 500.00, 0.00, 609.16, 22, "p22 head crop"),
]

def main():
    walk = json.load(open(f"{ST}/v4_solved.json"))
    bf_row = walk[0]
    tx = [r for r in walk[1:] if r["i"] not in SPURIOUS_I]

    table = []
    for r in tx:
        ov = OVERRIDES.get(r["i"])
        ser = ov[0] if ov else None
        bal = ov[1] if ov and ov[1] is not None else r.get("balance")
        try:
            rser = int(str(r.get("serial")).strip())
            if not (2 <= rser <= 462):
                rser = None
        except (TypeError, ValueError):
            rser = None
        toks = sorted({round(float(v), 2) for k in ("A", "B", "C")
                       for v in (r.get(k) or [])
                       if isinstance(v, (int, float)) and abs(v) > 1e-9})
        table.append({"serial": ser, "read_ser": rser, "src": "walk",
                      "walk_i": r["i"], "page": r["page"],
                      "date": r.get("date"), "desc": r.get("desc"),
                      "balance_printed": bal, "tokens": toks, "used": r.get("used")})

    # --- LIS anchors over trusted reads (rows without overrides) ---
    import bisect
    reads = sorted((t["walk_i"], t["read_ser"]) for t in table if t["read_ser"] is not None)
    tails, tidx, nodes = [], [], {}
    for wi, sv in reads:
        pos = bisect.bisect_left(tails, sv)
        nodes[wi] = (pos, tidx[pos - 1] if pos > 0 else None)
        if pos == len(tails):
            tails.append(sv); tidx.append(wi)
        else:
            tails[pos] = sv; tidx[pos] = wi
    pos_final = len(tails) - 1
    end_wi = None
    for wi, sv in reversed(reads):
        if nodes[wi][0] == pos_final:
            end_wi = wi; break
    lis = []
    cur = end_wi
    ser_of = dict(reads)
    while cur is not None:
        lis.append((cur, ser_of[cur]))
        cur = nodes[cur][1]
    lis.reverse()
    print(f"LIS anchors: {len(lis)} ({lis[0] if lis else None}..{lis[-1] if lis else None})")
    by_wi = {t["walk_i"]: t for t in table}
    for wi, sv in lis:
        if by_wi[wi]["serial"] is None:
            by_wi[wi]["serial"] = sv

    ins_sers = {r[0] for r in INSERTS}
    ov_sers = {v[0] for v in OVERRIDES.values()}

    def ladder(k_lo, k_hi, s_lo, s_hi, note):
        """Assign None rows strictly between anchors (k_lo,s_lo) and (k_hi,s_hi).
        Available = (s_lo+1..s_hi-1) minus inserts minus override serials."""
        run = [t for t in table if k_lo < t["walk_i"] < k_hi and t["serial"] is None]
        avail = [s for s in range(s_lo + 1, s_hi) if s not in ins_sers and s not in ov_sers]
        if len(avail) != len(run):
            return (note, s_lo, s_hi, len(run), len(avail))
        for t, v in zip(run, avail):
            t["serial"] = v
        return None
    flags = []
    prev = (None, 1)
    for wi, sv in lis + [(10 ** 9, 463)]:
        k_lo, s_lo = prev
        if k_lo is not None:
            f = ladder(k_lo, wi, s_lo, sv, f"zone({s_lo}->{sv})")
            if f: flags.append(f)
        prev = (wi, sv)
    if flags:
        print("ZONE FLAGS:", flags)
    un = [t for t in table if t["serial"] is None]
    if un:
        for t in un:
            print("!! unassigned walk row", t["walk_i"], t["page"], t["balance_printed"])
        raise SystemExit("unassigned rows remain")

    # merge inserts, sort by serial
    for s, d, c, bal, page, src in INSERTS:
        table.append({"serial": s, "src": "insert", "walk_i": None, "page": page,
                      "date": None, "desc": None, "D": d, "C": c,
                      "balance_printed": bal, "tokens": [], "source": src})
    dupes = [s for s, c in Counter(t["serial"] for t in table).items() if c > 1]
    if dupes:
        print("!! DUPLICATE SERIALS:", dupes)
        for t in table:
            if t["serial"] in dupes:
                print("   ", t["serial"], t["src"], t["walk_i"], t["page"],
                      t["balance_printed"])
    table.sort(key=lambda t: t["serial"])

    # chain + attribution
    bal = BF
    anomalies = []
    sumD = sumC = 0.0
    nrev = 0
    for t in table:
        s = t["serial"]
        if t["src"] == "insert":
            d, c = t["D"], t["C"]
            bal = round(bal - d + c, 2)
            t["balance"] = bal
            t["delta"] = round(c - d, 2)
            t["attrib"] = "credit" if c else ("reversal" if d < 0 else "debit")
            t["amount"] = (c if c else d)
            sumD += d; sumC += c
            if t["balance_printed"] is not None and abs(t["balance_printed"] - bal) > 0.005:
                anomalies.append((s, "insert-bal", t["balance_printed"], bal))
            continue
        bp = t["balance_printed"]
        if bp is None:
            anomalies.append((s, "no-balance", t["walk_i"], None)); continue
        delta = round(bp - bal, 2)
        t["delta"] = delta; t["balance"] = bp; bal = bp
        if s in CREDITS and abs(delta - CREDITS[s]) < 0.005:
            t["attrib"] = "credit"; t["amount"] = delta; sumC += delta
        elif delta > 0:
            t["attrib"] = "reversal"; t["amount"] = -delta; sumD -= delta; nrev += 1
        elif delta < 0:
            t["attrib"] = "debit"; t["amount"] = -delta; sumD += -delta
        else:
            t["attrib"] = "zero"; t["amount"] = 0.0
        if t["attrib"] in ("debit", "credit") and not any(
                abs(x - abs(delta)) < 0.005 for x in t["tokens"]):
            anomalies.append((s, "no-token", round(delta, 2), t["tokens"][:4]))

    print(f"rows: {len(table)}  chain end: {bal}  ({'OK' if abs(bal-CLOSE)<0.005 else 'MISMATCH'})")
    print(f"G1 census: missing={[s for s in range(1,463) if s not in {t['serial'] for t in table}]}")
    print(f"G3: sumD={round(sumD,2):,.2f} sumC={round(sumC,2):,.2f}")
    print(f"    residual D={PRT_D-sumD:+,.2f}  C={PRT_C-sumC:+,.2f}   reversals={nrev}")
    print(f"anomalies: {len(anomalies)}")
    for a in anomalies:
        print("   ", a)
    json.dump({"table": table, "g3": {"sumD": round(sumD, 2), "sumC": round(sumC, 2)},
               "reversals": nrev, "anomalies": anomalies},
              open(f"{ST}/v4_print_table.json", "w"), ensure_ascii=False, indent=1)
    print("saved ->", f"{ST}/v4_print_table.json")

if __name__ == "__main__":
    main()
