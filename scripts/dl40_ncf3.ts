/**
 * DL-40 proof build — FIR v3 Royal Way Travel EGP (owner order ORD-1022-N2).
 *
 * Owner orders implemented:
 *  (1) NCF general — already Master vocabulary since v1.6.1 / SO-14 (answered, no code).
 *  (2) Closing-balance reconciliation added to the Net Cash Flow card: the ending balance
 *      carried by the statement's LAST posting (opening + net = closing, fail-loud).
 *  (3) Monthly net (صافي) after exclusions for EVERY month, exclusions rendered as negatives.
 *
 * G8 doctrine: EVERY financial figure below is parsed from the byte-frozen committed
 * artifacts (FIR v2 + PSR) and re-verified across independent sites before any byte is
 * written. No hand-typed numbers. Any disagreement = abort, no report.
 *
 * Inputs (frozen):
 *   public/GlobalEIS_FIR_RoyalWayTravel_EGP.html     sha256 9e7daaf069bc6081… (v1, untouched)
 *   public/GlobalEIS_FIR_RoyalWayTravel_EGP_v2.html  sha256 de85f5c3d237536d… (v2, base for v3)
 *   public/GlobalEIS_PSR_RoyalWayTravel_EGP.html     (exclusion-placement evidence, S10)
 * Output (NEW file): public/GlobalEIS_FIR_RoyalWayTravel_EGP_v3.html (+ download/ copy)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { firNetCashFlow, firMonthlyNet, REPORT_CSS } from "../src/lib/report_design";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const gate = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} GATE ${name}${detail ? " — " + detail : ""}`);
  if (!ok) {
    console.error(`ABORT: gate ${name} failed`);
    process.exit(1);
  }
};
const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- frozen inputs ----------
const V1_PATH = "public/GlobalEIS_FIR_RoyalWayTravel_EGP.html";
const V2_PATH = "public/GlobalEIS_FIR_RoyalWayTravel_EGP_v2.html";
const PSR_PATH = "public/GlobalEIS_PSR_RoyalWayTravel_EGP.html";
const v1 = readFileSync(V1_PATH, "utf8");
const v2 = readFileSync(V2_PATH, "utf8");
const psr = readFileSync(PSR_PATH, "utf8");

const V1_SHA = "9e7daaf069bc60815e8ca4bf99b712512d0d1240ae042072d6504359422c35e3";
const V2_SHA = "de85f5c3d237536dc5028fd02bc4889276ee9509cfb3a7aedc41398a60029f17";
gate("v1 byte-frozen", sha(v1) === V1_SHA, sha(v1));
gate("v2 byte-frozen", sha(v2) === V2_SHA, sha(v2));

// ---------- parse FIR v2 §3 reconciliation table (primary figures) ----------
const seg3 = v2.slice(v2.indexOf("3. Reconciliation"), v2.indexOf("4. Monthly Financial"));
const openM = seg3.match(
  /<td class="">Opening Balance<\/td><td class="text-right"><span class="num">([\d,]+)<span class="dec">(\.\d{2})<\/span><\/span><\/td><td class="text-right"><span class="num">([\d,]+)<span class="dec">(\.\d{2})<\/span><\/span><\/td>/,
);
gate("§3 opening row parsed", !!openM);
const opening = num(`${openM![1]}${openM![2]}`);
const openingAdj = num(`${openM![3]}${openM![4]}`);

const crM = seg3.match(/Add: Total Credits \(Inflows\)<\/td><td class="text-right"><span class="text-success">\+ ([\d,]+\.\d{2})<\/span><\/td><td class="text-right"><span class="text-success">\+ ([\d,]+\.\d{2})<\/span><\/td>/);
gate("§3 credits row parsed", !!crM);
const credits = num(crM![1]);
const creditsAdj = num(crM![2]);

const dbM = seg3.match(/Less: Total Debits \(Outflows\)<\/td><td class="text-right text-danger">&minus; ([\d,]+\.\d{2})<\/td><td class="text-right text-danger">&minus; ([\d,]+\.\d{2})<\/td><\/tr>/);
gate("§3 debits row parsed", !!dbM);
const debits = num(dbM![1]);
const debitsAdj = num(dbM![2]);

const netM = seg3.match(/Net Cash Flow \(6-month profit\/loss\)<\/strong><\/td><td class="text-right"><strong><span class="text-(success|danger)">(?:\+|&minus;) ([\d,]+\.\d{2})<\/span><\/strong><\/td><td class="text-right"><strong><span class="text-(success|danger)">(?:\+|&minus;) ([\d,]+\.\d{2})<\/span><\/strong><\/td>/);
gate("§3 net row parsed", !!netM);
const netReported = (netM![1] === "success" ? 1 : -1) * num(netM![2]);
const netAdjusted = (netM![3] === "success" ? 1 : -1) * num(netM![4]);

const closeIdx = seg3.indexOf("Closing Balance (verified)");
const closeM = seg3.slice(closeIdx, closeIdx + 400).match(/<strong>([\d,]+\.\d{2})<\/strong><\/td><td class="text-right">incl\. ([\d,]+\.\d{2}) internal funding/);
gate("§3 closing parsed", !!closeM);
const closing = num(closeM![1]);
const inclM = closeM ? closeM[2] : "";
gate("§3 closing incl-note parsed", !!inclM);
const internalIncl = num(inclM);

// ---------- parse FIR v2 §4 monthly table ----------
const seg4 = v2.slice(v2.indexOf("4. Monthly Financial"), v2.indexOf("5. Source of Funds"));
const monthRe = /<tr><td class=""><b>([^<]+)<\/b>(?: <span class="tag low">[^<]*<\/span>)?<\/td><td class="text-right text-success">([\d,]+\.\d{2})<\/td><td class="text-right text-danger">([\d,]+\.\d{2})<\/td><td class="text-right"><span class="text-(success|danger)">(?:\+|&minus;) ([\d,]+\.\d{2})<\/span><\/td><td class="text-right"><b>([\d,]+\.\d{2})<\/b><\/td><\/tr>/g;
const months: { label: string; cr: number; db: number; net: number; close: number }[] = [];
let windowTotalFromTable: { cr: number; db: number; net: number; close: number } | null = null;
for (const m of seg4.matchAll(monthRe)) {
  const sign = m[4] === "success" ? 1 : -1;
  months.push({ label: m[1].trim(), cr: num(m[2]), db: num(m[3]), net: sign * num(m[5]), close: num(m[6]) });
}
const wtM = seg4.match(/<b>WINDOW TOTAL<\/b><\/td><td class="text-right text-success"><b>([\d,]+\.\d{2})<\/b><\/td><td class="text-right text-danger"><b>([\d,]+\.\d{2})<\/b><\/td><td class="text-right"><b><span class="text-(success|danger)">(?:\+|&minus;) ([\d,]+\.\d{2})<\/span><\/b><\/td><td class="text-right"><b>([\d,]+\.\d{2})<\/b><\/td><\/tr>/);
if (wtM) windowTotalFromTable = { cr: num(wtM[1]), db: num(wtM[2]), net: (wtM[3] === "success" ? 1 : -1) * num(wtM[4]), close: num(wtM[5]) };
gate("§4 monthly rows = 7", months.length === 7, months.map((m) => m.label).join(" | "));
gate("§4 WINDOW TOTAL row parsed", !!windowTotalFromTable);
if (windowTotalFromTable) {
  gate("§4 WINDOW TOTAL = GRAND credits", Math.abs(windowTotalFromTable.cr - credits) < 0.005);
  gate("§4 WINDOW TOTAL = GRAND debits", Math.abs(windowTotalFromTable.db - debits) < 0.005);
  gate("§4 WINDOW TOTAL net = reported", Math.abs(windowTotalFromTable.net - netReported) < 0.005);
  gate("§4 WINDOW TOTAL close = closing", Math.abs(windowTotalFromTable.close - closing) < 0.005);
}
const sumCr = months.reduce((a, m) => a + m.cr, 0);
const sumDb = months.reduce((a, m) => a + m.db, 0);
const sumNet = months.reduce((a, m) => a + m.net, 0);
const lastClose = months[months.length - 1].close;
gate("§4 Σcredits = GRAND", Math.abs(sumCr - credits) < 0.005, `${money(sumCr)} vs ${money(credits)}`);
gate("§4 Σdebits = GRAND", Math.abs(sumDb - debits) < 0.005, `${money(sumDb)} vs ${money(debits)}`);
gate("§4 Σnets = reported net", Math.abs(sumNet - netReported) < 0.005, `${money(sumNet)} vs ${money(netReported)}`);
gate("§4 last closing = §3 closing", Math.abs(lastClose - closing) < 0.005, money(lastClose));

// ---------- parse FIR v2 §6 SELF row (outflow exclusions) ----------
const selfIdx = v2.indexOf("SELF a/c REF");
const selfSeg = v2.slice(selfIdx, selfIdx + 700);
const selfM = selfSeg.match(/([\d,]+\.\d{2}) <span class="muted">\((\d+)\)<\/span><\/td><td class="text-right text-danger">([\d,]+\.\d{2}) <span class="muted">\((\d+)\)<\/span>/);
gate("§6 SELF row parsed", !!selfM);
const internalCredits = num(selfM![1]);
const internalCreditsN = parseInt(selfM![2], 10);
const selfOut = num(selfM![3]);
const selfOutN = parseInt(selfM![4], 10);
gate("§6 internal credits ties §3 incl-note", Math.abs(internalCredits - internalIncl) < 0.005, money(internalCredits));

// ---------- parse PSR S10 (exclusion placement evidence) ----------
const ownM = psr.match(/Current Account (\d+) \(EGP\)/);
gate("PSR own account parsed", !!ownM);
const ownAccount = ownM![1];
const s10Start = psr.indexOf("Large Deposits — Documents");
const s10 = psr.slice(s10Start, psr.indexOf("<h2", s10Start + 10));
const s10rows: { date: string; amount: number; ref: string }[] = [];
for (const m of s10.matchAll(/<tr><td class="">(\d{2} \w{3} \d{4})<\/td>(?:<\/td>)?<td class="text-right"><span class="psr-num"[^>]*>([\d,]+)<span class="psr-dec">(\.\d{2})<\/span><\/span><\/td><td class=""><span class="psr-ref">(\d+)<\/span><\/td>/g)) {
  s10rows.push({ date: m[1], amount: num(`${m[2]}${m[3]}`), ref: m[4] });
}
const selfRows = s10rows.filter((r) => r.ref === ownAccount);
gate("S10 self-ref rows = 2", selfRows.length === 2, selfRows.map((r) => `${r.date} ${money(r.amount)}`).join(" | "));
const placedSum = selfRows.reduce((a, r) => a + r.amount, 0);
gate("S10 placed sum = internal credits", Math.abs(placedSum - internalCredits) < 0.005, `${money(placedSum)} vs ${money(internalCredits)}`);

// map placements to §4 months by date
const MONTH_KEY: Record<string, string> = { Jan: "Jan", Feb: "Feb", Mar: "Mar", Apr: "Apr", May: "May", Jun: "Jun", Jul: "Jul", Aug: "Aug", Sep: "Sep", Oct: "Oct", Nov: "Nov", Dec: "Dec" };
const exclusionsByLabel = new Map<string, { amount: number; basis: string }>();
for (const r of selfRows) {
  const mon = MONTH_KEY[r.date.split(" ")[1]];
  const target = months.find((m) => m.label.startsWith(mon + " "));
  gate(`placement month exists (${r.date})`, !!target);
  const prev = exclusionsByLabel.get(target!.label);
  const basis = `${r.date} · ref = own account ${ownAccount}`;
  exclusionsByLabel.set(target!.label, prev ? { amount: prev.amount + r.amount, basis: `${prev.basis} and ${basis}` } : { amount: r.amount, basis });
}
gate("placements ≠ window total (they are partial)", placedSum < sumCr);

// ---------- FIR v2 corroboration sites (identity, NCF card, §2/§8) ----------
const idSite1 = v2.includes(`verified: ${money(opening)} + ${money(credits)} &minus; ${money(debits)} = ${money(closing)}`);
const ncfM = v2.match(/verified credits ([\d,]+\.\d{2}) &minus; verified debits ([\d,]+\.\d{2})/);
gate("§1 NCF derivation parsed", !!ncfM && num(ncfM![1]) === credits && num(ncfM![2]) === debits);
const v2text = v2.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const idSite2 = v2text.includes(`${money(opening)} ${money(credits)} ${money(debits)} ${money(closing)}`) || v2text.includes(`${money(closing)} incl. ${money(internalIncl)}`);
const lastPostM = v2.match(/latest posting (\d{2} \w{3} \d{4})/);
gate("last posting date parsed", !!lastPostM, lastPostM?.[1] ?? "");
const lastPostingDate = lastPostM![1];
const curM = v2.match(/<span class="num"><strong>[\d,.]+ (EGP|USD)<\/strong><\/span>/);
gate("currency parsed", !!curM, curM?.[1] ?? "");
const currency = curM![1];
const daysM = v2.match(/this (\d+)-day window/);
gate("window days parsed", !!daysM, daysM?.[1] ?? "");
const windowDays = parseInt(daysM![1], 10);
const perM = v2.match(/\((\d{2}\/\d{2}\/\d{4})[^)]*?(\d{2}\/\d{2}\/\d{4})\)/);
const periodLabel = perM ? `${perM![1]} → ${perM![2]}` : undefined;

// master identity checks across sites
gate("identity: opening + credits − debits = closing (§3)", Math.abs(opening + credits - debits - closing) < 0.005, `${money(opening)} + ${money(credits)} − ${money(debits)} = ${money(closing)}`);
gate("identity site §1 printed", idSite1);
gate("identity site §3/§8 corroborated", idSite2);
gate("adjusted: credits − internal = adjCredits", Math.abs(credits - internalCredits - creditsAdj) < 0.005, money(creditsAdj));
gate("adjusted: debits − selfOut = adjDebits", Math.abs(debits - selfOut - debitsAdj) < 0.005, money(debitsAdj));
gate("adjusted: adjCredits − adjDebits = adjNet", Math.abs(creditsAdj - debitsAdj - netAdjusted) < 0.005, money(netAdjusted));
gate("adjusted: opening + adj = adjNet", Math.abs(openingAdj + netAdjusted - (closing - internalCredits + selfOut)) < 0.005);
gate("§6 counts: internal credits 2 postings", internalCreditsN === 2, String(internalCreditsN));
gate("§6 counts: self-out 8 postings", selfOutN === 8, String(selfOutN));

// ---------- build the two v1.6.2 blocks (builders re-verify internally) ----------
const ncfCard = firNetCashFlow({
  currency,
  months: 6, // SO-14 firm standard basis (the exact-day cross-check is printed separately)
  credits,
  debits,
  windowDays,
  periodLabel,
  openingBalance: opening,
  closingBalance: closing,
  lastPostingDate,
});
const mnfBlock = firMonthlyNet({
  currency,
  rows: months.map((m) => ({
    month: m.label,
    net: m.net,
    internalCreditExclusions: exclusionsByLabel.get(m.label)?.amount,
    basis: exclusionsByLabel.get(m.label)?.basis,
  })),
  windowDebitExclusions: {
    amount: selfOut,
    postings: selfOutN,
    note: "below every itemization threshold on the retained artifacts",
  },
  adjustedNet: netAdjusted,
});
gate("builder NCF rendered", ncfCard.includes("Closing balance — the statement's last posting") && ncfCard.includes(money(closing)));
gate("builder MNF tie-out (in-builder G8)", mnfBlock.includes("ADJUSTED NET CASH FLOW — VERIFIED") && mnfBlock.includes(money(Math.abs(netAdjusted))));

// ---------- splice into v2 → v3 ----------
let v3 = v2;
const cStart = v3.indexOf('<div class="analysis-card full-width ncf">');
const cEnd = v3.indexOf("</p></div>", cStart) + "</p></div>".length;
gate("v2 NCF card located", cStart > 0 && cEnd > cStart);
v3 = v3.slice(0, cStart) + ncfCard + v3.slice(cEnd);

const insAnchor = v3.indexOf("(Section 7).</p>");
const abEnd = v3.indexOf("</div>", insAnchor) + "</div>".length;
gate("§3 insight box located", insAnchor > 0 && abEnd > insAnchor);
v3 = v3.slice(0, abEnd) + "\n    " + mnfBlock + v3.slice(abEnd);

// upgrade embedded stylesheet to the current Master constant (additive-only proof)
const cssOld = v3.match(/<style>([\s\S]*?)<\/style>/)![1];
const newOpen = v3.replace(/<style>[\s\S]*?<\/style>/, `<style>${REPORT_CSS}</style>`);
const cssNew = newOpen.match(/<style>([\s\S]*?)<\/style>/)![1];
// additive proof: every old CSS line must appear in-order in the new CSS
let pi = 0;
let inOrder = true;
for (const line of cssOld.split("\n")) {
  const ni = cssNew.indexOf(line, pi);
  if (ni < 0) {
    inOrder = false;
    console.error("MISSING OLD CSS LINE:", line.slice(0, 90));
    break;
  }
  pi = ni + line.length;
}
gate("CSS upgrade is purely additive (in-order superset)", inOrder, `old ${cssOld.length}B → new ${cssNew.length}B`);
v3 = newOpen;

// structural invariants
const sheetsBefore = (v2.match(/<section/g) ?? []).length;
const pagesBefore = (v2.match(/class="pageno"/g) ?? []).length;
const sheetsAfter = (v3.match(/<section/g) ?? []).length;
const pagesAfter = (v3.match(/class="pageno"/g) ?? []).length;
gate("papers 9/9 unchanged", sheetsBefore === 9 && sheetsAfter === 9 && pagesBefore === 9 && pagesAfter === 9, `sections ${sheetsBefore} → ${sheetsAfter}, pagenos ${pagesBefore} → ${pagesAfter}`);
gate("v1 untouched on disk", sha(readFileSync(V1_PATH, "utf8")) === V1_SHA);
gate("v2 untouched in memory", sha(v2) === V2_SHA);
gate("v3 contains both blocks", v3.includes('class="analysis-card full-width ncf"') && v3.includes('class="analysis-card full-width mnf"'));

// ---------- emit ----------
mkdirSync("download", { recursive: true });
const OUT = "public/GlobalEIS_FIR_RoyalWayTravel_EGP_v3.html";
writeFileSync(OUT, v3);
writeFileSync("download/GlobalEIS_FIR_RoyalWayTravel_EGP_v3.html", v3);
console.log("\n=== DL-40 PROOF BUILD COMPLETE ===");
console.log(`out: ${OUT}`);
console.log(`sha256 v3: ${sha(v3)}`);
console.log(`bytes: ${Buffer.byteLength(v3)} (v2 was ${Buffer.byteLength(v2)})`);
console.log(`figures: net ${money(netReported)} · adjNet ${money(netAdjusted)} · internal ${money(internalCredits)} (${internalCreditsN}) · selfOut ${money(selfOut)} (${selfOutN}) · placements ${[...exclusionsByLabel.entries()].map(([k, v]) => `${k}=${money(v.amount)}`).join(", ")}`);
