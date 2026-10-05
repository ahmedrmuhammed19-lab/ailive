/**
 * alahly_report.ts — Final full analysis report: NBE (National Bank of Egypt)
 * EGP Savings Account of EID FARAG SAAD SHAAT — 01/03/2026 → 09/09/2026.
 * Built on the FIRM'S canonical template (src/lib/report_design.ts, verbatim).
 * Data: scripts/alahly_work/report_data.json (three-pass OCR + chain analysis).
 *
 * Usage: bun scripts/alahly_report.ts <out-path>
 */
import { readFile, writeFile } from "fs/promises";
import {
  reportShell, alertBox, kpiGrid, kpiCard, sectionTitle, tag, escHtml, analysisCard, analysisGrid,
} from "../src/lib/report_design";

const WORK = "/home/z/my-project/scripts/alahly_work";
const egp = (v: number) => `EGP ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const egpS = (v: number) => `${v < 0 ? "−" : ""}EGP ${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function tbl(headers: string[], rows: string[][], cls = ""): string {
  const th = headers.map((h) => `<th>${h}</th>`).join("");
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<table class="data-table ${cls}"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

async function main() {
  const outPath = process.argv[2];
  const D = JSON.parse(await readFile(`${WORK}/report_data.json`, "utf8"));
  const A = D.anchors, M = D.mass;

  // ---------- banners ----------
  const banners = [
    alertBox(
      "blue",
      `Scan-source verification ${tag("3-PASS OCR", "low")} ${tag("PRINTED ANCHORS VERIFIED", "pass")} ${tag("ROW COVERAGE " + M.coverage_pct + "%", "warn")}`,
      `<p style="margin:0">The 23-page statement is a scan with no text layer. Three independent OCR passes (450 / 600 / 900 DPI, geometry-merged) reconstructed ${M.total_rows} ledger rows. The bank's own printed anchors reconcile exactly (Section 3); per-row flows are reported from the ${M.verified_rows} locally chain-reconciled rows, with the residual disclosed in Section 7.</p>`
    ),
    alertBox(
      "green",
      `✅ WINDOW NOTE — 6-month embassy lookback applied`,
      `<p style="margin:0">Statement spans 6.3 months (01/03/2026 → 09/09/2026). Metrics use the most recent 6 months (10/03/2026 → 09/09/2026); early-March ledger rows remain chain-verified for integrity but sit outside the window metrics.</p>`
    ),
  ];

  // ---------- 1. executive dashboard ----------
  const s1 = sectionTitle("1. Executive Dashboard &amp; Verified Position") +
    alertBox(
      "green",
      `✅ OVERVIEW: Active account with exact printed-anchor reconciliation`,
      `<p style="margin:0">The account operated at high frequency across the 6.3-month review period (${M.total_rows} ledger rows reconstructed, ${M.verified_rows} locally chain-reconciled — ${M.coverage_pct}% row coverage). The balance advanced from ${egp(A.opening)} to ${egp(A.closing)} — a net accumulation of ${egp(A.net)}. The bank's printed closing identity reconciles exactly: <strong>Current 631,182.24 = Available 431,162.24 + Hold 200,030.00 + Uncollected 0.00</strong>. Activity is dominated by IPN instant-transfer churn with systematic reversal loops: most outgoing transfers return as "IPN Balance/Ing Fees" credits, so gross flows overstate true economic movement. The closing position is additionally supported by the printed amount-in-words: <em>"Four Hundred Thirty One Thousand One Hundred Sixty Two Egyptian Pounds And Twenty Four Piastres Only"</em> (= Available ${egp(A.available)}).</p>`
    ) +
    kpiGrid([
      kpiCard("Closing Balance (bank-stated)", egp(A.closing), "06/09/2026 — last ledger row", "success"),
      kpiCard("Opening Balance (b/f)", egp(A.opening), "value date 26/02/2026", ""),
      kpiCard("Net Period Movement", egp(A.net), "printed anchors: 631,182.24 − 467,525.43", "success"),
      kpiCard("Funds on Hold at Print", egp(A.hold), "available at print: " + egp(A.available) + " (10/09/2026)", "warning"),
    ]);

  // ---------- 2. identification ----------
  const s2 = sectionTitle("2. Account &amp; Holder Identification") +
    tbl(["Field", "Detail"], [
      ["Account Holder Name:", `<strong>${escHtml(A.holder)}</strong>`],
      ["Bank Name / Branch:", escHtml(A.bank)],
      ["Account Number:", `<code>${A.account}</code>`],
      ["IBAN:", `<code>${A.iban}</code>`],
      ["Account Type:", escHtml(A.type)],
      ["Statement Period:", `01/03/2026 to 09/09/2026 (approx. 6.3 months, 23 scanned pages, printed 10/09/2026 7:16:30 PM)`],
      ["Embassy 6-Month Window:", `10/03/2026 → 09/09/2026 (early-March rows excluded from window metrics, retained for chain integrity)`],
    ]);

  // ---------- 3. verification ----------
  const s3 = sectionTitle("3. Balance Chain Verification &amp; Reconciliation") +
    `<p style="margin-top:0">This statement prints a running balance on every ledger row — a material advantage over scan-only layouts. Each captured row was chained against its predecessor across three OCR passes:</p>` +
    tbl(["Verification Layer", "Result", "Basis"], [
      [`${tag("PASS", "pass")} Printed opening anchor`, egp(A.opening), "Balance b/f row, value date 26/02/2026"],
      [`${tag("PASS", "pass")} Printed closing anchor`, egp(A.closing), "Last ledger row 06/09/2026 (900-DPI targeted re-read)"],
      [`${tag("PASS", "pass")} Printed closing identity`, "exact", escHtml(A.identity)],
      [`${tag("PASS", "pass")} Amount-in-words cross-check`, "exact", "“Four Hundred Thirty One Thousand One Hundred Sixty Two … Twenty Four Piastres” = " + egp(A.available)],
      [`${tag("PASS", "pass")} Per-row chain (local pairs)`, `${M.verified_rows} / ${M.total_rows} rows (${M.coverage_pct}%)`, "Δ between consecutive printed balances explained by captured amounts"],
      [`${tag("DISCLOSED", "warn")} Residual`, egpS(M.residual), "reconstructed net vs printed net — attributed to unread amount cells on degraded pages (Section 7)"],
    ]) +
    analysisGrid([
      analysisCard("Reading Protocol", `<ul style="margin:0;padding-left:18px">
<li><strong>Pass 1 — 450 DPI full page</strong>: text + word geometry (TSV).</li>
<li><strong>Pass 2 — 600 DPI numeric band</strong>: digit-whitelisted amounts, balances, value dates.</li>
<li><strong>Pass 3 — 900 DPI targeted</strong>: credit column, opening b/f row, final ledger row and the closing block.</li>
<li><strong>Chain solver</strong>: direction is taken from the printed balance walk (the printed leading “−” on amounts is a print artifact); single- and two-digit confusion variants (4↔9, 0↔5, 1↔7, 3↔8, 5↔6, 2↔9) tested against continuity; unread small fee amounts recovered exactly from balance deltas.</li>
</ul>`),
      analysisCard("Anchor Reconciliation", `<p style="margin:0">Opening + Net = Closing:<br><strong>${egp(A.opening)} + ${egp(A.net)} = ${egp(A.closing)}</strong><br><br>The closing block identity holds to the piaster, and the amount-in-words independently confirms the available balance. The ledger's internal arithmetic is therefore anchored at both ends; reconstruction risk is confined to individual row amounts, not to the verified position.</p>`),
    ]);

  // ---------- 4. monthly ----------
  const monthRows = Object.entries(D.monthly).map(([k, v]: [string, any]) => {
    const net = v.c - v.d;
    return [escHtml(k), egp(v.c), egp(v.d), `<span class="${net >= 0 ? "text-success" : "text-danger"}">${egpS(net)}</span>`, String(v.n)];
  });
  const s4 = sectionTitle("4. Monthly Financial Trajectory") +
    `<p style="margin-top:0">Monthly flows below aggregate the ${M.verified_rows} chain-reconciled rows (window-adjusted). Gross figures are inflated by the reversal-loop pattern: a transferred-out amount that returns is counted once in outflows and once in inflows. March carries the heaviest churn; the account still nets positive over the period.</p>` +
    tbl(["Month", "Total Credits (verified rows)", "Total Debits (verified rows)", "Net Flow", "Rows"], monthRows) +
    alertBox("blue", "Reading note",
      `<p style="margin:0">Rows that could not be locally reconciled (${M.unverified} rows) are excluded from this table and disclosed in Section 7; printed anchors bound the true totals. The ${egp(A.hold)} hold at print time (10/09) sits outside the ledger period.</p>`);

  // ---------- 5. sources & utilization ----------
  const cname: Record<string, string> = {
    fee: "IPN reversals &amp; fee refunds (returned transfers)",
    ipn_out: "Instant transfers (IPN) — outgoing",
    transfer_in: "Incoming transfers / receipts",
    atm: "ATM withdrawals",
    card: "Card settlements (VISA)",
    other: "Other / unclassified",
  };
  const inRows = Object.entries(D.cats).filter(([, v]: any) => v["in"] > 0)
    .map(([k, v]: any) => [cname[k] ?? k, egp(v["in"]), `${v["n"]} rows`]);
  const outRows = Object.entries(D.cats).filter(([, v]: any) => v["out"] > 0)
    .map(([k, v]: any) => [cname[k] ?? k, egp(v["out"]), `${v["n"]} rows`]);
  const s5 = sectionTitle("5. Source &amp; Utilization of Funds") +
    analysisGrid([
      analysisCard("Major Income Sources (verified rows)", tbl(["Income Source", "Amount", "Volume"], inRows) +
        `<p class="small" style="margin-bottom:0">The dominant “credit” mass is the return leg of the reversal loops — funds that come back after failed outgoing IPN transfers. Genuine fresh inflows are the smaller non-reversal receipts.</p>`),
      analysisCard("Major Expenditure Patterns (verified rows)", tbl(["Expense Category", "Amount", "Volume"], outRows) +
        `<p class="small" style="margin-bottom:0">Outgoing IPN transfers dominate gross outflows. Most individually return; the economically net outflow is the printed ${egp(A.net)} period result plus any unreturned transfers.</p>`),
    ]) +
    alertBox("red", `⚠ Reversal-loop pattern — same behaviour as the companion Wafa account`,
      `<p style="margin:0">The ledger shows repeated “outgoing transfer → fee → full return + fee refund” cycles (desc “IPN Balance Ing Fees… To/From Revenue from non-financial”). This is high-throughput testing of the IPN rail, not sustained third-party income. For embassy purposes the <strong>printed opening/closing anchors and the available balance are the reliable figures</strong>; gross churn should not be presented as income.</p>`);

  // ---------- 6. counterparties ----------
  const cpRows = D.counterparties.map((c: any) => [
    escHtml(c.name), String(c.n),
    c["in"] ? egp(c["in"]) : "—",
    c["out"] ? egp(c["out"]) : "—",
    egpS(c["in"] - c["out"]),
  ]);
  const s6 = sectionTitle("6. Key Associated Parties &amp; Net Exposure") +
    `<p style="margin-top:0">Counterparty names are captured where OCR-legible; the “own-name” cluster (EID FARAG SAAD SHAAT) reflects transfers to/from accounts carrying the holder's own name. Net Exposure = inflow − outflow per party.</p>` +
    tbl(["Party / Name", "Rows", "Total In", "Total Out", "Net Exposure"], cpRows) +
    alertBox("blue", "🔍 Adjusted View Insight",
      `<p style="margin:0">Strip the reversal loops from both sides and the account's true external flow is the printed net ${egp(A.net)} — modest accumulation, not high-net inflow. The holder's financial profile should therefore be evidenced by the <strong>closing balance (${egp(A.closing)}) and available funds (${egp(A.available)})</strong>, supported by the companion Wafa account's income streams.</p>`);

  // ---------- 7. risk ----------
  const s7 = sectionTitle("7. Risk &amp; Compliance Indicators (Agent Action Items)") +
    analysisGrid([
      analysisCard("Advisory Flags (Requires Agent Attention)", `<ul style="margin:0;padding-left:18px">
<li><strong>Scan-only source:</strong> no text layer; row coverage ${M.coverage_pct}% with a reconstructed-vs-printed residual of ${egpS(M.residual)}. <em>Action:</em> obtain the bank-issued PDF statement to lift verification to 100%.</li>
<li><strong>Funds on hold:</strong> ${egp(A.hold)} of the closing position was on hold at print time — available funds are ${egp(A.available)}. <em>Action:</em> confirm the hold's nature and release date with the branch before submission.</li>
<li><strong>Reversal-loop churn:</strong> repeated large IPN transfers returning in full. <em>Action:</em> be ready to explain the pattern; do not present gross credits as income.</li>
<li><strong>Below-window rows:</strong> early-March rows sit outside the embassy 6-month window and are excluded from window metrics.</li>
</ul>`),
      analysisCard("Positive Indicators (Strengthens Profile)", `<ul style="margin:0;padding-left:18px">
<li><strong>Exact anchor reconciliation:</strong> opening + net = closing and the closing identity both hold to the piaster.</li>
<li><strong>Printed amount-in-words match:</strong> “Four Hundred Thirty One Thousand One Hundred Sixty Two … Twenty Four Piastres” independently confirms available funds.</li>
<li><strong>Per-row running balances:</strong> every row prints its own balance — materially stronger than the companion Wafa scan.</li>
<li><strong>Stable, growing balance:</strong> ${egp(A.opening)} → ${egp(A.closing)} over 6.3 months with no unexplained swings.</li>
<li><strong>IBAN printed:</strong> ${A.iban} — full account traceability.</li>
</ul>`),
    ]);

  // ---------- 8. conclusion ----------
  const s8 = sectionTitle("8. Analyst Conclusion &amp; Recommendations") +
    analysisCard("Executive Summary", `<p style="margin:0">The National Bank of Egypt EGP savings account of <strong>EID FARAG SAAD SHAAT</strong> (${A.account}, New Nubaria Branch) shows a genuinely operating profile for 01/03/2026–09/09/2026. The printed anchors reconcile exactly: the balance advanced from ${egp(A.opening)} to <strong>${egp(A.closing)}</strong> — net ${egp(A.net)} — and the print-time closing identity (Current = Available ${egp(A.available)} + Hold ${egp(A.hold)}) holds to the piaster. Activity is dominated by IPN instant-transfer churn with systematic reversal loops; gross churn must not be read as income. Verification is <strong>PARTIAL (scan-only, ${M.coverage_pct}% row coverage)</strong> with printed anchors exact.</p>`, true) +
    analysisCard("Financial Strength &amp; Submission Guidance", `<p style="margin:0">The verified closing position of ${egp(A.closing)} — of which ${egp(A.available)} was immediately available — clears the default EGP 150,000 embassy benchmark 2.9×. Combined with the companion Wafa current account (closing EGP 523,295.93, verified to the piaster), the holder's consolidated banking position exceeds EGP 1.15 million across two banks. Present the printed anchors as the primary evidence; disclose the reversal-loop pattern proactively; attach the bank-issued PDF when available to complete 100% chain verification.</p>`, true) +
    alertBox("red", `⚠ Critical Recommendation for Official Submission`,
      `<p style="margin:0 0 8px">To preempt strict financial-compliance checks, include the following with the submission:</p>
<ul style="margin:0 0 0 20px">
<li><strong>Bank-issued PDF statement</strong> for this NBE account — unlocks 100% per-row chain verification (current: ${M.coverage_pct}%).</li>
<li><strong>Hold-release confirmation</strong> for the ${egp(A.hold)} pending amount at print time.</li>
<li><strong>Companion Wafa report</strong> (already delivered, exact reconciliation) as the primary income evidence.</li>
<li><strong>Source-of-funds note</strong> explaining the IPN reversal-loop testing pattern.</li>
</ul>`);

  // ---------- notable transactions ----------
  const nRows = D.notable.map((n: any) => [
    escHtml(n.date),
    escHtml(n.desc.slice(0, 64)),
    `<span class="${n.signed >= 0 ? "text-success" : "text-danger"}">${egpS(n.signed)}</span>`,
    egp(n.bal),
  ]);
  const sNotable = sectionTitle("Appendix — Notable Transactions (≥ EGP 40,000, chain-reconciled)") +
    tbl(["Date", "Description (OCR)", "Amount", "Printed Balance After"], nRows);

  const html = reportShell({
    title: "Bank Statement Analysis Report",
    subLines: [
      `<strong>National Bank of Egypt — EGP Savings Account</strong>`,
      `EID FARAG SAAD SHAAT · 01/03/2026 → 09/09/2026 · New Nubaria Branch`,
    ],
    banners,
    contentHtml: s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8 + sNotable,
    pageTitle: "Global EIS - NBE Statement Analysis Report (Eid Farag - NBE EGP)",
  });

  await writeFile(outPath, html, "utf8");
  console.log(`WROTE ${outPath} (${Buffer.byteLength(html)} bytes)`);
}

main();
