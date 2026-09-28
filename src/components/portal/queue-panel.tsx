"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  PlayCircle,
  CheckCircle2,
  CheckCheck,
  RotateCcw,
  RefreshCw,
  Save,
  FileText,
  Inbox,
  Zap,
  Link2,
} from "lucide-react";
import { GH, STATUS_META, timeAgo } from "@/lib/format";

interface QueueItem {
  id: string;
  userId: string;
  status: string;
  clientName: string | null;
  country: string | null;
  visaType: string | null;
  travelers: number;
  email: string | null;
  notes: string | null;
  submittedBy: string | null;
  needsManual?: boolean;
  analyzedAt: string | null;
  fileCount: number;
  files: Array<{ id: string; name: string }>;
  createdAt: string;
}

const FILTERS = ["ALL", "WAITING", "ANALYZING", "DONE"] as const;

export function QueuePanel({ refreshKey, isOperator }: { refreshKey: number; isOperator?: boolean }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<QueueItem>>({});

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/queue`);
      if (res.status === 401) {
        setItems([]);
        return;
      }
      const data = (await res.json()) as { ok: boolean; queue: QueueItem[] };
      setItems(data.queue ?? []);
    } catch {
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const update = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      setSavingId(id);
      try {
        await fetch("/api/queue/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...patch }),
        });
        await load();
      } finally {
        setSavingId(null);
      }
    },
    [load]
  );

  // Fire (or re-fire) the analysis engine on a pending case — same pipeline as
  // the email links: parse → draft → auto-deliver at 100% / park for review.
  // This is the step-forward for yellow “draft ready” and red “Needs manual”
  // rows (e.g. after the client sends a better, digital PDF).
  const runEngine = useCallback(
    async (id: string) => {
      setSavingId(id);
      try {
        await fetch("/api/queue/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        await load();
      } finally {
        setSavingId(null);
      }
    },
    [load]
  );

  const counts = { ALL: items?.length ?? 0, WAITING: 0, ANALYZING: 0, DONE: 0 };
  for (const i of items ?? []) if (i.status in counts) counts[i.status as keyof typeof counts]++;

  const visible = (items ?? []).filter((i) => filter === "ALL" || i.status === filter);

  // One-keyword bulk pass: fire the engine on EVERY pending case (oldest
  // first). 100% cases deliver themselves, the rest come back triaged with a
  // precise reason — the true step-forward for "stuck on analyzing".
  const workAll = useCallback(async () => {
    const pending = counts.WAITING + counts.ANALYZING;
    if (pending === 0) return;
    if (
      !window.confirm(
        `Run the engine on every pending case (${pending})?\n\n` +
          `• 100% chain integrity → report delivered to the client automatically.\n` +
          `• Below the gate → draft ready for your review (then Mark done).\n` +
          `• Unparseable / no files → flagged red with a fix-forward email.\n` +
          `• Nothing is force-greened — Yellow/Red stays for your decision.\n\n` +
          `Up to 5 cases per pass — press again to continue the rest.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/queue/work-all`, { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        attempted?: number;
        delivered?: number;
        draftReview?: number;
        needsManual?: number;
        remaining?: number;
        results?: Array<{ queueId: string; outcome: string; integrity: number[] }>;
        error?: string;
      };
      if (!data.ok) {
        window.alert(data.error ?? "Could not work the queue.");
        return;
      }
      const perRow = (data.results ?? [])
        .map((x) => {
          const integ = x.integrity.length ? ` (${x.integrity.join("%/")}%)` : "";
          if (x.outcome === "auto-delivered") return `• ${x.queueId}: delivered to client${integ}`;
          if (x.outcome === "draft-review") return `• ${x.queueId}: draft ready${integ} — mark DONE to deliver`;
          if (x.outcome === "no-files") return `• ${x.queueId}: no files — flagged red`;
          return `• ${x.queueId}: needs manual work${integ}`;
        })
        .join("\n");
      const cont = data.remaining ? `\n\n${data.remaining} still pending — press ⚡ again to work the next batch.` : "";
      window.alert(
        `Queue worked: ${data.attempted ?? 0} case(s) — ${data.delivered ?? 0} delivered, ${data.draftReview ?? 0} draft(s) ready, ${data.needsManual ?? 0} need manual work.${cont}${perRow ? `\n\n${perRow}` : ""}`
      );
      await load();
    } catch {
      window.alert("Network error while working the queue.");
    } finally {
      setBusy(false);
    }
  }, [counts.WAITING, counts.ANALYZING, load]);

  // Copy the signed, session-free "one keyword" link — bookmark it or mail it
  // to yourself; opening it later works the whole queue without signing in.
  const copyWorkLink = useCallback(async () => {
    try {
      const res = await fetch(`/api/queue/work-link`);
      const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!data.ok || !data.url) {
        window.alert(data.error ?? "Could not mint the one-tap link.");
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
      } catch {
        /* clipboard blocked (http / permissions) — the alert below still shows it */
      }
      window.alert(
        `Your one-tap queue link (copied to clipboard):\n\n${data.url}\n\n` +
          `Bookmark it or email it to yourself — opening it works the whole queue in one tap, no sign-in needed.`
      );
    } catch {
      window.alert("Network error while minting the one-tap link.");
    }
  }, []);

  const greenAll = useCallback(async () => {
    const pending = counts.WAITING + counts.ANALYZING;
    if (pending === 0) return;
    if (
      !window.confirm(
        `Flip ${pending} remaining case${pending > 1 ? "s" : ""} to DONE?\n\n` +
          `• Cases WITHOUT a client email: marked DONE silently (no emails).\n` +
          `• Cases WITH a client email + published report: the client receives the report-ready email.\n` +
          `• Cases WITH a client email but NO report: skipped (finish those first).`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/queue/complete-all`, { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        flipped?: number;
        delivered?: number;
        silent?: number;
        skipped?: Array<{ id?: string; queueId: string | null; reason: string }>;
        error?: string;
      };
      if (!data.ok) {
        window.alert(data.error ?? "Could not complete the queue.");
        return;
      }
      const skipped = data.skipped?.length
        ? `\n\nSkipped:\n${data.skipped.map((s) => `• ${s.queueId ?? s.id}: ${s.reason}`).join("\n")}`
        : "";
      window.alert(
        `Queue completed: ${data.flipped ?? 0} case(s) marked DONE (${data.delivered ?? 0} emailed to clients, ${data.silent ?? 0} silent).${skipped}`
      );
      await load();
    } catch {
      window.alert("Network error while completing the queue.");
    } finally {
      setBusy(false);
    }
  }, [counts.WAITING, counts.ANALYZING, load]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 ${
                filter === f
                  ? "eis-gradient-brand text-white shadow-[var(--eis-glow)]"
                  : "border border-[var(--eis-border)] bg-[var(--eis-canvas)] text-[var(--eis-muted)] hover:-translate-y-0.5 hover:bg-[var(--eis-hover)]"
              }`}
              aria-pressed={filter === f}
            >
              {f === "ALL" ? "All" : STATUS_META[f].label}
              <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold">
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isOperator && counts.WAITING + counts.ANALYZING > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={workAll}
              disabled={busy}
              title="Run the engine on every pending case — 100% cases deliver automatically, the rest come back triaged"
              className="gap-1.5 border-[var(--eis-attention)] text-[var(--eis-attention)] hover:bg-[var(--eis-attention-subtle)] dark:border-[#d29922] dark:text-[#d29922] dark:hover:bg-[#2d2213]"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Zap className="h-3.5 w-3.5" aria-hidden="true" />}
              Work the queue ({counts.WAITING + counts.ANALYZING})
            </Button>
          )}
          {isOperator && counts.WAITING + counts.ANALYZING > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={greenAll}
              disabled={busy}
              className="gap-1.5 border-[var(--eis-btn-green-hover)] text-[var(--eis-btn-green-hover)] hover:bg-[var(--eis-success-subtle)] dark:border-[#2ea043] dark:text-[#3fb950] dark:hover:bg-[#12261e]"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              Green all ({counts.WAITING + counts.ANALYZING})
            </Button>
          )}
          {isOperator && (
            <Button
              variant="outline"
              size="sm"
              onClick={copyWorkLink}
              disabled={busy}
              title="Copy your signed one-tap link — opening it later works the whole queue without signing in"
              className="gap-1.5 border-[var(--eis-border)] text-[var(--eis-muted)] hover:bg-[var(--eis-hover)]"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden md:inline">One-tap link</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={busy} className="gap-1.5 border-[var(--eis-border)] text-[var(--eis-fg)] hover:bg-[var(--eis-canvas-subtle)]">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="eis-glass overflow-hidden rounded-2xl">
        {items === null ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--eis-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading queue…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="h-8 w-8 text-[var(--eis-neutral)]" aria-hidden="true" />
            <p className="text-sm text-[var(--eis-muted)]">
              {filter === "ALL" ? "Queue is empty — statements you upload will appear here." : `No ${STATUS_META[filter]?.label.toLowerCase()} items.`}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--eis-border-muted)]">
            {visible.map((item) => {
              // Traffic-light: green DONE · yellow ANALYZING · red = engine gave
              // up on this case (unrecognized/no-files) and it needs a human.
              const meta =
                item.status === "ANALYZING" && item.needsManual
                  ? STATUS_META.NEEDS_MANUAL
                  : STATUS_META[item.status] ?? STATUS_META.WAITING;
              const open = expanded === item.id;
              return (
                <li key={item.id} className="group">
                  <div className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--eis-canvas-subtle)]"
                    onClick={() => {
                      setExpanded(open ? null : item.id);
                      setDraft({
                        clientName: item.clientName ?? "",
                        country: item.country ?? "",
                        visaType: item.visaType ?? "",
                        travelers: item.travelers ?? 1,
                        email: item.email ?? "",
                        notes: item.notes ?? "",
                      });
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setExpanded(open ? null : item.id)}
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-[var(--eis-neutral)]" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--eis-neutral)]" aria-hidden="true" />
                    )}
                    <span
                      className="flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: meta.bg, color: meta.fg, borderColor: `${meta.dot}66` }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} aria-hidden="true" />
                      {meta.label}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-semibold" style={{ color: GH.fg }}>
                      {item.userId}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate text-sm text-[var(--eis-muted)] sm:block">
                      {item.clientName ?? "details pending"}
                      {item.country ? ` · ${item.country}` : ""}
                      {item.travelers > 1 && (
                        <span className="ml-1.5 rounded-full border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-1.5 py-px text-[10px] font-semibold text-[var(--eis-attention)]">
                          ×{item.travelers} joint
                        </span>
                      )}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-[var(--eis-muted)]">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        {item.fileCount}
                      </span>
                      <span className="hidden sm:inline">{timeAgo(item.createdAt)}</span>
                    </span>
                  </div>

                  {/* Expanded detail / editor */}
                  {open && (
                    <div className="space-y-4 border-t border-[var(--eis-border-muted)] bg-[var(--eis-canvas-subtle)] px-4 py-4 sm:px-10">
                      {item.files.length > 0 && (
                        <div className="rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-3 py-2">
                          <p className="text-xs font-semibold text-[var(--eis-muted)]">
                            Statements ({item.files.length}) — click to view in a new tab
                          </p>
                          <ul className="mt-1.5 space-y-1">
                            {item.files.map((f) => (
                              <li key={f.id}>
                                <a
                                  href={`/api/statement?id=${encodeURIComponent(f.id)}&disp=inline`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="View this statement in a new tab"
                                  className="flex items-center gap-1.5 text-sm text-[var(--eis-accent)] hover:underline"
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{f.name}</span>
                                  <span className="shrink-0 text-[10px] text-[var(--eis-muted)]">view ↗</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-[var(--eis-muted)]">Customer name</Label>
                          <Input
                            value={draft.clientName ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value }))}
                            placeholder="Attach later — e.g. Client Full Name"
                            className="h-8 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[var(--eis-muted)]">Client email (report delivery)</Label>
                          <Input
                            type="email"
                            value={draft.email ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                            placeholder="client@example.com"
                            className="h-8 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[var(--eis-muted)]">Destination country</Label>
                          <Input
                            value={draft.country ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))}
                            placeholder="e.g. United Kingdom"
                            className="h-8 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[var(--eis-muted)]">Visa type</Label>
                          <Input
                            value={draft.visaType ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, visaType: e.target.value }))}
                            placeholder="e.g. Standard Visitor (Tourism)"
                            className="h-8 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[var(--eis-muted)]">Joint applicants (sharing this statement)</Label>
                          <select
                            value={draft.travelers ?? 1}
                            onChange={(e) => setDraft((d) => ({ ...d, travelers: Number(e.target.value) }))}
                            aria-label="Joint applicants"
                            className="h-8 w-full rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-2 text-sm"
                            style={{ color: GH.fg }}
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                              <option key={n} value={n}>
                                {n} {n === 1 ? "person" : "people"} · benchmark ×{n}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-[var(--eis-muted)]">Notes</Label>
                          <Input
                            value={draft.notes ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                            placeholder="Anything relevant — joint applicants, currency, special instructions…"
                            className="h-8 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={savingId === item.id}
                          onClick={() => update(item.id, draft)}
                          className="h-8 gap-1.5 bg-[var(--eis-btn-green)] text-white hover:bg-[var(--eis-btn-green-hover)]"
                        >
                          {savingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                          Save details
                        </Button>

                        {item.status === "WAITING" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingId === item.id}
                            onClick={() => runEngine(item.id)}
                            className="h-8 gap-1.5 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-[var(--eis-attention)] hover:bg-[var(--eis-attention-subtle)]"
                          >
                            {savingId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Start analysis
                          </Button>
                        )}
                        {item.status === "ANALYZING" && (
                          <Button
                            size="sm"
                            disabled={savingId === item.id}
                            onClick={() => update(item.id, { status: "DONE" })}
                            className="h-8 gap-1.5 bg-[var(--eis-btn-green)] text-white hover:bg-[var(--eis-btn-green-hover)]"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Mark done · email report
                          </Button>
                        )}
                        {item.status === "ANALYZING" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingId === item.id}
                            onClick={() => runEngine(item.id)}
                            title="Re-run the engine on this case — fresh parse, fresh draft or auto-delivery (e.g. after the client sends a better PDF)"
                            className="h-8 gap-1.5 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-[var(--eis-attention)] hover:bg-[var(--eis-attention-subtle)]"
                          >
                            {savingId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Retry engine
                          </Button>
                        )}
                        {item.status === "DONE" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingId === item.id}
                            onClick={() => update(item.id, { status: "WAITING" })}
                            className="h-8 gap-1.5 border-[var(--eis-border)] bg-[var(--eis-canvas)] text-[var(--eis-muted)] hover:bg-[var(--eis-hover)]"
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
                          </Button>
                        )}

                        {item.analyzedAt && (
                          <span className="text-xs text-[var(--eis-muted)]">
                            analyzed {timeAgo(item.analyzedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
