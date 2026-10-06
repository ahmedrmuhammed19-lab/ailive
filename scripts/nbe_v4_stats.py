#!/usr/bin/env python3
"""NBE v4 — compute report stats from the verified 462-row print table."""
import json
from collections import defaultdict

ST = "/home/z/my-project/scripts/alahly_work_state"
d = json.load(open(f"{ST}/v4_print_table.json"))
T = d["table"]
assert len(T) == 462 and [r["serial"] for r in T] == list(range(1, 463))

def month_of(r):
    dt = r.get("date") or ""
    m = dt.split("/")[-2] if "/" in dt else None
    return m

MN = {"03": "Mar 2026", "04": "Apr 2026", "05": "May 2026", "06": "Jun 2026",
      "07": "Jul 2026", "08": "Aug 2026", "09": "Sep 2026"}

monthly = defaultdict(lambda: {"D": 0.0, "C": 0.0, "n": 0, "rev": 0.0})
for r in T[1:]:
    m = month_of(r)
    if m not in MN:
        continue
    a = r.get("amount") or 0.0
    monthly[MN[m]]["n"] += 1
    if r.get("attrib") == "credit":
        monthly[MN[m]]["C"] += a
    elif r.get("attrib") == "reversal":
        monthly[MN[m]]["D"] += a   # signed negative
        monthly[MN[m]]["rev"] += a
    elif r.get("attrib") == "debit":
        monthly[MN[m]]["D"] -= a

# categories by desc keywords (walk rows only; inserts have no desc)
cats = defaultdict(lambda: {"sum": 0.0, "n": 0})
for r in T[1:]:
    if r.get("attrib") not in ("debit", "reversal", "credit"):
        continue
    desc = (r.get("desc") or "")
    a = abs(r.get("amount") or 0.0)
    key = None
    dl = desc.lower()
    if "atm" in dl or "cash withdrawal" in dl:
        key = "ATM cash withdrawals"
    elif "mastercard" in dl or "debit card" in dl or "renewal" in dl:
        key = "Card fees & renewals"
    elif "balance inq" in dl or "to-revenue" in dl or "revenue from" in dl:
        key = "IPN balance-inquiry / revenue fees"
    elif "transfer fees" in dl or ("fee" in dl and "outgoing" in dl):
        key = "Outgoing transfer fees (IPN)"
    elif r.get("attrib") == "credit" and ("interest" in dl or "certificat" in dl):
        key = "Deposit interest (certificate/term)"
    elif r.get("attrib") == "credit":
        key = "Other credits (IPN collections)"
    elif r.get("attrib") == "reversal":
        key = "Failed-transfer reversals"
    elif "outgoing" in dl or "network to" in dl:
        key = "Outgoing transfers (IPN network)"
    else:
        key = "Other debits (statement fees etc.)"
    if r.get("src") == "insert" and key is None:
        key = "Recovered rows (page reads)"
    cats[key]["sum"] += a
    cats[key]["n"] += 1

# counterparty frequency from desc fragments (upper-case names after 'to ')
import re
cps = defaultdict(lambda: {"sum": 0.0, "n": 0})
for r in T[1:]:
    if r.get("attrib") != "debit":
        continue
    desc = (r.get("desc") or "").replace("\u00a0", " ")
    m = re.search(r"[Nn]etwork to ([A-Z][A-Za-z .]{3,40})", desc)
    name = None
    if m:
        name = m.group(1).split("  ")[0].strip()
        name = re.sub(r"\s+\S*$", "", name) if len(name) > 24 else name
    if name and len(name) >= 4 and "FARAG" not in name.upper():
        cps[name]["sum"] += abs(r.get("amount") or 0.0)
        cps[name]["n"] += 1
top_cps = sorted(cps.items(), key=lambda kv: -kv[1]["sum"])[:12]

# reversals list
revs = [{"serial": r["serial"], "amount": r.get("amount"), "page": r["page"],
         "balance": r.get("balance")} for r in T if r.get("attrib") == "reversal"]

# largest movements
largest = sorted([r for r in T[1:] if r.get("attrib") in ("debit", "credit")],
                 key=lambda r: -abs(r.get("amount") or 0))[:15]

# fee-law check: fee rows vs following transfer rows
fee_law_ok, fee_law_n = 0, 0
for i, r in enumerate(T[1:], start=1):
    if r.get("attrib") != "debit":
        continue
    a = r.get("amount") or 0
    if a > 20:  # transfer-sized
        continue
    nxt = T[i + 1] if i + 1 < len(T) else None
    if nxt and nxt.get("attrib") == "debit" and abs((nxt.get("amount") or 0) - round(a * 1000, 2)) < 0.005:
        fee_law_ok += 1
    fee_law_n += 1

stats = {
    "rows": 462, "tx_rows": 461,
    "opening": 467515.43, "closing": 631182.24, "net": round(631182.24 - 467515.43, 2),
    "sumD": d["g3"]["sumD"], "sumC": d["g3"]["sumC"],
    "n_debits": sum(1 for r in T if r.get("attrib") == "debit"),
    "n_credits": sum(1 for r in T if r.get("attrib") == "credit"),
    "n_reversals": len(revs), "rev_mass": round(sum(-x["amount"] for x in revs), 2),
    "gross_debits": round(d["g3"]["sumD"] + sum(-x["amount"] for x in revs), 2),
    "monthly": monthly, "cats": cats, "top_cps": top_cps, "revs": revs,
    "largest": [{"serial": r["serial"], "amount": r["amount"], "attrib": r["attrib"],
                 "balance": r["balance"], "page": r["page"],
                 "desc": (r.get("desc") or "")[:60]} for r in largest],
    "fee_law": {"ok": fee_law_ok, "n": fee_law_n},
    "inserts": sum(1 for r in T if r.get("src") == "insert"),
    "identity": {
        "holder": "EID FARAG SAAD SHAAT",
        "bank": "National Bank of Egypt (NBE) — New Nubaria Branch",
        "account": "2445000302432001010",
        "iban": "EG290003024450003024320010100",
        "product": "EGP Savings Account — Annual Return",
        "period": "01/03/2026 → 09/09/2026 (6.3 months, 23 pages, pure scan)",
        "source": "كشف_حساب_عيد_شاعت_الاهلي_معدل (2).pdf — 10.8 MB scanned image PDF, no text layer",
    },
}
json.dump(stats, open(f"{ST}/v4_stats.json", "w"), ensure_ascii=False, indent=1)
print("rows", stats["rows"], "debits", stats["n_debits"], "credits", stats["n_credits"],
      "revs", stats["n_reversals"], "rev_mass", stats["rev_mass"])
print("gross debits", stats["gross_debits"], "credits", stats["sumC"])
print("net", stats["net"], "sumC-sumD", round(stats["sumC"] - stats["sumD"], 2))
for k, v in monthly.items():
    print(" ", k, v)
for k, v in sorted(cats.items(), key=lambda kv: -kv[1]["sum"]):
    print("  cat:", k, round(v["sum"], 2), v["n"])
print("top cps:", [(k, round(v["sum"], 2), v["n"]) for k, v in top_cps[:6]])
print("fee law:", stats["fee_law"])
