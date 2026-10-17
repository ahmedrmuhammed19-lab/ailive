/**
 * DL-26 — Family G (bank-adapter registry) test suite.
 * Run: bun scripts/bank_adapters_test.ts
 *
 * Synthetic statements for three dialects (NBE, Banque Misr, QNB) with exact
 * balance chains, plus negatives: unknown bank, broken chain, name-mention
 * only. The suite is the promotion gate for the adapter — every check must
 * pass before the build is pushed.
 */
import {
  parseBankStatementGeneric,
  auditLedgerCoverage,
} from "../src/lib/analyze.ts";
import type { AccountLeg } from "../src/lib/analyze.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
};

/** Build a synthetic ledger text with an exact balance chain. */
function ledger(
  opts: {
    header: string;
    meta: string;
    dates: string[];
    opening: number;
    moves: number[]; // +credit / -debit
    desc?: string;
  }
): { text: string; expectedClosing: number; expectedIn: number; expectedOut: number } {
  const rows: string[] = [];
  let bal = opts.opening;
  let inSum = 0;
  let outSum = 0;
  opts.moves.forEach((mv, i) => {
    bal = Math.round((bal + mv) * 100) / 100;
    if (mv > 0) inSum += mv;
    else outSum += -mv;
    const amt = Math.abs(mv).toLocaleString("en-US", { minimumFractionDigits: 2 });
    rows.push(
      `${opts.dates[i]}  ${opts.desc ?? "TRANSFER " + (i + 1)}  ${amt}  ${bal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
    );
  });
  const text = [
    opts.header,
    opts.meta,
    `Opening Balance: ${opts.opening.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    ...rows,
    `Closing Balance: ${bal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
  ].join("\n");
  return { text, expectedClosing: bal, expectedIn: inSum, expectedOut: outSum };
}

const dates = ["01/03/2026", "05/03/2026", "09/03/2026", "14/03/2026", "18/03/2026", "23/03/2026", "27/03/2026", "30/03/2026"];

// ---------- 1. NBE text-layer statement ----------
const nbe = ledger({
  header: "National Bank of Egypt — Statement of Account",
  meta: "Account No: 1234567890123456    Currency: EGP    Period: From 01/03/2026 to 30/03/2026",
  dates,
  opening: 10000,
  moves: [5000, -1200.5, -300, 8422.75, -15000, 20000, -75.25, -987.1],
});
const nbeLeg = parseBankStatementGeneric(nbe.text, "nbe_stmt.pdf");
console.log("\n[1] NBE text-layer");
check("bank adapter claimed the document", nbeLeg !== null, JSON.stringify(nbeLeg ? nbeLeg.mode : null));
if (nbeLeg) {
  check("dialect = G:NBE", nbeLeg.mode === "G:NBE", nbeLeg.mode ?? "?");
  check("account extracted", nbeLeg.account === "1234567890123456", nbeLeg.account ?? "null");
  check("currency = EGP", nbeLeg.currency === "EGP", nbeLeg.currency);
  check("period extracted", nbeLeg.period?.includes("01/03/2026") === true, nbeLeg.period ?? "null");
  check("row count = 8 txns + 2 stated positions", nbeLeg.txCount === 10, String(nbeLeg.txCount));
  check("transaction rows = 8", nbeLeg.rows.filter((r) => r.movement !== null).length === 8, String(nbeLeg.rows.filter((r) => r.movement !== null).length));
  check("position rows are movement-less", nbeLeg.rows.filter((r) => r.movement === null).length === 2);
  check("full chain verified", nbeLeg.matched === nbeLeg.txCount, `${nbeLeg.matched}/${nbeLeg.txCount}`);
  check("closing to the cent", Math.abs(nbeLeg.closing - nbe.expectedClosing) < 0.015, `${nbeLeg.closing} vs ${nbe.expectedClosing}`);
  check("inflow to the cent", Math.abs(nbeLeg.inflow - nbe.expectedIn) < 0.015, `${nbeLeg.inflow} vs ${nbe.expectedIn}`);
  check("outflow to the cent", Math.abs(nbeLeg.outflow - nbe.expectedOut) < 0.015, `${nbeLeg.outflow} vs ${nbe.expectedOut}`);
  const audit = auditLedgerCoverage(nbeLeg, "NBE", true);
  check("coverage audit confident", audit.confident, JSON.stringify(audit.notes));
  check("opening→closing reconciles", audit.openingClosingOk);
  check("descriptions preserved", (nbeLeg.largestCredit?.desc ?? "").includes("TRANSFER"), nbeLeg.largestCredit?.desc ?? "null");
}

// ---------- 2. Banque Misr (bilingual header, dashed dates) ----------
const bmDates = ["01-04-2026", "07-04-2026", "12-04-2026", "19-04-2026", "25-04-2026", "28-04-2026"];
const bm = ledger({
  header: "بنك مصر — Banque Misr — كشف حساب Statement of Account",
  meta: "Account Number: 987654321    Account Currency: USD",
  dates: bmDates,
  opening: 5000,
  moves: [1500.25, -2300.1, -450, 3200.85, -1100, -760.99],
});
const bmLeg = parseBankStatementGeneric(bm.text, "bm_stmt.pdf");
console.log("\n[2] Banque Misr (bilingual)");
check("bank adapter claimed the document", bmLeg !== null);
if (bmLeg) {
  check("dialect = G:Banque Misr", bmLeg.mode === "G:Banque Misr", bmLeg.mode ?? "?");
  check("currency = USD from label", bmLeg.currency === "USD", bmLeg.currency);
  check("full chain verified", bmLeg.matched === bmLeg.txCount, `${bmLeg.matched}/${bmLeg.txCount}`);
  check("closing to the cent", Math.abs(bmLeg.closing - bm.expectedClosing) < 0.015, `${bmLeg.closing} vs ${bm.expectedClosing}`);
  check("coverage audit confident", auditLedgerCoverage(bmLeg, "Banque Misr", true).confident);
}

// ---------- 3. QNB (dd MMM yyyy dates) ----------
const qnbDates = ["02 MAY 2026", "09 MAY 2026", "16 MAY 2026", "21 MAY 2026", "27 MAY 2026", "30 MAY 2026"];
const qnb = ledger({
  header: "Qatar National Bank (QNB) — Statement of Account",
  meta: "Account Number: QNBEGB4X00001122334455   Currency: EUR",
  dates: qnbDates,
  opening: 2500,
  moves: [900.1, -300.2, -150.3, 4500.4, -5200.55, 1110.06],
});
const qnbLeg = parseBankStatementGeneric(qnb.text, "qnb_stmt.pdf");
console.log("\n[3] QNB (dd MMM yyyy)");
check("bank adapter claimed the document", qnbLeg !== null);
if (qnbLeg) {
  check("dialect = G:QNB", qnbLeg.mode === "G:QNB", qnbLeg.mode ?? "?");
  check("full chain verified", qnbLeg.matched === qnbLeg.txCount, `${qnbLeg.matched}/${qnbLeg.txCount}`);
  check("closing to the cent", Math.abs(qnbLeg.closing - qnb.expectedClosing) < 0.015, `${qnbLeg.closing} vs ${qnb.expectedClosing}`);
}

// ---------- 4. Negative — unknown bank stays unclaimed ----------
const unknown = ledger({
  header: "Some Random Bank Ltd — Statement of Account",
  meta: "Account No: 555000111    Currency: EGP",
  dates,
  opening: 1000,
  moves: [100, -50, 25, -75, 300, -120, 45, -10],
});
console.log("\n[4] unknown bank");
check("no dialect claims it", parseBankStatementGeneric(unknown.text, "x.pdf") === null);

// ---------- 5. Negative — broken chain must not pass the audit ----------
const broken = ledger({
  header: "National Bank of Egypt — Statement of Account",
  meta: "Account No: 1234567890123456    Currency: EGP",
  dates,
  opening: 10000,
  moves: [5000, -1200.5, -300, 8422.75, -15000, 20000, -75.25, -987.1],
});
// corrupt the chain: break two balances so opening→closing reconciliation fails
const brokenLines = broken.text.split("\n");
brokenLines[4] = brokenLines[4].replace(/[\d,]+\.\d{2}$/, "999,999.99");
brokenLines[6] = brokenLines[6].replace(/[\d,]+\.\d{2}$/, "1.00");
const brokenText = brokenLines.join("\n");
const brokenLeg = parseBankStatementGeneric(brokenText, "broken.pdf");
console.log("\n[5] broken chain (NBE header)");
check("no confident leg returns (stays red)", brokenLeg === null, brokenLeg ? `${brokenLeg.mode} matched=${brokenLeg.matched}/${brokenLeg.txCount}` : "");

// ---------- 6. Negative — bank name MENTION alone never claims ----------
const mention = "Client mentioned Al Ahly Bank in an email thread. No ledger here.";
console.log("\n[6] name-mention only");
check("mention does not claim", parseBankStatementGeneric(mention, "mail.txt") === null);

// ---------- 7. Audit unit — fabricated mismatching leg refused ----------
console.log("\n[7] audit unit");
const fakeLeg = {
  file: "f", account: null, currency: "EGP", period: null,
  opening: 100, closing: 500, inflow: 200, outflow: 0,
  txCount: 6, matched: 6, largestCredit: null, largestDebit: null, salarySeen: false, rows: [],
} as unknown as AccountLeg;
const fakeAudit = auditLedgerCoverage(fakeLeg, "NBE", true);
check("residual > 0 → not confident", !fakeAudit.confident, JSON.stringify(fakeAudit.notes));

// ---------- summary ----------
console.log(`\n=== Family G suite: ${pass} pass / ${fail} fail ===`);
if (fail > 0) process.exit(1);
