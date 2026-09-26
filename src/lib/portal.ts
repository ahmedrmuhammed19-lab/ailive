import { createHash, timingSafeEqual } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

/** Root directories (workspace-relative, outside Next source tree). */
export const WORKSPACE_ROOT = "/home/z/my-project";
export const PORTAL_UPLOAD_DIR = path.join(WORKSPACE_ROOT, "upload", "portal");
export const REPORTS_DIR = path.join(WORKSPACE_ROOT, "download");

/** Allowed statement file extensions. */
const ALLOWED_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

/** Returns true when the submitted access code matches the configured one (constant-time). */
export function accessCodeValid(code: string | null | undefined): boolean {
  const expected = process.env.PORTAL_ACCESS_CODE;
  if (!expected || !code) return false;
  const a = Buffer.from(code.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Human-readable byte size. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Sanitize a client-supplied filename: strip paths, keep extension, make it filesystem-safe. */
export function sanitizeName(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const base = path
    .basename(original, path.extname(original))
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${base || "file"}${ALLOWED_EXT.has(ext) ? ext : ".pdf"}`;
}

export function extAllowed(original: string): boolean {
  return ALLOWED_EXT.has(path.extname(original).toLowerCase());
}

/** Compute MD5 of a buffer (hex, lowercase). */
export function md5(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

/** Persist one uploaded file under upload/portal/<subdir>/ and return its stored path. */
export async function storeFile(
  subdir: string,
  safeName: string,
  data: Buffer
): Promise<string> {
  const dir = path.join(PORTAL_UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const stored = path.join(dir, safeName);
  await writeFile(stored, data);
  return stored;
}

/** Build a per-submission directory name. */
export function submissionDirName(clientName: string): string {
  const slug =
    clientName
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "client";
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  return `${ts}_${slug}`;
}

const QUEUE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 — unambiguous

/**
 * Generate a short human queue ID when the uploader doesn't supply one.
 * Format: EIS-XXXXX (5 unambiguous chars, e.g. EIS-7K3MP).
 */
export function generateQueueId(): string {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += QUEUE_ALPHABET[Math.floor(Math.random() * QUEUE_ALPHABET.length)];
  }
  return `EIS-${s}`;
}

/** Normalize a user-supplied queue ID: trim, uppercase, cap length, strip unsafe chars. */
export function normalizeQueueId(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 24);
  return cleaned || generateQueueId();
}
