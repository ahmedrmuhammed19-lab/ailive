/**
 * send_ops_report.ts — deliver the ops status report via the portal's own
 * mail path (src/lib/mail.ts sendOrQueue): SMTP creds from
 * config/mail_credentials.json, TEST_MAIL_TO lock applied, outbox fallback.
 *
 * Body = the report HTML itself (renders inline in Gmail) + the same file
 * attached as the keepable artifact.
 *
 * Usage: bun scripts/send_ops_report.ts <html-path> <report-id> <subject>
 */
import { readFile } from "fs/promises";
import { sendOrQueue } from "../src/lib/mail";

async function main() {
  const [, , htmlPath, reportId, subject] = process.argv;
  if (!htmlPath || !reportId || !subject) {
    console.error("usage: bun scripts/send_ops_report.ts <html-path> <report-id> <subject>");
    process.exit(2);
  }
  const html = await readFile(htmlPath, "utf8");
  const result = await sendOrQueue({
    to: "ahmedr.muhammed19@gmail.com",
    kind: "operator_alert",
    submissionId: reportId,
    subject,
    body:
      `Global EIS — Operations Status Report ${reportId}\n\n` +
      `HTML version attached and rendered below (mail + chat + portal delivery contract).\n` +
      `Also published on the portal reports list.\n\n— Global EIS Operations`,
    html,
    attachments: [{ filename: htmlPath.split("/").pop() || "report.html", content: Buffer.from(html, "utf8"), contentType: "text/html" }],
  });
  console.log("MAIL RESULT:", JSON.stringify(result));
  if (!result.sent) process.exit(1);
}

main();
