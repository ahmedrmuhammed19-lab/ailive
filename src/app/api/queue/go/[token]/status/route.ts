import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyActionToken, WORK_ALL_ID } from "@/lib/actions";

/**
 * GET /api/queue/go/<token>/status — session-free, READ-ONLY queue snapshot.
 *
 * Companion to the path-form work-all jump link (same token, same trust
 * model): answers fast with the current queue state WITHOUT running the
 * engine, so link-preview readers with short navigation windows can render
 * it. Each pending case lists its files and published reports so the
 * operator sees exactly what a work pass would act on (and what a pass
 * already produced), straight from any device.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!verifyActionToken(WORK_ALL_ID, "workall", token ?? "")) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const [subs, reports] = await Promise.all([
    db.submission.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        status: true,
        clientName: true,
        email: true,
        analyzedAt: true,
        createdAt: true,
        files: { select: { originalName: true, sizeBytes: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    db.reportFile.findMany({
      select: { submissionId: true, queueId: true, name: true, sizeBytes: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const reportsBy = new Map<string, { name: string; sizeBytes: number; createdAt: Date }[]>();
  for (const r of reports) {
    const key = r.submissionId ?? "";
    if (!reportsBy.has(key)) reportsBy.set(key, []);
    reportsBy.get(key)!.push({ name: r.name, sizeBytes: r.sizeBytes, createdAt: r.createdAt });
  }

  const cases = subs.map((s) => ({
    queueId: s.userId || s.id.slice(-8),
    status: s.status,
    clientName: s.clientName,
    email: s.email,
    createdAt: s.createdAt,
    analyzedAt: s.analyzedAt,
    files: s.files.map((f) => f.originalName),
    reports: reportsBy.get(s.id) ?? [],
  }));

  const counts = cases.reduce<Record<string, number>>((a, c) => {
    a[c.status] = (a[c.status] ?? 0) + 1;
    return a;
  }, {});

  return NextResponse.json(
    { ok: true, now: new Date().toISOString(), counts, total: cases.length, cases },
    { headers: { "cache-control": "no-store" } }
  );
}
