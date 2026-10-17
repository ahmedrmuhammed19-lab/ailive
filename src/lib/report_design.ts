/**
 * THE FIRM'S CANONICAL REPORT DESIGN — STANDARD BUILD: MASTER v1.2.
 *
 * Owner order 2026-10-06 ("i guess 1.2master will be standard"): the Master
 * Template v1.2 design (templates/retired/global_eis_master_v1.2.html) is
 * PROMOTED to the firm's single standard. One design system for every HTML
 * report the firm produces — engine auto-reports, analyst drafts, notices,
 * ops pages, template specimens — so a report looks identical whether the
 * client receives it here, by mail or from the portal (zero drift, SO-1).
 *
 * Lineage: client-supplied base (2026-10-03) → master v1.0 → v1.1 → v1.2
 * (STANDARD, promoted 2026-10-06). The v1.2 build adds the master template's
 * full section vocabulary on top of the shared tokens: verdict badge +
 * verdict block, document-authenticity alert, linked-account annex banner,
 * authorized sign-off block, zebra data tables, A4 @page print contract,
 * richer legal footer. All earlier exports keep their names and signatures —
 * every existing generator compiles unchanged.
 *
 * v1.2.1 (2026-10-11, DL-6): legal disclaimer hardened with two clauses
 * learned from a challenger variant of the Elgarayadli EGP report —
 * (1) scope limitation: statements analysed as delivered, authenticity
 * findings reflect documentary consistency only; (2) anti-reuse: one
 * statement = one report, never recycled. Additive text change only;
 * all class vocabulary and layout untouched.
 *
 * v1.2.2 (2026-10-11, DL-7): value-first KPI option adopted from the same
 * challenger — .kpi-card.value-first renders the big value above the label
 * via flex ordering while keeping success/danger/warning accents intact.
 * Opt-in per card; default cards and every existing report render unchanged.
 *
 * v1.2.3 (2026-10-11, DL-9): the Elgarayadli one-off build's strongest
 * section — its quantitative visa readiness matrix (UK / Schengen / US
 * per-applicant lines, joint-traveller line with active-benchmark highlight,
 * authenticity-screening line, coverage multiples) — is promoted into
 * standard template vocabulary as visaReadinessMatrix() + actionGate()
 * (numbered client action gates). Owner order same day: the on-screen
 * "Download PDF Report" button is HIDDEN by default from v1.2.3 on;
 * pass downloadButton:true to reportShell to restore it. Print/PDF output
 * is unaffected (the button never printed). One additive CSS class
 * (.data-table tr.row-active) carries the benchmark-row highlight.
 *
 * v1.2.4 (2026-10-11, DL-9b): owner ratified the v1.2.3 direction — "it's a
 * mix between the Abdulrahman report and the previous template; make sure
 * section 09/10 contains" the matrix. The STANDARD SECTION ORDER CONTRACT is
 * now encoded in the template: STANDARD_SECTIONS fixes the 11-section canon
 * (S09 Risk & Compliance Advisory Flags, S10 Visa Readiness Matrix, S11
 * Conclusion & Required Client Actions), stdTitle(n) emits the canonical
 * numbered title, and visaReadinessSection() renders the guaranteed S10 in
 * one call. The engine auto-draft (src/lib/analyze.ts) now builds its S10
 * from the case's live benchmark data — every report, draft or delivered,
 * carries the matrix section.
 *
 * v1.2.5 (2026-10-11, DL-9c): owner clarified the guarantee targets the
 * BALANCE-CHAIN GATES — SO-9 (pre-delivery gate) / SO-10 (Verification
 * Passport G1–G9, measured values, fail-loud). The passport appendix is now
 * FIXED in the section contract (Appendix A) and rendered canonically via
 * so10Passport() — gate rows carry measured values, PASS/FAIL/PENDING
 * pills, and the fail-loud doctrine line. The engine draft lists all nine
 * gates: automated gates show engine-measured values, analyst gates show
 * PENDING until the final build (delivery itself stays blocked behind SO-9).
 *
 * v1.2.6 (2026-10-11, DL-9d): three-way template coverage audit (owner:
 * "checking previous template, abdulrahman template and current template —
 * have all sections of the two been covered in the new template").
 * Abdulrahman/Elgarayadli canon: covered 11/11 (S10 generalized, case
 * specifics live in matrix rows). Pre-v1.2 Master canon (Gehad-era): 7/11
 * direct, and FOUR sections had no contract home — Fee Structure
 * Verification, Balance & Liquidity Profile, Document Integrity / OCR
 * Methodology & Disclosures, and the Complete Chain-Verified Ledger annex.
 * All four are RECOVERED additively as S12/S13/S14 + Annex C
 * (analyst-judgement), appended AFTER S11 so every published report keeps
 * its ratified numbering (no renumber; S09/S10 and appendices A/B
 * untouched). Appendix A's fixed passport + the shell's hardened disclaimer
 * remain the fixed disclosure baseline; the recovered entries guarantee the
 * VOCABULARY and canonical numbering, deployed when the case warrants.
 *
 * v1.3.0 (2026-10-15, ES-1): owner order — the Elgarayadli one-off build
 * (GlobalEIS_Report_AbdelrahmanElgarayadli_EGP.html, self-labelled "Global EIS
 * Design v1.3 (CIB Blue)") is PROMOTED to the firm's standard. REPORT_CSS now
 * carries the full Elgarayadli vocabulary additively: box-sizing reset + body
 * line-height 1.55, compact header (h1 2.2em, white strong sub-lines), 1.45em
 * section titles, generator heading h2.sec + base h3, bare table/th/td styles
 * + tr.hl highlight row, flex .kpi-grid with bordered compact cards and the
 * .kpi / .kpi-value / .kpi-label aliases (healing the one-off's unstyled KPI
 * divs), .tag.credit/.debit, .badge pass/caution/fail/info family,
 * .note/.warn/.danger note boxes, .verdict-box narrative verdict, footer
 * strong accent, broadened print contract. Every v1.2.6 class and export
 * keeps its name and signature — all existing generators compile unchanged;
 * earlier delivered reports keep their bytes.
 *
 * Same owner order: SO-9 joins the RENDERED canon as Appendix A2 — the SO-9
 * Balance Verification Double-Check (so9DoubleCheck() + DoubleCheckRow): the
 * balance chain is verified TWICE — the SO-10 G-gate pass and an independent
 * re-run — both with measured values side by side; any non-zero residual =
 * MISMATCH = delivery blocked (fail-loud). Fixed appendix; the engine draft
 * renders live engine-measured arithmetic (G8 precedent) with analyst rows
 * PENDING until the final build, mirroring the Appendix A passport contract.
 *
 * v1.4.0 (2026-10-18, DL-23): owner order ("add a grand for each row like
 * this debit, credit and add a total of annual income and monthly expense")
 * ratified the Bola Ayad Gerges Rev 3 additions into the standard — the
 * builder was cross-validated 32/32 against the independently audited v3
 * figures before promotion. monthlyTrajectoryTable() renders per-account
 * Debit/Credit/Net column groups PLUS a computed GRAND — All Accounts group
 * and a bold WINDOW TOTAL footer row (every figure re-derived from the raw
 * numbers inside the builder — G8: no hand-typed sums; single-account
 * reports collapse the redundant per-account group into one D/C/N table).
 * incomeExpenseSummaryBlock() renders the window-prorated Income & Expense
 * Summary (window income gross + verified external, annual income run-rates,
 * monthly expense window average + full calendar month) with the canonical
 * proration math: annualRunRate() = ×365÷days, monthlyRunRate() =
 * ÷days×30.44. Engine drafts that cannot classify third-party credits
 * render the external lines as "—" with the pending disclosure — never a
 * silent assumption. CSS adds th.grand-col / td.grand-cell / tr.total-row
 * additively. The engine draft (src/lib/analyze.ts) now renders the
 * guaranteed S4 through monthlyTrajectorySection() for every submission.
 * All v1.3.0 exports keep names and signatures — earlier reports keep
 * their bytes.
 *
 * Tokens: --primary #005677 / --secondary #008DCB on Segoe UI, gradient
 * header, KPI cards with colored left borders, section bars, pill tags,
 * left-bordered alert boxes, readiness matrix + action gates, prepared-by
 * footer.
 */

