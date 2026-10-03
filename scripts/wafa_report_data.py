#!/usr/bin/env python3
"""Aggregate rows_ledger.json into report analytics -> scripts/wafa_work/report_data.json"""
import json
import re
from collections import defaultdict

WORK = "/home/z/my-project/scripts/wafa_work"


def sanitize(s):
    if not s:
        return ""
    s = re.sub(r"[^\x20-\x7e]", " ", s)  # strip non-ASCII OCR garbage
    s = re.sub(r"\s+", " ", s).strip(" |")
    return s[:90]


def valid_date(s):
    if not s:
        return None
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if 1 <= d <= 31 and 1 <= mo <= 12 and y == 2026:
        return (y, mo, d)
    return None


MONTHS = {3: "March", 4: "April", 5: "May", 6: "June", 7: "July", 8: "August", 9: "September"}


def main():
    data = json.load(open(f"{WORK}/rows_ledger.json"))
    rows = data["rows"]

    ledger = []
    for i, r in enumerate(rows):
        desc = sanitize(r.get("desc") or "")
        memo_txt = sanitize(" ".join(r.get("memo") or []))
        vd = valid_date(r.get("date"))
        full = (desc + " " + memo_txt).upper()
        cat = "Other"
        if "REVERSAL" in full:
            cat = "Transfer Reversal"
        elif "CASH DEPOSIT" in full:
            cat = "Cash Deposit"
        elif "CASH WITHDRAWAL" in full:
            cat = "Cash Withdrawal"
        elif "ACH INWARD" in full:
            cat = "ACH Inward"
        elif "INTERNAL CHEQUE" in full:
            cat = "Internal Cheque"
        elif "COLLECTED CHEQUE" in full:
            cat = "Collected Cheque"
        elif "TD INT" in full or "INT.PAYOUT" in full:
            cat = "Term Deposit Payout"
        elif "CREDIT INTEREST" in full:
            cat = "Credit Interest"
        elif "MAINTENANCE FEES" in full or "DROP DOWN FEES" in full or "BACK VALUES" in full:
            cat = "Bank Fees & Charges"
        elif "INSTANT TRANSFER FROM" in full:
            cat = "Instant Transfer In"
        elif "INSTANT TRANSFER TO" in full:
            cat = "Instant Transfer Out"
        ledger.append({
            "no": i + 1, "page": r.get("page"), "date": r.get("date") or "",
            "ym": vd, "month": MONTHS.get(vd[1]) if vd else "Unattributed",
            "debit": r.get("debit"), "credit": r.get("credit"),
            "desc": desc, "memo": memo_txt[:120], "cat": cat,
            "conf": bool(r.get("consensus")),
        })

    months = ["March", "April", "May", "June", "July", "August", "September", "Unattributed"]
    monthly = []
    for mo in months:
        mrows = [r for r in ledger if r["month"] == mo]
        d = round(sum(r["debit"] or 0 for r in mrows), 2)
        c = round(sum(r["credit"] or 0 for r in mrows), 2)
        if mo != "Unattributed" or mrows:
            monthly.append({"month": mo, "debit": d, "credit": c, "count": len(mrows),
                            "net": round(c - d, 2)})

    cats = defaultdict(lambda: {"debit": 0.0, "credit": 0.0, "count": 0})
    for r in ledger:
        e = cats[r["cat"]]
        e["debit"] += r["debit"] or 0
        e["credit"] += r["credit"] or 0
        e["count"] += 1
    cat_rows = [{"cat": k, "debit": round(v["debit"], 2), "credit": round(v["credit"], 2),
                 "count": v["count"]} for k, v in sorted(cats.items(), key=lambda x: -(x[1]["debit"] + x[1]["credit"]))]

    big = sorted([r for r in ledger if (r["debit"] or 0) + (r["credit"] or 0) >= 100000],
                 key=lambda r: -((r["debit"] or 0) + (r["credit"] or 0)))
    rev = [r for r in ledger if r["cat"] == "Transfer Reversal"]

    out = {
        "rows": ledger,
        "opening": data["opening"], "closing": data["closing"],
        "totalDebits": data["totalDebits"], "totalCredits": data["totalCredits"],
        "sumDebits": data["sumDebits"], "sumCredits": data["sumCredits"],
        "count": len(ledger),
        "consensusCount": sum(1 for r in ledger if r["conf"]),
        "monthly": monthly, "categories": cat_rows,
        "bigTransactions": big[:20], "reversalCount": len(rev),
        "reversalMass": round(sum((r["debit"] or 0) + (r["credit"] or 0) for r in rev), 2),
    }
    json.dump(out, open(f"{WORK}/report_data.json", "w"), indent=1)

    print(f"rows={len(ledger)}  consensus={out['consensusCount']}")
    print(f"D={data['sumDebits']:,.2f} vs printed {data['totalDebits']:,.2f}")
    print(f"C={data['sumCredits']:,.2f} vs printed {data['totalCredits']:,.2f}")
    print("\nmonthly:")
    for m in monthly:
        print(f"  {m['month']:<13} C={m['credit']:>13,.2f} D={m['debit']:>13,.2f} net={m['net']:>+13,.2f} n={m['count']}")
    print("\ncategories:")
    for c in cat_rows:
        print(f"  {c['cat']:<24} C={c['credit']:>13,.2f} D={c['debit']:>13,.2f} n={c['count']}")
    print(f"\nbig transactions (>=100k): {len(big)}")
    print(f"reversals: {len(rev)} rows, mass {out['reversalMass']:,.2f}")


if __name__ == "__main__":
    main()
