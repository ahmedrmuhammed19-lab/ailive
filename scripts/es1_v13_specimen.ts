/**
 * ES-1 — Master v1.3 STANDARD specimen (owner order 2026-10-15).
 *
 * Renders one full specimen page exercising the promoted Elgarayadli
 * vocabulary (flex KPI cards incl. .kpi/.kpi-value/.kpi-label, badges,
 * notes, verdict-box, h2.sec, tr.hl) PLUS the new fixed Appendix A2 —
 * the SO-9 Balance Verification Double-Check (so9DoubleCheck) — then
 * hard-checks the SO-1 gate markers and the SO-4 chain vocabulary.
 *
 * Run: bun scripts/es1_v13_specimen.ts
 * Out: download/GlobalEIS_Master_v1.3_Specimen.html
 */
import {
  REPORT_CSS,
  TEMPLATE_VERSION,
  actionGate,
  alertBox,
  analysisGrid,
  analysisCard,
  annexBlock,
  authenticityAlert,
  escHtml,
  kpiCard,
  kpiGrid,
  reportShell,
  sectionTitle,
  signoff,
  so10Passport,
  so9DoubleCheck,
  stdTitle,
  STANDARD_SECTIONS,
  tag,
  verdictBadge,
  verdictWrap,
  visaReadinessSection,
  type DoubleCheckRow,
} from "../src/lib/report_design";

const kpiValueCard = (label: string, value: string) =>
  `<div class="kpi-card"><div class="kpi-value">${escHtml(value)}</div><div class="kpi-label">${escHtml(label)}</div></div>`;
const compactKpi = (label: string, value: string) =>
  `<div class="kpi"><span class="l">${escHtml(label)}</span><span class="v">${escHtml(value)}</span></div>`;

const dcRows: DoubleCheckRow[] = [
  { id: "DC1", name: "Opening balance anchor (printed header)", firstRun: "135,283.04 EGP", reRun: "printed-header glyph re-read pending analyst", delta: "—", pass: false, pending: true },
  { id: "DC2", name: "Credits total Σ — independent re-aggregation", firstRun: "11,693,311.11 EGP", reRun: "11,693,311.11", delta: "0.00", pass: true },
  { id: "DC3", name: "Debits total Σ — independent re-aggregation", firstRun: "11,738,497.37 EGP", reRun: "11,738,497.37", delta: "0.00", pass: true },
  { id: "DC4", name: "Closing balance telescope (opening + Σ credits − Σ debits)", firstRun: "90,096.78 EGP", reRun: "90,096.78", delta: "0.00", pass: true },
  { id: "DC5", name: "Bank-printed cycle checkpoints (pairs closed)", firstRun: "12/12 pairs closed against printed running balances", reRun: "printed-checkpoint re-read pending analyst", delta: "—", pass: false, pending: true },
];

const content = [
  verdictWrap(
    alertBox("green", "Overview — specimen of the promoted standard", "<p style='margin:0' class='small'>This specimen exercises every vocabulary family of the promoted Elgarayadli build so the owner can eyeball the standard before the next live case.</p>"),
    verdictBadge("SUBMISSION-GRADE", "arithmetic layer reconciles to the cent", true),
  ),
  `<div class="verdict-box"><p style="margin:0 0 8px"><b>Verdict narrative box (generator).</b> The Elgarayadli build's bordered narrative verdict is now standard vocabulary alongside the badge.</p><p style="margin:0" class="small">Both render from the single REPORT_CSS — zero drift (SO-1).</p></div>`,
  kpiGrid([
    kpiCard("Closing balance", "EGP 90,096.78", "31 May 2026", "success"),
    kpiCard("Chain verified", "427/427", "pairs closed, residual 0.00"),
    kpiCard("Bank checkpoints", "12/12", "cycle anchors match", "success"),
    kpiCard("Coverage", "43.8%", "of UK joint benchmark", "warning"),
  ]),
  kpiGrid([kpiValueCard("Compact card via kpi-value / kpi-label", "2,537,761.72"), compactKpi("Compact .kpi card", "6.18x")]),
  sectionTitle("Tables — canonical, generator, highlight rows"),
  `<table class="data-table"><thead><tr><th>Serial</th><th>Narrative</th><th class="text-right">Amount</th><th class="text-right">Balance</th></tr></thead><tbody>
<tr><td>000123</td><td>IBFT by order of another customer</td><td class="num text-success">+1,000,000.00</td><td class="num">1,135,283.04</td></tr>
<tr class="hl"><td>000124</td><td>Highlighted row (tr.hl) — e.g. benchmark violation</td><td class="num text-danger">-96,455.00</td><td class="num">1,038,828.04</td></tr>
<tr class="row-active"><td>000125</td><td>Active-benchmark row (row-active) as used by S10</td><td class="num text-success">+250,000.00</td><td class="num">1,288,828.04</td></tr>
</tbody></table>`,
  `<p>${tag("PASS", "pass")} ${tag("FAIL", "fail")} ${tag("WATCH", "warn")} ${tag("LOW", "low")} ${tag("CREDIT", "credit")} ${tag("DEBIT", "debit")} <span class="badge pass">badge pass</span> <span class="badge caution">badge caution</span> <span class="badge fail">badge fail</span> <span class="badge info">badge info</span></p>`,
  `<div class="note">Generator note box (blue).</div><div class="note warn">Generator note warn.</div><div class="note danger">Generator note danger.</div>`,
  sectionTitle(stdTitle(10)),
  visaReadinessSection(
    [
      { destination: "UK Visit Visa — JOINT, 2 travellers", required: "EGP 205,440.00", pass: true, coverage: "617.6% (6.18x)", active: true, subLines: ["2 × EGP 205,440.00 = EGP 410,880.00"] },
      { destination: "Schengen Visitor Visa (per applicant)", required: "—", pass: true, coverage: "informational — analyst confirms daily benchmark" },
      { destination: "Document Authenticity Screening", required: "—", pass: true, coverage: "chain 100% — no adverse markings" },
    ],
    `<p class="small">Specimen matrix rows — live cases are built from the case's benchmarks.</p>`,
  ),
  sectionTitle(stdTitle(11)),
  analysisGrid([actionGate(1, "Source-of-funds documentation", "Obtain the origin documentation for third-party inflows before submission."), actionGate(2, "Co-traveller documents", "Attach the co-traveller's passport and relationship evidence.")]),
  authenticityAlert("CAMSCANNER 30-09-2026", "<p>Specimen of the document-authenticity alert (rendered only when the source is flagged).</p>"),
  annexBlock("ANNEX — LINKED ACCOUNT REGISTER (SPECIMEN)", "<p class='small'>Annex banner + body vocabulary, unchanged from v1.2.</p>"),
  so10Passport(
    [
      { id: "G1", name: "Serial Census", pass: true, measured: "427 printed serials; census 427/427." },
      { id: "G2", name: "Strict Chain", pass: true, measured: "427/427 pairs closed, residual 0.00." },
      { id: "G8", name: "Re-Derivation", pass: true, measured: "All figures regenerated from parsed tables." },
    ],
    "specimen account 100007554812 (EGP)",
  ),
  so9DoubleCheck(dcRows, "specimen account 100007554812 (EGP)"),
  `<p class="small">Section contract (${STANDARD_SECTIONS.length} entries): ${STANDARD_SECTIONS.map((s) => `${s.label ?? s.no}${s.fixed ? "" : "*"}`).join(", ")} (* = analyst-judgement).</p>`,
  signoff(),
];

