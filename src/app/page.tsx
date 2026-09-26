"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShieldCheck, CheckCircle2, Loader2, Lock, ListOrdered, LayoutDashboard, FileText, UploadCloud, LogOut, User, UserCog,
} from "lucide-react";
import { UploadPanel } from "@/components/portal/upload-panel";
import { QueuePanel } from "@/components/portal/queue-panel";
import { DashboardPanel } from "@/components/portal/dashboard-panel";
import { ReportsPanel } from "@/components/portal/reports-panel";
import { AccountsPanel } from "@/components/portal/accounts-panel";
import { ThemeToggle } from "@/components/portal/theme-toggle";
import { GH } from "@/lib/format";

type Account = { username: string; label: string | null; role: string };
type SetupStatus = { users: number; available: boolean; reason?: string };

export default function PortalPage() {
  const [user, setUser] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true); // session restore on first load
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // First-run setup (only offered while the portal has zero accounts).
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupMode, setSetupMode] = useState(false); // show setup card instead of sign-in
  const [setupKey, setSetupKey] = useState("");
  const [setupId, setSetupId] = useState("");
  const [setupPw, setSetupPw] = useState("");
  const [setupLabel, setSetupLabel] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);

  const loadSetupStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/setup", { cache: "no-store" });
      const data = (await res.json()) as SetupStatus;
      setSetupStatus(data);
      setSetupMode(Boolean(data.available));
    } catch {
      setSetupStatus(null);
      setSetupMode(false);
    }
  }, []);

  // Restore an existing session (signed cookie) on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; user?: Account | null };
        if (!cancelled && data.ok && data.user) setUser(data.user);
      } catch {
        // not signed in — show the gate
      } finally {
        if (!cancelled) {
          setChecking(false);
          loadSetupStatus();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSetupStatus]);

  const signIn = useCallback(async () => {
    if (!userId.trim() || !password) {
      setGateError("Enter your ID and password.");
      return;
    }
    setGateBusy(true);
    setGateError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userId, password }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; user?: Account };
      if (data.ok && data.user) {
        setUser(data.user);
        setPassword("");
      } else {
        setGateError(data.error ?? "Wrong ID or password.");
      }
    } catch {
      setGateError("Network error.");
    } finally {
      setGateBusy(false);
    }
  }, [userId, password]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // ignore — clearing locally regardless
    }
    setUser(null);
    setUserId("");
    setPassword("");
    loadSetupStatus();
  }, [loadSetupStatus]);

  const runSetup = useCallback(async () => {
    if (!setupKey || !setupId.trim() || setupPw.length < 8) {
      setSetupError("Fill in the setup key, an ID, and a password of at least 8 characters.");
      return;
    }
    setGateBusy(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupKey, username: setupId, password: setupPw, label: setupLabel }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; user?: Account };
      if (data.ok && data.user) {
        setUser(data.user);
        setSetupKey("");
        setSetupPw("");
      } else {
        setSetupError(data.error ?? "Setup failed.");
      }
    } catch {
      setSetupError("Network error.");
    } finally {
      setGateBusy(false);
    }
  }, [setupKey, setupId, setupPw, setupLabel]);

  // Bump refreshKey whenever the queue/dashboard tab is opened so data reloads.
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
            <ThemeToggle />
            <span className="hidden rounded-full border border-[#d0d7de] bg-white px-2.5 py-0.5 font-mono sm:inline">
              ahmedr.muhammed19@gmail.com
            </span>
            {user ? (
              <>
                <span className="flex items-center gap-1.5 rounded-full border border-[#d0d7de] bg-[#dafbe1] px-2.5 py-0.5 font-medium text-[#1a7f37]">
                  <User className="h-3.5 w-3.5" aria-hidden="true" /> {user.username}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={signOut}
                  className="h-7 gap-1.5 border-[#d0d7de] px-2.5 text-xs text-[#59636e] hover:bg-[#f6f8fa] hover:text-[#cf222e]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
                </Button>
              </>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full border border-[#d0d7de] bg-white px-2.5 py-0.5 font-medium">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Locked
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {/* Sign-in gate / first-run setup */}
        {!user && !checking && (
          <div className="mx-auto mt-10 max-w-md">
            {setupStatus && setupStatus.users === 0 && !setupStatus.available && (
              <p
                className="mb-4 rounded-md border border-[#d4a72c66] bg-[#fff8c5] px-3 py-2 text-sm text-[#4d2d00]"
                role="status"
              >
                This deployment has no accounts yet. Add a <code className="font-mono">SETUP_KEY</code>{" "}
                environment variable in the hosting dashboard, then reload this page to create the
                first account.
                {setupStatus.reason ? ` (${setupStatus.reason})` : null}
              </p>
            )}
            <div className="rounded-md border border-[#d0d7de] bg-white">
              <div className="flex items-center justify-between border-b border-[#d8dee4] bg-[#f6f8fa] px-4 py-2.5 text-sm font-semibold">
                {setupMode ? "First-time setup" : "Sign in"}
                {setupStatus?.available && (
                  <button
                    type="button"
                    onClick={() => {
                      setSetupMode((m) => !m);
                      setGateError(null);
                      setSetupError(null);
                    }}
                    className="text-xs font-normal text-[#0969da] hover:underline"
                  >
                    {setupMode ? "Sign in instead" : "Create the first account"}
                  </button>
                )}
              </div>
              {setupMode ? (
                <div className="space-y-3 p-4">
                  <p className="text-sm text-[#59636e]">
                    Create the first operator account for this portal. This form disappears once an
                    account exists.
                  </p>
                  <div className="space-y-2">
                    <Input
                      type="password"
                      placeholder="Setup key (SETUP_KEY env var)"
                      value={setupKey}
                      onChange={(e) => setSetupKey(e.target.value)}
                      autoComplete="off"
                      aria-label="Setup key"
                    />
                    <Input
                      type="text"
                      placeholder="Your ID (e.g. ahmed)"
                      value={setupId}
                      onChange={(e) => setSetupId(e.target.value)}
                      autoComplete="username"
                      aria-label="New account ID"
                    />
                    <Input
                      type="password"
                      placeholder="Password (min 8 characters)"
                      value={setupPw}
                      onChange={(e) => setSetupPw(e.target.value)}
                      autoComplete="new-password"
                      aria-label="New account password"
                    />
                    <Input
                      type="text"
                      placeholder="Display name (optional, e.g. Ahmed M.)"
                      value={setupLabel}
                      onChange={(e) => setSetupLabel(e.target.value)}
                      aria-label="Display name"
                    />
                  </div>
                  <Button
                    onClick={runSetup}
                    disabled={gateBusy}
                    className="w-full bg-[#1f883d] text-white hover:bg-[#1a7f37] sm:w-auto"
                  >
                    {gateBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <UserCog className="h-4 w-4" aria-hidden="true" />
                    )}
                    Create account &amp; sign in
                  </Button>
                  {setupError && (
                    <p className="rounded-md border border-[#d0d7de] bg-[#ffebe9] px-3 py-2 text-sm" style={{ color: GH.danger }} role="alert">
                      {setupError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3 p-4">
                  <p className="text-sm text-[#59636e]">
                    Enter the ID and password provided by Global EIS.
                  </p>
                  <div className="space-y-2">
                    <Input
                      type="text"
                      placeholder="ID"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && signIn()}
                      autoComplete="username"
                      aria-label="ID"
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && signIn()}
                      autoComplete="current-password"
                      aria-label="Password"
                    />
                  </div>
                  <Button
                    onClick={signIn}
                    disabled={gateBusy}
                    className="w-full bg-[#1f883d] text-white hover:bg-[#1a7f37] sm:w-auto"
                  >
                    {gateBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    Sign in
                  </Button>
                  {gateError && (
                    <p className="rounded-md border border-[#d0d7de] bg-[#ffebe9] px-3 py-2 text-sm" style={{ color: GH.danger }} role="alert">
                      {gateError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {checking && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#59636e]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking session…
          </div>
        )}

        {/* Workspace */}
        {user && (
          <Tabs defaultValue="upload" onValueChange={() => setRefreshKey((k) => k + 1)}>
            <TabsList className="mb-4 flex h-auto w-full justify-start gap-1 rounded-none border-b border-[#d0d7de] bg-transparent p-0">
              {[
                { value: "upload", label: "Upload", icon: UploadCloud },
                { value: "queue", label: "Queue", icon: ListOrdered },
                { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
                { value: "reports", label: "Reports", icon: FileText },
                ...(user.role === "operator"
                  ? [{ value: "accounts", label: "Accounts", icon: UserCog }]
                  : []),
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
              <UploadPanel />
            </TabsContent>
            <TabsContent value="queue" className="mt-2">
              <QueuePanel refreshKey={refreshKey} />
            </TabsContent>
            <TabsContent value="dashboard" className="mt-2">
              <DashboardPanel refreshKey={refreshKey} />
            </TabsContent>
            <TabsContent value="reports" className="mt-2">
              <ReportsPanel />
            </TabsContent>
            {user.role === "operator" && (
              <TabsContent value="accounts" className="mt-2">
                <AccountsPanel refreshKey={refreshKey} />
              </TabsContent>
            )}
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
