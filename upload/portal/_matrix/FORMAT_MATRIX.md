# Global EIS — Statement Format Matrix (Parser Knowledge v3.0)

Status after the full-format matrix campaign (2026-09-28), the vision
upgrade (OCR v3.1) and the 100%-vision grind (OCR v3.2 / engine
eis-ts/3.0). This file is the single source of truth shared between
the PORTAL ENGINE (src/lib/analyze.ts) and the OPERATOR/AGENT — both must
stay in sync. Every claim below is verified against the live corpus by
`scripts/corpus_inventory.ts` (matrix JSON:
`upload/portal/_matrix/inventory.json`).

## Layout families (dispatch order matters)

| Mode | Family | Recognized by | Chain strategy |
|------|--------|---------------|----------------|
| B-internet | CIB Internet Banking export | "Internet Banking Account Statement" + Account Number inline | ascending chain from stated Opening Balance; glued-amount rejoin for wrapped lines |
| C-digital | CIB digital-banking export (newest-first) | "Customer Id Account Number … From Date To Date" header run | delta vs next (older) row; oldest row vs header opening |
| D-glued | CIB branch statement (glued text) | [balance?][movement] glued to DDMMMYY + OPENING BALANCE / C.I.B | inter-anchor segment solve: keyword-sign pass, then brute-force sign search (≤18 unknowns) |
| E-intl-bilingual | C.T.BANK bilingual "STATEMENT OF ACCOUNT" | header + yy/mm/dd anchors | walkLedgerAmounts (movement,balance pairs, junk-skipping) |
| M-misr-historical | Banque Misr Historical Statement (incl. photo scans) | "Historical Statement from / TXT_TXN_DESC / Balance after Trans" | lineTableRows primary (one row per OCR line) + walk + anchor blocks, best-of; solveRowsSearch branching repair |
| A2-aaib | AAIB statement (CamScanner scans) | Booking Date + Closing Balance + Value Date (structural — a bank-name MENTION alone must NOT claim) | lineTableRows primary + walk + anchor blocks, best-of; OCR-tolerant chain |
| A-branch | CIB branch (layout-extracted text) | inline "Account Number: <digits>" + dd/mm/yyyy rows | per-row delta chain, resync to stated balances |
| F-cib-estatement | CIB e-statement web export (column-interleaved pdf.js text) | Account Statement + Movement Details + BackOffice + Related | **set-based best-of search**: tokens partitioned into balances (chain-ordered) + movements (value-consumed); cross-page carry; re-link; per-sub-statement legs |
| Z-ocr-ledger | generic OCR fallback (last resort) | only when ocr=true and nothing else claims | strict walk; refuses unless everything reconciles |

## Layout F details (the hard-won lesson)

pdf.js emits this family's text layer COLUMN-INTERLEAVED with a merge order
that varies PER PAGE (alternating mov/bal, column-blocked, sometimes rows
printed out of ledger order). Amounts may split across lines
("1,688,999. 55", "2,127,\n461.49") — healSplitAmounts() rejoins them.
Statement dates print as "dd/mm/20" + the year's tail wrapped on a later
line ("26") — expandFDate() resolves the true year from the sub-statement
period. One PDF may concatenate several sub-statements whose chains do NOT
continue across the boundary ("Account Details - From:" restart) — the
parser emits ONE LEG PER SUB-STATEMENT so every leg verifies at full chain
integrity. The sign of a segment's first row is the only unforced choice —
resolved by the opening heuristic (prefer non-negative, else larger).

## D-glued two-pass lesson (loan families)

"Reimbursement of Interest" on a CIB loan account is a DEBIT even though
the keyword looks like a credit. The segment solver therefore runs two
passes: pass 1 trusts strong keyword signs; when the segment cannot
reconcile, pass 2 demotes every keyword row back into the brute-force sign
search — the bank's balance delta decides, keywords only order the search.

## Vision/OCR lessons (v3.1 — the scan campaign)

1. ENGINE PLURALITY: the native tesseract CLI (better LSTM, ~3x faster) and
   tesseract.js WASM read the SAME scan differently — the CLI read the AAIB
   35p scan column-scrambled where WASM read it row-wise; the reverse
   happened elsewhere. The engine runs a document-level fallback chain
   (color-fusion → gray → wasm) and the PARSERS judge: keep whichever text
   yields more chain-verified rows. Never trust a text-shape heuristic.
