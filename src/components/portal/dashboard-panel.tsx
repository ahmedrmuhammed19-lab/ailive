"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, CalendarDays } from "lucide-react";
import { GH } from "@/lib/format";

interface DayCell {
  date: string;
  day: number;
  weekday: number;
  uploaded: number;
  analyzed: number;
}

interface DashData {
  ok: boolean;
  today: { uploaded: number; analyzed: number };
  totals: { WAITING: number; ANALYZING: number; DONE: number; all: number };
  month: { key: string; label: string; days: DayCell[] };
}

/** GitHub contribution-graph green scale by analyzed count. */
function cellColor(analyzed: number): string {
  if (analyzed <= 0) return GH.cellEmpty;
  if (analyzed === 1) return "#9be9a8";
  if (analyzed === 2) return "#40c463";
  if (analyzed === 3) return "#30a14e";
  return "#216e39";
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DashboardPanel({ code, refreshKey }: { code: string; refreshKey: number }) {
  const [data, setData] = useState<DashData | null>(null);
  const [busy, setBusy] = useState(false);
  const [monthKey, setMonthKey] = useState<string | null>(null);

  const load = useCallback(
    async (mk?: string | null) => {
      setBusy(true);
      try {
        const q = new URLSearchParams({ code });
        if (mk) q.set("month", mk);
        const res = await fetch(`/api/dashboard?${q.toString()}`);
        if (res.status === 401) {
          setData(null);
          return;
        }
        setData((await res.json()) as DashData);
      } catch {
        setData(null);
      } finally {
        setBusy(false);
      }
    },
    [code]
  );

  useEffect(() => {
    load(monthKey);
  }, [load, refreshKey]);

  const todayKey = new Date().toISOString().slice(0, 10);

  // Grid: pad start to weekday columns
  const days = data?.month.days ?? [];
  const firstWeekday = days[0]?.weekday ?? 0;
  const cells: (DayCell | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...days,
  ];

  const stats = [
    { label: "Analyzed today", value: data?.today.analyzed ?? 0, fg: GH.success, sub: "reports delivered" },
    { label: "Uploaded today", value: data?.today.uploaded ?? 0, fg: GH.accent, sub: "new statements" },
    { label: "Waiting", value: data?.totals.WAITING ?? 0, fg: GH.muted, sub: "in queue" },
    { label: "Analyzing", value: data?.totals.ANALYZING ?? 0, fg: GH.attention, sub: "in progress" },
    { label: "Total cases", value: data?.totals.all ?? 0, fg: GH.fg, sub: `${data?.totals.DONE ?? 0} done` },
  ];

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border border-[#d0d7de] bg-white p-4">
            <div className="font-mono text-3xl font-semibold tabular-nums" style={{ color: s.fg }}>
              {busy && data === null ? "—" : s.value}
            </div>
            <div className="mt-1 text-xs font-semibold" style={{ color: GH.fg }}>{s.label}</div>
            <div className="text-[11px] text-[#59636e]">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <div className="rounded-md border border-[#d0d7de] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#d8dee4] bg-[#f6f8fa] px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: GH.fg }}>
            <CalendarDays className="h-4 w-4 text-[#59636e]" aria-hidden="true" />
            {data?.month.label ?? "Calendar"}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous month"
              className="h-7 border-[#d0d7de] px-2 text-[#59636e] hover:bg-white"
              onClick={() => {
                const mk = shiftMonth(data?.month.key ?? todayKey.slice(0, 7), -1);
                setMonthKey(mk);
                load(mk);
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-[#d0d7de] px-2.5 text-xs text-[#1f2328] hover:bg-white"
              onClick={() => {
                setMonthKey(null);
                load(null);
              }}
            >
              This month
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next month"
              className="h-7 border-[#d0d7de] px-2 text-[#59636e] hover:bg-white"
              onClick={() => {
                const mk = shiftMonth(data?.month.key ?? todayKey.slice(0, 7), 1);
                setMonthKey(mk);
                load(mk);
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="p-4">
          {busy && data === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#59636e]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading calendar…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1.5" role="grid" aria-label="Analysis calendar">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[#818b98]">
                    {w.slice(0, 2)}
                  </div>
                ))}
                {cells.map((c, idx) =>
                  c === null ? (
                    <div key={`pad-${idx}`} aria-hidden="true" />
                  ) : (
                    <div
                      key={c.date}
                      role="gridcell"
                      aria-label={`${c.date}: ${c.uploaded} uploaded, ${c.analyzed} analyzed`}
                      title={`${c.date} · ${c.uploaded} uploaded · ${c.analyzed} analyzed`}
                      className={`relative flex aspect-square items-center justify-center rounded-[4px] border text-xs font-medium transition-transform hover:scale-105 ${
                        c.date === todayKey ? "border-[#1f2328] ring-1 ring-[#1f2328]" : "border-black/5"
                      }`}
                      style={{ backgroundColor: cellColor(c.analyzed), color: c.analyzed > 2 ? "#ffffff" : GH.fg }}
                    >
                      {c.day}
                      {c.uploaded > 0 && (
                        <span
                          className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[#0969da]"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  )
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-[#59636e]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: GH.cellEmpty }} />
                  <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: "#9be9a8" }} />
                  <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: "#40c463" }} />
                  <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: "#30a14e" }} />
                  <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: "#216e39" }} />
                  analyses completed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#0969da]" /> statement uploaded that day
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-[3px] border border-[#1f2328]" /> today
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
