import { NextResponse } from "next/server";
import { sessionAccount } from "@/lib/session";
import { isOperator } from "@/lib/authz";
import { verifyActionToken, WORK_ALL_ID, statementViewUrl, actionUrl } from "@/lib/actions";
import { workTheQueue, MAX_WORK_BATCH, type WorkRowResult } from "@/lib/queue-work";

/**
 * /api/queue/work-all — the one-keyword "work the queue" action.
 *
 * POST (operator session, portal button)
 *   Fires the engine on every pending case (oldest first, up to MAX_WORK_BATCH
 *   per pass) and returns a JSON tally: delivered / draft-review / needs-manual
 *   / remaining. Nothing is force-greened — cases that do not reach the
 *   auto-delivery gate stay pending for a human decision ("Green all" remains
 *   the explicit bulk override).
 *
 * GET ?token=<hmac>  (signed, session-free — the operator's magic link)
 *   Same bulk pass, triggered by a bookmarkable one-tap URL signed with the
 *   same HMAC scheme as the email action links (id=__queue__, action=workall).
 *   This is the "keyword": the operator copies the link once from the queue
 *   toolbar, bookmarks it or mails it to themselves, and can then work the
 *   whole queue from any device — even straight from their mailbox — without
 *   signing in. A forged token is rejected with 403.
 *
 * Both paths share queue-work.ts → engine-run.ts so behavior can never drift
 * from the per-row Start analysis / Retry engine actions.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function resultText(r: Awaited<ReturnType<typeof workTheQueue>>): string {
  const lines = r.results.map(
    (x) =>
      `• ${x.queueId} — ${
        x.outcome === "auto-delivered"
          ? `delivered to the client (integrity ${x.integrity.join("% / ")}%)`
          : x.outcome === "draft-review"
            ? `draft ready for review (integrity ${x.integrity.join("% / ")}%) — approve below to deliver`
            : x.outcome === "no-files"
              ? "no files on the case — flagged red"
              : "could not parse — flagged red, fix-forward email sent"
      }`
  );
  return lines.join("\n");
}

export async function POST(req: Request) {
  const account = await sessionAccount(req);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  if (!isOperator(account)) {
    return NextResponse.json(
      { ok: false, error: "Operator account required — client accounts are read-only." },
      { status: 403 }
    );
  }

  const r = await workTheQueue();
  return NextResponse.json({
    ok: true,
    batchLimit: MAX_WORK_BATCH,
    ...r,
    results: r.results.map((x) => ({ ...x, viewUrls: viewUrlsOf(x) })),
  });
}

function page(opts: {
  tone: "ok" | "warn" | "err";
  title: string;
  headline: string;
  bodyHtml: string;
  status?: 200 | 403;
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
  <div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">
    <div style="background:#0d1117;padding:14px 20px;">
      <span style="color:#fff;font-weight:700;font-size:15px;">Global EIS</span>
      <span style="color:#8b949e;font-size:12px;margin-left:8px;">queue worked</span>
    </div>
    <div style="padding:24px 20px;">
      <div style="background:${bg};border:1px solid ${border};border-radius:6px;padding:14px 16px;">
        <p style="margin:0 0 8px;color:${color};font-weight:700;font-size:16px;">${opts.headline}</p>
        <div style="margin:0;color:#59636e;font-size:13px;line-height:1.6;">${opts.bodyHtml}</div>
      </div>
      <p style="margin:18px 0 0;color:#8b949e;font-size:12px;">
        You can close this tab — the portal queue is already up to date.
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

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Signed view URLs for one case's statements (same scheme as the operator emails). */
function viewUrlsOf(x: WorkRowResult): { name: string; url: string }[] {
  return x.files.map((f) => ({ name: f.name, url: statementViewUrl(f.id) }));
}

/**
 * Per-case "view the original statement" block for the magic-link result page —
 * the same signed session-free viewer the operator emails use, so a red case
 * can be inspected straight from this page without signing in.
 */
function viewBlockHtml(r: Awaited<ReturnType<typeof workTheQueue>>): string {
  const withFiles = r.results.filter((x) => x.files.length > 0 || x.outcome === "draft-review");
  if (withFiles.length === 0) return "";
  const lines = withFiles
    .map((x) => {
      const parts = x.files.map(
        (f) =>
          `<a href="${statementViewUrl(f.id)}" style="color:#0969da;font-weight:600;text-decoration:none;">${esc(f.name)}</a>`
      );
      if (x.outcome === "draft-review") {
        parts.push(
          `<a href="${actionUrl(x.id, "deliver")}" style="color:#1a7f37;font-weight:700;text-decoration:none;">&#10003; Approve &amp; deliver report</a> <span style="color:#8b949e;font-size:11px;">(emails the client)</span>`
        );
      }
      if (x.outcome === "unrecognized" || x.outcome === "no-files") {
        parts.push(
          `<a href="${actionUrl(x.id, "nudge")}" style="color:#0969da;font-weight:700;text-decoration:none;">&#9993; Ask client to re-upload</a> <span style="color:#8b949e;font-size:11px;">(emails the client)</span>`
        );
      }
      return (
        `<div style="margin:0 0 6px;"><span style="color:#1f2328;font-weight:700;">${esc(x.queueId)}</span> — ` +
        parts.join(" · ") +
        `</div>`
      );
    })
    .join("");
  return (
    `<div style="margin:14px 0 0;padding-top:12px;border-top:1px solid #d0d7de;">` +
    `<p style="margin:0 0 8px;color:#1f2328;font-weight:700;font-size:13px;">Case links — view statements, approve drafts:</p>` +
    lines +
    `</div>`
  );
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!verifyActionToken(WORK_ALL_ID, "workall", token)) {
    return page({
      tone: "err",
      status: 403,
      title: "Invalid link",
      headline: "⛔ Invalid work link",
      bodyHtml:
        "This link is incomplete or was not issued by Global EIS. " +
        "Copy a fresh one from the portal queue toolbar (“Copy one-tap link”).",
    });
  }

  const r = await workTheQueue();

  if (r.attempted === 0) {
    return page({
      tone: "ok",
      title: "Queue already clear",
      headline: "✓ Nothing pending — the queue is clear",
      bodyHtml: "Every case is DONE. New uploads will appear on the portal queue.",
    });
  }

  const remainingNote = r.remaining
    ? `<p style="margin:10px 0 0;color:#9a6700;font-weight:600;">${r.remaining} case(s) still pending — open this link again to work the next batch of ${MAX_WORK_BATCH}.</p>`
    : `<p style="margin:10px 0 0;color:#1a7f37;font-weight:600;">All pending cases worked — the queue is clear.</p>`;

  return page({
    tone: r.needsManual ? "warn" : "ok",
    title: "Queue worked",
    headline: `⚡ Worked ${r.attempted} case(s): ${r.delivered} delivered · ${r.draftReview} draft(s) ready · ${r.needsManual} need manual work`,
    bodyHtml:
      `<pre style="margin:0;white-space:pre-wrap;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#59636e;">${esc(resultText(r))}</pre>` +
      viewBlockHtml(r) +
      remainingNote,
  });
}
