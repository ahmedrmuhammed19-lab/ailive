import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionUser } from "@/lib/session";

/** GET /api/queue — full queue list (requires a signed-in account). */
export async function GET(req: Request) {
  const user = await sessionUser(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in required." },
      { status: 401 }
    );
  }

  const rows = await db.submission.findMany({
    orderBy: { createdAt: "desc" },
    include: { files: { select: { id: true, originalName: true } } },
  });

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
    analyzedAt: r.analyzedAt?.toISOString() ?? null,
    fileCount: r.files.length,
    files: r.files.map((f) => ({ id: f.id, name: f.originalName })),
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json({ ok: true, queue });
}
