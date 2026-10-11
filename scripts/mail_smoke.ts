/**
 * DL-9f — restore SMTP credentials and verify through the REAL mailer.
 * Run: bun scripts/mail_smoke.ts
 *
 * Safety: reads creds from config/mail_credentials.json (gitignored, 600);
 * never prints the password; test recipient is locked by TEST_MAIL_TO
 * (ahmedr.muhammed19@gmail.com — the only allowed destination).
 */
import { sendOrQueue, testMailLock } from "../src/lib/mail.ts";
import { readFileSync } from "node:fs";

/* Load .env manually (standalone bun does not auto-load it) — engages the TEST_MAIL_TO lock. */
for (const line of readFileSync("/home/z/my-project/.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const lock = testMailLock();
console.log("TEST_MAIL_TO lock:", lock);

const result = await sendOrQueue({
  to: lock ?? "ahmedr.muhammed19@gmail.com",
  kind: "operator_alert",
  subject: "Global EIS — SMTP restored (DL-9f smoke test)",
  body:
    "Gmail app password installed in config/mail_credentials.json and verified " +
    "through the real portal mailer (sendOrQueue). Mail pipeline is READY for " +
    "the next bank statement: upload alerts, red-path alerts and report-ready " +
    "notices will deliver to this address.",
});

console.log("mail result:", JSON.stringify(result));
if (result.sent) {
  console.log("PASS — SMTP live, message accepted by smtp.gmail.com");
} else {
  console.log("FAIL — mail queued to outbox instead of sent; check creds/error");
  process.exit(1);
}
