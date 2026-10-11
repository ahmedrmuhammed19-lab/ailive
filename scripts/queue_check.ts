/**
 * DL-9e readiness check — portal queue state via prisma client.
 * Run: bun scripts/queue_check.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const cases = await p.submission.findMany({
  orderBy: { createdAt: "desc" },
  take: 8,
  select: {
    id: true,
    userId: true,
    status: true,
    clientName: true,
    country: true,
    visaType: true,
    travelers: true,
    createdAt: true,
    files: { select: { originalName: true } },
  },
});
const logs = await p.parseLog.findMany({
  orderBy: { createdAt: "desc" },
  take: 12,
  select: { submissionId: true, queueId: true, outcome: true, integrityMin: true, legs: true, createdAt: true },
});
const logBy = new Map(logs.filter((l) => l.submissionId).map((l) => [l.submissionId, l]));
console.log("=== QUEUE (newest 8) ===");
for (const c of cases)
  console.log(
    `${c.createdAt.toISOString()} | ${c.userId ?? c.id.slice(0, 6)} | ${c.status}` +
      ` | ${c.clientName ?? "-"} | ${c.country ?? "-"} x${c.travelers}` +
      ` | files: ${c.files.map((f) => f.originalName.slice(0, 30)).join("; ") || "none"}` +
      ` | engine: ${(() => { const l = logBy.get(c.id); return l ? `${l.outcome}(${l.legs}L,${l.integrityMin ?? "?"}%)` : "not run"; })()}`
  );
const users = await p.portalUser.findMany({ select: { username: true, role: true } });
console.log(`users: ${users.map((u) => `${u.username}(${u.role})`).join(", ")}`);
await p.$disconnect();
