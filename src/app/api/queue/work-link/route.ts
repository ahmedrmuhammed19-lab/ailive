import { NextResponse } from "next/server";
import { sessionAccount } from "@/lib/session";
import { isOperator } from "@/lib/authz";
import { workAllUrl } from "@/lib/actions";

/**
 * GET /api/queue/work-link — operator-only helper for the queue toolbar.
 *
 * Returns the signed, session-free "work the queue" URL (same HMAC scheme as
 * the email action links). The operator copies it once, bookmarks it or mails
 * it to themselves — opening it afterwards works the whole queue in one tap
 * without signing in. Only the portal can mint the URL; possession of the
 * link IS the authorization (identical trust model to the email buttons).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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

  return NextResponse.json({ ok: true, url: workAllUrl() });
}
