/**
 * Shadow OCR stage — serverless-safe OCR for image-only bank statement scans.
 *
 * Strategy: many phone/CamScanner scans are PDFs whose pages are plain
 * DCTDecode (JPEG) image XObjects with NO text layer. Instead of a full PDF
 * rasterizer (native canvas — not available on serverless), we pull those
 * embedded JPEGs straight out of the byte stream and OCR them with
 * tesseract.js (pure WASM — no native binaries, works on Vercel's Node
 * runtime). The recovered text feeds the SAME CIB layout parsers, so an
 * OCR'd scan flows through the identical chain verification as a digital
 * PDF — and the engine marks the leg OCR-sourced so the draft always lands
 * in analyst review (shadow mode: OCR results are NEVER auto-delivered).
 *
 * Caps (serverless time budget): at most MAX_OCR_PAGES page images, at most
 * MAX_OCR_SECONDS seconds total, single page image per object (the largest
 * JPEG per resource set wins — small stamps/logos are skipped by area).
 */

import { execFile } from "child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export const MAX_OCR_PAGES = (() => {
  const v = parseInt(process.env.OCR_MAX_PAGES ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 6; // serverless default; raise locally via env
})();
export const MAX_OCR_SECONDS = (() => {
  const v = parseInt(process.env.OCR_MAX_SECONDS ?? "", 10);
  // 300s: sized for the CLI+variant-fusion pipeline (color first, gray re-read
  // for thin pages). Vercel's function window still caps real usage — OCR
  // truncates gracefully and the draft carries what was recovered.
  return Number.isFinite(v) && v > 0 ? v : 300;
})();
const MIN_PAGE_JPEG_BYTES = 8 * 1024; // stamps/logos are far smaller than statement pages

export interface OcrOutcome {
  text: string;
  pages: number;
  truncated: boolean;
}

/**
 * Which OCR engine is in play: the native tesseract binary (better LSTM
 * models, ~3× faster, recovers watermark-covered rows the WASM fast model
 * misses) when installed — workspace/local/Docker — else tesseract.js WASM
 * (pure JS, the only option on Vercel serverless).
 */
let cliAvailable: boolean | null = null;
async function hasTesseractCli(): Promise<boolean> {
  if (cliAvailable !== null) return cliAvailable;
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("tesseract", ["--version"], { timeout: 10_000 }, (err) =>
        err ? reject(err) : resolve()
      );
    });
    cliAvailable = true;
  } catch {
    cliAvailable = false;
  }
  return cliAvailable;
}

async function ocrPageViaCli(img: Buffer): Promise<string | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "eis-cli-"));
  const imgPath = path.join(dir, "pg.img");
  try {
    await writeFile(imgPath, img);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "tesseract",
        [imgPath, "stdout", "--psm", "3", "-l", "eng"],
        { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      );
    });
    return stdout;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract embedded page JPEGs (DCTDecode image XObjects) from raw PDF bytes.
 * Byte-level by design: works regardless of encryption-free writer quirks,
 * needs zero deps, and keeps only real page-sized photos (area heuristic).
 * Returns JPEG buffers in file order (== page order for scan-style writers).
 */
