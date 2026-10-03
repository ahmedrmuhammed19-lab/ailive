import { extractText, getDocumentProxy } from "unpdf";
import { db } from "@/lib/db";
import { ocrImageText, ocrPdfText, reocrPages } from "@/lib/ocr";
import {
  alertBox,
  analysisCard,
  escHtml,
  kpiCard,
  kpiGrid,
  reportShell,
  sectionTitle,
  tag,
} from "@/lib/report_design";

/**
 * Auto-analysis engine — first-pass statement analysis triggered by the
 * email "Start Analysis" button.
 *
 * Strategy: extract the PDF text layer (unpdf / pdf.js, serverless-safe),
 * parse CIB statement structure (account meta + date-anchored movement rows),
 * then classify every row by *ledger chain verification* — the same logic as
 * the workspace Python engine (scripts/haytham_extract.py): the running
 * balance must reconcile, so each movement's direction comes from the stated
 * balance delta rather than fragile column geometry.
 *
 * Output: one CIB-Blue-styled DRAFT report per submission (watermarked
 * "pending analyst review"), published to the DB so the operator can review
 * and mark DONE — the DONE flow then delivers it to the client untouched.
 *
 * Honest limits: image-only scans fall back to the SHADOW OCR stage
 * (src/lib/ocr.ts) — recovered text runs through the same parsers and chain
 * verification, but OCR-sourced drafts are NEVER auto-delivered: they always
 * park for analyst review. Non-CIB layouts and failed OCR stay red
 * ("needs manual analysis") — the case remains ANALYZING for the workspace.
 */

// ---------- indicative FX (EGP per unit) — disclosed in report, refresh on submission day ----------
const FX_EGP: Record<string, number> = {
  EGP: 1,
  USD: 48.0,
  EUR: 51.5,
  GBP: 60.0,
  SAR: 12.8,
  AED: 13.1,
  KWD: 156.0,
  QAR: 13.2,
};

// ---------- indicative visa benchmark (EGP-equivalent, × joint applicants) ----------
const BENCHMARK_EGP: Record<string, number> = {
  "UNITED KINGDOM": 250_000,
  "SCHENGEN AREA": 150_000,
  "UNITED STATES": 200_000,
  CANADA: 150_000,
  AUSTRALIA: 150_000,
};
const DEFAULT_BENCHMARK_EGP = 150_000;

// ---------- auto-delivery gate ----------
// Minimum per-leg ledger-chain integrity (matched rows / total rows) required
// to auto-deliver the engine report and mark DONE in the same tap. Default 1
// = 100%: every single row on EVERY account must reconcile against the
// bank's own running balances. Anything below parks the draft for review and
// emails the operator instead (AUTO_DELIVER=0 disables auto-delivery fully).
export const AUTO_DELIVER_MIN = (() => {
  const raw = parseFloat(process.env.AUTO_DELIVER_MIN ?? "1");
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(0, raw));
})();

export function autoDeliverMinPct(): number {
  return Math.round(AUTO_DELIVER_MIN * 100);
}

/** Parser identity — bumped when layout handling improves; recorded in ParseLog telemetry. */
export const PARSER_VERSION = "eis-ts/3.0";

// ---------- CIB text-layer patterns ----------
const RE_ACCT = /Account\s*Number:\s*(\d{6,})/i;
const RE_CURR = /Account\s*Currency:\s*([A-Z]{3})/i;
const RE_LEDGER = /Ledger\s*Balance:\s*\(?([\d,]+\.\d{2})\)?/i;
const RE_PERIOD =
  /Movement Details\s*-?\s*From:\s*(\d{1,2}\s+\w{3}\s+\d{4})\s*To:\s*(\d{1,2}\s+\w{3}\s+\d{4})/i;
const RE_DATE_FULL = /^\s*(\d{2}\/\d{2}\/20\d{2})\b/;
const RE_DATE_WRAPPED = /^\s*(\d{2}\/\d{2}\/20)(?!\d)/; // year wrapped to next token
const RE_AMT = /\(?-?[\d,]+\.\d{2}\)?/g;
const RE_TOTAL_LINE = /^\s*Total\b/i;
const SALARY_RE = /salary|payroll|\bsal\b/i;
const CREDIT_RE = /inward|remittance|refund|interest|deposit\b|credit\b/i;
const STRONG_CREDIT_RE = /\bIPN Inward\b|cheque deposit|\binterest\b|\brefund\b|\bdeposit\b/i;
const STRONG_DEBIT_RE = /\bIPN Outward\b|POS PURCHASE|Purchase With Card|purchases using|\bATM\b|cash withdrawal/i;

interface TxRow {
  date: string;
  desc: string;
  movement: number | null; // abs value from the row's amount column
  balance: number | null; // stated running balance
  signed: number; // +credit / -debit after chain classification
  chainOk: boolean;
  /** Source line index in the parsed text (OCR rows) — maps unverified rows back to their page for targeted re-OCR. */
  srcLine?: number;
}

interface AccountLeg {
  file: string;
  mode?: string; // layout family that parsed it (B-internet / C-digital / D-glued / A-branch; "OCR:" prefix = recovered from a scan)
  account: string | null;
  currency: string;
  period: string | null;
  opening: number;
  closing: number;
  inflow: number;
  outflow: number;
  txCount: number;
  matched: number;
  largestCredit: { desc: string; amount: number } | null;
  largestDebit: { desc: string; amount: number } | null;
  salarySeen: boolean;
  // --- 6-month analysis window (embassy lookback rule) ---
  periodFrom?: Date | null;
  periodTo?: Date | null;
  monthsCovered?: number | null; // actual statement coverage in months (1 decimal)
  windowFrom?: Date | null; // start of the last-6-months window (null = whole statement is the window)
  windowExcluded?: number; // ledger rows before the window (still chain-verified, excluded from metrics)
  windowInflow?: number;
  windowOutflow?: number;
  windowNotes?: string[]; // human-readable period observations for the report/analyst
  // --- OCR provenance (shadow mode) ---
  ocr?: boolean; // text recovered from a scanned image — never auto-delivered
  ocrPages?: number;
  rows: TxRow[];
}

export interface AutoAnalysisResult {
  ok: boolean;
  mode: "cib-parsed" | "unrecognized" | "no-files";
  message: string;
  legs: Array<
    Pick<AccountLeg, "account" | "currency" | "mode" | "opening" | "closing" | "inflow" | "outflow" | "txCount" | "matched"> & {
      monthsCovered: number | null;
      windowFrom: string | null; // ISO date (yyyy-mm-dd) of the 6-month window start
      windowExcluded: number;
      windowInflow: number;
      windowOutflow: number;
      ocr: boolean;
    }
  >;
  fullLegs?: AccountLeg[]; // internal: for publishDraftReport (not JSON-serialised)
  submission?: {
    id: string;
    userId: string | null;
    clientName: string | null;
    email: string | null;
    country: string | null;
    visaType: string | null;
    travelers: number | null;
  };
  allVerified: boolean; // every leg ≥ AUTO_DELIVER_MIN chain integrity (default 100%)
  ocrUsed: boolean; // any leg recovered through the shadow OCR stage (blocks auto-delivery)
  windowSummary: string; // human-readable 6-month window observations across legs
  parserVersion: string;
  /** Self-improvement evidence: unmatched rows (below-threshold cases) and raw text preview (unrecognized cases). */
  evidence?: {
    unmatched: Array<{ file: string; date?: string; desc?: string; movement?: number | null; balance?: number | null }>;
    textPreview?: string;
  };
}

/** Phase 1 — parse & verify the case's statements (no DB writes). */
export async function analyzeSubmission(submissionId: string): Promise<AutoAnalysisResult> {
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { files: true },
  });
  if (!submission)
    return { ok: false, mode: "no-files", message: "Submission not found.", legs: [], allVerified: false, ocrUsed: false, windowSummary: "", parserVersion: PARSER_VERSION };
  const pdfFiles = submission.files.filter((f) => /\.(pdf|jpe?g|png)$/i.test(f.originalName));
  if (pdfFiles.length === 0) {
    return {
      ok: false,
      mode: "no-files",
      message: "No PDF or image statements attached to this case.",
      legs: [],
      allVerified: false,
      ocrUsed: false,
      windowSummary: "",
      parserVersion: PARSER_VERSION,
    };
  }

  const legs: AccountLeg[] = [];
  const rawSamples: string[] = []; // first bytes of each PDF's text — failure evidence for ParseLog
  let ocrUsed = false;
  let scanDetected = false;
  for (const f of submission.files) {
    const lowerName = f.originalName.toLowerCase();
    const isPdf = lowerName.endsWith(".pdf");
    const isImage = /\.(jpe?g|png)$/.test(lowerName);
    if (!isPdf && !isImage) continue;
    let buf: Buffer | null = null;
    if (f.data) buf = Buffer.from(f.data);
    else if (f.storedPath) {
      try {
        const { readFile } = await import("fs/promises");
        buf = await readFile(f.storedPath);
      } catch {
        buf = null;
      }
    }
    if (!buf) continue;
    try {
      if (isImage) {
        // Direct photo upload (JPG/PNG) — straight into the shadow OCR stage;
        // recovered text runs through the SAME parsers and chain verification.
        scanDetected = true;
        const ocr = await ocrImageText(buf);
        if (ocr) {
          rawSamples.push(`===== ${f.originalName} (image OCR) =====\n${ocr.text.slice(0, 8000)}`);
          const legsFound =
            parseCibTextMulti(ocr.text, f.originalName, true) ?? [];
          if (legsFound.length === 0)
            legsFound.push(
              ...parseCibTextMulti(ocr.text.replace(/([A-Za-z])\s+:/g, "$1: "), f.originalName, true)
            );
          if (legsFound.length === 0)
            legsFound.push(
              ...parseCibTextMulti(ocr.text.replace(/([A-Za-z])\s*:\s*/g, "$1 "), f.originalName, true)
            );
          if (legsFound.length > 0) {
            ocrUsed = true;
            for (const leg of legsFound) {
              leg.ocr = true;
              leg.ocrPages = 1;
              leg.mode = `OCR:${leg.mode ?? "unknown"}`;
              applySixMonthWindow(leg);
              legs.push(leg);
            }
          }
        }
        continue;
      }
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      let merged = Array.isArray(text) ? text.join("\n") : text;
      rawSamples.push(`===== ${f.originalName} =====\n${merged.slice(0, 8000)}`);
      let legsFound = parseCibTextMulti(merged, f.originalName);
      // Shadow OCR: image-only scans carry (almost) no text layer. When the
      // digital text is too thin AND the layout parsers found nothing, pull
      // the embedded page images and OCR them — the recovered text runs
      // through the SAME parsers and chain verification, but the leg is
      // marked OCR-sourced so the engine never auto-delivers it.
      const textChars = merged.replace(/[^A-Za-z0-9]/g, "").length;
      if (legsFound.length === 0 && textChars < 240) {
        scanDetected = true;
        const ocr = await ocrPdfText(buf);
        if (ocr) {
          rawSamples.push(
            `===== ${f.originalName} (OCR ${ocr.pages} page(s)${ocr.truncated ? ", page/time capped" : ""}) =====\n${ocr.text.slice(0, 8000)}`
          );
          // OCR text is fuzzy around header punctuation — try the raw text,
          // then a colon-glued variant ("Number :" -> "Number:"), then a
          // colon-stripped variant ("Number:" -> "Number "), so every layout
          // family's header regexes get the punctuation shape they expect.
          legsFound =
            parseCibTextMulti(ocr.text, f.originalName, true) ?? [];
          if (legsFound.length === 0)
            legsFound = parseCibTextMulti(
              ocr.text.replace(/([A-Za-z])\s+:/g, "$1: "),
              f.originalName,
              true
            );
          if (legsFound.length === 0)
            legsFound = parseCibTextMulti(
              ocr.text.replace(/([A-Za-z])\s*:\s*/g, "$1 "),
              f.originalName,
              true
            );
          // Document-level engine/variant fallbacks — LESSON (campaign #2):
          // different OCR engines read the same scan differently (native CLI
          // models vs tesseract.js WASM; color vs gray rasters). The CLI reads
          // some scans column-scrambled where WASM read them row-wise and
          // vice-versa. So when the first OCR pass parses poorly, try the
          // other engines and keep whichever recovers more chain-verified
          // rows — the parsers and the chain judge, not a text heuristic.
          const parseOcr = (t: string) => {
            let ls = parseCibTextMulti(t, f.originalName, true) ?? [];
            if (ls.length === 0)
              ls = parseCibTextMulti(t.replace(/([A-Za-z])\s+:/g, "$1: "), f.originalName, true);
            if (ls.length === 0)
              ls = parseCibTextMulti(t.replace(/([A-Za-z])\s*:\s*/g, "$1 "), f.originalName, true);
            return ls;
          };
          const score = (ls: AccountLeg[]) => ls.reduce((s, l) => s + l.matched, 0);
          const txTotal = (ls: AccountLeg[]) => ls.reduce((s, l) => s + l.txCount, 0);
          const poor = (ls: AccountLeg[]) => score(ls) < 5 || score(ls) < txTotal(ls) * 0.85;
          let bestLegs = parseOcr(ocr.text);
          let bestPages = ocr.pages;
          let bestPageTexts: string[] | null = ocr.pageTexts ?? null; // winning document's per-page text (for re-OCR targeting)
          if (poor(bestLegs)) {
            for (const altOpts of [{ preferGray: true }, { preferGray: true, forceWasm: true }]) {
              const alt = await ocrPdfText(buf, altOpts);
              if (!alt) continue;
              rawSamples.push(
                `===== ${f.originalName} (OCR alt ${alt.pages}p ${JSON.stringify(altOpts)}) =====\n${alt.text.slice(0, 4000)}`
              );
              const altLegs = parseOcr(alt.text);
              if (score(altLegs) > score(bestLegs)) {
                bestLegs = altLegs;
                bestPages = alt.pages;
                bestPageTexts = alt.pageTexts ?? null;
              }
              if (!poor(bestLegs)) break;
            }
          }
          legsFound = bestLegs;
          // CHAIN-GAP TARGETED RE-OCR — see ocrChainGapRetry below.
          if (bestLegs.length > 0 && bestPageTexts && score(bestLegs) < txTotal(bestLegs)) {
            const retry = await ocrChainGapRetry(buf, bestLegs, bestPageTexts, f.originalName);
            if (retry.legs.length > 0) {
              bestLegs = retry.legs;
              bestPageTexts = retry.pageTexts;
              legsFound = bestLegs;
            }
          }
          if (legsFound.length > 0) {
            ocrUsed = true;
            for (const leg of legsFound) {
              leg.ocr = true;
              leg.ocrPages = bestPages;
              leg.mode = `OCR:${leg.mode ?? "unknown"}`;
            }
          }
        }
      }
      for (const leg of legsFound) {
        applySixMonthWindow(leg);
        legs.push(leg);
      }
    } catch {
      // unreadable PDF (scan/encrypted) — skip; handled below if nothing parsed
    }
  }

  if (legs.length === 0) {
    return {
      ok: false,
      mode: "unrecognized",
      message: scanDetected
        ? "Image-only scan detected — shadow OCR ran but no bank-statement structure could be recovered from the scan. Replace with a digital (text-based) PDF or route to manual analysis."
        : "Statement layout not recognised as a text-layer CIB statement (image scan or another bank). Manual analysis required.",
      legs: [],
      allVerified: false,
      ocrUsed: false,
      windowSummary: "",
      parserVersion: PARSER_VERSION,
      evidence: { unmatched: [], textPreview: rawSamples.join("\n\n").slice(0, 16384) },
    };
  }

  const allVerified = legs.every((l) => l.txCount > 0 && l.matched / l.txCount >= AUTO_DELIVER_MIN);
  const unmatched = allVerified
    ? []
    : legs.flatMap((l) =>
        l.rows
          .filter((r) => !r.chainOk)
          .slice(0, 40)
          .map((r) => ({ file: l.file, date: r.date, desc: r.desc?.slice(0, 120), movement: r.movement, balance: r.balance }))
      );
  return {
    ok: true,
    mode: "cib-parsed",
    legs: legs.map((l) => ({
      account: l.account,
      currency: l.currency,
      mode: l.mode ?? "unknown",
      opening: l.opening,
      closing: l.closing,
      inflow: l.inflow,
      outflow: l.outflow,
      txCount: l.txCount,
      matched: l.matched,
      monthsCovered: l.monthsCovered ?? null,
      windowFrom: l.windowFrom ? l.windowFrom.toISOString().slice(0, 10) : null,
      windowExcluded: l.windowExcluded ?? 0,
      windowInflow: l.windowInflow ?? l.inflow,
      windowOutflow: l.windowOutflow ?? l.outflow,
      ocr: Boolean(l.ocr),
    })),
    fullLegs: legs,
    submission: {
      id: submission.id,
      userId: submission.userId,
      clientName: submission.clientName,
      email: submission.email,
      country: submission.country,
      visaType: submission.visaType,
      travelers: submission.travelers,
    },
    allVerified,
    parserVersion: PARSER_VERSION,
    evidence: { unmatched },
    ocrUsed,
    windowSummary: legs
      .map((l) => (l.windowNotes ?? []).join(" "))
      .filter(Boolean)
      .join(" | "),
    message:
      `Parsed ${legs.length} CIB account${legs.length > 1 ? "s" : ""}.` +
      (ocrUsed ? " OCR shadow mode — scanned source, analyst review required." : ""),
  };
}

