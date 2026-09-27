import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed one-way action links for operator emails.
 *
 * The upload alert email carries a "Start Analysis" button whose URL embeds an
 * HMAC-SHA256 token derived from the submission id + action, keyed with
 * SESSION_SECRET. Only the portal can mint valid URLs — anyone receiving the
 * email can click it, but nobody can forge links for other submissions.
 *
 * BASE URL: production deployment is the default; override with PORTAL_BASE_URL
 * (e.g. preview deployments) without touching code.
 */

export const PORTAL_BASE_URL = (process.env.PORTAL_BASE_URL || "https://ailive-three.vercel.app").replace(/\/+$/, "");

export type QueueAction = "start" | "retry";

const ACTIONS: ReadonlySet<string> = new Set(["start", "retry"]);

export function isQueueAction(v: string): v is QueueAction {
  return ACTIONS.has(v);
}

function actionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET missing or too short (need >= 16 chars)");
  }
  return s;
}

/** HMAC token for a submission+action pair (lowercase hex, 32 chars). */
export function actionToken(submissionId: string, action: QueueAction): string {
  return createHmac("sha256", actionSecret())
    .update(`${submissionId}:${action}`)
    .digest("hex")
    .slice(0, 32);
}

/** Constant-time token check (accepts any casing). */
export function verifyActionToken(submissionId: string, action: QueueAction, token: string): boolean {
  const expected = Buffer.from(actionToken(submissionId, action));
  const given = Buffer.from((token ?? "").toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Fully-qualified action URL to embed in emails. */
export function actionUrl(submissionId: string, action: QueueAction): string {
  return `${PORTAL_BASE_URL}/api/queue/action?id=${encodeURIComponent(submissionId)}&action=${action}&token=${actionToken(submissionId, action)}`;
}
