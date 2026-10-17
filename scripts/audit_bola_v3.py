#!/usr/bin/env python3
"""DL-23 audit of download/Bola_Ayad_Gerges_Global_EIS_Report_v3.html section 4.

Re-derives every figure from the raw monthly data (screenshot + orig report JSON)
and diffs against what the v3 HTML actually renders. Exit 1 on any mismatch.
"""
import json
import re
import sys

HTML = "download/Bola_Ayad_Gerges_Global_EIS_Report_v3.html"
MONTHLY = "scripts/bola_rev2/bola_monthly.json"

html = open(HTML, encoding="utf-8").read()
monthly = json.load(open(MONTHLY, encoding="utf-8"))

failures = []

def check(label, expected, found, tol=0.005):
    ok = abs(expected - found) < tol
    print(f"  {'PASS' if ok else 'FAIL'}  {label}: expected {expected:,.2f} | html {found:,.2f}")
    if not ok:
        failures.append(label)

def cell_number(row_html):
    """Extract the last plain number cell text from a <tr> fragment."""
    nums = re.findall(r"([+\u2212-]?\d[\d,]*\.?\d*)", re.sub(r"<[^>]+>", " ", row_html))
    if not nums:
        return None
    txt = nums[-1].replace(",", "")
    txt = txt.replace("\u2212", "-")  # unicode minus
    return float(txt)

# --- independent source of truth: the per-account monthly figures (from screenshot/orig) ---
src = {
    "July":  {"sav": (36437.19, 60802.50), "cur": (73708.44, 74300.00)},
    "August": {"sav": (28304.56, 402.50), "cur": (70.50, 0.00)},
}
print("== monthly.json as generator input ==")
print(json.dumps(monthly, indent=1, ensure_ascii=False)[:1200])

print("\n== audit: per-row GRAND columns (July & August) ==")
# grab each month row
for month, key in (("July 2026", "July"), ("August 2026", "August")):
    m = re.search(re.escape(month) + r".*?</tr>", html, re.S)
    if not m:
        failures.append(f"{month} row missing")
        print(f"  FAIL  {month}: row not found in HTML")
        continue
    row = m.group(0)
    nums = [float(x.replace(",", "").replace("\u2212", "-")) for x in re.findall(r"([+\u2212-]?\d[\d,]*\.\d{2})", re.sub(r"<[^>]+>", "|", row))]
    # expected sequence: savD savC savNet curD curC curNet grandD grandC grandNet closing
    sav, cur = src[key]["sav"], src[key]["cur"]
    exp = [sav[0], sav[1], sav[1] - sav[0], cur[0], cur[1], cur[1] - cur[0],
           sav[0] + cur[0], sav[1] + cur[1], (sav[1] + cur[1]) - (sav[0] + cur[0])]
    got = nums[:9]
    labels = ["savD", "savC", "savNet", "curD", "curC", "curNet", "grandD", "grandC", "grandNet"]
    for lab, e, g in zip(labels, exp, got):
        check(f"{month} {lab}", e, g)

print("\n== audit: WINDOW TOTAL row ==")
m = re.search(r"WINDOW TOTAL.*?</tr>", html, re.S)
if not m:
    failures.append("WINDOW TOTAL row missing")
    print("  FAIL  row not found")
else:
    nums = [float(x.replace(",", "").replace("\u2212", "-")) for x in re.findall(r"([+\u2212-]?\d[\d,]*\.\d{2})", re.sub(r"<[^>]+>", "|", m.group(0)))]
    exp = [64741.75, 61205.00, -3536.75, 73778.94, 74300.00, 521.06, 138520.69, 135505.00, -3015.69]
    labels = ["savD", "savC", "savNet", "curD", "curC", "curNet", "grandD", "grandC", "grandNet"]
    for lab, e, g in zip(labels, exp, nums[:9]):
        check(f"WINDOW {lab}", e, g)

print("\n== audit: Income & Expense Summary ==")
summ = {
    "Total income — window": 135505.00,
    "Annual income — gross run-rate": 135505.00 * 365 / 42,
    "Annual income — verified external run-rate": 400.00 * 365 / 42,
    "Monthly expense — window average": 138520.69 / 42 * 30.44,
    "Monthly expense — July": 110145.63,
}
for label, expected in summ.items():
    i = html.find(label)
    if i < 0:
        failures.append(f"summary row missing: {label}")
        print(f"  FAIL  summary row not found: {label}")
        continue
    # take the first number cell that follows the label
    seg = html[i: i + 700]
    nums = re.findall(r"([+\u2212-]?\d[\d,]*\.\d{2})", re.sub(r"<[^>]+>", "|", seg))
    if not nums:
        failures.append(f"summary number missing: {label}")
        print(f"  FAIL  no number after label: {label}")
        continue
    got = float(nums[0].replace(",", "").replace("\u2212", "-"))
    check(label, expected, got)

print("\n== structural checks ==")
print(f"  html length: {len(html)}")
print(f"  ends with </html>: {html.rstrip().endswith('</html>')}")
for probe in ("GRAND", "grandD", "All Accounts", "GRAND DEBITS", "GRAND CREDITS"):
    print(f"  contains {probe!r}: {probe in html}")
hdr = re.search(r"<thead>.*?</thead>", html[html.find("Financial Trajectory"): html.find("Financial Trajectory") + 3000], re.S)
if hdr:
    headtxt = re.sub(r"<[^>]+>", " | ", hdr.group(0))
    print("  table header:", re.sub(r"\s+", " ", headtxt)[:400])

print("\n== RESULT ==")
if failures:
    print(f"  {len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("  ALL CHECKS PASS")
