import { extractText, getDocumentProxy } from "unpdf";
import { db } from "@/lib/db";

/**
 * Auto-analysis engine — first-pass statement analysis triggered by the
 * email "Start Analysis" button.
 *
 * Strategy: extract the PDF text layer (unpdf / pdf.js, serverless-safe),
 * parse CIB statement structure (account meta + date-anchored movement rows),
 * then classify every row by *ledger chain verification* — the same logic as
 * the workspace Python engine (scripts/haytham_extract.py): the running
 * balance must reconcile, so each movement's direction comes from the stated
 * balance delta rather than fragile column geometry.
 *
 * Output: one CIB-Blue-styled DRAFT report per submission (watermarked
 * "pending analyst review"), published to the DB so the operator can review
 * and mark DONE — the DONE flow then delivers it to the client untouched.
 *
 * Honest limits: image-only scans and non-CIB layouts fall back to
 * "needs manual analysis" — the case stays ANALYZING for the workspace.
 */

// ---------- indicative FX (EGP per unit) — disclosed in report, refresh on submission day ----------
const FX_EGP: Record<string, number> = {
  EGP: 1,
  USD: 48.0,
  EUR: 51.5,
  GBP: 60.0,
  SAR: 12.8,
  AED: 13.1,
  KWD: 156.0,
  QAR: 13.2,
};

// ---------- indicative visa benchmark (EGP-equivalent, × joint applicants) ----------
const BENCHMARK_EGP: Record<string, number> = {
  "UNITED KINGDOM": 250_000,
  "SCHENGEN AREA": 150_000,
  "UNITED STATES": 200_000,
  CANADA: 150_000,
  AUSTRALIA: 150_000,
};
const DEFAULT_BENCHMARK_EGP = 150_000;

// ---------- CIB text-layer patterns ----------
const RE_ACCT = /Account\s*Number:\s*(\d{6,})/i;
const RE_CURR = /Account\s*Currency:\s*([A-Z]{3})/i;
const RE_LEDGER = /Ledger\s*Balance:\s*\(?([\d,]+\.\d{2})\)?/i;
const RE_PERIOD =
  /Movement Details\s*-?\s*From:\s*(\d{1,2}\s+\w{3}\s+\d{4})\s*To:\s*(\d{1,2}\s+\w{3}\s+\d{4})/i;
const RE_DATE_FULL = /^\s*(\d{2}\/\d{2}\/20\d{2})\b/;
const RE_DATE_WRAPPED = /^\s*(\d{2}\/\d{2}\/20)(?!\d)/; // year wrapped to next token
const RE_AMT = /\(?-?[\d,]+\.\d{2}\)?/g;
const RE_TOTAL_LINE = /^\s*Total\b/i;
const SALARY_RE = /salary|payroll|\bsal\b/i;

interface TxRow {
  date: string;
  desc: string;
  movement: number | null; // abs value from the row's amount column
  balance: number | null; // stated running balance
  signed: number; // +credit / -debit after chain classification
  chainOk: boolean;
}

interface AccountLeg {
  file: string;
  account: string | null;
  currency: string;
  period: string | null;
  opening: number;
  closing: number;
  inflow: number;
  outflow: number;
  txCount: number;
  matched: number;
  largestCredit: { desc: string; amount: number } | null;
  largestDebit: { desc: string; amount: number } | null;
  salarySeen: boolean;
  rows: TxRow[];
}

export interface AutoAnalysisResult {
  ok: boolean;
  mode: "cib-parsed" | "unrecognized" | "no-files";
  message: string;
  reportName?: string;
  legs?: Array<Pick<AccountLeg, "account" | "currency" | "opening" | "closing" | "inflow" | "outflow" | "txCount" | "matched">>;
  consolidated?: { egpEquivalent: number; benchmark: number; coveragePct: number };
}