export function extractPageJpegs(buf: Buffer, max = MAX_OCR_PAGES): Buffer[] {
  const latin = buf.toString("latin1");
  const out: Buffer[] = [];
  const marker = "stream";
  let searchFrom = 0;

  while (out.length < max) {
    // Next image-XObject dictionary: /Subtype /Image ... stream
    const dictRe = /\/Subtype\s*\/Image\b/g;
    dictRe.lastIndex = searchFrom;
    const dictMatch = dictRe.exec(latin);
    if (!dictMatch) break;

    // The stream keyword that closes this dictionary
    const streamStart = latin.indexOf(marker, dictMatch.index);
    if (streamStart === -1) break;
    const dict = latin.slice(Math.max(0, dictMatch.index - 400), streamStart);
    const isJpeg = /DCTDecode/i.test(dict);
    // Actual data begins after "stream" + EOL (PDF spec: CRLF or LF)
    let dataStart = streamStart + marker.length;
    if (latin[dataStart] === "\r") dataStart++;
    if (latin[dataStart] === "\n") dataStart++;
    const end = latin.indexOf("endstream", dataStart);
    if (end === -1) break;

    if (isJpeg) {
      const raw = buf.subarray(dataStart, end);
      // Trim trailing EOL junk before endstream; verify JPEG magic
      let slice = raw;
      while (slice.length > 2 && (slice[slice.length - 1] === 10 || slice[slice.length - 1] === 13)) {
        slice = slice.subarray(0, -1);
      }
      if (slice.length >= MIN_PAGE_JPEG_BYTES && slice[0] === 0xff && slice[1] === 0xd8) {
        out.push(Buffer.from(slice)); // copy — subarray keeps the whole parent alive
      }
    }
    searchFrom = end + "endstream".length;
  }

  // Keep the largest image per page: scans sometimes embed a small logo or
  // colour-profile thumbnail next to the page photo. Sort by size desc, then
  // greedily keep images that are not tiny relative to the biggest so far.
  if (out.length > 1) {
    const sorted = [...out].sort((a, b) => b.length - a.length);
    const kept: Buffer[] = [];
    for (const img of sorted) {
      if (kept.length === 0 || img.length > kept[kept.length - 1].length * 0.45) {
        kept.push(img);
      }
    }
    return kept.slice(0, max);
  }
  return out;
}

/**
 * Rasterize PDF pages with poppler (pdftoppm) when available — covers encodings
 * the byte-level JPEG extractor cannot touch (JBIG2, JPX, masks). Env-gated:
 * PDF_RASTER=1 turns it on (workspace/local installs have poppler; Vercel
 * serverless does not, so production keeps the embedded-JPEG fast path).
 * Returns page images in page order; gray=false gives COLOR pages.
 *
 * Lesson (matrix campaign #2): the COLOR raster recovers transaction rows
 * that grayscale washes out under security watermarks/stamps (a whole
 * 28/04→14/06 block, ~19k EGP of movement) — but the reverse also happens
 * (page 3 of the same scan reads better in gray). Neither variant wins
 * everywhere, so ocrPdfText OCRs color first and re-reads thin pages in
 * gray, picking the variant with more transaction-shaped lines per page.
 */
