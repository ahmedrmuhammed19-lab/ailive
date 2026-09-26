import { createTransport } from "nodemailer";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
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
  kind: "operator_alert" | "client_receipt" | "report_ready";
  submissionId?: string;
  attachments?: Array<{ filename: string; path: string }>; // live SMTP only
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
  await mkdir(OUTBOX_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const slug = mail.kind + "_" + (mail.submissionId ?? "x").slice(-8);
  const file = path.join(OUTBOX_DIR, `${ts}_${slug}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        ...mail,
        attachments: mail.attachments?.map((a) => path.basename(a.path)) ?? [],
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
}

/**
 * Send one email via Gmail SMTP when credentials exist; otherwise queue it to
 * upload/portal/_outbox/ so scripts/flush_outbox.py can replay it later.
 * Never throws — mail failure must not fail the upload handshake.
 */
export async function sendOrQueue(mail: QueuedMail): Promise<MailResult> {
  const creds = await loadCreds();
  if (!creds) {
    await writeOutbox(mail, "QUEUED", "no SMTP credentials (config/mail_credentials.json missing)");
    return { sent: false, queued: true, to: mail.to };
  }
  try {
    const { host, port, secure } = smtpTarget(creds);
    const transport = createTransport({
      host,
      port,
      secure,
      auth: { user: creds.email, pass: creds.app_password },
    });
    await transport.sendMail({
      from: `Global EIS <${creds.email}>`,
      to: mail.to,
      replyTo: mail.replyTo ?? OPERATOR_EMAIL,
      subject: mail.subject,
      text: mail.body,
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

/** Operator address = notify_to override from creds, else the default operator mailbox. */
export function operatorAddress(creds: MailCreds | null): string {
  return creds?.notify_to?.trim() || OPERATOR_EMAIL;
}
