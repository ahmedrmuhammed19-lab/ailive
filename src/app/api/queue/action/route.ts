import { db } from "@/lib/db";
import { isQueueAction, verifyActionToken } from "@/lib/actions";
import { runEngine } from "@/lib/engine-run";
import { markDoneAndNotify } from "@/lib/notify";
import { loadMailCreds, operatorAddress, sendOrQueue } from "@/lib/mail";

/**
 * GET /api/queue/action?id=<submissionId>&action=start|retry&token=<hmac>
 *
 * One-tap operator actions from email links. The token is an HMAC of
 * (submissionId:action) keyed with SESSION_SECRET — the link cannot be forged,
 * and the endpoint is intentionally session-free so it works straight from a
 * mailbox click on any device.
 *
 * start  (WAITING → ANALYZING) fires the auto-analysis engine: the PDFs are
 *        parsed, a chain-verified DRAFT report is published to the case, and
 *        the operator is emailed the outcome. The analyst then reviews and
 *        marks DONE — which delivers the report to the client automatically.
 * retry  re-runs the engine on a WAITING **or** ANALYZING case (fresh parse,
 *        fresh draft / auto-delivery decision). This is the step-forward for
 *        cases that "Needs manual" (e.g. after the client sends a better PDF)
 *        or any yellow case that should be re-verified. DONE stays untouched.
 * deliver  the approval step for yellow (draft-review) cases: stamps DONE and
 *        emails the report to the client — exactly what the portal "Mark done
 *        · email report" button does. Guarded by the same email safety rail as
 *        Green all: a case without a published report is NEVER delivered, so
 *        the link cannot send an empty report. Idempotent: on an already-DONE
 *        case it just answers "Already completed".
 * nudge  emails the client a polite "please upload your actual bank statement"
 *        request for cases where the uploaded file is not a usable statement
 *        (red "Needs manual"). Each tap sends one reminder — reminder
 *        semantics are intentional, unlike the idempotent deliver.
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
  const color = opts.tone === "ok" ? "#1e40af" : opts.tone === "warn" ? "#9a6700" : "#cf222e";
  const bg = opts.tone === "ok" ? "#dbeafe" : opts.tone === "warn" ? "#fff8c5" : "#ffebe9";
  const border = opts.tone === "ok" ? "#93c5fd" : opts.tone === "warn" ? "#d4a72c66" : "#ff818266";
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

function esc2(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      email: true,
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

  if (sub.status === "DONE") {
    return page({
      tone: "warn",
      title: "Already completed",
      headline: "Already completed",
      body: `${detail}<br>This case is <b>DONE</b> and the report has been delivered — nothing to ${action}.`,
    });
  }

  // nudge = email the client a re-upload request (red "not a statement" cases).
  // Reminder semantics: every tap sends one more polite request. Must NOT
  // touch status or pass through the engine below.
  if (action === "nudge") {
    const to = sub.email?.trim();
    if (!to) {
      return page({
        tone: "warn",
        title: "No client email",
        headline: "No client email on file",
        body:
          `${detail}<br>This case has <b>no client email</b> — nothing was sent.` +
          `<br>Add the client's email on the portal case, then tap this nudge link again.`,
      });
    }
    const files = await db.statementFile.findMany({
      where: { submissionId: sub.id },
      select: { originalName: true },
      orderBy: { createdAt: "asc" },
    });
    const fileNames = files.map((f) => f.originalName).join(", ") || "(no file name recorded)";
    const greet = sub.clientName ? `Dear ${sub.clientName},` : "Hello,";
    const creds = await loadMailCreds();
    const result = await sendOrQueue({
      to,
      subject: `Global EIS — action required: bank statement needed (Queue ${label})`,
      body:
        `${greet}\n\n` +
        `We started processing your financial readiness assessment (Queue ${label}),\n` +
        `but the document uploaded for this case is not a bank statement.\n\n` +
        `Received file : ${fileNames}\n` +
        `What we need  : your actual bank statement, issued by your bank\n\n` +
        `Please upload a bank statement PDF that:\n` +
        `  • is the digital (text-based) statement from your bank — not a photo\n` +
        `    or screenshot, and not another document type\n` +
        `  • shows the full statement period, the account holder name and the\n` +
        `    running balance\n` +
        `  • is complete — all pages, nothing missing\n\n` +
        `Upload it on the Global EIS portal (sign in with your case ID), or reply\n` +
        `to this email and we will help you through it. As soon as the statement\n` +
        `arrives, our analysis engine re-runs automatically and your report is\n` +
        `delivered by email.\n\n` +
        `Kind regards,\nGlobal EIS — Financial Intelligence Services`,
      html:
        `<div style="margin:0;background:#f6f8fa;padding:20px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">` +
        `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">` +
        `<div style="background:#0d1117;padding:12px 18px;"><span style="color:#ffffff;font-weight:700;font-size:15px;">Global EIS</span>` +
        `<span style="color:#8b949e;font-size:12px;margin-left:8px;">action required</span></div>` +
        `<div style="padding:18px;">` +
        `<p style="margin:0 0 12px;color:#24292f;font-size:14px;line-height:1.55;">${esc2(greet)} For queue <b>${esc2(label)}</b>, the document uploaded for your ` +
        `financial readiness assessment is <b>not a bank statement</b>, so our analysis engine cannot process it.</p>` +
        `<p style="margin:0 0 12px;color:#59636e;font-size:13px;line-height:1.55;">Received file: <b>${esc2(fileNames)}</b></p>` +
        `<div style="margin:0 0 12px;background:#fff8c5;border:1px solid #d4a72c66;border-radius:6px;padding:12px 14px;">` +
        `<p style="margin:0 0 6px;color:#9a6700;font-weight:700;font-size:13px;">What we need from you</p>` +
        `<p style="margin:0;color:#59636e;font-size:13px;line-height:1.6;">Please upload a bank statement PDF that is the ` +
        `<b>digital (text-based) statement from your bank</b> — not a photo or screenshot, and not another document type — ` +
        `showing the full statement period, the account holder name and the running balance, and complete (all pages).</p></div>` +
        `<p style="margin:0;color:#24292f;font-size:13px;line-height:1.55;">Upload it on the Global EIS portal (sign in with your case ID), ` +
        `or reply to this email and we will help you through it. As soon as the statement arrives, our engine re-runs automatically ` +
        `and your report is delivered by email.</p>` +
        `<p style="margin:16px 0 0;color:#8b949e;font-size:12px;">Kind regards,<br>Global EIS — Financial Intelligence Services</p>` +
        `</div></div></div>`,
      kind: "client_nudge",
      submissionId: sub.id,
    });
    await sendOrQueue({
      to: operatorAddress(creds),
      subject: `✉️ Re-upload request sent — Queue ${label}`,
      body:
        `A "please upload your bank statement" request was emailed to the client.\n\n` +
        `Queue ID : ${label}\n` +
        `Sent to  : ${to}${result.queued ? " (mail queued — will go out shortly)" : ""}\n` +
        `Trigger  : signed nudge link\n\n` +
        `— Global EIS automated intake`,
      kind: "operator_alert",
      submissionId: sub.id,
    });
    return page({
      tone: "ok",
      title: "Client nudged",
      headline: "✓ Re-upload request emailed to the client",
      body:
        `${detail}<br>A bank-statement request was emailed to <b>${esc2(to)}</b>${result.queued ? " (mail queued — will go out shortly)" : ""}.` +
        `<br>When the client uploads the correct statement, use Retry / work-the-queue to re-fire the engine.`,
    });
  }

  // start is the FIRST run only; retry is the deliberate re-run (also rescues
  // cases stuck in ANALYZING). Both end up in the same engine below.
  // DONE cases are never re-fired by start — with AUTO_WORK the engine has
  // usually finished before an operator tap; re-runs go through retry only,
  // so eager double-taps can never duplicate reports or client mails.
  if (action === "start" && sub.status === "DONE") {
    return page({
      tone: "ok",
      title: "Already delivered",
      headline: "✓ This case is already delivered",
      body:
        `${detail}<br>The engine already completed this case — it is marked <b>DONE</b> and nothing was changed.` +
        `<br>To re-run the analysis on it, use the <b>Retry</b> link from the operator email or the queue's “↻ Retry engine” button.`,
    });
  }
  if (action === "start" && sub.status === "ANALYZING") {
    return page({
      tone: "warn",
      title: "Already started",
      headline: "Already running",
      body:
        `${detail}<br>This case is already marked <b>ANALYZING</b> — nothing changed.` +
        `<br>To re-run the engine on it, use the <b>Retry</b> link from the operator email or the queue's “↻ Retry engine” button.`,
    });
  }

  // deliver = approve the reviewed draft: DONE + report emailed to the client.
  // Must NOT pass through the ANALYZING stamp / engine below.
  if (action === "deliver") {
    const reports = await db.reportFile.findMany({
      where: { submissionId: sub.id },
      select: { name: true },
      orderBy: { createdAt: "asc" },
    });
    if (reports.length === 0) {
      // Email safety rail (mirrors Green all): never deliver a case without a report.
      return page({
        tone: "warn",
        title: "No report yet",
        headline: "No report is ready to deliver",
        body:
          `${detail}<br>This case has <b>no published report</b> yet — nothing was sent.` +
          `<br>Run the engine first (Start/Retry), review the draft on the portal Reports tab, then approve it for delivery.`,
      });
    }
    const done = await markDoneAndNotify(
      sub.id,
      reports.map((r) => r.name),
      "Delivered via the signed “Approve & Email Report” link in the operator email."
    );
    if (!done.ok) {
      return page({
        tone: "err",
        status: 404,
        title: "Delivery failed",
        headline: "Could not deliver this case",
        body: `${detail}<br>${esc2(done.error ?? "Unknown error")} — the queue on the portal is unchanged.`,
      });
    }
    return page({
      tone: "ok",
      title: "Delivered",
      headline: "✓ Report delivered to the client",
      body:
        `${detail}<br>Report(s): <b>${esc2(done.reportNames.join(", "))}</b>` +
        `<br>Emailed to <b>${esc2(done.notified?.to ?? "the client")}</b>${done.notified?.queued ? " (mail queued — will go out shortly)" : ""}.` +
        `<br>The case is now <b>DONE</b> — the portal queue and Reports tab are up to date.`,
    });
  }

  await db.submission.update({
    where: { id: sub.id },
    data: { status: "ANALYZING", analyzedAt: null },
  });

  const run = await runEngine(sub, label);
  const integTxt = run.integrity.length ? `${run.integrity.join("% / ")}%` : "n/a";

  if (run.outcome === "auto-delivered") {
    return page({
      tone: "ok",
      title: "Delivered",
      headline: "✓ Analysis complete — report delivered",
      body:
        `${detail}<br>Chain integrity ${integTxt} — every ledger row verified against the bank's own balances.` +
        `<br>The report (${esc2(run.reportName ?? "")}) has been emailed to ${esc2(run.notifiedTo ?? "the client")} automatically.`,
    });
  }

  if (run.outcome === "draft-review") {
    return page({
      tone: "ok",
      title: "Analysis complete",
      headline: "✓ Analysis started — draft report ready",
      body:
        `${detail}<br><b>${esc2(run.message)}</b> Chain integrity ${integTxt}.` +
        `<br>The draft is on the portal Reports tab — review it, then mark DONE to deliver to the client.<br>A summary email is on its way to you with the per-account chain integrity.`,
    });
  }

  return page({
    tone: "warn",
    title: "Needs manual analysis",
    headline: "⚙ Analysis started — manual work needed",
    body: `${detail}<br>${esc2(run.message)} The analyst has been notified by email.` +
      `<br>After replacing the file with a better (digital) PDF, tap the <b>Retry</b> link in the email — or “↻ Retry engine” on the portal queue.`,
  });
}
