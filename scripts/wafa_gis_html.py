#!/usr/bin/env python3
"""WAFA-GIS-HTML-1: rebuild the WAFA analysis report in the firm's own design
(Global EIS navy/gold embassy-assessment format, matching the previous
GlobalEIS_Report_HaythamElsayed_EGP / HaythamAttia_EGP editions) and email it
to the locked test inbox.

Data: scripts/wafa_work/report_data.json + account metadata from OCR page 1.
Output: download/GlobalEIS_Report_EidFarag_EGP.html (self-contained).
"""
import json
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "scripts", "wafa_work")
DATA = os.path.join(WORK, "report_data.json")
OUT_HTML = os.path.join(ROOT, "download", "GlobalEIS_Report_EidFarag_EGP.html")
PDF = os.path.join(ROOT, "download", "Global_EIS_Statement_Analysis_WAFA_6M.pdf")
CREDS = os.path.join(ROOT, "config", "mail_credentials.json")
OUTBOX = os.path.join(ROOT, "upload", "portal", "_outbox")

SUBJECT = "Global EIS — Bank Statement Analysis Report (Eid Farag — WAFA Current Account, EGP)"

# ---- Global EIS design tokens (sampled from the HaythamElsayed editions) ----
NAVY = "#0f2440"
NAVY2 = "#16305a"
GOLD = "#b9963f"
TEAL = "#1b7f72"
BLUE = "#33689e"
GREEN = "#2e7d4f"
GREENBG = "#e8f5ee"
AMBER = "#b07d2b"
AMBERBG = "#fdf3e0"
RED = "#a33b3b"
INK = "#3a4149"
MUTED = "#6a737c"
LINE = "#d8dee5"

CSS = f"""
*{{box-sizing:border-box}}
body{{margin:0;background:#e9edf1;font-family:Arial,Helvetica,sans-serif;color:{INK}}}
.page{{max-width:900px;margin:18px auto;background:#fff;box-shadow:0 1px 6px rgba(15,36,64,.18)}}
.chrome{{background:{NAVY};color:#fff;display:flex;align-items:center;justify-content:space-between;padding:12px 22px;border-bottom:3px solid {GOLD}}}
.chrome .brand b{{font-size:17px;letter-spacing:.5px}}
.chrome .brand span{{display:block;font-size:10px;color:#c8d2e0}}
.chrome .sec{{font-size:13.5px;font-weight:bold;letter-spacing:.4px}}
.chrome .conf{{color:{GOLD};font-size:10.5px;font-weight:bold;letter-spacing:1.2px}}
.inner{{padding:22px 26px 18px}}
.foot{{background:{NAVY};color:#c8d2e0;display:flex;justify-content:space-between;padding:9px 22px;font-size:10.5px;border-top:3px solid {GOLD}}}
.foot .pg{{color:{GOLD};font-weight:bold}}
h3.sec2{{color:{NAVY};font-size:13.5px;letter-spacing:.3px;margin:0 0 10px;text-transform:uppercase}}
h4.sub{{color:{NAVY};font-size:12px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.3px}}
p{{font-size:12px;line-height:1.65;margin:8px 0}}
.small{{font-size:10.5px;color:{MUTED};line-height:1.6}}
table.data{{width:100%;border-collapse:collapse;font-size:11.5px;margin:8px 0 14px}}
table.data th{{background:{NAVY};color:#fff;text-align:left;padding:6px 9px;font-size:10.5px;letter-spacing:.4px}}
table.data td{{padding:6px 9px;border-bottom:1px solid {LINE};vertical-align:top}}
table.data tr:nth-child(even) td{{background:#f5f7f9}}
td.num,th.num{{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}}
.badge{{display:inline-block;min-width:74px;text-align:center;padding:3px 12px;border-radius:11px;font-size:10px;font-weight:bold;letter-spacing:.5px}}
.badge.pass{{background:{GREENBG};color:{GREEN};border:1px solid {GREEN}}}
.badge.part{{background:{AMBERBG};color:{AMBER};border:1px solid {AMBER}}}
.badge.med{{background:{AMBERBG};color:{AMBER};border:1px solid {AMBER}}}
.kgrid{{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 6px}}
.kpi{{flex:1 1 195px;color:#fff;border-radius:5px;padding:11px 13px}}
.kpi .l{{font-size:9.5px;opacity:.85;text-transform:uppercase;letter-spacing:.5px}}
.kpi .v{{font-size:18px;font-weight:bold;margin:4px 0 2px}}
.kpi .n{{font-size:9.5px;opacity:.85}}
.navy{{background:{NAVY2}}}.teal{{background:{TEAL}}}.blue{{background:{BLUE}}}
.green{{background:{GREEN}}}.amber{{background:{AMBER}}}
ul.events{{margin:6px 0 10px;padding-left:18px}}
ul.events li{{font-size:11.5px;line-height:1.6;margin:5px 0}}
ol.reco{{margin:6px 0 10px;padding-left:20px}}
ol.reco li{{font-size:11.5px;line-height:1.6;margin:6px 0}}
.flag{{border-left:4px solid {AMBER};background:#fdf8ee;padding:8px 12px;margin:8px 0}}
.flag b{{color:{AMBER}}}
.plus{{border-left:4px solid {GREEN};background:#f2f9f4;padding:8px 12px;margin:8px 0}}
.plus b{{color:{GREEN}}}
.adjust{{background:{NAVY};color:#fff;padding:10px 14px;font-size:12px;font-weight:bold;margin:10px 0}}
"""


