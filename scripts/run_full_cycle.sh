#!/usr/bin/env bash
# FULL CYCLE — one fresh env, then ALL suites in sequence (prod parity boot).
set -e
cd /home/z/my-project

echo "== 1. stop stale servers =="
pkill -f "standalone/server.js" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
sleep 1

echo "== 2. static checks: TypeScript (portal code = src/) =="
npx tsc --noEmit 2>&1 | tee /tmp/tsc_full.log > /dev/null || true
if rg -q "^src/" /tmp/tsc_full.log; then
  echo "TYPE ERRORS IN PORTAL CODE:"; rg "^src/" /tmp/tsc_full.log; exit 1
fi
echo "tsc: portal src/ clean (non-portal sandbox files excluded)"

echo "== 3. fresh DB + clean outbox =="
rm -f db/custom.db
rm -rf upload/portal/_outbox
npx prisma db push --accept-data-loss >/dev/null 2>&1

echo "== 4. seed portal users =="
node -e '
const { PrismaClient } = require("@prisma/client");
const { scryptSync, randomBytes } = require("crypto");
const hash = (p) => { const s = randomBytes(16); return `scrypt$${s.toString("base64")}$${scryptSync(p, s, 64).toString("base64")}`; };
const db = new PrismaClient();
(async () => {
  await db.portalUser.create({ data: { id: "u_op_fc", username: "op.eis", passwordHash: hash("Op-Test-2026!"), label: "Operator (E2E)", role: "operator", active: true } });
  await db.portalUser.create({ data: { id: "u_cl_fc", username: "client.workq", passwordHash: hash("Client-2026!"), label: "Client (E2E)", role: "client", active: true } });
  await db.$disconnect();
  console.log("users seeded");
})();
'

echo "== 5. build =="
npm run build >/dev/null 2>&1 || { echo "BUILD FAILED"; npx next build 2>&1 | tail -30; exit 1; }

echo "== 6. boot (prod parity: no OUTBOX_KEEP_HTML, no OPERATOR_EMAIL_OVERRIDE) =="
nohup npm run start >/dev/null 2>&1 &
for i in $(seq 1 60); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ || true)
  [ "$code" = "200" ] && break
done
echo "portal HTTP $code"

echo "== 7. suite 1/3: FULL CYCLE =="
python3 scripts/test_full_cycle.py
echo "== 8. suite 2/3: NUDGE regression =="
python3 scripts/test_nudge.py
echo "== 9. suite 3/3: OCR + WINDOW regression =="
python3 scripts/test_ocr_window.py

echo ""
echo "ALL SUITES COMPLETED"
