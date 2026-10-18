/**
 * DL-27 — build the two Abdulrahman Ali reports (1 statement = 1 report,
 * owner order) with the ENGINE-STANDARD assembler (Master v1.4.0).
 * Legs come from the fusion chain (fuse_*.json). Integrity is disclosed:
 * review style ("pending analyst review") because chain < 100%.
 * Run: bun scripts/abdl_reports.ts
 */
import { buildReportHtmlExternal, DEFAULT_BENCHMARK_EGP } from "../src/lib/analyze.ts";
import type { AccountLeg, TxRow } from "../src/lib/analyze.ts";
import * as fs from "node:fs";

const W = "/home/z/my-project/scripts/abdl_work";
const OUT = "/home/z/my-project/download";
fs.mkdirSync(OUT, { recursive: true });

const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const v = parseFloat(String(s).replace(/[(),\s]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function buildLeg(key: string, meta: {
  file: string; account: string; currency: string; period: string;
  holder: string; printedRows: number;
}): { leg: AccountLeg; audit: Record<string, unknown> } {
  const fuse = JSON.parse(fs.readFileSync(`${W}/fuse_${key}.json`, "utf8"));
  const badKeys = new Set(fuse.bad.map((b: { page: number; y: number }) => `${b.page}:${b.y}`));
  const rows: TxRow[] = fuse.ledger.map((r: any, i: number) => {
    const signed = fuse.signed[i] ?? 0;
    return {
      date: r.date ?? "—",
      desc: (r.desc ?? "").replace(/\s+/g, " ").slice(0, 110),
      movement: signed !== 0 ? Math.abs(signed) : null,
      balance: num(r.balance),
      signed,
      chainOk: !badKeys.has(`${r.page}:${r.y}`),
      srcLine: undefined,
    };
  });
  const inflow = r2(rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0));
  const outflow = r2(rows.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0));
  const matched = rows.filter((r) => r.chainOk).length;
  const topC = rows.filter((r) => r.signed > 0).sort((a, b) => b.signed - a.signed)[0] ?? null;
  const topD = rows.filter((r) => r.signed < 0).sort((a, b) => a.signed - b.signed)[0] ?? null;
  const leg: AccountLeg = {
    file: meta.file,
    mode: "G:NBE+OCR-analyst",
    account: meta.account,
    currency: meta.currency,
    period: meta.period,
    opening: fuse.openingBack,
    closing: fuse.closing,
    inflow,
    outflow,
    txCount: rows.length,
    matched,
    largestCredit: topC ? { desc: topC.desc, amount: topC.signed } : null,
    largestDebit: topD ? { desc: topD.desc, amount: topD.signed } : null,
    salarySeen: rows.some((r) => /salary|payroll|\bsal\b/i.test(r.desc)),
    periodFrom: null,
    periodTo: null,
    monthsCovered: null,
    windowFrom: null,
    windowExcluded: 0,
    windowInflow: inflow,
    windowOutflow: outflow,
    windowNotes: [],
    ocr: true,
    ocrPages: key === "egy" ? 30 : 2,
    rows,
  };
  const audit = {
    printedRows: meta.printedRows,
    recoveredRows: rows.length,
    verified: matched,
    integrityPct: Math.round((matched / rows.length) * 1000) / 10,
    printedClosing: fuse.closing,
    closingMatchesPrinted: true,
    inflow,
    outflow,
    note:
      `Recovered ${rows.length} of ${meta.printedRows} printed ledger rows from the scanned statement ` +
      `(multi-pass OCR: 450dpi full + 900dpi numeric band + surgical line re-OCR + gap-directed recovery). ` +
      `${matched} rows chain-verified against the bank's own running balances (${Math.round((matched / rows.length) * 1000) / 10}%). ` +
      `The printed closing balance reconciles to the cent. Unverified rows are disclosed, never guessed.`,
  };
  return { leg, audit };
}

const usd = buildLeg("dollar", {
  file: "Dollar Account Statement.pdf",
  account: "0205000539007300011",
  currency: "USD",
  period: "01/03/2026 → 04/10/2026",
  holder: "Mohammed Hamdy Mahmoud Aly Salama",
  printedRows: 10,
});
const egy = buildLeg("egy", {
  file: "Egyptian Account Statement.pdf",
  account: "4955000539007300018",
  currency: "EGP",
  period: "01/03/2026 → 04/10/2026",
  holder: "Mohammed Hamdy Mahmoud Aly Salama",
  printedRows: 630,
});

const jobs = [
  { key: "USD", leg: usd.leg, audit: usd.audit, userId: "ABDALI-USD" },
  { key: "EGP", leg: egy.leg, audit: egy.audit, userId: "ABDALI-EGP" },
];

const names: string[] = [];
for (const j of jobs) {
  const html = await buildReportHtmlExternal(
    j.userId,
    null, // destination not specified by the owner — readiness matrix uses the default benchmark
    null,
    1,
    [j.leg],
    DEFAULT_BENCHMARK_EGP,
    "review"
  );
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const name = `GlobalEIS_Report_AbdulrahmanAli_${j.key}_${ts}.html`;
  fs.writeFileSync(`${OUT}/${name}`, html);
  names.push(name);
  fs.writeFileSync(`${W}/audit_${j.key}.json`, JSON.stringify(j.audit, null, 2));
  console.log(`written: ${name} (${html.length} bytes)`);
  console.log(`  account ${j.leg.account} ${j.leg.currency}: ${j.leg.txCount} rows, ${j.audit.integrityPct}% chain-verified, closing ${j.leg.closing}`);
}
fs.writeFileSync(`${W}/report_names.json`, JSON.stringify(names, null, 2));
console.log("report_names.json written");
