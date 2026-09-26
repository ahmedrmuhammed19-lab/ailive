# Global EIS — Bank Statement Analysis Portal

Next.js 16 portal + Python analysis pipeline that turns bank statement PDFs
into standardized Global EIS visa-support reports (HTML + PDF), with case
tracking, automatic email delivery, and a permanent design-standard QA gate.

## Features

- Per-account sign-in (ID + password): scrypt-hashed passwords, HMAC-signed
  HttpOnly session cookies, brute-force brake on the login endpoint
- Accounts are created on demand with `scripts/add-user.mjs` — one command
  per new client or operator
- Statement uploads stored hash-locked (MD5) on arrival: Vercel Blob in
  production, local filesystem in development (`src/lib/storage.ts`)
- Joint-applicant aware visa-threshold baselines (UK / Schengen / US / fallback)
- Automatic case-brief generation for the analysis pipeline (`scripts/start_case.py`)
- Design Standard v1.3 permanent compliance gate (`scripts/qa_v13_check.py`)
- Provider-agnostic SMTP notifications (Gmail / Brevo / SendGrid) with an
  outbox queue, status tracking, and operator alerts
- Finished reports delivered to clients by email as an HTML attachment, and
  downloadable from the portal's Reports tab (`scripts/publish-report.mjs`)

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Prisma ORM + SQLite (swap to Turso/Postgres for serverless hosting)
- Python 3 analysis scripts
- Nodemailer SMTP

## Layout

| Path | Purpose |
|------|---------|
| `src/` | Portal application (upload form, queue panel, mailer, API routes) |
| `scripts/` | Generic engine scripts only (case brief, QA gate, mail tools) |
| `templates/` | Report design standards (v1.1 → v1.3) |
| `prisma/` | Database schema |
| `config/` | Mail credentials (git-ignored; `.example` shows the shape) |

## Run

```bash
bun install
bunx prisma db push
bun run dev
```

Create portal accounts:

```bash
bun scripts/add-user.mjs add <id> <password> [label] [client|operator]
bun scripts/add-user.mjs list
```

`SESSION_SECRET` must be set (see `.env.example`) — every session check
fails closed without it.

## Privacy

Client data — statements, reports, the database, agent logs, and mail
credentials — is git-ignored and never committed to this repository.
`config/mail_credentials.json.example` documents the expected credential
format; copy it to `config/mail_credentials.json` and fill in your own
SMTP credentials.