async function rasterizePdf(buf: Buffer, max: number, gray: boolean): Promise<Buffer[] | null> {
  if (process.env.PDF_RASTER !== "1") return null;
  const dir = await mkdtemp(path.join(tmpdir(), "eis-raster-"));
  const pdfPath = path.join(dir, "in.pdf");
  try {
    await writeFile(pdfPath, buf);
    const args = ["-png", "-r", "300", "-f", "1", "-l", String(max), pdfPath, path.join(dir, "pg")];
    if (gray) args.splice(1, 0, "-gray");
    await new Promise<void>((resolve, reject) => {
      execFile("pdftoppm", args, { timeout: 240_000 }, (err) => (err ? reject(err) : resolve()));
    });
    const files = (await readdir(dir)).filter((f) => f.startsWith("pg") && f.endsWith(".png")).sort();
    const out: Buffer[] = [];
    for (const f of files) out.push(await readFile(path.join(dir, f)));
    return out.length ? out : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * OCR amount normalization — repairs tesseract's systematic number damage
 * BEFORE parsing. Applied to OCR-recovered text only (digital PDFs never
 * print these forms). Unambiguous shapes only:
 *   317.391.33 → 317,391.33   (dot-thousands groups with .cc tail)
 *   245.609 63 → 245,609.63   (dot-thousands split before the cents)
 *   277:225.43 → 277,225.43   (colon misread for the thousands comma)
 *   275-705.13 → 275,705.13   (hyphen misread — 3-digit groups + .cc tail,
 *                              distinct from dd-mm-yyyy date shapes)
 *   5.634 00   → 5,634.00     (dot-thousands + space cents, no trailing dot)
 *   440.710,33 → 440,710.33   (European: dot-thousands + comma cents)
 *   50-000,00  → 50,000.00    (hyphen-thousands + comma cents)
 *   5§08,.637,33 → 508,637.33 (stamp ink inside the token + stray dot)
 */
export function normalizeOcrAmounts(text: string): string {
  return text
    .replace(/(\d)§(?=\d)/g, "$1") // stamp ink swallowed a digit position
    // letter misread as the leading digit: "A50,047.36" → "450,047.36"
    .replace(/\b([A-Z])(\d{1,3},\d{3}\.\d{2})\b/g, (_m, _l, rest) => rest)
    // double-dot irregular: "6.00.00" — tesseract dropped a zero inside the
    // thousands group; the chain's pow10 repair handles the value, here we
    // only make the token PARSEABLE as movement+balance shape: 6.00.00 → 600.00
    // (parseable; the solver re-scales when the chain disagrees)
    .replace(/\b(\d{1,3})\.(\d{2})\.(\d{2})\b/g, "$1$2.$3")
    // dot-thousands (one or more 3-digit dot groups) followed by .cc
    .replace(/(?<=\d)(\.\d{3})+(?=\.\d{2}\b)/g, (m) => m.replace(/\./g, ","))
    // dot-thousands + hyphen cents: "33.029-86" → "33,029.86"
    .replace(/\b(\d{1,3}(?:\.\d{3})+)-(\d{2})\b/g, (_m, head, cc) => `${head.replace(/\./g, ",")}.${cc}`)
    // dot-thousands split before the cents: "245.609 63" / "5.634 00"
    .replace(/\b(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+) (\d{2})\b/g, (m, head, cc) =>
      /\.\d{3}/.test(head) ? `${head.replace(/\./g, ",")}.${cc}` : m
    )
    // colon or hyphen as the thousands separator, anchored by a .cc tail
    .replace(/\b(\d{1,3})[:-](\d{3})(?=\.\d{2}\b)/g, "$1,$2")
    // stray dot after the thousands comma: "508,.637,33"
    .replace(/,\.(?=\d{3}\b)/g, ",")
    // hyphen-thousands with comma cents: "50-000,00"
    .replace(/\b(\d{1,3})-(\d{3})(?=,\d{2}\b)/g, "$1,$2")
    // hyphen between short groups + dot cents: "14-44.29" → "1444.29" (chain judges)
    .replace(/\b(\d{1,2})-(\d{2})\.(\d{2})\b/g, "$1$2.$3")
    // European dot-thousands + comma cents: "440.710,33" → "440,710.33"
    .replace(/\b(\d{1,3}(?:\.\d{3})+),(\d{2})\b/g, (_m, head, cc) => `${head.replace(/\./g, ",")}.${cc}`)
    // European comma-thousands + comma cents: "50,000,00" → "50,000.00"
    .replace(/\b(\d{1,3}(?:,\d{3})+),(\d{2})\b/g, (_m, head, cc) => `${head}.${cc}`);
}

/**
 * Transaction-shaped line heuristic for variant selection: a line that
 * carries a date-ish anchor AND at least two decimal amounts is very likely
 * a real statement row. Pages whose color OCR yields few of these get a
 * second chance in grayscale — whichever variant reads more rows wins the
 * page. Layout-agnostic on purpose (ocr.ts must not know bank anchors).
 */
const GENERIC_TX_ANCHOR =
  /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|\d{1,2}[A-Z]{3}\d{2}/;
const GENERIC_AMOUNT = /\d[\d,]*\.\d{2}\b/g;

function txLineCount(text: string): number {
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!GENERIC_TX_ANCHOR.test(raw)) continue;
    const amts = raw.match(GENERIC_AMOUNT);
    if (amts && amts.length >= 2) n++;
  }
  return n;
}

/**
 * OCR image-only PDF bytes into text. Returns null when the PDF carries a
 * usable text layer handled elsewhere, has no OCR-able page images, or OCR
 * recovers too little text to be worth parsing.
 *
 * Variant fusion: every page is rasterized in COLOR and OCR'd first; pages
 * that yield fewer than 3 transaction-shaped lines are re-read from the
 * GRAY raster and the better-reading variant wins the page. The native
 * tesseract binary is preferred when installed (better models, ~3× faster);
 * tesseract.js WASM is the fallback (Vercel serverless).
 */