export const TEMPLATE_VERSION = "Master v1.4.0 (STANDARD — GRAND debit/credit totals + window-prorated income & expense summary promoted from the audited Bola Ayad Gerges Rev 3 build, owner-approved 2026-10-18; lineage: v1.3.0 Elgarayadli build promoted 2026-10-15; SO-9 balance double-check appendix A2 added 2026-10-15; v1.2.6 three-way coverage audit 2026-10-11, SO-10 passport appendix 2026-10-11, section order contract 2026-10-11, visa readiness matrix + action gates 2026-10-11, disclaimer hardened 2026-10-11; v1.2 promoted 2026-10-06)";

export const REPORT_CSS = `
/* ===== Master v1.3 tokens (SO-1 locked) ===== */
:root{--primary:#005677;--secondary:#008DCB;--success:#28a745;--danger:#dc3545;--warning:#ffc107;--light:#f8f9fa;--dark:#343a40;--white:#ffffff}
*{box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#eef2f5;color:var(--dark);margin:0;padding:20px;line-height:1.55}
.container{max-width:1200px;margin:0 auto;background:var(--white);border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;position:relative}
.header{background:linear-gradient(135deg,var(--primary),var(--secondary));color:var(--white);padding:40px 30px;text-align:center;position:relative}
.header h1{margin:0;font-size:2.2em;text-transform:uppercase;letter-spacing:1px}
.header p{margin:5px 0 0;opacity:0.92;font-size:1.02em}
.header p b,.header p strong{color:var(--white)}
.header .ref-line{margin-top:12px;font-size:0.85em;opacity:0.85}
.download-btn{position:absolute;top:30px;right:30px;background:var(--white);color:var(--primary);border:none;padding:10px 20px;font-size:14px;font-weight:bold;border-radius:5px;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,0.2);transition:0.2s}
.download-btn:hover{background:#f0f0f0;transform:translateY(-2px)}
.content{padding:40px}
.verdict-block{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:20px}
.verdict-badge{border-radius:10px;padding:14px 20px;text-align:center;min-width:220px;font-weight:bold}
.verdict-badge.pass{background:#e6f4ea;border:1px solid var(--success);color:#1e7e34}
.verdict-badge.fail{background:#fdecea;border:1px solid var(--danger);color:#a71d2a}
.verdict-badge .big{font-size:1.05em;display:block}
.verdict-badge .small{font-size:0.75em;font-weight:normal;display:block;margin-top:4px}
.authenticity-alert{background:#7a1220;color:var(--white);border-radius:10px;padding:22px 26px;margin-bottom:30px}
.authenticity-alert h3{margin:0 0 12px;font-size:1.2em}
.authenticity-alert .watermark-box{background:rgba(255,255,255,0.12);border:1px dashed rgba(255,255,255,0.5);padding:10px 14px;border-radius:6px;font-family:'Courier New',monospace;font-size:0.85em;margin:12px 0}
.authenticity-alert p{margin:8px 0;line-height:1.5;font-size:0.95em}
/* ===== Section titles (canonical + generator h2.sec) ===== */
.section-title{font-size:1.45em;color:var(--primary);border-bottom:2px solid #eee;padding-bottom:10px;margin:44px 0 20px;font-weight:700;display:flex;align-items:center}
.section-title::before{content:'';display:inline-block;width:8px;height:22px;background:var(--secondary);margin-right:12px;border-radius:2px}
h2.sec{font-size:1.3em;color:var(--primary);background:none;border-bottom:2px solid #eee;padding:0 0 10px;margin:40px 0 16px;font-weight:700;display:flex;align-items:center}
h2.sec::before{content:'';display:inline-block;width:8px;height:20px;background:var(--secondary);margin-right:12px;border-radius:2px}
h3{color:var(--primary);font-size:1.05em;margin:18px 0 8px}
/* ===== Tables (canonical .data-table + bare generator tables) ===== */
table{width:100%;border-collapse:collapse;font-size:0.92em;margin:12px 0 22px}
th{background:var(--light);color:var(--primary);text-align:left;padding:10px 12px;font-weight:600;border-bottom:2px solid #ddd}
td{padding:9px 12px;border-bottom:1px solid #eee;vertical-align:top}
tr:nth-child(even) td{background:#fafbfc}
.data-table{margin-bottom:30px}
.data-table th{padding:12px}
.data-table td{padding:11px 12px}
.data-table tr.row-active td{background:#e0f2fe}
tr.hl td{background:#e7f3fe !important}
.text-right{text-align:right}.text-center{text-align:center}
.text-success{color:var(--success);font-weight:bold}.text-danger{color:var(--danger);font-weight:bold}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
/* ===== KPI cards (canonical .kpi-card + compact .kpi / .kpi-value / .kpi-label) ===== */
.kpi-grid{display:flex;gap:14px;flex-wrap:wrap;margin:16px 0 26px}
.kpi-card,.kpi{background:var(--white);border-radius:10px;padding:16px 18px;box-shadow:0 2px 10px rgba(0,0,0,0.05);border:1px solid #e1e4e8;border-left:5px solid var(--secondary);flex:1;min-width:190px;transition:transform 0.2s}
.kpi-card:hover,.kpi:hover{transform:translateY(-3px)}
.kpi-card h3,.kpi .l,.kpi-label{margin:0 0 8px;color:#666;font-size:0.92em;text-transform:uppercase;letter-spacing:0.4px;font-weight:600}
.kpi-card .value,.kpi .v,.kpi-value{font-size:1.5em;font-weight:bold;color:var(--primary)}
.kpi-card .note{font-size:0.85em;color:#777;margin-top:6px}
.kpi-card.success{border-left-color:var(--success)}.kpi-card.success .value,.kpi-card.success .kpi-value{color:var(--success)}
.kpi-card.danger{border-left-color:var(--danger)}.kpi-card.danger .value,.kpi-card.danger .kpi-value{color:var(--danger)}
.kpi-card.warning{border-left-color:var(--warning)}.kpi-card.warning .value,.kpi-card.warning .kpi-value{color:#b8860b}
.kpi-card.value-first{display:flex;flex-direction:column}
.kpi-card.value-first .value{order:1}
.kpi-card.value-first h3{order:2;margin:6px 0 0}
.kpi-card.value-first .note{order:3}
/* ===== Tags / badges ===== */
.tag{background:#e9ecef;padding:3px 10px;border-radius:12px;font-size:0.85em;color:#495057;margin-right:5px;display:inline-block;margin-bottom:5px}
.tag.in,.tag.credit{background:#e6f4ea;color:var(--success)}
.tag.out,.tag.debit{background:#fce8e6;color:var(--danger)}
.tag.pass{background:#e6f4ea;color:var(--success);font-weight:bold}
.tag.fail{background:#fee2e2;color:var(--danger);font-weight:bold}
.tag.warn{background:#fff3cd;color:#856404;font-weight:bold}
.tag.low{background:#e0f7fa;color:var(--primary);font-weight:bold}
.badge{display:inline-block;padding:3px 12px;border-radius:14px;font-weight:700;font-size:0.85em}
.badge.pass,.pass{background:#e6f4ea;color:#1e7e34}
.badge.caution,.caution{background:#fff3cd;color:#856404}
.badge.fail,.fail{background:#fdecea;color:#a71d2a}
.badge.info,.info{background:#e7f3fe;color:var(--primary)}
/* ===== Alert / note boxes ===== */
.alert-box{padding:18px 20px;border-radius:8px;margin:15px 0;border-left:5px solid}
.alert-box.blue{background:#e7f3fe;border-color:var(--secondary)}
.alert-box.red{background:#fff3cd;border-color:var(--warning)}
.alert-box.green{background:#e6f4ea;border-color:var(--success)}
.alert-box.danger{background:#fef2f2;border-color:var(--danger)}
.alert-box h4{margin:0 0 10px;color:var(--dark)}
.alert-box ul{margin:10px 0 0 20px;padding:0}
.alert-box li{margin-bottom:8px}
.note{background:#e7f3fe;border-left:4px solid var(--secondary);padding:12px 16px;font-size:0.95em;margin:12px 0;border-radius:0 7px 7px 0}
.note.warn,.warn{background:#fffbeb;border-left:4px solid #d97706}
.note.danger,.danger{background:#fef2f2;border-left:4px solid var(--danger)}
/* ===== Verdict box (generator narrative verdict) ===== */
.verdict-box{border:2.5px solid var(--primary);border-radius:11px;padding:18px 22px;background:#e7f3fe;margin:16px 0}
/* ===== Analysis cards ===== */
.analysis-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-bottom:40px}
@media (max-width:768px){.analysis-grid{grid-template-columns:1fr}.download-btn{position:static;margin-top:20px;display:inline-block}}
.analysis-card{background:var(--white);border:1px solid #e1e4e8;border-radius:10px;padding:20px;box-shadow:0 2px 5px rgba(0,0,0,0.03)}
.analysis-card.full-width{grid-column:span 2}
.analysis-card h3{margin-top:0;color:var(--primary);display:flex;align-items:center;font-size:1.2em}
.analysis-card h3::before{content:'';display:inline-block;width:10px;height:10px;background:var(--secondary);border-radius:50%;margin-right:10px}
/* ===== Linked/related-account annex ===== */
.annex-banner{background:var(--primary);color:var(--white);padding:10px 20px;border-radius:8px 8px 0 0;font-weight:bold;font-size:0.9em;letter-spacing:0.5px}
.annex-body{border:1px solid #e1e4e8;border-top:none;border-radius:0 0 8px 8px;padding:20px;margin-bottom:30px}
/* ===== Sign-off ===== */
.signoff{display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px;padding-top:20px;border-top:1px dashed #ccc;flex-wrap:wrap;gap:20px}
.signoff .sig-line{border-top:1px solid var(--dark);padding-top:6px;font-size:0.85em;min-width:220px}
.small{font-size:0.85em;color:#777;line-height:1.6}
.footer{text-align:center;padding:20px;color:#777;font-size:0.85em;background:#f8f9fa;border-top:1px solid #eee}
.footer p{margin:4px 0}
.footer .legal{max-width:900px;margin:6px auto 0;line-height:1.5}
.footer strong{color:var(--primary)}
/* ===== Master v1.4: GRAND column group + window-total row (DL-23) ===== */
th.grand-col{background:#e8f1f8}
td.grand-cell{background:#f7fbfd}
tr.total-row td{background:#eef6fa !important;font-weight:bold;border-top:2px solid var(--primary)}
/* ===== Print contract ===== */
@page{size:A4;margin:16mm 12mm}
@media print{body{background:none;padding:0}.container{box-shadow:none;border-radius:0;max-width:none}.download-btn{display:none}.section-title,h2.sec,.analysis-card,.kpi-card,.kpi,.annex-body,.verdict-box,.authenticity-alert{page-break-inside:avoid}table tr,.data-table tr{page-break-inside:avoid}thead{display:table-header-group}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Pill tag — tone: "" | "in" | "out" | "pass" | "fail" | "warn" | "low". */
export function tag(text: string, tone = ""): string {
  return `<span class="tag ${tone}">${escHtml(text)}</span>`;
}

/** KPI card — tone: "" | "success" | "warning" | "danger" (colored left border). */
export function kpiCard(label: string, value: string, note = "", tone = ""): string {
  return (
    `<div class="kpi-card ${tone}"><h3>${escHtml(label)}</h3>` +
    `<div class="value">${value}</div>` +
    (note ? `<div class="note">${note}</div>` : "") +
    `</div>`
  );
}

export function kpiGrid(cards: string[]): string {
  return `<div class="kpi-grid">${cards.join("")}</div>`;
}

export function sectionTitle(text: string): string {
  return `<h2 class="section-title">${text}</h2>`;
}

/** tone: "blue" | "red" (yellow caution) | "green" | "danger" (red). */
export function alertBox(tone: "blue" | "red" | "green" | "danger", title: string, bodyHtml: string): string {
  return `<div class="alert-box ${tone}"><h4>${escHtml(title)}</h4>${bodyHtml}</div>`;
}

export function analysisCard(title: string, bodyHtml: string, full = false): string {
  return `<div class="analysis-card${full ? " full-width" : ""}"><h3>${escHtml(title)}</h3>${bodyHtml}</div>`;
}

export function analysisGrid(cards: string[]): string {
  return `<div class="analysis-grid">${cards.join("")}</div>`;
}

/* ---------------- Master v1.2 vocabulary (promoted 2026-10-06) ---------------- */

/** Verdict stamp for the executive dashboard. pass=true → green, else red. */
export function verdictBadge(verdict: string, reason: string, pass = true): string {
  return `<div class="verdict-badge ${pass ? "pass" : "fail"}"><span class="big">VERDICT: ${escHtml(verdict)}</span><span class="small">${escHtml(reason)}</span></div>`;
}

/** Flex wrapper pairing an overview alert with a verdict badge. */
export function verdictWrap(overviewHtml: string, badgeHtml: string): string {
  return `<div class="verdict-block">${overviewHtml}${badgeHtml}</div>`;
}

/** Dark-red authenticity banner — render ONLY when the source document is flagged. */
export function authenticityAlert(watermark: string, explanationHtml: string, mode = "technical validation exercise"): string {
  return `<div class="authenticity-alert"><h3>⛔ DOCUMENT AUTHENTICITY ALERT — READ FIRST</h3><p>The source file carries the following marking:</p><div class="watermark-box">${escHtml(watermark)}</div>${explanationHtml}<p>The analysis below is issued as a <strong>${escHtml(mode)}</strong> accordingly.</p></div>`;
}

/** Linked/related-account annex: primary banner + bordered body. */
export function annexBlock(label: string, bodyHtml: string): string {
  return `<div class="annex-banner">${escHtml(label)}</div><div class="annex-body">${bodyHtml}</div>`;
}

/** Authorized sign-off block above the footer. */
export function signoff(left = "Authorized Signature — Global EIS", right = `Date Issued: ${new Date().toISOString().slice(0, 10)}`): string {
  return `<div class="signoff"><div class="sig-line">${escHtml(left)}</div><div class="sig-line">${escHtml(right)}</div></div>`;
}

/* ---------------- Master v1.2.3 vocabulary (DL-9, 2026-10-11) ---------------- */

/** One assessment line of the visa readiness matrix. */
export interface ReadinessRow {
  /** e.g. "UK Visit Visa (per applicant)" or "UK Visit Visa — JOINT, 2 travellers". */
  destination: string;
  /** Required funds, e.g. "EGP 205,440.00"; informational lines use "—". */
  required: string;
  /** true/false → PASS/FAIL with semantic color; informational lines pass true. */
  pass: boolean;
  /** e.g. "1,235.3% (12.35x)" or free text for informational lines. */
  coverage: string;
  /** Override the PASS/FAIL word (e.g. "PASS"). */
  result?: string;
  /** Highlights the line as the case's ACTIVE BENCHMARK (light-blue row + pill). */
  active?: boolean;
  /** Small print under the destination, e.g. "2 × EGP 205,440.00 = EGP 410,880.00". */
  subLines?: string[];
}

/**
 * Quantitative visa readiness matrix (Master v1.2.3) — the Elgarayadli
 * strength: per-destination maintenance benchmarks with coverage multiples,
 * a highlighted joint/active-benchmark line, and document-authenticity
 * screening. Renders entirely from template classes.
 */
export function visaReadinessMatrix(rows: ReadinessRow[]): string {
  const body = rows
    .map((r) => {
      const word = r.result ?? (r.pass ? "PASS" : "FAIL");
      const cls = r.pass ? "text-success" : "text-danger";
      const badge = r.active ? ` ${tag("ACTIVE BENCHMARK", "low")}` : "";
      const sub = (r.subLines ?? []).map((s) => `<br><span class="small">${s}</span>`).join("");
      return (
        `<tr${r.active ? ' class="row-active"' : ""}><td><b>${escHtml(r.destination)}</b>${badge}${sub}</td>` +
        `<td class="num">${r.required}</td>` +
        `<td class="num ${cls}"><b>${escHtml(word)}</b></td>` +
        `<td class="num">${r.coverage}</td></tr>`
      );
    })
    .join("");
  return `<table class="data-table"><thead><tr><th>Assessment Line</th><th>Required (EGP-equivalent)</th><th>Result</th><th>Coverage</th></tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Numbered client action gate card (Master v1.2.3) — place inside
 * analysisGrid() for the "Required Client Actions" checklist.
 */
