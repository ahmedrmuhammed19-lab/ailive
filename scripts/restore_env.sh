#!/usr/bin/env bash
# restore_env.sh — regenerate the LOCAL portal environment after a sandbox wipe.
#
# The sandbox periodically strips untracked files (reset #4/#5 pattern): .env
# keys, config/mail_credentials.json, db/custom.db. This script restores what
# can be restored WITHOUT external secrets:
#   .env                       SESSION_SECRET (fresh random), TEST_MAIL_TO lock,
#                              PORTAL_BASE_URL=localhost scoping
#   db/custom.db               prisma db push + tracked seed_users.mjs
# It CANNOT recreate config/mail_credentials.json (real SMTP secret — must be
# re-supplied by the operator; template: config/mail_credentials.json.example).
#
# Usage: bash scripts/restore_env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. .env — keep DATABASE_URL, regenerate the rest if missing
python3 - <<'PY'
import secrets, os
lines = open('.env').read().splitlines() if os.path.exists('.env') else []
lines = [l for l in lines if l.strip() and not l.startswith(('SESSION_SECRET=','TEST_MAIL_TO=','PORTAL_BASE_URL='))]
have = {l.split('=')[0] for l in lines}
if 'DATABASE_URL' not in have:
    lines.insert(0, 'DATABASE_URL=file:/home/z/my-project/db/custom.db')
lines += ['SESSION_SECRET=' + secrets.token_hex(32),
          'TEST_MAIL_TO=ahmedr.muhammed19@gmail.com',
          'PORTAL_BASE_URL=http://localhost:3000']
open('.env','w').write('\n'.join(lines) + '\n')
print('env keys:', [l.split('=')[0] for l in lines])
PY

# 2. database + seed accounts (op.eis, client.workq, client.other, abdo)
mkdir -p db
npx prisma db push --skip-generate >/dev/null 2>&1
node scripts/seed_users.mjs | tail -1

# 3. mail creds — report only (secret cannot be regenerated)
if [ ! -f config/mail_credentials.json ]; then
  echo "NOTE: config/mail_credentials.json missing — SMTP sending disabled (file outbox mode). Operator must re-supply the app password."
fi
