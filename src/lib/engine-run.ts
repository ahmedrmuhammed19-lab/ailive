import { db } from "@/lib/db";
import { autoDeliverMinPct, analyzeSubmission, PARSER_VERSION, publishDraftReport } from "@/lib/analyze";
import { markDoneAndNotify } from "@/lib/notify";
import { loadMailCreds, operatorAddress, sendOrQueue } from "@/lib/mail";
import { logAttemptAndTeach } from "@/lib/lessons";
import { actionUrl } from "@/lib/actions";

/**
 * Shared engine runner — fires the full auto-analysis pipeline for one
 * submission and handles EVERY outcome end-to-end:
 *
 *   100% chain integrity  -> report published + case DONE + client delivery mail
 *   below the gate        -> draft report published + operator review mail
 *   unrecognized/no-files -> red "Needs manual" state + operator alert mail
 *
 * Every attempt lands in ParseLog (telemetry) and the first-ever failure
 * pattern emails the operator a lesson with evidence (lessons.ts).
 *
 * Used by BOTH callers so their behavior can never drift apart:
 *   - GET /api/queue/action  (signed session-free email links: start | retry)
 *   - POST /api/queue/retry  (operator, signed-in, portal buttons)
 */

export type EngineOutcome = "auto-delivered" | "draft-review" | "unrecognized" | "no-files";