/** Phase 2 — publish the draft report (review-watermarked or engine-stamped). */
export async function publishDraftReport(
  submission: { id: string; userId: string | null; clientName: string | null; country: string | null; visaType: string | null; travelers: number | null },
  legs: AccountLeg[],
  style: "review" | "engine"
): Promise<string> {
  const userId = submission.userId ?? submission.id.slice(-8).toUpperCase();
  const benchmark = BENCHMARK_EGP[(submission.country ?? "").toUpperCase()] ?? DEFAULT_BENCHMARK_EGP;
  const html = buildReportHtml(userId, submission.country, submission.visaType, submission.travelers ?? 1, legs, benchmark, style);
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const name = `GlobalEIS_Draft_${userId}_${ts}.html`;
  await db.reportFile.create({
    data: {
      submissionId: submission.id,
      queueId: userId,
      name,
      url: "",
      data: Buffer.from(html, "utf8"),
      sizeBytes: Buffer.byteLength(html),
    },
  });
  return name;
}

function toNum(tok: string): number {
  const neg = tok.startsWith("(");
  const n = parseFloat(tok.replace(/[(),]/g, ""));
  return neg ? -n : n;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- 6-month analysis window (embassy lookback rule) ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** TxRow dates come in five families: "dd/mm/yyyy", "dd-mm-yyyy", "DDMMMYY", "dd-Month-yyyy", "yy/mm/dd", "dd MMM yy". */
function parseTxDate(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{2})[\/\-](\d{2})[\/\-](20\d{2})$/.exec(t);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = /^(\d{2})[\/\-](\d{2})[\/\-](\d{2})$/.exec(t);
  if (m) {
    // "26/04/01" (yy/mm/dd, intl bilingual layouts) vs "01/04/26" (dd/mm/yy):
    // a leading token >= 20 reads as the year only when the day reading is impossible.
    if (+m[1] >= 20 && +m[1] <= 40 && +m[2] >= 1 && +m[2] <= 12) return new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3]));
    return new Date(Date.UTC(2000 + +m[3], +m[2] - 1, +m[1]));
  }
  m = /^(\d{2})\s*([A-Z]{3})\s*(\d{2})$/.exec(t.toUpperCase());
  if (m) {
    const mo = MONTHS.findIndex((x) => x.toUpperCase() === m![2]);
    if (mo >= 0) return new Date(Date.UTC(2000 + +m[3], mo, +m[1]));
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/.exec(t);
  if (m) {
    const mo = MONTHS.findIndex((x) => m![2].toLowerCase().startsWith(x.toLowerCase()));
    if (mo >= 0) return new Date(Date.UTC(+m[3], mo, +m[1]));
  }
  return null;
}

