#!/usr/bin/env bash
# EMAIL TOUR E2E — fresh local env, build, boot, tour suite.
# All client-experience emails addressed to ahmedr.muhammed19@gmail.com (outbox mode).
set -e
cd /home/z/my-project

echo "== 1. stop stale servers =="
pkill -f "standalone/server.js" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
sleep 1

echo "== 2. fresh DB + clean outbox =="
rm -f db/custom.db
rm -rf upload/portal/_outbox
npx prisma db push --accept-data-loss >/dev/null 2>&1

echo "== 3. seed portal users =="
node -e '
const { PrismaClient } = require("@prisma/client");
const { scryptSync, randomBytes } = require("crypto");
const hash = (p) => { const s = randomBytes(16); return `scrypt$${s.toString("base64")}$${scryptSync(p, s, 64).toString("base64")}`; };
const db = new PrismaClient();
(async () => {
  await db.portalUser.create({ data: { id: "u_op_tour", username: "op.eis", passwordHash: hash("Op-Test-2026!"), label: "Operator (E2E)", role: "operator", active: true } });
  await db.portalUser.create({ data: { id: "u_cl_tour", username: "client.workq", passwordHash: hash("Client-2026!"), label: "Client (E2E)", role: "client", active: true } });
  await db.$disconnect();
  console.log("users seeded");
})();
'

echo "== 4. build =="
npm run build >/dev/null 2>&1 || { echo "BUILD FAILED"; npx next build 2>&1 | tail -30; exit 1; }

echo "== 5. boot =="
export OUTBOX_KEEP_HTML=1  # persist email HTML bodies for the preview page
export OPERATOR_EMAIL_OVERRIDE=paulmero5@gmail.com  # operator copies follow the test target too
export TEST_MAIL_TO=paulmero5@gmail.com  # TEST-MAIL LOCK: EVERY mail force-redirected here; no outsider can ever be mailed
nohup npm run start >/dev/null 2>&1 &
for i in $(seq 1 60); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  [ "$code" = "200" ] && break
done
echo "portal HTTP $code"

echo "== 6. run EMAIL TOUR suite =="
python3 scripts/test_email_tour.py
