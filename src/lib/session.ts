import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

/**
 * Portal authentication — per-account ID + password with signed session cookies.
 *
 * - Passwords: scrypt (node:crypto), stored as `scrypt$<salt b64>$<hash b64>`.
 *   The exact same format is implemented in scripts/add-user.mjs — keep both in sync.
 * - Sessions: HMAC-SHA256-signed payload cookie (`eis_session`), HttpOnly, 30 days.
 * - SESSION_SECRET must exist (>=16 chars) or every session check fails closed.
 */

export const SESSION_COOKIE = "eis_session";
export const SESSION_MAX_AGE = 30 * 24 * 3600; // 30 days, seconds

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET missing or too short (need >= 16 chars)");
  }
  return s;
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------- signed session token ----------

export function createSessionToken(username: string): { token: string; maxAge: number } {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE })
  ).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, maxAge: SESSION_MAX_AGE };
}

/** Returns the username embedded in a valid, unexpired token — else null. */
export function readSessionToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u?: string;
      exp?: number;
    };
    if (!u || typeof exp !== "number" || exp * 1000 < Date.now()) return null;
    return u;
  } catch {
    return null;
  }
}

// ---------- request helpers ----------

function cookieToken(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const kv = part.trim();
    if (kv.startsWith(SESSION_COOKIE + "=")) {
      return decodeURIComponent(kv.slice(SESSION_COOKIE.length + 1));
    }
  }
  return null;
}

/**
 * Resolve the signed-in account from the request cookie.
 * Verifies the account still exists and is active (deactivation kills sessions).
 */
export async function sessionUser(req: Request): Promise<string | null> {
  const user = await sessionAccount(req);
  return user?.username ?? null;
}

/**
 * Same as sessionUser() but returns the full account row (includes role).
 * Used by operator-guarded routes (e.g. account management).
 */
export async function sessionAccount(
  req: Request
): Promise<{ id: string; username: string; label: string | null; role: string } | null> {
  const username = readSessionToken(cookieToken(req));
  if (!username) return null;
  const user = await db.portalUser.findUnique({ where: { username } });
  if (!user || !user.active) return null;
  return { id: user.id, username: user.username, label: user.label, role: user.role };
}

/** Username syntax enforced everywhere accounts are created (setup, add-user, portal). */
export function validUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(username);
}

/** Normalize a login ID: trim + lowercase (usernames are stored lowercase). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 40);
}
