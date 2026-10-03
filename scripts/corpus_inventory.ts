/**
 * FULL-FORMAT MATRIX — step 1: corpus inventory.
 *
 * Walks every statement file in upload/ (top level + drive_* subdirs),
 * extracts the PDF text layer (unpdf — same lib the engine uses),
 * classifies TEXT vs SCAN, and runs the engine's parseCibText() dispatcher
 * on the text layer to record the winning layout family + chain integrity.
 *
 * Output: console table + JSON matrix at upload/portal/_matrix/inventory.json
 *
 * Run: bun scripts/corpus_inventory.ts
 */
import { readdir, stat, mkdir, writeFile } from "fs/promises";
import path from "path";
import { extractText, getDocumentProxy } from "unpdf";
import { parseCibTextMulti } from "@/lib/analyze";
import { ocrPdfText } from "@/lib/ocr";

const ROOT = "/home/z/my-project/upload";
const OUT_DIR = path.join(ROOT, "portal", "_matrix");
const OUT_JSON = path.join(OUT_DIR, "inventory.json");

async function listPdfs(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "portal" || e.name.startsWith("_")) continue; // outbox/matrix dirs
      out.push(...(await listPdfs(path.join(dir, e.name), rel)));
    } else if (/\.(pdf|txt)$/i.test(e.name) && !e.name.startsWith("MD5SUMS")) {
      out.push(rel);
    }
  }
  return out;
}

interface Row {
  file: string;
  kind: "text" | "scan" | "txt";
  textChars: number;
  pages: number;
  mode: string | null;
  txCount: number;
  matched: number;
  integrity: number | null;
  account: string | null;
  currency: string | null;
  opening: number | null;
  closing: number | null;
  period: string | null;
  note: string;
}

const rows: Row[] = [];
const rels = (await listPdfs(ROOT)).sort();
for (const rel of rels) {
  const abs = path.join(ROOT, rel);
  const row: Row = {
    file: rel, kind: "txt", textChars: 0, pages: 0, mode: null, txCount: 0,
    matched: 0, integrity: null, account: null, currency: null, opening: null,
    closing: null, period: null, note: "",
  };
  try {
    if (rel.toLowerCase().endsWith(".txt")) {
      const t = await (await import("fs/promises")).readFile(abs, "utf8");
      row.textChars = t.replace(/[^A-Za-z0-9]/g, "").length;
      const legs = parseCibTextMulti(t, rel);
      if (legs.length > 0) fill(legs[0], legs.length);
      else row.note = "txt: no layout claimed";
      rows.push(row);
      continue;
    }
    const buf = new Uint8Array(await (await import("fs/promises")).readFile(abs));
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    row.pages = pdf.numPages ?? 0;
    row.textChars = merged.replace(/[^A-Za-z0-9]/g, "").length;
    row.kind = row.textChars >= 240 ? "text" : "scan";
    const legs = parseCibTextMulti(merged, rel);
    if (legs.length > 0) {
      fill(legs[0], legs.length);
    } else if (row.kind === "scan") {
      // OCR stage — the SAME path the engine uses (raster + tesseract,
      // document-level engine fallback, chain-guided pipeline), so this
      // matrix is a true regression probe of the vision pipeline.
      const ocr = await ocrPdfText(Buffer.from(await (await import("fs/promises")).readFile(abs)));
      if (ocr && ocr.text.trim().length > 40) {
        const olegs = parseCibTextMulti(ocr.text, rel, true);
        if (olegs.length > 0) {
          // aggregate across legs: the document verifies as a whole
          const tx = olegs.reduce((s, l) => s + l.txCount, 0);
          const m = olegs.reduce((s, l) => s + l.matched, 0);
          row.mode = `OCR:${olegs[0].mode ?? "unknown"}${olegs.length > 1 ? ` x${olegs.length}legs` : ""}`;
          row.txCount = tx;
          row.matched = m;
          row.integrity = tx ? Math.round((m / tx) * 100) : null;
          row.account = olegs[0].account;
          row.currency = olegs[0].currency;
          row.opening = Math.round(olegs[0].opening * 100) / 100;
          row.closing = Math.round(olegs[olegs.length - 1].closing * 100) / 100;
          row.period = olegs[0].period;
          row.note = ocr.truncated ? "ocr truncated (page/time budget)" : "";
        } else {
          row.note = "scan: OCR ran, no layout claimed";
        }
      } else {
        row.note = "scan: OCR returned nothing";
      }
    } else {
      row.note = "text: no layout claimed";
    }
  } catch (err: unknown) {
    row.note = `ERROR: ${String(err).slice(0, 120)}`;
  }
  rows.push(row);

  function fill(
    leg: NonNullable<Awaited<ReturnType<typeof parseCibTextMulti>>>[number],
    legCount: number
  ) {
    row.mode = `${leg.mode ?? "unknown"}${legCount > 1 ? ` x${legCount}legs` : ""}`;
    row.txCount = leg.txCount;
    row.matched = leg.matched;
    row.integrity = leg.txCount ? Math.round((leg.matched / leg.txCount) * 100) : null;
    row.account = leg.account;
    row.currency = leg.currency;
    row.opening = Math.round(leg.opening * 100) / 100;
    row.closing = Math.round(leg.closing * 100) / 100;
    row.period = leg.period;
  }
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_JSON, JSON.stringify(rows, null, 2), "utf8");

console.log(`FILE${" ".repeat(58)}KIND  CHARS  PAGES  MODE             TX   MATCH  INTEG  NOTE`);
console.log("-".repeat(150));
for (const r of rows) {
  const f = r.file.length > 58 ? r.file.slice(0, 55) + "..." : r.file.padEnd(58);
  const mode = (r.mode ?? "—").padEnd(16);
  const integ = r.integrity === null ? "—" : `${r.integrity}%`;
  console.log(
    `${f}${r.kind.padEnd(6)}${String(r.textChars).padEnd(7)}${String(r.pages).padEnd(7)}${mode}${String(r.txCount).padEnd(5)}${String(r.matched).padEnd(7)}${integ.padEnd(7)}${r.note}`
  );
}
const text = rows.filter((r) => r.kind === "text");
const scans = rows.filter((r) => r.kind === "scan");
const full = rows.filter((r) => r.integrity === 100);
console.log("-".repeat(150));
console.log(`TOTAL ${rows.length} files | text ${text.length} | scan ${scans.length} | 100% integrity ${full.length}`);
console.log(`Matrix JSON: ${OUT_JSON}`);
