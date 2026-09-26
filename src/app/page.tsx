"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShieldCheck, CheckCircle2, Loader2, Lock, ListOrdered, LayoutDashboard, FileText, UploadCloud,
} from "lucide-react";
import { UploadPanel } from "@/components/portal/upload-panel";
import { QueuePanel } from "@/components/portal/queue-panel";
import { DashboardPanel } from "@/components/portal/dashboard-panel";
import { ReportsPanel } from "@/components/portal/reports-panel";
import { GH } from "@/lib/format";

export default function PortalPage() {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Bump refreshKey whenever the queue/dashboard tab is opened so data reloads.
  const verifyCode = useCallback(async () => {
    if (!code.trim()) {
      setGateError("Enter the access code.");
      return;
    }
    setGateBusy(true);
    setGateError(null);
    try {
      const res = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        setUnlocked(true);
      } else {
        setGateError("Invalid access code — check the code provided by Global EIS.");
      }
    } catch {
      setGateError("Network error.");
    } finally {
      setGateBusy(false);
    }
  }, [code]);

  useEffect(() => {
    const t = setInterval(() => setRefreshKey((k) => k + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-white" style={{ color: GH.fg }}>
      {/* Header — GitHub-style slim bar */}
      <header className="border-b border-[#d0d7de] bg-[#f6f8fa]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1f2328] font-mono text-sm font-bold text-white" aria-hidden="true">
            GE
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight">Global EIS</h1>
            <p className="truncate text-xs text-[#59636e]">Statement intake queue · Financial Intelligence Services</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-[#59636e]">
            <span className="hidden rounded-full border border-[#d0d7de] bg-white px-2.5 py-0.5 font-mono sm:inline">
              ahmedr.muhammed19@gmail.com
            </span>
            {unlocked ? (
              <span className="flex items-center gap-1.5 rounded-full border border-[#d0d7de] bg-[#dafbe1] px-2.5 py-0.5 font-medium text-[#1a7f37]">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Unlocked
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full border border-[#d0d7de] bg-white px-2.5 py-0.5 font-medium">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Locked
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {/* Access gate */}
        {!unlocked && (
          <div className="mx-auto mt-10 max-w-md">
            <div className="rounded-md border border-[#d0d7de] bg-white">
              <div className="border-b border-[#d8dee4] bg-[#f6f8fa] px-4 py-2.5 text-sm font-semibold">
                Access code
              </div>
              <div className="space-y-3 p-4">
                <p className="text-sm text-[#59636e]">
                  Enter the access code provided by Global EIS to unlock the portal.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    placeholder="Access code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                    aria-label="Access code"
                    className="sm:max-w-xs"
                  />
                  <Button
                    onClick={verifyCode}
                    disabled={gateBusy}
                    className="bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                  >
                    {gateBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    Unlock
                  </Button>
                </div>
                {gateError && (
                  <p className="rounded-md border border-[#d0d7de] bg-[#ffebe9] px-3 py-2 text-sm" style={{ color: GH.danger }} role="alert">
                    {gateError}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Workspace */}
        {unlocked && (
          <Tabs defaultValue="upload" onValueChange={() => setRefreshKey((k) => k + 1)}>
            <TabsList className="mb-4 flex h-auto w-full justify-start gap-1 rounded-none border-b border-[#d0d7de] bg-transparent p-0">
              {[
                { value: "upload", label: "Upload", icon: UploadCloud },
                { value: "queue", label: "Queue", icon: ListOrdered },
                { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
                { value: "reports", label: "Reports", icon: FileText },
              ].map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="mb-[-1px] gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-sm text-[#59636e] shadow-none transition-none data-[state=active]:border-[#fd8c73] data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-[#1f2328] data-[state=active]:shadow-none"
                >
                  <t.icon className="h-4 w-4" aria-hidden="true" />
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="upload" className="mt-2">
              <UploadPanel code={code} />
            </TabsContent>
            <TabsContent value="queue" className="mt-2">
              <QueuePanel code={code} refreshKey={refreshKey} />
            </TabsContent>
            <TabsContent value="dashboard" className="mt-2">
              <DashboardPanel code={code} refreshKey={refreshKey} />
            </TabsContent>
            <TabsContent value="reports" className="mt-2">
              <ReportsPanel code={code} />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-[#d0d7de] bg-[#f6f8fa] py-4">
        <div className="mx-auto max-w-5xl px-4 text-center text-xs text-[#59636e] sm:px-6">
          <p className="font-semibold" style={{ color: GH.fg }}>
            Global EIS — Financial Intelligence Services
          </p>
          <p className="mt-0.5">
            Confidential · statements are hash-locked on arrival and never altered · contact &amp; replies:{" "}
            <a href="mailto:ahmedr.muhammed19@gmail.com" className="text-[#0969da] hover:underline">
              ahmedr.muhammed19@gmail.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
