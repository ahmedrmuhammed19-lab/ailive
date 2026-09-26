import { randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PORTAL_UPLOAD_DIR } from "@/lib/portal";

/**
 * Object storage — Vercel Blob in production, local filesystem in dev.
 *
 * Switch is automatic: when BLOB_READ_WRITE_TOKEN exists, objects go to Blob
 * under an unguessable random key prefix; otherwise they land under
 * upload/portal/ exactly as before (zero behavior change locally).
 *
 * Access model: blob keys carry a 64-bit random prefix (unguessable URLs),
 * and all reads flow through session-guarded API routes that proxy the bytes.
 */

export const BLOB_ENABLED = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export interface StoredObject {
  /** Storage key (fs path in dev mode, blob pathname in production). */
  key: string;
  /** Blob URL in production; empty string in local fs mode. */
  url: string;
}

/** Build a blob-safe storage key: <random prefix>/<subdir>/<filename>. */
function blobKey(subdir: string, filename: string): string {
  const prefix = randomBytes(8).toString("hex"); // 64-bit unguessable prefix
  const cleanSub = subdir.replace(/[^a-zA-Z0-9._/-]+/g, "_").replace(/^\/+|\/+$/g, "");
  const cleanName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${prefix}/${cleanSub}/${cleanName}`;
}

/** Persist an uploaded statement file. */
export async function putStatement(
  subdir: string,
  safeName: string,
  data: Buffer
): Promise<StoredObject> {
  if (BLOB_ENABLED) {
    const { put } = await import("@vercel/blob");
    const key = blobKey(subdir, safeName);
    const blob = await put(key, data, { access: "public", addRandomSuffix: false });
    return { key: blob.pathname, url: blob.url };
  }
  const dir = path.join(PORTAL_UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const full = path.join(dir, safeName);
  await writeFile(full, data);
  return { key: full, url: "" };
}

/** Persist a published report file (same storage rules as statements). */
export async function putReport(
  queueId: string,
  safeName: string,
  data: Buffer
): Promise<StoredObject> {
  if (BLOB_ENABLED) {
    const { put } = await import("@vercel/blob");
    const key = blobKey(`reports/${queueId.replace(/[^a-zA-Z0-9._-]+/g, "_")}`, safeName);
    const blob = await put(key, data, { access: "public", addRandomSuffix: false });
    return { key: blob.pathname, url: blob.url };
  }
  // Local mode keeps reports in the reports dir (download/), keyed by full path.
  const { REPORTS_DIR } = await import("@/lib/portal");
  await mkdir(REPORTS_DIR, { recursive: true });
  const full = path.join(REPORTS_DIR, safeName);
  await writeFile(full, data);
  return { key: full, url: "" };
}

/** Read a stored object back (blob fetch in production, fs read in dev). */
export async function getStoredObject(stored: StoredObject): Promise<Buffer | null> {
  try {
    if (stored.url) {
      const res = await fetch(stored.url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return await readFile(stored.key);
  } catch {
    return null;
  }
}
