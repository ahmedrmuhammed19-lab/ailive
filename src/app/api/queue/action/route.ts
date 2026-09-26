import { db } from "@/lib/db";
import { isQueueAction, verifyActionToken } from "@/lib/actions";

/**
 * GET /api/queue/action?id=<submissionId>&action=start&token=<hmac>
 *
 * One-tap operator actions from email links. The token is an HMAC of
 * (submissionId:action) keyed with SESSION_SECRET — the link cannot be forged,
 * and the endpoint is intentionally session-free so it works straight from a
 * mailbox click on any device.
 *
 * Currently supported: start (WAITING → ANALYZING). The response is a small
 * branded HTML page, not JSON, because the "client" is an email button.
 */
export const dynamic = "force-dynamic";

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

  return page({
    tone: "ok",
    title: "Analysis started",
    headline: "✓ Analysis started",
    body: `${detail}<br>Status is now <b>ANALYZING</b>. The client will be emailed automatically when the report is marked DONE on the portal.`,
  });
}
