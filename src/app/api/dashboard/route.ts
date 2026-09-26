import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accessCodeValid } from "@/lib/portal";

function dayKey(d: Date): string {
  // Local (server) date key YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * GET /api/dashboard?code=...&month=YYYY-MM
 * Returns operator stats: today counters, totals by status, and per-day
 * uploaded/analyzed counts for the requested month (calendar heatmap).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!accessCodeValid(searchParams.get("code"))) {
    return NextResponse.json(
      { ok: false, error: "Invalid access code." },
      { status: 401 }
    );
  }

  const all = await db.submission.findMany({
    select: { status: true, createdAt: true, analyzedAt: true },
  });

  const today = dayKey(new Date());
  let uploadedToday = 0;
  let analyzedToday = 0;
  const totals = { WAITING: 0, ANALYZING: 0, DONE: 0 };

  for (const r of all) {
    if (dayKey(r.createdAt) === today) uploadedToday++;
    if (r.analyzedAt && dayKey(r.analyzedAt) === today) analyzedToday++;
    if (r.status in totals) totals[r.status as keyof typeof totals]++;
  }

  // --- Month grid data (default: current month) ---
  const monthParam = searchParams.get("month");
  const base = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? new Date(Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1, 1)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const year = base.getFullYear();
  const month = base.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const perDay: Record<string, { uploaded: number; analyzed: number }> = {};
  for (const r of all) {
    const ck = dayKey(r.createdAt);
    const ak = r.analyzedAt ? dayKey(r.analyzedAt) : null;
    if (ck.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) {
      perDay[ck] = perDay[ck] ?? { uploaded: 0, analyzed: 0 };
      perDay[ck].uploaded++;
    }
    if (ak && ak.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) {
      perDay[ak] = perDay[ak] ?? { uploaded: 0, analyzed: 0 };
      perDay[ak].analyzed++;
    }
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    return {
      date: key,
      day: i + 1,
      weekday: new Date(year, month, i + 1).getDay(), // 0=Sun
      uploaded: perDay[key]?.uploaded ?? 0,
      analyzed: perDay[key]?.analyzed ?? 0,
    };
  });

  return NextResponse.json({
    ok: true,
    today: { uploaded: uploadedToday, analyzed: analyzedToday },
    totals: { ...totals, all: all.length },
    month: { key: `${year}-${String(month + 1).padStart(2, "0")}`, label: base.toLocaleString("en-US", { month: "long", year: "numeric" }), days },
  });
}