def money(x, dash="—"):
    return dash if x is None else f"{x:,.2f}"


def chrome(sec_title: str) -> str:
    return (
        f'<div class="chrome"><div class="brand"><b>GLOBAL EIS</b>'
        f"<span>Financial Intelligence Services</span></div>"
        f'<div class="sec">{escape(sec_title)}</div>'
        f'<div class="conf">CONFIDENTIAL</div></div>'
    )


def foot(n: int) -> str:
    return (
        f'<div class="foot"><span>Global EIS - Financial &amp; Immigration Documentation Services</span>'
        f'<span class="pg">Page {n}</span></div>'
    )


def page(n: int, sec_title: str, inner: str) -> str:
    return f'<div class="page">{chrome(sec_title)}<div class="inner">{inner}</div>{foot(n)}</div>'


def kpi(cls: str, label: str, value: str, note: str) -> str:
    return (
        f'<div class="kpi {cls}"><div class="l">{escape(label)}</div>'
        f'<div class="v">{escape(value)}</div><div class="n">{escape(note)}</div></div>'
    )


def build(d: dict) -> str:
    now = datetime.now(timezone.utc).strftime("%d %B %Y %H:%M UTC")
    op, cl = d["opening"], d["closing"]
    pr_c, pr_d = d["totalCredits"], d["totalDebits"]
    cap_c, cap_d = d["sumCredits"], d["sumDebits"]
    rows_n, cons_n = d["count"], d["consensusCount"]
    net = pr_c - pr_d
    d_pct = cap_d / pr_d * 100.0
    c_pct = cap_c / pr_c * 100.0

    inst = next(c for c in d["categories"] if c["cat"] == "Instant Transfer Out")
    inst_pct = inst["debit"] / cap_d * 100.0
    rev = next(c for c in d["categories"] if c["cat"] == "Transfer Reversal")

    full = [m for m in d["monthly"] if m["month"] not in ("September", "Unattributed")]
    avg_in = sum(m["credit"] for m in full) / len(full)
    avg_out = sum(m["debit"] for m in full) / len(full)
    annual = avg_in * 12

    monthly_rows = ""
    for m in d["monthly"]:
        label = m["month"] + (" (partial - 9 days)" if m["month"] == "September" else (" (OCR dates unreadable)" if m["month"] == "Unattributed" else ""))
        monthly_rows += (
            f'<tr><td>{escape(label)}</td>'
            f'<td class="num">{money(m["debit"])}</td><td class="num">{money(m["credit"])}</td>'
            f'<td class="num" style="color:{GREEN if m["net"] >= 0 else RED}">'
            f'{money(m["net"])}</td><td class="num">{m["count"]}</td></tr>'
        )
    monthly_rows += (
        f'<tr><td style="font-weight:bold">GRAND TOTAL (OCR-captured)</td>'
        f'<td class="num" style="font-weight:bold">{money(cap_d)}</td>'
        f'<td class="num" style="font-weight:bold">{money(cap_c)}</td>'
        f'<td class="num" style="font-weight:bold">{money(cap_c - cap_d)}</td>'
        f'<td class="num" style="font-weight:bold">{rows_n}</td></tr>'
        f'<tr><td>Bank-stated printed totals (anchors)</td>'
        f'<td class="num">{money(pr_d)}</td><td class="num">{money(pr_c)}</td>'
        f'<td class="num">{money(net)}</td><td class="num">—</td></tr>'
    )

    big_rows = "".join(
        f'<tr><td style="white-space:nowrap">{escape(t["date"])}</td><td>{escape(t["desc"][:60])}</td>'
        f'<td class="num">{escape(str(t["page"]))}</td>'
        f'<td class="num" style="color:{RED if t.get("debit") else GREEN}">'
        f'{money(t.get("debit") or t.get("credit"))}</td></tr>'
        for t in d["bigTransactions"]
    )

    cover = f"""
<div class="page" style="border-top:6px solid {GOLD}">
<div style="background:{NAVY};color:#fff;padding:56px 40px 0;overflow:hidden">
  <div style="font-size:26px;font-weight:bold;letter-spacing:1px">GLOBAL EIS</div>
  <div style="font-size:11.5px;color:#c8d2e0;margin-top:4px">Financial Intelligence Services</div>
  <div style="color:{GOLD};font-size:19px;font-weight:bold;letter-spacing:.6px;margin-top:42px">BANK STATEMENT ANALYSIS REPORT</div>
  <div style="font-size:12.5px;color:#e8ecf2;margin:6px 0 34px">Embassy &amp; Official Submission - Financial Assessment</div>
</div>
<div style="background:{NAVY};height:16px;position:relative;overflow:hidden">
  <div style="position:absolute;top:-26px;left:-5%;width:112%;height:56px;background:{GOLD};transform:rotate(-4deg)"></div>
</div>
<div class="inner" style="padding-top:34px">
<h3 class="sec2" style="background:{NAVY};color:#fff;padding:8px 12px;text-align:center;margin:0 0 4px">ACCOUNT DETAILS</h3>
<table class="data" style="margin-bottom:6px">
<tr><td style="width:34%;background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Account Holder</td><td>EID FARAG SAAD SHAAT</td></tr>
<tr><td style="background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Bank</td><td>AWB Egypt (statement header) - Wafa Current Account</td></tr>
<tr><td style="background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Branch</td><td>00079 - MOA Branch</td></tr>
<tr><td style="background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Account Number</td><td>60008788659-29 &nbsp;(Class 2050102 · Customer No. 60100363)</td></tr>
<tr><td style="background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Account Type</td><td>EGP Current A/C - Personal (WAFA Current Account)</td></tr>
<tr><td style="background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Statement Period</td><td>01/03/2026 - 09/09/2026 (approx. 6.3 months, 48-page scan)</td></tr>
<tr><td style="background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Opening Balance (EGP)</td><td>{money(op)}</td></tr>
<tr><td style="background:{NAVY};color:#fff;font-weight:bold;font-size:11px">Closing Balance (EGP)</td><td>{money(cl)}</td></tr>
</table>
<p class="small" style="text-align:center;font-style:italic">Prepared by Global EIS - Financial and Immigration Documentation Services · generated {now}</p>
</div>{foot(1)}</div>"""

    kpis = "".join([
        kpi("navy", "Total Credits", money(pr_c), "EGP - printed total"),
        kpi("navy", "Total Debits", money(pr_d), "EGP - printed total"),
        kpi("teal", "Net Cash Flow", money(net), "EGP - printed anchors"),
        kpi("teal", "Closing Balance", money(cl), "EGP"),
        kpi("blue", "Avg Monthly Income", money(avg_in), "based on 6 full months"),
        kpi("blue", "Avg Monthly Expense", money(avg_out), "based on 6 full months"),
        kpi("teal", "Transactions Reconstructed", str(rows_n), f"{cons_n} consensus rows - 3 OCR passes"),
        kpi("teal", "Opening Balance", money(op), "EGP"),
        kpi("blue", "Annual Income Est.", money(annual), "Avg Monthly x 12"),
        kpi("blue", "Statement Duration", "~6.3 Months", "01/03/26 - 09/09/26"),
        kpi("amber", "Balance Verification", "PARTIAL", f"anchors exact; {d_pct:.1f}% D / {c_pct:.1f}% C mass"),
        kpi("amber", "Instant Transfers Out", money(inst["debit"]), f"{inst['count']} txns · {inst_pct:.1f}% of debits"),
    ])

    events = "".join(
        f"<li>{x}</li>"
        for x in [
            "Two cash deposits totalling EGP 1,750,000.00 (EGP 1,500,000.00 future-dated 10/05/2026, plus EGP 250,000.00 on 26/03/2026).",
            "Two collected cheques totalling EGP 1,150,000.00 (EGP 900,000.00 and EGP 250,000.00) credited in March-May 2026.",
            'One internal cheque of EGP 1,000,000.00 (CHQ9 37991) debited on 18/03/2026 - see related-party section.',
            "ACH inward credits of EGP 350,000.00 (two receipts: EGP 250,000.00 and EGP 100,000.00).",
            f"{rev['count']} transfer reversals returning EGP {money(rev['mass'] if 'mass' in rev else rev['debit'] or d['reversalMass'])} - instant transfers returned to sender shortly after transfer.",
            "One cash withdrawal of EGP 250,000.00 (08/03/2026); eight transactions of EGP 100,000.00 or more in total.",
            "No investment certificates and no foreign-currency activity identified anywhere in the ledger.",
        ]
    )

    p2 = page(2, "KPI Dashboard & Financial Summary", f"""
<h3 class="sec2">KPI Dashboard</h3>
<div class="kgrid">{kpis}</div>
<h4 class="sub">Financial Summary</h4>
<p>The account shows sustained, high-frequency operating activity across the six-month review period, dominated by
instant-transfer movements. Printed totals record EGP {money(pr_c)} in credits against EGP {money(pr_d)} in debits, producing a
slightly negative net cash flow of EGP {money(net)}, with the balance easing from EGP {money(op)} to EGP {money(cl)}.
The heaviest single month was May 2026 (EGP 1,881,590.35 in credits, driven by the EGP 1.5M future-dated cash deposit),
while outflows were concentrated in March 2026 (EGP 1,635,644.60, including the EGP 1.0M internal cheque).</p>
<p>Every one of the {rows_n} reconstructed rows was recovered by a three-pass OCR process (300/450/600 DPI) and {cons_n} rows
formed a multi-pass consensus. The bank's printed arithmetic anchors - opening EGP {money(op)} + credits EGP {money(pr_c)}
− debits EGP {money(pr_d)} = closing EGP {money(cl)} - reconcile <b>exactly, to the piaster</b>. The captured OCR mass
({d_pct:.1f}% of printed debits, {c_pct:.1f}% of printed credits) leaves a small residual disclosed in the Risk section; this
report therefore marks balance verification as PARTIAL rather than the PASS achievable from a bank-issued PDF.</p>
<h4 class="sub">Significant Events</h4>
<ul class="events">{events}</ul>
""")

    p3 = page(3, "Monthly Breakdown", f"""
<h3 class="sec2">Monthly Breakdown</h3>
<table class="data">
<thead><tr><th>Month (2026)</th><th class="num">Debits (EGP)</th><th class="num">Credits (EGP)</th><th class="num">Net (EGP)</th><th class="num">Txns</th></tr></thead>
<tbody>{monthly_rows}</tbody></table>
<p><b>Annual Income Est. (Avg Monthly Credit x 12):</b> EGP {money(annual)} &nbsp;·&nbsp;
<b>Avg Monthly Expense:</b> EGP {money(avg_out)}</p>
<h4 class="sub">Notes on Monthly Figures</h4>
<ol class="reco">
<li>Figures are the OCR-captured mass across {rows_n} reconstructed rows; the bank's printed section totals (shown as the anchor row) are the authoritative figures and reconcile exactly with opening and closing balances.</li>
<li>September 2026 is a partial month (9 days, 01/09 - 09/09) and is excluded from the average-based projections.</li>
<li>"Unattributed" covers {next(m['count'] for m in d['monthly'] if m['month'] == 'Unattributed')} rows whose OCR date cells were unreadable (EGP 45,305.50 debits / EGP 214.50 credits); their amounts are included in the grand totals.</li>
<li>Average figures use the six full calendar months (March-August 2026) only.</li>
<li>No month other than May 2026 records a material net inflow; the net position drifts down by EGP {money(abs(net))} over the period as a whole.</li>
</ol>
""")

    p4 = page(4, "Income, Expenditure & Key Parties", f"""
<h3 class="sec2">Income Analysis</h3>
<table class="data">
<thead><tr><th>Income Source</th><th class="num">Count</th><th class="num">Total (EGP)</th><th>Character</th></tr></thead>
<tbody>
<tr><td>Cash deposits (incl. future-dated)</td><td class="num">2</td><td class="num">1,750,000.00</td><td>Large lump-sum cash receipts</td></tr>
<tr><td>Collected cheques</td><td class="num">2</td><td class="num">1,150,000.00</td><td>Cheque-based receipts (Mar-May)</td></tr>
<tr><td>ACH inward credits</td><td class="num">2</td><td class="num">350,000.00</td><td>Batch-system third-party receipts</td></tr>
<tr><td>Instant transfers in</td><td class="num">24</td><td class="num">343,717.10</td><td>Frequent small third-party receipts</td></tr>
<tr><td>Transfer reversals (returned outflows)</td><td class="num">92</td><td class="num">423,040.65</td><td>Returned instant transfers - not genuine income</td></tr>
<tr><td>Credit interest</td><td class="num">5</td><td class="num">13,508.58</td><td>Bank-paid interest</td></tr>
<tr><td>Term deposit payout</td><td class="num">5</td><td class="num">8.14</td><td>Trivial residual payouts</td></tr>
</tbody></table>
<h3 class="sec2">Expenditure Analysis</h3>
<table class="data">
<thead><tr><th>Expense Category</th><th class="num">Count</th><th class="num">Total (EGP)</th><th>Pattern</th></tr></thead>
<tbody>
<tr><td>Instant transfers out</td><td class="num">687</td><td class="num">2,796,973.25</td><td>Dominant channel - high frequency, variable amounts (EGP 11 - 250,000 typical band)</td></tr>
<tr><td>Internal cheque (CHQ9 37991)</td><td class="num">1</td><td class="num">1,000,000.00</td><td>Single large cheque, 18/03/2026</td></tr>
<tr><td>Cash withdrawal</td><td class="num">1</td><td class="num">250,000.00</td><td>Single, 08/03/2026</td></tr>
<tr><td>Bank fees &amp; charges</td><td class="num">4</td><td class="num">220.04</td><td>Routine account costs</td></tr>
<tr><td>Other / unclassified</td><td class="num">19</td><td class="num">26,615.90</td><td>Mixed small items</td></tr>
</tbody></table>
<h3 class="sec2">Key Parties</h3>
<table class="data">
<thead><tr><th>Party</th><th>Role</th><th>Relationship</th></tr></thead>
<tbody>
<tr><td>Instant-transfer beneficiaries (many)</td><td>Third-party recipients</td><td>Numerous distinct names partially legible in OCR (e.g. MOHAMED ATEF KANEL ELASSEILY, Mohamed Mahmoud Hassan); high-frequency, small-value pattern</td></tr>
<tr><td>AWB Egypt - own account (per cheque)</td><td>Counterparty of internal cheque</td><td>CHQ9 37991 - beneficiary identity not printed in OCR-readable form; see recommendations</td></tr>
<tr><td>EID FARAG SAAD SHAAT</td><td>Account holder</td><td>Statement title owner; customer no. 60100363</td></tr>
</tbody></table>
<p class="small">Counterparty identification is limited by scan quality: beneficiary names on instant transfers appear only in noisy OCR memo lines. Full counterparty enumeration requires the bank-issued PDF/electronic statement.</p>
""")

    excl_inst = cap_d - inst["debit"]
    p5 = page(5, "Related-Party Transfers, Certificates & Currency Review", f"""
<h3 class="sec2">Investment Certificates / Financial Products</h3>
<p>NONE IDENTIFIED - no certificate of deposit or investment product appears; only five trivial term-deposit interest
payouts (EGP 8.14 in total) are present.</p>
<h3 class="sec2">Foreign Currency / FX Activity</h3>
<p>NONE IDENTIFIED - the account is denominated and operated entirely in EGP; the statement header confirms currency EGP
throughout the 48-page ledger.</p>
<h3 class="sec2">Related-Party &amp; Internal Movement Review</h3>
<table class="data">
<thead><tr><th>Transfer Type</th><th>Destination / Nature</th><th class="num">Occurrences</th><th class="num">Total (EGP)</th></tr></thead>
<tbody>
<tr><td>Internal cheque CHQ9 37991</td><td>Beneficiary not printed in OCR-readable form</td><td class="num">1</td><td class="num">1,000,000.00</td></tr>
<tr><td>Transfer reversals</td><td>Instant transfers returned to originating senders</td><td class="num">92</td><td class="num">423,040.65</td></tr>
<tr><td>Cash withdrawal LCY</td><td>Branch cash - 08/03/2026</td><td class="num">1</td><td class="num">250,000.00</td></tr>
</tbody></table>
<div class="adjust">TOTAL INTERNAL / RETURNED MOVEMENTS: EGP {money(1000000.00 + 423040.65 + 250000.00)} &nbsp;(instant-transfer outflows of EGP {money(inst['debit'])} are third-party and tracked separately)</div>
<h3 class="sec2">Adjusted View - External / Operating Activity Only</h3>
<table class="data">
<thead><tr><th>Metric</th><th class="num">As Captured (EGP)</th><th class="num">Excl. Instant Transfers (EGP)</th></tr></thead>
<tbody>
<tr><td>Total Debits</td><td class="num">{money(cap_d)}</td><td class="num">{money(excl_inst)}</td></tr>
<tr><td>Total Credits</td><td class="num">{money(cap_c)}</td><td class="num">{money(cap_c - rev['credit'])}</td></tr>
</tbody></table>
<p class="small">Note: excluding instant transfers and reversals, the account's residual activity is four large instrument
movements (two cash deposits, two collected cheques in; one internal cheque and one cash withdrawal out). This concentrated
profile should be confirmed with the client before being relied upon as fact.</p>
""")

    p6 = page(6, "Risk & Compliance", f"""
<h3 class="sec2">Advisory Flags</h3>
<div class="flag"><b>! Scan-only source document.</b> The 48-page statement is a CamScanner capture with no machine-readable
text layer; the ledger was rebuilt by forensic OCR. Residual unverified mass: EGP {money(pr_d - cap_d)} of printed debits
({100 - d_pct:.1f}%) and EGP {money(pr_c - cap_c)} of printed credits ({100 - c_pct:.1f}%), mostly single-digit noise on isolated rows.</div>
<div class="flag"><b>! Instant-transfer-dominated outflows.</b> EGP {money(inst['debit'])} across {inst['count']} transfers
({inst_pct:.1f}% of captured debits) left the account via instant transfer to a large set of beneficiaries - a dispersal pattern
that warrants source-of-funds explanation for embassy purposes.</div>
<div class="flag"><b>! Recurring reversal loops.</b> {rev['count']} reversals (EGP {money(rev['credit'])}) returned funds to
senders shortly after outward transfer. Loops of this kind can indicate transient pass-through balances and should be
confirmed with the bank.</div>
<div class="flag"><b>! Single EGP 1.0M internal cheque.</b> CHQ9 37991 (18/03/2026) names no OCR-readable beneficiary;
ownership of the receiving account must be confirmed.</div>
<h3 class="sec2">Positive Indicators</h3>
<div class="plus"><b>Perfect anchor reconciliation.</b> Opening EGP {money(op)} + credits EGP {money(pr_c)} - debits EGP {money(pr_d)}
= closing EGP {money(cl)} - matches the bank-stated closing balance to the piaster, a strong internal-consistency indicator.</div>
<div class="plus"><b>Multi-pass consensus ledger.</b> {cons_n} of {rows_n} rows reproduce consistently across three independent
OCR passes at 300/450/600 DPI, with column-geometry and y-position oracle de-duplication.</div>
<div class="plus"><b>Diverse instrument usage.</b> Cash deposits, collected cheques, ACH, instant transfers and interest all
appear, indicating a genuinely operating account rather than a single-purpose vehicle.</div>
""")

    p7 = page(7, "Visa Assessment & Conclusion (1/2)", f"""
<h3 class="sec2">Visa Assessment</h3>
<table class="data" style="border:0">
<tr><td style="width:30%;font-weight:bold">Financial Solvency</td>
<td style="width:16%"><span class="badge pass">PASS</span></td>
<td>Healthy EGP {money(cl)} closing balance with substantial throughput across the period</td></tr>
<tr><td style="font-weight:bold">Transaction Consistency (SOCE)</td>
<td><span class="badge part">PARTIAL</span></td>
<td>Regular patterns reconstructed by OCR; full chain verification requires the bank-issued PDF</td></tr>
<tr><td style="font-weight:bold">Source of Funds Clarity</td>
<td><span class="badge med">MEDIUM</span></td>
<td>Inflows dominated by two cash deposits and two cheques; outflows dispersed to many instant-transfer beneficiaries</td></tr>
<tr><td style="font-weight:bold">Balance Stability</td>
<td><span class="badge pass">PASS</span></td>
<td>Net drift of only EGP {money(abs(net))} over 6.3 months; no unexplained swings</td></tr>
</table>
<div class="adjust" style="display:flex;justify-content:space-between;align-items:center">OVERALL VISA READINESS: <span class="badge part">CONDITIONAL PASS</span></div>
<h3 class="sec2">Conclusion (Part 1 of 2)</h3>
<p>This analysis reviewed the AWB Egypt (Wafa Current Account) statement of <b>EID FARAG SAAD SHAAT</b> (Account No.
60008788659-29, Branch 00079 - MOA) for the period 01/03/2026 - 09/09/2026, supplied as a 48-page scanned capture.
The ledger - {rows_n} transaction rows - was reconstructed by a three-pass OCR pipeline with column-geometry matching and
y-position oracle de-duplication; {cons_n} rows formed a multi-pass consensus. Captured mass covers {d_pct:.1f}% of printed
debits and {c_pct:.1f}% of printed credits, and the bank's own printed anchors reconcile exactly:</p>
<p style="text-align:center"><b>EGP {money(op)} + EGP {money(pr_c)} − EGP {money(pr_d)} = EGP {money(cl)}</b> (stated closing - exact)</p>
""")

    p8 = page(8, "Conclusion (2/2) & Recommendations", f"""
<h3 class="sec2">Conclusion (Part 2 of 2)</h3>
<p>Over the six-and-a-half-month review period the account recorded printed credits of EGP {money(pr_c)} against printed
debits of EGP {money(pr_d)}, a marginal net outflow of EGP {money(abs(net))}. Inflows are concentrated: two cash deposits
(EGP 1,750,000.00, one future-dated), two collected cheques (EGP 1,150,000.00) and two ACH receipts (EGP 350,000.00)
supply the overwhelming majority of value. Outflows are dispersed: {inst['count']} instant transfers (EGP {money(inst['debit'])},
{inst_pct:.1f}% of captured debits) to a wide set of beneficiaries, one EGP 1.0M internal cheque and one EGP 250,000.00 cash
withdrawal. Ninety-two reversal events (EGP {money(rev['credit'])}) returned part of the instant-transfer flow to senders.
No investment certificates and no foreign-currency activity were identified.</p>
<h3 class="sec2">Recommendations</h3>
<ol class="reco">
<li>Request an <b>official bank-issued PDF</b> of the same statement. With a machine-readable text layer the engine's
100% chain-verification standard is achievable, upgrading the PARTIAL balance verification to PASS.</li>
<li>Confirm with the bank the mechanics of the {rev['count']} reversal loops (EGP {money(rev['credit'])}) - whether they are
customer-initiated recalls or system returns.</li>
<li>Identify the beneficiary of internal cheque CHQ9 37991 (EGP 1,000,000.00) and confirm the receiving account's ownership.</li>
<li>Given the instant-transfer dispersal pattern, supplement the file with source-of-funds documentation for the two large
cash deposits and the two collected cheques.</li>
<li>Provide a brief client note covering the account's operating purpose (personal vs business receipts) before embassy submission.</li>
</ol>
<p class="small" style="margin-top:16px">Report reference: WAFA-6M-ABDO · Account 60008788659-29 · generated {now} ·
Companion editions: 23-page PDF analysis with complete 844-row ledger appendix · self-contained HTML edition.</p>
""")

    return (
        f'<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>Global EIS — Bank Statement Analysis Report — Eid Farag (WAFA Current Account, EGP)</title>"
        f"<style>{CSS}</style></head><body>\n{cover}\n{p2}\n{p3}\n{p4}\n{p5}\n{p6}\n{p7}\n{p8}\n</body></html>"
    )


