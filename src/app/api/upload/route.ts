import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  extAllowed,
  generateQueueId,
  md5,
  normalizeQueueId,
  sanitizeName,
  submissionDirName,
} from "@/lib/portal";
import { putStatement } from "@/lib/storage";
import { loadMailCreds, operatorAddress, sendOrQueue } from "@/lib/mail";
import { sessionUser } from "@/lib/session";
import path from "path";

export const maxDuration = 120;

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

  // --- Simplified intake: Queue/User ID + client email + statements only ---
  // Customer name & case details are attached later from the operator queue.
  const userId = normalizeQueueId(String(form.get("userId") ?? ""));
  const rawEmail = String(form.get("email") ?? "").trim();
  let clientEmail: string | null = null;
  if (rawEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail) || rawEmail.length > 254) {
      return NextResponse.json(
        { ok: false, error: "The email address looks invalid — check it and try again." },
        { status: 400 }
      );
    }
    clientEmail = rawEmail.toLowerCase();
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  // Case context captured at intake (all optional — operator can correct later)
  const country = String(form.get("country") ?? "").trim().slice(0, 80) || null;
  const visaType = String(form.get("visaType") ?? "").trim().slice(0, 80) || null;
  const travelersRaw = Number(form.get("travelers"));
  const travelers =
    Number.isInteger(travelersRaw) && travelersRaw >= 1 && travelersRaw <= 20 ? travelersRaw : 1;

  if (files.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No files attached — attach at least one bank statement PDF." },
      { status: 400 }
    );
  }
  for (const f of files) {
    if (!extAllowed(f.name)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported file type: ${f.name} — allowed: PDF, PNG, JPG.`,
        },
        { status: 400 }
      );
    }
  }

  // --- Persist: queue row + files + handshake data ---
  let submission;
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
    for (const f of files) {
      const buf = Buffer.from(await f.arrayBuffer());
      const digest = md5(buf);
      const safeName = sanitizeName(f.name);
      const stored = await putStatement(subdir, safeName, buf);
      const record = await db.statementFile.create({
        data: {
          submissionId: submission.id,
          originalName: f.name,
          storedPath: stored.key,
          storedUrl: stored.url || null,
          sizeBytes: buf.length,
          md5: digest,
        },
      });
      handshake.push({
        fileId: record.id,
        name: f.name,
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

  await sendOrQueue({
    to: operatorAddress(await loadMailCreds()),
    subject: `📥 New bank statement uploaded — Queue ${userId}`,
    body:
      `A new bank statement was uploaded to the Global EIS queue.\n\n` +
      `Queue ID        : ${userId}\n` +
      `Submission      : ${submission.id}\n` +
      `Queue length    : ${waitingAhead} waiting (including this one)\n` +
      `Destination     : ${country ?? "—"}${visaType ? ` · ${visaType}` : ""}\n` +
      `Joint applicants: ${travelers} ${travelers > 1 ? "(benchmark ×" + travelers + ")" : ""}\n` +
      `Client email    : ${clientEmail ?? "not provided — report will go to this mailbox"}\n\n` +
      `Files (${handshake.length}) — MD5 hash-locked on arrival:\n${fileList}\n\n` +
      `Customer name & details are not collected at upload — attach them from the Queue tab when ready.\n` +
      `Say "start" in the workspace chat to begin the analysis.\n\n` +
      `— Global EIS automated intake`,
    kind: "operator_alert",
    submissionId: submission.id,
  });

  return NextResponse.json({
    ok: true,
    submissionId: submission.id,
    userId,
    status: "WAITING",
    queuePosition: waitingAhead,
    handshake,
  });
}
