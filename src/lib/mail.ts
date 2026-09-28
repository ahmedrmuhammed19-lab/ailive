import { createTransport } from "nodemailer";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { WORKSPACE_ROOT, PORTAL_UPLOAD_DIR } from "@/lib/portal";

const MAIL_CREDS_PATH = path.join(WORKSPACE_ROOT, "config", "mail_credentials.json");
const OUTBOX_DIR = path.join(PORTAL_UPLOAD_DIR, "_outbox");

/** Operator mailbox: notifications land here and replies are directed here. */
export const OPERATOR_EMAIL = "ahmedr.muhammed19@gmail.com";

export interface QueuedMail {
  to: string;
  replyTo?: string;
  subject: string;
  body: string;
  html?: string; // optional rich-HTML part (buttons, layout) — live SMTP only
  kind: "operator_alert" | "client_receipt" | "report_ready" | "client_nudge";
  submissionId?: string;
  attachments?: Array<{ filename: string; path?: string; content?: Buffer; contentType?: string }>; // live SMTP only
  intendedTo?: string; // TEST_MAIL_TO lock: original recipient before redirect (audit trail)
}

/**
 * TEST-MAIL LOCK — hard safety rail for live-fire testing.
 * When TEST_MAIL_TO is set (local test runs ONLY), EVERY outgoing mail is
 * force-redirected to exactly that address, whatever its intended recipient
 * (client, operator, nudge copy). The original recipient is preserved in
 * intendedTo and stamped at the top of the body, and a second guard below
 * refuses to SMTP to anything but the lock address. Unset on production
 * => zero behavior change.
 */
export function testMailLock(): string | null {
  const v = process.env.TEST_MAIL_TO?.trim();
  return v || null;
}

function applyTestLock(mail: QueuedMail): QueuedMail {
  const lockTo = testMailLock();
  if (!lockTo || mail.to === lockTo) return mail;
  const stamp =
    `[TEST-MAIL LOCK] This mail was originally addressed to ${mail.to} and was ` +
    `redirected to ${lockTo} during testing — nothing was sent to any other address.\n\n`;
  const banner =
    `<div style="background:#fff4ce;border:1px solid #f0c36d;color:#7a5b00;` +
    `border-radius:8px;padding:10px 14px;font:13px/1.5 Arial,sans-serif;margin:0 0 14px;">` +
    `<strong>TEST-MAIL LOCK</strong> — originally addressed to <strong>${mail.to}</strong>; ` +
    `redirected to ${lockTo} during testing. Nothing was sent to any other address.</div>`;
  return {
    ...mail,
    intendedTo: mail.to,
    to: lockTo,
    replyTo: lockTo,
    body: stamp + mail.body,
    html: mail.html ? banner + mail.html : mail.html,
  };
}

interface MailCreds {
  email: string; // SMTP login / sender identity (e.g. your Gmail or Brevo account email)
  app_password: string; // SMTP password / API secret key (not necessarily a Gmail app password)
  notify_to?: string; // optional override for operator notification address
  // Generic SMTP provider support — Brevo, SendGrid, Zoho, Mailgun, etc.
  // Omitted => defaults to Gmail (smtp.gmail.com:465 SSL) for backward compatibility.
  host?: string;
  port?: number;
  secure?: boolean; // true = implicit TLS (465); false = STARTTLS (587)
}

const GMAIL_HOST = "smtp.gmail.com";

function smtpTarget(creds: MailCreds): { host: string; port: number; secure: boolean } {
  const host = creds.host?.trim() || GMAIL_HOST;
  const port = Number(creds.port) || (host === GMAIL_HOST ? 465 : 587);
  const secure = creds.secure !== undefined ? Boolean(creds.secure) : port === 465;
  return { host, port, secure };
}

export { smtpTarget };

export interface MailResult {
  sent: boolean;
  queued: boolean;
  to: string;
  error?: string;
}

async function loadCreds(): Promise<MailCreds | null> {
  // 1) Environment override — used on serverless deploys (Vercel) where the
  //    git-ignored config file does not exist. MAIL_CREDS_JSON holds the same
  //    JSON shape as config/mail_credentials.json.
  const envJson = process.env.MAIL_CREDS_JSON;
  if (envJson) {
    try {
      const creds = JSON.parse(envJson) as MailCreds;
      if (creds.email && creds.app_password) return creds;
    } catch {
      // malformed env JSON — fall through to the file
    }
  }
  // 2) Local config file
  if (!existsSync(MAIL_CREDS_PATH)) return null;
  try {
    const raw = await readFile(MAIL_CREDS_PATH, "utf8");
    const creds = JSON.parse(raw) as MailCreds;
    if (!creds.email || !creds.app_password) return null;
    return creds;
  } catch {
    return null;
  }
}

