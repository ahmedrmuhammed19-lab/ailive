import { sessionAccount } from "@/lib/session";

/**
 * Role-based access helpers.
 *
 * Roles:
 *  - "operator" — full visibility: every submission, report, statement, stat.
 *  - "client"   — scoped visibility: only submissions they uploaded themselves
 *                 (submittedBy) or that are queued under their account ID
 *                 (userId), plus the reports/statements belonging to those.
 */

export type PortalAccount = NonNullable<Awaited<ReturnType<typeof sessionAccount>>>;

export function isOperator(acct: PortalAccount): boolean {
  return acct.role === "operator";
}

/** Prisma `where` fragment matching the submissions a client account owns. */
export function ownedScope(username: string): { OR: Array<Record<string, string>> } {
  return { OR: [{ submittedBy: username }, { userId: username }] };
}
