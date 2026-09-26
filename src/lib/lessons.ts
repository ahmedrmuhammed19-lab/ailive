import { createHash } from "crypto";
import { db } from "@/lib/db";
import { PORTAL_BASE_URL } from "@/lib/actions";
import { loadMailCreds, operatorAddress, sendOrQueue } from "@/lib/mail";

/**
 * Lesson-learned loop — the operator email side of engine self-improvement.
 *
 * Every auto-analysis attempt writes a ParseLog row (telemetry). When a row
 * carries LEARNING EVIDENCE the engine has never captured before — a brand-new
 * unrecognized layout, or a chain failure pattern not seen on that layout
 * family — the operator gets one "new lesson" email with a deep link to the
 * stored evidence, so the pattern can be reviewed and turned into the next
 * parser branch (PARSER_VERSION bump).
 *
 * Anti-spam:
 *  - lessonKey fingerprint: identical failure patterns never email twice.
 *      layout lessons -> fingerprint of the unrecognized statement text
 *      chain lessons  -> fingerprint of digit-masked failing row descriptions
 *                        per layout family (same KIND of row == same lesson)
 *  - cooldown: at most one lesson email per LESSON_MAIL_COOLDOWN_MIN minutes
 *    (default 15) even if several brand-new patterns land at once.
 *
 * Perfect runs (auto-delivered) and no-file cases teach nothing -> no email.
 * Everything here is best-effort: telemetry must never break the case flow.
 */

export interface LessonEvidence {
  outcome: string; // auto-delivered | draft-review | unrecognized | no-files | error
  modes: string | null; // layout family per leg (comma-joined)
  parserVersion: string;
  integrityMin: number | null;
  integrityAvg: number | null;
  unmatched: Array<{ file: string; date?: string; desc?: string; movement?: number | null; balance?: number | null }>;
  textPreview?: string;
}

export interface Lesson {
  key: string; // dedupe fingerprint
  kind: "layout" | "chain";
  headline: string; // one-line human summary for the email
}

