import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyActionToken, WORK_ALL_ID } from "@/lib/actions";
import { workTheQueue } from "@/lib/queue-work";
import { buildMissionBriefHtml, type BriefTelemetry } from "@/lib/queue-brief";

/**
 * GET /api/queue/go/<token>/brief — the ONE-LINK MISSION BRIEF.
 *
 * Same signed path-form trust model as /go/<token> and /go/<token>/status:
 * the token is the 32-hex HMAC of (__queue__:workall) keyed with SESSION_SECRET;
 * holding the link IS the authority. A wrong token answers 404, no detail.
 *
 * What makes it "brief" instead of "status": opening it FIRES a full queue
 * pass (exactly like work-all) and then renders a single page that contains
 * everything the workspace analyst needs to start their job from the link
 * alone — the pass tally, per-case work orders with signed statement-view
 * links, explicit analyst orders for big scans and drafts, the
 * self-improvement state (ParseLog totals, parser version, lessons loop),
 * and the standing rules contract shared by the portal and the agent.
 *
 * Designed to be read by link-preview / page-reader tools: plain inline-styled
 * HTML, no JS, no query strings anywhere in the URL.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300; // the pass may OCR small scans — same budget as work-all

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!verifyActionToken(WORK_ALL_ID, "workall", token ?? "")) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const r = await workTheQueue();

  let telemetry: BriefTelemetry = {
    parseLogTotal: 0,
    lastOutcome: null,
    lastParserVersion: null,
    lastAt: null,
  };
  try {
    const [total, last] = await Promise.all([
      db.parseLog.count(),
      db.parseLog.findFirst({ orderBy: { createdAt: "desc" } }),
    ]);
    telemetry = {
      parseLogTotal: total,
      lastOutcome: last?.outcome ?? null,
      lastParserVersion: last?.parserVersion ?? null,
      lastAt: last?.createdAt ?? null,
    };
  } catch {
    // telemetry must never break the brief
  }

  return new NextResponse(buildMissionBriefHtml(r, telemetry), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