/** Public alias used by the upload route to decide send-vs-queue. */
export function loadMailCreds(): Promise<MailCreds | null> {
  return loadCreds();
}

async function writeOutbox(mail: QueuedMail, status: "QUEUED" | "SENT", error?: string) {
  // Outbox writes are best-effort: on read-only serverless filesystems they
  // are skipped (mail still attempts live SMTP via MAIL_CREDS_JSON when set).
  try {
    await mkdir(OUTBOX_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const slug = mail.kind + "_" + (mail.submissionId ?? "x").slice(-8);
    // unique salt: two mails of the same kind for the same submission can fire
    // within the same second (e.g. draft-ready + lesson-learned) — don't overwrite
    const salt = randomBytes(3).toString("hex");
    const file = path.join(OUTBOX_DIR, `${ts}_${slug}_${salt}.json`);
    await writeFile(
      file,
      JSON.stringify(
        {
          ...mail,
          // keep outbox lean — store a flag instead; set OUTBOX_KEEP_HTML=1 to
          // persist full HTML bodies (local email-preview runs only)
          html: process.env.OUTBOX_KEEP_HTML ? mail.html : undefined,
          hasHtml: Boolean(mail.html),
          attachments: mail.attachments?.map((a) => path.basename(a.path ?? a.filename)) ?? [],
          status,
          error: error ?? null,
          at: new Date().toISOString(),
        },
        null,
        2
      )
    );
    // Always-visible arrival/delivery log line
    await writeFile(
      path.join(OUTBOX_DIR, "NOTIFICATIONS.log"),
      `[${new Date().toISOString()}] ${status} ${mail.kind} -> ${mail.to} :: ${mail.subject}${error ? " :: " + error : ""}\n`,
      { flag: "a" }
    );
  } catch (err) {
    console.warn(
      "[mail] outbox write skipped (read-only fs?):",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Send one email via Gmail SMTP when credentials exist; otherwise queue it to
 * upload/portal/_outbox/ so scripts/flush_outbox.py can replay it later.
 * Never throws — mail failure must not fail the upload handshake.
 */
export async function sendOrQueue(input: QueuedMail): Promise<MailResult> {
  const mail = applyTestLock(input);
  const creds = await loadCreds();
  if (!creds) {
    await writeOutbox(mail, "QUEUED", "no SMTP credentials (config/mail_credentials.json missing)");
    return { sent: false, queued: true, to: mail.to };
  }
  // Defense in depth: while the lock is active, refuse to SMTP to anything
  // except the lock address, even if a future code path bypasses applyTestLock.
  const lockTo = testMailLock();
  if (lockTo && mail.to !== lockTo) {
    await writeOutbox(mail, "QUEUED", "TEST_MAIL_TO guard: recipient did not resolve to the lock address — send blocked");
    return { sent: false, queued: true, to: mail.to, error: "TEST_MAIL_TO guard blocked send" };
  }
  try {
    const { host, port, secure } = smtpTarget(creds);
    const transport = createTransport({
      host,
      port,
      secure,
      auth: { user: creds.email, pass: creds.app_password },
      // Bounded SMTP wait: the caller (e.g. the upload route) responds over HTTP,
      // so a hung Gmail connection must fail fast — the mail queues to the
      // outbox and scripts/flush_outbox.py replays it later.
      connectionTimeout: 10_000,
      greetingTimeout: 8_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({
      from: `Global EIS <${creds.email}>`,
      to: mail.to,
      replyTo: mail.replyTo ?? operatorAddress(creds),
      subject: mail.subject,
      text: mail.body,
      ...(mail.html ? { html: mail.html } : {}),
      attachments: mail.attachments,
    });
    await writeOutbox(mail, "SENT");
    return { sent: true, queued: false, to: mail.to };
  } catch (err) {
    const error = err instanceof Error ? err.message : "SMTP failure";
    await writeOutbox(mail, "QUEUED", error);
    return { sent: false, queued: true, to: mail.to, error };
  }
}

/** Operator address = env override, then notify_to override from creds, else the default operator mailbox. */
export function operatorAddress(creds: MailCreds | null): string {
  return process.env.OPERATOR_EMAIL_OVERRIDE?.trim() || creds?.notify_to?.trim() || OPERATOR_EMAIL;
}
