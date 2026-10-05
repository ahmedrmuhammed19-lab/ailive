import { NextResponse } from "next/server";
import { verifyActionToken, WORK_ALL_ID } from "@/lib/actions";
import { db } from "@/lib/db";

/**
 * GET /api/queue/publish-report/<token>/<spec> — publish a standalone report
 * INTO the portal from outside, without a queue case.
 *
 * Why: /api/queue/attach closes a RED CASE (it needs a submissionId), but
 * operations/status reports have no case to attach to. The portal's reports
 * listing (/api/reports) already renders ReportFile rows with a null
 * submissionId for operators, and /api/report/download serves them — this
 * endpoint is simply the missing producer for that rows shape.
 *
 * Trust model: identical to /api/queue/go/<token> and /api/queue/attach —
 * the token is the 32-hex HMAC of (__queue__:workall) keyed with
 * SESSION_SECRET, passed in the URL PATH so query-stripping page readers can
 * reach it. No new capability class: whoever holds the magic link already
 * runs the whole engine.
 *
 * <spec> = base64url(JSON): { files: [{ u: "<https URL>", n: "<filename>" }],
 * note?: "<label>" } — each file is fetched ONCE server-side, sniffed (PDF
 * or HTML only), capped at 8 MB, and stored as DB bytes. No mail is sent
 * (the publish itself is announced by the agent in chat / via the ops mail).
 *
 * SSRF guard: only https URLs on the same fixed allowlist as attach.
 * Idempotent: re-invoking with the same files skips already-published copies.
 * A wrong token answers 404 with no detail, like any unknown route.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
interface Spec { files?: SpecFile[]; note?: string }

function decodeSpec(raw: string): Spec | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const obj = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (!obj || !Array.isArray(obj.files)) return null;
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

  const published: { name: string; sizeBytes: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const f of spec.files ?? []) {
    const url = (f.u ?? "").trim();
    const wantedKind = url.toLowerCase().endsWith(".pdf") ? "pdf" : "html";
    const name = sanitizeName(f.n ?? "", wantedKind);
    const existing = await db.reportFile.findFirst({ where: { name } });
    if (existing) {
      skipped.push({ name, reason: `already published (${existing.sizeBytes} bytes)` });
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
        submissionId: null,
        queueId: null,
        name,
        url: "",
        data: buf,
        sizeBytes: buf.length,
      },
    });
    published.push({ name, sizeBytes: buf.length });
  }

  return NextResponse.json({
    ok: true,
    published,
    skipped,
    note: spec.note ?? null,
    at: new Date().toISOString(),
  });
}
