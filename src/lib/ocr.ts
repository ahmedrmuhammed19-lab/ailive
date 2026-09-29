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
import { createHash } from "crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { deflateSync, inflateSync } from "zlib";

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
export interface OcrOutcome {
  text: string;
  pages: number;
  truncated: boolean;
  /**
   * Per-page recovered text (parallel to the page images, after the same
   * amount normalization). Enables CHAIN-GAP TARGETED RE-OCR: unverified
   * rows map back to their page, only those pages are re-read at higher
   * DPI / other page-segmentation modes, and the parsers judge whether the
   * replacement text chain-verifies more rows.
   */
  pageTexts?: string[];
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

async function ocrPageViaCli(img: Buffer, psm = 3): Promise<string | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "eis-cli-"));
  const imgPath = path.join(dir, "pg.img");
  try {
    await writeFile(imgPath, img);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "tesseract",
        [imgPath, "stdout", "--psm", String(psm), "-l", "eng"],
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
 * Optional per-page OCR result cache (env OCR_CACHE_DIR) — the 100% grind
 * re-runs the same document many times while parser/solver rules iterate;
 * re-OCRing unchanged pages wastes the budget. Key covers EVERYTHING the
 * result depends on: pdf bytes (md5), page index, dpi, raster variant,
 * engine and page-segmentation mode. Tesseract is deterministic per input,
 * so a hit reproduces the run byte-for-byte. Env-gated: production ignores
 * the cache unless OCR_CACHE_DIR is set.
 */
type OcrEngineId = "cli" | "wasm";
const pageCacheDir = process.env.OCR_CACHE_DIR ?? null;
const pdfMd5Cache = new WeakMap<Buffer, string>();
async function pdfMd5(buf: Buffer): Promise<string> {
  const hit = pdfMd5Cache.get(buf);
  if (hit) return hit;
  const h = createHash("md5").update(buf).digest("hex");
  pdfMd5Cache.set(buf, h);
  return h;
}
async function ocrPageCached(
  docKey: string,
  pageIdx: number,
  img: Buffer,
  meta: { dpi: number; gray: boolean; engine: OcrEngineId; psm: number },
  run: () => Promise<string | null>
): Promise<string | null> {
  if (!pageCacheDir) return run();
  const file = path.join(
    pageCacheDir,
    `${docKey}-p${pageIdx}-r${meta.dpi}-${meta.gray ? "g" : "c"}-${meta.engine}-psm${meta.psm}.txt`
  );
  try {
    return await readFile(file, "utf8");
  } catch {
    /* fall through to run */
  }
  const text = await run();
  if (text !== null) {
    try {
      await writeFile(file, text);
    } catch {
      /* cache is best-effort */
    }
  }
  return text;
}

/**
 * Extract embedded page images (image XObjects) from raw PDF bytes.
 * Byte-level by design: works regardless of encryption-free writer quirks,
 * needs zero deps, and keeps only real page-sized photos (area heuristic).
 *
 * LESSON (eslam-scan campaign): scanners and PDF writers wrap page photos in
 * several filter chains. The extractor decodes every common one natively —
 *   /DCTDecode                     -> the bytes ARE the JPEG
 *   [/ASCII85Decode /DCTDecode]    -> armor first (reportlab default), then JPEG
 *   [/FlateDecode /DCTDecode]      -> inflate, then JPEG
 *   /FlateDecode (raw bitmap)      -> inflate -> reconstructed PNG (RGB/Gray,
 *                                     with or without PNG predictors)
 * CCITT/JPX/JBIG2 stay out of scope — those need the PDF_RASTER poppler path.
 * Returns image buffers (JPEG or PNG) in file order (== page order for
 * scan-style writers); tesseract reads both formats natively.
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

    // Full dictionary: from the "N 0 obj" that opens this object (header keys
    // like /Width /Filter /ColorSpace all live there) to the stream keyword.
    const objStart = latin.lastIndexOf(" obj", dictMatch.index);
    const dictFrom = objStart === -1 ? Math.max(0, dictMatch.index - 600) : objStart;
    const streamStart = latin.indexOf(marker, dictMatch.index);
    if (streamStart === -1) break;
    const dict = latin.slice(dictFrom, streamStart);
    // Actual data begins after "stream" + EOL (PDF spec: CRLF or LF)
    let dataStart = streamStart + marker.length;
    if (latin[dataStart] === "\r") dataStart++;
    if (latin[dataStart] === "\n") dataStart++;
    const end = latin.indexOf("endstream", dataStart);
    if (end === -1) break;

    const img = decodeImageStream(dict, buf.subarray(dataStart, end));
    if (img && img.length >= MIN_PAGE_JPEG_BYTES) {
      out.push(Buffer.from(img)); // copy — subarray keeps the whole parent alive
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

// ---------- image-XObject codec decoding (see extractPageJpegs) ----------

const MIN_PAGE_JPEG_BYTES = 8 * 1024; // stamps/logos are far smaller than statement pages

/** Minimal crc32 for PNG chunks (zlib.crc32 is not portable across runtimes). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Decode an ASCII85 stream (PDF ASCII85Decode: big-endian base-85 groups,
 * 'z' == zero group, optional "<~" prefix and "~>" EOD, whitespace ignored).
 * The "~>" EOD is cut FIRST so trailing PDF scaffolding ("endstream" etc.)
 * can never be decoded as data — bytes must match the embedded image exactly.
 */
function ascii85Decode(data: Buffer): Buffer | null {
  let s = data.toString("latin1");
  const eod = s.indexOf("~>");
  if (eod !== -1) s = s.slice(0, eod);
  s = s.replace(/^[^!-uz]*<~/, "").replace(/[^!-uz]/g, "");
  const out: number[] = [];
  let group: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      let v = 0;
      for (const d of group) v = v * 85 + d;
      if (v > 0xffffffff) return null;
      out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      group = [];
    }
  }
  if (group.length > 0) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const d of group) v = v * 85 + d;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    out.push(...bytes.slice(0, n - 1));
  }
  return Buffer.from(out);
}

