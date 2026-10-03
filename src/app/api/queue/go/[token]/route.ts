import { NextResponse } from "next/server";
import { verifyActionToken, WORK_ALL_ID, workAllUrl } from "@/lib/actions";

/**
 * GET /api/queue/go/<token> — the work-all magic link in PATH form.
 *
 * Identical trust model to /api/queue/work-all?token=<hmac>: the token is the
 * same 32-hex HMAC of (__queue__:workall) keyed with SESSION_SECRET, passed in
 * the URL PATH instead of the query string. Some page fetchers / link-preview
 * readers strip query strings while preserving the path, which made the
 * query-form link unopenable from those tools (the server saw no token and
 * answered 403). The path form survives them.
 *
 * No new capability is introduced: the check is the exact same
 * verifyActionToken(WORK_ALL_ID, "workall") — holding the path link IS holding
 * the magic link, nothing more. On a valid token the caller is redirected
 * (307, same origin) to the canonical signed work-all URL, minted fresh at
 * call time, so every behavior (HTML result page, per-case links, batching)
 * stays defined in exactly one place.
 *
 * A wrong or stale token answers 404 with no detail, exactly like any
 * unknown route.
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
  return NextResponse.redirect(workAllUrl(), 307);
}
