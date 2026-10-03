/**
 * The firm's canonical report design — adopted VERBATIM from the client's own
 * HTML template (scripts/report_template.html, supplied 2026-10-03).
 *
 * One design system for every HTML report the portal produces: engine
 * auto-reports, analyst-review drafts and delivered final reports all share
 * this skin, so a report looks identical whether the client receives it from
 * the portal's zero-tap flow or from an analyst pass ("here" and the portal
 * can never drift again).
 *
 * Tokens: --primary #005677 / --secondary #008DCB on Segoe UI, gradient
 * header, KPI cards with colored left borders, section bars, pill tags,
 * left-bordered alert boxes, print button + disclaimer footer.
 */

export const REPORT_CSS = `
:root{--primary:#005677;--secondary:#008DCB;--success:#28a745;--danger:#dc3545;--warning:#ffc107;--light:#f8f9fa;--dark:#343a40;--white:#ffffff}
body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#eef2f5;color:var(--dark);margin:0;padding:20px}
.container{max-width:1200px;margin:0 auto;background:var(--white);border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;position:relative}
.header{background:linear-gradient(135deg,var(--primary),var(--secondary));color:var(--white);padding:40px 30px;text-align:center;position:relative}
.header h1{margin:0;font-size:2.5em;text-transform:uppercase;letter-spacing:1px}
.header p{margin:5px 0 0;opacity:0.9;font-size:1.1em}
.download-btn{position:absolute;top:30px;right:30px;background:var(--white);color:var(--primary);border:none;padding:10px 20px;font-size:14px;font-weight:bold;border-radius:5px;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,0.2);transition:0.2s}
.download-btn:hover{background:#f0f0f0;transform:translateY(-2px)}
.content{padding:40px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-bottom:40px}
.kpi-card{background:var(--white);border-radius:10px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,0.05);border-left:5px solid var(--secondary);transition:transform 0.2s}
.kpi-card:hover{transform:translateY(-5px)}
.kpi-card h3{margin:0 0 10px;color:#666;font-size:1.1em;text-transform:uppercase}
.kpi-card .value{font-size:1.8em;font-weight:bold;color:var(--primary)}
.kpi-card .note{font-size:0.85em;color:#777;margin-top:6px}
.kpi-card.success{border-left-color:var(--success)}.kpi-card.success .value{color:var(--success)}
.kpi-card.danger{border-left-color:var(--danger)}.kpi-card.danger .value{color:var(--danger)}
.kpi-card.warning{border-left-color:var(--warning)}.kpi-card.warning .value{color:#856404}
.section-title{font-size:1.8em;color:var(--primary);border-bottom:2px solid #eee;padding-bottom:10px;margin-bottom:20px;margin-top:40px;font-weight:700;display:flex;align-items:center}
.section-title::before{content:'';display:inline-block;width:8px;height:22px;background:var(--secondary);margin-right:12px;border-radius:2px}
.data-table{width:100%;border-collapse:collapse;margin-bottom:30px;font-size:0.95em}
.data-table th{background:var(--light);color:var(--primary);text-align:left;padding:12px;border-bottom:2px solid #ddd;font-size:0.85em;text-transform:uppercase;letter-spacing:0.4px}
.data-table td{padding:12px;border-bottom:1px solid #eee;vertical-align:top}
.text-right{text-align:right}.text-center{text-align:center}
.text-success{color:var(--success);font-weight:bold}.text-danger{color:var(--danger);font-weight:bold}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.analysis-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-bottom:40px}
@media (max-width:768px){.analysis-grid{grid-template-columns:1fr}.download-btn{position:static;margin-top:20px;display:inline-block}}
.analysis-card{background:var(--white);border:1px solid #e1e4e8;border-radius:10px;padding:20px;box-shadow:0 2px 5px rgba(0,0,0,0.03)}
.analysis-card.full-width{grid-column:span 2}
.analysis-card h3{margin-top:0;color:var(--primary);display:flex;align-items:center;font-size:1.4em}
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
.small{font-size:0.85em;color:#777;line-height:1.6}
.footer{text-align:center;padding:20px;color:#777;font-size:0.9em;background:#f8f9fa;border-top:1px solid #eee}
.footer p{margin:4px 0}
@media print{body{background:none}.container{box-shadow:none;border-radius:0}.download-btn{display:none}.analysis-card{page-break-inside:avoid}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
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
}

/** Full client-design page: gradient header → content → prepared-by footer. */
export function reportShell(opts: ReportShellOpts): string {
  const btn = opts.downloadButton === false ? "" : `<button class="download-btn" onclick="window.print()">&#11015; Download PDF Report</button>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(opts.pageTitle ?? "Global EIS - Financial Intelligence Report")}</title>
<style>${REPORT_CSS}</style></head>
<body><div class="container">
<div class="header">${btn}<h1>${escHtml(opts.title)}</h1>
${opts.subLines.map((l) => `<p>${l}</p>`).join("\n")}
</div>
<div class="content">
${(opts.banners ?? []).join("\n")}
${opts.contentHtml}
</div>
<div class="footer">
<p><strong>Prepared By:</strong> Global EIS - Financial Intelligence Services</p>
<p><strong>Disclaimer:</strong> This analysis is generated based on the provided bank statement document. All mathematical reconciliations are verified against official bank totals. This report does not constitute legal advice.</p>
</div>
</div></body></html>`;
}
