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
  return Number.isFinite(v) && v > 0 ? v : 95;
})();
const MIN_PAGE_JPEG_BYTES = 8 * 1024; // stamps/logos are far smaller than statement pages

export interface OcrOutcome {
  text: string;
  pages: number;
  truncated: boolean;
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
 * Returns JPEG buffers in page order.
 */
async function rasterizePdf(buf: Buffer, max: number): Promise<Buffer[] | null> {
  if (process.env.PDF_RASTER !== "1") return null;
  const dir = await mkdtemp(path.join(tmpdir(), "eis-raster-"));
  const pdfPath = path.join(dir, "in.pdf");
  try {
    await writeFile(pdfPath, buf);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "pdftoppm",
        ["-png", "-gray", "-r", "300", "-f", "1", "-l", String(max), pdfPath, path.join(dir, "pg")],
        { timeout: 240_000 },
        (err) => (err ? reject(err) : resolve())
      );
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
 * OCR image-only PDF bytes into text. Returns null when the PDF carries a
 * usable text layer handled elsewhere, has no OCR-able page images, or OCR
 * recovers too little text to be worth parsing.
 */
export async function ocrPdfText(buf: Buffer): Promise<OcrOutcome | null> {
  // Raster-first when poppler is available (deterministic full-page coverage
  // for every encoding — JBIG2, JPX, masks); embedded-JPEG extraction stays
  // as the fallback (and the only path on serverless without poppler).
  let jpegs: Buffer[] | null = await rasterizePdf(buf, MAX_OCR_PAGES);
  if (!jpegs || jpegs.length === 0) jpegs = extractPageJpegs(buf);
  if (!jpegs || jpegs.length === 0) return null;

  const started = Date.now();
  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    // eng LSTM fast; lang data cached in /tmp (writable on Vercel), fetched
    // from the tessdata CDN on first use (~15 MB, one-off per warm instance).
    // PSM 3 auto + preserved interword spacing reads statement tables best.
    worker = await createWorker("eng", 1, {
      cachePath: "/tmp/eis-tess",
      gzip: true,
    });
    await worker.setParameters({ preserve_interword_spaces: "1" });
    const parts: string[] = [];
    let truncated = false;
    for (let i = 0; i < jpegs.length; i++) {
      if (Date.now() - started > MAX_OCR_SECONDS * 1000) {
        truncated = true;
        break;
      }
      const { data } = await worker.recognize(jpegs[i]);
      if (data?.text) parts.push(data.text);
    }
    const text = parts.join("\n").replace(/\u0000/g, "").trim();
    if (text.replace(/[^A-Za-z0-9]/g, "").length < 100) return null;
    return { text, pages: parts.length, truncated };
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
    const text = (data?.text ?? "").replace(/\u0000/g, "").trim();
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