export function actionGate(n: number, title: string, bodyHtml: string): string {
  return `<div class="analysis-card"><b>Gate ${n} — ${escHtml(title)}.</b> ${bodyHtml}</div>`;
}

/* ---------------- Master v1.2.4: STANDARD SECTION ORDER CONTRACT (DL-9b) ---------------- */

export interface StandardSection {
  no: number;
  title: string;
  /** true = present in EVERY statement report; false = analyst judgement. */
  fixed: boolean;
  /** Canonical label override, e.g. "Appendix A" (rendered instead of the number). */
  label?: string;
}

/**
 * The firm's canonical statement-report skeleton — the ratified mix of the
 * pre-v1.2 Master canon and the Elgarayadli build (DL-9d three-way coverage
 * audit: both parent canons fully covered). S10 carries the Visa Readiness
 * Matrix (owner: "make sure s09 or 10 contains"), S11 the action gates.
 * S12–S14 + Annex C are the pre-v1.2 Master sections recovered additively
 * (no renumbering — published reports keep their ratified numbering);
 * analyst-judgement: deployed when the case warrants (fee-bearing
 * statements, liquidity narratives, scanned/OCR sources, full-ledger
 * annexes). Numbered via stdTitle(); matrix section via
 * visaReadinessSection(); passport via so10Passport().
 */
