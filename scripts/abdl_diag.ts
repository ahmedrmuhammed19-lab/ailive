/**
 * DL-27 — unverified-row diagnostic: side-by-side sources (full / surgical
 * patch / 900 band) for every unverified row + chain context, so failure
 * classes can be fixed surgically.
 * Run: bun scripts/abdl_diag.ts <key>
 */
import * as fs from "node:fs";

const W = "/home/z/my-project/scripts/abdl_work";
const key = process.argv[2] ?? "egy";

interface Patch { page: number; y: number; date: string; debit: string | null; credit: string | null; balance: string | null }
interface BandRow { y: number; amounts: string[]; xs: number[] }
const fuse = JSON.parse(fs.readFileSync(`${W}/fuse_${key}.json`, "utf8"));
const patches: Patch[] = JSON.parse(fs.readFileSync(`${W}/patch_${key}.json`, "utf8"));
const bandByPage = new Map<number, BandRow[]>();
for (const f of fs.readdirSync(W)) {
  const m = /^xrows_(\w+)_p(\d+)_band\.json$/.exec(f);
  if (!m || m[1] !== key) continue;
  const d = JSON.parse(fs.readFileSync(`${W}/${f}`, "utf8"));
  bandByPage.set(d.page, d.rows);
}

const num = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const v = parseFloat(String(s).replace(/[(),\s]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const ledger = fuse.ledger;
const signed: number[] = fuse.signed;

// rebuild chain state to get prev for each bad row
let prev: number | null = null;
const prevByBadY = new Map<number, number>();
const badY = new Set(fuse.bad.map((b: { y: number }) => b.y));
for (let i = 0; i < ledger.length; i++) {
  const b = num(ledger[i].balance);
  if (badY.has(ledger[i].y) && prev !== null) prevByBadY.set(ledger[i].y, prev);
  prev = b;
}

console.log(`=== ${key}: ${fuse.bad.length} unverified rows — sources ===`);
for (const bad of fuse.bad) {
  const page = bad.page;
  const y = bad.y;
  const patch = patches.find((p) => p.page === page && Math.abs(p.y - y) <= 8);
  const bandRows = bandByPage.get(page) ?? [];
  const band = bandRows.filter((b) => Math.abs(b.y * (450 / 900) - y) <= 16);
  const p = prevByBadY.get(y);
  const d = num(bad.debit) ?? 0;
  const c = num(bad.credit) ?? 0;
  const b = num(bad.balance);
  const delta = p !== null && b !== null ? r2(b - p) : null;
  console.log(`\n[p${page} y${Math.round(y)}] ${bad.date} D=${bad.debit} C=${bad.credit} B=${bad.balance} | prev=${p} Δ=${delta} | need: C=${p !== null && b !== null ? r2(b - p + d) : "?"} or D=${p !== null && b !== null ? r2(p - b + c) : "?"}`);
  if (patch) console.log(`   surgical: D=${patch.debit} C=${patch.credit} B=${patch.balance}`);
  for (const br of band) console.log(`   band@900 y${Math.round(br.y)}: ${br.amounts.join(" | ")}`);
}