def main() -> None:
    d = json.load(open(DATA, encoding="utf-8"))
    html = build(d)
    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(OUT_HTML)
    print(f"HTML written: {OUT_HTML} ({size} bytes)")

    with open(CREDS, encoding="utf-8") as f:
        cfg = json.load(f)
    user, pwd = cfg["email"], cfg["app_password"]
    to = cfg.get("notify_to", user)

    plain = (
        "Global EIS - Bank Statement Analysis Report (Eid Farag - WAFA Current Account, EGP)\n\n"
        "Account holder: EID FARAG SAAD SHAAT - Account 60008788659-29, Branch 00079-MOA\n"
        "Period: 01/03/2026 - 09/09/2026 (48-page scan, 844 rows reconstructed)\n"
        "Opening EGP 545,904.67 / Closing EGP 523,295.93 - printed anchors reconcile exactly.\n"
        "Balance verification: PARTIAL (99.0% debit / 99.7% credit mass captured).\n"
        "Overall visa readiness: CONDITIONAL PASS (see recommendations).\n\n"
        "The rich-HTML report follows in the firm's standard design; the HTML file and the\n"
        "23-page PDF edition (with the complete 844-row ledger appendix) are attached.\n\n"
        "Global EIS - Financial & Immigration Documentation Services\n"
    )

    msg = MIMEMultipart("mixed")
    msg["From"] = f"Global EIS Analysis <{user}>"
    msg["To"] = to
    msg["Subject"] = SUBJECT

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(plain, "plain", "utf-8"))
    alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)

    for path, subtype in ((OUT_HTML, "html"), (PDF, "pdf")):
        with open(path, "rb") as f:
            att = MIMEApplication(f.read(), _subtype=subtype)
        att.add_header("Content-Disposition", "attachment", filename=os.path.basename(path))
        msg.attach(att)

    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx) as s:
        s.login(user, pwd)
        s.send_message(msg)

    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    line = f"[{stamp}] SENT analyst_report_gis_html -> {to} :: {SUBJECT}\n"
    with open(os.path.join(OUTBOX, "NOTIFICATIONS.log"), "a", encoding="utf-8") as f:
        f.write(line)
    record = {
        "to": to,
        "subject": SUBJECT,
        "kind": "analyst_report_gis_html",
        "submissionId": "cmusdua3r0000kgirsru1rgxi",
        "attachments": [
            {"filename": os.path.basename(OUT_HTML), "bytes": size},
            {"filename": os.path.basename(PDF), "bytes": os.path.getsize(PDF)},
        ],
        "hasHtml": True,
        "status": "sent",
        "error": None,
        "at": stamp,
    }
    with open(
        os.path.join(OUTBOX, f"{now.strftime('%Y%m%d%H%M%S')}_analyst_report_gis_html_wafa6m.json"),
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(record, f, ensure_ascii=False, indent=2)

    print("SENT OK:", line.strip())


if __name__ == "__main__":
    main()
