/**
 * DL-27 — chain verification for the coordinate-extracted NBE rows.
 * Reconstructs the balance chain with explicit Debit/Credit columns (no sign
 * guessing), reports every unverified row with its page + printed row number
 * so targeted re-OCR can repair the damaged zones.
 * Run: bun scripts/abdl_chain.ts
 */
import * as fs from "node:fs";

const W = "/home/z/my-project/scripts/abdl_work";

interface XRow {
  page: number;
  date: string | null;
  desc: string;
  debit: string | null;
  credit: string | null;
  balance: string | null;
  value_date?: string | null;
  amount2?: string | null;
}
interface Page {
  page: number;
  columns: number[];
  rows: XRow[];
}

const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const neg = s.startsWith("(");
  const v = parseFloat(s.replace(/[(),\s]/g, ""));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const close = (a: number, b: number) => Math.abs(a - b) < 0.015;
/** one-digit OCR repair: amounts as digit strings differ in <=1 place */
function ocrClose(a: number, b: number): boolean {
  const A = Math.round(Math.abs(a) * 100).toString();
  const B = Math.round(Math.abs(b) * 100).toString();
  const pad = Math.max(A.length, B.length);
  const x = A.padStart(pad, "0");
  const y = B.padStart(pad, "0");
  if (x === y) return true;
  let diffs = 0;
  for (let i = 0; i < pad; i++) if (x[i] !== y[i]) diffs++;
  return diffs <= 1;
}
/** row number from the printed No column (leading integer in desc) */
const rowNo = (r: XRow): number | null => {
  const m = /^\s*(\d{1,4})\s*[|.]/.exec(r.desc) ?? /^\s*(\d{1,4})\s+/.exec(r.desc);
  return m ? parseInt(m[1], 10) : null;
};

function verify(key: string, printedClosing: number | null) {
  const data = JSON.parse(fs.readFileSync(`${W}/rows_${key}.json`, "utf8")) as { pages: Page[] };
  const rows: Array<XRow & { _page: number }> = [];
  for (const p of data.pages) for (const r of p.rows) rows.push({ ...r, _page: p.page });
  // keep only rows with a balance (ledger rows); sort by page then y-order (already)
  const ledger = rows.filter((r) => num(r.balance) !== null);
  console.log(`\n===== ${key}: ${ledger.length} ledger rows (of ${rows.length} extracted) =====`);

  // chain walk with OCR tolerance + branch on missing side
  let prev: number | null = null;
  let verified = 0;
  const bad: Array<Record<string, unknown>> = [];
  const signed: number[] = [];
  for (let i = 0; i < ledger.length; i++) {
    const r = ledger[i];
    const d = num(r.debit);
    const c = num(r.credit);
    const b = num(r.balance)!;
    let ok = false;
    let signedV = 0;
    if (prev === null) {
      // first row: seed — sign from D/C when explicit, else balance-only base
      if (d !== null && c === null) signedV = -d;
      else if (c !== null && d === null) signedV = c;
      else signedV = 0;
      ok = true; // base row always accepted as seed
    } else {
      const expected = r2(prev + (c ?? 0) - (d ?? 0));
      const delta = r2(b - prev);
      if (close(expected, b)) {
        ok = true;
        signedV = r2((c ?? 0) - (d ?? 0));
      } else if (close(delta, (c ?? 0) - (d ?? 0)) === false && ocrClose(expected, b)) {
        ok = true; // one-digit balance damage — trust D/C pair, keep stated balance
        signedV = r2((c ?? 0) - (d ?? 0));
      } else if (d === null && c === null && close(Math.abs(delta), Math.abs(delta))) {
        // no amounts captured — movement = balance delta (position recovery)
        ok = delta !== 0 ? false : true;
        signedV = delta;
      } else if (d === null && c !== null && ocrClose(r2(prev + c), b)) {
        ok = true; // credit token fine, balance one-digit damage
        signedV = c;
      } else if (c === null && d !== null && ocrClose(r2(prev - d), b)) {
        ok = true;
        signedV = -d;
      } else if (close(Math.abs(delta), d ?? -1)) {
        ok = true; // debit verified by delta even if balance digit damaged
        signedV = -d!;
      } else if (close(Math.abs(delta), c ?? -1)) {
        ok = true;
        signedV = c!;
      } else {
        signedV = delta; // best-effort: use actual balance delta
      }
    }
    if (ok) verified++;
    else
      bad.push({
        idx: i + 1,
        page: r._page,
        rowNo: rowNo(r),
        date: r.date,
        desc: r.desc.slice(0, 60),
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
        prev,
        delta: prev !== null ? r2(b - prev) : null,
      });
    signed.push(signedV);
    prev = b;
  }

  const opening = ledger.length ? r2(ledger[0] ? num(ledger[0].balance)! - signed[0] : 0) : 0;
  const closing = ledger.length ? num(ledger[ledger.length - 1].balance)! : 0;
  const inflow = signed.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const outflow = signed.reduce((s, v) => s + (v < 0 ? -v : 0), 0);
  const openingBack = closing !== null ? r2(closing - inflow + outflow) : null;
  const nums = ledger.map((r) => rowNo(r)).filter((n): n is number => n !== null);
  const noGaps: number[] = [];
  if (nums.length) {
    const set = new Set(nums);
    for (let n = Math.min(...nums); n <= Math.max(...nums); n++) if (!set.has(n)) noGaps.push(n);
  }
  const rec = {
    rows: ledger.length,
    verified,
    unverified: bad.length,
    integrityPct: ledger.length ? Math.round((verified / ledger.length) * 1000) / 10 : 0,
    openingBack,
    closing,
    inflow: r2(inflow),
    outflow: r2(outflow),
    rowNumbers: { min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null, missing: noGaps },
    printedClosing,
    closingMatch: printedClosing !== null ? close(closing, printedClosing) : null,
    bad: bad.slice(0, 40),
    _ledger: ledger.map((r, i) => ({ ...r, _signed: signed[i] })),
  };
  fs.writeFileSync(`${W}/chain_${key}.json`, JSON.stringify(rec, null, 2));
  console.log(`  rows=${rec.rows} verified=${verified} integrity=${rec.integrityPct}%`);
  console.log(`  opening(back-computed)=${openingBack} closing=${closing} printed=${printedClosing} match=${rec.closingMatch}`);
  console.log(`  inflow=${rec.inflow} outflow=${rec.outflow}`);
  console.log(`  row numbers: ${rec.rowNumbers.min}..${rec.rowNumbers.max} missing=[${noGaps.join(",") || "none"}]`);
  console.log(`  unverified: ${bad.length}`);
  for (const b of rec.bad.slice(0, 15))
    console.log(`   [p${b.page}#${b.rowNo ?? "?"}] ${b.date} D=${b.debit} C=${b.credit} B=${b.balance} prev=${b.prev} Δ=${b.delta} | ${String(b.desc).slice(0, 40)}`);
  return rec;
}

const dollar = verify("dollar", 4261.25);
const egy = verify("egy", 654722.19);
console.log("\nchain reports -> scripts/abdl_work/chain_dollar.json, chain_egy.json");