function dictInt(dict: string, key: string): number | null {
  const m = dict.match(new RegExp(`/${key}\\s+(-?\\d+)`));
  return m ? parseInt(m[1], 10) : null;
}

/** Reconstruct a PNG from a PDF Flate raw bitmap (post-inflate). */
function flateRawToPng(
  raw: Buffer,
  w: number,
  h: number,
  colorspace: string,
  predictor: number | null
): Buffer | null {
  if (!w || !h || w <= 0 || h <= 0 || w * h > 40_000_000) return null;
  const channels = /DeviceGray/i.test(colorspace) ? 1 : /DeviceRGB/i.test(colorspace) ? 3 : null;
  if (!channels) return null; // CMYK/Indexed/ICB — out of scope
  const colorType = channels === 1 ? 0 : 2;
  const rowLen = w * channels;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits per component
  ihdr[9] = colorType;
  let idat: Buffer;
  if (predictor !== null && predictor >= 10) {
    // PNG predictors: the inflated bytes ARE filtered scanlines — pass through
    if (raw.length < h * (rowLen + 1)) return null;
    idat = deflateSync(raw.subarray(0, h * (rowLen + 1)));
  } else {
    // raw bitmap: prefix every row with filter byte 0 (None)
    if (raw.length < h * rowLen) return null;
    const rows = Buffer.alloc(h * (rowLen + 1));
    for (let y = 0; y < h; y++) {
      rows[y * (rowLen + 1)] = 0;
      raw.copy(rows, y * (rowLen + 1) + 1, y * rowLen, (y + 1) * rowLen);
    }
    idat = deflateSync(rows);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Filter chain tokens from an image-XObject dictionary ("[ /A85 /DCT ]" etc). */
function dictFilters(dict: string): string[] {
  const arr = dict.match(/\/Filter\s*\[([^\]]*)\]/);
  if (arr) return [...arr[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1]);
  const one = dict.match(/\/Filter\s*\/([A-Za-z0-9]+)/);
  return one ? [one[1]] : [];
}

/**
 * Decode an image-XObject stream into a tesseract-readable image buffer
 * (JPEG when a DCT terminal filter is present, else reconstructed PNG).
 * Returns null for unsupported codecs (CCITT/JPX/JBIG2 -> rasterizer path).
 */
function decodeImageStream(dict: string, data: Buffer): Buffer | null {
  const filters = dictFilters(dict);
  let cur: Buffer | null = data;
  for (const f of filters) {
    if (!cur) return null;
    if (/^DCTDecode$/i.test(f)) {
      // terminal: the current bytes are the JPEG
      return cur.length >= 2 && cur[0] === 0xff && cur[1] === 0xd8 ? cur : null;
    }
    if (/^ASCII85Decode$/i.test(f)) {
      cur = ascii85Decode(cur);
      continue;
    }
    if (/^FlateDecode$/i.test(f)) {
      try {
        const inflated = inflateSync(cur);
        const predictor = dictInt(dict, "Predictor");
        if (predictor !== null && predictor >= 10) {
          return flateRawToPng(
            inflated,
            dictInt(dict, "Columns") ?? dictInt(dict, "Width") ?? 0,
            dictInt(dict, "Rows") ?? dictInt(dict, "Height") ?? 0,
            dictInt(dict, "Colors") === 1 ? "DeviceGray" : "DeviceRGB",
            predictor
          );
        }
        return flateRawToPng(
          inflated,
          dictInt(dict, "Width") ?? 0,
          dictInt(dict, "Height") ?? 0,
          dict.match(/\/ColorSpace\s*\/(\w+)/)?.[1] ?? "",
          null
        );
      } catch {
        return null;
      }
    }
    // A85 variant spelled with digits, LZW, RunLength — rare; bail to rasterizer
    return null;
  }
  // No filters at all: bare bitmap (pathological) — try PNG reconstruction
  if (filters.length === 0 && cur) {
    return flateRawToPng(
      cur,
      dictInt(dict, "Width") ?? 0,
      dictInt(dict, "Height") ?? 0,
      dict.match(/\/ColorSpace\s*\/(\w+)/)?.[1] ?? "",
      null
    );
  }
  return cur;
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
async function rasterizePdf(
  buf: Buffer,
  opts: { max: number; gray: boolean; dpi?: number; from?: number; to?: number }
): Promise<Buffer[] | null> {
  if (process.env.PDF_RASTER !== "1") return null;
  const { max, gray, dpi = 300, from = 1, to } = opts;
  const dir = await mkdtemp(path.join(tmpdir(), "eis-raster-"));
  const pdfPath = path.join(dir, "in.pdf");
  try {
    await writeFile(pdfPath, buf);
    const args = ["-png", "-r", String(dpi), "-f", String(from), "-l", String(to ?? max), pdfPath, path.join(dir, "pg")];
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
    // bare balance split by a space: "122274 11" → "122274.11"
    // (comma-grouped or 4+ digit head — never touches short date/time fragments)
    .replace(/\b(\d{1,3}(?:,\d{3})+|\d{4,9}) (\d{2})\b(?!\d)/g, "$1.$2")
    // fully space-grouped balance: "100 622 51" → "100,622.51"
    // (middle groups MUST be 3 digits so times like "10 30 45" never match)
    .replace(/\b(\d{1,3}) (\d{3}) (\d{2})\b(?!\d)/g, "$1,$2.$3")
    .replace(/\b(\d{1,3}) (\d{3}) (\d{3}) (\d{2})\b(?!\d)/g, "$1,$2,$3.$4")
    // missing thousands comma before a long decimal tail: "71.27935" → "71,279.35"
    .replace(/\b(\d{1,3})\.(\d{3})(\d{2})\b/g, "$1,$2.$3")
    // space thousands + dot cents: "44 602.92" → "44,602.92"
    .replace(/\b(\d{1,3}) (\d{3})\.(\d{2})\b/g, "$1,$2.$3")
    // hyphen-thousands + space cents: "250-609 63" → "250,609.63",
    // "120-753 46" → "120,753.46" (the dash misread for the thousands comma,
    // then the cents split off — distinct from dd-mm-yy date shapes)
    .replace(/\b(\d{1,3})-(\d{3}) (\d{2})\b(?!\d)/g, "$1,$2.$3")
    // ink separator inside the thousands group: "2»200.00" → "2,200.00"
    // (guillemet/stamp mark misread for the comma; tail must be a full .cc)
    .replace(/\b(\d{1,3})[»«](\d{3}\.\d{2})\b/g, "$1,$2")
    // double-dot irregular: "6.00.00" — tesseract dropped a zero inside the
    // thousands group; the chain's pow10 repair handles the value, here we
    // only make the token PARSEABLE as movement+balance shape: 6.00.00 → 600.00
    // (parseable; the solver re-scales when the chain disagrees)
    .replace(/\b(\d{1,3})\.(\d{2})\.(\d{2})\b/g, "$1$2.$3")
    // dot-thousands (one or more 3-digit dot groups) followed by .cc
    .replace(/(?<=\d)(\.\d{3})+(?=\.\d{2}\b)/g, (m) => m.replace(/\./g, ","))
    // dot-thousands + loosely-separated cents — "33.029-86", "245.609 63",
    // "132.229. 43" — one flexible-separator rule (dot/dash/space run):
    .replace(/\b(\d{1,3}(?:\.\d{3})+)[\s.\-]+(\d{2})\b(?!\d)/g, (_m, head, cc) => `${head.replace(/\./g, ",")}.${cc}`)
    .replace(/\b(\d{1,3}(?:,\d{3})+)[\s.\-]+(\d{2})\b(?!\d)/g, (_m, head, cc) => `${head}.${cc}`)
    // colon or hyphen as the thousands separator, anchored by a .cc tail
    .replace(/\b(\d{1,3})[:-](\d{3})(?=\.\d{2}\b)/g, "$1,$2")
    // hyphen-joined cents with a 3-4 digit head: "3630-00" → "3,630.00"
    // (head must be 3+ digits and NOT followed by more hyphen-digits, so
    // dd-mm-yy dates never match)
    .replace(/\b(\d{3,4})-(\d{2})\b(?!\d)(?![-\d])/g, "$1.$2")
    // stray dot after the thousands comma: "508,.637,33"
    .replace(/,\.(?=\d{3}\b)/g, ",")
    // hyphen-thousands with comma cents: "50-000,00"
    .replace(/\b(\d{1,3})-(\d{3})(?=,\d{2}\b)/g, "$1,$2")
    // hyphen between short groups + dot cents: "14-44.29" → "1444.29" (chain judges)
    .replace(/\b(\d{1,2})-(\d{2})\.(\d{2})\b/g, "$1$2.$3")
    // European dot-thousands + comma cents: "440.710,33" → "440,710.33"
    .replace(/\b(\d{1,3}(?:\.\d{3})+),(\d{2})\b/g, (_m, head, cc) => `${head.replace(/\./g, ",")}.${cc}`)
    // European comma-thousands + comma cents: "50,000,00" → "50,000.00"
    .replace(/\b(\d{1,3}(?:,\d{3})+),(\d{2})\b/g, (_m, head, cc) => `${head}.${cc}`)
    // bare European cents: "7,50" → "7.50" — a 1-3 digit head with a 2-digit
    // comma tail that NO grouped form matches (grouped forms are already
    // normalized above, so "50,000.00"/"2,200.00"/"1,501.50" never reach
    // this rule — their tails are followed by another digit). Runs late for
    // exactly that reason; the chain judges the resulting value.
    .replace(/\b(\d{1,3}),(\d{2})\b(?!\d)(?!\.\d)/g, "$1.$2");
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
    if (!preferGray && variant !== "gray") colorPages = await rasterizePdf(buf, { max: MAX_OCR_PAGES, gray: false });
    if (preferGray || variant !== "color") grayPages = await rasterizePdf(buf, { max: MAX_OCR_PAGES, gray: true });
    pages = preferGray ? grayPages : colorPages ?? grayPages;
  }
  if (!pages || pages.length === 0) pages = extractPageJpegs(buf);
  if (!pages || pages.length === 0) return null;
  const grayFor = colorPages && grayPages && !preferGray ? grayPages : null;
  const tryGrayEverywhere = grayFor !== null && variant === "both";
  // true when the MAIN raster is the gray one (cache meta must reflect the
  // actual image, else a preferGray pass would collide with the color pass)
  const mainIsGray = preferGray || !colorPages;

  const useCli = !opts?.forceWasm && process.env.OCR_FORCE_WASM !== "1" && (await hasTesseractCli());
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  const docKey = await pdfMd5(buf);
  try {
    const ocrOne = async (img: Buffer, i: number, gray: boolean): Promise<string | null> => {
      const engine: OcrEngineId = useCli ? "cli" : "wasm";
      return ocrPageCached(docKey, i, img, { dpi: 300, gray, engine, psm: 3 }, async () => {
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
      });
    };

    const pageTexts: string[] = [];
    let truncated = false;
    let grayWorkerAllowed = true; // budget guard for the second variant
    for (let i = 0; i < pages.length; i++) {
      if (Date.now() - started > MAX_OCR_SECONDS * 1000) {
        truncated = true;
        break;
      }
      const colorText = await ocrOne(pages[i], i, mainIsGray);
      let best = colorText ?? "";
      if (
        grayFor &&
        grayFor[i] &&
        grayWorkerAllowed &&
        (tryGrayEverywhere || txLineCount(best) < 3) &&
        Date.now() - started < MAX_OCR_SECONDS * 1000
      ) {
        const grayText = await ocrOne(grayFor[i], i, true);
        if (grayText && txLineCount(grayText) > txLineCount(best)) best = grayText;
        if (Date.now() - started > MAX_OCR_SECONDS * 1000) grayWorkerAllowed = false;
      }
      // per-page text — indexed by ORIGINAL page number (missing pages keep
      // their slot as "" so re-OCR targeting stays aligned)
      pageTexts.push(normalizeOcrAmounts(best.replace(/\u0000/g, "")).trim());
    }
    const text = pageTexts.join("\n");
    if (text.replace(/[^A-Za-z0-9]/g, "").length < 100) return null;
    return { text, pages: pageTexts.filter((t) => t.length > 0).length, truncated, pageTexts };
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

/**
 * CHAIN-GAP TARGETED RE-OCR (vision campaign lesson): when the document-level
 * parse leaves rows unverified, the damaged tokens are concentrated on a few
 * pages (stamps, watermarks, skew). Re-reading EVERY page wastes budget —
 * instead the caller maps unverified rows back to their pages and re-OCRs
 * only those, at higher DPI and with additional page-segmentation modes.
 *
 * For each requested page this rasterizes the page in COLOR and GRAY at
 * `dpi` (default 500 — dense scans need the extra pixels; 300 stays the
 * proven document default) and OCRs each raster with every requested PSM
 * (3 = auto layout, 6 = uniform text block that keeps table rows linear).
 * Candidates are ranked by transaction-shaped-line count — a TEXT SHAPE
 * heuristic is safe only for pre-ranking because the CALLER re-parses the
 * spliced document and the chain judges the final result.
 *
 * Returns a Map keyed by the 0-based page index with the best replacement
 * text per page ("" when nothing readable was recovered — the caller then
 * keeps the original page text). Honors the shared OCR time budget.
 */
export async function reocrPages(
  buf: Buffer,
  pageIdxs: number[],
  opts?: { dpi?: number; psms?: number[]; deadlineMs?: number }
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pageIdxs.length === 0) return out;
  const dpi = opts?.dpi ?? 500;
  const psms = opts?.psms ?? [3, 6];
  const deadline = opts?.deadlineMs ?? Date.now() + MAX_OCR_SECONDS * 1000;
  const useCli = process.env.OCR_FORCE_WASM !== "1" && (await hasTesseractCli());
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  const docKey = await pdfMd5(buf);
  try {
    const ocrOne = async (img: Buffer, psm: number, gray: boolean, idx: number): Promise<string | null> => {
      const engine: OcrEngineId = useCli ? "cli" : "wasm";
      return ocrPageCached(docKey, idx, img, { dpi, gray, engine, psm }, async () => {
        if (useCli) return ocrPageViaCli(img, psm);
        if (!worker) {
          const { createWorker } = await import("tesseract.js");
          worker = await createWorker("eng", 1, { cachePath: "/tmp/eis-tess", gzip: true });
          await worker.setParameters({ preserve_interword_spaces: "1" });
        }
        await worker.setParameters({ tessedit_pageseg_mode: String(psm) as never });
        const { data } = await worker.recognize(img);
        return data?.text ?? null;
      });
    };
    for (const idx of pageIdxs) {
      if (Date.now() > deadline) break;
      // 1-based page number for pdftoppm; rasterize color + gray separately
      const pageNo = idx + 1;
      const colorRaster = await rasterizePdf(buf, {
        max: 1,
        gray: false,
        dpi,
        from: pageNo,
        to: pageNo,
      });
      const grayRaster = await rasterizePdf(buf, {
        max: 1,
        gray: true,
        dpi,
        from: pageNo,
        to: pageNo,
      });
      const rasters: Array<{ img: Buffer; gray: boolean }> = [];
      if (colorRaster?.[0]) rasters.push({ img: colorRaster[0], gray: false });
      if (grayRaster?.[0]) rasters.push({ img: grayRaster[0], gray: true });
      // No rasterizer (Vercel serverless): fall back to the page's embedded
      // JPEG so the retry still works there (page alignment best-effort).
      if (rasters.length === 0) {
        const embedded = extractPageJpegs(buf, idx + 1);
        if (embedded[idx]) rasters.push({ img: embedded[idx], gray: false });
      }
      let best = "";
      let bestScore = -1;
      for (const { img, gray } of rasters) {
        for (const psm of psms) {
          if (Date.now() > deadline) break;
          const text = await ocrOne(img, psm, gray, idx);
          if (!text) continue;
          const normalized = normalizeOcrAmounts(text.replace(/\u0000/g, "")).trim();
          const score = txLineCount(normalized);
          if (score > bestScore) {
            bestScore = score;
            best = normalized;
          }
        }
      }
      out.set(idx, best);
    }
  } catch {
    /* best-effort — caller keeps original page texts */
  } finally {
    const w = worker as Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null;
    try {
      await w?.terminate();
    } catch {
      /* ignore */
    }
  }
  return out;
}
