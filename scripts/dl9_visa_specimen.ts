/**
 * DL-9 (2026-10-11): Master v1.2.3 specimen — quantitative Visa Readiness
 * Matrix + action gates + hidden PDF button, promoted from the Elgarayadli
 * one-off build into standard template vocabulary.
 *
 * SO-9 proof: this page is rendered THROUGH the real template module
 * (src/lib/report_design.ts) — helpers, CSS and shell all come verbatim from
 * the source of truth; no hand CSS anywhere. The absence of the
 * "Download PDF Report" button on this very page is itself the proof of the
 * new default (reportShell without downloadButton:true).
 */
import * as fs from "node:fs";
import {
  reportShell, sectionTitle, kpiGrid, kpiCard, alertBox, tag, analysisGrid,
  verdictBadge, verdictWrap, visaReadinessMatrix, actionGate, signoff,
  TEMPLATE_VERSION,
} from "../src/lib/report_design.ts";

const OUT = "/home/z/my-project/download/00_Specimen_VisaReadiness_Master_v123.html";

/* ---- 1. Readiness matrix — Elgarayadli real figures as the reference case ---- */
const matrixJoint = visaReadinessMatrix([
  { destination: "UK Visit Visa (per applicant)", required: "EGP 205,440.00", pass: true, coverage: "1,235.3% (12.35x)" },
  { destination: "Schengen Visit Visa (per applicant)", required: "EGP 154,080.00", pass: true, coverage: "1,647.0% (16.47x)" },
  { destination: "US Visit Visa (per applicant)", required: "EGP 256,800.00", pass: true, coverage: "988.2% (9.88x)" },
  {
    destination: "UK Visit Visa — JOINT, 2 travellers", required: "EGP 410,880.00",
    pass: true, coverage: "617.6% (6.18x)", active: true,
    subLines: ["2 × EGP 205,440.00 = EGP 410,880.00"],
  },
  {
    destination: "Document Authenticity Screening", required: "—", pass: true,
    coverage: "Genuine CIB issue format; no specimen/test markers",
    result: "PASS",
  },
]);

/* ---- 2. Readiness matrix — failing variant (semantic danger color demo) ---- */
const matrixFail = visaReadinessMatrix([
  { destination: "UK Visit Visa (per applicant)", required: "EGP 205,440.00", pass: true, coverage: "118.4% (1.18x)" },
  { destination: "Schengen Visit Visa (per applicant)", required: "EGP 154,080.00", pass: false, coverage: "96.4% (0.96x)" },
  { destination: "Document Authenticity Screening", required: "—", pass: false, coverage: "Specimen/test watermark detected on p.1", result: "FAIL" },
]);

const gates = analysisGrid([
  actionGate(1, "Funding source", "Identify the third-party customer behind internal injections: copy of their statement first page + relationship proof + short sponsor letter."),
  actionGate(2, "SWIFT wire", "Obtain the bank-issued credit advice naming the remitter and purpose for the large inward wire."),
  actionGate(3, "Large purchase", "Contract/receipt for the major outflow, plus registration if the asset is to be declared."),
  actionGate(4, "Obligations schedule", "Loan statement for the facility and payee references for the recurring cheque pair."),
  actionGate(5, "Name consistency", "Confirm passport romanisation of the holder's name and align it across the visa file and cover letter."),
  actionGate(6, "Co-traveller file", "Second traveller's passport details, marriage certificate as relationship evidence, and an itinerary naming both travellers."),
]);

