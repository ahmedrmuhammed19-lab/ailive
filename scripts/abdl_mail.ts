/**
 * DL-27 — deliver the two Abdulrahman Ali reports by email to
 * abdulrahman.ali@global-operation.com (explicit owner instruction, recorded
 * as an owner-authorized override of the operator-only mail rule for THIS
 * delivery). Operator copy goes to ahmedr.muhammed19@gmail.com.
 * Sends through the REAL portal mailer (sendOrQueue — live Gmail SMTP).
 * Run: bun scripts/abdl_mail.ts
 */
import { sendOrQueue, operatorAddress, loadMailCreds } from "../src/lib/mail.ts";
import * as fs from "node:fs";

// ━━ DL-31 FREEZE — owner directive 2026-10-19: "stop sending abdulrahman" ━━
// The client-delivery channel to Mr. Ali is FROZEN by the owner. This guard
// exits BEFORE any send; the client address is kept solely so this script can
// identify and refuse it. Lifting the freeze requires an explicit new owner
// authorization (recorded in STANDING_ORDERS.md). Operator mail unaffected.
const CLIENT_DELIVERY_FROZEN = true;
const FROZEN_CLIENT_ADDRESS = "abdulrahman.ali@global-operation.com";
if (CLIENT_DELIVERY_FROZEN) {
  console.error(
    `[DL-31 FREEZE] Client delivery is FROZEN by owner directive "stop sending abdulrahman". ` +
      `No mail sent to ${FROZEN_CLIENT_ADDRESS}. Explicit owner re-authorization required.`
  );
  process.exit(78);
}

const W = "/home/z/my-project/scripts/abdl_work";
const OUT = "/home/z/my-project/download";
const names: string[] = JSON.parse(fs.readFileSync(`${W}/report_names.json`, "utf8"));
const attachments = names.map((n) => ({
  filename: n,
  path: `${OUT}/${n}`,
  contentType: "text/html; charset=utf-8",
}));

const creds = await loadMailCreds();
const operator = operatorAddress(creds);
console.log("operator (reply-to + copy):", operator);
console.log("attachments:", names.join(", "));

const clientMail = {
  to: "abdulrahman.ali@global-operation.com",
  replyTo: operator,
  subject: "Global EIS — Financial Readiness Reports (2 accounts): USD + EGP",
  body:
    "Dear Mr. Ali,\n\n" +
    "Please find attached the two financial readiness assessment reports prepared from the bank statements you provided:\n\n" +
    "  1. Dollar Account (USD) — Savings account no. 0205000539007300011 — period 01/03/2026 to 04/10/2026\n" +
    "  2. Egyptian Account (EGP) — Savings account no. 4955000539007300018 — period 01/03/2026 to 04/10/2026\n\n" +
    "Both reports follow the Global EIS Master v1.4.0 report standard: monthly debit/credit trajectory with grand totals, " +
    "window-prorated income & expense summary, and a balance double-check appendix. The printed closing balance of each " +
    "account reconciles to the cent against the bank's own running balances.\n\n" +
    "The statements were scanned documents (image-only PDFs); the figures were recovered by a multi-pass OCR pipeline with " +
    "per-row chain verification. Chain-verification coverage and any unverified rows are disclosed inside each report — " +
    "nothing is guessed.\n\n" +
    "The reports are also available on the Global EIS portal under \"Reports\". Replies reach us directly at " +
    operator + ".\n\n" +
    "Kind regards,\nGlobal EIS — Financial Intelligence Services",
  kind: "report_ready" as const,
  attachments,
};
const res = await sendOrQueue(clientMail);
console.log("client mail:", JSON.stringify(res));

await sendOrQueue({
  to: operator,
  subject: "✅ DL-27 delivered — 2 reports emailed to abdulrahman.ali@global-operation.com",
  body:
    "Delivered per owner instruction (2 bank statements = 2 reports, emailed to " +
    "abdulrahman.ali@global-operation.com).\n\n" +
    `Reports:\n${names.map((n) => `  • ${n}`).join("\n")}\n\n` +
    "USD account 0205000539007300011: 7 ledger rows recovered, 85.7% chain-verified, closing 4,261.25 (matches print).\n" +
    "EGP account 4955000539007300018: 595 ledger rows recovered (of 630 printed), 92.4% chain-verified, closing 654,722.19 (matches print).\n\n" +
    "Both are OCR-scan builds in review style (unverified rows disclosed inside the reports).",
  kind: "operator_alert" as const,
  attachments,
});
console.log("operator copy sent");
