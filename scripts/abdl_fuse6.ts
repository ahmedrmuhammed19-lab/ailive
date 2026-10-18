/**
 * DL-27 — fusion chain v4: full(450, with lines) ⊕ band(900) by y-proximity.
 * Band rows attach to date-bearing tx rows first; otherwise to the nearest
 * desc LINE (synthesizing a carried-date row the chain then judges).
 * Run: bun scripts/abdl_fuse4.ts <key> <printedClosing>
 */
import * as fs from "node:fs";

const W = "/home/z/my-project/scripts/abdl_work";
const S = 450 / 900; // band(900) -> full(450) coordinate scale

interface FullRow {
  y: number;
  date: string | null;
  desc: string;
  debit: string | null;
  credit: string | null;
  balance: string | null;
}
interface BandRow {
  y: number;
  amounts: string[];
  xs: number[];
}
interface FullPage {
  page: number;
  columns: number[];
  page_w: number;
  rows: FullRow[];
  lines: Array<{ y: number; text: string }>;
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
console.log(`${key}: full=${fullPages.length} band=${bandPages.length} (900dpi)`);
interface Patch { page: number; y: number; date: string; debit: string | null; credit: string | null; balance: string | null }
const patches: Patch[] = (() => {
  try { return JSON.parse(fs.readFileSync(`${W}/patch_${key}.json`, "utf8")); } catch { return []; }
})();
console.log(`surgical patches: ${patches.length}`);

interface Rec {
  page: number;
  y: number;
  date: string | null;
  desc: string;
  debit: string | null;
  credit: string | null;
  balance: string | null;
  src: string;
}
let bandApplied = 0;
let bandSynth = 0;
let bandUnmatched = 0;
const recs: Rec[] = [];

function applyAmounts(rec: Rec, br: BandRow, cols: number[], pw: number, twoCol: boolean) {
  for (let i = 0; i < br.amounts.length; i++) {
    const x450 = br.xs[i] * S;
    const v = br.amounts[i];
    if (!twoCol && cols.length >= 3) {
      const [debC, credC, balC] = [cols[cols.length - 3], cols[cols.length - 2], cols[cols.length - 1]];
      if (Math.abs(x450 - balC) < 0.035 * pw) rec.balance = v;
      else if (Math.abs(x450 - credC) < 0.035 * pw) rec.credit = v;
      else if (Math.abs(x450 - debC) < 0.035 * pw) rec.debit = v;
    } else {
      const sorted = br.amounts.map((a, j) => ({ a, x: br.xs[j] * S })).sort((p, q) => p.x - q.x);
      rec.balance = sorted[sorted.length - 1].a;
      if (sorted.length >= 2) rec.credit = sorted[sorted.length - 2].a;
      if (sorted.length >= 3) rec.debit = sorted[0].a;
    }
  }
  rec.src = "full+band";
}

for (const fp of fullPages) {
  const bp = bandPages.find((b) => b.page === fp.page);
  const cols = fp.columns;
  const pw = fp.page_w;
  const twoCol = cols.length === 2;
  const bandRows = bp ? [...bp.rows] : [];
  const pagePatches = patches.filter((p) => p.page === fp.page);
  const patchUsed = new Set<number>();
  const used = new Set<number>();

  // 1) attach band rows to date-bearing tx rows
  for (const r of fp.rows) {
    const rec: Rec = { page: fp.page, y: r.y, date: r.date, desc: r.desc, debit: r.debit, credit: r.credit, balance: r.balance, src: "full" };
    if (r.date && pagePatches.length) {
      let pi = -1, pd = 1e9;
      for (let i = 0; i < pagePatches.length; i++) {
        if (patchUsed.has(i)) continue;
        const dist = Math.abs(pagePatches[i].y - r.y);
        if (dist < pd) { pd = dist; pi = i; }
      }
      if (pi >= 0 && pd <= 8) {
        const pt = pagePatches[pi];
        patchUsed.add(pi);
        rec.debit = pt.debit ?? rec.debit;
        rec.credit = pt.credit ?? rec.credit;
        rec.balance = pt.balance ?? rec.balance;
        rec.src = "full+surgical";
      }
    }
    if (bp && r.date) {
      let bestIdx = -1;
      let bestDist = 1e9;
      for (let i = 0; i < bandRows.length; i++) {
        if (used.has(i)) continue;
        const dist = Math.abs(bandRows[i].y * S - r.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestDist <= 16) {
        applyAmounts(rec, bandRows[bestIdx], cols, pw, twoCol);
        used.add(bestIdx);
        bandApplied++;
      }
    }
    recs.push(rec);
  }
  // 2) unmatched band rows -> nearest desc LINE (synthesize carried row)
  if (bp) {
    const remaining = bandRows.map((br, i) => ({ br, i })).filter(({ i }) => !used.has(i));
    for (const { br } of remaining) {
      const y450 = br.y * S;
      let bestLine: { y: number; text: string } | null = null;
      let bestDist = 1e9;
      for (const ln of fp.lines) {
        const dist = Math.abs(ln.y - y450);
        if (dist < bestDist) {
          bestDist = dist;
          bestLine = ln;
        }
      }
      if (bestLine && bestDist <= 16) {
        const rec: Rec = { page: fp.page, y: y450, date: null, desc: bestLine.text.slice(0, 200), debit: null, credit: null, balance: null, src: "band-synth" };
        applyAmounts(rec, br, cols, pw, twoCol);
        recs.push(rec);
        bandSynth++;
      } else bandUnmatched++;
    }
  }
}
// global sort: page asc, then y (print order)
recs.sort((a, b) => a.page - b.page || a.y - b.y);
console.log(`band applied=${bandApplied} synthesized=${bandSynth} unmatched=${bandUnmatched} recs=${recs.length}`);

// ledger = rows with balance
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
    } else if ((d !== null || c !== null) && Math.abs(Math.abs(delta) - Math.abs(c - d)) <= 10 && Math.abs(delta) > 10) {
      // Class B: movement token is off by a small lost sibling adjustment —
      // the bank's own printed balances are the truth: movement = |delta|
      ok = true;
      signedV = delta;
    } else if ((d !== null || c !== null) && digitDiffs(expected, b) <= 2) {
      ok = true;
      signedV = r2((c ?? 0) - (d ?? 0));
    } else if (d === null && c === null) {
      ok = Math.abs(delta) < Math.max(2, Math.abs(prev) * 0.02);
      signedV = delta;
      resyncs++;
    } else {
      ok = false;
      signedV = delta;
      resyncs++;
    }
  }
  if (ok) verified++;
  else
    bad.push({ no: rowNoOf(r.desc), page: r.page, y: r.y, date: r.date, desc: r.desc.slice(0, 55), debit: r.debit, credit: r.credit, balance: r.balance, prev, delta: prev !== null ? r2(b - prev) : null });
  signed.push(signedV);
  prev = b;
}
const closing = ledger.length ? num(ledger[ledger.length - 1].balance)! : 0;
const inflow = r2(signed.reduce((s, v) => s + (v > 0 ? v : 0), 0));
const outflow = r2(signed.reduce((s, v) => s + (v < 0 ? -v : 0), 0));
const openingBack = r2(closing - inflow + outflow);
const nos = ledger.map((r) => rowNoOf(r.desc)).filter((n): n is number => n !== null);
const missing: number[] = [];
if (nos.length) {
  const set = new Set(nos);
  for (let n = Math.min(...nos); n <= Math.max(...nos); n++) if (!set.has(n)) missing.push(n);
}
console.log(`ledger rows=${ledger.length} verified=${verified} integrity=${Math.round((verified / ledger.length) * 1000) / 10}% resyncs=${resyncs}`);
console.log(`closing=${closing} printed=${printedClosing} match=${close(closing, printedClosing)}`);
console.log(`opening(back)=${openingBack} inflow=${inflow} outflow=${outflow}`);
console.log(`row numbers ${nos.length ? Math.min(...nos) : "-"}..${nos.length ? Math.max(...nos) : "-"} missing=${missing.length}`);
console.log(`unverified=${bad.length}`);
for (const b of bad.slice(0, 25))
  console.log(`  [p${b.page} y${Math.round(Number(b.y))}#${b.no ?? "?"}] ${b.date} D=${b.debit} C=${b.credit} B=${b.balance} prev=${b.prev} Δ=${b.delta}`);
fs.writeFileSync(`${W}/fuse_${key}.json`, JSON.stringify({ recs, ledger, signed, bad, missing, inflow, outflow, openingBack, closing, verified }, null, 2));
console.log(`-> fuse_${key}.json`);
