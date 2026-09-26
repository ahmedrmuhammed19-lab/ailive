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
  RotateCcw,
  RefreshCw,
  Save,
  FileText,
  Inbox,
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
  analyzedAt: string | null;
  fileCount: number;
  createdAt: string;
}

const FILTERS = ["ALL", "WAITING", "ANALYZING", "DONE"] as const;

export function QueuePanel({ code, refreshKey }: { code: string; refreshKey: number }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<QueueItem>>({});

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/queue?code=${encodeURIComponent(code)}`);
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
  }, [code]);

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
          body: JSON.stringify({ code, id, ...patch }),
        });
        await load();
      } finally {
        setSavingId(null);
      }
    },
    [code, load]
  );

  const counts = { ALL: items?.length ?? 0, WAITING: 0, ANALYZING: 0, DONE: 0 };
  for (const i of items ?? []) if (i.status in counts) counts[i.status as keyof typeof counts]++;

  const visible = (items ?? []).filter((i) => filter === "ALL" || i.status === filter);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-[#1f2328] text-white"
                  : "border border-[#d0d7de] bg-[#f6f8fa] text-[#59636e] hover:bg-[#eef1f4]"
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
        <Button variant="outline" size="sm" onClick={load} disabled={busy} className="gap-1.5 border-[#d0d7de] text-[#1f2328] hover:bg-[#f6f8fa]">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-md border border-[#d0d7de] bg-white">
        {items === null ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#59636e]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading queue…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="h-8 w-8 text-[#818b98]" aria-hidden="true" />
            <p className="text-sm text-[#59636e]">
              {filter === "ALL" ? "Queue is empty — statements you upload will appear here." : `No ${STATUS_META[filter]?.label.toLowerCase()} items.`}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#d8dee4]">
            {visible.map((item) => {
              const meta = STATUS_META[item.status] ?? STATUS_META.WAITING;
              const open = expanded === item.id;
              return (
                <li key={item.id} className="group">
                  <div className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[#f6f8fa]"
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
                      <ChevronDown className="h-4 w-4 shrink-0 text-[#818b98]" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#818b98]" aria-hidden="true" />
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
                    <span className="hidden min-w-0 flex-1 truncate text-sm text-[#59636e] sm:block">
                      {item.clientName ?? "details pending"}
                      {item.country ? ` · ${item.country}` : ""}
                      {item.travelers > 1 && (
                        <span className="ml-1.5 rounded-full border border-[#d0d7de] bg-white px-1.5 py-px text-[10px] font-semibold text-[#9a6700]">
                          ×{item.travelers} joint
                        </span>
                      )}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-[#59636e]">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        {item.fileCount}
                      </span>
                      <span className="hidden sm:inline">{timeAgo(item.createdAt)}</span>
                    </span>
                  </div>

                  {/* Expanded detail / editor */}
                  {open && (
                    <div className="space-y-4 border-t border-[#d8dee4] bg-[#f6f8fa] px-4 py-4 sm:px-10">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-[#59636e]">Customer name</Label>
                          <Input
                            value={draft.clientName ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, clientName: e.target.value }))}
                            placeholder="Attach later — e.g. Client Full Name"
                            className="h-8 border-[#d0d7de] bg-white text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[#59636e]">Client email (report delivery)</Label>
                          <Input
                            type="email"
                            value={draft.email ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                            placeholder="client@example.com"
                            className="h-8 border-[#d0d7de] bg-white text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[#59636e]">Destination country</Label>
                          <Input
                            value={draft.country ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))}
                            placeholder="e.g. United Kingdom"
                            className="h-8 border-[#d0d7de] bg-white text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[#59636e]">Visa type</Label>
                          <Input
                            value={draft.visaType ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, visaType: e.target.value }))}
                            placeholder="e.g. Standard Visitor (Tourism)"
                            className="h-8 border-[#d0d7de] bg-white text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-[#59636e]">Joint applicants (sharing this statement)</Label>
                          <select
                            value={draft.travelers ?? 1}
                            onChange={(e) => setDraft((d) => ({ ...d, travelers: Number(e.target.value) }))}
                            aria-label="Joint applicants"
                            className="h-8 w-full rounded-md border border-[#d0d7de] bg-white px-2 text-sm"
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
                          <Label className="text-xs text-[#59636e]">Notes</Label>
                          <Input
                            value={draft.notes ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                            placeholder="Anything relevant — joint applicants, currency, special instructions…"
                            className="h-8 border-[#d0d7de] bg-white text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={savingId === item.id}
                          onClick={() => update(item.id, draft)}
                          className="h-8 gap-1.5 bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                        >
                          {savingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                          Save details
                        </Button>

                        {item.status === "WAITING" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingId === item.id}
                            onClick={() => update(item.id, { status: "ANALYZING" })}
                            className="h-8 gap-1.5 border-[#d0d7de] bg-white text-[#9a6700] hover:bg-[#fff8c5]"
                          >
                            <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> Start analysis
                          </Button>
                        )}
                        {item.status === "ANALYZING" && (
                          <Button
                            size="sm"
                            disabled={savingId === item.id}
                            onClick={() => update(item.id, { status: "DONE" })}
                            className="h-8 gap-1.5 bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Mark done · email report
                          </Button>
                        )}
                        {item.status === "DONE" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingId === item.id}
                            onClick={() => update(item.id, { status: "WAITING" })}
                            className="h-8 gap-1.5 border-[#d0d7de] bg-white text-[#59636e] hover:bg-[#eef1f4]"
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
                          </Button>
                        )}

                        {item.analyzedAt && (
                          <span className="text-xs text-[#59636e]">
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
