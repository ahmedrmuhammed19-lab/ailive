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
 * Tokens: --primary #005677 / --secondary #008DCB on Segoe UI, gradient
 * header, KPI cards with colored left borders, section bars, pill tags,
 * left-bordered alert boxes, print button + prepared-by footer.
 */

export const TEMPLATE_VERSION = "Master v1.2.2 (STANDARD — promoted 2026-10-06, disclaimer hardened + value-first KPI option 2026-10-11)";

export const REPORT_CSS = `
:root{--primary:#005677;--secondary:#008DCB;--success:#28a745;--danger:#dc3545;--warning:#ffc107;--light:#f8f9fa;--dark:#343a40;--white:#ffffff}
body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#eef2f5;color:var(--dark);margin:0;padding:20px}
.container{max-width:1200px;margin:0 auto;background:var(--white);border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;position:relative}
.header{background:linear-gradient(135deg,var(--primary),var(--secondary));color:var(--white);padding:40px 30px;text-align:center;position:relative}
.header h1{margin:0;font-size:2.5em;text-transform:uppercase;letter-spacing:1px}
.header p{margin:5px 0 0;opacity:0.9;font-size:1.1em}
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
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:40px}
.kpi-card{background:var(--white);border-radius:10px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,0.05);border-left:5px solid var(--secondary);transition:transform 0.2s}
.kpi-card:hover{transform:translateY(-5px)}
.kpi-card h3{margin:0 0 10px;color:#666;font-size:1.0em;text-transform:uppercase}
.kpi-card .value{font-size:1.7em;font-weight:bold;color:var(--primary)}
.kpi-card .note{font-size:0.85em;color:#777;margin-top:6px}
.kpi-card.success{border-left-color:var(--success)}.kpi-card.success .value{color:var(--success)}
.kpi-card.danger{border-left-color:var(--danger)}.kpi-card.danger .value{color:var(--danger)}
.kpi-card.warning{border-left-color:var(--warning)}.kpi-card.warning .value{color:#b8860b}
.kpi-card.value-first{display:flex;flex-direction:column}
.kpi-card.value-first .value{order:1}
.kpi-card.value-first h3{order:2;margin:6px 0 0}
.kpi-card.value-first .note{order:3}
.section-title{font-size:1.7em;color:var(--primary);border-bottom:2px solid #eee;padding-bottom:10px;margin-bottom:20px;margin-top:44px;font-weight:700;display:flex;align-items:center}
.section-title::before{content:'';display:inline-block;width:8px;height:22px;background:var(--secondary);margin-right:12px;border-radius:2px}
.data-table{width:100%;border-collapse:collapse;margin-bottom:30px;font-size:0.92em}
.data-table th{background:var(--light);color:var(--primary);text-align:left;padding:12px;border-bottom:2px solid #ddd}
.data-table td{padding:11px 12px;border-bottom:1px solid #eee;vertical-align:top}
.data-table tr:nth-child(even) td{background:#fafbfc}
.text-right{text-align:right}.text-center{text-align:center}
.text-success{color:var(--success);font-weight:bold}.text-danger{color:var(--danger);font-weight:bold}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.analysis-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-bottom:40px}
@media (max-width:768px){.analysis-grid{grid-template-columns:1fr}.download-btn{position:static;margin-top:20px;display:inline-block}}
.analysis-card{background:var(--white);border:1px solid #e1e4e8;border-radius:10px;padding:20px;box-shadow:0 2px 5px rgba(0,0,0,0.03)}
.analysis-card.full-width{grid-column:span 2}
.analysis-card h3{margin-top:0;color:var(--primary);display:flex;align-items:center;font-size:1.3em}
.analysis-card h3::before{content:'';display:inline-block;width:10px;height:10px;background:var(--secondary);border-radius:50%;margin-right:10px}
.tag{background:#e9ecef;padding:3px 10px;border-radius:12px;font-size:0.85em;color:#495057;margin-right:5px;display:inline-block;margin-bottom:5px}
.tag.in{background:#e6f4ea;color:var(--success)}
.tag.out{background:#fce8e6;color:var(--danger)}
.tag.pass{background:#e6f4ea;color:var(--success);font-weight:bold}
.tag.fail{background:#fee2e2;color:var(--danger);font-weight:bold}
.tag.warn{background:#fff3cd;color:#856404;font-weight:bold}
.tag.low{background:#e0f7fa;color:var(--primary);font-weight:bold}
.alert-box{padding:20px;border-radius:8px;margin-top:15px;margin-bottom:15px;border-left:5px solid}
.alert-box.blue{background:#e7f3fe;border-color:var(--secondary)}
.alert-box.red{background:#fff3cd;border-color:var(--warning)}
.alert-box.green{background:#e6f4ea;border-color:var(--success)}
.alert-box.danger{background:#fef2f2;border-color:var(--danger)}
.alert-box h4{margin:0 0 10px;color:var(--dark)}
.alert-box ul{margin:10px 0 0 20px;padding:0}
.alert-box li{margin-bottom:8px}
.annex-banner{background:var(--primary);color:var(--white);padding:10px 20px;border-radius:8px 8px 0 0;font-weight:bold;font-size:0.9em;letter-spacing:0.5px}
.annex-body{border:1px solid #e1e4e8;border-top:none;border-radius:0 0 8px 8px;padding:20px;margin-bottom:30px}
.signoff{display:flex;justify-content:space-between;align-items:flex-end;margin-top:40px;padding-top:20px;border-top:1px dashed #ccc;flex-wrap:wrap;gap:20px}
.signoff .sig-line{border-top:1px solid var(--dark);padding-top:6px;font-size:0.85em;min-width:220px}
.small{font-size:0.85em;color:#777;line-height:1.6}
.footer{text-align:center;padding:20px;color:#777;font-size:0.85em;background:#f8f9fa;border-top:1px solid #eee}
.footer p{margin:4px 0}
.footer .legal{max-width:900px;margin:6px auto 0;line-height:1.5}
@page{size:A4;margin:16mm 12mm}
@media print{body{background:none;padding:0}.container{box-shadow:none;border-radius:0;max-width:none}.download-btn{display:none}.section-title,.analysis-card,.kpi-card,.annex-body{page-break-inside:avoid}.data-table tr{page-break-inside:avoid}.data-table thead{display:table-header-group}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
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

export interface ReportShellOpts {
  title: string;
  /** Fully-qualified header sub-lines (HTML allowed, e.g. <strong>…</strong>). */
  subLines: string[];
  /** Banner boxes rendered at the top of the content (engine/OCR stamps). */
  banners?: string[];
  contentHtml: string;
  /** Page <title> (defaults to the firm's standard). */
  pageTitle?: string;
  downloadButton?: boolean;
  /** Master v1.2 header reference line (ref · generated date). */
  refLine?: string;
}

/** Full standard page: gradient header → content → sign-off-ready prepared-by footer. */
export function reportShell(opts: ReportShellOpts): string {
  const btn = opts.downloadButton === false ? "" : `<button class="download-btn" onclick="window.print()">&#11015; Download PDF Report</button>`;
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