2. RASTER COLOR vs GRAY: neither wins everywhere — grayscale washed out
   rows under security watermarks on one Banque Misr scan (a whole
   28/04→14/06 block) while gray beat color on its page 3. Color first,
   gray re-read for thin pages, per-page txLineCount selection.
3. LINE PAIRING: OCR tables print ONE transaction per line —
   "<date> <ref/desc> [movement] balance". Date-less continuation rows are
   their OWN row (their date cell was eaten), never merged into the
   previous date's block (block last-two pairing silently dropped whole
   fee/transfer rows). Balance = LAST decimal amount on the line.
4. BRANCHING REPAIR: a damaged row often offers TWO plausible 1-digit
   fixes (movement-fix vs balance-fix). Greedy picks wrong; the solver
   branches and lets the DOWNSTREAM chain (lookahead 6) decide. Zero-run
   (pow10) candidates cover dropped zeros — never on fee/charge rows.
5. JOINT BACK-REPAIR: sometimes the PREVIOUS verified row's balance carries
   the 2-digit damage. Revised prev must re-satisfy its own movement chain
   AND sit within 2-digit tolerance (double-locked) before both rows verify.
6. FRAGMENT STABILITY: a failed fragment re-syncs the running balance to
   garbage and can make the NEXT fragment verify as a "position row".
   dropOcrFragments (factor-far balances dropped) + solveDropStable
   (solve→drop→re-solve to a fixed point) + chainOk reset per pass.
7. NUMBER DAMAGE CATALOGUE (normalizeOcrAmounts — all verified on the live
   corpus): dot-thousands 317.391.33; split cents 245.609 63 / 5.634 00;
   loose-separator cents 33.029-86 / 132.229. 43; European 440.710,33 /
   50-000,00; colon/hyphen thousands 277:225.43 / 275-705.13; space-cents
   122274 11; space-grouped 100 622 51 / 205,445 49; missing comma
   71.27935; space-thousands 44 602.92; hyphen-cents 3630-00 (date-gated);
   double-dot 6.00.00 (chain pow10 re-scales); stamp ink 5§08; letter-lead
   A50,047.36; bare-integer balance tails 13473192 → 134,731.92
   (date-anchored rows only, 6-9 digits).
8. MOVEMENT-NULL rows verify only when |Δ| ≤ 10% of the running balance
   (fees/checkpoints verify; destroyed tokens stay honest-unverified).
9. Reference-fragment lines ("Contact CIB.151390.1401.01032026-…",
   "Trx ID: …") carry decimal-shaped pieces of reference numbers — filtered
   before pairing so they cannot hijack balances.

## The 100% grind (v3.0 engine lessons — all three scans hit 100%)

10. CHAIN-TRUST REPAIR (the big lever): when both 1-digit repairs AND the
    joint back-repair fail, the damage spans ≥2 digits of one token — the
    bank's balance sequence is the ground truth, double-locked by requiring
    the repaired row to chain AND ≥1 downstream row to verify from the
    repair (lookahead-scored, threshold ≥ 2). Three candidates:
      C1  sane balance, damaged movement → movement := |Δ|
          ("2»200.00" was really 2,202.20 — only the delta knew)
      C2  destroyed balance, intact movement → balance := prev ± mv
          ("15,700.00 ae" rows where the scan ate the balance token)
      C0  movement token destroyed entirely (mv=null) → same trust as C1
          ("?-000,00" rows — the chain knows the movement even when the
          token is gone)
11. METADATA FRAGMENT FILTERS: card/ATM receipts print continuations under
    the real row that OCR splits onto their own lines — they must never
    become rows: an amount GLUED to a slash-date ("92102.08/25/2026,EG"),
    an amount + "Card" ("P 4000.00,Card 2082"), and ATM-acquirer serial
    tails ("818,APP 584263.623" — ungrouped 4+-digit head with a 3+-decimal
    tail; real amounts print 2 decimals + thousands grouping). Wrapped REAL
    balances on metadata lines ("NBE22040006 NBE A   73,007.45") end in .dd
    and survive the filter.
12. CHAIN-GAP TARGETED RE-OCR: ocrPdfText now returns per-page texts and
    lineTableRows stamps srcLine on every row — unverified rows map back to
    their page, ONLY those pages re-OCR at 500 DPI with PSM 3+6 (color and
    gray), the replacement splices into the page text, and the parsers
    re-judge the spliced document (shared helper ocrChainGapRetry — engine
    and grind tooling behave identically). A replacement page is kept only
    when it verifies MORE rows without inflating the row set.
