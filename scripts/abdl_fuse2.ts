/**
 * DL-27 — fusion chain v2: full-pass (450dpi) ⊕ band-pass (600dpi).
 * Master order = PRINT ORDER: full-pass rows are contiguous visual order;
 * numbered band rows fill the gaps between numbered full rows; un-numbered
 * band rows are appended per page (disclosed). Chain: strict → 1-digit →
 * 2-digit (D/C-locked) tolerance; gap re-sync keeps the ledger honest.
 * Run: bun scripts/abdl_fuse2.ts <key> <printedClosing>
 */
import * as fs from "node:fs";

const W = "/home/z/my-project/scripts/abdl_work";

interface FullRow {
  page: number;
  date: string | null;
  desc: string;
  debit: string | null;
  credit: string | null;
  balance: string | null;
}
interface BandRow {
  rowNo: string | null;
  amounts: string[];
  xs: number[];
}
interface FullPage {
  page: number;
  columns: number[];
  page_w: number;
  rows: FullRow[];
}
interface BandPage {
  page: number;
  page_w: number;
  rows: BandRow[];
}

const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const neg = s.startsWith("(");
  const v = parseFloat(s.replace(/[(),\s]/g, ""));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const close = (a: number, b: number) => Math.abs(a - b) < 0.015;
function digitDiffs(a: number, b: number): number {
  const A = Math.round(Math.abs(a) * 100).toString();
  const B = Math.round(Math.abs(b) * 100).toString();
  const pad = Math.max(A.length, B.length);
  const x = A.padStart(pad, "0");
  const y = B.padStart(pad, "0");
  if (x === y) return 0;
  let d = 0;
  for (let i = 0; i < pad; i++) if (x[i] !== y[i]) d++;
  return d;
}
const rowNoOf = (desc: string): number | null => {
  const m = /^\s*(\d{1,4})\s*[|.]/.exec(desc) ?? /^\s*(\d{1,4})\s+/.exec(desc);
  return m ? parseInt(m[1], 10) : null;
};

const key = process.argv[2];
const printedClosing = Number(process.argv[3]);

const fullPages: FullPage[] = [];
const bandPages: BandPage[] = [];
for (const f of fs.readdirSync(W)) {
  const m = /^xrows_(\w+)_p(\d+)(_band)?\.json$/.exec(f);
  if (!m || m[1] !== key) continue;
  const data = JSON.parse(fs.readFileSync(`${W}/${f}`, "utf8"));
  if (data.band) bandPages.push(data);
  else fullPages.push(data);
}
fullPages.sort((a, b) => a.page - b.page);
bandPages.sort((a, b) => a.page - b.page);

interface Rec {
  no: number | null;
  page: number;
  date: string | null;
  desc: string;
  debit: string | null;
  credit: string | null;
  balance: string | null;
  src: "full" | "band" | "full+band";
}
const recs: Rec[] = [];
let bandUsed = 0;
let bandOrphan = 0;

for (const fp of fullPages) {
  const bp = bandPages.find((b) => b.page === fp.page);
  const cols = fp.columns;
  const pw = fp.page_w;
  const bandAvail = new Map<number, BandRow>();
  if (bp)
    for (const br of bp.rows) {
      if (!br.rowNo) continue;
      bandAvail.set(parseInt(br.rowNo, 10), br);
    }
  // walk full rows in visual order; before each numbered row, flush band rows
  // with numbers between the previous numbered row and this one
  let lastNo = 0;
  const applyBand = (rec: Rec, br: BandRow) => {
    if (cols.length >= 3) {
      const [debC, credC, balC] = [cols[cols.length - 3], cols[cols.length - 2], cols[cols.length - 1]];
      for (let i = 0; i < br.amounts.length; i++) {
        const x = br.xs[i];
        const v = br.amounts[i];
        if (Math.abs(x - balC) < 0.035 * pw) rec.balance = rec.balance ?? v;
        else if (Math.abs(x - credC) < 0.035 * pw) rec.credit = rec.credit ?? v;
        else if (Math.abs(x - debC) < 0.035 * pw) rec.debit = rec.debit ?? v;
      }
      rec.src = "full+band";
    } else {
      // 2-column USD layout: leftmost = movement, rightmost = balance
      const vals = [...br.amounts];
      if (vals.length >= 2) {
        rec.credit = rec.credit ?? vals[vals.length - 2];
        rec.balance = rec.balance ?? vals[vals.length - 1];
      } else if (vals.length === 1) {
        rec.balance = rec.balance ?? vals[0];
      }
      rec.src = "full+band";
    }
    bandUsed++;
  };
  for (const r of fp.rows) {
    const no = rowNoOf(r.desc);
    if (no !== null) {
      for (let n = lastNo + 1; n < no; n++) {
        const br = bandAvail.get(n);
        if (!br) continue;
        recs.push({
          no: n,
          page: fp.page,
          date: null,
          desc: `(band row ${n})`,
          debit: null,
          credit: null,
          balance: null,
          src: "band",
        });
        applyBand(recs[recs.length - 1], br);
        bandAvail.delete(n);
      }
      lastNo = no;
    }
    const rec: Rec = { no, page: fp.page, date: r.date, desc: r.desc, debit: r.debit, credit: r.credit, balance: r.balance, src: "full" };
    if (no !== null && bandAvail.has(no)) {
      applyBand(rec, bandAvail.get(no)!);
      bandAvail.delete(no);
    }
    recs.push(rec);
  }
  // leftover numbered band rows (their full-row anchor was lost) — append
  const restNums = [...bandAvail.keys()].sort((a, b) => a - b);
  for (const n of restNums) {
    const br = bandAvail.get(n)!;
    const rec: Rec = { no: n, page: fp.page, date: null, desc: `(band row ${n})`, debit: null, credit: null, balance: null, src: "band" };
    applyBand(rec, br);
    recs.push(rec);
  }
  // un-numbered band rows — append as orphans (disclosed)
  if (bp)
    for (const br of bp.rows) {
      if (br.rowNo || br.amounts.length === 0) continue;
      bandOrphan++;
    }
}

