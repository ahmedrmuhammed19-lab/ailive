/**
 * DL-9c (2026-10-11): Master v1.2.5 specimen — SO-10 Verification Passport
 * appendix FIXED in the section contract. Owner clarified the S09/S10
 * guarantee targets the balance-chain gates (SO-9 pre-delivery gate, SO-10
 * passport G1–G9 with measured values, fail-loud).
 *
 * SO-9 proof: rendered THROUGH the real template module (report_design.ts) —
 * contract, passport, matrix, shell, CSS all verbatim; zero hand CSS.
 */
import * as fs from "node:fs";
import {
  reportShell, sectionTitle, alertBox, tag, verdictBadge, verdictWrap,
  STANDARD_SECTIONS, so10Passport, signoff, TEMPLATE_VERSION,
} from "../src/lib/report_design.ts";

const OUT = "/home/z/my-project/download/00_Specimen_Section_Contract_Master_v125.html";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const contractRows = STANDARD_SECTIONS.map(
  (s) =>
    `<tr><td><b>${esc(s.label ?? String(s.no))}</b></td><td>${esc(s.title)}${s.no === 10 ? ` ${tag("GUARANTEED", "pass")}` : ""}${s.no === 90 ? ` ${tag("GUARANTEED", "pass")}` : ""}</td>` +
    `<td class="text-center">${s.fixed ? tag("FIXED", "low") : tag("ANALYST JUDGEMENT", "warn")}</td></tr>`
).join("");

/* Appendix A live render — full measured passport (final-build shape). */
const passport = so10Passport(
  [
    { id: "G1", name: "Serial Census", pass: true, measured: "299 printed serials, each present exactly once — no gaps, no duplicates; parsed rows == printed rows (299)." },
    { id: "G2", name: "Strict Chain", pass: true, measured: "299/299 consecutive row pairs closed with residual EGP 0.00 exact; telescope 62,686.10 + 313,888.07 − 138,407.91 = 238,166.26 == printed closing." },
    { id: "G3", name: "Printed Totals", pass: true, adapted: true, measured: "Format prints no period totals row — substituted: printed closing reconciles exactly with Σ(opening + credits − debits); disclosed per SO-7." },
    { id: "G4", name: "Anchors", pass: true, measured: "4 printed anchors glyph-exact: header Opening 62,686.10, header Closing 238,166.26, From 01/02/2026 → To 08/09/2026." },
    { id: "G5", name: "Page Grid", pass: true, measured: "13/13 pages parsed; 299 date-led rows; rows per page 19–27; every band maps to a row or documented continuation; 0 orphan bands." },
    { id: "G6", name: "Monotonicity", pass: true, measured: "Dates non-increasing in print order: 0 violations; single currency EGP; every positive amount moves the balance in its printed column's direction; 3 printed negative rows = documented reversals, each chain-closed." },
    { id: "G7", name: "Two-Pass Extraction", pass: true, measured: "Pass A (positional engine) vs Pass B (layout engine): identical 299-row multisets on (date, amount, balance); 0 adjudication diffs." },
    { id: "G8", name: "Re-Derivation", pass: true, measured: "Every figure in the report regenerated from the verified row table by the tracked generator; headline sums asserted equal before rendering." },
    { id: "G9", name: "Adversarial Audit", pass: true, measured: "Bank fee law induced (IPN = max(ceil(0.1%×transfer), 0.50)): 77 fee rows, printed mass 86.84 == law mass 86.84 EXACT; 19 direct ref-pairs + aggregate identity; no unexplained residual." },
  ],
  "final build",
);

const draftPassport = so10Passport(
  [
    { id: "G2", name: "Strict Chain", pass: true, measured: "299/299 pairs (100%) — printed-anchor telescope pending analyst confirmation." },
    { id: "G3", name: "Printed Totals", pass: false, pending: true, measured: "Printed period debit/credit totals cross-check pending analyst measurement." },
    { id: "G9", name: "Adversarial Audit", pass: false, pending: true, measured: "Adversarial cross-evidence hunt pending analyst." },
  ].concat([]),
  "engine draft (excerpt)",
);

const html = reportShell({
  title: "Section Contract & Verification Passport — Specimen",
  subLines: [
    `<strong>Global EIS · Design System Specimen · Case DL-9c</strong>`,
    `<strong>Owner guarantee:</strong> balance-chain gates SO-9 / SO-10 fixed in every report`,
  ],
  refLine: TEMPLATE_VERSION,
  contentHtml:
    [
      sectionTitle("1 · Standard Section Order Contract — with appendices"),
      `<table class="data-table"><thead><tr><th>No.</th><th>Section</th><th class="text-center">Presence</th></tr></thead><tbody>${contractRows}</tbody></table>`,

      sectionTitle("2 · Appendix A live render — final build (all gates measured)"),
      passport,

      sectionTitle("3 · Appendix A in an engine draft (PENDING pills, fail-loud)"),
      draftPassport,

      alertBox("blue", "SO-9 tie-in",
        `<p>The pre-delivery gate (scripts/delivery_gate.py) blocks any announcement until the
        shipped report carries the complete, all-PASS passport — PENDING or FAIL gates quarantine
        the case instead of shipping. The passport cannot be omitted: every generator renders it
        through so10Passport(), exactly like the S10 matrix.</p>`),
    ].join("\n") + signoff(),
  pageTitle: "Global EIS — Master v1.2.5 Specimen (SO-10 Passport Appendix)",
  banners: [
    verdictWrap(
      alertBox("blue", "What changed in v1.2.5",
        `<p>Additive: Appendix A (SO-10 passport) now FIXED in the contract + canonical
        so10Passport() renderer; engine drafts list all nine gates honestly (measured vs PENDING).
        No CSS change, no removals.</p>`),
      verdictBadge("STANDARD", "Master v1.2.5 — DL-9c promoted 2026-10-11", true),
    ),
  ],
});

fs.writeFileSync(OUT, html, "utf-8");

const written = fs.readFileSync(OUT, "utf-8");
const checks = {
  no_download_button: !written.includes('<button class="download-btn"'),
  appendix_title: written.includes("Appendix A · SO-10 Verification Passport"),
  contract_rows_13: (written.match(/<td class="text-center">/g) ?? []).length === 13,
  measured_values: written.includes("residual EGP 0.00 exact"),
  pending_pills: written.includes(">PENDING<"),
  fail_loud_note: written.includes("Fail-loud doctrine"),
  version_line: written.includes("Master v1.2.5"),
  bytes: Buffer.byteLength(written),
};
console.log("DL9C_SPECIMEN_AUDIT", JSON.stringify(checks, null, 2));
if (!checks.no_download_button || !checks.appendix_title || !checks.contract_rows_13 || !checks.pending_pills) {
  console.error("FAIL: self-audit"); process.exit(1);
}
console.log("OK ->", OUT);
