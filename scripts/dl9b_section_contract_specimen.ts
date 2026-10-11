/**
 * DL-9b (2026-10-11): Master v1.2.4 specimen — STANDARD SECTION ORDER
 * CONTRACT. Owner ratified the mix (Elgarayadli + previous Master) and
 * ordered the Visa Readiness Matrix guaranteed at section 09/10; v1.2.4
 * encodes the 11-section canon (STANDARD_SECTIONS + stdTitle) and ships
 * visaReadinessSection() as the single guaranteed S10 renderer.
 *
 * SO-9 proof: rendered THROUGH the real template module — contract table,
 * matrix, shell and CSS all verbatim from src/lib/report_design.ts.
 */
import * as fs from "node:fs";
import {
  reportShell, sectionTitle, alertBox, tag, verdictBadge, verdictWrap,
  STANDARD_SECTIONS, stdTitle, visaReadinessSection, signoff, TEMPLATE_VERSION,
} from "../src/lib/report_design.ts";

const OUT = "/home/z/my-project/download/00_Specimen_Section_Contract_Master_v124.html";

/* Contract table straight from the exported constant — zero re-typing. */
const contractRows = STANDARD_SECTIONS.map(
  (s) =>
    `<tr><td><b>${s.no}</b></td><td>${escStd(s.title)}${s.no === 10 ? ` ${tag("GUARANTEED", "pass")}` : ""}</td>` +
    `<td class="text-center">${s.fixed ? tag("FIXED", "low") : tag("ANALYST JUDGEMENT", "warn")}</td></tr>`
).join("");
function escStd(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Guaranteed S10 demo — mixed pass/fail, joint active line, authenticity line. */
const s10 = visaReadinessSection(
  [
    { destination: "UK Visit Visa (per applicant)", required: "EGP 205,440.00", pass: true, coverage: "1,235.3% (12.35x)" },
    { destination: "Schengen Visit Visa (per applicant)", required: "EGP 154,080.00", pass: true, coverage: "1,647.0% (16.47x)" },
    { destination: "US Visit Visa (per applicant)", required: "EGP 256,800.00", pass: true, coverage: "988.2% (9.88x)" },
    {
      destination: "UK Visit Visa — JOINT, 2 travellers", required: "EGP 410,880.00",
      pass: true, coverage: "617.6% (6.18x)", active: true,
      subLines: ["2 × EGP 205,440.00 = EGP 410,880.00"],
    },
    { destination: "Document Authenticity Screening", required: "—", pass: true, coverage: "Genuine issue format; no specimen/test markers", result: "PASS" },
    { destination: "Schengen — shortfall example", required: "EGP 154,080.00", pass: false, coverage: "96.4% (0.96x)" },
  ],
  `<p><b>Result:</b> every generator renders S10 through visaReadinessSection() — the title,
  numbering and table contract cannot drift between the engine draft, analyst builds and the portal.</p>`,
);

const html = reportShell({
  title: "Standard Section Contract — Specimen",
  subLines: [
    `<strong>Global EIS · Design System Specimen · Case DL-9b</strong>`,
    `<strong>Ratified mix:</strong> previous Master canon + Elgarayadli structure — matrix guaranteed at S10`,
  ],
  refLine: TEMPLATE_VERSION,
  contentHtml:
    [
      sectionTitle("1 · The Standard Section Order Contract (v1.2.4)"),
      `<p>The template now carries the firm's canonical statement-report skeleton as an exported
      contract (<code>STANDARD_SECTIONS</code>). Every statement report — engine auto-draft or analyst
      final — follows this order; S10 is rendered exclusively through
      <code>visaReadinessSection()</code> so the readiness matrix can never be omitted or renumbered.</p>`,
      `<table class="data-table"><thead><tr><th>No.</th><th>Section</th><th class="text-center">Presence</th></tr></thead><tbody>${contractRows}</tbody></table>`,

      sectionTitle("2 · Guaranteed Section 10 — live render"),
      s10,

      alertBox("blue", "Engine drafts included",
        `<p>The automated engine now builds its S10 from live case data (destination benchmark,
        joint multiplication, automated chain screening) the moment a statement is parsed — the
        analyst finalises per-destination lines before delivery. S09 (advisory flags) and S11
        (action gates) follow in the same canon.</p>`),
    ].join("\n") + signoff(),
  pageTitle: "Global EIS — Master v1.2.4 Specimen (Standard Section Contract)",
  banners: [
    verdictWrap(
      alertBox("blue", "What changed in v1.2.4",
        `<p>Additive only: the section-order contract + guaranteed S10 renderer. No CSS change,
        no removal — every delivered report remains valid.</p>`),
      verdictBadge("STANDARD", "Master v1.2.4 — DL-9b promoted 2026-10-11", true),
    ),
  ],
});

fs.writeFileSync(OUT, html, "utf-8");

/* ---- self-audit ---- */
const written = fs.readFileSync(OUT, "utf-8");
const checks = {
  no_download_button: !written.includes('<button class="download-btn"'),
  s10_guaranteed_title: written.includes("10 · Visa Readiness Matrix"),
  contract_rows_11: (written.match(/<td class="text-center">/g) ?? []).length === 11,
  guaranteed_pill: written.includes("GUARANTEED"),
  active_benchmark: written.includes("ACTIVE BENCHMARK"),
  version_line: written.includes("Master v1.2.4"),
  bytes: Buffer.byteLength(written),
};
console.log("DL9B_SPECIMEN_AUDIT", JSON.stringify(checks, null, 2));
if (!checks.no_download_button || !checks.s10_guaranteed_title || !checks.contract_rows_11) {
  console.error("FAIL: self-audit"); process.exit(1);
}
console.log("OK ->", OUT);
