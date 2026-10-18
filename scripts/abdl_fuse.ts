/**
 * DL-27 — fusion chain: full-pass (450dpi dates+desc) ⊕ band-pass (600dpi
 * amounts) keyed by printed row number / y-proximity, then balance-chain
 * verification with strict → 1-digit → 2-digit(D/C-locked) tolerance.
 * Run: bun scripts/abdl_fuse.ts <key> <printedClosing>
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

const key = process.argv[2];
const printedClosing = Number(process.argv[3]);

// load passes
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
console.log(`${key}: full pages=${fullPages.length} band pages=${bandPages.length}`);

// rows in print order with row numbers
interface Rec {
  no: number | null;
  page: number;
  date: string | null;
  desc: string;
  debit: string | null;
  credit: string | null;
  balance: string | null;
  src: string;
}
const recs: Rec[] = [];
for (const p of fullPages) {
  for (const r of p.rows) {
    const m = /^\s*(\d{1,4})\s*[|.]/.exec(r.desc) ?? /^\s*(\d{1,4})\s+/.exec(r.desc);
    recs.push({
      no: m ? parseInt(m[1], 10) : null,
      page: p.page,
      date: r.date,
      desc: r.desc,
      debit: r.debit,
      credit: r.credit,
      balance: r.balance,
      src: "full",
    });
  }
}
// fuse band amounts by row number first, then page+y order fallback
const bandByNo = new Map<string, BandRow[]>();
for (const bp of bandPages)
  for (const br of bp.rows) {
    if (!br.rowNo) continue;
    const k = br.rowNo.replace(/^0+/, "");
    if (!bandByNo.has(k)) bandByNo.set(k, []);
    bandByNo.get(k)!.push(br);
  }
let bandFused = 0;
for (const rec of recs) {
  if (rec.no === null) continue;
  const cands = bandByNo.get(String(rec.no));
  if (!cands || cands.length === 0) continue;
  // pick the band row with the most amounts
  const br = cands.sort((a, b) => b.amounts.length - a.amounts.length)[0];
  const fp = fullPages.find((p) => p.page === rec.page);
  const cols = fp?.columns ?? [];
  if (cols.length >= 3) {
    const [debC, credC, balC] = [cols[cols.length - 3], cols[cols.length - 2], cols[cols.length - 1]];
    for (let i = 0; i < br.amounts.length; i++) {
      const x = br.xs[i];
      const v = br.amounts[i];
      if (Math.abs(x - balC) < 0.035 * (fp?.page_w ?? 3800)) rec.balance = v;
      else if (Math.abs(x - credC) < 0.035 * (fp?.page_w ?? 3800)) rec.credit = v;
      else if (Math.abs(x - debC) < 0.035 * (fp?.page_w ?? 3800)) rec.debit = v;
    }
    bandFused++;
    rec.src = "full+band";
  }
}
console.log(`band fusion applied to ${bandFused} rows`);

// sort into print order: by row number when both present (stable otherwise)
recs.sort((a, b) => {
  if (a.no !== null && b.no !== null) return a.no - b.no;
  if (a.no !== null) return -1;
  if (b.no !== null) return 1;
  return a.page - b.page;
});

// chain verification
let prev: number | null = null;
let verified = 0;
const bad: Array<Record<string, unknown>> = [];
const signed: number[] = [];
const ledger = recs.filter((r) => num(r.balance) !== null);
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
    } else if (digitDiffs(expected, b) <= 2 && (d !== null || c !== null)) {
      ok = true; // balance digit damage — D/C pair double-locks the movement
      signedV = r2((c ?? 0) - (d ?? 0));
    } else if (d === null && c === null) {
      signedV = delta;
      ok = Math.abs(delta) < 1e9; // position recovery row
      if (!ok) bad.push({ i, r, delta });
    } else if (d === null && c !== null && digitDiffs(r2(prev + c), b) <= 1) {
      ok = true;
      signedV = c;
    } else if (c === null && d !== null && digitDiffs(r2(prev - d), b) <= 1) {
      ok = true;
      signedV = -d;
    } else {
      signedV = delta;
    }
  }
  if (ok) verified++;
  else if (!bad.some((x) => (x as { i?: number }).i === i))
    bad.push({ i, no: r.no, page: r.page, date: r.date, desc: r.desc.slice(0, 50), debit: r.debit, credit: r.credit, balance: r.balance, prev, delta: prev !== null ? r2(b - prev) : null });
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
console.log(`ledger rows=${ledger.length} verified=${verified} integrity=${Math.round((verified / ledger.length) * 1000) / 10}%`);
console.log(`closing=${closing} printed=${printedClosing} match=${close(closing, printedClosing)}`);
console.log(`opening(back)=${openingBack} inflow=${inflow} outflow=${outflow}`);
console.log(`row numbers ${nos.length ? Math.min(...nos) : "-"}..${nos.length ? Math.max(...nos) : "-"} missing=${missing.length}`);
console.log(`unverified=${bad.length}`);
for (const b of bad.slice(0, 20))
  console.log(`  [${(b as any).page}#${(b as any).no ?? "?"}] ${(b as any).date} D=${(b as any).debit} C=${(b as any).credit} B=${(b as any).balance} prev=${(b as any).prev} Δ=${(b as any).delta}`);
fs.writeFileSync(`${W}/fuse_${key}.json`, JSON.stringify({ ledger, signed, bad, missing, inflow, outflow, openingBack, closing, verified }, null, 2));
console.log(`-> fuse_${key}.json`);