export type EngineRun = {
  outcome: EngineOutcome;
  message: string;
  integrity: number[]; // per-leg chain-integrity percentages (empty when nothing parsed)
  reportName?: string;
  notifiedTo?: string | null;
  telemetry: string;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Email-client-safe amber button (email tables + inline styles only). */
function mailButton(url: string, label: string, bg: string): string {
  return (
    `<div style="text-align:center;margin:20px 0 8px;">` +
    `<a href="${url}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;` +
    `font-weight:700;font-size:15px;padding:13px 34px;border-radius:6px;">${label}</a></div>`
  );
}

export async function runEngine(
  sub: { id: string; userId: string | null },
  label: string
): Promise<EngineRun> {
  const analysis = await analyzeSubmission(sub.id);
  const mailCreds = await loadMailCreds();
  const retryUrl = actionUrl(sub.id, "retry");

  const integ = analysis.legs.map((l) => (l.txCount ? Math.round((l.matched / l.txCount) * 100) : 0));
  const legModes = analysis.legs.map((l) => l.mode ?? "unknown").join(",") || null;
  const telemetryLine =
    `Telemetry: v=${analysis.parserVersion} modes=${legModes ?? "—"} ` +
    `integrity=${integ.length ? `${integ.join("/")}%` : "n/a"} gate=${autoDeliverMinPct()}%.`;

  const logOutcome = (outcome: string) =>
    logAttemptAndTeach({
      submissionId: sub.id,
      queueId: label,
      outcome,
      modes: legModes,
      parserVersion: analysis.parserVersion || PARSER_VERSION,
      legs: analysis.legs.length,
      integrityMin: integ.length ? Math.min(...integ) : null,
      integrityAvg: integ.length ? Math.round(integ.reduce((a, b) => a + b, 0) / integ.length) : null,
      unmatched: analysis.evidence?.unmatched ?? [],
      textPreview: analysis.evidence?.textPreview,
    });

  // --- Happy paths: full legs parsed -> draft or auto-delivery -------------
  if (analysis.ok && analysis.fullLegs && analysis.submission) {
    const legs = analysis.fullLegs;
    const integrity = legs.map((l) => (l.txCount ? Math.round((l.matched / l.txCount) * 100) : 0));
    const legLines = legs
      .map(
        (l, i) =>
          `  • Account ${l.account ?? "?"} (${l.currency}): opening ${l.opening.toLocaleString("en-US", { minimumFractionDigits: 2 })} → closing ${l.closing.toLocaleString("en-US", { minimumFractionDigits: 2 })}, in ${l.inflow.toLocaleString("en-US")} / out ${l.outflow.toLocaleString("en-US")}, ${l.matched}/${l.txCount} rows verified (${integrity[i]}%)`
      )
      .join("\n");

    const autoDeliver = process.env.AUTO_DELIVER !== "0"; // default on
    if (autoDeliver && analysis.allVerified) {
      const reportName = await publishDraftReport(analysis.submission, legs, "engine");
      const done = await markDoneAndNotify(sub.id, [reportName], telemetryLine);
      await logOutcome("auto-delivered");
      return {
        outcome: "auto-delivered",
        message: analysis.message,
        integrity,
        reportName,
        notifiedTo: done.notified ? done.notified.to : null,
        telemetry: telemetryLine,
      };
    }

    const reportName = await publishDraftReport(analysis.submission, legs, "review");
    const reason = analysis.allVerified
      ? `Auto-delivery is currently disabled (AUTO_DELIVER=0) — review and mark DONE.\n\n`
      : `Integrity below the ${autoDeliverMinPct()}% auto-delivery threshold on this layout (${integrity.join("% / ")}%).\n` +
        `Review the draft, complete the narrative, then mark DONE to deliver.\n\n`;
    await sendOrQueue({
      to: operatorAddress(mailCreds),
      subject: `🤖 Auto-analysis complete — Queue ${label} (draft ready for review)`,
      body:
        `The engine ran on this case and a draft report is ready.\n\n` +
        `Queue ID   : ${label}\n` +
        `Report     : ${reportName}\n\n` +
        `Accounts:\n${legLines}\n\n` +
        reason +
        `${telemetryLine}\n\n` +
        `Re-run the engine after replacing/fixing files (same link works repeatedly):\n${retryUrl}\n\n` +
        `— Global EIS automated intake`,
      html:
        `<div style="margin:0;background:#f6f8fa;padding:20px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">` +
        `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">` +
        `<div style="background:#0d1117;padding:12px 18px;"><span style="color:#ffffff;font-weight:700;font-size:15px;">Global EIS</span>` +
        `<span style="color:#8b949e;font-size:12px;margin-left:8px;">draft ready for review</span></div>` +
        `<div style="padding:18px;">` +
        `<p style="margin:0 0 12px;color:#24292f;font-size:14px;line-height:1.55;">Queue <b>${esc(label)}</b> — chain integrity ` +
        `<b>${integrity.join("% / ")}%</b> (gate ${autoDeliverMinPct()}%). The draft is on the portal Reports tab; review it, then mark DONE to deliver.</p>` +
        mailButton(retryUrl, "&#8635; Re-run Engine", "#9a6700") +
        `<p style="text-align:center;margin:0 0 10px;"><a href="${actionUrl(sub.id, "start")}" style="color:#8b949e;font-size:11px;">start link (first run)</a> · ` +
        `<a href="${retryUrl}" style="color:#0969da;font-size:12px;">retry link — works any time</a></p>` +
        `<p style="margin:0;color:#8b949e;font-size:11px;line-height:1.5;">${esc(telemetryLine)}</p>` +
        `</div></div></div>`,
      kind: "operator_alert",
      submissionId: sub.id,
    });
    await logOutcome("draft-review");
    return {
      outcome: "draft-review",
      message: analysis.message,
      integrity,
      reportName,
      telemetry: telemetryLine,
    };
  }

  // --- Failure paths: nothing usable parsed -> manual + alert --------------
  const failMessage =
    analysis.mode === "no-files"
      ? analysis.message
      : analysis.message + " The workspace analyst should take over manually.";
  await logOutcome(analysis.mode); // "unrecognized" | "no-files"
  await sendOrQueue({
    to: operatorAddress(mailCreds),
    subject: `⚠️ Auto-analysis needs manual work — Queue ${label}`,
    body:
      `The engine ran on this case but automatic parsing could not\ncomplete a draft.\n\n` +
      `Queue ID : ${label}\n` +
      `Reason   : ${failMessage}\n\n` +
      `${telemetryLine}\n\n` +
      `The raw text evidence is stored in the engine log (/api/engine/logs) for the\n` +
      `next parser iteration.\n\n` +
      `Fix forward: replace the file with a digital (text-based) PDF on the portal,\n` +
      `then re-run the engine with one tap — the retry link works any time:\n${retryUrl}\n\n` +
      `— Global EIS automated intake`,
    html:
      `<div style="margin:0;background:#f6f8fa;padding:20px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">` +
      `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">` +
      `<div style="background:#0d1117;padding:12px 18px;"><span style="color:#ffffff;font-weight:700;font-size:15px;">Global EIS</span>` +
      `<span style="color:#8b949e;font-size:12px;margin-left:8px;">needs manual work</span></div>` +
      `<div style="padding:18px;">` +
      `<p style="margin:0 0 12px;color:#24292f;font-size:14px;line-height:1.55;">Queue <b>${esc(label)}</b> — automatic parsing could not complete a draft.</p>` +
      `<p style="margin:0 0 12px;color:#cf222e;font-size:13px;line-height:1.55;"><b>Reason:</b> ${esc(failMessage)}</p>` +
      `<p style="margin:0 0 4px;color:#59636e;font-size:12px;line-height:1.55;">Fix forward: replace the file with a digital (text-based) PDF on the portal, then re-run the engine with one tap. Evidence is saved in the engine log for the next parser iteration.</p>` +
      mailButton(retryUrl, "&#8635; Retry Analysis", "#9a6700") +
      `<p style="margin:0;color:#8b949e;font-size:11px;line-height:1.5;">${esc(telemetryLine)}</p>` +
      `</div></div></div>`,
    kind: "operator_alert",
    submissionId: sub.id,
  });
  return {
    outcome: (analysis.mode === "no-files" ? "no-files" : "unrecognized") as EngineOutcome,
    message: failMessage,
    integrity: [],
    telemetry: telemetryLine,
  };
}