const content = [
  sectionTitle("1 · What v1.2.3 promotes into the standard"),
  `<p>The Elgarayadli case build carried the firm's strongest one-off section — a <b>quantitative visa readiness
  matrix</b>: per-destination maintenance benchmarks with coverage multiples, a highlighted joint/active-benchmark
  line, and a document-authenticity screening line. Master v1.2.3 turns it into reusable template vocabulary
  (<code>visaReadinessMatrix()</code>, <code>actionGate()</code>), so every future report can mix it in with zero
  hand CSS. Owner order of the same day: the on-screen <b>Download PDF Report button is hidden by default</b> —
  note its absence in this page's header; printing to PDF is unaffected (the button never printed anyway).</p>`,

  sectionTitle("2 · Visa Readiness Matrix — passing joint case (Elgarayadli figures)"),
  matrixJoint,
  alertBox("green", "How to read the matrix",
    `<p>The <b>light-blue row</b> is the case's active benchmark (here: the joint two-traveller UK line).
    Coverage = closing balance ÷ required funds. Every line the matrix carries must show its measured
    required value and multiple; the authenticity line is informational and always shows its screening basis.</p>`),

  sectionTitle("3 · Readiness Matrix — failing variant (semantic colors demo)"),
  matrixFail,
  `<p class="small">Failures render in the template's danger red via the same helper — no generator-side styling.
  A FAIL line pairs with the verdict badge and the advisory/gate sections, never with a silent pass-through.</p>`,

  sectionTitle("4 · Required Client Actions — numbered gate cards"),
  `<p>The conclusion section now ships as numbered <b>action gates</b> (analysis cards in the standard grid):
  each gate names one document the client must obtain before submission. Six-gate reference set shown.</p>`,
  gates,

  sectionTitle("5 · Adoption ledger (DL-9)"),
  `<table class="data-table"><thead><tr><th>Challenger feature</th><th>Decision</th><th>Where it lives now</th></tr></thead><tbody>
  <tr><td>Quantitative readiness matrix (UK/Schengen/US, joint line, authenticity line)</td><td>${tag("ADOPTED", "pass")}</td><td><code>visaReadinessMatrix()</code> + <code>.row-active</code> CSS, Master v1.2.3</td></tr>
  <tr><td>Numbered client action gates as card grid</td><td>${tag("ADOPTED", "pass")}</td><td><code>actionGate()</code>, Master v1.2.3</td></tr>
  <tr><td>On-screen Download PDF Report button</td><td>${tag("HIDDEN", "warn")}</td><td><code>reportShell</code> default flipped (opt-in via <code>downloadButton:true</code>)</td></tr>
  <tr><td>Phantom <code>.section</code> classes / ALL-CAPS signoff / dead CSS spend</td><td>${tag("REJECTED", "fail")}</td><td>Adjudicated DL-6/DL-7 — ledger stands</td></tr>
  </tbody></table>`,
].join("\n");

const htmlFixed = reportShell({
  title: "Visa Readiness Matrix — Specimen",
  subLines: [
    `<strong>Global EIS · Design System Specimen · Case DL-9</strong>`,
    `<strong>Reference case:</strong> Elgarayadli EGP (CIB 100007554812) — joint UK tourism application, 2 travellers`,
  ],
  refLine: `${TEMPLATE_VERSION}`,
  contentHtml: content + signoff(),
  pageTitle: `Global EIS — Master v1.2.3 Specimen (Visa Readiness Matrix)`,
  banners: [
    verdictWrap(
      alertBox("blue", "Upgrade contract",
        `<p>Additive vocabulary only: one CSS class (<code>.data-table tr.row-active</code>), two helpers,
         one default flipped (button hidden). All previously delivered reports remain valid and unchanged.</p>`),
      verdictBadge("STANDARD", "Master v1.2.3 — DL-9 promoted 2026-10-11", true),
    ),
  ],
});

fs.writeFileSync(OUT, htmlFixed, "utf-8");

/* ---- self-audit before receipt ---- */
const written = fs.readFileSync(OUT, "utf-8");
const checks = {
  no_download_button: !written.includes('<button class="download-btn"'),
  row_active_css: written.includes(".data-table tr.row-active td{background:#e0f2fe}"),
  active_benchmark_pill: written.includes("ACTIVE BENCHMARK"),
  version_line: written.includes("Master v1.2.3"),
  gates_count: (written.match(/Gate \d+ —/g) ?? []).length,
  matrix_rows: (written.match(/<tr[^>]*><td><b>/g) ?? []).length,
  bytes: Buffer.byteLength(written),
};
console.log("DL9_SPECIMEN_AUDIT", JSON.stringify(checks, null, 2));
if (!checks.no_download_button || !checks.row_active_css || !checks.active_benchmark_pill) {
  console.error("FAIL: specimen self-audit did not pass"); process.exit(1);
}
console.log("OK ->", OUT);
