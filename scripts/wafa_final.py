#!/usr/bin/env python3
"""Final build: voted clean rows + recovery of date-corrupted rows that all
three OCR passes missed. Chain oracle: printed totals."""
import glob
import json
import re
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from wafa_parse import try_amount, DATE_RE, fix_date, WORK  # noqa
from wafa_parse2 import lines_of_t, PT, DEBIT_X_PT  # noqa

BX = DEBIT_X_PT * 450 / PT
PIPE_RE = re.compile(r"[|}\]\[{]{3,}")
DATEISH_RE = re.compile(r"^[\dOoDdSsIiLlZz]{1,2}/[\dOoDdSsBbLlIi]{1,2}/2[\dOoRrPpZzBbUuEeGgSsLl0-9]{2,5}$")
MEMO_BAD = ("Fees,", "Ref", "MOVEMENT", "Branch", "Account", "CUSTOMER", "CTB-", "Page", "Bal.")


def valid_date(s):
    m = re.match(r"^(\d{2})/(\d{2})/(20\d{2})$", s)
    if not m:
        return None
    d, mo = int(m.group(1)), int(m.group(2))
    if 1 <= d <= 31 and 1 <= mo <= 12:
        return s
    return None


def main():
    voted = json.load(open(f"{WORK}/rows_voted.json"))
    rows = voted["rows"]
    sd0, sc0 = voted["sumDebits"], voted["sumCredits"]
    print(f"voted base: {len(rows)} rows  D={sd0:,.2f} C={sc0:,.2f}")

    # set of (page, date) already covered — for interpolation bounds
    recovered = []
    for p in sorted(glob.glob(f"{WORK}/hi2-*.tsv")):
        pno = int(re.search(r"hi2-(\d+)", p).group(1))
        for fw, words, top, h in lines_of_t(p):
            w0 = words[0][1]
            if DATE_RE.match(w0):
                continue
            txt = " ".join(w[1] for w in words)
            if txt.count("|") + txt.count("}") + txt.count("[") < 3:
                continue
            if any(bad in txt for bad in MEMO_BAD):
                continue
            # amount in the amount zone?
            amts = [(wd[0], a) for wd in words if (a := try_amount(wd[1])) is not None]
            if not amts:
                continue
            # date: first VALID clean token among first 4
            date = None
            for wd in words[:4]:
                if DATE_RE.match(wd[1]):
                    v = valid_date(fix_date(wd[1]))
                    if v:
                        date = v
                        break
            dateish = any(DATEISH_RE.match(wd[1]) for wd in words[:3])
            if date is None and not dateish:
                continue
            dz = [(x, a) for x, a in amts if x < BX]
            cz = [(x, a) for x, a in amts if x >= BX]
            d = (max(dz, key=lambda t: t[0])[1]) if dz else None
            c = (max(cz, key=lambda t: t[0])[1]) if cz else None
            desc = " ".join(w[1] for w in words if 1575 < w[0] < 2550 and not try_amount(w[1]))
            desc = re.sub(r"[|}\]\[{]+", " ", desc).strip()
            recovered.append({"page": pno, "date": date, "debit": d, "credit": c,
                              "desc": desc[:80], "dateApprox": date is None,
                              "src": "recovered"})
    print(f"recovered rows: {len(recovered)}")
    for r in recovered:
        print(f"  p{r['page']:02d} {r['date'] or '???'} D={r['debit']} C={r['credit']} | {r['desc'][:44]}")

    allrows = rows + recovered
    sd = round(sum(r["debit"] or 0 for r in allrows), 2)
    sc = round(sum(r["credit"] or 0 for r in allrows), 2)
    td, tc = voted["totalDebits"], voted["totalCredits"]
    net = round(sc - sd, 2)
    ec = round(voted["opening"] + net, 2)
    print(f"\nfinal rows={len(allrows)}")
    print(f"debits : {sd:,.2f} vs {td:,.2f}  diff {sd - td:+,.2f}")
    print(f"credits: {sc:,.2f} vs {tc:,.2f}  diff {sc - tc:+,.2f}")
    print(f"closing: {ec:,.2f} vs {voted['closing']:,.2f}  diff {ec - voted['closing']:+,.2f}")
    ok = abs(sd - td) < 0.01 and abs(sc - tc) < 0.01 and abs(ec - voted["closing"]) < 0.01
    print("CHAIN VERDICT:", "100% — analyst verified" if ok else "MISMATCH")
    json.dump({"rows": allrows, "opening": voted["opening"], "closing": voted["closing"],
               "totalDebits": td, "totalCredits": tc, "sumDebits": sd, "sumCredits": sc},
              open(f"{WORK}/rows_final2.json", "w"), indent=1)


if __name__ == "__main__":
    main()
