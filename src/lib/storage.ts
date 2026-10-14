import { randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PORTAL_UPLOAD_DIR } from "@/lib/portal";

/**
 * Object storage — three drivers with automatic selection:
 *
 *   1. blob — Vercel Blob, when BLOB_READ_WRITE_TOKEN is set (or FILE_STORAGE=blob).
 *   2. db   — file bytes live in the database itself (postgres bytea). Active
 *             when DATABASE_URL is a postgres:// URL (i.e. hosted deploys such
 *             as Vercel + Neon) with no Blob token, or FILE_STORAGE=db.
 *   3. fs   — local filesystem under upload/portal + download/ (dev default,
 *             sqlite local DB).
 *
 * FILE_STORAGE env var ("blob" | "db" | "fs") overrides the auto-detection.
 *
 * Access model: blob keys / DB rows are only reachable through session-guarded
 * API routes that proxy the bytes — never public URLs in DB mode.
 */

const explicit = (process.env.FILE_STORAGE ?? "").trim().toLowerCase();

export const BLOB_ENABLED = explicit
  ? explicit === "blob"
  : Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export const DB_STORAGE =
  !BLOB_ENABLED &&
  (explicit
    ? explicit === "db"
    : String(process.env.DATABASE_URL ?? "").startsWith("postgres"));

/** ── GitHub vault driver (DL-19) ─────────────────────────────────────────────
 * 4th driver: file bytes live as immutable commits in a PRIVATE GitHub repo
 * (GH_VAULT_TOKEN + GH_VAULT_REPO="owner/repo"). Keys look like
 * `gh:<hex-prefix>/<subdir>/<name>@<blobSha>` — the git blob SHA rides the key
 * as built-in tamper evidence. Reads are proxied server-side only; the token
 * never reaches a client. FILE_STORAGE=gh forces it on, anything else forces
 * it off; with no override, presence of both env vars enables it.
 */
const GH_VAULT_TOKEN = (process.env.GH_VAULT_TOKEN ?? "").trim();
const GH_VAULT_REPO = (process.env.GH_VAULT_REPO ?? "").trim(); // "owner/repo"

export const GH_STORAGE =
  Boolean(GH_VAULT_TOKEN && GH_VAULT_REPO) && (explicit ? explicit === "gh" : true);

/** DB rows carry file bytes only when the DB itself is the store (not gh/blob). */
export const STORE_BYTES_IN_DB = DB_STORAGE && !GH_STORAGE;

function ghApi(pathInRepo: string, init?: RequestInit): Promise<Response> {
  const [owner, repo] = GH_VAULT_REPO.split("/");
  return fetch(`https://api.github.com/repos/${owner}/${repo}/${pathInRepo}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GH_VAULT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
}

/** Commit bytes to the vault; StoredObject.key = `gh:<path>@<blobSha>`. */
async function ghPut(dirInRepo: string, safeName: string, data: Buffer, message: string): Promise<StoredObject> {
  const prefix = randomBytes(8).toString("hex"); // 64-bit unguessable path prefix
  const p = `${prefix}/${dirInRepo.replace(/[^a-zA-Z0-9._/-]+/g, "_").replace(/^\/+|\/+$/g, "")}/${safeName}`;
  const res = await ghApi(`contents/${encodeURI(p)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: data.toString("base64") }),
  });
  if (!res.ok) throw new Error(`vault commit failed: HTTP ${res.status}`);
  const j = (await res.json()) as { content?: { sha?: string } };
  return { key: `gh:${p}@${j.content?.sha ?? ""}`, url: "" };
}

/** Stream bytes back out of the vault (raw media type, server-side only). */
export async function ghVaultFetch(key: string): Promise<Buffer | null> {
  try {
    const p = key.split("@")[0];
    const res = await ghApi(`contents/${encodeURI(p)}`, {
      headers: { Accept: "application/vnd.github.raw" },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

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

/** Persist an uploaded statement file. In DB mode the caller stores bytes on the row. */
export async function putStatement(
  subdir: string,
  safeName: string,
  data: Buffer
): Promise<StoredObject> {
  if (GH_STORAGE) {
    return await ghPut(`statements/${subdir}`, safeName, data, `statement: ${safeName}`);
  }
  if (BLOB_ENABLED) {
    const { put } = await import("@vercel/blob");
    const key = blobKey(subdir, safeName);
    const blob = await put(key, data, { access: "public", addRandomSuffix: false });
    return { key: blob.pathname, url: blob.url };
  }
  if (DB_STORAGE) {
    // Bytes are persisted on the StatementFile row by the caller — key is cosmetic.
    return { key: `db:${subdir}/${safeName}`, url: "" };
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
  if (GH_STORAGE) {
    return await ghPut(`reports/${queueId.replace(/[^a-zA-Z0-9._-]+/g, "_")}`, safeName, data, `report: ${safeName}`);
  }
  if (BLOB_ENABLED) {
    const { put } = await import("@vercel/blob");
    const key = blobKey(`reports/${queueId.replace(/[^a-zA-Z0-9._-]+/g, "_")}`, safeName);
    const blob = await put(key, data, { access: "public", addRandomSuffix: false });
    return { key: blob.pathname, url: blob.url };
  }
  if (DB_STORAGE) {
    // Bytes are persisted on the ReportFile row by the caller — key is cosmetic.
    return { key: `db:reports/${queueId}/${safeName}`, url: "" };
  }
  // Local mode keeps reports in the reports dir (download/), keyed by full path.
  const { REPORTS_DIR } = await import("@/lib/portal");
  await mkdir(REPORTS_DIR, { recursive: true });
  const full = path.join(REPORTS_DIR, safeName);
  await writeFile(full, data);
  return { key: full, url: "" };
}

/** Read a stored object back (vault fetch, blob fetch in production, fs read in dev). */
export async function getStoredObject(stored: StoredObject): Promise<Buffer | null> {
  try {
    if (stored.key.startsWith("gh:")) return await ghVaultFetch(stored.key.slice(3));
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

/** Load a statement/report row's bytes regardless of driver:
 *  gh vault key (storedPath/url) → DB row bytes → blob URL → fs path. */
export async function loadFileBytes(
  row: { storedPath?: string | null; storedUrl?: string | null; data?: Uint8Array | null }
): Promise<Buffer | null> {
  const key = row.storedPath ?? "";
  if (key.startsWith("gh:")) return await ghVaultFetch(key.slice(3));
  if (row.data) return Buffer.from(row.data);
  if (row.storedUrl) return await getStoredObject({ key: "", url: row.storedUrl });
  if (key) return await getStoredObject({ key, url: "" });
  return null;
}

/** Persist a report artifact per the active driver. In gh mode the vault key
 * rides the ReportFile.url field (the model has no storedPath column); in
 * db/fs modes bytes stay on the row exactly as before. */
export async function storeReportRow(
  queueId: string,
  name: string,
  buf: Buffer
): Promise<{ url: string; data: Uint8Array<ArrayBuffer> | null }> {
  if (BLOB_ENABLED) {
    const stored = await putReport(queueId, name, buf);
    return { url: stored.url, data: null };
  }
  if (GH_STORAGE) {
    const stored = await putReport(queueId, name, buf);
    return { url: stored.key, data: null };
  }
  return { url: "", data: Uint8Array.from(buf) };
}
