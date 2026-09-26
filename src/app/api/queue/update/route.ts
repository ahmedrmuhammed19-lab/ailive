import { NextResponse } from "next/server";
import { existsSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { REPORTS_DIR } from "@/lib/portal";
import { loadMailCreds, OPERATOR_EMAIL, operatorAddress, sendOrQueue } from "@/lib/mail";
import { sessionUser } from "@/lib/session";

/**
 * POST /api/queue/update — operator actions on a queue item:
 *   { id, status?, clientName?, country?, visaType?, email?, notes?, reportNames? }
 * Moving to DONE stamps analyzedAt and emails the "report ready" notice
 * (client if their email is on file, operator always gets a copy).
 * Email delivery is HTML-only: the .html report is attached, PDF is not sent.
 */
export async function POST(req: Request) {
  let body: {
    id?: string;
    status?: string;
    clientName?: string;
    country?: string;
    visaType?: string;
    travelers?: number;
    email?: string;
    notes?: string;
    reportNames?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  if (!body.id) {
    return NextResponse.json({ ok: false, error: "Submission id is required." }, { status: 400 });
  }

  const existing = await db.submission.findUnique({
    where: { id: body.id },
    include: { files: { select: { originalName: true } } },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });
  }

  const VALID = ["WAITING", "ANALYZING", "DONE"];
  const nextStatus = body.status?.toUpperCase();
  if (nextStatus && !VALID.includes(nextStatus)) {
    return NextResponse.json(
      { ok: false, error: `Invalid status — use ${VALID.join(" / ")}.` },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (nextStatus) data.status = nextStatus;
  if (body.clientName !== undefined) data.clientName = body.clientName.trim() || null;
  if (body.country !== undefined) data.country = body.country.trim() || null;
  if (body.visaType !== undefined) data.visaType = body.visaType.trim() || null;
  if (body.travelers !== undefined) {
    const t = Number(body.travelers);
    if (!Number.isInteger(t) || t < 1 || t > 20) {
      return NextResponse.json(
        { ok: false, error: "travelers must be an integer between 1 and 20." },
        { status: 400 }
      );
    }
    data.travelers = t;
  }
  if (body.email !== undefined) data.email = body.email.trim() || null;
  if (body.notes !== undefined) data.notes = body.notes.trim() || null;
  if (nextStatus === "DONE") data.analyzedAt = new Date();
  if (nextStatus && nextStatus !== "DONE") data.analyzedAt = null;

  const updated = await db.submission.update({ where: { id: body.id }, data });

  // --- Report-ready email on completion ---
  let notified: { to: string; queued: boolean } | null = null;
  if (nextStatus === "DONE" && existing.status !== "DONE") {
    const reportList =
      (body.reportNames ?? []).map((n) => `  • ${n}`).join("\n") ||
      "  • (report files being published)";
    // Attach the HTML report only (per delivery policy: HTML, no PDF).
    // Traversal-safe: resolved inside REPORTS_DIR only.
    const base = path.resolve(REPORTS_DIR);
    const attachments: Array<{ filename: string; path: string }> = [];
    const seen = new Set<string>();
    for (const name of body.reportNames ?? []) {
      const target = path.resolve(base, name);
      const ext = path.extname(target).toLowerCase();
      if (
        !target.startsWith(base + path.sep) ||
        ext !== ".html" ||
        !existsSync(target)
      ) {
        continue;
      }
      if (seen.has(path.basename(target))) continue;
      attachments.push({ filename: path.basename(target), path: target });
      seen.add(path.basename(target));
    }
    const greet = updated.clientName ? `Dear ${updated.clientName},` : "Hello,";
    const clientMail = {
      to: updated.email?.trim() || operatorAddress(await loadMailCreds()),
      subject: `Global EIS — analysis report ready (Queue ${updated.userId ?? ""})`,
      body:
        `${greet}\n\n` +
        `The financial readiness assessment for queue item ${updated.userId ?? updated.id} is complete.\n\n` +
        `Reports:\n${reportList}\n` +
        (attachments.length
          ? `\nAttached (HTML report):\n${attachments.map((a) => `  • ${a.filename}`).join("\n")}\n`
          : "") +
        (updated.country
          ? `\nDestination: ${updated.country}${updated.visaType ? ` — ${updated.visaType}` : ""}${
              (updated.travelers ?? 1) > 1 ? ` (${updated.travelers} joint applicants sharing this statement)` : ""
            }\n`
          : "") +
        `\nThe report is also available on the Global EIS portal under "Reports" (ID & password required), ` +
        `and replies reach us directly at ${OPERATOR_EMAIL}.\n\n` +
        `Kind regards,\nGlobal EIS — Financial Intelligence Services`,
      kind: "report_ready" as const,
      submissionId: updated.id,
      attachments,
    };
    const res = await sendOrQueue(clientMail);
    notified = { to: clientMail.to, queued: res.queued };
    // Operator always gets a completion copy
    await sendOrQueue({
      to: operatorAddress(await loadMailCreds()),
      subject: `✅ Analysis finished — Queue ${updated.userId ?? ""}`,
      body:
        `Analysis completed and marked DONE.\n\n` +
        `Queue ID   : ${updated.userId ?? updated.id}\n` +
        `Client     : ${updated.clientName ?? "—"}\n` +
        `Destination: ${updated.country ?? "—"} · ${updated.visaType ?? "—"}\n` +
        `Joint applicants: ${updated.travelers ?? 1}\n` +
        `Reports:\n${reportList}\n\n` +
        `— Global EIS automated intake`,
      kind: "operator_alert",
      submissionId: updated.id,
    });
  }

  return NextResponse.json({
    ok: true,
    submission: {
      id: updated.id,
      userId: updated.userId,
      status: updated.status,
      analyzedAt: updated.analyzedAt?.toISOString() ?? null,
    },
    notified,
  });
}