const html = reportShell({
  title: "Financial Intelligence Report",
  subLines: [
    `<strong>Account Holder:</strong> SPECIMEN — Master v1.3 standard promotion`,
    `<strong>Account:</strong> 100007554812 (EGP) &nbsp;·&nbsp; <strong>Period:</strong> specimen cycles`,
  ],
  banners: [alertBox("blue", "MASTER v1.3 SPECIMEN — ELGARAYADLI BUILD PROMOTED TO STANDARD", `<p style="margin:0" class="small">${escHtml(TEMPLATE_VERSION)}</p>`)],
  contentHtml: content.join("\n"),
  pageTitle: "Global EIS — Master v1.3 Specimen",
});

const path = new URL("../download/GlobalEIS_Master_v1.3_Specimen.html", import.meta.url).pathname;
await Bun.write(path, html);

/* ---- hard checks ---- */
const markers: Array<[string, boolean]> = [
  ["SO-1 token #005677", html.includes("#005677")],
  ["SO-1 token #008DCB", html.includes("#008DCB")],
  ["SO-1 font Segoe UI", html.includes("Segoe UI")],
  ["SO-4 chain word: closed", html.includes("closed")],
  ["SO-4 chain word: residual", html.includes("residual")],
  ["Appendix A2 title", html.includes("Appendix A2 · SO-9 Balance Verification Double-Check")],
  ["SO-9 first-run column", html.includes("First run (SO-10 gate)")],
  ["SO-9 re-run column", html.includes("Independent re-run (SO-9)")],
  ["SO-9 MATCH pill", html.includes(">MATCH<")],
  ["SO-9 PENDING pill", html.includes(">PENDING<")],
  ["kpi-value alias in CSS", REPORT_CSS.includes(".kpi-value")],
  ["kpi-label alias in CSS", REPORT_CSS.includes(".kpi-label")],
  ["verdict-box in CSS", REPORT_CSS.includes(".verdict-box{")],
  ["badge family in CSS", REPORT_CSS.includes(".badge.pass,.pass{")],
  ["h2.sec in CSS", REPORT_CSS.includes("h2.sec{")],
  ["tr.hl in CSS", REPORT_CSS.includes("tr.hl td{")],
  ["row-active kept", REPORT_CSS.includes(".data-table tr.row-active td{")],
  ["value-first kept", REPORT_CSS.includes(".kpi-card.value-first{")],
  ["authenticity-alert kept", REPORT_CSS.includes(".authenticity-alert{")],
  ["box-sizing reset", REPORT_CSS.includes("*{box-sizing:border-box}")],
  ["print contract thead", REPORT_CSS.includes("thead{display:table-header-group}")],
  ["PDF button hidden by default", !html.includes('<button class="download-btn"')],
];
let fail = 0;
for (const [name, ok] of markers) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${TEMPLATE_VERSION}`);
console.log(fail === 0 ? `SPECIMEN OK — ${markers.length}/${markers.length} checks · ${path}` : `SPECIMEN FAIL — ${fail} check(s)`);
process.exit(fail === 0 ? 0 : 1);
