import { NextResponse } from "next/server";
import { sessionUser } from "@/lib/session";

/** GET /api/me — returns the signed-in account, or null when not signed in. */
export async function GET(req: Request) {
  try {
    const username = await sessionUser(req);
    return NextResponse.json({ ok: true, user: username });
  } catch (err) {
    // Session secret misconfigured etc. — fail closed but with a clear message.
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Session check failed.",
      },
      { status: 500 }
    );
  }
}
