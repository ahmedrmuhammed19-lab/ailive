import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accessCodeValid } from "@/lib/portal";

/** GET /api/queue?code=... — full queue list for the operator (behind access code). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!accessCodeValid(searchParams.get("code"))) {
    return NextResponse.json(
      { ok: false, error: "Invalid access code." },
      { status: 401 }
    );
  }

  const rows = await db.submission.findMany({
    orderBy: { createdAt: "desc" },
    include: { files: { select: { id: true } } },
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
    analyzedAt: r.analyzedAt?.toISOString() ?? null,
    fileCount: r.files.length,
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json({ ok: true, queue });
}
