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

**Open items (owner side, no pressure — listed once):**
- Bank-issued **digital PDF** for this account → glyph-exact fast-lane confirmation AND closes the two open v3.2 disclosures (S2 fee mass reclassification, S3 counterparty/sign fix).
- Branch explanation of the **EGP 200,020.00 hold** (identity-derived; printed first-read 200,030.00) at print time.
- cron-job.org activation for the queue auto-poll.
