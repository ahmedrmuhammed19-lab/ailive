# Global EIS — STANDING ORDERS (LOCKED RULEBOOK)

> **Single source of truth binding BOTH surfaces** — this chat AND the portal
> (published to the portal reports list as `Global_EIS_Standing_Orders.html`).
> The agent re-reads this file at the start of every session before doing
> anything. **Any edit the owner makes here IS an order.** Newer numbered
> orders override older ones. Nothing in section A may drift without a
> numbered order below.

---

## A. LOCKED RULES

**SO-1 · TEMPLATE LOCK**
Exactly one design system exists: `src/lib/report_design.ts`
(`reportShell`, `alertBox`, `kpiGrid`, `kpiCard`, `sectionTitle`, `tag`,
`escHtml` — tokens #005677 / #008DCB, Segoe UI). Every client-facing report,
ops note and portal artifact uses it verbatim. `scripts/report_template.html`
is the owner-supplied original — kept as provenance, read-only. All other
template variants are retired to `templates/retired/`. Creating or using any
other skin = violation.

**SO-2 · THREE-CHANNEL DELIVERY**
Every FINAL case report ships simultaneously:
1. **Chat** — full HTML rendered in the conversation;
2. **Mail** — inline body + attachment via `scripts/send_ops_report.ts`
   (`sendOrQueue`, outbox fallback);
3. **Portal** — `publish-report` endpoint (idempotent by filename).
A delivery without all three receipts is not "delivered".

**SO-3 · MAIL LOCK**
All mail is redirected to `TEST_MAIL_TO=ahmedr.muhammed19@gmail.com`
(guard in `src/lib/mail.ts` refuses any other SMTP recipient).
`a.imam@beta.com.eg` is **hard-forbidden** — never a recipient, never in any
body, header or attachment.

**SO-4 · CHAIN GATE**
No case report ships without its balance-chain verification printed in the
report: consecutive pairs closed (N/N), residual, and the opening/closing
anchor arithmetic. If the chain is below 100%, the report says so plainly
with the reason. Inflating a verification number is a hard violation.

**SO-5 · ORDER LEDGER**
Every owner order gets a row in section B: ID, date, order, status
(DONE / BLOCKED / SUPERSEDED), receipt. The agent appends; the owner can
overrule any row by editing it.

**SO-6 · WORKLOG**
Every task appends to `worklog.md` (template: Task ID / Agent / Task /
Work Log / Stage Summary) before the delivery is announced.

**SO-7 · HONESTY**
Never present a derived number as a printed one. Chain-derived rows are
disclosed with count and reason (current case: 14 rows, 4.5%).
An audit finding is disclosed even when embarrassing to the analyst.

**SO-8 · EXPECTATIONS (scan vs digital)**
Pure-scan statements: forensic analyst pass (hours, chain-derived disclosures
possible). Bank-issued digital PDFs: 100%-gate fast lane (minutes, glyph-exact).
The portal auto-runs the engine on upload (`AUTO_WORK`).

**SO-9 · PRE-DELIVERY GATE**
Before announcing any delivery, `scripts/delivery_gate.py <manifest>` must
PASS: template markers, chain block, mail lock, portal receipt, worklog row.
A failed gate blocks the announcement — fix, re-run, then deliver.

**SO-10 · VERIFICATION PASSPORT (nine gates, fail-loud)**
Every bank-statement report must carry a passport table listing gates G1–G9
with the ACTUAL measured values (not just "PASS"). A report ships only when
all gates pass; any gate that cannot be evaluated = FAIL (fail-loud, never
fail-silent; quarantine instead of guess).
- G1 SERIAL CENSUS — if the bank prints row serial numbers: every serial
  present exactly once, no gaps, no duplicates; parsed rows == printed rows.
- G2 STRICT CHAIN — per-row identity balance[i] = balance[i-1] ± amount[i],
  residual 0.00 exact on every row (not just opening→closing telescope).
- G3 PRINTED TOTALS — sum(parsed debits) == bank-printed debits AND
  sum(parsed credits) == bank-printed credits (the bank hands us two free
  independent sums — the 310-row absorption was invisible to chain alone but
  would have died here instantly).
- G4 ANCHORS — opening, closing, and b/f rows read at high DPI and matched
  against print (two independent print anchors minimum).
- G5 PAGE GRID — physical table-line bands (census) == parsed rows per page;
  every band maps to a row or a documented continuation/structural band.
- G6 DATE/CURRENCY MONOTONICITY — dates non-decreasing in print order;
  single currency; amount column signs consistent with column semantics.
- G7 TWO-PASS EXTRACTION — two independent OCR passes (different DPI/psm)
  must produce identical row sets; any diff = adjudication zone before ship.
- G8 RE-DERIVATION — every number in the report is regenerated from the
  verified row table by the generator; no hand-typed or copied numbers.
- G9 ADVERSARIAL AUDIT — auditor binds ≥2 bank-printed external evidences
  and actively hunts: unexplained residuals, round-number coincidences,
  suspiciously equal pairs (the NBE tells).
Rationale: a balance chain is ONE equation family (amount conservation). It
proves totals, not row completeness — a missing row's amount is silently
absorbed unless the chain is strict per-row AND the row census and printed
totals agree. G1+G2+G3 are mutually reinforcing: chain catches absorption
except exact-cancellation coincidences; census and printed totals catch those.

**SO-11 · STANDING MANDATE — ALL STATEMENTS**
Owner delegated ALL bank-statement work to Global EIS — the entire present
and future corpus, any bank, any language, any format. Every statement goes
through the same locked pipeline, no ad-hoc processing ever: census ->
parse -> strict per-row chain -> Verification Passport (SO-10, G1-G9) ->
locked template (SO-1) -> pre-delivery gate (SO-9) -> chat + portal
(+ mail on request, SO-3). Fail-loud always: a gate that cannot be
evaluated = FAIL = quarantine, never a silent best guess.

**SO-12 · WIPE HARDENING (track-or-rebuild)**
The sandbox periodically wipes untracked files (upload route lost 4×;
delivery_gate.py, publish_via_repo.py, mail creds, .env keys, and the NBE
v4 working state all lost 2026-10-06). Rule: every artifact needed for a
delivery must be EITHER git-tracked (force-add if gitignored) OR regenerable
by a tracked script from a tracked/on-disk source. After every work cycle:
force-track new gate/receipt/state files before announcing the delivery.
Final pipeline state JSONs (rows/solved/gates) are force-tracked at cycle end;
intermediate line-level files may stay untracked. `scripts/restore_env.sh`
restores .env + DB + seeds after any wipe; run it before working.

---

---

## B. ORDER LEDGER (append-only)

| ID | Date | Order | Status | Receipt |
|----|------|-------|--------|---------|
| ORD-1003-T1 | 2026-10-03 | "use our template as we decide" — one firm template | DONE | `src/lib/report_design.ts` adopted verbatim from owner's HTML |
| ORD-1005-M2 | 2026-10-05 | restore mail discipline after resets | DONE | TEST_MAIL_TO lock active; IMAP-verified sends (474 mails) |
| ORD-1005-RH1 | 2026-10-05 | "send a report here also" (ops) | DONE | chat + mail + portal, worklog REPORT-HERE-1 |
| ORD-1005-RH2 | 2026-10-05 | ops report rebuilt on firm template | DONE | v2 ops report, worklog REPORT-HERE-2 |
| ORD-1005-NR1 | 2026-10-05 | full NBE statement report, like previous | DONE | worklog NBE-REPORT-1; chat + mail + portal |
| ORD-1005-N100 | 2026-10-05 | "try anyway to get 100% balance chain" | DONE | **310/310 pairs closed, residual 0.00**, telescope 467,525.43→631,182.24 exact; v3 report 18:12Z, mail IMAP-verified, portal `{"ok":true}`; commit ccf90e1 |
| ORD-1006-C1 | 2026-10-06 | "more control between portal and here"; stop template churn; prove the chain verification | DONE | this file + `scripts/delivery_gate.py` + independent audit; audit found §4.1 omission → corrected as **v3.1** (same template, same verdict), re-delivered 3 channels |
| ORD-1006-C1a | 2026-10-06 | (agent-committed) §4.1 monthly table lacked the pre-March tail bucket | DONE | v3.1 adds implied bucket (26 rows, +46,615.92 / −280,259.18); flagged, not hidden |
| ORD-1006-H1 | 2026-10-06 | "you got some hallucination about of this report?" — audit it | DONE | semantic re-audit **S1–S7: 7 findings proven** (buckets 309≠310 · fee-mass 63.8% vs 0.1% law · +87,687 credit w/ outgoing desc · false "(OCR, cleaned)" · hold provenance · pass-count · §7→§6 pointer) → **v3.2 FINAL** with in-report Correction Register; A1–A13 still PASS; 3-channel delivery |
| ORD-1006-TL1 | 2026-10-06 | "generate a templates for each and send it here + upload it on reports portals" | DONE | Template Library v1.0 — 4 specimens (analysis / correction notice / standing orders / ops report) + library master, all on the locked `report_design.ts` (SO-1); portal `{"ok":true}` ×5; gate PASS; worklog TPL-LIBRARY-1; mail on request |
| ORD-1006-V12 | 2026-10-06 | "i guess 1.2master will be standard" | DONE | Master v1.2 promoted ADDITIVELY into `src/lib/report_design.ts` (single source intact, SO-1); 5 v1.2 artifacts on portal ×2 cycles (defect fix); worklog TPL-V12-STANDARD(-FIX) |
| ORD-1006-UP1 | 2026-10-06 | owner hit "File 1/1 (part 1/2): Upload failed (HTTP 404)" on portal | DONE | Root cause: 418-line `/api/upload` route lost AGAIN in lineage wipe (3rd loss); restored verbatim from 9fe9b1d; tsc 0 src errors; autowork 12/12; NEW `scripts/test_chunked_upload.py` reproduces owner's exact 2-chunk 6.5MB path — byte-exact reassembly PASS; prod live 21:50Z (400-alive, not 404); commit f73286b |
| ORD-1006-VP1 | 2026-10-06 | (agent-committed) "never fail in any bank statements" — double-checks that work WITH the balance chain | DONE | SO-10 Verification Passport (G1–G9) codified from the 310-row lesson; v4 NBE rebuild will ship with passport |

| ORD-1006-ALL1 | 2026-10-06 | "i'll depend on you for all my work, you will work on every bank statement i have" — standing mandate | ACCEPTED | SO-11 codified; corpus inventoried; NBE v4 running as first passport-flagship (worklog MANDATE-1) |

**Open items (owner side, no pressure — listed once):**
- Bank-issued **digital PDF** for this account → glyph-exact fast-lane confirmation AND closes the two open v3.2 disclosures (S2 fee mass reclassification, S3 counterparty/sign fix).
- Branch explanation of the **EGP 200,020.00 gap** — UPDATED by v4 print evidence (2026-10-06): p23 summary box prints Hold = 0.00 and the words-match 431,162.24 at snapshot 10/09/2026 7:16:30 PM (after period end); the 631,182.24 ledger close vs 431,162.24 snapshot gap is REAL but the bank does NOT label it as hold. v4 reports printed truth; branch clarification still welcome.
- cron-job.org activation for the queue auto-poll.
- Re-supply `config/mail_credentials.json` (SMTP key lost in the 2026-10-06 wipe; mail currently degrades to outbox mode).
- GitHub token for transport-repo publishing (lost in the same wipe) OR approve an alternative https host for publish URLs — needed before the next portal publish (`publish_via_repo.py` rebuild spec recorded in worklog AUDIT-1).
