import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionAccount } from "@/lib/session";
import { isOperator } from "@/lib/authz";
import { runEngine } from "@/lib/engine-run";

/**
 * POST /api/queue/retry { id } — operator-only engine trigger from the portal.
 *
 * Fires (or re-fires) the auto-analysis engine on one non-DONE submission:
 *   WAITING   -> runs the engine now (the honest "Start analysis" button)
 *   ANALYZING -> re-runs it: fresh parse, fresh draft or auto-delivery decision
 *                (the step-forward for yellow draft-review and red
 *                "Needs manual" rows, e.g. after the client sends a better PDF)
 *   DONE      -> rejected — reopen first if really needed
 *
 * The engine run is identical to the signed email links (engine-run.ts):
 * publish report, auto-deliver at 100% chain integrity, operator alert mail,
 * ParseLog telemetry + lesson-learned loop. Returns the outcome as JSON so
 * the queue panel can reflect the new state immediately.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
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

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ ok: false, error: "Submission id is required." }, { status: 400 });
  }

  const sub = await db.submission.findUnique({
    where: { id: body.id },
    select: { id: true, userId: true, status: true },
  });
  if (!sub) {
    return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });
  }
  if (sub.status === "DONE") {
    return NextResponse.json(
      { ok: false, error: "Case is already DONE — reopen it first if you really need a re-run." },
      { status: 409 }
    );
  }

  const label = sub.userId || sub.id.slice(-8);
  await db.submission.update({
    where: { id: sub.id },
    data: { status: "ANALYZING", analyzedAt: null },
  });

  const run = await runEngine(sub, label);
  return NextResponse.json({
    ok: true,
    id: sub.id,
    queueId: label,
    outcome: run.outcome,
    integrity: run.integrity,
    message: run.message,
    reportName: run.reportName ?? null,
    telemetry: run.telemetry,
  });
}
