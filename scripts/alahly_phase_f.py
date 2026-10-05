#!/usr/bin/env python3
"""Phase F — final report statistics from the closed chain."""
import json
import re
from collections import defaultdict

WORK = "/home/z/my-project/scripts/alahly_work"
d = json.load(open(f"{WORK}/final_ledger.json"))
rows = d["rows"]

PRINTED_SRC = {"cell1200", "colscan", "surgical2400", "printed+chain"}
derived = [r for r in rows if r["src"] == "derived"]
printed = [r for r in rows if r["src"] in PRINTED_SRC]
v8era = [r for r in rows if r["src"] in ("chain", "delta", "variant", "trust-bal")]

cred = round(sum(r["signed"] for r in rows if (r["signed"] or 0) > 0), 2)
deb = round(sum(r["signed"] for r in rows if (r["signed"] or 0) < 0), 2)
net = round(cred + deb, 2)

monthly = defaultdict(lambda: {"c": 0.0, "d": 0.0, "n": 0})
names = ["", "January", "February", "March", "April", "May", "June", "July",
         "August", "September", "October", "November", "December"]
for r in rows:
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", r["date"] or "")
    if not m:
        continue
    k = f"{names[int(m.group(2))]} {m.group(3)}"
    monthly[k]["n"] += 1
    if (r["signed"] or 0) > 0:
        monthly[k]["c"] = round(monthly[k]["c"] + r["signed"], 2)
    else:
        monthly[k]["d"] = round(monthly[k]["d"] - (r["signed"] or 0), 2)


def categorize(r):
    dd = (r["desc"] or "").lower()
    if (r["signed"] or 0) < 0 and ("fee" in dd or "revenue" in dd or "statement" in dd):
        return "fees"
    if "atm" in dd or "cash withdrawal" in dd:
        return "atm_cash"
    if r["credit"] and ("interest" in dd or "certificate" in dd):
        return "interest"
    if "reversal" in dd:
        return "reversals"
    if "purchase" in dd:
        return "card_purchase"
    return "ipn_out" if (r["signed"] or 0) < 0 else "transfer_in"


cats = defaultdict(lambda: {"in": 0.0, "out": 0.0, "n": 0})
for r in rows:
    c = categorize(r)
    cats[c]["n"] += 1
    if (r["signed"] or 0) > 0:
        cats[c]["in"] = round(cats[c]["in"] + r["signed"], 2)
    else:
        cats[c]["out"] = round(cats[c]["out"] - (r["signed"] or 0), 2)

cp = defaultdict(lambda: {"in": 0.0, "out": 0.0, "n": 0})
for r in rows:
    m = re.search(r"([A-Z][A-Z ]{4,30})~", (r["desc"] or "").upper())
    name = m.group(1).strip() if m else None
    if name and "EID FARAG" in name:
        name = "EID FARAG SAAD SHAAT (own-name)"
    if name:
        cp[name]["n"] += 1
        if (r["signed"] or 0) > 0:
            cp[name]["in"] = round(cp[name]["in"] + r["signed"], 2)
        else:
            cp[name]["out"] = round(cp[name]["out"] - (r["signed"] or 0), 2)
top_cp = sorted(cp.items(), key=lambda kv: -(kv[1]["out"] + kv[1]["in"]))[:10]

notable = sorted([r for r in rows if (r["amt"] or 0) >= 20000], key=lambda r: -r["amt"])[:14]
bals = [r["bal"] for r in rows if r["bal"]]

out = {
    "anchors": {
        "opening": 467525.43, "closing": 631182.24, "available": 431162.24,
        "hold": 200020.00, "net": 163656.81,
        "identity": "Current 631,182.24 = Available 431,162.24 + Hold 200,020.00 + Uncollected 0.00",
        "period_from": "01/03/2026", "period_to": "09/09/2026",
        "account": "2445000302432001010",
        "iban": "EG290003024450003024320010100",
        "holder": "EID FARAG SAAD SHAAT",
        "bank": "National Bank of Egypt (NBE) — New Nubaria Branch",
        "type": "EGP Savings Account — Annual Return"},
    "mass": {
        "total_rows": len(rows), "chain_pairs": len(rows), "closed": len(rows),
        "coverage_pct": 100.0,
        "printed_confirmed_rows": len(printed),
        "v8_verified_rows": len(v8era),
        "derived_rows": len(derived),
        "credits": cred, "debits": deb, "net": net,
        "anchor_net": 163656.81, "residual": round(net - 163656.81, 2),
        "bal_min": min(bals), "bal_max": max(bals)},
    "monthly": dict(sorted(monthly.items())),
    "cats": {k: v for k, v in sorted(cats.items(), key=lambda kv: -(kv[1]["in"] + kv[1]["out"]))},
    "counterparties": [{"name": k, **v} for k, v in top_cp],
    "notable": [{"date": r["date"], "desc": (r["desc"] or "")[:90], "amt": r["amt"],
                 "signed": r["signed"], "bal": r["bal"], "src": r["src"]} for r in notable],
    "derived_rows_detail": [
        {"page": r["page"], "date": r["date"], "desc": (r["desc"] or "")[:80],
         "amt": r["amt"], "signed": r["signed"], "bal": r["bal"]}
        for r in derived],
    "corrections": d["corrections"],
}
json.dump(out, open(f"{WORK}/final_stats.json", "w"), ensure_ascii=False, indent=1)
print(f"rows {len(rows)} | printed {len(printed)} | v8-era {len(v8era)} | derived {len(derived)}")
print(f"credits {cred:,.2f} | debits {-deb:,.2f} | net {net:,.2f} (anchor 163,656.81, residual {net - 163656.81:+.2f})")
print(f"bal range {min(bals):,.2f} .. {max(bals):,.2f}")
print("monthly:", {k: (v['c'], v['d'], v['n']) for k, v in list(out['monthly'].items())[:8]})
print("cats:", {k: (v['in'], v['out'], v['n']) for k, v in out['cats'].items()})
print("derived rows:", len(derived))
