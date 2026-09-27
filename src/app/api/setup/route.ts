import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import {
  createSessionToken,
  hashPassword,
  normalizeUsername,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  validUsername,
} from "@/lib/session";

/**
 * First-run account bootstrap for fresh deployments.
 *
 * GET  /api/setup  -> { users, available, reason? }
 *   available === true only when (a) the users table is EMPTY and
 *   (b) the SETUP_KEY env var is set on the server. Otherwise a reason
 *   is reported so the operator knows what to fix.
 *
 * POST /api/setup  { setupKey, username, password, label? }
 *   Creates the FIRST account (role "operator") and signs the caller in.
 *   Rejected once any account exists — this endpoint is one-shot by design.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const failures = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_FAILS = 5;

function tooManyAttempts(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.windowStart > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILS;
}

function recordFailure(ip: string) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    f.count += 1;
  }
}

function setupKeyMatches(provided: string): boolean {
  const expected = process.env.SETUP_KEY ?? "";
  if (expected.length < 16) return false; // too short to be meaningful
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function ipOf(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

export async function GET() {
  try {
    const users = await db.portalUser.count();
    if (users > 0) {
      return NextResponse.json({
        users,
        available: false,
        reason: "Portal already has accounts — sign in normally.",
      });
    }
    const keySet = (process.env.SETUP_KEY ?? "").length >= 16;
    return NextResponse.json({
      users,
      available: keySet,
      reason: keySet ? undefined : "SETUP_KEY env var is not set on the server.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        users: -1,
        available: false,
        reason:
          "Database not reachable — check DATABASE_URL. " +
          (err instanceof Error ? err.message : ""),
      },
      { status: 503 }
    );
  }
}

export async function POST(req: Request) {
  let body: { setupKey?: string; username?: string; password?: string; label?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const ip = ipOf(req);
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many failed attempts — wait a minute and try again." },
      { status: 429 }
    );
  }

  const fail = (msg: string, status = 403) => {
    recordFailure(ip);
    return NextResponse.json({ ok: false, error: msg }, { status });
  };

  // Gate 1 — the one-time setup key (constant-time compare).
  const setupKey = body.setupKey ?? "";
  if (!setupKey || !setupKeyMatches(setupKey)) {
    await sleep(500);
    return fail("Wrong setup key.", 401);
  }

  // Gate 2 — one-shot: only when the portal has no accounts at all.
  let userCount = 0;
  try {
    userCount = await db.portalUser.count();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Database not reachable — check DATABASE_URL. " +
          (err instanceof Error ? err.message : ""),
      },
      { status: 503 }
    );
  }
  if (userCount > 0) {
    return fail("Setup is closed — the portal already has accounts.");
  }

  // Gate 3 — account field validation.
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  const label = (body.label ?? "").trim().slice(0, 60) || null;
  if (!validUsername(username)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ID must be 3-40 characters: letters, numbers, dots, dashes, underscores (start with a letter or number).",
      },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const user = await db.portalUser.create({
    data: { username, passwordHash: hashPassword(password), label, role: "operator" },
  });

  const { token, maxAge } = createSessionToken(user.username);
  const res = NextResponse.json({
    ok: true,
    user: { username: user.username, label: user.label, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  failures.delete(ip);
  return res;
}