export const STANDARD_SECTIONS: StandardSection[] = [
  { no: 1, title: "Executive Dashboard", fixed: true },
  { no: 2, title: "Account & Holder Identification", fixed: true },
  { no: 3, title: "Mathematical Reconciliation & Chain Audit", fixed: true },
  { no: 4, title: "Monthly Financial Trajectory & Gap Analysis", fixed: true },
  { no: 5, title: "Significant Financial Events", fixed: true },
  { no: 6, title: "Source of Funds Analysis", fixed: true },
  { no: 7, title: "Funds Utilization Analysis", fixed: true },
  { no: 8, title: "Associated Parties Register", fixed: false },
  { no: 9, title: "Risk & Compliance Advisory Flags", fixed: true },
  { no: 10, title: "Visa Readiness Matrix", fixed: true },
  { no: 11, title: "Conclusion & Required Client Actions", fixed: true },
  /* --- recovered pre-v1.2 Master canon (DL-9d coverage audit, additive) --- */
  { no: 12, title: "Fee Structure Verification", fixed: false },
  { no: 13, title: "Balance & Liquidity Profile", fixed: false },
  { no: 14, title: "Document Integrity, OCR Methodology & Disclosures", fixed: false },
  { no: 90, label: "Appendix A", title: "SO-10 Verification Passport (G1–G9, measured values)", fixed: true },
  { no: 93, label: "Appendix A2", title: "SO-9 Balance Verification Double-Check (independent re-run, measured values)", fixed: true },
  { no: 91, label: "Appendix B", title: "Full Disclosure — Cross-Statement Bindings, Reversals & Reconstruction", fixed: false },
  { no: 92, label: "Annex C", title: "Complete Chain-Verified Ledger", fixed: false },
];

