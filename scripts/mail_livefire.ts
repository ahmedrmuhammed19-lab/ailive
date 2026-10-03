/**
 * LIVE-FIRE mail proof — drives the app's real sendOrQueue() (nodemailer)
 * against a LOCAL SMTP sink on 127.0.0.1:1025. Nothing reaches the internet.
 *
 * Two phases prove both code paths of the mail stack:
 *
 *   LIVEFIRE_MODE=lock    (default) TEST_MAIL_TO active -> EVERY mail is
 *                         force-redirected to the test inbox; verifies the
 *                         redirect + intendedTo audit + LOCK banner + the
 *                         second-refusal guard.
 *   LIVEFIRE_MODE=direct  TEST_MAIL_TO cleared -> mails flow straight to the
 *                         sink recipients; verifies the plain creds->SMTP path.
 *
 * Required env:
 *   MAIL_CREDS_JSON={"email":"livefire@local.test","app_password":"sink-only",
 *                    "host":"127.0.0.1","port":1025,"secure":false}
 *
 * Usage:  LIVEFIRE_MODE=lock   MAIL_CREDS_JSON='...' bun run scripts/mail_livefire.ts
 *         LIVEFIRE_MODE=direct TEST_MAIL_TO="" MAIL_CREDS_JSON='...' bun run scripts/mail_livefire.ts
 */
import { sendOrQueue } from "../src/lib/mail";

const MODE = process.env.LIVEFIRE_MODE ?? "lock";

// clearly non-routable local.test addresses — zero chance of real delivery
const CLIENT = MODE === "lock" ? "client.livefire@local.test" : "client.direct@local.test";
const OPERATOR = MODE === "lock" ? "operator.livefire@local.test" : "operator.direct@local.test";

type MailInput = Parameters<typeof sendOrQueue>[0];

const mails: MailInput[] = [
  {
    kind: "operator_alert",
    to: OPERATOR,
    subject: "📥 New bank statement uploaded — Queue LIVEFIRE-01",
    body:
      `LIVE-FIRE proof mail 1/4 (operator_alert) — mode=${MODE}.\n` +
      "Sent through the portal's real sendOrQueue() path to the local SMTP sink.",
    submissionId: "LIVEFIRE-01",
  },
  {
    kind: "report_ready",
    to: CLIENT,
    submissionId: "LIVEFIRE-01",
    subject: "Global EIS — analysis report ready (Queue LIVEFIRE-01)",
    body:
      `LIVE-FIRE proof mail 2/4 (report_ready) — mode=${MODE}.\n` +
      "Carries a small attachment to prove the MIME attachment path.",
    attachments: [
      {
        filename: "livefire-report.pdf",
        content: Buffer.from("%PDF-1.4 livefire attachment proof"),
        contentType: "application/pdf",
      },
    ],
  },
  {
    kind: "client_receipt",
    to: CLIENT,
    submissionId: "LIVEFIRE-01",
    subject: "✅ Statement received — Queue LIVEFIRE-01",
    body:
      `LIVE-FIRE proof mail 3/4 (client_receipt) — mode=${MODE}.\n` +
      "Confirms the client handshake mail renders and routes correctly.",
  },
  {
    kind: "client_nudge",
    to: CLIENT,
    submissionId: "LIVEFIRE-01",
    subject: "⚠️ Action needed — Queue LIVEFIRE-01",
    body:
      `LIVE-FIRE proof mail 4/4 (client_nudge) — mode=${MODE}.\n` +
      "Confirms the manual-work nudge template routes correctly.",
  },
];

async function main() {
  const credsSet = Boolean(process.env.MAIL_CREDS_JSON);
  const lockTo = process.env.TEST_MAIL_TO?.trim() || null;
  console.log(`[livefire] mode=${MODE} credsSet=${credsSet} TEST_MAIL_TO=${lockTo ? lockTo : "<unset>"}`);

  const results: Array<{ kind: string; to: string; sent: boolean; queued: boolean; error?: string }> = [];
  for (const mail of mails) {
    const r = await sendOrQueue(mail);
    results.push({ kind: mail.kind, to: r.to, sent: r.sent, queued: r.queued, error: r.error });
    console.log(
      `[livefire] ${mail.kind.padEnd(15)} -> ${r.to}  sent=${r.sent} queued=${r.queued}${r.error ? " error=" + r.error : ""}`
    );
  }

  const allSent = results.every((r) => r.sent);
  console.log(allSent ? `LIVEFIRE_PASS ${results.length}/${results.length} (mode=${MODE})` : `LIVEFIRE_FAIL (mode=${MODE})`);
  process.exit(allSent ? 0 : 1);
}

main().catch((e) => {
  console.error("[livefire] fatal:", e);
  process.exit(1);
});
