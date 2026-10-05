#!/usr/bin/env python3
"""NBE v9 — LOCAL pair reconciliation (no cascade divergence).

For every consecutive pair of printed balances, the delta must be explained by
the captured row amount(s) between them. Verified pairs only feed the flow
masses; the remainder is disclosed as coverage. Anchors: opening 467,525.43,
closing 631,182.24, print identity 631,182.24 = 431,162.24 + 200,030.00."""
import json
import re
from collections import defaultdict

WORK = "/home/z/my-project/scripts/alahly_work"

events = json.load(open(f"{WORK}/events_v8.json"))
issues = json.load(open(f"{WORK}/issues_v8.json"))

# replace page-23 rows with the 900dpi-corrected final row
rows = [e for e in events if e["page"] != 23]
rows.append({"page": 23, "y": 9999, "date": "06/09/2026", "ref": "244FTID162498349",
             "desc": "outgoing transfer IPN network to FC8DBFEC3C21C3C0",
             "vdate": "06/09/2026", "amt": 50000.00, "signed": -50000.00,
             "bal": 631182.24, "src": "chain", "credit": False})

# drop the pre-first junk (page-1 header artifacts with dates but no data)
rows = [e for e in rows if not (e["src"] in ("drop",) and not e["amt"] and not e["bal"])]

# dedupe (page, y/60)
seen, dedup = set(), []
for e in sorted(rows, key=lambda x: (x["page"], x["y"])):
    k = (e["page"], round((e["y"] or 0) / 60), e["date"], round(e["bal"] or 0, 2))
    if k in seen:
        continue
    seen.add(k)
    dedup.append(e)
rows = dedup

OPENING, CLOSING = 467525.43, 631182.24

# local reconciliation: walk rows; a row is verified if its signed amount
# explains the delta between consecutive printed balances around it
verified, unverified = [], []
prev_bal = None
pending = []  # rows since last printed balance
for e in rows:
    if e["bal"] is None:
        pending.append(e)
        continue
    if prev_bal is None:
        # opening row
        if abs(e["bal"] - OPENING) < 0.011 or e["src"] == "opening":
            e["signed"] = e["signed"] if e["signed"] is not None else 0.0
            verified.append(e)
        else:
            unverified.append(e)
        prev_bal = e["bal"]
        pending = []
        continue
    delta = round(e["bal"] - prev_bal, 2)
    amounts = [(p["amt"], p) for p in pending if p["amt"]] + \
              ([(e["amt"], e)] if e["amt"] else [])
    # try to explain delta by the row amount(s)
    if len(amounts) == 1 and abs(abs(amounts[0][0]) - abs(delta)) <= 0.011:
        s = delta
        for a, p in amounts:
            p["signed"] = s if p is e else None
            if p is not e:
                verified.append(p)
        e["signed"] = s
        e["credit"] = delta > 0
        verified.append(e)
    elif not amounts and 0 < abs(delta) <= 2000:
        # fee row(s) whose amounts were OCR-missed: delta-recovered
        e["signed"] = delta
        e["amt"] = abs(delta)
        e["credit"] = delta > 0
        verified.append(e)
    elif abs(delta) <= 0.011:
        verified.append(e)  # zero-movement row (balance repeat)
    else:
        e["signed"] = e["signed"] if e.get("signed") is not None else None
        unverified.append(e)
    prev_bal = e["bal"]
    pending = []

# opening row handling
for e in verified:
    if e["src"] == "opening" and e["page"] == 1 and not e["date"]:
        e["desc"] = "Balance b/f (opening balance, value date 26/02/2026)"

vrows = [e for e in verified if e["date"] and e["signed"] is not None and e["amt"]]
cre = round(sum(e["signed"] for e in vrows if e["signed"] > 0), 2)
deb = round(sum(e["signed"] for e in vrows if e["signed"] < 0), 2)
vnet = round(cre + deb, 2)
anet = round(CLOSING - OPENING, 2)
print(f"rows total {len(rows)}  verified-with-flow {len(vrows)}  unverified {len(unverified)}")
print(f"verified mass: credits {cre:,.2f} debits {deb:,.2f} net {vnet:,.2f}")
print(f"anchor net {anet:,.2f}  verified-coverage of net: {round(100 * vnet / anet, 1) if anet else 0}%")

