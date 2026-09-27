import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionAccount } from "@/lib/session";
import { isOperator, ownedScope } from "@/lib/authz";

/** GET /api/queue — queue list (operators see all; clients only their own cases).
 *
 * Each row carries `needsManual`: the engine's latest ParseLog attempt for the
 * case ended in "unrecognized"/"no-files" — the UI shows these ANALYZING rows
 * with a RED badge so the operator can tell "engine gave up, needs you" apart
 * from "auto-analysis in progress". Cases auto-parked for review (draft ready)
 * stay yellow — they need review, not rescue.
 */
export async function GET(req: Request) {
  const account = await sessionAccount(req);
  if (!account) {
    return NextResponse.json(
      { ok: false, error: "Sign in required." },
      { status: 401 }
    );
  }

  const rows = await db.submission.findMany({
    where: isOperator(account) ? undefined : ownedScope(account.username),
    orderBy: { createdAt: "desc" },
    include: { files: { select: { id: true, originalName: true } } },
  });

  // Latest engine outcome per case -> "needs manual" flag (red in the queue).
  const MANUAL_OUTCOMES = new Set(["unrecognized", "no-files"]);
  const ids = rows.map((r) => r.id);
  const logs = ids.length
    ? await db.parseLog.findMany({
        where: { submissionId: { in: ids } },
        orderBy: { createdAt: "desc" },
        select: { submissionId: true, outcome: true },
      })
    : [];
  const lastOutcome = new Map<string, string>();
  for (const l of logs) {
    if (l.submissionId && !lastOutcome.has(l.submissionId)) lastOutcome.set(l.submissionId, l.outcome);
  }

  const queue = rows.map((r) => ({
    id: r.id,
    userId: r.userId ?? "—",
    status: r.status,
    clientName: r.clientName,
    country: r.country,
    visaType: r.visaType,
    travelers: r.travelers,
    email: r.email,
    notes: r.notes,
    submittedBy: r.submittedBy,
    needsManual: MANUAL_OUTCOMES.has(lastOutcome.get(r.id) ?? ""),
    analyzedAt: r.analyzedAt?.toISOString() ?? null,
    fileCount: r.files.length,
    files: r.files.map((f) => ({ id: f.id, name: f.originalName })),
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json({ ok: true, queue });
}