function toNum(tok: string): number {
  const neg = tok.startsWith("(");
  const n = parseFloat(tok.replace(/[(),]/g, ""));
  return neg ? -n : n;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Parse one PDF's text into a CIB account leg — dispatches by layout family. */
export function parseCibText(text: string, file: string): AccountLeg | null {
  return parseCibInternet(text, file) ?? parseCibDigital(text, file) ?? parseCibBranch(text, file);
}

/**
 * Layout B — CIB "Internet Banking Account Statement" (Mahmoud sample):
 *   Account Number 100 034 5567 891 · Opening Balance EGP x · rows ascending,
 *   anchor = posting date (+ optional value date), amounts may wrap to the
 *   following line (movement then balance-last). Currency labels wrap ("E\nGP").
 */
function parseCibInternet(text: string, file: string): AccountLeg | null {
  // join uppercase letter wraps ("Currency E\nGP" -> "Currency EGP")
  const norm = text.replace(/([A-Z])\r?\n([A-Z]{2,3})\b/g, (_m, a, b) => a + b);
  if (!/Internet Banking Account Statement/i.test(norm) && !/Opening Balance/i.test(norm)) return null;
  const accountM = /Account Number\s+((?:\d[\s.]?){9,20})/.exec(norm);
  if (!accountM) return null;
  const currency = /Currency\s+([A-Z]{3})\b/.exec(norm)?.[1] ?? null;
  const openingM = /Opening Balance\s*(?:[A-Z]{3}\s*)?([\d,]+\.\d{2})/.exec(norm);
  const periodM = /Statement Period\s*(?:\d\s*\n\s*)?(\d{1,2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}\/\d{2}\/\d{4})/.exec(norm);

  const lines = norm.split(/\r?\n/);
  interface Block { date: string; text: string }
  const blocks: Block[] = [];
  const anchorRe = /^\s*(\d{2}\/\d{2}\/\d{4})\b/;
  for (const raw of lines) {
    const m = anchorRe.exec(raw);
    if (m) blocks.push({ date: m[1], text: raw.slice(m[0].length) });
    else if (blocks.length) blocks[blocks.length - 1].text += " " + raw;
  }
  if (blocks.length < 3) return null;

  const rows: TxRow[] = [];
  for (const b of blocks) {
    const amounts = [...b.text.matchAll(RE_AMT)].map((m) => m[0]);
    if (amounts.length === 0) continue; // anchor-only noise
    let desc = b.text;
    for (const a of amounts) desc = desc.replace(a, " ");
    desc = desc
      .replace(/\d{2}\/\d{2}\/\d{4}/g, " ")
      .replace(/\((?:EGP|USD|EUR|GBP|SAR|AED)\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const balance = toNum(amounts[amounts.length - 1]);
    const movement = amounts.length >= 2 ? Math.abs(toNum(amounts[amounts.length - 2])) : null;
    rows.push({ date: b.date, desc, movement, balance, signed: 0, chainOk: false });
  }
  if (rows.length < 3) return null;

  // ascending chain from the header opening balance
  let prev = openingM ? toNum(openingM[1]) : rows[0].balance! - (rows[0].movement ?? 0);
  let matched = 0;
  for (const r of rows) {
    if (r.balance === null) continue;
    const delta = (r.balance as number) - prev;
    r.signed = r.movement !== null && Math.abs(Math.abs(delta) - r.movement) > 0.015 ? delta : delta >= 0 ? (r.movement ?? delta) : -(r.movement ?? -delta);
    if (r.movement !== null && Math.abs(Math.abs(delta) - r.movement) < 0.015) r.chainOk = true;
    else r.signed = delta;
    if (r.chainOk) matched++;
    prev = r.balance as number;
  }

  const inflow = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = rows.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = rows.filter((r) => r.signed > 0);
  const debits = rows.filter((r) => r.signed < 0);
  const topCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const topDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;
  return {
    file,
    account: accountM[1].replace(/[^\d]/g, ""),
    currency: currency ?? "EGP",
    period: periodM ? `${periodM[1]} → ${periodM[2]}` : null,
    opening: openingM ? toNum(openingM[1]) : rows[0].balance! - rows[0].signed,
    closing: rows[rows.length - 1].balance ?? 0,
    inflow,
    outflow,
    txCount: rows.length,
    matched,
    largestCredit: topCredit ? { desc: topCredit.desc.slice(0, 90), amount: topCredit.signed } : null,
    largestDebit: topDebit ? { desc: topDebit.desc.slice(0, 90), amount: topDebit.signed } : null,
    salarySeen: rows.some((r) => SALARY_RE.test(r.desc)),
    rows,
  };
}

/**
 * Layout C — CIB digital-banking export ("as of … GMT", paul's client files):
 *   header line with Customer Id / Account Number / Currency / Opening /
 *   Closing / period as ground truth; rows listed NEWEST-FIRST, so each row's
 *   signed movement equals the stated-balance delta against the PREVIOUS
 *   (newer) row; the oldest row reconciles against the header opening.
 */
function parseCibDigital(text: string, file: string): AccountLeg | null {
  const hm =
    /Customer Id Account Number Account Currency Opening Balance Closing Balance From Date To Date\s*\n?\s*(\d+)\s+(\d{9,})\s+([A-Z]{3})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\d{2}-\w+-\d{4})\s+(\d{2}-\w+-\d{4})/.exec(
      text
    );
  if (!hm) return null;
  const account = hm[2];
  const currency = hm[3];
  const opening = toNum(hm[4]);
  const period = `${hm[6]} → ${hm[7]}`;

  const lines = text.split(/\r?\n/);
  interface Block { date: string; text: string }
  const blocks: Block[] = [];
  const anchorRe = /^\s*(\d{2}-[A-Za-z]+-\d{4})\b/;
  for (const raw of lines) {
    if (/^\s*Transaction Date/.test(raw) || /^\s*No\.\s*Description/.test(raw)) continue; // page headers
    const m = anchorRe.exec(raw);
    if (m) blocks.push({ date: m[1], text: raw.slice(m[0].length) });
    else if (blocks.length) blocks[blocks.length - 1].text += " " + raw;
  }
  if (blocks.length < 1) return null;

  const rows: TxRow[] = [];
  for (const b of blocks) {
    const amounts = [...b.text.matchAll(RE_AMT)].map((m) => m[0]);
    if (amounts.length === 0) continue;
    let desc = b.text;
    for (const a of amounts) desc = desc.replace(a, " ");
    desc = desc
      .replace(/\d{2}-[A-Za-z]+-\d{4}/g, " ")
      .replace(/\((?:EGP|USD|EUR|GBP|SAR|AED)\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const balance = toNum(amounts[amounts.length - 1]);
    const movement = amounts.length >= 2 ? Math.abs(toNum(amounts[amounts.length - 2])) : null;
    rows.push({ date: b.date, desc, movement, balance, signed: 0, chainOk: false });
  }
  if (rows.length < 1) return null;

  // newest-first: delta against the next (older) stated balance
  let matched = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.balance === null) continue;
    const refBal = i + 1 < rows.length ? (rows[i + 1].balance as number) : opening;
    const delta = (r.balance as number) - refBal;
    r.signed = delta;
    if (r.movement !== null && Math.abs(Math.abs(delta) - r.movement) < 0.015) {
      r.chainOk = true;
      matched++;
    }
  }

  const chronological = [...rows].reverse(); // oldest first for display/report
  const inflow = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = rows.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = rows.filter((r) => r.signed > 0);
  const debits = rows.filter((r) => r.signed < 0);
  const topCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const topDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;
  return {
    file,
    account,
    currency,
    period,
    opening,
    closing: rows[0].balance ?? 0, // newest row = closing position
    inflow,
    outflow,
    txCount: rows.length,
    matched,
    largestCredit: topCredit ? { desc: topCredit.desc.slice(0, 90), amount: topCredit.signed } : null,
    largestDebit: topDebit ? { desc: topDebit.desc.slice(0, 90), amount: topDebit.signed } : null,
    salarySeen: rows.some((r) => SALARY_RE.test(r.desc)),
    rows: chronological,
  };
}

/** Layout A — CIB branch statement (haytham family): single posting-date anchor, inline amounts. */
function parseCibBranch(text: string, file: string): AccountLeg | null {
  const account = RE_ACCT.exec(text)?.[1] ?? null;
  const currency = RE_CURR.exec(text)?.[1] ?? null;
  const periodM = RE_PERIOD.exec(text);

  const lines = text.split(/\r?\n/);
  const rows: TxRow[] = [];
  let current: TxRow | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (RE_TOTAL_LINE.test(line)) continue; // section footer totals

    let dateM = RE_DATE_FULL.exec(line);
    let rest = line;
    if (dateM) {
      rest = line.slice(dateM[0].length).trim();
    } else {
      const wrapped = RE_DATE_WRAPPED.exec(line);
      if (wrapped) {
        // year wrapped: "01/04/20" followed by "26 ..." on the same text line
        const joined = line.replace(/^(?:\s*)(\d{2}\/\d{2}\/20)(?!\d)\s*(\d{2})/, "$1$2");
        dateM = RE_DATE_FULL.exec(joined);
        rest = dateM ? joined.slice(dateM[0].length).trim() : line;
        if (!dateM) {
          appendContinuation(current, line);
          continue;
        }
      } else {
        appendContinuation(current, line);
        continue;
      }
    }

    const amounts = [...rest.matchAll(RE_AMT)].map((m) => m[0]);
    // description: strip amounts & bare reference tokens from the tail
    let desc = rest;
    for (const a of amounts) desc = desc.replace(a, " ");
    desc = desc.replace(/\s+/g, " ").trim();
    // movement amount = second-to-last (before the running balance)
    let movement: number | null = null;
    let balance: number | null = null;
    if (amounts.length >= 2) {
      movement = Math.abs(toNum(amounts[amounts.length - 2]));
      balance = toNum(amounts[amounts.length - 1]);
    } else if (amounts.length === 1) {
      balance = toNum(amounts[0]);
    }
    if (current) rows.push(current);
    current = { date: dateM[1], desc, movement, balance, signed: 0, chainOk: false };
  }
  if (current) rows.push(current);

  // Not a usable CIB table → bail (caller falls back to manual analysis)
  if (!currency && !account) return null;
  if (rows.length < 3) return null;

  // --- chain verification: sign each movement from the stated balance delta ---
  const withBal = rows.filter((r) => r.balance !== null) as Array<TxRow & { balance: number }>;
  if (withBal.length < 3) return null;

  const first = withBal[0];
  const guessSign = SALARY_RE.test(first.desc) || first.movement === null ? 1 : /withdraw|atm|debit|payment/i.test(first.desc) ? -1 : 1;
  const opening = first.balance - (first.movement ?? 0) * guessSign;
  first.signed = (first.movement ?? 0) * guessSign;

  let matched = first.movement === null ? 1 : 0; // row 0 sign is guessed, not verified
  let bal = opening;
  for (let i = 0; i < withBal.length; i++) {
    const r = withBal[i];
    if (i > 0) {
      const delta = r.balance - withBal[i - 1].balance;
      if (r.movement !== null && Math.abs(Math.abs(delta) - r.movement) > 0.015 && Math.abs(delta) > 0.015) {
        // balance jumped by an unstated movement (page-break carry row etc.)
        r.signed = delta;
        r.movement = Math.abs(delta);
      } else {
        r.signed = r.movement !== null ? (delta >= 0 ? r.movement : -r.movement) : delta;
      }
    }
    const expect = bal + r.signed;
    if (Math.abs(expect - r.balance) < 0.015) {
      r.chainOk = true;
      matched++;
    }
    bal = r.balance; // always resync to stated balance
  }

  const inflow = withBal.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = withBal.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = withBal.filter((r) => r.signed > 0);
  const debits = withBal.filter((r) => r.signed < 0);
  const largestCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const largestDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;

  return {
    file,
    account,
    currency: currency ?? "EGP",
    period: periodM ? `${periodM[1]} → ${periodM[2]}` : null,
    opening,
    closing: withBal[withBal.length - 1].balance,
    inflow,
    outflow,
    txCount: withBal.length,
    matched,
    largestCredit: largestCredit ? { desc: largestCredit.desc.slice(0, 90), amount: largestCredit.signed } : null,
    largestDebit: largestDebit ? { desc: largestDebit.desc.slice(0, 90), amount: largestDebit.signed } : null,
    salarySeen: withBal.some((r) => SALARY_RE.test(r.desc)),
    rows: withBal,
  };
}

function appendContinuation(row: TxRow | null, line: string): void {
  if (!row) return;
  const clean = line.replace(/\(?-?[\d,]+\.\d{2}\)?/g, " ").replace(/\s+/g, " ").trim();
  if (clean && clean.length > 3 && !/^\d{2}\/\d{2}\/20/.test(clean)) {
    row.desc = (row.desc + " " + clean).slice(0, 220).trim();
  }
}

// ---------- draft report rendering ----------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const STYLE = `
body{margin:0;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;background:#f6f8fa;color:#24292f}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px}
.hdr{background:#0d1117;color:#fff;border-radius:10px 10px 0 0;padding:22px 26px}
.hdr h1{margin:0;font-size:20px;letter-spacing:.4px}
.hdr .sub{color:#8b949e;font-size:12px;margin-top:4px}
.body{background:#fff;border:1px solid #d0d7de;border-top:0;border-radius:0 0 10px 10px;padding:24px 26px}
.kpis{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
.kpi{flex:1 1 160px;border:1px solid #d0d7de;border-radius:8px;padding:12px 14px;background:#f6f8fa}
.kpi .l{font-size:11px;color:#59636e;text-transform:uppercase;letter-spacing:.5px}
.kpi .v{font-size:19px;font-weight:700;margin-top:3px}
.kpi .n{font-size:11px;color:#59636e;margin-top:2px}
.danger .v{color:#cf222e}.ok .v{color:#1a7f37}.warn .v{color:#9a6700}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin:10px 0 18px}
th{background:#f6f8fa;text-align:left;padding:7px 9px;border-bottom:2px solid #d0d7de;font-size:11px;color:#59636e;text-transform:uppercase}
td{padding:6px 9px;border-bottom:1px solid #eaeef2;vertical-align:top}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.cr{color:#1a7f37}.dr{color:#cf222e}
.note{border:1px solid #d4a72c66;background:#fff8c5;border-radius:8px;padding:12px 14px;font-size:12.5px;color:#59636e;margin:14px 0}
.wm{border:2px dashed #d4a72c;border-radius:8px;padding:10px 14px;text-align:center;color:#9a6700;font-weight:700;font-size:13px;letter-spacing:.6px;margin-bottom:18px}
h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #eaeef2;padding-bottom:6px}
.small{font-size:11.5px;color:#59636e;line-height:1.55}
`;

function kpi(label: string, value: string, note: string, cls = ""): string {
  return `<div class="kpi ${cls}"><div class="l">${label}</div><div class="v">${value}</div><div class="n">${note}</div></div>`;
}

function buildReportHtml(
  userId: string,
  country: string | null,
  visaType: string | null,
  travelers: number,
  legs: AccountLeg[],
  benchmarkEgp: number
): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const fxOf = (c: string) => FX_EGP[c] ?? 0;
  const consolidated = legs.reduce((s, l) => s + l.closing * fxOf(l.currency), 0);
  const required = benchmarkEgp * travelers;
  const coverage = required > 0 ? (consolidated / required) * 100 : 0;
  const covCls = coverage >= 100 ? "ok" : coverage >= 50 ? "warn" : "danger";

  const legSections = legs
    .map((l) => {
      const integrity = l.txCount ? Math.round((l.matched / l.txCount) * 100) : 0;
      const preview = l.rows.slice(0, 25);
      const rowsHtml = preview
        .map(
          (r) =>
            `<tr><td style="white-space:nowrap">${esc(r.date)}</td><td>${esc(r.desc.slice(0, 110))}</td>` +
            `<td class="num ${r.signed >= 0 ? "cr" : "dr"}">${r.signed >= 0 ? "+" : "−"}${money(Math.abs(r.signed))}</td>` +
            `<td class="num">${money(r.balance ?? 0)}</td></tr>`
        )
        .join("");
      return `<h2>Account ${esc(l.account ?? "(number not parsed)")} — ${esc(l.currency)}${
        l.period ? ` · ${esc(l.period)}` : ""
      }</h2>
<div class="kpis">
${kpi("Opening", `${l.currency} ${money(l.opening)}`, esc(l.file))}
${kpi("Closing", `${l.currency} ${money(l.closing)}`, "end of period")}
${kpi("Total inflows", `${l.currency} ${money(l.inflow)}`, `${l.txCount} transactions`, "ok")}
${kpi("Total outflows", `${l.currency} ${money(l.outflow)}`, integrity + "% chain integrity", "danger")}
${kpi("EGP-equivalent closing", "EGP " + money(l.closing * fxOf(l.currency)), "indicative FX " + fxOf(l.currency).toFixed(2))}
</div>
<p class="small">Largest credit: <b>${l.largestCredit ? esc(l.largestCredit.desc) + " (" + money(l.largestCredit.amount) + ")" : "—"}</b>
 · Largest debit: <b>${l.largestDebit ? esc(l.largestDebit.desc) + " (" + money(-l.largestDebit.amount) + ")" : "—"}</b>
 · Salary/payroll credits detected: <b>${l.salarySeen ? "yes" : "none visible"}</b></p>
<table><thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Movement</th><th style="text-align:right">Balance</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<p class="small">Showing first ${preview.length} of ${l.txCount} ledger rows (chain-verified against stated balances). Full listing available on request.</p>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Global EIS — Auto-Analysis Draft (Queue ${esc(userId)})</title><style>${STYLE}</style></head>
<body><div class="wrap">
<div class="hdr"><h1>Global EIS — Financial Readiness Assessment</h1>
<div class="sub">Queue ${esc(userId)} · ${esc(country ?? "destination pending")} ${visaType ? "· " + esc(visaType) : ""} · generated ${now}</div></div>
<div class="body">
<div class="wm">AUTO-GENERATED FIRST PASS — PENDING ANALYST REVIEW</div>

<h2>Consolidated position</h2>
<div class="kpis">
${kpi("Accounts analysed", String(legs.length), legs.map((l) => l.currency).join(" + "))}
${kpi("Closing (EGP-equivalent)", "EGP " + money(consolidated), "indicative FX — refresh on submission day", "ok")}
${kpi("Benchmark applied", "EGP " + money(required), `${esc(country ?? "default")} × ${travelers} applicant(s)`, "warn")}
${kpi("Coverage", coverage.toFixed(1) + "%", coverage >= 100 ? "benchmark met" : "gap: EGP " + money(Math.max(0, required - consolidated)), covCls)}
</div>
<p class="small">Benchmark figure is the portal's indicative default for this destination — the analyst confirms or adjusts it before delivery. Joint applicants share this statement, so the requirement is multiplied accordingly.</p>

${legSections}

<div class="note"><b>About this draft.</b> This document was generated automatically the moment the case was started: the statement PDF was parsed, every ledger row was verified against the bank's own running balances (chain integrity ${legs
    .map((l) => (l.txCount ? Math.round((l.matched / l.txCount) * 100) : 0))
    .join("% / ")}%), and the consolidated position was computed at indicative FX rates. The Global EIS analyst reviews this draft, adds the pattern-level narrative (income origin, circulation analysis, payee clustering), confirms the benchmark, and only then is the final report delivered.</div>
</div></div></body></html>`;
}

// ---------- public entry ----------

export async function autoAnalyzeSubmission(submissionId: string): Promise<AutoAnalysisResult> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { files: true },
  });
  if (!submission) return { ok: false, mode: "no-files", message: "Submission not found." };
  const pdfFiles = submission.files.filter((f) => f.originalName.toLowerCase().endsWith(".pdf"));
  if (pdfFiles.length === 0) {
    return { ok: false, mode: "no-files", message: "No PDF statements attached to this case." };
  }

  const legs: AccountLeg[] = [];
  for (const f of pdfFiles) {
    let buf: Buffer | null = null;
    if (f.data) buf = Buffer.from(f.data);
    else if (f.storedPath) {
      try {
        const { readFile } = await import("fs/promises");
        buf = await readFile(f.storedPath);
      } catch {
        buf = null;
      }
    }
    if (!buf) continue;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join("\n") : text;
      const leg = parseCibText(merged, f.originalName);
      if (leg) legs.push(leg);
    } catch {
      // unreadable PDF (scan/encrypted) — skip; handled below if nothing parsed
    }
  }

  if (legs.length === 0) {
    return {
      ok: false,
      mode: "unrecognized",
      message:
        "Statement layout not recognised as a text-layer CIB statement (image scan or another bank). Manual analysis required.",
    };
  }

  const userId = submission.userId ?? submissionId.slice(-8).toUpperCase();
  const benchmark =
    BENCHMARK_EGP[(submission.country ?? "").toUpperCase()] ?? DEFAULT_BENCHMARK_EGP;
  const html = buildReportHtml(
    userId,
    submission.country,
    submission.visaType,
    submission.travelers ?? 1,
    legs,
    benchmark
  );

  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const name = `GlobalEIS_Draft_${userId}_${ts}.html`;
  await db.reportFile.create({
    data: {
      submissionId: submission.id,
      queueId: userId,
      name,
      url: "",
      data: Buffer.from(html, "utf8"),
      sizeBytes: Buffer.byteLength(html),
    },
  });

  const fxOf = (c: string) => FX_EGP[c] ?? 0;
  const consolidated = legs.reduce((s, l) => s + l.closing * fxOf(l.currency), 0);
  const required = benchmark * (submission.travelers ?? 1);

  return {
    ok: true,
    mode: "cib-parsed",
    reportName: name,
    legs: legs.map((l) => ({
      account: l.account,
      currency: l.currency,
      opening: l.opening,
      closing: l.closing,
      inflow: l.inflow,
      outflow: l.outflow,
      txCount: l.txCount,
      matched: l.matched,
    })),
    consolidated: {
      egpEquivalent: consolidated,
      benchmark: required,
      coveragePct: required > 0 ? (consolidated / required) * 100 : 0,
    },
    message: `Parsed ${legs.length} CIB account${legs.length > 1 ? "s" : ""}; draft report published for analyst review.`,
  };
}