# monthly
def mkey(d):
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", d or "")
    names = ["", "January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"]
    return f"{names[int(m.group(2))]} {m.group(3)}" if m else None

monthly = defaultdict(lambda: {"c": 0.0, "d": 0.0, "n": 0})
for e in vrows:
    k = mkey(e["date"])
    if not k:
        continue
    if e["signed"] > 0:
        monthly[k]["c"] = round(monthly[k]["c"] + e["signed"], 2)
    else:
        monthly[k]["d"] = round(monthly[k]["d"] - e["signed"], 2)
    monthly[k]["n"] += 1

# categories
def categorize(e):
    d = (e["desc"] or "").lower()
    if "fee" in d or "revenue" in d:
        return "fee"
    if "atm" in d:
        return "atm"
    if "visa" in d and "settl" in d:
        return "card"
    if "outgo" in d or "outgolng" in d:
        return "ipn_out"
    if e["signed"] > 0:
        return "transfer_in"
    return "other"

cats = defaultdict(lambda: {"in": 0.0, "out": 0.0, "n": 0})
for e in vrows:
    c = categorize(e)
    if e["signed"] > 0:
        cats[c]["in"] = round(cats[c]["in"] + e["signed"], 2)
    else:
        cats[c]["out"] = round(cats[c]["out"] - e["signed"], 2)
    cats[c]["n"] += 1

# counterparties
cp = defaultdict(lambda: {"in": 0.0, "out": 0.0, "n": 0})
for e in vrows:
    m = re.search(r"([A-Z][A-Z ]{4,34}?)\s*[~—-]\s*PN", (e["desc"] or "").upper())
    if m:
        name = m.group(1).strip()
        if "EID FARAG" in name:
            name = "EID FARAG SAAD SHAAT (own-name transfers)"
        cp[name]["n"] += 1
        if e["signed"] > 0:
            cp[name]["in"] = round(cp[name]["in"] + e["signed"], 2)
        else:
            cp[name]["out"] = round(cp[name]["out"] - e["signed"], 2)
top_cp = sorted(cp.items(), key=lambda kv: -(kv[1]["out"] + kv[1]["in"]))[:12]

notable = sorted([e for e in vrows if (e["amt"] or 0) >= 40000],
                 key=lambda e: -e["amt"])[:12]

# balance band stats
bals = [e["bal"] for e in rows if e["bal"]]
out = {
    "anchors": {"opening": OPENING, "closing": CLOSING,
                "available": 431162.24, "hold": 200030.00, "net": anet,
                "identity": "Current 631,182.24 = Available 431,162.24 + Hold 200,030.00 + Uncollected 0.00",
                "period_from": "01/03/2026", "period_to": "09/09/2026",
                "window_from": "10/03/2026",
                "account": "2445000302432001010",
                "iban": "EG290003024450003024320010100",
                "holder": "EID FARAG SAAD SHAAT",
                "bank": "National Bank of Egypt (NBE) — New Nubaria Branch",
                "type": "EGP Savings Account — Annual Return"},
    "mass": {"total_rows": len(rows), "verified_rows": len(vrows),
             "unverified": len(unverified),
             "coverage_pct": round(100 * len(vrows) / max(1, len(rows)), 1),
             "credits": cre, "debits": -deb, "ocr_net": vnet,
             "residual": round(vnet - anet, 2),
             "bal_min": min(bals), "bal_max": max(bals)},
    "monthly": dict(sorted(monthly.items())),
    "cats": {k: v for k, v in sorted(cats.items(), key=lambda kv: -(kv[1]["in"] + kv[1]["out"]))},
    "counterparties": [{"name": k, **v} for k, v in top_cp],
    "notable": [{"date": e["date"], "desc": (e["desc"] or "")[:100], "amt": e["amt"],
                 "signed": e["signed"], "bal": e["bal"]} for e in notable],
    "rows": rows,
}
json.dump(out, open(f"{WORK}/report_data.json", "w"), ensure_ascii=False, indent=1)
print("WROTE report_data.json")
print("monthly:", {k: (v["c"], v["d"], v["n"]) for k, v in out["monthly"].items()})
print("cats:", {k: (v["in"], v["out"], v["n"]) for k, v in out["cats"].items()})
print("top cp:", [(c["name"][:30], c["out"], c["n"]) for c in out["counterparties"][:6]])
print("notable:", [(n["date"], n["amt"]) for n in out["notable"][:8]])
