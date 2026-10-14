#!/bin/bash
# DL-19 wire-proof: upload -> GitHub vault commit -> session-guarded read-back.
# Token flows ONLY via env; never printed, never committed.
set -u
cd /home/z/my-project
export GH_VAULT_TOKEN="$(rg -o '^GH_VAULT_TOKEN=(.+)$' -r '$1' .env 2>/dev/null | head -1)"
export GH_VAULT_REPO="$(rg -o '^GH_VAULT_REPO=(.+)$' -r '$1' .env 2>/dev/null | head -1)"
[ -z "$GH_VAULT_TOKEN" ] && { echo "FATAL: GH_VAULT_TOKEN missing in .env"; exit 1; }
[ -z "$GH_VAULT_REPO" ] && { echo "FATAL: GH_VAULT_REPO missing in .env"; exit 1; }
REPO_URL="https://api.github.com/repos/${GH_VAULT_REPO}"

pkill -f 'next dev' 2>/dev/null; sleep 1
(bun run dev >/tmp/dev.log 2>&1 &)
code=000
for i in $(seq 1 40); do code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000); [ "$code" = "200" ] && break; sleep 2; done
echo "SERVER=$code"; [ "$code" = "200" ] || exit 1

J=/tmp/gh_cookies.txt; rm -f "$J"
LOGIN=$(curl -s -c "$J" -X POST http://localhost:3000/api/login -H 'Content-Type: application/json' \
  -d '{"username":"op.eis","password":"Op-Test-2026!"}')
echo "LOGIN: $(echo "$LOGIN" | head -c 100)"

FIX=tests/e2e_fixtures/statement_green_B.pdf
MD5_BEFORE=$(md5sum "$FIX" | cut -d' ' -f1)
echo "FIXTURE=$FIX md5=$MD5_BEFORE"

UP=$(curl -s -b "$J" -X POST http://localhost:3000/api/upload \
  -F 'userId=' -F 'email=ghvault-e2e@local.test' -F 'country=Egypt' -F 'visaType=Work Visa' -F 'travelers=1' \
  -F "files=@${FIX}")
echo "UPLOAD: $(echo "$UP" | head -c 300)"

READ=$(echo "$UP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
h=(d.get('handshake') or [{}])[0]
print(d.get('userId') or d.get('queueId') or '', h.get('fileId',''), h.get('md5',''))")
QID=$(echo "$READ" | cut -d' ' -f1); FID=$(echo "$READ" | cut -d' ' -f2)
echo "QID=$QID FID=$FID"
[ -z "$FID" ] && { echo "FATAL: no fileId in upload response"; exit 1; }

echo "=== sqlite row (col5: data IS NULL) ==="
ROW=$(python3 - << PYEOF
import sqlite3
c = sqlite3.connect('db/custom.db').execute(
  "SELECT id, storedPath, storedUrl, md5, data IS NULL FROM StatementFile WHERE id=?", ("$FID",)).fetchone()
print(c)
PYEOF
)
echo "$ROW"

KEY=$(python3 -c "import re; m=re.search(r\"'([^']*gh:[^']*)'\", '''$ROW'''); print(m.group(1) if m else '')")
echo "KEY=$KEY"
case "$KEY" in gh:*) echo "GH_KEY=YES";; *) echo "GH_KEY=NO (FATAL)"; exit 1;; esac
KEYPATH=$(python3 -c "import urllib.parse,sys; k=sys.argv[1][3:]; print(urllib.parse.quote(k.split('@')[0]))" "$KEY")

echo "=== vault object ==="
curl -s -H "Authorization: Bearer $GH_VAULT_TOKEN" "$REPO_URL/contents/$KEYPATH" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print('path:', d.get('path'), '| size:', d.get('size'), '| sha:', (d.get('sha') or '')[:12], '| msg:', d.get('message'))"

echo "=== AUTO_WORK engine evidence (gh byte-load through analyze.ts) ==="
sleep 15
python3 - << PYEOF
import sqlite3
db = sqlite3.connect('db/custom.db')
sub = db.execute("SELECT id, status FROM Submission WHERE id IN (SELECT submissionId FROM StatementFile WHERE id=?)", ("$FID",)).fetchone()
print('SUBMISSION:', sub)
try:
    log = db.execute("SELECT outcome, modes, substr(COALESCE(textPreview,''),1,60) FROM ParseLog ORDER BY createdAt DESC LIMIT 1").fetchone()
    print('PARSELOG:', log)
except Exception as e:
    print('PARSELOG: (skip)', e)
PYEOF

echo "=== session-guarded read-back ==="
curl -s -b "$J" "http://localhost:3000/api/statement?id=$FID" -o /tmp/readback.bin
MD5_AFTER=$(md5sum /tmp/readback.bin | cut -d' ' -f1)
echo "MD5_BEFORE=$MD5_BEFORE"
echo "MD5_AFTER=$MD5_AFTER"
[ "$MD5_BEFORE" = "$MD5_AFTER" ] && echo "READBACK_IDENTICAL=YES" || echo "READBACK_IDENTICAL=NO (FATAL)"
echo "=== DONE ==="