/** Stable short hash (hex) of a normalized string. */
function fp(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/**
 * Mask digits and collapse separators so "TRANSFER TO AC 44521 - 1,200.00"
 * and "TRANSFER TO AC 99833 - 980.00" map to the same row SHAPE — the lesson
 * is the pattern, not the specific transaction. Number-like runs (including
 * thousands separators / decimals, e.g. "1,200.00") collapse to ONE "#".
 */
function rowShape(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\d[\d.,]*/g, "#")
    .replace(/#{2,}/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .trim();
}

/** Decide whether this attempt is a NEW lesson candidate (and its fingerprint). */
export function computeLesson(ev: LessonEvidence): Lesson | null {
  // Lesson 1 — a statement layout the parser could not read at all.
  if (ev.outcome === "unrecognized" && ev.textPreview && ev.textPreview.trim().length > 0) {
    const normalized = ev.textPreview.replace(/\s+/g, " ").trim().slice(0, 600);
    return {
      key: `layout:${fp(normalized)}`,
      kind: "layout",
      headline: "Unrecognized statement layout — raw text evidence captured for a new parser branch",
    };
  }
  // Lesson 2 — a known layout family, but a chain-failure ROW pattern never seen on it.
  if (ev.outcome === "draft-review" && ev.unmatched.length > 0) {
    const shapes = Array.from(
      new Set(ev.unmatched.map((r) => rowShape(r.desc ?? "")).filter((s) => s.length > 0))
    )
      .sort()
      .slice(0, 120);
    if (shapes.length === 0) return null;
    const family = ev.modes?.trim() || "unknown-layout";
    return {
      key: `chain:${family}:${fp(shapes.join("|"))}`,
      kind: "chain",
      headline: `New chain-failure pattern on layout "${family}" — ${ev.unmatched.length} row(s) failed verification`,
    };
  }
  // auto-delivered (perfect chain) and no-files teach nothing new.
  return null;
}

function cooldownMs(): number {
  const raw = parseFloat(process.env.LESSON_MAIL_COOLDOWN_MIN ?? "15");
  const min = Number.isFinite(raw) && raw >= 0 ? raw : 15;
  return min * 60_000;
}

/**
 * Write the ParseLog telemetry row (best-effort) and, when this attempt is the
 * FIRST-ever occurrence of its failure pattern, email the operator the lesson
 * with a deep link to the evidence. Never throws.
 */
export async function logAttemptAndTeach(data: {
  submissionId: string; // portal submission cuid
  queueId: string; // human queue label for display
  outcome: string;
  modes: string | null;
  parserVersion: string;
  legs: number;
  integrityMin: number | null;
  integrityAvg: number | null;
  unmatched: LessonEvidence["unmatched"];
  textPreview?: string;
}): Promise<void> {
  try {
    const row = await db.parseLog.create({
      data: {
        submissionId: data.submissionId,
        queueId: data.queueId,
        outcome: data.outcome,
        modes: data.modes,
        parserVersion: data.parserVersion,
        legs: data.legs,
        integrityMin: data.integrityMin,
        integrityAvg: data.integrityAvg,
        unmatched: data.unmatched.length ? JSON.stringify(data.unmatched) : null,
        textSample: data.textPreview ?? null,
      },
      select: { id: true },
    });
    await maybeSendLessonEmail(row.id, {
      outcome: data.outcome,
      modes: data.modes,
      parserVersion: data.parserVersion,
      integrityMin: data.integrityMin,
      integrityAvg: data.integrityAvg,
      unmatched: data.unmatched,
      textPreview: data.textPreview,
      queueId: data.queueId,
      submissionId: data.submissionId,
    });
  } catch {
    // telemetry is best-effort — never break the case flow
  }
}

/** Dedupe + email the operator about a first-time failure pattern. Never throws. */
async function maybeSendLessonEmail(
  logId: string,
  ev: LessonEvidence & { queueId: string; submissionId: string }
): Promise<void> {
  try {
    const lesson = computeLesson(ev);
    if (!lesson) return;

    // Already learned this pattern? (lessonKey is only stamped when mailed)
    const prior = await db.parseLog.findFirst({
      where: { lessonKey: lesson.key, lessonSentAt: { not: null } },
      select: { id: true },
    });
    if (prior) return;

    // Cooldown: even brand-new patterns trickle out at most one email per window.
    const last = await db.parseLog.findFirst({
      where: { lessonSentAt: { not: null } },
      orderBy: { lessonSentAt: "desc" },
      select: { lessonSentAt: true },
    });
    if (last?.lessonSentAt && Date.now() - last.lessonSentAt.getTime() < cooldownMs()) return;

    await db.parseLog.update({
      where: { id: logId },
      data: { lessonKey: lesson.key, lessonSentAt: new Date() },
    });

    const integ =
      ev.integrityMin != null || ev.integrityAvg != null
        ? `min ${ev.integrityMin ?? "—"}% · avg ${ev.integrityAvg ?? "—"}%`
        : "n/a";
    const sample = ev.unmatched
      .slice(0, 5)
      .map(
        (r) =>
          `  • ${r.date ?? "—"} | ${(r.desc ?? "—").slice(0, 60)} | mov ${r.movement ?? "—"} | bal ${r.balance ?? "—"}`
      )
      .join("\n");
    const evidenceNote =
      lesson.kind === "layout"
        ? `The raw PDF text preview (up to 16KB) was captured — enough to design the new layout branch.`
        : `The failing rows (up to 40) were captured — enough to see where the balance chain breaks.`;

    const creds = await loadMailCreds();
    await sendOrQueue({
      to: operatorAddress(creds),
      subject: `🧠 Engine learned a new lesson — Queue ${ev.queueId}`,
      body:
        `The analysis engine just hit a failure pattern it has NEVER seen before.\n` +
        `This is the evidence it saved so the pattern can become the next parser improvement.\n\n` +
        `Lesson    : ${lesson.headline}\n` +
        `Queue ID  : ${ev.queueId}\n` +
        `Outcome   : ${ev.outcome}${ev.modes ? ` (${ev.modes})` : ""}\n` +
        `Parser    : ${ev.parserVersion}\n` +
        `Integrity : ${integ}\n` +
        `Evidence  : ${ev.unmatched.length} unmatched row(s)${lesson.kind === "layout" ? " + raw text sample" : ""}\n\n` +
        (sample ? `First failing rows:\n${sample}\n\n` : "") +
        `${evidenceNote}\n\n` +
        `Full evidence (open in a browser where you are signed in to the portal):\n` +
        `${PORTAL_BASE_URL}/api/engine/logs?id=${logId}\n\n` +
        `Next step: paste this log into the Global EIS AI chat — the analyst will\n` +
        `write the parser branch for this pattern and bump PARSER_VERSION.\n\n` +
        `— Global EIS automated intake (lesson-learned loop)`,
      kind: "operator_alert",
      submissionId: ev.submissionId,
    });
  } catch {
    // lesson notification is best-effort — never break the case flow
  }
}