export async function ocrPdfText(
  buf: Buffer,
  opts?: { preferGray?: boolean; forceWasm?: boolean }
): Promise<OcrOutcome | null> {
  const started = Date.now();
  const variant = (process.env.OCR_VARIANT ?? "fusion").toLowerCase(); // color | gray | fusion | both
  const preferGray = opts?.preferGray === true || variant === "gray";
  let colorPages: Buffer[] | null = null;
  let grayPages: Buffer[] | null = null;
  let pages: Buffer[] | null = null;
  if (process.env.PDF_RASTER === "1") {
    if (!preferGray && variant !== "gray") colorPages = await rasterizePdf(buf, MAX_OCR_PAGES, false);
    if (preferGray || variant !== "color") grayPages = await rasterizePdf(buf, MAX_OCR_PAGES, true);
    pages = preferGray ? grayPages : colorPages ?? grayPages;
  }
  if (!pages || pages.length === 0) pages = extractPageJpegs(buf);
  if (!pages || pages.length === 0) return null;
  const grayFor = colorPages && grayPages && !preferGray ? grayPages : null;
  const tryGrayEverywhere = grayFor !== null && variant === "both";

  const useCli = !opts?.forceWasm && (await hasTesseractCli());
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const ocrOne = async (img: Buffer): Promise<string | null> => {
      if (useCli) return ocrPageViaCli(img);
      if (!worker) {
        const { createWorker } = await import("tesseract.js");
        // eng LSTM fast; lang data cached in /tmp (writable on Vercel),
        // fetched from the tessdata CDN on first use (~15 MB, one-off).
        // PSM 3 auto + preserved interword spacing reads statement tables best.
        worker = await createWorker("eng", 1, { cachePath: "/tmp/eis-tess", gzip: true });
        await worker.setParameters({ preserve_interword_spaces: "1" });
      }
      const { data } = await worker.recognize(img);
      return data?.text ?? null;
    };

    const parts: string[] = [];
    let truncated = false;
    let grayWorkerAllowed = true; // budget guard for the second variant
    for (let i = 0; i < pages.length; i++) {
      if (Date.now() - started > MAX_OCR_SECONDS * 1000) {
        truncated = true;
        break;
      }
      const colorText = await ocrOne(pages[i]);
      let best = colorText ?? "";
      if (
        grayFor &&
        grayFor[i] &&
        grayWorkerAllowed &&
        (tryGrayEverywhere || txLineCount(best) < 3) &&
        Date.now() - started < MAX_OCR_SECONDS * 1000
      ) {
        const grayText = await ocrOne(grayFor[i]);
        if (grayText && txLineCount(grayText) > txLineCount(best)) best = grayText;
        if (Date.now() - started > MAX_OCR_SECONDS * 1000) grayWorkerAllowed = false;
      }
      if (best) parts.push(best);
    }
    const text = normalizeOcrAmounts(parts.join("\n").replace(/\u0000/g, "")).trim();
    if (text.replace(/[^A-Za-z0-9]/g, "").length < 100) return null;
    return { text, pages: parts.length, truncated };
  } catch {
    return null;
  } finally {
    const w = worker as Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null;
    try {
      await w?.terminate();
    } catch {
      /* ignore */
    }
  }
}

/**
 * OCR a direct image upload (JPG/PNG bytes) — single-image variant of the
 * shadow stage. Returns null when the image yields too little text.
 */
export async function ocrImageText(buf: Buffer): Promise<OcrOutcome | null> {
  const started = Date.now();
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng", 1, { cachePath: "/tmp/eis-tess", gzip: true });
    const { data } = await worker.recognize(buf);
    const text = normalizeOcrAmounts((data?.text ?? "").replace(/\u0000/g, "")).trim();
    if (text.replace(/[^A-Za-z0-9]/g, "").length < 100) return null;
    return { text, pages: 1, truncated: Date.now() - started > MAX_OCR_SECONDS * 1000 };
  } catch {
    return null;
  } finally {
    try {
      await worker?.terminate();
    } catch {
      /* ignore */
    }
  }
}
