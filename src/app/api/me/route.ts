import { NextResponse } from "next/server";
import { sessionAccount } from "@/lib/session";

/** GET /api/me — returns the signed-in account (username/label/role), or null when signed out. */
export async function GET(req: Request) {
  try {
    const account = await sessionAccount(req);
    return NextResponse.json({ ok: true, user: account });
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