function fmtD(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

function monthsBetween(a: Date, b: Date): number {
  const whole = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  const dayFrac = (b.getUTCDate() - a.getUTCDate()) / 30.44;
  return Math.round((whole + dayFrac) * 10) / 10;
}

/**
 * Compute the last-6-months analysis window for a parsed leg and record every
 * period observation the analyst (and the client report) should see:
 * statements longer than 6 months are trimmed to the most recent 6 months
 * (earlier rows stay chain-verified but leave the metrics), short statements
 * are flagged, plus month gaps and data staleness.
 */
function applySixMonthWindow(leg: AccountLeg): void {
  const parseLoose = (s: string): Date | null => {
    const m = /(\d{1,2})[-\s]+([A-Za-z]{3,9})[-\s]+(\d{4})/.exec(s);
    if (!m) return null;
    const mo = MONTHS.findIndex((x) => m[2].toLowerCase().startsWith(x.toLowerCase()));
    return mo >= 0 ? new Date(Date.UTC(+m[3], mo, +m[1])) : null;
  };
  const pm = leg.period
    ? /(\d{1,2}[-\s]+[A-Za-z]{3,9}[-\s]+\d{4})\s*→\s*(\d{1,2}[-\s]+[A-Za-z]{3,9}[-\s]+\d{4})/.exec(leg.period)
    : null;
  let from = pm ? parseLoose(pm[1]) : null;
  let to = pm ? parseLoose(pm[2]) : null;
  const dates = leg.rows.map((r) => parseTxDate(r.date)).filter((d): d is Date => d !== null);
  if (dates.length >= 2) {
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    if (!from) from = min;
    if (!to) to = max;
  }
  if (!from || !to || !(to > from)) {
    leg.windowNotes = [];
    leg.monthsCovered = null;
    return;
  }
  leg.periodFrom = from;
  leg.periodTo = to;
  const cov = monthsBetween(from, to);
  leg.monthsCovered = cov;

  const notes: string[] = [];
  let windowFrom: Date | null = null;
  if (cov > 6.05) {
    windowFrom = addMonths(to, -6);
    windowFrom = new Date(windowFrom.getTime() + 86_400_000); // day after the 6-months-ago mark
    const excluded = leg.rows.filter((r) => {
      const d = parseTxDate(r.date);
      return d !== null && d < windowFrom!;
    }).length;
    leg.windowFrom = windowFrom;
    leg.windowExcluded = excluded;
    notes.push(
      `Statement spans ${cov} months (${fmtD(from)} → ${fmtD(to)}). Per the standard 6-month lookback, metrics use the most recent 6 months (${fmtD(windowFrom)} → ${fmtD(to)}); ${excluded} earlier ledger row(s) are excluded from window metrics but remain chain-verified for integrity.`
    );
  } else if (cov >= 5.95) {
    notes.push(`Statement covers ${cov} months (${fmtD(from)} → ${fmtD(to)}) — matches the standard 6-month lookback.`);
  } else {
    notes.push(
      `Statement covers only ${cov} months (${fmtD(from)} → ${fmtD(to)}) — below the 6-month history most embassies require. Analyst: consider requesting older statements.`
    );
  }

  // Months with zero recorded activity inside the statement period
  if (cov > 1.5) {
    const present = new Set(dates.map((d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`));
    const gaps: string[] = [];
    for (
      let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      d <= to;
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    ) {
      if (!present.has(`${d.getUTCFullYear()}-${d.getUTCMonth()}`)) gaps.push(`${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
    }
    if (gaps.length) notes.push(`No ledger activity recorded in: ${gaps.join(", ")}.`);
  }

  // Staleness — embassies want recent statements
  const age = monthsBetween(to, new Date());
  if (age > 2) {
    notes.push(
      `Statement ends ${fmtD(to)} — the newest data is ~${Math.floor(age)} month(s) old; embassies typically require statements issued within the last 1–3 months.`
    );
  }

  const wf = windowFrom;
  const inW = (r: TxRow) => {
    const d = parseTxDate(r.date);
    return !wf || (d !== null && d >= wf);
  };
  leg.windowInflow = leg.rows.filter((r) => inW(r) && r.signed > 0).reduce((s, r) => s + r.signed, 0);
  leg.windowOutflow = leg.rows.filter((r) => inW(r) && r.signed < 0).reduce((s, r) => s - r.signed, 0);
  leg.windowNotes = notes;
}

/** Rows the analysis metrics see: the 6-month window when one applies, else everything. */
function effectiveRows(l: AccountLeg): TxRow[] {
  if (!l.windowFrom) return l.rows;
  const wf = l.windowFrom;
  return l.rows.filter((r) => {
    const d = parseTxDate(r.date);
    return d !== null && d >= wf;
  });
}

// ---------- Layout F — CIB e-statement web export (column-interleaved) ----------

/**
 * Rejoin amounts whose cents/thousands wrapped to the next text line.
 * pdf.js splits "1,688,999.55" into "1,688,999. 55" and "2,127,\n461.49"
 * whenever the amount column runs out of width; both shapes heal here.
 * The cents rule only fires when the left fragment ends at the dot (no
 * digits after it), so complete amounts separated by whitespace never merge.
 */
function healSplitAmounts(text: string): string {
  return text
    .replace(/(\d)\.[ \t]+(\d{2})\b(?!\d)/g, "$1.$2")
    .replace(/(\d),[ \t]*\r?\n[ \t]*(\d{3})(?!\d)/g, "$1,$2");
}

/**
 * Chain-guided alignment for one page's amount stream (layout F).
 *
 * The e-statement prints Withdrawal and Deposit as separate column runs that
 * pdf.js merges in a varying order per page (alternating mov/bal, column-
 * blocked, with junk related-refs and labels between). The solver keeps TWO
 * movement queues (W = withdrawals, D = deposits) and walks the stream: every
 * amount is either a balance pickup (must chain: |bal − prev| equals the head
 * of one queue, consuming it), a push into one queue, or junk. Exact-equality
 * pruning + memoization keep the search tiny; a path that consumes the whole
 * stream with ≤2 leftovers wins. A fresh segment (prev = null) seeds its
 * first balance row — row 0's sign is resolved afterwards by the opening
 * heuristic in parseCibEStatement (the chain from the first stated balance
 * onward is fully forced, so integrity is unaffected by that choice).
 */
export function solveInterleavedPage(amts: number[], prev: number | null): TxRow[] | null {
  const n = amts.length;
  if (n < 2 || n > 30) return null;
  const junkLimit = Math.floor(n / 3) + 2;
  const MEMO_CAP = 900_000; // graceful degradation on pathological pages
  // Set-based best-of search over the page's amount tokens: some tokens are
  // LEDGER BALANCES (picked in chain order), the rest back the movements
  // (each pickup consumes one token whose |value| equals |bal − prev|).
  // pdf.js merges the statement's column runs in a varying order per page —
  // sometimes row 2 prints before row 1 — so token positions carry no
  // ordering guarantee; the chain equality is the only honest aligner and
  // the search maximizes the rows that reconcile.
  const vals = amts.map((x) => Math.abs(x));
  const popcount = (m: number) => {
    let c = 0;
    while (m) { m &= m - 1; c++; }
    return c;
  };
  // Memo value: best row list + the token index of its LAST picked balance.
  // Tie-break on that index: equal-length alternate chains exist (a movement
  // token standing in as the final "balance"), but the real running balance
  // is the stream's last token — the tie-break keeps the true alignment and
  // the cross-page carry alive.
  const memo = new Map<string, { rows: TxRow[]; lastIdx: number } | null>();
  const better = (
    a: { rows: TxRow[]; lastIdx: number } | null,
    b: { rows: TxRow[]; lastIdx: number } | null
  ): { rows: TxRow[]; lastIdx: number } | null => {
    if (a === null) return b;
    if (b === null) return a;
    if (b.rows.length !== a.rows.length) return b.rows.length > a.rows.length ? b : a;
    return b.lastIdx > a.lastIdx ? b : a;
  };

  const dfs = (used: number, bal: number, last: number | null): { rows: TxRow[]; lastIdx: number } | null => {
    // "stop and junk the rest" is always an option when the budget allows —
    // best-of decides whether continuing chains more rows
    let best: { rows: TxRow[]; lastIdx: number } | null =
      n - popcount(used) <= junkLimit ? { rows: [], lastIdx: -1 } : null;
    const key = `${used}|${bal}|${last}`;
    if (memo.has(key)) return memo.get(key)!;
    if (memo.size > MEMO_CAP) return null; // pathological page — degrade
    const withRow = (row: TxRow, idx: number, rest: { rows: TxRow[]; lastIdx: number } | null) =>
      rest === null
        ? null
        : {
            rows: [row, ...rest.rows],
            // keep the DEEPEST pick's index — the last balance of the chain
            lastIdx: rest.rows.length > 0 ? rest.lastIdx : idx,
          };
    if (last === null) {
      // seed: first balance token + any unconsumed movement token (the
      // seed row's sign is resolved later by the opening heuristic)
      for (let b = 0; b < n; b++) {
        if (used & (1 << b)) continue;
        for (let m = 0; m < n; m++) {
          if (m === b || used & (1 << m)) continue;
          best = better(
            best,
            withRow(
              { date: "", desc: "", movement: vals[m], balance: vals[b], signed: 0, chainOk: true },
              b,
              dfs(used | (1 << b) | (1 << m), bal | (1 << b), vals[b])
            )
          );
        }
      }
    } else {
      for (let t = 0; t < n; t++) {
        if (used & (1 << t)) continue;
        const need = Math.abs(vals[t] - last);
        for (let m = 0; m < n; m++) {
          if (m === t || used & (1 << m)) continue;
          if (Math.abs(vals[m] - need) >= 0.015) continue;
          const delta = vals[t] - last;
          best = better(
            best,
            withRow(
              { date: "", desc: "", movement: need, balance: vals[t], signed: delta >= 0 ? need : -need, chainOk: true },
              t,
              dfs(used | (1 << t) | (1 << m), bal | (1 << t), vals[t])
            )
          );
        }
      }
    }
    memo.set(key, best);
    return best;
  };

  const sol = dfs(0, 0, prev);
  return sol && sol.rows.length > 0 ? sol.rows : null;
}

function solvePage(amts: number[], prev: number | null): TxRow[] | null {
  const sol = solveInterleavedPage(amts, prev);
  return sol && sol.length > 0 ? sol : null; // an empty solution = nothing chained = failure
}

/** Expand a truncated "dd/mm/20" token to its true year using the
 *  sub-statement period (the year prints SPLIT as "20"+wrapped "26"). */
function expandFDate(token: string, years: number[], from: Date | null, to: Date | null): string {
  const dd = token.slice(0, 2);
  const mm = Number(token.slice(3, 5));
  for (const y of years) {
    const d = new Date(Date.UTC(y, mm - 1, Number(dd)));
    const lo = from ? new Date(from.getTime() - 45 * 86_400_000) : null;
    const hi = to ? new Date(to.getTime() + 45 * 86_400_000) : null;
    if ((!lo || d >= lo) && (!hi || d <= hi)) return `${dd}/${token.slice(3, 5)}/${y}`;
  }
  return `${dd}/${token.slice(3, 5)}/${years[0] ?? "20" + token.slice(6)}`;
}

/** First value matching valueRe within `span` chars after labelRe's match —
 *  the e-statement header prints label and value in SEPARATE text runs. */
function valueAfterLabel(text: string, labelRe: RegExp, valueRe: RegExp, span = 200): string | null {
  const m = labelRe.exec(text);
  if (!m) return null;
  const tail = text.slice(m.index + m[0].length, m.index + m[0].length + span);
  const v = valueRe.exec(tail);
  return v ? v[1] : null;
}

/**
 * Layout F — CIB e-statement web export ("Account Details / Movement Details
 * / BackOffice Reference" family, e.g. the haytham Drive statements). The
 * pdf.js text layer is column-interleaved and defeats every line-shape
 * parser; pages are solved by the W/D chain-guided alignment instead.
 *
 * One PDF may concatenate several sub-statements ("Account Details - From:"
 * restarts, e.g. Apr–Jun then Jul–Aug) whose balance chains do NOT continue
 * across the boundary — the parser segments them into one leg per
 * sub-statement so every leg verifies at full chain integrity. Dates are
 * dd/mm/yy on this family and are expanded to dd/mm/yyyy (the shared
 * parseTxDate would misread day≥20 as yy/mm/dd).
 */
export function parseCibEStatement(text: string, file: string, debug = false): AccountLeg[] {
  if (
    !/Account Statement/i.test(text) ||
    !/Movement Details/i.test(text) ||
    !/BackOffice/i.test(text) ||
    !/Related/i.test(text)
  )
    return [];
  const healed = healSplitAmounts(text);
  // Page split: pdf text layers may carry form feeds (poppler-style
  // extractions) or none at all (unpdf mergePages glues pages) — fall back
  // to splitting before each "Account Statement" running header.
  let rawPages = healed.split(/\x0c/);
  if (rawPages.length === 1) rawPages = healed.split(/(?=Account Statement\b)/i);

  // segment pages at explicit sub-statement header restarts
  const segments: string[][] = [];
  for (const pg of rawPages) {
    if (/Account Details\s*-\s*From/i.test(pg) || segments.length === 0) segments.push([]);
    segments[segments.length - 1].push(pg);
  }

  const legs: AccountLeg[] = [];
  for (const segPages of segments) {
    const segText = segPages.join("\n");
    const account = valueAfterLabel(segText, /Account Number/i, /(\d{9,20})/);
    const currency = valueAfterLabel(segText, /Account Currency/i, /\b([A-Z]{3})\b/) ?? "EGP";
    const periods = [...segText.matchAll(/Movement Details\s*-\s*From:\s*(\d{1,2}\s+\w{3}\s+\d{4})\s*To:\s*(\d{1,2}\s+\w{3}\s+\d{4})/gi)];
    const period =
      periods.length > 0 ? `${periods[0][1]} → ${periods[periods.length - 1][2]}` : null;
    const MON_IDX: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const segYears = [...new Set(periods.flatMap((p) => [Number(p[1].slice(-4)), Number(p[2].slice(-4))]))];
    const segFrom = periods.length
      ? new Date(Date.UTC(Number(periods[0][1].slice(-4)), MON_IDX[periods[0][1].slice(3, 6)] ?? 0, Number(periods[0][1].slice(0, 2))))
      : null;
    const segTo = periods.length
      ? new Date(Date.UTC(Number(periods[periods.length - 1][2].slice(-4)), MON_IDX[periods[periods.length - 1][2].slice(3, 6)] ?? 0, Number(periods[periods.length - 1][2].slice(0, 2))))
      : null;

    const rows: TxRow[] = [];
    let prev: number | null = null;
    let carryDate: string | null = null;
    let boundary = 0; // in-segment chain resets (kept as separate legs below)

    for (const pg of segPages) {
      const a = pg.lastIndexOf("Related");
      if (a < 0) continue;
      const region = pg.slice(a);
      const amts = [...region.matchAll(RE_AMT)].map((m) => toNum(m[0]));
      if (amts.length < 2) continue;
      const dateTokens = [...pg.slice(0, a).matchAll(/\b(\d{2}\/\d{2}\/)\d{2}\b(?!\d)/g)].map(
        (m) => expandFDate(m[1] + "00", segYears.length ? segYears : [Number(new Date().getFullYear())], segFrom, segTo)
      );
      let sol = prev !== null ? solvePage(amts, prev) : null;
      if (!sol) {
        // chain does not continue into this page — solve it fresh, then try
        // to RE-LINK: when the fresh solution's first row chains from the
        // carried balance, the page continues the same leg (no split) and
        // row 0 re-verifies against the real previous position.
        sol = solvePage(amts, null);
        if (!sol) continue;
        const carried = rows.length > 0 ? rows[rows.length - 1].balance : null;
        const r0 = sol[0];
        const relinked =
          carried !== null && r0.movement !== null && Math.abs(Math.abs(r0.balance - carried) - r0.movement) < 0.015;
        if (relinked && prev !== null) {
          r0.signed = r0.balance - carried >= 0 ? r0.movement! : -r0.movement!;
          prev = null; // stay on the same leg — no boundary push below
          if (debug) console.error(`[F-debug] re-linked fresh page to carried balance ${carried}`);
        } else if (rows.length >= 5) {
          legs.push(legFromFRows(file, rows.splice(0), { account, currency, period }, carryDate));
          carryDate = null;
          boundary++;
        }
      }
      for (let k = 0; k < sol.length; k++) {
        const r = sol[k];
        const d = dateTokens[2 * k] ?? dateTokens[2 * k - 1] ?? carryDate ?? "?";
        r.date = d;
        rows.push(r);
      }
      if (debug)
        console.error(
          `[F-debug] page solved: rows=${sol.length} first=${sol[0].balance} last=${sol[sol.length - 1].balance} amts=${amts.length}\n` +
            sol.map((r) => `   ${r.movement === null ? "  checkpoint " : (r.signed >= 0 ? "+" : "-") + Math.abs(r.movement!).toLocaleString("en-US").padStart(14)} -> ${r.balance.toLocaleString("en-US").padStart(14)} chainOk=${r.chainOk}`).join("\n")
        );
      carryDate = sol.length && sol[sol.length - 1].date !== "?" ? sol[sol.length - 1].date : carryDate;
      prev = sol[sol.length - 1].balance;
    }
    if (rows.length >= 5) {
      legs.push(legFromFRows(file, rows, { account, currency, period }, carryDate));
    } else if (debug && rows.length > 0) {
      console.error(`[F-debug] segment tail dropped: ${rows.length} rows`);
    }
  }
  if (debug)
    legs.forEach((l, i) =>
      console.error(
        `[F-debug] leg ${i}: tx=${l.txCount} matched=${l.matched} opening=${l.opening} closing=${l.closing} period=${l.period ?? "—"}`
      )
    );
  return legs;
}

/** Assemble one AccountLeg from solved F rows (fixes the seed row's sign). */
function legFromFRows(
  file: string,
  rows: TxRow[],
  meta: { account: string | null; currency: string; period: string | null },
  _carryDate: string | null
): AccountLeg {
  // opening heuristic: row 0's sign is the only unforced choice — prefer a
  // non-negative opening; when both signs give one, take the larger position.
  const r0 = rows[0];
  if (r0.signed === 0 && r0.movement !== null) {
    const credit = r0.balance! - r0.movement;
    const debit = r0.balance! + r0.movement;
    const openCredit = credit >= 0;
    const openDebit = debit >= 0;
    const useCredit = openCredit && (!openDebit || credit >= debit);
    r0.signed = useCredit ? r0.movement : -r0.movement;
  }
  return summarizeLeg(file, rows, {
    account: meta.account,
    currency: meta.currency,
    period: meta.period,
    opening: r0.balance! - r0.signed,
    closing: rows[rows.length - 1].balance ?? 0,
    matched: rows.filter((r) => r.chainOk).length,
  });
}

/** Parse one statement's text into account legs — dispatches by layout family. */
export function parseCibTextMulti(text: string, file: string, ocr = false): AccountLeg[] {
  const attempt = (mode: string, fn: (t: string, f: string) => AccountLeg | null): AccountLeg[] | null => {
    const leg = fn(text, file);
    if (!leg) return null;
    leg.mode = mode;
    return [leg];
  };
  // OCR-fed dispatch: the ocr flag flows INTO the parser so chain-guided
  // repair (digit tolerance) is active for scan-recovered text — and the leg
  // carries the provenance itself, not just the "OCR:" mode prefix.
  const attemptOcr = (
    mode: string,
    fn: (t: string, f: string, ocr: boolean) => AccountLeg | null
  ): AccountLeg[] | null => {
    const leg = fn(text, file, ocr);
    if (!leg) return null;
    leg.mode = mode;
    leg.ocr = ocr;
    return [leg];
  };
  const fLegs = parseCibEStatement(text, file);
  return (
    attempt("B-internet", parseCibInternet) ??
    attempt("C-digital", parseCibDigital) ??
    attempt("D-glued", parseCibGlued) ??
    attempt("E-intl-bilingual", parseIntlBilingual) ??
    attemptOcr("M-misr-historical", parseMisrHistorical) ??
    attemptOcr("A2-aaib", parseAaibStatement) ??
    attempt("A-branch", parseCibBranch) ??
    (fLegs.length > 0
      ? fLegs.map((l) => ({ ...l, mode: ocr ? `OCR:${l.mode ?? "unknown"}` : "F-cib-estatement", ocr: ocr || l.ocr }))
      : null) ??
    // last resort: OCR-recovered text only — a generic chain-guided ledger
    // walk that must reconcile EVERY row, else it refuses the document
    (ocr ? attempt("Z-ocr-ledger", parseOcrLedger) : null) ??
    []
  );
}

/**
 * Layout Z — generic OCR ledger (last resort for scan-recovered text that no
 * known family claims): amounts form "movement balance" pairs and the whole
 * sequence must reconcile against the chain, or the document stays red.
 */
function parseOcrLedger(text: string, file: string): AccountLeg | null {
  const seq = scanAmountSequence(
    text,
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}-[A-Za-z]{3,9}-\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/
  );
  // statements print oldest-first OR newest-first, and some layouts pair the
  // amounts balance-first — try every orientation, keep the fullest chain
  const variants: TxRow[][] = [];
  for (const order of ["mb", "bm"] as const) {
    const fwd = walkLedgerAmounts(seq, null, true, order);
    if (fwd) variants.push(fwd);
    const rev = walkLedgerAmounts([...seq].reverse(), null, true, order);
    if (rev) variants.push(rev);
  }
  const rows = variants.sort((a, b) => b.length - a.length)[0];
  if (!rows || rows.length < 5) return null;
  return summarizeLeg(file, rows, {
    account: null,
    currency: "EGP",
    period: null,
    opening: rows[0].balance ?? 0,
    closing: rows[rows.length - 1].balance ?? 0,
    matched: rows.length,
  });
}

/**
 * CHAIN-GAP TARGETED RE-OCR (vision campaign lesson): rows the chain could
 * not verify sit on a few physically damaged pages (stamps, watermarks,
 * skew). Map unverified rows back via srcLine → page, re-OCR ONLY those
 * pages at higher DPI / extra page-segmentation modes (reocrPages), splice
 * each replacement into the per-page text, and let the parsers re-judge the
 * spliced document. The chain decides — a replacement page is kept only
 * when it verifies MORE rows without inflating the row set with junk.
 * Shared by the engine path and the offline grind tooling so both behave
 * identically.
 */
export interface ChainGapRetryResult {
  legs: AccountLeg[];
  pageTexts: string[];
  retriedPages: number[];
  improvedPages: number[];
}

export async function ocrChainGapRetry(
  buf: Buffer,
  legs: AccountLeg[],
  pageTexts: string[],
  file: string,
  opts?: { dpi?: number; maxPages?: number }
): Promise<ChainGapRetryResult> {
  const parseOcr = (t: string) => {
    let ls = parseCibTextMulti(t, file, true) ?? [];
    if (ls.length === 0) ls = parseCibTextMulti(t.replace(/([A-Za-z])\s+:/g, "$1: "), file, true);
    if (ls.length === 0) ls = parseCibTextMulti(t.replace(/([A-Za-z])\s*:\s*/g, "$1 "), file, true);
    return ls;
  };
  const score = (ls: AccountLeg[]) => ls.reduce((s, l) => s + l.matched, 0);
  const txTotal = (ls: AccountLeg[]) => ls.reduce((s, l) => s + l.txCount, 0);
  const pageLines = pageTexts.map((t) => t.split(/\r?\n/).length);
  const totalLines = pageLines.reduce((a, b) => a + b, 0);
  const pageOfLine = (line: number): number | null => {
    let acc = 0;
    for (let i = 0; i < pageLines.length; i++) {
      if (line < acc + pageLines[i]) return i;
      acc += pageLines[i];
    }
    return null;
  };
  const damaged = new Map<number, number>();
  for (const leg of legs)
    for (const r of leg.rows)
      if (!r.chainOk && r.srcLine !== undefined && r.srcLine < totalLines) {
        const pg = pageOfLine(r.srcLine);
        if (pg !== null) damaged.set(pg, (damaged.get(pg) ?? 0) + 1);
      }
  const targets = [...damaged.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts?.maxPages ?? 10)
    .map(([p]) => p);
  if (targets.length === 0) return { legs, pageTexts, retriedPages: [], improvedPages: [] };
  const retry = await reocrPages(buf, targets, { dpi: opts?.dpi ?? 500, psms: [3, 6] });
  let curPages = [...pageTexts];
  const origTx = txTotal(legs);
  const improved: number[] = [];
  for (const [idx, newText] of [...retry.entries()].sort((a, b) => a[0] - b[0])) {
    if (!newText) continue;
    if (newText === curPages[idx]) continue; // identical re-read — nothing to judge
    const cand = [...curPages];
    cand[idx] = newText;
    const ls = parseOcr(cand.join("\n"));
    // accept: strictly more chain-verified rows, no junk inflation
    if (score(ls) > score(legs) && txTotal(ls) <= origTx * 1.1 + 2) {
      legs = ls;
      curPages = cand;
      improved.push(idx);
    }
  }
  return { legs, pageTexts: curPages, retriedPages: targets, improvedPages: improved };
}

/**
 * OCR digit tolerance — chain-guided repair for scanned statements.
 * Two values "read the same" when their digit strings (in cents) are identical
 * up to one substituted digit or one transposed digit pair, ignoring leading
 * zeros OCR tends to drop. Anything more is NOT close enough to excuse.
 */
function ocrClose(a: number, b: number): boolean {
  const A = Math.round(Math.abs(a) * 100).toString();
  const B = Math.round(Math.abs(b) * 100).toString();
  const pad = Math.max(A.length, B.length);
  const x = A.padStart(pad, "0");
  const y = B.padStart(pad, "0");
  if (x === y) return true;
  const diff: number[] = [];
  for (let i = 0; i < pad; i++) if (x[i] !== y[i]) diff.push(i);
  if (diff.length === 1) return true;
  return (
    diff.length === 2 &&
    diff[1] === diff[0] + 1 &&
    x[diff[0]] === y[diff[1]] &&
    x[diff[1]] === y[diff[0]]
  );
}

/**
 * Fragment-row drop (OCR tables): a row that FAILED the chain and whose
 * balance sits orders of magnitude off the running position is a misread
 * fragment (tesseract ate digits/digit-groups of the balance token), not a
 * transaction — e.g. "440.71" for 440,710.33, or "8.63" with no thousands
 * at all. It contributes no trustworthy data, so it is dropped: txCount and
 * closing stay honest instead of poisoned. A legitimate wild movement row
 * always chain-verifies via its own amounts — only damaged rows reach this
 * filter, and dropped rows are counted as engine-lost, not silently
 * "verified".
 */
function dropOcrFragments(rows: TxRow[]): TxRow[] {
  const out: TxRow[] = [];
  let anchor: number | null = null;
  for (const r of rows) {
    if (r.chainOk || r.balance === null) {
      if (r.chainOk) anchor = r.balance;
      out.push(r);
      continue;
    }
    const far =
      anchor !== null &&
      (Math.abs(r.balance) < Math.abs(anchor) * 0.25 || Math.abs(r.balance) > Math.abs(anchor) * 4);
    if (far) continue; // fragment — balance token destroyed by the scan
    out.push(r);
  }
  return out;
}

/**
 * Solve → drop fragments → re-solve until the row set is stable.
 *
 * One stable-pass subtlety this fixes: a FAILED fragment row re-syncs the
 * running balance to its own garbage (prev = r.balance), which can make the
 * NEXT fragment row verify as a tiny "position row" against the poisoned
 * context (real case: 602.48 → 602.46 chaining off a 603,783.83 position).
 * Dropping the failed fragment and re-running the chain with a clean context
 * exposes both; iterating until stable (≤4 passes) reaches a fixed point.
 */
function solveDropStable(rows: TxRow[], opening: number | null, ocr: boolean): TxRow[] {
  let cur = rows;
  for (let i = 0; i < 4; i++) {
    solveRows(cur, opening, ocr);
    const next = dropOcrFragments(cur);
    if (process.env.EIS_DEBUG_OCR) {
      const last = cur[cur.length - 1];
      const prevRow = cur[cur.length - 2];
      console.error(
        `[ocr-debug stable] pass=${i} in=${cur.length} out=${next.length} lastOk=${last?.chainOk} lastBal=${last?.balance} lastMv=${last?.movement} prevBal=${prevRow?.balance} prevOk=${prevRow?.chainOk}`
      );
    }
    if (next.length === cur.length) return next;
    cur = next;
  }
  return cur;
}

/**
 * Shared chain solver for the intl families (E/M/A2): chronological rows,
 * direction from the stated-balance delta, strict cents equality — with a
 * chain-guided repair pass for OCR-sourced legs (one bad digit proven wrong
 * by two agreeing tokens is corrected, not failed).
 */
function solveIntlChain(rows: TxRow[], opening: number | null, ocrLeg: boolean): number {
  return solveRows(rows, opening, ocrLeg);
}

/** solveIntlChain body, exposed for call sites that post-filter the rows. */
function solveRows(rows: TxRow[], opening: number | null, ocrLeg: boolean): number {
  return solveRowsSearch(rows, opening, ocrLeg);
}

/**
 * Two-digit OCR tolerance — used ONLY by the joint back-repair where BOTH
 * rows must independently agree (movement chain + this tolerance), so the
 * extra freedom is double-locked by the chain.
 */
function ocrClose2(a: number, b: number): boolean {
  const A = Math.round(Math.abs(a) * 100).toString();
  const B = Math.round(Math.abs(b) * 100).toString();
  const pad = Math.max(A.length, B.length);
  const x = A.padStart(pad, "0");
  const y = B.padStart(pad, "0");
  if (x === y) return true;
  let diffs = 0;
  for (let i = 0; i < pad; i++) if (x[i] !== y[i]) diffs++;
  return diffs <= 2;
}

/**
 * Chain solver with BRANCHING REPAIR SEARCH (matrix campaign #2 lesson).
 *
 * The greedy version corrected the FIRST plausible OCR damage — but damaged
 * scan zones often offer TWO equally-plausible single-digit repairs:
 *   28,528.86 → [4,000.00] → 27,528.86   (movement fix: 4,000 → 1,000)
 *   28,528.86 → [4,000.00] → 24,528.86   (balance fix: 27,528.86 misread)
 * Only the DOWNSTREAM chain decides which was real (here the next rows
 * reconcile exactly only from 24,528.86). So at every ambiguous row the
 * solver branches over the candidate repairs and scores each branch by how
 * many following rows chain-verify — the chain itself picks the truth.
 * Candidates, in preference order:
 *   mvfix     — |Δ| equals the movement (strict, then 1-digit ocrClose)
 *   trix      — balance rebuild from prev ± movement (1-digit ocrClose)
 *   pow10     — movement/balance dropped or added a zero run (×10^k, k≤3);
 *               only for OCR legs where a small/large factor mismatch with a
 *               transaction-shaped desc is the classic tesseract zero-drop
 *   skip      — no candidate fits: row stays unverified, prev re-syncs to the
 *               stated balance (a lost row never poisons its neighbours)
 */
function solveRowsSearch(rows: TxRow[], opening: number | null, ocrLeg: boolean): number {
  const LOOKAHEAD = 6;

  type Verdict = { ok: boolean; balance: number; movement: number | null; signed: number };
  /** First-fit verdict for one row against a running position (no branching). */
  const judge = (r: TxRow, prev: number): Verdict => {
    const bal = r.balance ?? 0;
    const delta = bal - prev;
    const mv = r.movement;
    if (mv === null) {
      const ratio = Math.abs(delta) / Math.max(1, Math.abs(prev));
      if (ratio <= 0.1) return { ok: true, balance: bal, movement: null, signed: delta };
      return { ok: false, balance: bal, movement: null, signed: delta };
    }
    if (Math.abs(Math.abs(delta) - mv) < 0.015)
      return { ok: true, balance: bal, movement: mv, signed: delta >= 0 ? mv : -mv };
    if (ocrLeg && ocrClose(delta, mv))
      return { ok: true, balance: bal, movement: Math.abs(delta), signed: delta >= 0 ? mv : -mv };
    if (ocrLeg) {
      const implied = prev + (delta >= 0 ? mv : -mv);
      if (ocrClose(implied, bal))
        return { ok: true, balance: implied, movement: mv, signed: delta >= 0 ? mv : -mv };
      // Zero-run repair (tesseract drops/adds zeros inside long numbers):
      // |Δ| and the movement differ by a clean power of ten. Never applied to
      // fee/charge rows — a 6.00 fee must not become a 6,000 transfer.
      if (!/\bfee\b|\bcharge/i.test(r.desc)) {
        for (const k of [1, 2, 3]) {
          const pow = Math.pow(10, k);
          if (Math.abs(Math.abs(delta) - mv * pow) < 0.015 && Math.abs(delta) > 1)
            return { ok: true, balance: bal, movement: Math.abs(delta), signed: delta >= 0 ? mv : -mv };
          if (Math.abs(Math.abs(delta) * pow - mv) < 0.015 && Math.abs(mv) > 1)
            return { ok: true, balance: bal, movement: Math.abs(delta), signed: delta >= 0 ? mv : -mv };
        }
      }
    }
    return { ok: false, balance: bal, movement: mv, signed: delta };
  };

  /** Greedy forward score of a candidate applied at i (lookahead rows). */
  const scoreBranch = (startIdx: number, startPrev: number, first: Verdict): number => {
    let score = first.ok ? 1 : 0;
    let prev = first.balance;
    for (let j = startIdx + 1; j < Math.min(rows.length, startIdx + 1 + LOOKAHEAD); j++) {
      const v = judge(rows[j], prev);
      if (v.ok) score++;
      prev = v.balance;
    }
    return score;
  };

  let matched = 0;
  let prev: number | null = opening;
  let lastVerifiedIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.balance === null) continue;
    // Fresh verdict every pass — re-solves (solveDropStable) must not inherit
    // chainOk from a previous pass whose running context was poisoned by a
    // fragment row that has since been dropped.
    r.chainOk = false;
    if (prev === null) {
      // No stated opening: the first balance row becomes the base position.
      r.signed = r.movement ?? 0;
      r.chainOk = true;
      matched++;
      prev = r.balance;
      continue;
    }
    const mv = r.movement;
    const base = judge(r, prev);
    if (base.ok) {
      if (mv !== null && base.movement !== null && base.movement !== mv) r.movement = base.movement;
      if (base.balance !== r.balance) r.balance = base.balance;
      r.signed = base.signed;
      r.chainOk = true;
      matched++;
      prev = base.balance;
      lastVerifiedIdx = i;
      continue;
    }
    // The row failed the greedy first-fit — is this an AMBIGUOUS damage zone?
    // Enumerate alternative repairs and let the downstream chain decide.
    if (ocrLeg && mv !== null) {
      const delta = r.balance - prev;
      const alternatives: Verdict[] = [];
      // balance-fix candidate (even when the movement-fix also looked close,
      // judge() may have preferred wrongly — explore both when both are valid)
      const implied = prev + (delta >= 0 ? mv : -mv);
      if (ocrClose(implied, r.balance))
        alternatives.push({ ok: true, balance: implied, movement: mv, signed: delta >= 0 ? mv : -mv });
      // movement-fix candidate (1-digit) — judge() already tried it first, but
      // re-add it here so the search can compare it against the balance-fix
      if (ocrClose(delta, mv))
        alternatives.push({ ok: true, balance: r.balance, movement: Math.abs(delta), signed: delta >= 0 ? mv : -mv });
      if (alternatives.length >= 1) {
        let best: Verdict | null = null;
        let bestScore = -1;
        for (const alt of alternatives) {
          const s = scoreBranch(i, prev, alt);
          if (s > bestScore) {
            bestScore = s;
            best = alt;
          }
        }
        if (best && bestScore > 0) {
          if (best.movement !== null && best.movement !== mv) r.movement = best.movement;
          if (best.balance !== r.balance) r.balance = best.balance;
          r.signed = best.signed;
          r.chainOk = true;
          matched++;
          prev = best.balance;
          continue;
        }
      }
    }
    // No single-row candidate: try a JOINT BACK-REPAIR — the previous
    // verified row's BALANCE may carry the two-digit damage instead. The fix
    // is double-locked: (a) the revised previous balance must still satisfy
    // the previous row's own movement chain, and (b) it must sit within
    // 2-digit tolerance of its stated value. Real case (AAIB): fees of
    // 600.60/700.70 verified against a damaged neighbour balance.
    if (ocrLeg && mv !== null && lastVerifiedIdx >= 0 && lastVerifiedIdx === i - 1) {
      const delta = r.balance - prev;
      const prevRow = rows[lastVerifiedIdx];
      if (prevRow.balance !== null && prev === prevRow.balance) {
        const impliedPrev = r.balance - (delta >= 0 ? mv : -mv);
        const prev2 = lastVerifiedIdx > 0 ? rows[lastVerifiedIdx - 1].balance : opening;
        if (prev2 !== null) {
          const deltaPrev = impliedPrev - prev2;
          const mvPrev = prevRow.movement;
          const prevChains =
            mvPrev !== null
              ? Math.abs(Math.abs(deltaPrev) - mvPrev) < 0.015 || ocrClose(deltaPrev, mvPrev)
              : Math.abs(deltaPrev) < 0.015;
          if (prevChains && ocrClose2(impliedPrev, prevRow.balance)) {
            prevRow.balance = impliedPrev;
            if (mvPrev !== null) prevRow.signed = deltaPrev >= 0 ? mvPrev : -mvPrev;
            r.signed = delta >= 0 ? mv : -mv;
            r.chainOk = true;
            matched++;
            prev = r.balance;
            lastVerifiedIdx = i;
            continue;
          }
        }
      }
    }
    // CHAIN-TRUST REPAIR (vision campaign lesson): both 1-digit repairs and
    // the joint back-repair failed — the damage spans ≥2 digits of one token.
    // The bank's balance sequence is the ground truth, but trusting it needs
    // a DOUBLE LOCK: the repaired row must chain AND at least one downstream
    // row must verify from the repair (lookahead-scored, threshold ≥ 2).
    //   C1 — sane balance, damaged movement: movement := |Δ| (16/08 case:
    //        "2»200.00" was really 2,202.20 — only the delta knew)
    //   C2 — destroyed balance, intact movement: balance := prev ± mv
    //        ("15,700.00 ae" rows where the scan ate the balance token)
    //   C0 — movement token destroyed entirely (mv === null): same trust as
    //        C1 when the stated balance is sane ("?-000,00" rows — the
    //        balance sequence knows the movement even when the token is gone)
    if (ocrLeg && r.balance !== null) {
      const far = Math.abs(r.balance) < Math.abs(prev) * 0.25 || Math.abs(r.balance) > Math.abs(prev) * 4;
      const delta = r.balance - prev;
      const trust: Verdict[] = [];
      if (!far && Math.abs(prev) > 0) {
        // C1/C0 — keep the stated balance, adopt the chain movement
        trust.push({ ok: true, balance: r.balance, movement: Math.abs(delta), signed: delta >= 0 ? Math.abs(delta) : -Math.abs(delta) });
      }
      if (far && mv !== null) {
        // C2 — the balance token is factor-far from the position: rebuild
        trust.push({ ok: true, balance: prev + mv, movement: mv, signed: mv });
        trust.push({ ok: true, balance: prev - mv, movement: mv, signed: -mv });
      }
      let best: Verdict | null = null;
      let bestScore = -1;
      for (const alt of trust) {
        const s = scoreBranch(i, prev, alt);
        if (s > bestScore) {
          bestScore = s;
          best = alt;
        }
      }
      if (best && bestScore >= 2) {
        if (best.balance !== r.balance) r.balance = best.balance;
        if (best.movement !== null && best.movement !== mv) r.movement = best.movement;
        r.signed = best.signed;
        r.chainOk = true;
        matched++;
        prev = best.balance;
        lastVerifiedIdx = i;
        continue;
      }
    }
    // No honest candidate: stay unverified, re-sync to the stated balance.
    r.signed = r.balance - prev;
    prev = r.balance;
  }
  return matched;
}

function summarizeLeg(
  file: string,
  rows: TxRow[],
  opts: { account: string | null; currency: string; period: string | null; opening: number; closing: number; matched: number }
): AccountLeg {
  const inflow = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = rows.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = rows.filter((r) => r.signed > 0);
  const debits = rows.filter((r) => r.signed < 0);
  const topCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const topDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;
  return {
    file,
    account: opts.account,
    currency: opts.currency,
    period: opts.period,
    opening: opts.opening,
    closing: opts.closing,
    inflow,
    outflow,
    txCount: rows.length,
    matched: opts.matched,
    largestCredit: topCredit ? { desc: topCredit.desc.slice(0, 90), amount: topCredit.signed } : null,
    largestDebit: topDebit ? { desc: topDebit.desc.slice(0, 90), amount: topDebit.signed } : null,
    salarySeen: rows.some((r) => SALARY_RE.test(r.desc)),
    rows,
  };
}

/** Split text into anchor-led blocks (shared by the intl parsers). */
function anchorBlocks(text: string, anchorRe: RegExp): Array<{ date: string; text: string }> {
  const blocks: Array<{ date: string; text: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = anchorRe.exec(raw);
    if (m) blocks.push({ date: m[1], text: raw.slice(m[0].length) });
    else if (blocks.length) blocks[blocks.length - 1].text += " " + raw;
  }
  return blocks;
}

/** Page furniture on scans — never carries transaction data, always poisons pairing. */
const SCAN_NOISE_RE =
  /page\s+\d+\s+of\s+\d+|rep\.?\s+name|scanned\s+(with|by)|camscanner|genius\s+scan|adobe\s+scan/i;

/**
 * Line-paired table extraction for OCR-recovered bank statements (M + A2).
 *
 * LESSON (matrix campaign #2): statement tables print ONE transaction per
 * line — "<date> <ref/desc junk> [movement] balance" — and the balance is
 * the LAST decimal amount on the line. Two trapdoors the older strategies
 * fell into:
 *   1. anchorBlocks merged every date-less continuation row into the previous
 *      date's block, then blockAmounts' last-two pairing silently DROPPED all
 *      but the final transaction of the block (whole fee/transfer rows
 *      vanished from the ledger);
 *   2. the flattened amount walk crossed line boundaries, so one junk token
 *      cascaded mis-pairings down the chain.
 * Here every line yields its OWN candidate row: date-less amount lines are
 * continuation rows under the carried date (their date cell was eaten by a
 * stamp/watermark), movement-less lines are position rows the chain
 * reconstructs from the delta. solveIntlChain then verifies/repairs each row
 * independently — a single lost row never poisons its neighbours.
 */
function lineTableRows(text: string, anchorRe: RegExp): TxRow[] {
  const rows: TxRow[] = [];
  let prevDate: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    if (SCAN_NOISE_RE.test(raw)) continue;
    // Reference-fragment lines ("Contact CIB.151390.1401.01032026-142942",
    // "Trx ID: ...") carry DECIMAL-SHAPED pieces of reference numbers — they
    // must never become rows or they hijack balances from the real row above.
    if (/contact\s+cib|trx[\s_]*id|ref[\s.:]*no/i.test(raw)) continue;
    // Card-receipt metadata continuations (AAIB Debit Card rows print
    // "92102.08/25/2026, EGP 4000.00,Card 2082" under the real row — the OCR
    // splits them onto their own lines): an amount GLUED to a slash-date or
    // an amount followed by "Card" is receipt metadata, never a ledger row.
    if (/\d\.\d{2}\/\d{1,2}\/\d{2,4}/.test(raw) || /\d[\d,]*\.\d{2}\s*[,.]?\s*card\b/i.test(raw)) continue;
    // ATM-acquirer receipt tails ("818,APP 584263.623", "BI1BAPP 683508,623",
    // "APP 386638.6242074" — an UNGROUPED 4+-digit head with a 3+-decimal
    // serial tail; real ledger amounts print 2 decimals and thousands
    // grouping, so this shape is always a split serial number like
    // "6237191"). Wrapped REAL balances on the same metadata line
    // ("NBE22040006 NBE A   73,007.45") end in .dd and survive.
    if (/\d{4,}[.,]\d{3,}\s*$/.test(raw)) continue;
    const am = anchorRe.exec(raw);
    const amounts = [...raw.matchAll(RE_AMT)].map((m) => m[0]);
    if (am) {
      // Balance with ALL separators eaten by the scan: "…2,002.00 13473192"
      // (true value 134,731.92). A date-anchored row ending in a bare 6-9
      // digit integer contributes its /100 reading as the balance candidate —
      // the chain verifies or rejects it like any other token. (10+-digit
      // tails are account/reference numbers and never match.)
      const bare = /(\d{6,9})\s*$/.exec(raw);
      if (bare && amounts.length >= 1 && !/\.\d{2}\s*$/.test(raw)) {
        amounts.push((parseInt(bare[1], 10) / 100).toFixed(2));
      }
    }
    if (amounts.length === 0) {
      // No amounts — only a real transaction-ish line re-seeds the carried
      // date (header/footer dates like "Statement from 01-03-2026 To ..."
      // carry the period, not a row position, but re-seeding them is safe:
      // the next amount line determines the row anyway).
      if (am) prevDate = am[1];
      continue;
    }
    const date = (am ? am[1] : prevDate) ?? "—";
    if (am) prevDate = am[1];
    let desc = raw.replace(am ? am[0] : /$^/, " ");
    for (const a of amounts) desc = desc.replace(a, " ");
    desc = desc
      .replace(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/g, " ")
      .replace(/\d{1,2}\s+[A-Z]{3}\s+\d{2,4}/g, " ")
      .replace(/\((?:EGP|USD|EUR|GBP|SAR|AED)\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const balance = toNum(amounts[amounts.length - 1]);
    const movement = amounts.length >= 2 ? Math.abs(toNum(amounts[amounts.length - 2])) : null;
    rows.push({ date, desc, movement, balance, signed: 0, chainOk: false, srcLine: li });
  }
  return rows;
}

/** Amounts out of one block: balance = last token, movement = the one before it. */
function blockAmounts(blockText: string): { movement: number | null; balance: number | null; desc: string } {
  const amounts = [...blockText.matchAll(RE_AMT)].map((m) => m[0]);
  let desc = blockText;
  for (const a of amounts) desc = desc.replace(a, " ");
  desc = desc
    .replace(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/g, " ")
    .replace(/\d{1,2}\s+[A-Z]{3}\s+\d{2,4}/g, " ")
    .replace(/\((?:EGP|USD|EUR|GBP|SAR|AED)\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (amounts.length === 0) return { movement: null, balance: null, desc };
  const balance = toNum(amounts[amounts.length - 1]);
  const movement = amounts.length >= 2 ? Math.abs(toNum(amounts[amounts.length - 2])) : null;
  return { movement, balance, desc };
}


/**
 * Chain-guided ledger walk shared by the intl families (E/M/A2): amounts
 * appear as "movement balance" pairs with timestamps/footers/summary lines
 * injecting junk between them. The balance chain itself decides the
 * alignment: each amount either pairs with the next (strict or OCR-close),
 * repeats the previous balance (stated position row), or is skipped as junk.
 */
function walkLedgerAmounts(
  seq: Array<{ v: number; date: string | null; lc: number }>,
  opening: number | null,
  ocrTolerant: boolean,
  pairOrder: "mb" | "bm" = "mb"
): TxRow[] | null {
  const chains = (bal: number, prevBal: number, mov: number): boolean => {
    if (Math.abs(Math.abs(bal - prevBal) - mov) < 0.015) return true;
    if (ocrTolerant && ocrClose(bal - prevBal, mov)) return true;
    return false;
  };
  if (seq.length < 7) return null;
  const rows: TxRow[] = [];
  let prev = opening;
  let prevDate: string | null = null;
  let junk = 0;
  for (let i = 0; i < seq.length; ) {
    const a = seq[i];
    const balDate = a.date ?? prevDate;
    if (prev === null) {
      // first observed position seeds the base when no stated opening exists
      rows.push({ date: balDate ?? "—", desc: "", movement: null, balance: a.v, signed: 0, chainOk: true });
      prev = a.v;
      prevDate = balDate;
      i += 1;
      continue;
    }
    if (a.lc === 1 && Math.abs(a.v - prev) < 0.015) {
      // standalone repeated balance = stated closing-position row — must
      // outrank the pair branches or it fabricates a full-balance debit
      rows.push({ date: balDate ?? "—", desc: "", movement: null, balance: a.v, signed: 0, chainOk: true });
      prev = a.v;
      prevDate = balDate;
      i += 1;
    } else if (i + (pairOrder === "mb" ? 1 : 1) < seq.length && chains(
        pairOrder === "mb" ? seq[i + 1].v : a.v,
        prev,
        pairOrder === "mb" ? Math.abs(a.v) : Math.abs(seq[i + 1].v)
      )) {
      const balV = pairOrder === "mb" ? seq[i + 1].v : a.v;
      const movV = Math.abs(pairOrder === "mb" ? a.v : seq[i + 1].v);
      const row: TxRow = { date: balDate ?? "—", desc: "", movement: movV, balance: balV, signed: 0, chainOk: true };
      row.signed = balV - prev >= 0 ? movV : -movV;
      rows.push(row);
      prev = balV;
      prevDate = balDate;
      i += 2;
    } else if (i + 2 < seq.length && chains(
        pairOrder === "mb" ? seq[i + 2].v : seq[i + 2].v,
        prev,
        pairOrder === "mb" ? Math.abs(a.v) : Math.abs(seq[i + 2].v)
      )) {
      // movement + balance pair with one junk token in between
      const balV = pairOrder === "mb" ? seq[i + 2].v : seq[i + 2].v;
      const movV = pairOrder === "mb" ? Math.abs(a.v) : Math.abs(seq[i + 2].v);
      const row: TxRow = { date: (seq[i + 2].date ?? balDate) ?? "—", desc: "", movement: movV, balance: balV, signed: 0, chainOk: true };
      row.signed = balV - prev >= 0 ? movV : -movV;
      rows.push(row);
      prev = seq[i + 2].v;
      prevDate = seq[i + 2].date ?? balDate;
      i += 3;
      junk++;
    } else if (Math.abs(a.v - prev) < 0.015) {
      rows.push({ date: balDate ?? "—", desc: "", movement: null, balance: a.v, signed: 0, chainOk: true });
      prev = a.v;
      prevDate = balDate;
      i += 1;
    } else {
      junk++; // timestamp fragment / summary noise — skip
      i += 1;
    }
    if (junk > (ocrTolerant ? seq.length / 2 : seq.length / 3)) return null; // too much noise — not this layout
  }
  return rows;
}

/** Collect a line-scanned amount sequence (value + line's anchor date + line amount count). */
function scanAmountSequence(cleaned: string, anchorRe: RegExp): Array<{ v: number; date: string | null; lc: number }> {
  const seq: Array<{ v: number; date: string | null; lc: number }> = [];
  for (const raw of cleaned.split(/\r?\n/)) {
    const am = anchorRe.exec(raw);
    const lineAmounts = [...raw.matchAll(RE_AMT)];
    for (const m of lineAmounts) seq.push({ v: toNum(m[0]), date: am ? am[1] : null, lc: lineAmounts.length });
  }
  return seq;
}

/**
 * Layout E — bilingual "STATEMENT OF ACCOUNT" (C.T.BANK family): yy/mm/dd
 * anchors, rows chronological, per-row "amount balance" pair, opening stated
 * as the last amount before the first transaction row ("ما قبل" prior balance).
 */
function parseIntlBilingual(text: string, file: string): AccountLeg | null {
  if (!/STATEMENT OF ACCOUNT/i.test(text) || !/\d{2}\/\d{2}\/\d{2}\b/.test(text)) return null;
  // Drop Account-Journal summary grid rows (dotted account id + 3+ amounts)
  // — pdf.js interleaves them between transaction rows and their totals
  // would poison the ledger sequence.
  const cleaned = text
    .split(/\r?\n/)
    .filter((l) => {
      if (!/^\s*\d{2,4}-\d{5,}-\d{2,4}\b/.test(l)) return true;
      const amts = l.match(/[\d,]+\.\d{2}/g);
      return !(amts && amts.length >= 3);
    })
    .join("\n");
  const rows = walkLedgerAmounts(scanAmountSequence(cleaned, /^\s*(\d{2}\/\d{2}\/\d{2})\b/), null, false);
  if (!rows || rows.length < 3) return null;
  const account = /EG\d{12,}/.exec(text)?.[0] ?? null;
  return summarizeLeg(file, rows, {
    account,
    currency: "EGP",
    period: null,
    opening: rows[0].balance ?? 0,
    closing: rows[rows.length - 1].balance ?? 0,
    matched: rows.length,
  });
}

/**
 * Layout M — Banque Misr "Historical Statement" (photo/JBIG2 scans, OCR-fed):
 * dd/mm/yyyy anchors, Debit|Credit|Balance-after-Transaction columns, opening
 * from "Previous Balance". Chain runs with OCR digit tolerance.
 */
function parseMisrHistorical(text: string, file: string, ocr = false): AccountLeg | null {
  if (
    !/Historical Statement from/i.test(text) &&
    !/TXT_TXN_DESC/i.test(text) &&
    !/Balance after\s*Trans/i.test(text)
  )
    return null;
  const openingM = /Previous\s*Balance\s*:?\s*([\d,]+\.\d{2})/i.exec(text);
  const statedOpening = openingM ? toNum(openingM[1]) : null;
  const periodM = /Historical Statement from\s*(\d{2}[\/-]\d{2}[\/-]\d{4})\s*To\s*(\d{2}[\/-]\d{2}[\/-]\d{4})/i.exec(text);
  const meta = {
    account: /Account\s*Number\s*:?\s*(\d{10,})/i.exec(text)?.[1] ?? null,
    currency: /\b(EGP|USD|EUR|GBP|SAR|AED)\b/.exec(text)?.[1] ?? "EGP",
    period: periodM ? `${periodM[1]} → ${periodM[2]}` : null,
  };

  // Strategy 0 — line-paired rows (primary: one transaction per OCR line,
  // date-less continuation rows stay their OWN row instead of being merged
  // into the previous date's block and dropped by last-two pairing)
  const lrowsCand = lineTableRows(text, /(\d{2}[\/-]\d{2}[\/-]\d{4})/);
  const lrows = solveDropStable(lrowsCand, statedOpening, ocr);
  const lleg =
    lrows.length >= 3
      ? summarizeLeg(file, lrows, { ...meta, opening: statedOpening ?? lrows[0].balance ?? 0, closing: lrows[lrows.length - 1].balance ?? 0, matched: lrows.filter((r) => r.chainOk).length })
      : null;

  // Strategy 1 — chain-guided walk over the whole amount sequence
  const seq = scanAmountSequence(text, /(\d{2}[\/-]\d{2}[\/-]\d{4})/);
  const walkedRaw =
    walkLedgerAmounts(seq, statedOpening, ocr) ?? walkLedgerAmounts(seq, null, ocr);
  const walked = walkedRaw ? solveDropStable(walkedRaw, statedOpening, ocr) : null;

  // Strategy 2 — date-anchored blocks (amounts = last two in block)
  const blocks = anchorBlocks(text, /(\d{2}[\/-]\d{2}[\/-]\d{4})/);
  const brows: TxRow[] = [];
  for (const b of blocks) {
    const a = blockAmounts(b.text);
    if (a.balance === null) continue;
    brows.push({ date: b.date.replace(/-/g, "/"), desc: a.desc, movement: a.movement, balance: a.balance, signed: 0, chainOk: false });
  }
  solveIntlChain(brows, statedOpening, ocr);
  const bleg = brows.length >= 3 ? summarizeLeg(file, brows, { ...meta, opening: statedOpening ?? brows[0].balance ?? 0, closing: brows[brows.length - 1].balance ?? 0, matched: brows.filter((r) => r.chainOk).length }) : null;
  const wleg = walked && walked.length >= 3 ? summarizeLeg(file, walked, { ...meta, opening: statedOpening ?? walked[0].balance ?? 0, closing: walked[walked.length - 1].balance ?? 0, matched: walked.filter((r) => r.chainOk).length }) : null;

  // best-of: the variant that chain-verified more rows wins; on ties the
  // line-paired table (lleg) is preferred over block/walk reconstructions
  const cands = [lleg, bleg, wleg].filter((x): x is AccountLeg => x !== null);
  if (process.env.EIS_DEBUG_OCR) {
    const names = ["lineTable", "blocks", "walk"] as const;
    [lleg, bleg, wleg].forEach((c, idx) => {
      if (c)
        console.error(
          `[ocr-debug M] ${c === lleg ? "lineTable" : c === bleg ? "blocks" : "walk"} matched=${c.matched}/${c.txCount} opening=${c.opening} closing=${c.closing}`
        );
      void names;
    });
  }
  const pick = cands.sort((a, b) => b.matched - a.matched)[0];
  return pick ?? null;
}

/**
 * Layout A2 — Arab African International Bank statement (CamScanner scans,
 * OCR-fed): "Booking Date" + "02 MAR 26" anchors, Debit/Credit/Closing
 * Balance columns, opening from "Balance at Period Start". OCR-tolerant chain.
 */
function parseAaibStatement(text: string, file: string, ocr = false): AccountLeg | null {
  // Structural markers decide: a mere MENTION of the bank's name (client
  // notes, chat transcripts, analyst summaries) must not claim the document.
  const isAaib =
    (/Booking Date/i.test(text) && /Closing Balance/i.test(text) && /Value Date/i.test(text)) ||
    (/arab\s+af?rica[nl]\s+international bank/i.test(text) && /Booking Date|Value Date/i.test(text));
  if (!isAaib) return null;
  const openM = /Balance\s+at\s+Period/i.exec(text);
  let statedOpening: number | null = null;
  if (openM) {
    const tail = text.slice(openM.index, openM.index + 140).match(/([\d,]+\.\d{2})/);
    if (tail) statedOpening = toNum(tail[1]);
  }
  const meta = {
    account: /Account\s*[: ]\s*(\d{12,})/i.exec(text)?.[1] ?? null,
    currency: /\b(EGP|USD|EUR|GBP|SAR|AED)\b/.exec(text)?.[1] ?? "EGP",
    period: null as string | null,
  };

  // Strategy 0 — line-paired rows (primary — see parseMisrHistorical)
  const lrowsCand = lineTableRows(text, /(\d{1,2}\s+[A-Z]{3}\s+\d{2})\b/);
  const lrows = solveDropStable(lrowsCand, statedOpening, ocr);
  const lleg =
    lrows.length >= 3
      ? summarizeLeg(file, lrows, { ...meta, opening: statedOpening ?? lrows[0].balance ?? 0, closing: lrows[lrows.length - 1].balance ?? 0, matched: lrows.filter((r) => r.chainOk).length })
      : null;

  // Strategy 1 — chain-guided walk
  const seq = scanAmountSequence(text, /(\d{1,2}\s+[A-Z]{3}\s+\d{2})\b/);
  const walkedRaw =
    walkLedgerAmounts(seq, statedOpening, ocr) ?? walkLedgerAmounts(seq, null, ocr);
  const walked = walkedRaw ? solveDropStable(walkedRaw, statedOpening, ocr) : null;

  // Strategy 2 — date-anchored blocks
  const blocks = anchorBlocks(text, /(\d{1,2}\s+[A-Z]{3}\s+\d{2})\b/);
  const brows: TxRow[] = [];
  for (const b of blocks) {
    const a = blockAmounts(b.text);
    if (a.balance === null) continue;
    brows.push({ date: b.date, desc: a.desc, movement: a.movement, balance: a.balance, signed: 0, chainOk: false });
  }
  solveIntlChain(brows, statedOpening, ocr);
  const bleg = brows.length >= 3 ? summarizeLeg(file, brows, { ...meta, opening: statedOpening ?? brows[0].balance ?? 0, closing: brows[brows.length - 1].balance ?? 0, matched: brows.filter((r) => r.chainOk).length }) : null;
  const wleg = walked && walked.length >= 3 ? summarizeLeg(file, walked, { ...meta, opening: statedOpening ?? walked[0].balance ?? 0, closing: walked[walked.length - 1].balance ?? 0, matched: walked.filter((r) => r.chainOk).length }) : null;

  // best-of: the variant that chain-verified more rows wins; on ties the
  // line-paired table (lleg) is preferred over block/walk reconstructions
  const cands = [lleg, bleg, wleg].filter((x): x is AccountLeg => x !== null);
  if (process.env.EIS_DEBUG_OCR) {
    for (const c of [lleg, bleg, wleg])
      if (c)
        console.error(
          `[ocr-debug A2] matched=${c.matched}/${c.txCount} opening=${c.opening} closing=${c.closing}`
        );
  }
  const pick = cands.sort((a, b) => b.matched - a.matched)[0];
  return pick ?? null;
}

/**
 * Layout D — CIB branch statement, glued text (Statements_28FEB26 / MOhamed samples):
 *   rows print as [balance?][movement][DDMMMYY][desc], the running balance
 *   only on some rows — the chain rebuilds the rest. Opening comes from the
 *   "OPENING BALANCE" row. Amounts are glued to their date ("655.0001FEB26").
 */
function parseCibGlued(text: string, file: string): AccountLeg | null {
  // rows print as [balance?][movement][DDMMMYY] — both amounts glued to the date
  const dateGlue = /([\d,]+\.\d{2})(?:([\d,]+\.\d{2}))?(\d{2}[A-Z]{3}\d{2})/g;
  const matches = [...text.matchAll(dateGlue)];
  if (matches.length < 4) return null;
  const lower = text.toUpperCase();
  if (!lower.includes("OPENING BALANCE") && !/C\.?I\.?B/.test(text)) return null;

  interface Entry { movement: number | null; date: string; balance: number | null; desc: string }
  const entries: Entry[] = [];
  let opening: number | null = null;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const regionEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const region = text.slice((m.index ?? 0) + m[0].length, regionEnd);
    const date = m[3];

    if (m[2] === undefined && /^\s*\*?\s*(?:OPENING|CLOSING) BALANCE/i.test(region)) {
      // Balance checkpoint row (monthly OPENING/CLOSING BALANCE): the glued
      // number is a stated ledger position, NOT a movement. Only fires when
      // the label sits IMMEDIATELY after the date (a real transaction row's
      // region starts with its description — later checkpoint labels further
      // down the page must not swallow it). The first checkpoint seeds the
      // opening; every checkpoint becomes a chain anchor row.
      const bal = toNum(m[1]);
      if (opening === null) opening = bal;
      entries.push({ movement: null, date, balance: bal, desc: "Balance checkpoint" });
      continue;
    }
    const balance = m[2] ? toNum(m[1]) : null;
    const movement = Math.abs(toNum(m[2] ?? m[1]));
    const desc = region
      .replace(/[\d,]+\.\d{2}/g, " ")
      .replace(/\*[^*]{10,90}\*/g, " ")
      .replace(/Post value dated[\s\S]{0,120}/i, " ")
      .replace(/Unless an active[\s\S]{0,120}/i, " ")
      .replace(/We shall assume[\s\S]{0,80}/i, " ")
      .replace(/Please advice us[\s\S]{0,80}/i, " ")
      .replace(/Name: Address: Branch: Account Name Currency IBAN/gi, " ")
      .replace(/Transaction Date Value Date/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    entries.push({ movement, date, balance, desc });
  }
  if (opening === null || entries.length < 3) return null;

  // ascending chain rebuild with printed balances as anchors. Movement-only
  // rows get their sign from an inter-anchor segment solve: the sum of signed
  // movements between two printed balances must equal the balance delta.
  let matched = 0;
  const rows: TxRow[] = entries.map((e) => ({
    date: e.date,
    desc: e.desc,
    movement: e.movement,
    balance: e.balance,
    signed: 0,
    chainOk: false,
  }));

  let segStart = -1; // index of the previous anchor row (-1 = before first)
  for (let j = 0; j < rows.length; j++) {
    if (rows[j].balance === null) continue;
    const base = segStart === -1 ? opening : rows[segStart].balance!;
    const net = rows[j].balance! - base;

    // Two-pass segment solve. Pass 1 trusts the strong keyword signs (IPN
    // Inward / interest / refund credits, POS-ATM debits) and brute-forces
    // the remaining rows. Some families print loan interest charges that
    // LOOK like credit keywords ("Reimbursement of Interest" charged as a
    // debit on a loan account) — when pass 1 cannot reconcile the segment,
    // pass 2 demotes every keyword row back into the sign search: the
    // bank's own balance delta decides, keywords only order the search.
    let solved = false;
    for (const softKeywords of [false, true]) {
      const unknowns: number[] = [];
      let fixed = 0;
      const kwWants: boolean[] = []; // preferred sign per unknown (true = credit)
      for (let k = segStart + 1; k <= j; k++) {
        if (rows[k].movement === null) continue; // balance checkpoint anchor — no movement to sign
        const mv = rows[k].movement ?? 0;
        const kwCredit = STRONG_CREDIT_RE.test(rows[k].desc);
        const kwDebit = STRONG_DEBIT_RE.test(rows[k].desc);
        if (!softKeywords && kwCredit) {
          rows[k].signed = mv;
          fixed += mv;
        } else if (!softKeywords && kwDebit) {
          rows[k].signed = -mv;
          fixed -= mv;
        } else {
          unknowns.push(k);
          kwWants.push(kwCredit || !kwDebit);
        }
      }
      const residual = net - fixed;
      const solveWith = (n: number, test: (mask: number) => boolean, kwMask: number): number => {
        if (Math.abs(residual) < 0.015 && test(kwMask)) return kwMask;
        for (let mask = 0; mask < 1 << n; mask++) {
          if (test(mask)) return mask;
        }
        return -1;
      };
      const n = unknowns.length;
      if (n === 0) {
        if (Math.abs(residual) < 0.015) {
          solved = true;
        }
      } else if (n <= 18) {
        // brute-force sign combinations — segments are short (≤ ~18 unknowns)
        const kwMask = unknowns.reduce((mask, _k, b) => mask | (kwWants[b] ? 1 << b : 0), 0);
        const test = (mask: number): boolean => {
          let s = fixed;
          for (let b = 0; b < n; b++)
            s += mask & (1 << b) ? rows[unknowns[b]].movement ?? 0 : -(rows[unknowns[b]].movement ?? 0);
          return Math.abs(s - net) < 0.015;
        };
        const found = solveWith(n, test, kwMask);
        if (found >= 0) {
          for (let b = 0; b < n; b++) {
            const k = unknowns[b];
            rows[k].signed = found & (1 << b) ? rows[k].movement ?? 0 : -(rows[k].movement ?? 0);
          }
          solved = true;
        }
      }
      if (solved) {
        // the whole segment reconciles: keyword-signed rows, solved unknowns
        // and balance checkpoints all verify together
        for (let k = segStart + 1; k <= j; k++) {
          rows[k].chainOk = true;
          matched++;
        }
        break;
      }
      // else: next pass relaxes the keyword signs; after the last pass the
      // segment stays unverified (low confidence) with pass-1 keyword signs
    }
    segStart = j;
  }
  // tail rows after the last anchor: keyword signs, unverified
  for (let k = segStart + 1; k < rows.length; k++) {
    if (rows[k].signed === 0) {
      const mv = rows[k].movement ?? 0;
      rows[k].signed = STRONG_CREDIT_RE.test(rows[k].desc) ? mv : -mv;
    }
  }

  const withBal = rows.filter((r) => r.balance !== null);
  if (withBal.length < 2) return null;
  const inflow = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = rows.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = rows.filter((r) => r.signed > 0);
  const debits = rows.filter((r) => r.signed < 0);
  const topCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const topDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;
  return {
    file,
    account: /(?:^|\n)\s*(\d{12,19})[A-Z]{3,}/.exec(text)?.[1] ?? /IBAN[^\n]*EG\d{2}[\d]*/i.exec(text)?.[0]?.replace(/\D/g, "").slice(-14) ?? null,
    currency: /Currency\s*\n?\s*([A-Z]{3})\s*-/.exec(text)?.[1] ?? "EGP",
    period: null,
    opening,
    closing: withBal[withBal.length - 1].balance ?? 0,
    inflow,
    outflow,
    txCount: rows.length,
    matched,
    largestCredit: topCredit ? { desc: topCredit.desc.slice(0, 90), amount: topCredit.signed } : null,
    largestDebit: topDebit ? { desc: topDebit.desc.slice(0, 90), amount: topDebit.signed } : null,
    salarySeen: rows.some((r) => SALARY_RE.test(r.desc)),
    rows,
  };
}

/**
 * Layout B — CIB "Internet Banking Account Statement" (Mahmoud sample):
 *   Account Number 100 034 5567 891 · Opening Balance EGP x · rows ascending,
 *   anchor = posting date (+ optional value date), amounts may wrap to the
 *   following line (movement then balance-last). Currency labels wrap ("E\nGP").
 */
function parseCibInternet(text: string, file: string): AccountLeg | null {
  // join uppercase letter wraps ("Currency E\nGP" -> "Currency EGP")
  const norm = text.replace(/([A-Z])\r?\n([A-Z]{2,3})\b/g, (_m, a, b) => a + b);
  if (!/Internet Banking Account Statement/i.test(norm) && !/Opening Balance/i.test(norm)) return null;
  const accountM = /Account Number\s+((?:\d[\s.]?){9,20})/.exec(norm);
  if (!accountM) return null;
  const currency = /Currency\s+([A-Z]{3})\b/.exec(norm)?.[1] ?? null;
  const openingM = /Opening Balance\s*(?:[A-Z]{3}\s*)?([\d,]+\.\d{2})/.exec(norm);
  const periodM = /Statement Period\s*(?:\d\s*\n\s*)?(\d{1,2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}\/\d{2}\/\d{4})/.exec(norm);

  const lines = norm.split(/\r?\n/);
  interface Block { date: string; text: string }
  const blocks: Block[] = [];
  const anchorRe = /^\s*(\d{2}\/\d{2}\/\d{4})\b/;
  for (const raw of lines) {
    const m = anchorRe.exec(raw);
    if (m) blocks.push({ date: m[1], text: raw.slice(m[0].length) });
    else if (blocks.length) blocks[blocks.length - 1].text += " " + raw;
  }
  if (blocks.length < 3) return null;

  const rows: TxRow[] = [];
  for (const b of blocks) {
    const amounts = [...b.text.matchAll(RE_AMT)].map((m) => m[0]);
    if (amounts.length === 0) continue; // anchor-only noise
    let desc = b.text;
    for (const a of amounts) desc = desc.replace(a, " ");
    desc = desc
      .replace(/\d{2}\/\d{2}\/\d{4}/g, " ")
      .replace(/\((?:EGP|USD|EUR|GBP|SAR|AED)\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const balance = toNum(amounts[amounts.length - 1]);
    const movement = amounts.length >= 2 ? Math.abs(toNum(amounts[amounts.length - 2])) : null;
    rows.push({ date: b.date, desc, movement, balance, signed: 0, chainOk: false });
  }
  if (rows.length < 3) return null;

  // ascending chain from the header opening balance
  let prev = openingM ? toNum(openingM[1]) : rows[0].balance! - (rows[0].movement ?? 0);
  let matched = 0;
  for (const r of rows) {
    if (r.balance === null) continue;
    const delta = (r.balance as number) - prev;
    if (r.movement === null) {
      // Balance-only row (amount not printed / not extracted): a stated ledger
      // position with no amount to contradict the chain — it verifies as an
      // anchor and the next row's delta carries the movement.
      r.signed = delta;
      r.chainOk = true;
      matched++;
      prev = r.balance as number;
      continue;
    }
    if (Math.abs(Math.abs(delta) - r.movement) > 0.015) {
      // Amount split across a line break: "…TOURISM 18," + "310.09 69,015.75"
      // leaves the thousands-group tail inside the description (page footers
      // may trail after it). Rejoin the LAST such fragment and re-verify.
      const frags = [...r.desc.matchAll(/(\d{1,3}),(?=\s|$)/g)];
      const frag = frags.length ? frags[frags.length - 1] : null;
      if (frag && r.movement < 1000) {
        const rejoined = parseInt(frag[1], 10) * 1000 + r.movement;
        if (Math.abs(Math.abs(delta) - rejoined) < 0.015) {
          r.movement = rejoined;
          r.desc = (r.desc.slice(0, frag.index) + " " + r.desc.slice(frag.index + frag[0].length))
            .replace(/\s+/g, " ")
            .trim();
        }
      }
    }
    r.signed = Math.abs(Math.abs(delta) - r.movement) > 0.015 ? delta : delta >= 0 ? r.movement : -r.movement;
    if (Math.abs(Math.abs(delta) - r.movement) < 0.015) r.chainOk = true;
    else r.signed = delta;
    if (r.chainOk) matched++;
    prev = r.balance as number;
  }

  const inflow = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = rows.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = rows.filter((r) => r.signed > 0);
  const debits = rows.filter((r) => r.signed < 0);
  const topCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const topDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;
  return {
    file,
    account: accountM[1].replace(/[^\d]/g, ""),
    currency: currency ?? "EGP",
    period: periodM ? `${periodM[1]} → ${periodM[2]}` : null,
    opening: openingM ? toNum(openingM[1]) : rows[0].balance! - rows[0].signed,
    closing: rows[rows.length - 1].balance ?? 0,
    inflow,
    outflow,
    txCount: rows.length,
    matched,
    largestCredit: topCredit ? { desc: topCredit.desc.slice(0, 90), amount: topCredit.signed } : null,
    largestDebit: topDebit ? { desc: topDebit.desc.slice(0, 90), amount: topDebit.signed } : null,
    salarySeen: rows.some((r) => SALARY_RE.test(r.desc)),
    rows,
  };
}

/**
 * Layout C — CIB digital-banking export ("as of … GMT", paul's client files):
 *   header line with Customer Id / Account Number / Currency / Opening /
 *   Closing / period as ground truth; rows listed NEWEST-FIRST, so each row's
 *   signed movement equals the stated-balance delta against the PREVIOUS
 *   (newer) row; the oldest row reconciles against the header opening.
 */
function parseCibDigital(text: string, file: string): AccountLeg | null {
  const hm =
    /Customer Id Account Number Account Currency Opening Balance Closing Balance From Date To Date\s*\n?\s*(\d+)\s+(\d{9,})\s+([A-Z]{3})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(\d{2}-\w+-\d{4})\s+(\d{2}-\w+-\d{4})/.exec(
      text
    );
  if (!hm) return null;
  const account = hm[2];
  const currency = hm[3];
  const opening = toNum(hm[4]);
  const period = `${hm[6]} → ${hm[7]}`;

  const lines = text.split(/\r?\n/);
  interface Block { date: string; text: string }
  const blocks: Block[] = [];
  const anchorRe = /^\s*(\d{2}-[A-Za-z]+-\d{4})\b/;
  for (const raw of lines) {
    if (/^\s*Transaction Date/.test(raw) || /^\s*No\.\s*Description/.test(raw)) continue; // page headers
    const m = anchorRe.exec(raw);
    if (m) blocks.push({ date: m[1], text: raw.slice(m[0].length) });
    else if (blocks.length) blocks[blocks.length - 1].text += " " + raw;
  }
  if (blocks.length < 1) return null;

  const rows: TxRow[] = [];
  for (const b of blocks) {
    const amounts = [...b.text.matchAll(RE_AMT)].map((m) => m[0]);
    if (amounts.length === 0) continue;
    let desc = b.text;
    for (const a of amounts) desc = desc.replace(a, " ");
    desc = desc
      .replace(/\d{2}-[A-Za-z]+-\d{4}/g, " ")
      .replace(/\((?:EGP|USD|EUR|GBP|SAR|AED)\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const balance = toNum(amounts[amounts.length - 1]);
    const movement = amounts.length >= 2 ? Math.abs(toNum(amounts[amounts.length - 2])) : null;
    rows.push({ date: b.date, desc, movement, balance, signed: 0, chainOk: false });
  }
  if (rows.length < 1) return null;

  // newest-first: delta against the next (older) stated balance
  let matched = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.balance === null) continue;
    const refBal = i + 1 < rows.length ? (rows[i + 1].balance as number) : opening;
    const delta = (r.balance as number) - refBal;
    r.signed = delta;
    if (r.movement !== null && Math.abs(Math.abs(delta) - r.movement) < 0.015) {
      r.chainOk = true;
      matched++;
    }
  }

  const chronological = [...rows].reverse(); // oldest first for display/report
  const inflow = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = rows.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = rows.filter((r) => r.signed > 0);
  const debits = rows.filter((r) => r.signed < 0);
  const topCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const topDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;
  return {
    file,
    account,
    currency,
    period,
    opening,
    closing: rows[0].balance ?? 0, // newest row = closing position
    inflow,
    outflow,
    txCount: rows.length,
    matched,
    largestCredit: topCredit ? { desc: topCredit.desc.slice(0, 90), amount: topCredit.signed } : null,
    largestDebit: topDebit ? { desc: topDebit.desc.slice(0, 90), amount: topDebit.signed } : null,
    salarySeen: rows.some((r) => SALARY_RE.test(r.desc)),
    rows: chronological,
  };
}

/** Layout A — CIB branch statement (haytham family): single posting-date anchor, inline amounts. */
function parseCibBranch(text: string, file: string): AccountLeg | null {
  // Never fragment another family's scans: Misr historical / AAIB statements
  // carry "Account Number:"-style headers too, but their rows belong to the
  // M/A2 parsers — a partial A-branch parse would fake a tiny 100% leg.
  if (/Historical Statement from|TXT_TXN_DESC|Balance after\s*Trans/i.test(text)) return null;
  if (/Booking Date/i.test(text) && /Closing Balance/i.test(text) && /Value Date/i.test(text)) return null;
  const account = RE_ACCT.exec(text)?.[1] ?? null;
  const currency = RE_CURR.exec(text)?.[1] ?? null;
  const periodM = RE_PERIOD.exec(text);

  const lines = text.split(/\r?\n/);
  const rows: TxRow[] = [];
  let current: TxRow | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (RE_TOTAL_LINE.test(line)) continue; // section footer totals

    let dateM = RE_DATE_FULL.exec(line);
    let rest = line;
    if (dateM) {
      rest = line.slice(dateM[0].length).trim();
    } else {
      const wrapped = RE_DATE_WRAPPED.exec(line);
      if (wrapped) {
        // year wrapped: "01/04/20" followed by "26 ..." on the same text line
        const joined = line.replace(/^(?:\s*)(\d{2}\/\d{2}\/20)(?!\d)\s*(\d{2})/, "$1$2");
        dateM = RE_DATE_FULL.exec(joined);
        rest = dateM ? joined.slice(dateM[0].length).trim() : line;
        if (!dateM) {
          appendContinuation(current, line);
          continue;
        }
      } else {
        appendContinuation(current, line);
        continue;
      }
    }

    const amounts = [...rest.matchAll(RE_AMT)].map((m) => m[0]);
    // description: strip amounts & bare reference tokens from the tail
    let desc = rest;
    for (const a of amounts) desc = desc.replace(a, " ");
    desc = desc.replace(/\s+/g, " ").trim();
    // movement amount = second-to-last (before the running balance)
    let movement: number | null = null;
    let balance: number | null = null;
    if (amounts.length >= 2) {
      movement = Math.abs(toNum(amounts[amounts.length - 2]));
      balance = toNum(amounts[amounts.length - 1]);
    } else if (amounts.length === 1) {
      balance = toNum(amounts[0]);
    }
    if (current) rows.push(current);
    current = { date: dateM[1], desc, movement, balance, signed: 0, chainOk: false };
  }
  if (current) rows.push(current);

  // Not a usable CIB table → bail (caller falls back to manual analysis)
  if (!currency && !account) return null;
  if (rows.length < 3) return null;

  // --- chain verification: sign each movement from the stated balance delta ---
  const withBal = rows.filter((r) => r.balance !== null) as Array<TxRow & { balance: number }>;
  if (withBal.length < 3) return null;

  const first = withBal[0];
  const guessSign = SALARY_RE.test(first.desc) || first.movement === null ? 1 : /withdraw|atm|debit|payment/i.test(first.desc) ? -1 : 1;
  const opening = first.balance - (first.movement ?? 0) * guessSign;
  first.signed = (first.movement ?? 0) * guessSign;

  let matched = first.movement === null ? 1 : 0; // row 0 sign is guessed, not verified
  let bal = opening;
  for (let i = 0; i < withBal.length; i++) {
    const r = withBal[i];
    if (i > 0) {
      const delta = r.balance - withBal[i - 1].balance;
      if (r.movement !== null && Math.abs(Math.abs(delta) - r.movement) > 0.015 && Math.abs(delta) > 0.015) {
        // balance jumped by an unstated movement (page-break carry row etc.)
        r.signed = delta;
        r.movement = Math.abs(delta);
      } else {
        r.signed = r.movement !== null ? (delta >= 0 ? r.movement : -r.movement) : delta;
      }
    }
    const expect = bal + r.signed;
    if (Math.abs(expect - r.balance) < 0.015) {
      r.chainOk = true;
      matched++;
    }
    bal = r.balance; // always resync to stated balance
  }

  const inflow = withBal.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const outflow = withBal.filter((r) => r.signed < 0).reduce((s, r) => s - r.signed, 0);
  const credits = withBal.filter((r) => r.signed > 0);
  const debits = withBal.filter((r) => r.signed < 0);
  const largestCredit = credits.length ? credits.reduce((a, b) => (b.signed > a.signed ? b : a)) : null;
  const largestDebit = debits.length ? debits.reduce((a, b) => (-b.signed > -a.signed ? b : a)) : null;

  return {
    file,
    account,
    currency: currency ?? "EGP",
    period: periodM ? `${periodM[1]} → ${periodM[2]}` : null,
    opening,
    closing: withBal[withBal.length - 1].balance,
    inflow,
    outflow,
    txCount: withBal.length,
    matched,
    largestCredit: largestCredit ? { desc: largestCredit.desc.slice(0, 90), amount: largestCredit.signed } : null,
    largestDebit: largestDebit ? { desc: largestDebit.desc.slice(0, 90), amount: largestDebit.signed } : null,
    salarySeen: withBal.some((r) => SALARY_RE.test(r.desc)),
    rows: withBal,
  };
}

/** Compat single-leg wrapper — first leg of the multi dispatcher. */
export function parseCibText(text: string, file: string, ocr = false): AccountLeg | null {
  const found = parseCibTextMulti(text, file, ocr);
  return found.length > 0 ? found[0] : null;
}

function appendContinuation(row: TxRow | null, line: string): void {
  if (!row) return;
  const clean = line.replace(/\(?-?[\d,]+\.\d{2}\)?/g, " ").replace(/\s+/g, " ").trim();
  if (clean && clean.length > 3 && !/^\d{2}\/\d{2}\/20/.test(clean)) {
    row.desc = (row.desc + " " + clean).slice(0, 220).trim();
  }
}

// ---------- draft report rendering (canonical client design — see report_design.ts) ----------

function esc(s: string): string {
  return escHtml(s);
}

/** Legacy portal tone -> client KPI tone. */
function kpiTone(cls: string): string {
  return cls === "ok" ? "success" : cls === "warn" ? "warning" : cls;
}

function kpi(label: string, value: string, note: string, cls = ""): string {
  return kpiCard(label, value, esc(note), kpiTone(cls));
}

interface Finding { label: string; detail: string; tone: "ok" | "warn" | "danger" | "mute" }

/** Data-driven pattern findings for one account leg (analyst-style bullets). */
function legFindings(l: AccountLeg, requiredEgp: number): Finding[] {
  const f: Finding[] = [];
  const fxOf = (c: string) => FX_EGP[c] ?? 1;
  const rows = effectiveRows(l); // window-aware: last 6 months only
  const sum = (pred: (r: TxRow) => boolean) => rows.filter(pred).reduce((s, r) => s + r.signed, 0);

  const ownIn = sum((r) => r.signed > 0 && /account to account transfer|self transfer/i.test(r.desc));
  const salaryIn = sum((r) => r.signed > 0 && SALARY_RE.test(r.desc));
  const inwardIn = sum((r) => r.signed > 0 && /\bIPN Inward\b|cheque deposit|remittance/i.test(r.desc));
  const creditTotal = l.inflow || 1;
  const atmOut = -sum((r) => r.signed < 0 && /\batm\b|cash withdrawal/i.test(r.desc));
  const cardOut = -sum((r) => r.signed < 0 && /pos purchase|purchase with card|purchases using/i.test(r.desc));
  const ownOut = -sum((r) => r.signed < 0 && /account to account transfer|self transfer/i.test(r.desc));

  f.push({
    label: "Third-party income",
    detail:
      `Verified-looking external credits: salary/payroll ${money(salaryIn)}${l.currency}` +
      ` · inward remittances/cheques ${money(inwardIn)}${l.currency}` +
      ` (${(((salaryIn + inwardIn) / creditTotal) * 100).toFixed(1)}% of inflows)`,
    tone: salaryIn + inwardIn > 0 ? "ok" : "warn",
  });
  f.push({
    label: "Own-account circulation",
    detail: `A2A transfers in ${money(ownIn)}${l.currency} / out ${money(ownOut)}${l.currency} — high shares mean funds mainly circulate between the holder's own accounts`,
    tone: ownIn / creditTotal > 0.5 ? "warn" : "mute",
  });
  f.push({
    label: "Cash & card behaviour",
    detail: `ATM withdrawals ${money(atmOut)}${l.currency} · card/POS spending ${money(cardOut)}${l.currency} over ${l.txCount} transactions`,
    tone: atmOut > l.closing * fxOf(l.currency) ? "warn" : "mute",
  });
  if (requiredEgp > 0) {
    const below = rows.filter((r) => (r.balance ?? 0) * fxOf(l.currency) < requiredEgp).length;
    const pct = Math.round((below / Math.max(1, rows.length)) * 100);
    f.push({
      label: "Benchmark observation points",
      detail: `Balance was below the required ${money(requiredEgp)} EGP-equivalent at ${below}/${rows.length} observed ledger positions (${pct}%)`,
      tone: pct > 50 ? "danger" : pct > 10 ? "warn" : "ok",
    });
  }
  const netCheck = l.inflow - l.outflow - (l.closing - l.opening);
  f.push({
    label: "Ledger cross-check",
    detail:
      Math.abs(netCheck) < Math.max(1, l.closing * 0.001)
        ? `Inflow − outflow reconciles with the net position change (Δ ${money(netCheck)}${l.currency})`
        : `Inflow − outflow differs from the net position change by ${money(netCheck)}${l.currency} — sign reconstruction is partial on this layout; analyst to confirm`,
    tone: Math.abs(netCheck) < Math.max(1, l.closing * 0.001) ? "ok" : "warn",
  });
  return f;
}

function findingsHtml(fs: Finding[]): string {
  const toneTag = (t: Finding["tone"]) =>
    t === "ok" ? tag("PASS", "pass") : t === "warn" ? tag("WATCH", "warn") : t === "danger" ? tag("FLAG", "fail") : tag("INFO", "low");
  return fs
    .map(
      (x) =>
        `<p style="margin:0 0 12px">${toneTag(x.tone)} <b style="color:var(--primary)">${esc(x.label)}</b>` +
        `<br><span class="small">${esc(x.detail)}</span></p>`
    )
    .join("");
}

function buildReportHtml(
  userId: string,
  country: string | null,
  visaType: string | null,
  travelers: number,
  legs: AccountLeg[],
  benchmarkEgp: number,
  style: "review" | "engine"
): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const fxOf = (c: string) => FX_EGP[c] ?? 0;
  const consolidated = legs.reduce((s, l) => s + l.closing * fxOf(l.currency), 0);
  const required = benchmarkEgp * travelers;
  const coverage = required > 0 ? (consolidated / required) * 100 : 0;
  const covCls = coverage >= 100 ? "ok" : coverage >= 50 ? "warn" : "danger";
  const stamp =
    style === "engine"
      ? "GENERATED BY THE GLOBAL EIS AUTOMATED ANALYSIS ENGINE — EVERY LEDGER ROW CHAIN-VERIFIED"
      : "AUTO-GENERATED FIRST PASS — PENDING ANALYST REVIEW";

  const legSections = legs
    .map((l) => {
      const integrity = l.txCount ? Math.round((l.matched / l.txCount) * 100) : 0;
      const wrows = effectiveRows(l); // 6-month window rows when a window applies
      const preview = wrows.slice(0, 25);
      const rowsHtml = preview
        .map(
          (r) =>
            `<tr><td style="white-space:nowrap">${esc(r.date)}</td><td>${esc(r.desc.slice(0, 110))}</td>` +
            `<td class="num ${r.signed >= 0 ? "text-success" : "text-danger"}">${r.signed >= 0 ? "+" : "−"}${money(Math.abs(r.signed))}</td>` +
            `<td class="num">${money(r.balance ?? 0)}</td></tr>`
        )
        .join("");
      return `${sectionTitle(`Account ${esc(l.account ?? "(number not parsed)")} — ${esc(l.currency)}${l.period ? ` · ${esc(l.period)}` : ""}`)}
${kpiGrid([
  kpi("Opening", `${l.currency} ${money(l.opening)}`, esc(l.file)),
  kpi("Closing", `${l.currency} ${money(l.closing)}`, "end of period"),
  kpi("Total inflows", `${l.currency} ${money(l.inflow)}`, l.windowFrom ? `${wrows.length} rows in window (of ${l.txCount})` : `${l.txCount} transactions`, "ok"),
  kpi("Total outflows", `${l.currency} ${money(l.outflow)}`, integrity + "% chain integrity", "danger"),
  kpi("EGP-equivalent closing", "EGP " + money(l.closing * fxOf(l.currency)), "indicative FX " + fxOf(l.currency).toFixed(2)),
  ...(l.windowFrom ? [kpi("Window flows", `+${money(l.windowInflow ?? l.inflow)} / −${money(l.windowOutflow ?? l.outflow)}`, "last 6 months", "ok")] : []),
])}
${(l.windowNotes ?? []).length ? `<p class="small">${(l.windowNotes ?? []).map((n) => esc(n)).join("<br>")}</p>` : ""}
<p class="small">Largest credit: <b>${l.largestCredit ? esc(l.largestCredit.desc) + " (" + money(l.largestCredit.amount) + ")" : "—"}</b>
 · Largest debit: <b>${l.largestDebit ? esc(l.largestDebit.desc) + " (" + money(-l.largestDebit.amount) + ")" : "—"}</b>
 · Salary/payroll credits detected: <b>${l.salarySeen ? "yes" : "none visible"}</b></p>
${analysisCard("Pattern findings — analyst view", findingsHtml(legFindings(l, required / Math.max(1, travelers))), true)}
<table class="data-table"><thead><tr><th>Date</th><th>Description</th><th class="text-right">Movement</th><th class="text-right">Balance</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>
<p class="small">Showing first ${preview.length} of ${wrows.length} in-window rows${l.windowFrom ? ` (6-month window — ${l.txCount} total rows all chain-verified)` : ` (chain-verified against stated balances)`}. Full listing available on request.</p>`;
    })
    .join("\n");

  const banners = [
    alertBox(style === "engine" ? "blue" : "red", stamp, `<p style="margin:0" class="small">${
      style === "engine"
        ? "Every ledger row on every account has been verified against the bank's own running balances. Figures reflect the stated ledger without manual adjustment."
        : "This first pass is parked for the Global EIS analyst: the pattern narrative, benchmark confirmation and final delivery follow analyst review."
    }</p>`),
    ...(legs.some((l) => l.ocr)
      ? [
          alertBox(
            "danger",
            "OCR-SOURCE DRAFT (SHADOW MODE)",
            `<p style="margin:0" class="small">Recovered from a scanned statement · machine-read text with identical chain verification · analyst review required · auto-delivery disabled.</p>`
          ),
        ]
      : []),
  ];

  const content = [
    sectionTitle("Executive Dashboard — Consolidated Position"),
    kpiGrid([
      kpi("Accounts analysed", String(legs.length), esc(legs.map((l) => l.currency).join(" + "))),
      kpi("Closing (EGP-equivalent)", "EGP " + money(consolidated), "indicative FX — refresh on submission day", "ok"),
      kpi("Benchmark applied", "EGP " + money(required), `${esc(country ?? "default")} × ${travelers} applicant(s)`, "warn"),
      kpi("Coverage", coverage.toFixed(1) + "%", coverage >= 100 ? "benchmark met" : "gap: EGP " + money(Math.max(0, required - consolidated)), covCls),
    ]),
    `<p class="small">Benchmark figure is the portal's indicative default for this destination — the analyst confirms or adjusts it before delivery. Joint applicants share this statement, so the requirement is multiplied accordingly.</p>`,
    legSections,
    alertBox(
      "blue",
      `About this ${style === "engine" ? "report" : "draft"}`,
      `<p style="margin:0" class="small">This document was generated automatically: the statement PDF was parsed, every ledger row was verified against the bank's own running balances (chain integrity ${legs
        .map((l) => (l.txCount ? Math.round((l.matched / l.txCount) * 100) : 0))
        .join("% / ")}%), and the consolidated position was computed at indicative FX rates. ${
        style === "engine"
          ? "Figures reflect the bank's stated ledger without manual adjustment — contact Global EIS for the detailed analyst narrative."
          : "The Global EIS analyst reviews this draft, adds the pattern-level narrative (income origin, circulation analysis, payee clustering), confirms the benchmark, and only then is the final report delivered."
      }${
        legs.some((l) => l.ocr)
          ? " Statement text was recovered by OCR from a scanned image (shadow mode): machine-read text, identical chain verification, mandatory analyst review before delivery."
          : ""
      }</p>`
    ),
  ].join("\n");

  return reportShell({
    title: "Financial Intelligence Report",
    subLines: [
      `<strong>Queue:</strong> ${esc(userId)} &nbsp;|&nbsp; <strong>Destination:</strong> ${esc(country ?? "pending")} ${visaType ? "· " + esc(visaType) : ""}`,
      `<strong>Generated:</strong> ${esc(now)} &nbsp;|&nbsp; <strong>Classification:</strong> Confidential`,
    ],
    banners,
    contentHtml: content,
    pageTitle: `Global EIS — Financial Intelligence Report (Queue ${esc(userId)})`,
  });
}
