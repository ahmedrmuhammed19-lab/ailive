import { actionUrl, statementViewUrl } from "@/lib/actions";
import { autoDeliverMinPct, PARSER_VERSION } from "@/lib/analyze";
import type { WorkAllResult } from "@/lib/queue-work";

/**
 * One-link MISSION BRIEFING — the analyst-side half of the work-all magic link.
 *
 * GET /api/queue/go/<token>/brief fires a full queue pass (same engine as the
 * work-all page) and then renders a single JINA-readable HTML page that lets
 * the workspace agent START ITS JOB immediately from the link alone:
 *
 *   1. Pass tally            — what the engine just did, in numbers.
 *   2. Per-case work orders  — queue id, outcome, chain integrity, engine
 *                              message, signed statement-view links, and the
 *                              deliver / re-upload action links.
 *   3. Analyst orders        — explicit instructions for big scans (analyst
 *                              path) and drafts, including the attach flow.
 *   4. Self-improvement      — parser version, ParseLog totals, lessons loop.
 *   5. Rules contract        — the checklist of standing rules both the
 *                              portal AND the agent workspace obey (6-month
 *                              window, 100% chain gate, OCR shadow, mail
 *                              lock, big-scan triage, report design), so any
 *                              drift between portal and agent is visible.
 *
 * The page is plain inline-styled HTML with no JS: link-preview fetchers and
 * the page_reader channel render it verbatim.
 */

