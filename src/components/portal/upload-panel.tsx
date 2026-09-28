"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, UploadCloud, FileText, X, CheckCircle2, Mail, Hash } from "lucide-react";
import { GH, humanSize } from "@/lib/format";

interface HandshakeFile {
  name: string;
  storedAs: string;
  sizeBytes: number;
  md5: string;
  receivedAt: string;
}

interface UploadResponse {
  ok: boolean;
  error?: string;
  submissionId?: string;
  userId?: string;
  queuePosition?: number;
  handshake?: HandshakeFile[];
}

/**
 * Vercel serverless functions hard-reject request bodies above 4.5 MB with a
 * plain-text 413 (FUNCTION_PAYLOAD_TOO_LARGE). res.json() then throws and the
 * user only saw "Network error during upload." — so we now gate and compress
 * client-side, below the platform ceiling, and surface precise errors.
 */
const MAX_FILE_BYTES = 4.4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4.4 * 1024 * 1024;
const COMPRESS_TARGET = 3.4 * 1024 * 1024;
const MAX_DIMENSION = 2600; // keep OCR/vision readable
const UPLOAD_TIMEOUT_MS = 120_000;

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Re-encode an oversized photo/scan as JPEG until it fits the upload ceiling. */
async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    const baseName = file.name.replace(/\.(png|jpe?g)$/i, "");
    const build = async (
      width: number,
      height: number,
      qualities: number[]
    ): Promise<File | null> => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const q of qualities) {
        const blob = await canvasBlob(canvas, q);
        if (blob && blob.size <= COMPRESS_TARGET) {
          return new File([blob], `${baseName}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
        }
      }
      return null;
    };
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const first = await build(w, h, [0.9, 0.8, 0.7, 0.6]);
    if (first) return first;
    // Still too heavy at q=0.6 → shrink dimensions by 35% and try once more.
    const second = await build(Math.round(w * 0.65), Math.round(h * 0.65), [0.75, 0.65, 0.55]);
    if (second) return second;
    throw new Error("compression could not reach the size limit");
  } finally {
    bitmap.close?.();
  }
}

interface PreparedUpload {
  ready: File[];
  blocked: string[];
}

/** Size gate + auto-compression, run before any bytes leave the browser. */
async function prepareFiles(files: File[]): Promise<PreparedUpload> {
  const ready: File[] = [];
  const blocked: string[] = [];
  for (const f of files) {
    if (f.size <= MAX_FILE_BYTES) {
      ready.push(f);
      continue;
    }
    if (/\.pdf$/i.test(f.name)) {
      blocked.push(
        `"${f.name}" is ${humanSize(f.size)} — over the 4.5 MB direct-upload limit. ` +
          `Re-save or export the PDF at lower scan quality (or split the pages), ` +
          `or upload the pages as JPG/PNG photos — those are compressed automatically.`
      );
      continue;
    }
    try {
      const smaller = await compressImage(f);
      ready.push(smaller);
    } catch {
      blocked.push(
        `"${f.name}" (${humanSize(f.size)}) could not be compressed under the upload limit — ` +
          `re-shoot or re-save the photo at a smaller size.`
      );
    }
  }
  // Multi-file batches share one request body — enforce the ceiling on the total too.
  let total = 0;
  const finalReady: File[] = [];
  for (const f of ready) {
    if (total + f.size > MAX_TOTAL_BYTES) {
      blocked.push(
        `"${f.name}" pushes the batch over the 4.5 MB single-upload limit ` +
          `(earlier files in this batch: ${humanSize(total)}). Upload it in a second batch.`
      );
      continue;
    }
    total += f.size;
    finalReady.push(f);
  }
  return { ready: finalReady, blocked };
}

interface SendOutcome {
  ok: boolean;
  message: string;
  data?: UploadResponse;
}

/** One upload attempt with hard timeout; maps every failure to a precise message. */
async function sendUpload(fd: FormData): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    const raw = await res.text();
    let data: UploadResponse | null = null;
    try {
      data = JSON.parse(raw) as UploadResponse;
    } catch {
      data = null;
    }
    if (data?.ok) return { ok: true, message: "uploaded", data };
    if (data && !data.ok) return { ok: false, message: data.error ?? "Upload rejected." };
    // Non-JSON body → a proxy/edge layer answered, not the portal API.
    if (res.status === 413) {
      return {
        ok: false,
        message:
          "The server rejected the files as too large. Large photos are compressed automatically — " +
          "if this still happens, re-save the PDF at lower scan quality or upload smaller batches.",
      };
    }
    if (res.status === 401) {
      return {
        ok: false,
        message: "Your session has expired — sign in again, then retry the upload.",
      };
    }
    if (res.status >= 500) {
      return { ok: false, message: `Portal server error (HTTP ${res.status}) — please try again.` };
    }
    return { ok: false, message: `Upload failed (HTTP ${res.status}).` };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      message: aborted
        ? "The upload timed out — check the connection and try again."
        : "Could not reach the portal — check the internet connection (the server may be restarting), then try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function UploadPanel() {
  const [queueId, setQueueId] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [country, setCountry] = useState("");
  const [visaType, setVisaType] = useState("");
  const [travelers, setTravelers] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const ok: File[] = [];
    for (const f of Array.from(incoming)) {
      const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
      if ([".pdf", ".png", ".jpg", ".jpeg"].includes(ext)) ok.push(f);
    }
    if (ok.length === 0) {
      setError("Only PDF, PNG and JPG statements are accepted.");
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...ok]);
  }, []);

  const submit = useCallback(async () => {
    if (files.length === 0) {
      setError("Attach at least one bank statement.");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const { ready, blocked } = await prepareFiles(files);
      if (ready.length === 0) {
        setError(blocked.join(" "));
        return;
      }
      const fd = new FormData();
      fd.set("userId", queueId);
      fd.set("email", clientEmail.trim());
      fd.set("country", country.trim());
      fd.set("visaType", visaType.trim());
      fd.set("travelers", String(travelers));
      for (const f of ready) fd.append("files", f);
      let outcome = await sendUpload(fd);
      if (!outcome.ok && /reach the portal|timed out/i.test(outcome.message)) {
        // One silent retry for transient connection drops — real user networks blip.
        await new Promise((r) => setTimeout(r, 1500));
        outcome = await sendUpload(fd);
      }
      if (outcome.ok && outcome.data) {
        setResult(outcome.data);
        setFiles([]);
        setQueueId("");
        setClientEmail("");
        setCountry("");
        setVisaType("");
        setTravelers(1);
      } else {
        setError(blocked.length > 0 ? `${blocked.join(" ")} ${outcome.message}` : outcome.message);
      }
    } finally {
      setUploading(false);
    }
  }, [queueId, clientEmail, country, visaType, travelers, files]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Step 1 — Queue ID */}
      <div className="rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)]">
        <div className="border-b border-[var(--eis-border-muted)] bg-[var(--eis-canvas-subtle)] px-4 py-2.5 text-sm font-semibold" style={{ color: GH.fg }}>
          1 · Queue ID
        </div>
        <div className="space-y-2 p-4">
          <Input
            value={queueId}
            onChange={(e) => setQueueId(e.target.value.toUpperCase())}
            placeholder="e.g. 1024 or AHMED-01"
            aria-label="Queue or user ID"
            className="max-w-xs font-mono text-sm uppercase placeholder:normal-case placeholder:font-sans placeholder:text-[var(--eis-neutral)]"
          />
          <p className="text-xs text-[var(--eis-muted)]">
            Leave blank and we&apos;ll assign one automatically (EIS-XXXXX). The customer name and case
            details are attached later by Global EIS from the queue.
          </p>
          <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
            <div>
              <label htmlFor="dest-country" className="mb-1 block text-xs font-semibold" style={{ color: GH.fg }}>
                Destination country
              </label>
              <Input
                id="dest-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                list="country-options"
                placeholder="e.g. United Kingdom"
                aria-label="Destination country"
                className="text-sm placeholder:text-[var(--eis-neutral)]"
              />
              <datalist id="country-options">
                <option value="United Kingdom" />
                <option value="Schengen Area" />
                <option value="United States" />
                <option value="Canada" />
                <option value="Australia" />
              </datalist>
            </div>
            <div>
              <label htmlFor="visa-type" className="mb-1 block text-xs font-semibold" style={{ color: GH.fg }}>
                Visa type
              </label>
              <Input
                id="visa-type"
                value={visaType}
                onChange={(e) => setVisaType(e.target.value)}
                list="visa-options"
                placeholder="e.g. Standard Visitor"
                aria-label="Visa type"
                className="text-sm placeholder:text-[var(--eis-neutral)]"
              />
              <datalist id="visa-options">
                <option value="Standard Visitor (Tourism)" />
                <option value="Business" />
                <option value="Family Visit" />
                <option value="Study" />
                <option value="Work" />
              </datalist>
            </div>
            <div>
              <label htmlFor="joint-applicants" className="mb-1 block text-xs font-semibold" style={{ color: GH.fg }}>
                Joint applicants
              </label>
              <select
                id="joint-applicants"
                value={travelers}
                onChange={(e) => setTravelers(Number(e.target.value))}
                aria-label="Joint applicants sharing this statement"
                className="h-9 w-full rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-2 text-sm"
                style={{ color: GH.fg }}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "person" : "people"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-[var(--eis-muted)]">
            Joint applicants = how many people are using this same bank statement for their visa
            applications — the required balance is multiplied accordingly.
          </p>
          <div className="pt-1">
            <label htmlFor="client-email" className="mb-1 block text-xs font-semibold" style={{ color: GH.fg }}>
              Email for the report delivery
            </label>
            <Input
              id="client-email"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="client@example.com"
              aria-label="Client email for report delivery"
              className="max-w-xs text-sm placeholder:text-[var(--eis-neutral)]"
            />
            <p className="mt-1 flex items-center gap-1 text-xs text-[var(--eis-muted)]">
              <Mail className="h-3 w-3" aria-hidden="true" />
              When the analysis is finished, the report is emailed here.
            </p>
          </div>
        </div>
      </div>

      {/* Step 2 — Statement */}
      <div className="rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)]">
        <div className="border-b border-[var(--eis-border-muted)] bg-[var(--eis-canvas-subtle)] px-4 py-2.5 text-sm font-semibold" style={{ color: GH.fg }}>
          2 · Bank statement
        </div>
        <div className="space-y-3 p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload statements"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed p-6 text-center transition-colors ${
              dragOver ? "border-[var(--eis-accent)] bg-[var(--eis-accent-subtle)]" : "border-[var(--eis-border)] bg-[var(--eis-canvas-subtle)] hover:border-[var(--eis-accent)]"
            }`}
          >
            <UploadCloud className="h-7 w-7 text-[var(--eis-muted)]" aria-hidden="true" />
            <p className="text-sm font-medium" style={{ color: GH.fg }}>
              Drop the statement here or <span className="text-[var(--eis-accent)] underline">browse</span>
            </p>
            <p className="text-xs text-[var(--eis-muted)]">
              PDF, PNG, JPG · hash-locked (MD5) on arrival · large photos are compressed automatically ·
              single files up to 4.5 MB
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-[var(--eis-border)] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-[var(--eis-muted)]" aria-hidden="true" />
                    <span className="truncate text-sm" style={{ color: GH.fg }}>{f.name}</span>
                    <span className="shrink-0 text-xs text-[var(--eis-muted)]">{humanSize(f.size)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${f.name}`}
                    className="h-7 px-2 text-[var(--eis-muted)] hover:text-[var(--eis-danger)]"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="rounded-md border border-[var(--eis-border)] bg-[var(--eis-danger-subtle)] px-3 py-2 text-sm" style={{ color: GH.danger }} role="alert">
              {error}
            </p>
          )}

          <Button
            onClick={submit}
            disabled={uploading}
            className="w-full bg-[var(--eis-btn-green)] text-white hover:bg-[var(--eis-btn-green-hover)] sm:w-auto"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4" aria-hidden="true" />}
            {uploading ? "Adding to queue…" : "Add to queue"}
          </Button>
        </div>
      </div>

      {/* Success card */}
      {result?.ok && result.handshake && (
        <div className="rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)]">
          <div className="flex items-center gap-2 border-b border-[var(--eis-border-muted)] bg-[var(--eis-success-subtle)] px-4 py-2.5 text-sm font-semibold text-[var(--eis-btn-green-hover)]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Statement received — added to the queue
          </div>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas-subtle)] px-3 py-2">
                <Hash className="h-4 w-4 text-[var(--eis-muted)]" aria-hidden="true" />
                <span className="font-mono text-lg font-semibold tracking-wide" style={{ color: GH.fg }}>
                  {result.userId}
                </span>
              </div>
              <span className="text-sm text-[var(--eis-muted)]">
                queue position #{result.queuePosition} · {result.handshake.length} file(s) verified byte-perfect
              </span>
            </div>
            <div className="space-y-1.5">
              {result.handshake.map((h) => (
                <div key={h.storedAs} className="rounded-md border border-[var(--eis-border)] px-3 py-2 text-xs">
                  <div className="font-medium" style={{ color: GH.fg }}>{h.name}</div>
                  <div className="mt-0.5 break-all font-mono text-[var(--eis-muted)]">MD5 {h.md5}</div>
                </div>
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-[var(--eis-muted)]">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              Arrival alert sent to <span className="font-medium">ahmedr.muhammed19@gmail.com</span> — the analysis
              starts when Global EIS says &quot;start&quot;.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
