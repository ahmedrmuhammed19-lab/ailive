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

export type QueueAction = "start" | "retry" | "workall";

const ACTIONS: ReadonlySet<string> = new Set(["start", "retry", "workall"]);

/**
 * Pseudo submission-id for the queue-wide "work the queue" link — the one
 * keyword-style action that runs the engine on every pending case at once.
 */
export const WORK_ALL_ID = "__queue__";

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

/** Signed session-free URL that works the whole queue in one tap. */
export function workAllUrl(): string {
  return `${PORTAL_BASE_URL}/api/queue/work-all?token=${actionToken(WORK_ALL_ID, "workall")}`;
}

/**
 * Signed token for viewing one uploaded statement ("<fileId>:view"). Kept
 * OUTSIDE the queue-action namespace on purpose: /api/queue/action must never
 * accept a statement-view token and vice-versa, even though both are HMACs
 * keyed with SESSION_SECRET.
 */
export function statementViewToken(statementFileId: string): string {
  return createHmac("sha256", actionSecret())
    .update(`${statementFileId}:view`)
    .digest("hex")
    .slice(0, 32);
}

/** Constant-time statement-view token check (accepts any casing). */
export function verifyStatementViewToken(statementFileId: string, token: string): boolean {
  const expected = Buffer.from(statementViewToken(statementFileId));
  const given = Buffer.from((token ?? "").toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Signed, session-free URL that opens one uploaded statement in the browser. */
export function statementViewUrl(statementFileId: string): string {
  return `${PORTAL_BASE_URL}/api/statement/view?id=${encodeURIComponent(statementFileId)}&token=${statementViewToken(statementFileId)}`;
}