/** Canonical section title, e.g. stdTitle(10) → "10 · Visa Readiness Matrix", stdTitle(90) → "Appendix A · SO-10 Verification Passport …". */
export function stdTitle(no: number): string {
  const s = STANDARD_SECTIONS.find((x) => x.no === no);
  if (!s) return String(no);
  return `${s.label ?? s.no} · ${s.title}`;
}

/**
 * The GUARANTEED section 10 (Master v1.2.4): canonical title + readiness
 * matrix (+ optional result narrative). Every statement report — engine
 * draft or analyst final — renders its matrix through this one call so the
 * section number, title and table contract can never drift.
 */
export function visaReadinessSection(rows: ReadinessRow[], resultHtml = ""): string {
  return `${sectionTitle(stdTitle(10))}${visaReadinessMatrix(rows)}${resultHtml}`;
}

/* ---------------- Master v1.2.5: SO-10 VERIFICATION PASSPORT (DL-9c) ---------------- */

/** One gate row of the SO-10 Verification Passport. */
export interface PassportGate {
  /** e.g. "G1". */
  id: string;
  /** e.g. "Serial Census". */
  name: string;
  /** The ACTUAL measured value(s) — SO-10 forbids a bare "PASS". */
  measured: string;
  /** true/false → PASS/FAIL pill; pending=true renders the amber PENDING pill (draft stage). */
  pass: boolean;
  /** Gate evaluated with an adapted, disclosed methodology (e.g. G3 on formats without printed totals). */
  adapted?: boolean;
  /** Draft-stage gate awaiting analyst measurement — renders PENDING, never a silent PASS. */
  pending?: boolean;
}

function passportPill(g: PassportGate): string {
  if (g.pending) return tag("PENDING", "warn");
  return tag(g.pass ? "PASS" : "FAIL", g.pass ? "pass" : "fail") + (g.adapted ? ` ${tag("adapted", "warn")}` : "");
}

/* ---------------- Master v1.3: SO-9 BALANCE VERIFICATION DOUBLE-CHECK (ES-1, 2026-10-15) ---------------- */

