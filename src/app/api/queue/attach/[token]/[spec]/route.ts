import { NextResponse } from "next/server";
import { verifyActionToken, WORK_ALL_ID } from "@/lib/actions";
import { db } from "@/lib/db";
import { markDoneAndNotify } from "@/lib/notify";

/**
 * GET /api/queue/attach/<token>/<spec> — analyst attach for red cases.
 *
 * The missing half of the work-all story: work-all can move a case forward
 * but scanned statements that cannot self-complete inside the serverless OCR
 * window park as red "needs manual" forever. This endpoint is the manual
 * path: the workspace analyst publishes a finished report INTO the portal
 * from outside, using the SAME trust token as /api/queue/go/<token>.
 *
 * Trust model: identical to the path-form work-all link (see go/[token]) —
 * the token is the 32-hex HMAC of (__queue__:workall) keyed with
 * SESSION_SECRET, passed in the URL PATH so query-stripping page readers can
 * reach it. No new capability class: whoever holds the magic link already
 * runs the whole engine; this only lets the analyst close a red case the
 * engine legitimately could not.
 *
 * <spec> = base64url(JSON): { q: "<queueId>", files: [{ u: "<https URL>",
 * n: "<filename>" }], note?: "<operator note>" } — each file is fetched ONCE
 * server-side, sniffed (PDF or HTML only), capped at 8 MB, stored as DB bytes
 * (production storage mode) and attached to the case; then the portal's own
 * markDoneAndNotify flow stamps DONE and emails client + operator.
 *
 * SSRF guard: only https URLs on a fixed allowlist of one-shot file hosts.
 * Idempotent: re-invoking with the same files skips already-attached copies.
 * A wrong token answers 404 with no detail, like any unknown route.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED_HOSTS = new Set([
  "tmpfiles.org",
  "0x0.st",
  "file.io",
  "files.catbox.moe",
  "litterbox.catbox.moe",
  "uguu.se",
  "transfer.sh",
  "temp.sh",
  "bashupload.com",
  "raw.githubusercontent.com",
]);

const MAX_BYTES = 8 * 1024 * 1024;

interface SpecFile { u?: string; n?: string }
interface Spec { q?: string; files?: SpecFile[]; note?: string }

function decodeSpec(raw: string): Spec | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const obj = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (!obj || typeof obj.q !== "string" || !Array.isArray(obj.files)) return null;
    return obj as Spec;
  } catch {
    return null;
  }
}

function sanitizeName(name: string, kind: "pdf" | "html"): string {
  const base = (name || "report").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return base.toLowerCase().endsWith(`.${kind}`) ? base : `${base}.${kind}`;
}

function sniffKind(buf: Buffer<ArrayBuffer>): "pdf" | "html" | null {
  if (buf.length < 5) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const head = buf.subarray(0, 4096).toString("utf8").trim().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<")) return "html";
  return null;
}

async function fetchFile(u: string): Promise<{ buf: Buffer<ArrayBuffer>; err?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { buf: Buffer.alloc(0), err: "bad URL" };
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return { buf: Buffer.alloc(0), err: `host not allowed: ${parsed.hostname}` };
  }
  try {
    const res = await fetch(parsed, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
    if (!res.ok) return { buf: Buffer.alloc(0), err: `fetch HTTP ${res.status}` };
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) return { buf: Buffer.alloc(0), err: "file too large (8MB cap)" };
    return { buf: Buffer.from(ab) };
  } catch (e) {
    return { buf: Buffer.alloc(0), err: `fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; spec: string }> }
) {
  const { token, spec: rawSpec } = await params;
  if (!verifyActionToken(WORK_ALL_ID, "workall", token ?? "")) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }
  const spec = decodeSpec(rawSpec ?? "");
  if (!spec) {
    return NextResponse.json({ ok: false, error: "Bad spec encoding." }, { status: 400 });
  }

  // Resolve the case (queue ID = Submission.userId); prefer the open row.
  const subs = await db.submission.findMany({
    where: { userId: spec.q },
    orderBy: { createdAt: "asc" },
  });
  if (subs.length === 0) {
    return NextResponse.json({ ok: false, error: `No case for queue ${spec.q}.` }, { status: 404 });
  }
  const sub = subs.find((s) => s.status !== "DONE") ?? subs[0];

  const existing = await db.reportFile.findMany({ where: { submissionId: sub.id } });

  const attached: { name: string; sizeBytes: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const htmlNames: string[] = [];

  for (const f of spec.files ?? []) {
    const url = (f.u ?? "").trim();
    const wantedKind = url.toLowerCase().endsWith(".pdf") ? "pdf" : "html";
    const name = sanitizeName(f.n ?? "", wantedKind);
    const dup = existing.find((r) => r.name === name);
    if (dup) {
      skipped.push({ name, reason: `already attached (${dup.sizeBytes} bytes)` });
      if (name.toLowerCase().endsWith(".html")) htmlNames.push(name);
      continue;
    }
    const { buf, err } = await fetchFile(url);
    if (err) {
      skipped.push({ name, reason: err });
      continue;
    }
    const kind = sniffKind(buf);
    if (!kind || kind !== wantedKind) {
      skipped.push({ name, reason: `content is ${kind ?? "unrecognized"}, expected ${wantedKind}` });
      continue;
    }
    await db.reportFile.create({
      data: {
        submissionId: sub.id,
        queueId: sub.userId,
        name,
        url: "",
        data: buf,
        sizeBytes: buf.length,
      },
    });
    attached.push({ name, sizeBytes: buf.length });
    if (kind === "html") htmlNames.push(name);
  }

  if (attached.length === 0 && htmlNames.length === 0 && sub.status === "DONE") {
    return NextResponse.json({
      ok: true,
      queueId: sub.userId,
      submissionId: sub.id,
      status: sub.status,
      attached,
      skipped,
      alreadyDone: true,
    });
  }

  let done: Awaited<ReturnType<typeof markDoneAndNotify>> | null = null;
  if (attached.length > 0) {
    done = await markDoneAndNotify(
      sub.id,
      htmlNames,
      spec.note ||
        "Analyst-completed report attached via the manual path (engine could not self-complete this scan)."
    );
  }

  return NextResponse.json({
    ok: true,
    queueId: sub.userId,
    submissionId: sub.id,
    status: done?.status ?? sub.status,
    attached,
    skipped,
    notified: done?.notified ?? null,
  });
}
