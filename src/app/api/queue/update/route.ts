import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendCompletionMails } from "@/lib/notify";
import { sessionAccount } from "@/lib/session";
import { isOperator } from "@/lib/authz";

/**
 * POST /api/queue/update — operator actions on a queue item:
 *   { id, status?, clientName?, country?, visaType?, email?, notes?, reportNames? }
 * Moving to DONE stamps analyzedAt and emails the "report ready" notice
 * (client if their email is on file, operator always gets a copy).
 * Email delivery is HTML-only: the .html report is attached, PDF is not sent.
 * Operator-only — client accounts are read-only by design.
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

  const account = await sessionAccount(req);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  if (!isOperator(account)) {
    return NextResponse.json(
      { ok: false, error: "Operator account required — client accounts are read-only." },
      { status: 403 }
    );
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

  // --- Report-ready email on completion (shared flow with auto-delivery) ---
  const notified =
    nextStatus === "DONE" && existing.status !== "DONE"
      ? await sendCompletionMails(updated, body.reportNames)
      : null;

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
