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

export function ReportsPanel({ code }: { code: string }) {
  const [reports, setReports] = useState<ReportEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/reports?code=${encodeURIComponent(code)}`);
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
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#59636e]">
          Finished assessments (HTML opens in browser · PDF prints directly). Clients are emailed when a
          report is marked done.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={busy}
          className="gap-1.5 border-[#d0d7de] text-[#1f2328] hover:bg-[#f6f8fa]"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {reports === null ? (
        <div className="flex items-center justify-center gap-2 rounded-md border border-[#d0d7de] py-12 text-sm text-[#59636e]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading reports…
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-md border border-[#d0d7de] py-12 text-center text-sm text-[#59636e]">
          No reports available yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-[#d0d7de] bg-white">
          <ScrollArea className="max-h-96">
            <Table>
              <TableHeader className="sticky top-0 bg-white shadow-[0_1px_0_#d8dee4]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs text-[#59636e]">Report</TableHead>
                  <TableHead className="w-24 text-xs text-[#59636e]">Size</TableHead>
                  <TableHead className="w-28 text-xs text-[#59636e]">Updated</TableHead>
                  <TableHead className="w-28 text-right text-xs text-[#59636e]">Get</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.name} className="hover:bg-[#f6f8fa]">
                    <TableCell className="max-w-72 truncate font-medium" style={{ color: GH.fg }}>
                      <span className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#818b98]" aria-hidden="true" />
                        {r.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-[#59636e]">{r.sizeHuman}</TableCell>
                    <TableCell className="text-xs text-[#59636e]">
                      {new Date(r.modified).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`/api/report/download?code=${encodeURIComponent(code)}&file=${encodeURIComponent(r.name)}`}
                        download={r.name}
                        aria-label={`Download ${r.name}`}
                      >
                        <Button variant="outline" size="sm" className="h-7 gap-1 border-[#d0d7de] text-xs text-[#1f2328] hover:bg-[#f6f8fa]">
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
