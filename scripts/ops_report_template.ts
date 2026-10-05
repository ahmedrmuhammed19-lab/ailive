/**
 * ops_report_template.ts — generates the Operations Status Report using the
 * FIRM'S CANONICAL template (src/lib/report_design.ts, adopted verbatim from
 * the client's own HTML). No ad-hoc styling — every element comes from the
 * shared design system, so ops reports look identical to client reports.
 *
 * Usage: bun scripts/ops_report_template.ts <out-path> <report-id> <date-label>
 */
import { writeFile } from "fs/promises";
import {
  reportShell,
  alertBox,
  kpiGrid,
  kpiCard,
  sectionTitle,
  tag,
  escHtml,
} from "../src/lib/report_design";

function tbl(headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${escHtml(h)}</th>`).join("");
  const trs = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table class="data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

function main() {
  const [, , outPath, reportId, dateLabel] = process.argv;
  if (!outPath || !reportId || !dateLabel) {
    console.error("usage: bun scripts/ops_report_template.ts <out-path> <report-id> <date-label>");
    process.exit(2);
  }

  const banners = [
    alertBox(
      "green",
      `Status: ALL SYSTEMS OPERATIONAL ${tag("ENGINE IDLE", "pass")} ${tag("LANES ARMED", "pass")} ${tag("AWAITING NEXT STATEMENT", "warn")}`,
      `<p style="margin:0">Engine idle and fully verified. Every lane is armed and the three-channel delivery contract (chat + inbox + portal) is active. The next statement upload exercises all lanes automatically.</p>`
    ),
  ];

  const kpis = kpiGrid([
    kpiCard("Mail Pipeline", "RESTORED", "IMAP LOGIN OK · SMTP live · TEST_MAIL_TO lock active (2nd reset recovery)", "success"),
    kpiCard("Production Queue", "CLEAR", "attempted 0 · delivered 0 · draft 0 · analyst 0 · remaining 0", "success"),
    kpiCard("Rules Contract", "8 / 8", "portal &amp; agent in sync · parser eis-ts/3.0 · lessons loop active", "success"),
    kpiCard("Pending On Client", "3", "new statement upload · cron-job.org activation · Al Ahly re-upload (optional)", "warning"),
  ]);

  const mail = sectionTitle("1 · Mail Pipeline — Restored (2nd Reset Recovery)") + tbl(
    ["Item", "Status", "Detail"],
    [
      ["Credentials file", tag("REBUILT", "pass"), "config/mail_credentials.json — Gmail shape, locked to ahmedr.muhammed19@gmail.com, chmod 600, git-ignored"],
      ["IMAP smoke test", tag("LOGIN OK", "pass"), "imap.gmail.com:993 SSL, read-only verification via scripts/check_inbox.py"],
      ["Inbox volume", tag("471 MAILS", ""), "Last Global EIS mails 03 Oct 18:55Z (EIS-MQAHR completion) — no new statements since"],
      ["TEST_MAIL_TO lock", tag("ACTIVE", "pass"), "Every outbound mail force-redirected to the test inbox; SMTP-side double guard"],
      ["Local .env", tag("RESTORED", "pass"), "SESSION_SECRET + TEST_MAIL_TO + PORTAL_BASE_URL (fresh 32-byte hex secret)"],
    ]
  );

  const rules: Array<[string, string]> = [
    ["6-month embassy window", "Out-of-window rows trimmed and reported as window notes (engine + analyst reports)"],
    ["Balance-chain gate 100%", "Every row reconciles against the bank's own running balances before auto-delivery (AUTO_DELIVER_MIN=1)"],
    ["OCR shadow rule", "Scan-recovered drafts are NEVER auto-delivered; they always park for analyst review"],
    ["Big-scan triage", "Scans above the 6-page OCR cap skip OCR and route to the analyst in seconds — no serverless timeout"],
    ["Mail lock", "Every outbound email forced to ahmedr.muhammed19@gmail.com via TEST_MAIL_TO"],
    ["Lessons loop", "ParseLog on every attempt; fingerprint-deduped lesson mails; telemetry at /api/engine/logs"],
    ["Report design", "Global EIS template (primary #005677 / secondary #008DCB) — this very document"],
    ["Benchmarks", "Per-country EGP closing-balance thresholds (default 150k EGP)"],
  ];
  const portal = sectionTitle("2 · Production Portal — Healthy") +
    `<p class="small" style="margin-top:0">Deployment live at ailive-three.vercel.app · queue clear · parser <strong>eis-ts/3.0</strong> · self-improvement ALLOWED &amp; active.</p>` +
    tbl(
      ["Rule", "Status", "Detail"],
      rules.map(([r, d]) => [escHtml(r), tag("PASS", "pass"), escHtml(d)])
    );

  const lanes = sectionTitle("3 · Engine Lanes — All Armed") + tbl(
    ["Incoming Type", "Route", "Speed"],
    [
      [`<strong>Digital PDF</strong> (text layer)`, "Fast lane: extract → parse → 100% balance chain required → auto-deliver", tag("SECONDS", "low")],
      [`<strong>Scanned PDF &gt; 6 pages</strong>`, "Big-scan triage → analyst forensic pipeline (no timeout)", tag("SECONDS TO ROUTE", "low")],
      [`<strong>Scanned PDF ≤ 6 pages / JPG</strong>`, "Shadow OCR → draft → analyst review → deliver", tag("MINUTES", "low")],
    ]
  );

  const pending = sectionTitle("4 · Pending On Client Side") + tbl(
    ["#", "Item", "Status", "Why It Matters"],
    [
      ["1", "<strong>New bank statement</strong>", tag("WAITING", "warn"), "The only blocker — upload via the portal; lanes route it automatically (digital → fast lane, scan → analyst triage)"],
      ["2", "<strong>cron-job.org activation</strong>", tag("WAITING", "warn"), "2 activation mails unopened in the inbox — activate, then point the cron at the mission-brief link for auto-firing"],
      ["3", "<strong>Al Ahly 48-page scan</strong> (optional)", tag("WAITING", "warn"), "Cleared with the queue — re-upload if that analysis is still needed; triage routes it in seconds"],
    ]
  );

  const links = sectionTitle("5 · Key Links") +
    `<div class="analysis-card full-width"><h3>Queue Control (HMAC path-form trust)</h3><ul>
<li><strong>Mission brief</strong> (fires a full pass on open): <code>…/api/queue/go/93bdc3882cbf290a69324f3e6c3fbd82/brief</code></li>
<li><strong>One-tap pass</strong>: <code>…/api/queue/go/93bdc3882cbf290a69324f3e6c3fbd82/pass</code></li>
<li><strong>Read-only status</strong>: <code>…/api/queue/go/93bdc3882cbf290a69324f3e6c3fbd82/status</code></li>
<li><strong>This report on the portal</strong>: Reports list → ${escHtml(outPath.split("/").pop() ?? "")} (operator sign-in)</li>
</ul></div>`;

  const delivery = sectionTitle("6 · Delivery Contract") +
    alertBox(
      "blue",
      "One source, three channels",
      `<ul style="margin:0 0 0 20px;padding:0">
<li><strong>Chat</strong> — rendered report posted in the agent conversation (standing rule REPORT-HERE-1).</li>
<li><strong>Inbox</strong> — this HTML as the mail body (renders inline in Gmail) + attached file, sent through the portal's own SMTP path.</li>
<li><strong>Portal</strong> — published to the reports list via /api/queue/publish-report (same HMAC trust); served by /api/report/download.</li>
</ul>`
    );

  const html = reportShell({
    title: "Operations Status Report",
    subLines: [
      `<strong>${escHtml(reportId)}</strong> · v2 — firm canonical template`,
      `${escHtml(dateLabel)} · Delivery: chat + inbox + portal`,
    ],
    banners,
    contentHtml: kpis + mail + portal + lanes + pending + links + delivery,
    pageTitle: "Global EIS - Operations Status Report",
  });

  return writeFile(outPath, html, "utf8").then(() => {
    console.log(`WROTE ${outPath} (${Buffer.byteLength(html)} bytes)`);
  });
}

main();