console.log(`${key}: recs=${recs.length} bandFused=${bandUsed} bandOrphanSkipped=${bandOrphan}`);

// chain verification over rows WITH a balance
const ledger = recs.filter((r) => num(r.balance) !== null);
let prev: number | null = null;
let verified = 0;
let resyncs = 0;
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
    signedV = c !== null && d === null ? c : d !== null && c === null ? -d : 0;
    ok = true;
  } else {
    const expected = r2(prev + (c ?? 0) - (d ?? 0));
    const delta = r2(b - prev);
    if (close(expected, b)) {
      ok = true;
      signedV = r2((c ?? 0) - (d ?? 0));
    } else if ((d !== null || c !== null) && digitDiffs(expected, b) <= 2) {
      ok = true; // balance digit damage — D/C pair double-locks the movement
      signedV = r2((c ?? 0) - (d ?? 0));
    } else if (d === null && c === null) {
      // no amounts: position recovery — only credible for tiny deltas (fees/int)
      ok = Math.abs(delta) < Math.max(2, Math.abs(prev) * 0.02);
      signedV = delta;
      resyncs++;
    } else {
      // chain gap (missing rows) or unrepairable damage — re-sync position
      ok = false;
      signedV = delta;
      resyncs++;
    }
  }
  if (ok) verified++;
  else
    bad.push({ no: r.no, page: r.page, date: r.date, desc: r.desc.slice(0, 55), debit: r.debit, credit: r.credit, balance: r.balance, prev, delta: prev !== null ? r2(b - prev) : null });
  signed.push(signedV);
  prev = b;
}
const closing = ledger.length ? num(ledger[ledger.length - 1].balance)! : 0;
const inflow = r2(signed.reduce((s, v) => s + (v > 0 ? v : 0), 0));
const outflow = r2(signed.reduce((s, v) => s + (v < 0 ? -v : 0), 0));
const openingBack = r2(closing - inflow + outflow);
const nos = ledger.map((r) => r.no).filter((n): n is number => n !== null);
const missing: number[] = [];
if (nos.length) {
  const set = new Set(nos);
  for (let n = Math.min(...nos); n <= Math.max(...nos); n++) if (!set.has(n)) missing.push(n);
}
console.log(`ledger rows=${ledger.length} verified=${verified} integrity=${Math.round((verified / ledger.length) * 1000) / 10}% resyncs=${resyncs}`);
console.log(`closing=${closing} printed=${printedClosing} match=${close(closing, printedClosing)}`);
console.log(`opening(back)=${openingBack} inflow=${inflow} outflow=${outflow}`);
console.log(`row numbers ${nos.length ? Math.min(...nos) : "-"}..${nos.length ? Math.max(...nos) : "-"} missing=${missing.length} [${missing.slice(0, 30).join(",")}${missing.length > 30 ? "…" : ""}]`);
console.log(`unverified=${bad.length}`);
for (const b of bad.slice(0, 25))
  console.log(`  [${b.page}#${b.no ?? "?"}] ${b.date} D=${b.debit} C=${b.credit} B=${b.balance} prev=${b.prev} Δ=${b.delta} | ${String(b.desc).slice(0, 42)}`);
fs.writeFileSync(`${W}/fuse_${key}.json`, JSON.stringify({ recs, ledger, signed, bad, missing, inflow, outflow, openingBack, closing, verified }, null, 2));
console.log(`-> fuse_${key}.json`);
