import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionAccount } from "@/lib/session";
import { isOperator } from "@/lib/authz";

/**
 * GET /api/engine/logs — self-improvement telemetry (requires a signed-in account).
 *
 * Lists the last 50 ParseLog rows: one per auto-analysis attempt, with outcome,
 * detected layout modes, parser version and chain integrity — plus the unmatched
 * rows (training evidence for below-threshold cases). `?id=<logId>` returns the
 * full row including the raw PDF text sample captured for unrecognized layouts.
 */
export async function GET(req: Request) {
  const account = await sessionAccount(req);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  if (!isOperator(account)) {
    return NextResponse.json(
      { ok: false, error: "Operator account required — engine telemetry is internal." },
      { status: 403 }
    );
  }

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const row = await db.parseLog.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ ok: false, error: "Log not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, log: row });
  }

  const logs = await db.parseLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      submissionId: true,
      queueId: true,
      outcome: true,
      modes: true,
      parserVersion: true,
      legs: true,
      integrityMin: true,
      integrityAvg: true,
      unmatched: true,
      createdAt: true,
      // textSample omitted in list view (can be 16KB) — fetch with ?id=
    },
  });
  return NextResponse.json({ ok: true, count: logs.length, logs });
}
