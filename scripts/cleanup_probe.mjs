import { PrismaClient } from "@prisma/client";
import { rmSync, readdirSync, unlinkSync } from "fs";
import path from "path";
const db = new PrismaClient();
const subs = await db.submission.findMany({ where: { userId: "SMTP_PROBE" }, include: { files: true } });
for (const s of subs) {
  await db.statementFile.deleteMany({ where: { submissionId: s.id } });
  await db.submission.delete({ where: { id: s.id } });
  console.log("removed DB:", s.id);
}
const portal = "/home/z/my-project/upload/portal";
for (const d of readdirSync(portal)) {
  if (d.endsWith("_SMTP_PROBE")) { rmSync(path.join(portal, d), { recursive: true, force: true }); console.log("removed dir:", d); }
}
const outbox = path.join(portal, "_outbox");
for (const f of readdirSync(outbox)) {
  if (f.includes("c2rox5ua")) { unlinkSync(path.join(outbox, f)); console.log("removed outbox:", f); }
}
await db.$disconnect();
