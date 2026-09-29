import { readFileSync, writeFileSync } from "fs";
import { extractPageJpegs } from "../src/lib/ocr";
const buf = readFileSync(process.argv[2] ?? "tests/e2e_fixtures/statement_scan_clean.pdf");
const pages = extractPageJpegs(buf);
console.log(`extracted pages: ${pages.length}, sizes: ${pages.map((p) => p.length).join(", ")}`);
if (pages[0]) writeFileSync("/tmp/extracted_p0.jpg", pages[0]);
