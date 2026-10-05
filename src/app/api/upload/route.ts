import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import {
  extAllowed,
  generateQueueId,
  md5,
  normalizeQueueId,
  sanitizeName,
  submissionDirName,
} from "@/lib/portal";
import { DB_STORAGE, putStatement } from "@/lib/storage";
import { loadMailCreds, operatorAddress, sendOrQueue } from "@/lib/mail";
import { PORTAL_BASE_URL, actionUrl, statementViewUrl } from "@/lib/actions";
import { runEngine } from "@/lib/engine-run";
import { sessionUser } from "@/lib/session";
import path from "path";

export const maxDuration = 300; // matches MAX_OCR_SECONDS — big scans must not be killed mid-run

interface Intake {
  userId: string;
  clientEmail: string | null;
  country: string | null;
  visaType: string | null;
  travelers: number;
}

/** Shared intake-field parsing for the simple and chunked upload paths. */
function parseIntake(form: FormData): Intake | { error: string } {
  const userId = normalizeQueueId(String(form.get("userId") ?? ""));
  const rawEmail = String(form.get("email") ?? "").trim();
  let clientEmail: string | null = null;
  if (rawEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail) || rawEmail.length > 254) {
      return { error: "The email address looks invalid — check it and try again." };
    }
    clientEmail = rawEmail.toLowerCase();
  }
  const country = String(form.get("country") ?? "").trim().slice(0, 80) || null;
  const visaType = String(form.get("visaType") ?? "").trim().slice(0, 80) || null;
  const travelersRaw = Number(form.get("travelers"));
  const travelers =
    Number.isInteger(travelersRaw) && travelersRaw >= 1 && travelersRaw <= 20 ? travelersRaw : 1;
  return { userId, clientEmail, country, visaType, travelers };
}

/**
 * Persist a fully-received batch: queue row + files + handshake data + operator
 * alert. `items` carries the complete file bytes — from the simple single-request
 * path OR reassembled from UploadChunk staging on the chunked path.
 */
