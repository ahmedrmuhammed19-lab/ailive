/**
 * OCR probe — run ocrPdfText (the engine's real shadow-OCR stage) on a
 * fixture and show the recovered text. Usage:
 *   bun run scripts/probe_ocr.ts tests/e2e_fixtures/statement_scan_clean.pdf
 */
import { readFileSync } from "fs";
import { ocrPdfText } from "../src/lib/ocr";

const file = process.argv[2] ?? "/home/z/my-project/tests/e2e_fixtures/statement_scan_clean.pdf";
const buf = readFileSync(file);
const t0 = Date.now();
const ocr = await ocrPdfText(buf);
if (!ocr) {
  console.log("OCR NULL — nothing recovered");
  process.exit(1);
}
console.log(`pages=${ocr.pages} truncated=${ocr.truncated} ms=${Date.now() - t0}`);
console.log("--- recovered text ---");
console.log(ocr.text.split("\n").slice(0, 18).join("\n"));
const dates = ocr.text.match(/\d{2}\/\d{2}\/20\d{2}/g)?.length ?? 0;
console.log(`--- date anchors: ${dates}`);