/** One check row of the SO-9 Balance Verification Double-Check. */
export interface DoubleCheckRow {
  /** e.g. "DC1". */
  id: string;
  /** e.g. "Credits total Σ — re-aggregation" or "… — Account 1000… (EGP)". */
  name: string;
  /** Measured value from the FIRST verification pass (the SO-10 G-gate run). */
  firstRun: string;
  /** Measured value from the INDEPENDENT SO-9 re-run (engine re-aggregation / analyst re-read). */
  reRun: string;
  /** Residual between the two passes, e.g. "0.00" — must be zero to match. */
  delta: string;
  /** true/false → MATCH/MISMATCH pill; pending=true renders amber PENDING (draft stage). */
  pass: boolean;
  /** Draft-stage check awaiting the analyst re-run — renders PENDING, never a silent MATCH. */
  pending?: boolean;
}

/**
 * The GUARANTEED Appendix A2 (Master v1.3.0): SO-9 Balance Verification
 * Double-Check — the balance chain verified TWICE: the SO-10 G-gate pass and
 * an independent re-run, rendered side by side with the Δ residual between
 * them. Fail-loud: any non-zero residual = MISMATCH = delivery blocked
 * (SO-9 pre-delivery gate), quarantine, never a silent best guess; a PENDING
 * check blocks delivery until the analyst re-run is measured. The doctrine
 * line carries the SO-4 chain vocabulary (pairs closed, residual disclosed)
 * so the delivery gate's CHAIN check stays satisfiable by the rendered bytes.
 */
export function so9DoubleCheck(rows: DoubleCheckRow[], accountLabel?: string): string {
  const body = rows
    .map((r) => {
      const pill = r.pending ? tag("PENDING", "warn") : r.pass ? tag("MATCH", "pass") : tag("MISMATCH", "fail");
      const deltaCls = r.pending ? "" : r.pass ? "text-success" : "text-danger";
      return (
        `<tr><td><strong>${escHtml(r.id)} · ${escHtml(r.name)}</strong></td>` +
        `<td class="num">${r.firstRun}</td>` +
        `<td class="num">${r.reRun}</td>` +
        `<td class="num ${deltaCls}"><b>${escHtml(r.delta)}</b></td>` +
        `<td class="text-center">${pill}</td></tr>`
      );
    })
    .join("");
  const open = rows.filter((r) => r.pending).length;
  const note =
    `<p class="small">SO-9 doctrine: the balance verification is run TWICE — the SO-10 gate pass and this independent ` +
    `re-run — and both passes must agree to the cent. Any non-zero residual = MISMATCH = delivery blocked; all pairs ` +
    `closed and the residual disclosed in the delivered build. PENDING checks block delivery until measured; no check ` +
    `is ever silently assumed.${open ? ` ${open} check(s) pending in this draft.` : ""}</p>`;
  const label = accountLabel ? ` — ${escHtml(accountLabel)}` : "";
  return `${sectionTitle(`${stdTitle(93)}${label}`)}<table class="data-table"><tr><th>Check</th><th>First run (SO-10 gate)</th><th>Independent re-run (SO-9)</th><th>Δ residual</th><th>Verdict</th></tr>${body}</table>${note}`;
}

/**
 * The GUARANTEED Appendix A (Master v1.2.5): SO-10 Verification Passport —
 * gates G1–G9 with measured values, fail-loud. Every statement report
 * renders its passport through this one call; a report ships only when all
 * gates pass (SO-9 delivery gate enforces it), any unevaluable gate = FAIL
 * = quarantine, never a silent best guess.
 */
export function so10Passport(gates: PassportGate[], accountLabel?: string): string {
  const rows = gates
    .map(
      (g) =>
        `<tr><td><strong>${escHtml(g.id)} · ${escHtml(g.name)}</strong></td>` +
        `<td>${passportPill(g)}</td>` +
        `<td class="small">${g.measured}</td></tr>`
    )
    .join("");
  const open = gates.filter((g) => g.pending).length;
  const note =
    `<p class="small">Fail-loud doctrine: any unevaluable gate = FAIL = quarantine; a PENDING gate` +
    ` blocks delivery until measured. All measured values above come from the verification run of` +
    ` this exact statement — none is assumed.${open ? ` ${open} gate(s) pending analyst measurement in this draft.` : ""}</p>`;
  const label = accountLabel ? ` — ${escHtml(accountLabel)}` : "";
  return `${sectionTitle(`${stdTitle(90)}${label}`)}<table class="data-table"><tr><th>Gate</th><th>Verdict</th><th>Measured Values</th></tr>${rows}</table>${note}`;
}

/* ---------------- Master v1.4: GRAND TOTALS + INCOME & EXPENSE SUMMARY (DL-23, 2026-10-18) ---------------- */

/** Per-account debit/credit sums for one month (major units, raw numbers — the builder does the math). */
export interface MonthlyFlow {
  debits: number;
  credits: number;
}

/** One month row of the monthly trajectory table. */
export interface MonthlyTrajectoryRow {
  /** Month label, e.g. "July 2026". */
  month: string;
  /** Small note under the label, e.g. "day range 01–11 — partial month". */
  note?: string;
  /** Per-account figures, SAME order as the spec's accountLabels. */
  accounts: MonthlyFlow[];
}

export interface MonthlyTrajectorySpec {
  /** Account labels for the column groups, e.g. "Account 1000…2501019". */
  accountLabels: string[];
  /** Currency code shown in the headers, e.g. "EGP". */
  currency: string;
  /** Month rows, chronological. */
  rows: MonthlyTrajectoryRow[];
  /** Footer row label — default "WINDOW TOTAL". */
  totalLabel?: string;
}

