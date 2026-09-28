// seed_users.mjs — seed portal accounts for comprehensive operator+client testing
// Same credential pattern as the historical full-cycle suite.
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const db = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const users = [
  { username: "op.eis", password: "Op-Test-2026!", label: "Operator (E2E)", role: "operator" },
  { username: "client.workq", password: "Client-2026!", label: "Client (E2E)", role: "client" },
  { username: "client.other", password: "Client-2026!", label: "Client B (scoping probe)", role: "client" },
];

for (const u of users) {
  await db.portalUser.upsert({
    where: { username: u.username },
    update: { passwordHash: hashPassword(u.password), active: true, role: u.role, label: u.label },
    create: { username: u.username, passwordHash: hashPassword(u.password), label: u.label, role: u.role, active: true },
  });
}
console.log("SEEDED:", users.map((u) => u.username).join(", "));
await db.$disconnect();
