"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, ShieldCheck, ShieldOff, KeyRound, UserPlus, Circle } from "lucide-react";

type UserRow = {
  username: string;
  label: string | null;
  role: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

/**
 * Operator-only account management: add client/operator accounts, reset
 * passwords, activate/deactivate. Mirrors scripts/add-user.mjs actions.
 */
export function AccountsPanel({ refreshKey }: { refreshKey?: number }) {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [self, setSelf] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // add form
  const [nId, setNId] = useState("");
  const [nPw, setNPw] = useState("");
  const [nLabel, setNLabel] = useState("");
  const [nRole, setNRole] = useState("client");

  // reset form
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; users?: UserRow[]; self?: string };
      if (data.ok && data.users) {
        setRows(data.users);
        setSelf(data.self ?? "");
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const act = useCallback(
    async (payload: Record<string, unknown>, okText: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (data.ok) {
          setMsg({ kind: "ok", text: okText });
          await load();
        } else {
          setMsg({ kind: "err", text: data.error ?? "Action failed." });
        }
      } catch {
        setMsg({ kind: "err", text: "Network error." });
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const addAccount = useCallback(async () => {
    if (!nId.trim() || nPw.length < 8) {
      setMsg({ kind: "err", text: "ID is required and the password needs at least 8 characters." });
      return;
    }
    await act(
      { action: "add", username: nId, password: nPw, label: nLabel, role: nRole },
      `Account "${nId.trim().toLowerCase()}" created.`
    );
    setNId("");
    setNPw("");
    setNLabel("");
    setNRole("client");
  }, [nId, nPw, nLabel, nRole, act]);

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)]">
        <div className="flex items-center justify-between border-b border-[var(--eis-border-muted)] bg-[var(--eis-canvas-subtle)] px-4 py-2.5">
          <span className="text-sm font-semibold">Accounts</span>
          <Button variant="ghost" size="sm" onClick={load} disabled={busy} className="h-7 gap-1.5 px-2 text-xs text-[var(--eis-muted)]">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </Button>
        </div>
        <div className="divide-y divide-[var(--eis-divide)]">
          {rows === null && (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-[var(--eis-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
            </div>
          )}
          {rows?.length === 0 && (
            <div className="px-4 py-6 text-sm text-[var(--eis-muted)]">No accounts found.</div>
          )}
          {rows?.map((u) => (
            <div key={u.username} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Circle
                className={`h-2.5 w-2.5 fill-current ${u.active ? "text-[var(--eis-btn-green-hover)]" : "text-[#d1242f]"}`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  {u.username}
                  {u.username === self && <span className="ml-1.5 text-xs font-normal text-[var(--eis-muted)]">(you)</span>}
                </p>
                <p className="text-xs text-[var(--eis-muted)]">
                  {u.label ?? "—"} · {u.role} · last login{" "}
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {u.username !== self && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setResetFor(resetFor === u.username ? null : u.username);
                        setResetPw("");
                        setMsg(null);
                      }}
                      className="h-7 gap-1 border-[var(--eis-border)] px-2 text-xs text-[var(--eis-muted)]"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Reset
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        act(
                          { action: u.active ? "deactivate" : "activate", username: u.username },
                          `Account "${u.username}" ${u.active ? "deactivated" : "activated"}.`
                        )
                      }
                      className="h-7 gap-1 border-[var(--eis-border)] px-2 text-xs text-[var(--eis-muted)]"
                    >
                      {u.active ? (
                        <>
                          <ShieldOff className="h-3.5 w-3.5" /> Disable
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5" /> Enable
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
              {resetFor === u.username && (
                <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas-subtle)] p-2">
                  <Input
                    type="password"
                    placeholder="New password (min 8 chars)"
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                    className="h-8 w-56"
                  />
                  <Button
                    size="sm"
                    disabled={busy || resetPw.length < 8}
                    onClick={async () => {
                      await act(
                        { action: "reset", username: u.username, password: resetPw },
                        `Password reset for "${u.username}".`
                      );
                      setResetFor(null);
                      setResetPw("");
                    }}
                    className="h-8 bg-[var(--eis-btn-green)] text-xs text-white hover:bg-[var(--eis-btn-green-hover)]"
                  >
                    Save password
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setResetFor(null)}
                    className="h-8 text-xs text-[var(--eis-muted)]"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)]">
        <div className="border-b border-[var(--eis-border-muted)] bg-[var(--eis-canvas-subtle)] px-4 py-2.5 text-sm font-semibold">
          Add a new account
        </div>
        <div className="space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="text"
              placeholder="ID (e.g. sara.or client2)"
              value={nId}
              onChange={(e) => setNId(e.target.value)}
              aria-label="New account ID"
            />
            <Input
              type="password"
              placeholder="Password (min 8 chars)"
              value={nPw}
              onChange={(e) => setNPw(e.target.value)}
              aria-label="New account password"
            />
            <Input
              type="text"
              placeholder="Display name (optional, e.g. Sara Hassan)"
              value={nLabel}
              onChange={(e) => setNLabel(e.target.value)}
              aria-label="Display name"
            />
            <select
              value={nRole}
              onChange={(e) => setNRole(e.target.value)}
              aria-label="Role"
              className="h-9 rounded-md border border-[var(--eis-border)] bg-[var(--eis-canvas)] px-2 text-sm"
            >
              <option value="client">client — upload + see own reports</option>
              <option value="operator">operator — full queue + accounts</option>
            </select>
          </div>
          <Button onClick={addAccount} disabled={busy} className="gap-1.5 bg-[var(--eis-btn-green)] text-white hover:bg-[var(--eis-btn-green-hover)]">
            <UserPlus className="h-4 w-4" /> Create account
          </Button>
          <p className="text-xs text-[var(--eis-muted)]">
            The new account can sign in immediately with the ID and password you set. Share the
            credentials with the client through a secure channel — never email the password.
          </p>
        </div>
      </div>

      {msg && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            msg.kind === "ok"
              ? "border-[var(--eis-border)] bg-[var(--eis-success-subtle)] text-[var(--eis-btn-green-hover)]"
              : "border-[var(--eis-border)] bg-[var(--eis-danger-subtle)] text-[var(--eis-danger)]"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
