"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, FileDown, Loader2, FileText } from "lucide-react";
import { GH, humanSize } from "@/lib/format";

interface ReportEntry {
  name: string;
  sizeBytes: number;
  sizeHuman: string;
  modified: string;
}

export function ReportsPanel() {
  const [reports, setReports] = useState<ReportEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/reports`);
      if (res.status === 401) {
        setReports([]);
        return;
      }
      const data = (await res.json()) as { ok: boolean; reports: ReportEntry[] };
      setReports(data.reports ?? []);
    } catch {
      setReports([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--eis-muted)]">
          Finished assessments (HTML opens in browser · PDF prints directly). Clients are emailed when a
          report is marked done.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={busy}
          className="gap-1.5 border-[var(--eis-border)] text-[var(--eis-fg)] hover:bg-[var(--eis-canvas-subtle)]"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {reports === null ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-[var(--eis-border)] py-12 text-sm text-[var(--eis-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading reports…
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-md border border-[var(--eis-border)] py-12 text-center text-sm text-[var(--eis-muted)]">
          No reports available yet.
        </div>
      ) : (
        <div className="eis-glass overflow-hidden rounded-2xl">
          <ScrollArea className="max-h-96">
            <Table>
              <TableHeader className="sticky top-0 bg-[var(--eis-canvas)] shadow-[0_1px_0_var(--eis-border-muted)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs text-[var(--eis-muted)]">Report</TableHead>
                  <TableHead className="w-24 text-xs text-[var(--eis-muted)]">Size</TableHead>
                  <TableHead className="w-28 text-xs text-[var(--eis-muted)]">Updated</TableHead>
                  <TableHead className="w-28 text-right text-xs text-[var(--eis-muted)]">Get</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.name} className="hover:bg-[var(--eis-canvas-subtle)]">
                    <TableCell className="max-w-72 truncate font-medium" style={{ color: GH.fg }}>
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--eis-neutral)]" aria-hidden="true" />
                        {r.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-[var(--eis-muted)]">{r.sizeHuman}</TableCell>
                    <TableCell className="text-xs text-[var(--eis-muted)]">
                      {new Date(r.modified).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`/api/report/download?file=${encodeURIComponent(r.name)}`}
                        download={r.name}
                        aria-label={`Download ${r.name}`}
                      >
                        <Button variant="outline" size="sm" className="h-7 gap-1 border-[var(--eis-border)] text-xs text-[var(--eis-fg)] hover:bg-[var(--eis-canvas-subtle)]">
                          <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                          Download
                        </Button>
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
