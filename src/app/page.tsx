"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShieldCheck, CheckCircle2, Loader2, Lock, ListOrdered, LayoutDashboard, FileText, UploadCloud, LogOut, User, UserCog, Sparkles,
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

const TABS = [
  { value: "upload", label: "Upload", icon: UploadCloud },
  { value: "queue", label: "Queue", icon: ListOrdered },
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "reports", label: "Reports", icon: FileText },
];

export default function PortalPage() {
  const [user, setUser] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true); // session restore on first load
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState("upload");

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

  const tabs = [...TABS, ...(user?.role === "operator" ? [{ value: "accounts", label: "Accounts", icon: UserCog }] : [])];

  return (
    <div className="flex min-h-screen flex-col" style={{ color: GH.fg }}>
      {/* Ambient aurora backdrop — live RGB scene */}
      <div className="eis-aurora" aria-hidden="true">
        <span className="eis-orb eis-orb-a" />
        <span className="eis-orb eis-orb-b" />
        <span className="eis-orb eis-orb-c" />
        <span className="eis-stars" />
      </div>

      {/* Header — floating glass bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--eis-border)] bg-[var(--eis-canvas-glass)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="eis-gradient-brand flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold text-white shadow-[var(--eis-glow)]" aria-hidden="true">
            GE
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight tracking-tight">
              Global <span className="eis-gradient-text">EIS</span>
            </h1>
            <p className="truncate text-xs text-[var(--eis-muted)]">Statement intake queue · Financial Intelligence Services</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-[var(--eis-muted)]">
            <ThemeToggle />
            <span className="hidden rounded-full border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-2.5 py-0.5 font-mono sm:inline">
              ahmedr.muhammed19@gmail.com
            </span>
            {user ? (
              <>
                <span className="flex items-center gap-1.5 rounded-full border border-[var(--eis-border)] bg-[var(--eis-success-subtle)] px-2.5 py-0.5 font-medium text-[var(--eis-success)]">
                  <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--eis-success)] opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--eis-success)]" />
                  </span>
                  {user.username}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={signOut}
                  className="h-7 gap-1.5 rounded-full border-[var(--eis-border)] px-2.5 text-xs text-[var(--eis-muted)] hover:bg-[var(--eis-hover)] hover:text-[var(--eis-danger)]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
                </Button>
              </>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-2.5 py-0.5 font-medium">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Locked
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {/* Sign-in gate / first-run setup */}
        {!user && !checking && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mt-8 max-w-md"
          >
            {/* Hero strip */}
            <div className="mb-5 text-center">
              <h2 className="text-2xl font-semibold tracking-tight" style={{ color: GH.fg }}>
                Secure statement <span className="eis-gradient-text">intelligence</span>
              </h2>
              <p className="mt-1.5 text-sm text-[var(--eis-muted)]">
                100% balance-chain verified reports — every format, text or scan.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                {[
                  { icon: ShieldCheck, label: "MD5 hash-locked" },
                  { icon: Sparkles, label: "Any size" },
                  { icon: CheckCircle2, label: "Chain-verified" },
                ].map((f) => (
                  <span
                    key={f.label}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-2.5 py-1 text-[11px] font-medium text-[var(--eis-muted)]"
                  >
                    <f.icon className="h-3 w-3 text-[var(--eis-accent)]" aria-hidden="true" /> {f.label}
                  </span>
                ))}
              </div>
            </div>

            {setupStatus && setupStatus.users === 0 && !setupStatus.available && (
              <p
                className="mb-4 rounded-xl border border-[#d4a72c66] bg-[var(--eis-attention-subtle)] px-3 py-2 text-sm text-[#4d2d00]"
                role="status"
              >
                This deployment has no accounts yet. Add a <code className="font-mono">SETUP_KEY</code>{" "}
                environment variable in the hosting dashboard, then reload this page to create the
                first account.
                {setupStatus.reason ? ` (${setupStatus.reason})` : null}
              </p>
            )}
            <div className="eis-glass eis-sheen rounded-2xl">
              <div className="flex items-center justify-between border-b border-[var(--eis-border-muted)] px-5 py-3.5 text-sm font-semibold" style={{ color: GH.fg }}>
                {setupMode ? "First-time setup" : "Sign in"}
                {setupStatus?.available && (
                  <button
                    type="button"
                    onClick={() => {
                      setSetupMode((m) => !m);
                      setGateError(null);
                      setSetupError(null);
                    }}
                    className="text-xs font-normal text-[var(--eis-accent)] hover:underline"
                  >
                    {setupMode ? "Sign in instead" : "Create the first account"}
                  </button>
                )}
              </div>
              {setupMode ? (
                <div className="space-y-3 p-5">
                  <p className="text-sm text-[var(--eis-muted)]">
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
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type="text"
                      placeholder="Your ID (e.g. ahmed)"
                      value={setupId}
                      onChange={(e) => setSetupId(e.target.value)}
                      autoComplete="username"
                      aria-label="New account ID"
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type="password"
                      placeholder="Password (min 8 characters)"
                      value={setupPw}
                      onChange={(e) => setSetupPw(e.target.value)}
                      autoComplete="new-password"
                      aria-label="New account password"
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type="text"
                      placeholder="Display name (optional, e.g. Ahmed M.)"
                      value={setupLabel}
                      onChange={(e) => setSetupLabel(e.target.value)}
                      aria-label="Display name"
                      className="h-10 rounded-xl"
                    />
                  </div>
                  <Button
                    onClick={runSetup}
                    disabled={gateBusy}
                    className="eis-cta h-10 w-full rounded-xl sm:w-auto"
                  >
                    {gateBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <UserCog className="h-4 w-4" aria-hidden="true" />
                    )}
                    Create account &amp; sign in
                  </Button>
                  {setupError && (
                    <p className="rounded-xl border border-[var(--eis-border)] bg-[var(--eis-danger-subtle)] px-3 py-2 text-sm" style={{ color: GH.danger }} role="alert">
                      {setupError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3 p-5">
                  <p className="text-sm text-[var(--eis-muted)]">
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
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && signIn()}
                      autoComplete="current-password"
                      aria-label="Password"
                      className="h-10 rounded-xl"
                    />
                  </div>
                  <Button
                    onClick={signIn}
                    disabled={gateBusy}
                    className="eis-cta h-10 w-full rounded-xl sm:w-auto"
                  >
                    {gateBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    Sign in
                  </Button>
                  {gateError && (
                    <p className="rounded-xl border border-[var(--eis-border)] bg-[var(--eis-danger-subtle)] px-3 py-2 text-sm" style={{ color: GH.danger }} role="alert">
                      {gateError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {checking && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--eis-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking session…
          </div>
        )}

        {/* Workspace */}
        {user && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              setActiveTab(v);
              setRefreshKey((k) => k + 1);
            }}
          >
            {/* Segmented glass tab bar with spring pill */}
            <TabsList className="mb-5 flex h-11 w-fit items-center gap-1 rounded-2xl border border-[var(--eis-border)] bg-[var(--eis-canvas-glass)] p-1 backdrop-blur-xl">
              {tabs.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="relative gap-1.5 rounded-xl px-3.5 py-1.5 text-sm text-[var(--eis-muted)] transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {activeTab === t.value && (
                    <motion.span
                      layoutId="eis-tab-pill"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-xl border border-[var(--eis-border)] bg-[var(--eis-canvas)] shadow-[var(--eis-card-shadow)]"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`relative z-10 flex items-center gap-1.5 ${activeTab === t.value ? "font-medium" : ""}`}
                    style={activeTab === t.value ? { color: GH.fg } : undefined}
                  >
                    <t.icon className="h-4 w-4" aria-hidden="true" />
                    {t.label}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="upload" className="mt-2">
              <UploadPanel />
            </TabsContent>
            <TabsContent value="queue" className="mt-2">
              <QueuePanel refreshKey={refreshKey} isOperator={user.role === "operator"} />
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
      <footer className="mt-auto border-t border-[var(--eis-border)] bg-[var(--eis-canvas-glass)] py-4 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 text-center text-xs text-[var(--eis-muted)] sm:px-6">
          <p className="font-semibold" style={{ color: GH.fg }}>
            Global EIS — Financial Intelligence Services
          </p>
          <p className="mt-0.5">
            Confidential · statements are hash-locked on arrival and never altered · contact &amp; replies:{" "}
            <a href="mailto:ahmedr.muhammed19@gmail.com" className="text-[var(--eis-accent)] hover:underline">
              ahmedr.muhammed19@gmail.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
