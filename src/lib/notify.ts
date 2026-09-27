import { db } from "@/lib/db";
import { loadMailCreds, operatorAddress, sendOrQueue } from "@/lib/mail";
import { REPORTS_DIR } from "@/lib/portal";
import { existsSync } from "fs";
import path from "path";

/**
 * Shared "case complete" flow: stamps DONE, attaches the case's HTML reports
 * (disk first, DB bytes as serverless fallback) and emails the client — or the
 * operator when no client email is on file — plus an operator completion copy.
 *
 * Used by:
 *  - POST /api/queue/update (operator marks DONE from the portal)
 *  - GET  /api/queue/action (auto-delivery after a verified auto-analysis)
 */

export interface NotifiedSummary {
  to: string;
  queued: boolean;
  attachments: number;
}

export interface CompletionResult {
  ok: boolean;
  error?: string;
  status?: string;
  notified: NotifiedSummary | null;
  reportNames: string[];
}

/**
 * Send the report-ready mails for an already-updated submission row.
 * `reportNames` (optional) filters which reports are attached.
 */
export async function sendCompletionMails(
  submission: {
    id: string;
    userId: string | null;
    clientName: string | null;
    email: string | null;
    country: string | null;
    visaType: string | null;
    travelers: number | null;
  },
  reportNames?: string[],
  operatorNote?: string
): Promise<NotifiedSummary | null> {
  const dbReports = await db.reportFile.findMany({
    where: { submissionId: submission.id },
    orderBy: { createdAt: "asc" },
  });
  const dbList = reportNames?.length ? dbReports.filter((r) => reportNames.includes(r.name)) : dbReports;
  const names = reportNames?.length ? reportNames : dbReports.map((r) => r.name);
  const reportList = names.map((n) => `  • ${n}`).join("\n") || "  • (no report files attached)";

  // Attach the HTML report only (per delivery policy: HTML, no PDF).
  const base = path.resolve(REPORTS_DIR);
  const attachments: Array<{
    filename: string;
    path?: string;
    content?: Buffer;
    contentType?: string;
  }> = [];
  const seen = new Set<string>();
  for (const name of reportNames ?? []) {
    const target = path.resolve(base, name);
    const ext = path.extname(target).toLowerCase();
    if (!target.startsWith(base + path.sep) || ext !== ".html" || !existsSync(target)) continue;
    if (seen.has(path.basename(target))) continue;
    attachments.push({ filename: path.basename(target), path: target });
    seen.add(path.basename(target));
  }
  // DB storage mode: attach the stored bytes directly (no disk files exist).
  if (attachments.length === 0) {
    for (const r of dbList) {
      if (!r.data || !r.name.toLowerCase().endsWith(".html")) continue;
      if (seen.has(r.name)) continue;
      attachments.push({
        filename: r.name,
        content: Buffer.from(r.data),
        contentType: "text/html; charset=utf-8",
      });
      seen.add(r.name);
    }
  }

  const greet = submission.clientName ? `Dear ${submission.clientName},` : "Hello,";
  const clientMail = {
    to: submission.email?.trim() || operatorAddress(await loadMailCreds()),
    subject: `Global EIS — analysis report ready (Queue ${submission.userId ?? ""})`,
    body:
      `${greet}\n\n` +
      `The financial readiness assessment for queue item ${submission.userId ?? submission.id} is complete.\n\n` +
      `Reports:\n${reportList}\n` +
      (attachments.length
        ? `\nAttached (HTML report):\n${attachments.map((a) => `  • ${a.filename}`).join("\n")}\n`
        : "") +
      (submission.country
        ? `\nDestination: ${submission.country}${submission.visaType ? ` — ${submission.visaType}` : ""}${
            (submission.travelers ?? 1) > 1 ? ` (${submission.travelers} joint applicants sharing this statement)` : ""
          }\n`
        : "") +
      `\nThe report is also available on the Global EIS portal under "Reports" (ID & password required), ` +
      `and replies reach us directly at ${operatorAddress(await loadMailCreds())}.\n\n` +
      `Kind regards,\nGlobal EIS — Financial Intelligence Services`,
    kind: "report_ready" as const,
    submissionId: submission.id,
    attachments,
  };
  const res = await sendOrQueue(clientMail);
  // Operator always gets a completion copy
  await sendOrQueue({
    to: operatorAddress(await loadMailCreds()),
    subject: `✅ Analysis finished — Queue ${submission.userId ?? ""}`,
    body:
      `Analysis completed and marked DONE.\n\n` +
      `Queue ID   : ${submission.userId ?? submission.id}\n` +
      `Client     : ${submission.clientName ?? "—"}\n` +
      `Destination: ${submission.country ?? "—"} · ${submission.visaType ?? "—"}\n` +
      `Joint applicants: ${submission.travelers ?? 1}\n` +
      `Reports:\n${reportList}\n\n` +
      (operatorNote ? `${operatorNote}\n\n` : "") +
      `— Global EIS automated intake`,
    kind: "operator_alert" as const,
    submissionId: submission.id,
    attachments,
  });
  return { to: clientMail.to, queued: res.queued, attachments: attachments.length };
}

/**
 * Mark a submission DONE (idempotent when already DONE) and send the mails.
 */
export async function markDoneAndNotify(
  submissionId: string,
  reportNames?: string[],
  operatorNote?: string
): Promise<CompletionResult> {
  const existing = await db.submission.findUnique({ where: { id: submissionId } });
  if (!existing) return { ok: false, error: "Submission not found.", notified: null, reportNames: [] };

  let updated = existing;
  if (existing.status !== "DONE") {
    updated = await db.submission.update({
      where: { id: submissionId },
      data: { status: "DONE", analyzedAt: new Date() },
    });
  }
  const notified = await sendCompletionMails(updated, reportNames, operatorNote);
  return { ok: true, status: updated.status, notified, reportNames: reportNames ?? [] };
}
