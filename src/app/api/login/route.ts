import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createSessionToken,
  normalizeUsername,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  verifyPassword,
} from "@/lib/session";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Brute-force brake: sliding window of failed attempts per client IP. */
const failures = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_FAILS = 10;

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

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = (await req.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "Enter your ID and password." },
      { status: 400 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many failed attempts — wait a minute and try again." },
      { status: 429 }
    );
  }

  const user = await db.portalUser.findUnique({ where: { username } });
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    recordFailure(ip);
    await sleep(700); // uniform failure path — same timing for unknown ID and wrong password
    return NextResponse.json({ ok: false, error: "Wrong ID or password." }, { status: 401 });
  }

  await db.portalUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
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
    maxAge,
  });
  return res;
}
