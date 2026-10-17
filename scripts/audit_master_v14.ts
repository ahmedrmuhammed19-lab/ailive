/**
 * Master v1.4.0 promotion audit (DL-23) — cross-validates the new canonical
 * builders (monthlyTrajectoryTable + incomeExpenseSummaryBlock + run-rate
 * math) against the INDEPENDENTLY AUDITED Bola Ayad Gerges Rev 3 figures
 * (scripts/audit_bola_v3.py, 32/32 PASS). The promotion may only ship when
 * the Master builder reproduces every audited figure to the cent.
 *
 * Run: bun run scripts/audit_master_v14.ts
 */
import { readFileSync } from "node:fs";
import {
  annualRunRate,
  incomeExpenseSummaryBlock,
  monthlyRunRate,
  monthlyTrajectoryTable,
  type MonthlyTrajectorySpec,
} from "../src/lib/report_design.ts";

const DATA = new URL("./bola_rev2/bola_monthly.json", import.meta.url);
const j = JSON.parse(readFileSync(DATA, "utf-8"));

const sav = {
  jul: { debits: Number(j.sav_monthly["2026-07"].debits), credits: Number(j.sav_monthly["2026-07"].credits) },
  aug: { debits: Number(j.sav_monthly["2026-08"].debits), credits: Number(j.sav_monthly["2026-08"].credits) },
};
const cur = {
  jul: { debits: Number(j.cur_monthly["2026-07"].debits), credits: Number(j.cur_monthly["2026-07"].credits) },
  aug: { debits: Number(j.cur_monthly["2026-08"].debits), credits: Number(j.cur_monthly["2026-08"].credits) },
};

const spec: MonthlyTrajectorySpec = {
  accountLabels: ["Account ...02501019 (Savings)", "Account ...2500010 (Current)"],
  currency: "EGP",
  rows: [
    { month: "July 2026", accounts: [sav.jul, cur.jul] },
    { month: "August 2026", note: "day range 01–11 — partial month", accounts: [sav.aug, cur.aug] },
  ],
};

const table = monthlyTrajectoryTable(spec);
const DAYS = 42;
const totC = 135505.0;
const totD = 138520.69;
const summary = incomeExpenseSummaryBlock({
  currency: "EGP",
  windowDays: DAYS,
  windowCredits: totC,
  windowDebits: totD,
  verifiedExternalCredits: 400.0,
  fullMonths: [{ label: "July 2026", debits: 110145.63, credits: 135102.5 }],
});

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

console.log("— monthly trajectory table (multi-account, GRAND group) —");
check("July grand debits 110,145.63", table.includes(">110,145.63<"));
check("July grand credits 135,102.50", table.includes(">135,102.50<"));
check("July grand net +24,956.87", table.includes(">+24,956.87<"));
check("August grand debits 28,375.06", table.includes(">28,375.06<"));
check("August grand credits 402.50", table.includes(">402.50<"));
check("August grand net −27,972.56", table.includes(">−27,972.56<"));
check("WINDOW grand debits 138,520.69", table.includes(">138,520.69<"));
check("WINDOW grand credits 135,505.00", table.includes(">135,505.00<"));
check("WINDOW grand net −3,015.69", table.includes(">−3,015.69<"));
check("Grand — All Accounts header", table.includes("Grand — All Accounts"));
check("WINDOW TOTAL footer row", table.includes("WINDOW TOTAL") && table.includes("total-row"));
check("Savings July per-account D 73,708.44", table.includes(">73,708.44<"));
check("Current July per-account D 36,437.19", table.includes(">36,437.19<"));
check("grand-col header class", table.includes('class="grand-col"'));
check("grand-cell body class", table.includes("grand-cell"));
// structural: 2 month rows + 1 total row; each data row has 1+3*2+3 = 10 cells
const trs = table.match(/<tr[ >]/g)?.length ?? 0;
check("row count = 2 months + 1 total + 2 header = 5", trs === 5);
const dataRow = (table.match(/<tr><td>July 2026<\/td>.*?<\/tr>/s) ?? [""])[0];
check("July row carries 10 cells", (dataRow.match(/<td/g)?.length ?? 0) === 10);

console.log("— income & expense summary (window-prorated) —");
check("window income 135,505.00", summary.includes(">135,505.00<"));
check("verified external 400.00", summary.includes("400.00"));
check("external share pill 0.3%", summary.includes("0.3%"));
check("own-account remainder 99.7%", summary.includes("99.7%"));
check("annual gross run-rate 1,177,602.98", summary.includes("1,177,602.98"));
check("annual external run-rate 3,476.19", summary.includes("3,476.19"));
check("monthly expense avg 100,394.52", summary.includes("100,394.52"));
check("July full-month expense 110,145.63", summary.includes(">110,145.63<"));
check("canonical formula × 365 ÷ 42", summary.includes("× 365 ÷ 42"));
check("canonical formula × 30.44", summary.includes("× 30.44"));
check("Income & Expense Summary title", summary.includes("Income &amp; Expense Summary"));
check("Methodology note present", summary.includes("Methodology (Master v1.4)"));

console.log("— canonical run-rate math (pure functions) —");
check("annualRunRate(135505, 42) = 1,177,602.98", annualRunRate(135505.0, 42) === "1,177,602.98");
check("annualRunRate(400, 42) = 3,476.19", annualRunRate(400.0, 42) === "3,476.19");
check("monthlyRunRate(138520.69, 42) = 100,394.52", monthlyRunRate(138520.69, 42) === "100,394.52");
check("monthlyRunRate(0-safe)", monthlyRunRate(0, 42) === "0.00");
check("annualRunRate(days=0) = —", annualRunRate(100, 0) === "—");

console.log("— single-account collapse (one D/C/N table, footer IS the grand) —");
const single = monthlyTrajectoryTable({
  accountLabels: ["Account 1000…2501019"],
  currency: "EGP",
  rows: [{ month: "July 2026", accounts: [{ debits: 73708.44, credits: 135102.5 }] }],
});
check("single-account header Total Debits (EGP)", single.includes("Total Debits (EGP)"));
check("single-account has NO redundant grand group", !single.includes("Grand — All Accounts"));
check("single-account footer = grand total", single.includes("WINDOW TOTAL"));
check("single-account net +61,394.06", single.includes(">+61,394.06<"));
check("single-account total row D 73,708.44 / C 135,102.50", single.includes(">73,708.44<") && single.includes(">135,102.50<"));

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.error("ABORT — Master v1.4.0 promotion audit FAILED; do not ship.");
  process.exit(1);
}
console.log("OK — Master v1.4.0 builders reproduce the audited Bola Ayad Gerges Rev 3 figures to the cent.");
