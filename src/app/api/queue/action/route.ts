import { db } from "@/lib/db";
import { isQueueAction, verifyActionToken } from "@/lib/actions";
import { analyzeSubmission, autoDeliverMinPct, PARSER_VERSION, publishDraftReport } from "@/lib/analyze";
import { markDoneAndNotify } from "@/lib/notify";
import { loadMailCreds, operatorAddress, sendOrQueue } from "@/lib/mail";
import { logAttemptAndTeach } from "@/lib/lessons";

/**
 * GET /api/queue/action?id=<submissionId>&action=start&token=<hmac>
 *
 * One-tap operator actions from email links. The token is an HMAC of
 * (submissionId:action) keyed with SESSION_SECRET — the link cannot be forged,
 * and the endpoint is intentionally session-free so it works straight from a
 * mailbox click on any device.
 *
 * start (WAITING → ANALYZING) also fires the auto-analysis engine: the PDFs
 * are parsed, a chain-verified DRAFT report is published to the case, and the
 * operator is emailed the outcome. The analyst then reviews and marks DONE —
 * which delivers the report to the client automatically.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function page(opts: {
  tone: "ok" | "warn" | "err";
  title: string;
  headline: string;
  body: string;
  status?: 200 | 403 | 404 | 409;
}): Response {
  const color = opts.tone === "ok" ? "#1a7f37" : opts.tone === "warn" ? "#9a6700" : "#cf222e";
  const bg = opts.tone === "ok" ? "#dafbe1" : opts.tone === "warn" ? "#fff8c5" : "#ffebe9";
  const border = opts.tone === "ok" ? "#aceebb" : opts.tone === "warn" ? "#d4a72c66" : "#ff818266";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} — Global EIS</title>
</head>
<body style="margin:0;padding:24px;background:#f6f8fa;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">
    <div style="background:#0d1117;padding:14px 20px;">
      <span style="color:#fff;font-weight:700;font-size:15px;">Global EIS</span>
      <span style="color:#8b949e;font-size:12px;margin-left:8px;">Financial Intelligence Services</span>
    </div>
    <div style="padding:24px 20px;">
      <div style="background:${bg};border:1px solid ${border};border-radius:6px;padding:14px 16px;">
        <p style="margin:0 0 6px;color:${color};font-weight:700;font-size:16px;">${opts.headline}</p>
        <p style="margin:0;color:#59636e;font-size:13px;line-height:1.55;">${opts.body}</p>
      </div>
      <p style="margin:18px 0 0;color:#8b949e;font-size:12px;">
        You can close this tab — the queue on the portal is already up to date.
      </p>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: opts.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const action = (url.searchParams.get("action") ?? "").toLowerCase();
  const token = url.searchParams.get("token") ?? "";

  if (!id || !isQueueAction(action) || !verifyActionToken(id, action, token)) {
    return page({
      tone: "err",
      status: 403,
      title: "Invalid link",
      headline: "⛔ Invalid action link",
      body:
        "This link is incomplete or was not issued by Global EIS. " +
        "Use the button inside the notification email, or manage the queue directly on the portal.",
    });
  }

  const sub = await db.submission.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      clientName: true,
      country: true,
      visaType: true,
      travelers: true,
    },
  });

  if (!sub) {
    return page({
      tone: "err",
      status: 404,
      title: "Not found",
      headline: "Queue item not found",
      body: `No submission exists for this link (id ${id.slice(-8)}). It may have been removed — check the portal queue for the current list.`,
    });
  }

  const label = sub.userId || sub.id.slice(-8);
  const detail =
    `Queue ID: <b>${label}</b>` +
    (sub.clientName ? ` · Client: <b>${sub.clientName}</b>` : "") +
    (sub.country ? ` · Destination: ${sub.country}` : "") +
    (sub.visaType ? ` — ${sub.visaType}` : "") +
    ((sub.travelers ?? 1) > 1 ? ` · ${sub.travelers} joint applicants` : "");

  if (sub.status === "ANALYZING") {
    return page({
      tone: "warn",
      title: "Already started",
      headline: "Already running",
      body: `${detail}<br>This case is already marked <b>ANALYZING</b> — nothing changed.`,
    });
  }

  if (sub.status === "DONE") {
    return page({
      tone: "warn",
      title: "Already completed",
      headline: "Already completed",
      body: `${detail}<br>This case is <b>DONE</b> and the report has been delivered — nothing to start.`,
    });
  }

  await db.submission.update({
    where: { id: sub.id },
    data: { status: "ANALYZING", analyzedAt: null },
  });

  // --- Auto-analysis: parse statements, chain-verify, publish & maybe deliver ---
  const analysis = await analyzeSubmission(sub.id);
  const mailCreds = await loadMailCreds();

  // Self-improvement telemetry — one ParseLog row per attempt; must never break the flow.
  const integ = analysis.legs.map((l) => (l.txCount ? Math.round((l.matched / l.txCount) * 100) : 0));
  const legModes = analysis.legs.map((l) => l.mode ?? "unknown").join(",") || null;
  const telemetryLine =
    `Telemetry: v=${analysis.parserVersion} modes=${legModes ?? "—"} ` +
    `integrity=${integ.length ? `${integ.join("/")}%` : "n/a"} gate=${autoDeliverMinPct()}%.`;
  // Telemetry row + lesson-learned loop: every attempt is logged; the FIRST
  // occurrence of a never-seen failure pattern emails the operator (see lessons.ts).
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

  if (analysis.ok && analysis.fullLegs && analysis.submission) {
    const legs = analysis.fullLegs;
    const cov = legs.reduce((s, l) => s + l.closing, 0); // single-currency hint only
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
      return page({
        tone: "ok",
        title: "Delivered",
        headline: "✓ Analysis complete — report delivered",
        body:
          `${detail}<br>Chain integrity ${integrity.join("% / ")}% — every ledger row verified against the bank's own balances.` +
          `<br>The report (${esc2(reportName)}) has been emailed to ${done.notified ? esc2(done.notified.to) : "the client"} automatically.`,
      });
    }

    const reportName = await publishDraftReport(analysis.submission, legs, "review");
    await sendOrQueue({
      to: operatorAddress(mailCreds),
      subject: `🤖 Auto-analysis complete — Queue ${label} (draft ready for review)`,
      body:
        `The Start button triggered automatic analysis and a draft report is ready.\n\n` +
        `Queue ID   : ${label}\n` +
        `Report     : ${reportName}\n\n` +
        `Accounts:\n${legLines}\n\n` +
        (analysis.allVerified
          ? `Auto-delivery is currently disabled (AUTO_DELIVER=0) — review and mark DONE.\n\n`
          : `Integrity below the ${autoDeliverMinPct()}% auto-delivery threshold on this layout (${integrity.join("% / ")}%).\n` +
            `Review the draft, complete the narrative, then mark DONE to deliver.\n\n`) +
        `${telemetryLine}\n\n` +
        `— Global EIS automated intake`,
      kind: "operator_alert",
      submissionId: sub.id,
    });
    await logOutcome("draft-review");
    return page({
      tone: "ok",
      title: "Analysis complete",
      headline: "✓ Analysis started — draft report ready",
      body:
        `${detail}<br><b>${esc2(analysis.message)}</b> Chain integrity ${integrity.join("% / ")}%.` +
        (cov ? "" : "") +
        `<br>The draft is on the portal Reports tab — review it, then mark DONE to deliver to the client.<br>A summary email is on its way to you with the per-account chain integrity.`,
    });
  }

  const failMessage =
    analysis.mode === "no-files"
      ? analysis.message
      : analysis.message + " The workspace analyst should take over manually.";
  await logOutcome(analysis.mode); // "unrecognized" | "no-files"
  await sendOrQueue({
    to: operatorAddress(mailCreds),
    subject: `⚠️ Auto-analysis needs manual work — Queue ${label}`,
    body:
      `The Start button marked the case ANALYZING, but automatic parsing could not\ncomplete a draft.\n\n` +
      `Queue ID : ${label}\n` +
      `Reason   : ${failMessage}\n\n` +
      `${telemetryLine}\n\n` +
      `The raw text evidence is stored in the engine log (/api/engine/logs) for the\n` +
      `next parser iteration.\n\n` +
      `The workspace analyst should take over this case manually (CIB-Blue engine\n` +
      `or a different statement layout).`,
    kind: "operator_alert",
    submissionId: sub.id,
  });
  return page({
    tone: "warn",
    title: "Needs manual analysis",
    headline: "⚙ Analysis started — manual work needed",
    body: `${detail}<br>${esc2(failMessage)} The analyst has been notified by email.`,
  });
}

function esc2(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
