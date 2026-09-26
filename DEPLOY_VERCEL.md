# Deploy the Global EIS Portal to Vercel

This guide takes the portal live on Vercel with a Postgres database and Blob
storage. Total time: ~10 minutes. Everything else (analysis pipeline, report
generation, mail tooling) keeps running locally exactly as it does today.

## Architecture after deployment

| Concern | Local (today) | Vercel (after deploy) |
|---|---|---|
| Database | SQLite file (`db/custom.db`) | Postgres (Neon) — same schema, swapped at build time |
| Statement storage | `upload/portal/` | Vercel Blob (unguessable keys, session-guarded downloads) |
| Reports storage | `download/` | Vercel Blob via `scripts/publish-report.mjs` |
| Sign-in | ID + password (scrypt) | Same — accounts live in the DB |
| Email | SMTP via local config | SMTP via `MAIL_CREDS_JSON` env var |
| Analysis pipeline | Local Python scripts | Unchanged — run locally as always |

## Step 1 — Vercel account (~2 min)

1. Go to <https://vercel.com/signup> and choose **Continue with GitHub**.
2. Authorize Vercel to access your repositories (the `ailive` repo is enough).

## Step 2 — Import the project (~2 min)

1. Dashboard → **Add New… → Project**.
2. Pick the **ailive** repository → **Import**.
3. Framework Preset is detected as **Next.js** automatically. Leave build
   settings alone — `vercel.json` already swaps the database to Postgres at
   build time. Do **not** click Deploy yet (env vars come first).

## Step 3 — Attach a Postgres database (~3 min)

1. Project → **Storage** tab → **Create Database** → **Postgres (Neon)**.
2. Accept the free-tier defaults, name it e.g. `eis-db`, choose a region
   close to your clients (e.g. Frankfurt).
3. When asked **Connect to project**, select this project. Vercel injects
   `DATABASE_URL` (and the pooled variant) automatically.

## Step 4 — Attach a Blob store (~1 min)

1. Project → **Storage** tab → **Create Database** → **Blob**.
2. Name it e.g. `eis-files`, free tier, same region.
3. Connect it to the project — `BLOB_READ_WRITE_TOKEN` is injected.

## Step 5 — Set the required env vars (~2 min)

Project → **Settings → Environment Variables** → add for
Production + Preview:

| Key | Value |
|---|---|
| `SESSION_SECRET` | random 64-hex — `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `SETUP_KEY` | random 32-hex — `python3 -c "import secrets; print(secrets.token_hex(16))"` — used once to create the first account |
| `MAIL_CREDS_JSON` | optional — one-line JSON, see `.env.vercel.example` |

## Step 6 — Deploy

Push to `main` (or click **Deploy** in the dashboard). First build takes a
few minutes: it swaps the Prisma provider to Postgres, pushes the schema to
Neon, and builds the app. The portal is live at
`https://<project>.vercel.app`.

## Step 7 — Create the first account on the live portal (self-service)

1. Open `https://<project>.vercel.app` while signed out. Because the database
   has zero accounts, the portal shows a **First-time setup** card instead of
   the sign-in form.
2. Paste the `SETUP_KEY` you set in Step 5, choose your ID and password
   (min 8 chars), optionally add a display name, and submit.
3. You are signed in immediately as an **operator** — the setup form is now
   gone for everyone (it only ever works on an empty portal).

More accounts: sign in as an operator → **Accounts** tab → add client or
operator accounts with any ID/password you choose. To add accounts any time
later, just ask, or do it yourself in two clicks.

## Day-to-day flow after going live

1. Client signs in on the Vercel portal and uploads their statement
   (arrives hash-locked in Blob + queue row in Postgres; operator alert
   emailed if `MAIL_CREDS_JSON` is set).
2. You download the statement (portal → Queue → expand → link) and run the
   local analysis pipeline as always.
3. Publish the finished report so the client sees it and gets it by email:

```bash
export DATABASE_URL="<Neon URL>"
export BLOB_READ_WRITE_TOKEN="<from Vercel → Storage → Blob → .env.local tab>"
bun scripts/publish-report.mjs download/GlobalEIS_Report_X.html EIS-XXXXX <submissionId>
```

4. Mark the queue item DONE in the portal → client receives the HTML report
   by email (if mail is configured) and can download it from Reports.

## Notes

- The local SQLite portal keeps working unchanged for offline use.
- The git-ignored `config/mail_credentials.json` is never deployed — Vercel
  email uses `MAIL_CREDS_JSON` instead.
- Custom domain: Vercel → Settings → Domains → add yours (DNS instructions
  are shown inline).