async function finalizeUpload(
  account: string,
  intake: Intake,
  items: Array<{ name: string; buf: Buffer<ArrayBuffer> }>
): Promise<NextResponse> {
  const { userId, clientEmail, country, visaType, travelers } = intake;

  for (const item of items) {
    if (!extAllowed(item.name)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported file type: ${item.name} — allowed: PDF, PNG, JPG.`,
        },
        { status: 400 }
      );
    }
  }
  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No files attached — attach at least one bank statement PDF." },
      { status: 400 }
    );
  }

  // --- Persist: queue row + files + handshake data ---
  let submission: Awaited<ReturnType<typeof db.submission.create>>;
  try {
    submission = await db.submission.create({
      data: {
        userId,
        status: "WAITING",
        clientName: null,
        email: clientEmail,
        country,
        visaType,
        travelers,
        submittedBy: account,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `Queue registration failed: ${err.message}`
            : "Queue registration failed.",
      },
      { status: 500 }
    );
  }

  const subdir = submissionDirName(userId);
  const handshake: Array<{
    fileId: string;
    name: string;
    storedAs: string;
    sizeBytes: number;
    md5: string;
    receivedAt: string;
  }> = [];

  try {
    for (const item of items) {
      const buf = item.buf;
      const digest = md5(buf);
      const safeName = sanitizeName(item.name);
      const stored = await putStatement(subdir, safeName, buf);
      const record = await db.statementFile.create({
        data: {
          submissionId: submission.id,
          originalName: item.name,
          storedPath: stored.key,
          storedUrl: stored.url || null,
          ...(DB_STORAGE ? { data: buf } : {}),
          sizeBytes: buf.length,
          md5: digest,
        },
      });
      handshake.push({
        fileId: record.id,
        name: item.name,
        storedAs: path.basename(stored.key),
        sizeBytes: buf.length,
        md5: digest,
        receivedAt: record.createdAt.toISOString(),
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `Storage failure after intake: ${err.message}`
            : "Storage failure.",
      },
      { status: 500 }
    );
  }

  // --- Queue position (waiting ahead + this one) ---
  const waitingAhead = await db.submission.count({ where: { status: "WAITING" } });

  // --- Email out: operator alert (queued to outbox until SMTP creds exist) ---
  const fileList = handshake
    .map((h) => `  • ${h.name} → ${h.storedAs} (${h.sizeBytes} bytes)\n    MD5 ${h.md5}`)
    .join("\n");

  const startUrl = actionUrl(submission.id, "start");
  // Signed session-free "view the statement" links — the operator can eyeball
  // the actual files straight from this mail before starting the analysis.
  const viewLinks = handshake.map((h) => `  • ${h.name}: ${statementViewUrl(h.fileId)}`).join("\n");
  const mailBody =
    `A new bank statement was uploaded to the Global EIS queue.\n\n` +
    `Queue ID        : ${userId}\n` +
    `Submission      : ${submission.id}\n` +
    `Queue length    : ${waitingAhead} waiting (including this one)\n` +
    `Destination     : ${country ?? "—"}${visaType ? ` · ${visaType}` : ""}\n` +
    `Joint applicants: ${travelers} ${travelers > 1 ? "(benchmark ×" + travelers + ")" : ""}\n` +
    `Client email    : ${clientEmail ?? "not provided — report will go to this mailbox"}\n\n` +
    `Files (${handshake.length}) — MD5 hash-locked on arrival:\n${fileList}\n\n` +
    `View the statement(s) in your browser:\n${viewLinks}\n\n` +
    `Analysis starts automatically in the background — no tap needed. The button below still works if a manual re-run is ever required.\n\n` +
    `— Global EIS automated intake`;

  // Rich-HTML twin of the alert — email-client-safe tables + inline styles.
  const fileRows = handshake
    .map(
      (h) =>
        `<tr>` +
        `<td style="padding:5px 8px;border-bottom:1px solid #eaeef2;font-size:12px;color:#24292f;"><a href="${statementViewUrl(h.fileId)}" style="color:#0969da;text-decoration:none;">${h.name}</a></td>` +
        `<td style="padding:5px 8px;border-bottom:1px solid #eaeef2;text-align:right;font-size:12px;color:#59636e;white-space:nowrap;">${h.sizeBytes.toLocaleString("en-US")} B</td>` +
        `<td style="padding:5px 8px;border-bottom:1px solid #eaeef2;font-family:monospace;font-size:11px;color:#8b949e;">${h.md5}</td>` +
        `</tr>`
    )
    .join("");
  const mailHtml =
    `<div style="margin:0;background:#f6f8fa;padding:20px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">` +
    `<div style="background:#0d1117;padding:12px 18px;"><span style="color:#ffffff;font-weight:700;font-size:15px;">Global EIS</span>` +
    `<span style="color:#8b949e;font-size:12px;margin-left:8px;">new bank statement in the queue</span></div>` +
    `<div style="padding:18px;">` +
    `<p style="margin:0 0 14px;color:#24292f;font-size:14px;line-height:1.55;">A new bank statement was uploaded. Review the files below, then start the process with one tap.</p>` +
    `<table style="width:100%;border-collapse:collapse;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;">` +
    `<tr><td style="padding:7px 12px;color:#59636e;font-size:12px;width:130px;">Queue ID</td><td style="padding:7px 12px;color:#24292f;font-size:13px;font-weight:700;">${userId}</td></tr>` +
    `<tr><td style="padding:7px 12px;color:#59636e;font-size:12px;">Destination</td><td style="padding:7px 12px;color:#24292f;font-size:13px;">${country ?? "—"}${visaType ? ` · ${visaType}` : ""}</td></tr>` +
    `<tr><td style="padding:7px 12px;color:#59636e;font-size:12px;">Joint applicants</td><td style="padding:7px 12px;color:#24292f;font-size:13px;">${travelers}${travelers > 1 ? ` (benchmark ×${travelers})` : ""}</td></tr>` +
    `<tr><td style="padding:7px 12px;color:#59636e;font-size:12px;">Client email</td><td style="padding:7px 12px;color:#24292f;font-size:13px;">${clientEmail ?? "not provided"}</td></tr>` +
    `<tr><td style="padding:7px 12px;color:#59636e;font-size:12px;">Queue position</td><td style="padding:7px 12px;color:#24292f;font-size:13px;">${waitingAhead} waiting (including this one)</td></tr>` +
    `</table>` +
    `<p style="margin:16px 0 6px;color:#24292f;font-size:13px;font-weight:700;">Files (${handshake.length}) — MD5 hash-locked on arrival <span style="font-weight:400;color:#8b949e;">(tap a file name to view it)</span></p>` +
    `<table style="width:100%;border-collapse:collapse;">` +
    `<tr><th style="padding:5px 8px;border-bottom:2px solid #d0d7de;text-align:left;font-size:11px;color:#59636e;">File</th><th style="padding:5px 8px;border-bottom:2px solid #d0d7de;text-align:right;font-size:11px;color:#59636e;">Size</th><th style="padding:5px 8px;border-bottom:2px solid #d0d7de;text-align:left;font-size:11px;color:#59636e;">MD5</th></tr>` +
    fileRows +
    `</table>` +
    `<div style="text-align:center;margin:22px 0 10px;">` +
    `<a href="${startUrl}" style="display:inline-block;background:#005677;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 34px;border-radius:6px;">&#9654; Start Analysis</a>` +
    `</div>` +
    `<p style="text-align:center;margin:0 0 14px;"><a href="${PORTAL_BASE_URL}/" style="color:#0969da;font-size:12px;">or open the portal queue</a> · <span style="color:#8b949e;font-size:12px;">every file name above is a view link</span></p>` +
    `<p style="margin:0;color:#8b949e;font-size:11px;line-height:1.5;">Starting flips this case to ANALYZING on the portal. The client is emailed automatically when the report is delivered.</p>` +
    `</div></div></div>`;

  await sendOrQueue({
    to: operatorAddress(await loadMailCreds()),
    subject: `📥 New bank statement uploaded — Queue ${userId}`,
    body: mailBody,
    html: mailHtml,
    kind: "operator_alert",
    submissionId: submission.id,
  });

  // --- AUTO_WORK: fire the engine automatically, zero taps ---
  // After the response is sent, stamp ANALYZING and run the full engine
  // (same code path as the signed start link — behavior can never drift).
  // Kill switch: AUTO_WORK=0 restores the manual "Start Analysis" flow.
  const autoWork = process.env.AUTO_WORK !== "0";
  if (autoWork) {
    after(async () => {
      try {
        const fresh = await db.submission.findUnique({ where: { id: submission.id } });
        if (!fresh || fresh.status !== "WAITING") return; // operator beat us to it
        await db.submission.update({
          where: { id: fresh.id },
          data: { status: "ANALYZING", analyzedAt: null },
        });
        const run = await runEngine(fresh, userId);
        console.log(
          `[auto-work] queue=${userId} submission=${fresh.id} outcome=${run.outcome}` +
            (run.integrity.length ? ` integrity=${run.integrity.join("/")}%` : "")
        );
      } catch (err) {
        console.error(`[auto-work] queue=${userId} submission=${submission.id} failed:`, err);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    submissionId: submission.id,
    userId,
    status: "WAITING",
    queuePosition: waitingAhead,
    handshake,
    autoWork,
  });
}

/**
 * Chunked-upload path — the browser sends each file as a sequence of <4.5 MB
 * requests (Vercel serverless body limit), staged in the UploadChunk table.
 * The final request carries the intake fields + a manifest; the server verifies
 * every chunk is present, reassembles the exact original bytes, and runs the
 * normal finalize pipeline. Result: statements of ANY size upload cleanly.
 */
async function handleChunked(
  form: FormData,
  account: string
): Promise<NextResponse> {
  const uploadId = String(form.get("uploadId") ?? "").slice(0, 80);
  if (!/^[\w-]{8,80}$/.test(uploadId)) {
    return NextResponse.json(
      { ok: false, error: "Malformed upload session id." },
      { status: 400 }
    );
  }
  const fileIdxRaw = Number(form.get("fileIdx"));
  const chunkIndexRaw = Number(form.get("chunkIndex"));
  if (!Number.isInteger(fileIdxRaw) || fileIdxRaw < 0 || fileIdxRaw > 99) {
    return NextResponse.json({ ok: false, error: "Malformed chunk file index." }, { status: 400 });
  }
  if (!Number.isInteger(chunkIndexRaw) || chunkIndexRaw < 0 || chunkIndexRaw > 9999) {
    return NextResponse.json({ ok: false, error: "Malformed chunk index." }, { status: 400 });
  }
  const chunk = form.get("fileChunk");
  if (!(chunk instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing chunk payload." }, { status: 400 });
  }
  const chunkBuf = Buffer.from(await chunk.arrayBuffer());

  // Housekeeping: sweep abandoned staging sessions older than 2 hours.
  if (fileIdxRaw === 0 && chunkIndexRaw === 0) {
    try {
      await db.uploadChunk.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 2 * 3600_000) } },
      });
    } catch {
      // sweep is best-effort — never block the upload
    }
  }

  const fileName = sanitizeName(String(form.get("fileName") ?? `file-${fileIdxRaw}`)) || `file-${fileIdxRaw}`;
  await db.uploadChunk.upsert({
    where: {
      uploadId_fileIdx_chunkIndex: {
        uploadId,
        fileIdx: fileIdxRaw,
        chunkIndex: chunkIndexRaw,
      },
    },
    create: { uploadId, fileIdx: fileIdxRaw, chunkIndex: chunkIndexRaw, name: fileName, data: chunkBuf },
    update: { name: fileName, data: chunkBuf },
  });

  const isFinal = String(form.get("final") ?? "") === "1";
  if (!isFinal) {
    return NextResponse.json({ ok: true, staged: true, received: chunkIndexRaw });
  }

  // --- Final chunk: verify completeness, reassemble, finalize ---
  let manifest: Array<{ fileIdx: number; chunksTotal: number; fileName: string }>;
  try {
    manifest = JSON.parse(String(form.get("manifest") ?? "[]"));
  } catch {
    manifest = [];
  }
  if (!Array.isArray(manifest) || manifest.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing upload manifest — retry the upload." },
      { status: 400 }
    );
  }
  const rows = await db.uploadChunk.findMany({ where: { uploadId } });
  const byKey = new Map(rows.map((r) => [`${r.fileIdx}:${r.chunkIndex}`, r]));
  for (const m of manifest) {
    for (let i = 0; i < m.chunksTotal; i++) {
      if (!byKey.has(`${m.fileIdx}:${i}`)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Upload incomplete — missing part ${i + 1}/${m.chunksTotal} of "${m.fileName}". Retry the upload.`,
          },
          { status: 400 }
        );
      }
    }
  }
  const items = manifest.map((m) => {
    const parts: Buffer<ArrayBuffer>[] = [];
    for (let i = 0; i < m.chunksTotal; i++) {
      parts.push(Buffer.from(byKey.get(`${m.fileIdx}:${i}`)!.data));
    }
    return { name: m.fileName, buf: Buffer.concat(parts) };
  });

  const intake = parseIntake(form);
  if ("error" in intake) {
    return NextResponse.json({ ok: false, error: intake.error }, { status: 400 });
  }

  const response = await finalizeUpload(account, intake, items);
  if (response.status === 200) {
    // Assembly succeeded — drop the staging rows for this session.
    try {
      await db.uploadChunk.deleteMany({ where: { uploadId } });
    } catch {
      // cleanup is best-effort; the 2h sweep is the backstop
    }
  }
  return response;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid form submission." },
      { status: 400 }
    );
  }

  // --- Gate: signed-in portal account ---
  const account = await sessionUser(req);
  if (!account) {
    return NextResponse.json(
      { ok: false, error: "Sign in required." },
      { status: 401 }
    );
  }

  // --- Chunked upload session (any file size) ---
  const uploadId = String(form.get("uploadId") ?? "");
  if (uploadId) {
    return handleChunked(form, account);
  }

  // --- Simple path: one request, small batch ---
  const intake = parseIntake(form);
  if ("error" in intake) {
    return NextResponse.json({ ok: false, error: intake.error }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No files attached — attach at least one bank statement PDF." },
      { status: 400 }
    );
  }
  const items: Array<{ name: string; buf: Buffer<ArrayBuffer> }> = [];
  for (const f of files) {
    items.push({ name: f.name, buf: Buffer.from(await f.arrayBuffer()) });
  }
  return finalizeUpload(account, intake, items);
}
