import { db } from "@/lib/db";
import { runEngine } from "@/lib/engine-run";

/**
 * "Work the queue" — the one-tap bulk pass over every pending case.
 *
 * For each non-DONE submission (gray WAITING, yellow draft-review, red
 * needs-manual) the full engine is fired exactly like the per-row retry:
 *
 *   100% chain integrity  -> report published + case DONE + client delivery mail
 *   below the auto-delivery gate -> draft published + operator review mail
 *   unparseable / no files -> red "Needs manual" + operator alert with
 *                             fix-forward instructions
 *
 * Nothing is force-greened here: rows that do not reach the auto-delivery
 * gate stay pending for a human decision (that is what "Green all" is for).
 * The queue is therefore "worked" after one pass — every case either moved
 * forward or came back with a precise reason and an email trail.
 *
 * Batch cap: serverless functions have a hard time budget, so one pass
 * processes at most MAX_WORK_BATCH cases (oldest first) and reports how many
 * are still pending — the caller (or the operator) simply runs another pass.
 */

export const MAX_WORK_BATCH = 5;

export type WorkRowOutcome =
  | "auto-delivered"
  | "draft-review"
  | "analyst-needed"
  | "unrecognized"
  | "no-files";

export type WorkRowResult = {
  id: string;
  queueId: string;
  outcome: WorkRowOutcome;
  integrity: number[];
  message: string;
  /** Uploaded statements on this case — lets callers mint signed view links. */
  files: { id: string; name: string }[];
};

export type WorkAllResult = {
  attempted: number;
  delivered: number;
  draftReview: number;
  analystNeeded: number; // big scans triaged to the analyst (no time burned)
  needsManual: number;
  remaining: number;
  results: WorkRowResult[];
};

/** Statement files on a case — best-effort so reporting never breaks the pass. */
async function filesFor(submissionId: string): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await db.statementFile.findMany({
      where: { submissionId },
      select: { id: true, originalName: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((f) => ({ id: f.id, name: f.originalName }));
  } catch {
    return [];
  }
}

export async function workTheQueue(): Promise<WorkAllResult> {
  const batch = await db.submission.findMany({
    where: { status: { not: "DONE" } },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
    take: MAX_WORK_BATCH,
  });

  const results: WorkRowResult[] = [];

  for (const sub of batch) {
    const label = sub.userId || sub.id.slice(-8);
    const files = await filesFor(sub.id);
    // Same stamping contract as the per-row action/retry routes.
    await db.submission.update({
      where: { id: sub.id },
      data: { status: "ANALYZING", analyzedAt: null },
    });
    try {
      const run = await runEngine({ id: sub.id, userId: sub.userId }, label);
      results.push({
        id: sub.id,
        queueId: label,
        outcome: run.outcome,
        integrity: run.integrity,
        message: run.message,
        files,
      });
    } catch (err) {
      // One broken case must not stop the pass — record it as needing a human.
      results.push({
        id: sub.id,
        queueId: label,
        outcome: "unrecognized",
        integrity: [],
        message: `Engine error: ${err instanceof Error ? err.message : String(err)}`,
        files,
      });
    }
  }

  const delivered = results.filter((r) => r.outcome === "auto-delivered").length;
  const draftReview = results.filter((r) => r.outcome === "draft-review").length;
  const analystNeeded = results.filter((r) => r.outcome === "analyst-needed").length;
  const needsManual = results.filter(
    (r) => r.outcome === "unrecognized" || r.outcome === "no-files"
  ).length;
  const remaining = await db.submission.count({ where: { status: { not: "DONE" } } });

  return { attempted: results.length, delivered, draftReview, analystNeeded, needsManual, remaining, results };
}