export interface BriefTelemetry {
  parseLogTotal: number;
  lastOutcome: string | null;
  lastParserVersion: string | null;
  lastAt: Date | null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chip(label: string, value: number | string, color: string): string {
  return (
    `<span style="display:inline-block;background:${color};color:#ffffff;border-radius:999px;` +
    `padding:4px 12px;font-size:12px;font-weight:700;margin:2px 4px 2px 0;">${esc(label)} ${esc(String(value))}</span>`
  );
}

const OUTCOME_LABEL: Record<string, { text: string; color: string }> = {
  "auto-delivered": { text: "DELIVERED", color: "#1a7f37" },
  "draft-review": { text: "DRAFT — REVIEW", color: "#9a6700" },
  "analyst-needed": { text: "ANALYST NEEDED", color: "#cf222e" },
  unrecognized: { text: "NEEDS MANUAL", color: "#cf222e" },
  "no-files": { text: "NO FILES", color: "#cf222e" },
};

function rulesBlock(): string {
  const li = (ok: boolean, text: string) =>
    `<li style="margin:3px 0;">${ok ? "&#9989;" : "&#9203;"} <span style="color:#1f2328;font-size:12px;">${text}</span></li>`;
  return (
    `<div style="margin:16px 0 0;padding-top:12px;border-top:1px solid #d0d7de;">` +
    `<p style="margin:0 0 6px;color:#1f2328;font-weight:700;font-size:13px;">Rules contract — portal &amp; agent in sync:</p>` +
    `<ul style="margin:0;padding-left:18px;">` +
    li(true, "<b>6-month embassy window</b> — out-of-window rows are trimmed and reported as window notes (both engine and analyst reports).") +
    li(true, `<b>Balance-chain gate ${autoDeliverMinPct()}%</b> — every row must reconcile against the bank's own running balances before auto-delivery (AUTO_DELIVER_MIN=1).`) +
    li(true, "<b>OCR shadow rule</b> — scan-recovered drafts are NEVER auto-delivered; they always park for analyst review.") +
    li(true, "<b>Big-scan triage</b> — scans above the 6-page OCR cap skip OCR entirely and route to the analyst in seconds; no serverless timeout.") +
    li(true, "<b>Mail lock</b> — every outbound email (client copies included) is forced to ahmedr.muhammed19@gmail.com via TEST_MAIL_TO.") +
    li(true, `<b>Lessons loop</b> — ParseLog on every attempt; first-time failure patterns email a lesson (15-min cooldown); telemetry at /api/engine/logs; parser at ${esc(PARSER_VERSION)}.`) +
    li(true, "<b>Report design</b> — Global EIS template (primary #005677 / secondary #008DCB) via report_design.ts for engine reports.") +
    li(true, "<b>Benchmarks</b> — per-country EGP closing-balance thresholds applied in every report (default 150k EGP).") +
    `</ul></div>`
  );
}

function analystOrdersBlock(r: WorkAllResult): string {
  const need = r.results.filter((x) => x.outcome === "analyst-needed" || x.outcome === "draft-review");
  if (need.length === 0) return "";
  const lines = need
    .map((x) => {
      const files = x.files.map((f) => `<a href="${statementViewUrl(f.id)}" style="color:#0969da;font-size:12px;">${esc(f.name)}</a>`).join(" · ");
      if (x.outcome === "analyst-needed") {
        return (
          `<div style="margin:0 0 10px;padding:10px 12px;background:#ffebe9;border:1px solid #ff818266;border-radius:6px;">` +
          `<p style="margin:0 0 4px;color:#cf222e;font-weight:700;font-size:13px;">${esc(x.queueId)} — big scan → analyst path</p>` +
          `<p style="margin:0 0 4px;color:#59636e;font-size:12px;line-height:1.55;">${esc(x.message)}</p>` +
          (files ? `<p style="margin:0;color:#59636e;font-size:12px;">Files: ${files}</p>` : "") +
          `<p style="margin:4px 0 0;color:#1f2328;font-size:12px;line-height:1.55;">Order: run the forensic OCR pipeline off-platform (300/450/600 dpi renders, cells/vote/closure, 100% chain), build the Global EIS report, then publish it with the analyst-attach flow — the case turns DONE and the client mail goes out automatically.</p>` +
          `</div>`
        );
      }
      return (
        `<div style="margin:0 0 10px;padding:10px 12px;background:#fff8c5;border:1px solid #d4a72c66;border-radius:6px;">` +
        `<p style="margin:0 0 4px;color:#9a6700;font-weight:700;font-size:13px;">${esc(x.queueId)} — draft awaiting review</p>` +
        `<p style="margin:0 0 4px;color:#59636e;font-size:12px;line-height:1.55;">${esc(x.message)}</p>` +
        (files ? `<p style="margin:0;color:#59636e;font-size:12px;">Files: ${files}</p>` : "") +
        `<p style="margin:4px 0 0;color:#1f2328;font-size:12px;">Order: review the draft on the portal Reports tab, then approve via the deliver link — the client mail goes out on approval.</p>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<div style="margin:16px 0 0;padding-top:12px;border-top:1px solid #d0d7de;">` +
    `<p style="margin:0 0 8px;color:#1f2328;font-weight:700;font-size:13px;">Analyst orders — start here:</p>` +
    lines +
    `</div>`
  );
}

function caseTableHtml(r: WorkAllResult): string {
  if (r.results.length === 0) return "";
  const rows = r.results
    .map((x) => {
      const o = OUTCOME_LABEL[x.outcome] ?? { text: x.outcome.toUpperCase(), color: "#57606a" };
      const integ = x.integrity.length ? `${x.integrity.join("% / ")}%` : "—";
      const files = x.files.map((f) => `<a href="${statementViewUrl(f.id)}" style="color:#0969da;font-size:11px;">${esc(f.name)}</a>`).join(" · ");
      const actions: string[] = [];
      if (x.outcome === "draft-review") actions.push(`<a href="${actionUrl(x.id, "deliver")}" style="color:#005677;font-size:11px;font-weight:700;">approve &amp; deliver</a>`);
      if (x.outcome === "unrecognized" || x.outcome === "no-files") actions.push(`<a href="${actionUrl(x.id, "nudge")}" style="color:#0969da;font-size:11px;">ask re-upload</a>`);
      actions.push(`<a href="${actionUrl(x.id, "retry")}" style="color:#9a6700;font-size:11px;">re-run</a>`);
      return (
        `<tr>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #d0d7de;color:#1f2328;font-weight:700;font-size:12px;white-space:nowrap;">${esc(x.queueId)}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #d0d7de;"><span style="color:#ffffff;background:${o.color};border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;">${o.text}</span></td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #d0d7de;color:#1f2328;font-size:12px;white-space:nowrap;">${esc(integ)}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #d0d7de;color:#59636e;font-size:11px;line-height:1.5;">${esc(x.message)}${files ? `<br>${files}` : ""}${actions.length ? `<br>${actions.join(" · ")}` : ""}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table style="border-collapse:collapse;width:100%;margin:10px 0 0;">` +
    `<tr><th align="left" style="padding:6px 8px;border-bottom:2px solid #d0d7de;color:#57606a;font-size:11px;">Case</th>` +
    `<th align="left" style="padding:6px 8px;border-bottom:2px solid #d0d7de;color:#57606a;font-size:11px;">Outcome</th>` +
    `<th align="left" style="padding:6px 8px;border-bottom:2px solid #d0d7de;color:#57606a;font-size:11px;">Chain</th>` +
    `<th align="left" style="padding:6px 8px;border-bottom:2px solid #d0d7de;color:#57606a;font-size:11px;">Detail &amp; links</th></tr>` +
    rows +
    `</table>`
  );
}

export function buildMissionBriefHtml(r: WorkAllResult, telemetry: BriefTelemetry): string {
  const clear = r.attempted === 0;
  const headline = clear
    ? "Queue clear — nothing pending, engine idle"
    : `Pass complete — ${r.delivered} delivered, ${r.draftReview} draft${r.draftReview === 1 ? "" : "s"}, ${r.analystNeeded} analyst, ${r.needsManual} manual`;
  const lastLesson =
    telemetry.lastAt && telemetry.lastOutcome
      ? `<p style="margin:4px 0 0;color:#57606e;font-size:12px;">Last attempt: <b>${esc(telemetry.lastOutcome)}</b> with ${esc(telemetry.lastParserVersion ?? "unknown parser")} at ${esc(telemetry.lastAt.toISOString().slice(0, 16).replace("T", " "))}Z · ${telemetry.parseLogTotal} attempts logged.</p>`
      : `<p style="margin:4px 0 0;color:#59636e;font-size:12px;">No engine attempts logged yet.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mission brief — Global EIS</title></head>
<body style="margin:0;padding:20px 12px;background:#f6f8fa;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #d0d7de;border-radius:10px;overflow:hidden;">
  <div style="background:#005677;padding:16px 20px;">
    <span style="color:#ffffff;font-weight:700;font-size:16px;">Global EIS</span>
    <span style="color:#9fd7f2;font-size:12px;margin-left:10px;">one-link mission brief — pass fired on open</span>
  </div>
  <div style="padding:20px;">
    <div style="background:#e7f6fd;border:1px solid #93c5fd;border-radius:8px;padding:14px 16px;">
      <p style="margin:0 0 8px;color:#005677;font-weight:700;font-size:15px;">${esc(headline)}</p>
      <div>
        ${chip("attempted", r.attempted, "#57606a")}
        ${chip("delivered", r.delivered, "#1a7f37")}
        ${chip("draft", r.draftReview, "#9a6700")}
        ${chip("analyst", r.analystNeeded, "#cf222e")}
        ${chip("manual", r.needsManual, "#cf222e")}
        ${chip("remaining", r.remaining, "#005677")}
      </div>
      ${caseTableHtml(r)}
    </div>
    ${analystOrdersBlock(r)}
    <div style="margin:16px 0 0;padding-top:12px;border-top:1px solid #d0d7de;">
      <p style="margin:0 0 6px;color:#1f2328;font-weight:700;font-size:13px;">Self-improvement — ALLOWED &amp; active:</p>
      ${lastLesson}
      <p style="margin:4px 0 0;color:#59636e;font-size:12px;line-height:1.55;">Every attempt writes ParseLog telemetry; brand-new failure patterns email the operator once (fingerprint-deduped, cooldown-capped) and become the next parser branch. Review evidence any time in the portal under engine logs.</p>
    </div>
    ${rulesBlock()}
    <p style="margin:16px 0 0;color:#8b949e;font-size:11px;line-height:1.5;">Protocol: sending this link in the agent chat IS the order — the agent opens it (firing this pass), reads the analyst orders above, and completes the flagged cases off-platform, then attaches the finished reports so the queue goes green. You can close this tab — the portal queue is already up to date.</p>
  </div>
</div>
</body>
</html>`;
}