13. NEW DAMAGE FORMS (normalizeOcrAmounts): hyphen-thousands + space-cents
    "250-609 63" / "120-753 46" → 250,609.63 / 120,753.46; ink-separator
    thousands "2»200.00" → 2,200.00; bare European cents "7,50" → 7.50
    (runs LAST — grouped forms are already normalized so "50,000.00" and
    friends can never reach it).
14. OCR PAGE CACHE (env OCR_CACHE_DIR): keyed by pdf md5 + page + dpi +
    variant + engine + PSM — the grind re-runs documents many times while
    rules iterate; unchanged pages replay instantly. Off unless the env is
    set; production unaffected.
15. Lock-parity e2e methodology (repeatable): archive the outbox, set
    TEST_MAIL_TO to the suite's sanctioned target, restart the dev server,
    run, then restore the permanent lock and re-archive. The FORBIDDEN
    address is never touched; the outbox mixes runs otherwise.

## Verified corpus results (2026-09-28, engine eis-ts/3.0)

| File | Kind | Mode | Integrity |
|------|------|------|-----------|
| 23c4540a-….pdf | text | B-internet | 100% (97/97) |
| Current-1786448428276.pdf | text | C-digital | 100% (7/7) |
| Saving-1786448365999.pdf | text | C-digital | 100% (79/79) |
| E1A57603-….pdf | text | E-intl-bilingual | 100% (506/506) |
| MOhamed Bank statement.pdf | text | D-glued | 100% (729/729) |
| Statements_28FEB26_to_31AUG26.pdf | text | D-glued | 100% (1098/1098) |
| drive_uk_tourism/Statements_29MAR26_to_29AUG26.pdf | text | D-glued | 100% (446/446) |
| drive_haytham/CIB EGP/EUR/USD PDFs ×3 | text | F-cib-estatement | 100% (2 legs each: 84+106, 13+12, 33+19) |
| drive_haytham/egp_l.txt, eur_l.txt, usd_l.txt | text | A-branch | 100% (190, 25, 52) |
| GlobalEIS_Report_*.pdf (×2) | text | — | correctly REFUSED (not statements — negative control) |
| Pasted Content_….txt | text | — | correctly REFUSED (AI-chat transcript — negative control) |
| 1.pdf (24p) | scan | OCR:M-misr-historical | **100% (491/491)** — was 67% before the grind |
| CamScanner 15-09-2026….pdf (3p) | scan | OCR:M-misr-historical | **100% (54/54)** (shadow draft) |
| كشف الحساب.pdf (35p) | scan | OCR:A2-aaib | **100% (440/440)** via WASM engine fallback (shadow draft) |

## Engine outcome contract

- Text statement, 100% chain integrity on EVERY leg → report published +
  case DONE + client delivery mail in one tap (AUTO_DELIVER_MIN=1).
- ANY leg below 100% → draft parked for review + operator mail (never
  silently delivered).
- OCR-sourced legs → shadow mode: NEVER auto-delivered even at 100%;
  draft carries the OCR watermark, analyst reviews.
- No layout claims the document → red "needs manual" + re-upload nudge
  link; evidence stored in ParseLog for the next parser iteration.

## E2E acceptance (2026-09-28, v3.0)

- `scripts/test_matrix_e2e.py` — 29/29 PASS (live HTTP: F multi-leg green
  auto-DONE, UK green auto-DONE, scan OCR draft at min/avg=100/100, red
  case, mail-lock safety).
- `scripts/test_full_cycle.py` — 51/51 PASS under the lock-parity
  methodology (auth, signed tokens, upload validation, engine lifecycle
  green/OCR-draft/red, reports, statement views, queue, outbox parity, DB
  integrity).
- Scan integrity summary: 1.pdf 491/491, CamScanner 54/54, AAIB 440/440 —
  every corpus statement (text AND image) now verifies at 100% chain
  integrity; the two negative controls still correctly refuse.

## Discipline reminders

- `a.imam@beta.com.eg` is FORBIDDEN as a test target — the TEST_MAIL lock
  (`TEST_MAIL_TO` in .env) must stay ON in local/dev runs.
- Default dual-role test inbox: ahmedr.muhammed19@gmail.com
  (paulmero5@gmail.com allowed for tour runs via env).
