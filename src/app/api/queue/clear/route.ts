import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionAccount } from "@/lib/session";
import { isOperator } from "@/lib/authz";
import fs from "fs";

/**
 * POST /api/queue/clear — operator-only "empty the whole queue".
 *
 * Deletes EVERY submission with all of its dependent rows (statement files,
 * published reports, engine parse logs) and returns per-table counts. Portal
 * accounts, engine lessons that are not tied to a case, and the mail outbox
 * are never touched.
 *
 * Body: { "confirm": true } — required; the request is rejected otherwise.
 *
 * Local dev also unlinks the statement files it owns on disk (best effort,
 * wrapped in try/catch — production blob keys are skipped silently).
 */
export async function POST(req: Request) {
  const account = await sessionAccount(req);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  if (!isOperator(account)) {
    return NextResponse.json(
      { ok: false, error: "Operator account required — client accounts cannot clear the queue." },
      { status: 403 }
    );
  }

  let confirm = false;
  try {
    const body = (await req.json()) as { confirm?: boolean };
    confirm = body?.confirm === true;
  } catch {
    confirm = false;
  }
  if (!confirm) {
    return NextResponse.json(
      { ok: false, error: "Confirmation required — send { \"confirm\": true }." },
      { status: 400 }
    );
  }

  const subs = await db.submission.findMany({
    select: { id: true, userId: true },
  });
  const subIds = subs.map((s) => s.id);

  if (subIds.length === 0) {
    return NextResponse.json({
      ok: true,
      cleared: { submissions: 0, files: 0, reports: 0, parseLogs: 0, diskFiles: 0 },
    });
  }

  // Best-effort local disk cleanup for dev-mode statement files.
  let diskFiles = 0;
  const stored = await db.statementFile.findMany({
    where: { submissionId: { in: subIds } },
    select: { storedPath: true },
  });
  for (const f of stored) {
    try {
      if (f.storedPath && f.storedPath.startsWith("/") && fs.existsSync(f.storedPath)) {
        fs.unlinkSync(f.storedPath);
        diskFiles++;
        // Also drop the case directory if it became empty (dev layout: upload/portal/<case>/file.pdf)
        const dir = f.storedPath.split("/").slice(0, -1).join("/");
        if (dir.includes("upload/portal/") && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      }
    } catch {
      // read-only fs (production) or already gone — ignore
    }
  }

  const files = await db.statementFile.deleteMany({ where: { submissionId: { in: subIds } } });
  const reports = await db.reportFile.deleteMany({ where: { submissionId: { in: subIds } } });
  const parseLogs = await db.parseLog.deleteMany({ where: { submissionId: { in: subIds } } });
  const submissions = await db.submission.deleteMany({ where: { id: { in: subIds } } });

  console.log(
    `[queue-clear] operator=${account.username} submissions=${submissions.count} files=${files.count} ` +
      `reports=${reports.count} parseLogs=${parseLogs.count} diskFiles=${diskFiles}`
  );

  return NextResponse.json({
    ok: true,
    cleared: {
      submissions: submissions.count,
      files: files.count,
      reports: reports.count,
      parseLogs: parseLogs.count,
      diskFiles,
    },
  });
}