function fmt2(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signed2(n: number): string {
  if (n > 0) return `+${fmt2(n)}`;
  if (n < 0) return `−${fmt2(-n)}`;
  return "0.00";
}

function flowCells(f: MonthlyFlow, strong: boolean, grand: boolean): string {
  const net = f.credits - f.debits;
  const b = (s: string) => (strong ? `<strong>${s}</strong>` : s);
  const cls = ["num", grand ? "grand-cell" : "", net > 0 ? "text-success" : net < 0 ? "text-danger" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    `<td class="${cls}">${b(fmt2(f.debits))}</td>` +
    `<td class="${cls}">${b(fmt2(f.credits))}</td>` +
    `<td class="${cls}">${b(signed2(net))}</td>`
  );
}

/**
 * Master v1.4.0 monthly trajectory table (DL-23): one row per month with
 * per-account Debit/Credit/Net column groups and a COMPUTED GRAND — All
 * Accounts group; closes with the bold WINDOW TOTAL row. Every figure —
 * per-account nets, grand sums, window totals — is re-derived here from the
 * raw numbers (G8: no hand-typed sums can enter the rendered bytes).
 * Single-account specs collapse the redundant per-account group: one
 * Debit/Credit/Net table whose footer row IS the grand total.
 */
export function monthlyTrajectoryTable(spec: MonthlyTrajectorySpec): string {
  const tl = spec.totalLabel ?? "WINDOW TOTAL";
  const cur = escHtml(spec.currency);
  const grandRows = spec.rows.map((r) => ({
    debits: r.accounts.reduce((s, a) => s + a.debits, 0),
    credits: r.accounts.reduce((s, a) => s + a.credits, 0),
  }));
  const tot = grandRows.reduce(
    (s, g) => ({ debits: s.debits + g.debits, credits: s.credits + g.credits }),
    { debits: 0, credits: 0 },
  );
  const monthCell = (label: string, note: string | undefined, strong: boolean) =>
    `<td>${strong ? `<strong>${escHtml(label)}</strong>` : escHtml(label)}${note ? `<br><span class="small">${escHtml(note)}</span>` : ""}</td>`;

  if (spec.accountLabels.length <= 1) {
    const head = `<tr><th>Month</th><th class="text-right">Total Debits (${cur})</th><th class="text-right">Total Credits (${cur})</th><th class="text-right">Net (${cur})</th></tr>`;
    const body = spec.rows
      .map((r) => `<tr>${monthCell(r.month, r.note, false)}${flowCells(r.accounts[0] ?? { debits: 0, credits: 0 }, false, false)}</tr>`)
      .join("");
    const total = `${monthCell(tl, undefined, true)}${flowCells(tot, true, false)}`;
    return `<table class="data-table"><thead>${head}</thead><tbody>${body}<tr class="total-row">${total}</tr></tbody></table>`;
  }

  const groups = spec.accountLabels.map((l) => `<th colspan="3">${escHtml(l)}</th>`).join("");
  const sub = `<th class="text-right">Total Debits</th><th class="text-right">Total Credits</th><th class="text-right">Net</th>`;
  const head =
    `<tr><th rowspan="2">Month</th>${groups}<th colspan="3" class="grand-col">Grand — All Accounts (${cur})</th></tr>` +
    `<tr>${sub.repeat(spec.accountLabels.length + 1)}</tr>`;
  const body = spec.rows
    .map(
      (r, i) =>
        `<tr>${monthCell(r.month, r.note, false)}${r.accounts.map((a) => flowCells(a, false, false)).join("")}${flowCells(grandRows[i], false, true)}</tr>`,
    )
    .join("");
  const perAccountTot = spec.accountLabels
    .map((_, i) =>
      flowCells(
        spec.rows.reduce(
          (s, r) => ({ debits: s.debits + (r.accounts[i]?.debits ?? 0), credits: s.credits + (r.accounts[i]?.credits ?? 0) }),
          { debits: 0, credits: 0 },
        ),
        true,
        false,
      ),
    )
    .join("");
  const total = `${monthCell(tl, undefined, true)}${perAccountTot}${flowCells(tot, true, true)}`;
  return `<table class="data-table"><thead>${head}</thead><tbody>${body}<tr class="total-row">${total}</tr></tbody></table>`;
}

/** Master v1.4 canonical annualization: window total × 365 ÷ windowDays (2-dp, en-US). */
export function annualRunRate(windowTotal: number, windowDays: number): string {
  if (!(windowDays > 0)) return "—";
  return fmt2((windowTotal * 365) / windowDays);
}

/** Master v1.4 canonical monthly proration: window total ÷ windowDays × 30.44 (2-dp, en-US). */
export function monthlyRunRate(windowTotal: number, windowDays: number): string {
  if (!(windowDays > 0)) return "—";
  return fmt2((windowTotal / windowDays) * 30.44);
}

export interface IncomeExpenseInput {
  currency: string;
  /** Analysis window length in days (union across accounts). */
  windowDays: number;
  /** GRAND window credits — gross income, all accounts. */
  windowCredits: number;
  /** GRAND window debits — gross expense, all accounts. */
  windowDebits: number;
  /** Verified external (third-party) credits. Omit = analyst classification pending — renders "—", never a guess. */
  verifiedExternalCredits?: number;
  /** Full calendar months inside the window — the verifiable monthly expense figures. */
  fullMonths?: Array<{ label: string; debits: number; credits: number }>;
  /** Case-specific methodology addendum appended to the canonical note (HTML). */
  methodologyHtml?: string;
}

/**
 * The GUARANTEED Income & Expense Summary (Master v1.4.0, DL-23): window
 * income (gross + verified external), annual income run-rates, monthly
 * expense (window average + full calendar months) — prorated by the
 * canonical math above. Fail-loud doctrine: the caller passes RAW numbers
 * and this builder formats every rendered figure — no hand-typed strings.
 */
export function incomeExpenseSummaryBlock(input: IncomeExpenseInput): string {
  const cur = escHtml(input.currency);
  const v = (x: string, strong = false) => `<td class="num">${strong ? `<strong>${x}</strong>` : x}</td>`;
  const rows: string[] = [];
  rows.push(
    `<tr><td>Total income — window (gross credits, all accounts)</td>${v(fmt2(input.windowCredits), true)}` +
      `<td class="small">Σ all credits across the ${input.windowDays}-day window = GRAND credits, WINDOW TOTAL row</td></tr>`,
  );
  const ext = input.verifiedExternalCredits;
  if (ext === undefined) {
    rows.push(
      `<tr><td>Total income — verified external only</td>${v("—")}` +
        `<td class="small">third-party credit classification pending analyst (Source of Funds) — never silently assumed</td></tr>`,
    );
  } else {
    const share = input.windowCredits > 0 ? Math.round((ext / input.windowCredits) * 1000) / 10 : 100;
    rows.push(
      `<tr><td>Total income — verified external only</td>` +
        `<td class="num">${fmt2(ext)} ${tag(`${share}%`, "warn")}</td>` +
        `<td class="small">third-party credits only; the remaining ${(100 - share).toFixed(1)}% is own-account circulation</td></tr>`,
    );
  }
  rows.push(
    `<tr><td>Annual income — gross run-rate</td>${v(annualRunRate(input.windowCredits, input.windowDays), true)}` +
      `<td class="small">${fmt2(input.windowCredits)} × 365 ÷ ${input.windowDays} — projection at window pace; overstated by own-account circulation, NOT verified capacity</td></tr>`,
  );
  if (ext === undefined) {
    rows.push(
      `<tr><td>Annual income — verified external run-rate</td>${v("—")}` +
        `<td class="small">awaits the verified external classification above</td></tr>`,
    );
  } else {
    rows.push(
      `<tr><td>Annual income — verified external run-rate</td>${v(annualRunRate(ext, input.windowDays))}` +
        `<td class="small">${fmt2(ext)} × 365 ÷ ${input.windowDays} — the assessment-grade annualized external income</td></tr>`,
    );
  }
  rows.push(
    `<tr><td>Monthly expense — window average</td>${v(monthlyRunRate(input.windowDebits, input.windowDays), true)}` +
      `<td class="small">${fmt2(input.windowDebits)} ÷ ${input.windowDays} days × 30.44 (avg month length) — gross debits prorated monthly</td></tr>`,
  );
  for (const fm of input.fullMonths ?? []) {
    rows.push(
      `<tr><td>Monthly expense — ${escHtml(fm.label)} (full calendar month)</td>${v(fmt2(fm.debits))}` +
        `<td class="small">GRAND debits, ${escHtml(fm.label)} only</td></tr>`,
    );
  }
  const note =
    `<p class="small" style="margin-top:8px;"><strong>Methodology (Master v1.4):</strong> GRAND columns aggregate all analysed accounts ` +
    `per month; internal transfers between own accounts are included and cancel on consolidation. Annualized figures prorate the ` +
    `${input.windowDays}-day window to 365 days; partial months are flagged and only full calendar months are quoted as verified monthly ` +
    `expense. The gross run-rate is a turnover figure, not income capacity; the verified external run-rate (where classified) is the ` +
    `figure an assessor treats as income.${input.methodologyHtml ? ` ${input.methodologyHtml}` : ""}</p>`;
  return (
    `<h3 style="color:var(--primary);margin-bottom:12px;">Income &amp; Expense Summary (window-prorated)</h3>` +
    `<table class="data-table"><thead><tr><th>Metric</th><th class="text-right">Value (${cur})</th><th>Basis / Formula</th></tr></thead><tbody>${rows.join("")}</tbody></table>` +
    note
  );
}

/**
 * The GUARANTEED section 4 (Master v1.4.0): canonical S4 title + the monthly
 * trajectory table (per-account column groups + computed GRAND group +
 * WINDOW TOTAL footer) + the window-prorated income & expense summary.
 * Engine drafts and analyst finals both render S4 through this one call so
 * the section number, title and grand-total contract can never drift.
 */
export function monthlyTrajectorySection(spec: MonthlyTrajectorySpec, incomeExpenseHtml: string): string {
  return `${sectionTitle(stdTitle(4))}${monthlyTrajectoryTable(spec)}${incomeExpenseHtml}`;
}

export interface ReportShellOpts {
  title: string;
  /** Fully-qualified header sub-lines (HTML allowed, e.g. <strong>…</strong>). */
  subLines: string[];
  /** Banner boxes rendered at the top of the content (engine/OCR stamps). */
  banners?: string[];
  contentHtml: string;
  /** Page <title> (defaults to the firm's standard). */
  pageTitle?: string;
  /** Master v1.2.3: hidden by default (owner order 2026-10-11) — pass true to show. */
  downloadButton?: boolean;
  /** Master v1.2 header reference line (ref · generated date). */
  refLine?: string;
}

/** Full standard page: gradient header → content → sign-off-ready prepared-by footer. */
export function reportShell(opts: ReportShellOpts): string {
  const btn = opts.downloadButton === true ? `<button class="download-btn" onclick="window.print()">&#11015; Download PDF Report</button>` : "";
  const ref = opts.refLine ? `<p class="ref-line">${opts.refLine}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(opts.pageTitle ?? "Global EIS - Financial Intelligence Report")}</title>
<style>${REPORT_CSS}</style></head>
<body><div class="container">
<div class="header">${btn}<h1>${escHtml(opts.title)}</h1>
${opts.subLines.map((l) => `<p>${l}</p>`).join("\n")}
${ref}
</div>
<div class="content">
${(opts.banners ?? []).join("\n")}
${opts.contentHtml}
</div>
<div class="footer">
<p><strong>Prepared By:</strong> Global EIS - Financial Intelligence Services</p>
<p class="legal"><strong>Disclaimer:</strong> This report is prepared by Global EIS based solely on the bank statement document supplied by the client. Global EIS does not independently verify the authenticity of the underlying bank statement and makes no representation as to the applicant's eligibility for any visa or immigration outcome. All mathematical reconciliations are verified against the stated bank totals. Statements analysed as delivered; authenticity findings reflect documentary consistency only. One statement = one report; never recycled. This report is intended solely to support the client's own submission, should be read together with all other required supporting documentation, and does not constitute legal advice.</p>
</div>
</div></body></html>`;
}
