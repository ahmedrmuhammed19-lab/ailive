import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendCompletionMails } from "@/lib/notify";
import { sessionAccount } from "@/lib/session";
import { isOperator } from "@/lib/authz";

/**
 * POST /api/queue/complete-all — operator-only "green the whole queue".
 *
 * Flips every non-DONE submission to DONE with sensible email safety:
 *   - rows WITHOUT a client email (demo/stray rows): stamped DONE silently,
 *     no emails at all;
 *   - rows WITH a client email AND at least one published report: stamped
 *     DONE and the client receives the normal report-ready delivery;
 *   - rows WITH a client email but NO report: left untouched — sending a
 *     "report ready" mail with nothing attached would be wrong. The response
 *     lists them so the operator can finish those cases first.
 */
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

  const pending = await db.submission.findMany({
    where: { status: { not: "DONE" } },
    include: { files: { select: { id: true } } },
  });
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, flipped: 0, delivered: 0, silent: 0, skipped: [] });
  }

  const withReports = new Set(
    (
      await db.reportFile.findMany({
        where: { submissionId: { in: pending.map((s) => s.id) } },
        select: { submissionId: true },
      })
    ).map((r) => r.submissionId)
  );

  let delivered = 0;
  let silent = 0;
  const skipped: Array<{ id: string; queueId: string | null; reason: string }> = [];

  for (const sub of pending) {
    const hasEmail = Boolean(sub.email?.trim());
    const hasReport = withReports.has(sub.id);

    if (hasEmail && !hasReport) {
      skipped.push({
        id: sub.id,
        queueId: sub.userId,
        reason: "client email on file but no published report — finish this case first",
      });
      continue;
    }

    const updated = await db.submission.update({
      where: { id: sub.id },
      data: { status: "DONE", analyzedAt: new Date() },
    });

    if (hasEmail && hasReport) {
      // Real client case — full report-ready delivery (client + operator copy).
      await sendCompletionMails(updated);
      delivered++;
    } else {
      // Demo / no-email row — silent green, no mail noise.
      silent++;
    }
  }

  return NextResponse.json({
    ok: true,
    flipped: delivered + silent,
    delivered,
    silent,
    skipped,
  });
}
