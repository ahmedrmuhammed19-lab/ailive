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
      const fd = new FormData();
      fd.set("userId", queueId);
      fd.set("email", clientEmail.trim());
      fd.set("country", country.trim());
      fd.set("visaType", visaType.trim());
      fd.set("travelers", String(travelers));
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json()) as UploadResponse;
      if (data.ok) {
        setResult(data);
        setFiles([]);
        setQueueId("");
        setClientEmail("");
        setCountry("");
        setVisaType("");
        setTravelers(1);
      } else {
        setError(data.error ?? "Upload rejected.");
      }
    } catch {
      setError("Network error during upload.");
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
            <p className="text-xs text-[var(--eis-muted)]">PDF, PNG, JPG · hash-locked (MD5) on arrival</p>
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
