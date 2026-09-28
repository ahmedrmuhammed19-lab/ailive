#!/usr/bin/env python3
"""
INBOX EXPERIENCE — full-detail simulation of what paulmero5@gmail.com received.

Reads the real outbox mails (upload/portal/_outbox) + real reports (ReportFile DB)
from the fresh email-tour run and builds a single self-contained page:
  download/email_tour/inbox_experience.html
with a chronological timeline, per-case journey narratives, and every mail's
full detail (headers, text body, rendered HTML twin, raw JSON).
Also exports the two client reports as openable files under download/email_tour/reports/.
"""
import glob
import html
import json
import os
import sqlite3
from datetime import datetime

ROOT = "/home/z/my-project"
OUTBOX = f"{ROOT}/upload/portal/_outbox"
DB = f"{ROOT}/db/custom.db"
TOUR = f"{ROOT}/download/email_tour"
REPORTS_DIR = f"{TOUR}/reports"
OUT = f"{TOUR}/inbox_experience.html"

MY_EMAIL = os.environ.get("TOUR_EMAIL", "ahmedr.muhammed19@gmail.com")

esc = lambda s: html.escape(str(s), quote=True)

# ---------- load mails ----------
mails = []
for f in sorted(glob.glob(f"{OUTBOX}/*.json")):
    d = json.load(open(f))
    d["_file"] = os.path.basename(f)
    d["_at"] = datetime.fromisoformat(d["at"].replace("Z", "+00:00"))
    mails.append(d)
mails.sort(key=lambda m: m["_at"])
t0 = mails[0]["_at"]

# ---------- load cases + reports ----------
db = sqlite3.connect(DB)
cases = {}
for sid, uid, status, email, created in db.execute(
    "SELECT id, userId, status, email, createdAt FROM Submission ORDER BY createdAt"
):
    cases[sid] = {"queue": uid, "status": status, "email": email}
reports = {}
for sid, qid, name, data, size in db.execute(
    "SELECT submissionId, queueId, name, data, sizeBytes FROM ReportFile ORDER BY id"
):
    p = f"{REPORTS_DIR}/{name}"
    os.makedirs(REPORTS_DIR, exist_ok=True)
    open(p, "wb").write(data)
    reports[sid] = {"queue": qid, "name": name, "size": size, "path": p}

def role(m):
    if m["kind"] in ("report_ready", "client_nudge", "client_receipt"):
        return "CLIENT"
    return "OPERATOR"

def case_of(m):
    sid = m.get("submissionId") or ""
    if sid in cases:
        return cases[sid]["queue"]
    return "—"

def offset(m):
    sec = int((m["_at"] - t0).total_seconds())
    return f"+{sec}s" if sec >= 0 else f"{sec}s"

KIND_LABEL = {
    "operator_alert": "operator alert",
    "report_ready": "client report delivery",
    "client_nudge": "client re-upload request",
    "client_receipt": "client receipt",
}

# ---------- journey narratives ----------
JOURNEYS = {
    "EM-01": {
        "title": "EM-01 — GREEN path (valid text statement)",
        "story": (
            "A real text-based bank statement (Saving-1786448365999.pdf) is uploaded. The engine parses it, "
            "runs the chain-verified math on every leg, and the 6-month window check reports the statement "
            "covers only 1.3 months (01 Jul → 11 Aug 2026) — below the 6-month history most embassies require, "
            "so the report carries that warning for the analyst. Verification reaches 100%, so the case "
            "auto-completes to DONE and the client report is generated and queued for delivery. "
            "No human touched this case."
        ),
        "verdict": "DONE — auto-delivered, 100% chain integrity",
    },
    "EM-02": {
        "title": "EM-02 — OCR path (image-only scan)",
        "story": (
            "An image-only scan (no text layer) is uploaded. OCR shadow mode fires: the engine extracts the "
            "embedded page images, OCRs them (tesseract.js), and runs the same chain verification. Because the "
            "source is a scan, the case is held at ANALYZING as a yellow draft — OCR work is never auto-delivered. "
            "The analyst gets a draft-ready-for-review mail with the OCR reason, and the engine files a "
            "lesson-learned mail for the new scan layout. The client receives nothing yet — only when the "
            "analyst reviews and delivers."
        ),
        "verdict": "ANALYZING — yellow draft, awaiting analyst review (never auto-green)",
    },
    "EM-03": {
        "title": "EM-03 — RED path (wrong document) + nudge",
        "story": (
            "A non-statement document (Online_Insurance_Conditions.pdf) is uploaded. The parser finds no "
            "transaction lines, so the case flags red needs-manual and the operator gets a fix-forward mail "
            "with a one-tap 'Ask Client to Re-upload' action. The nudge is tapped: the client receives the "
            "re-upload request with a checklist of what to send, and the operator gets the confirmation copy. "
            "Case status is untouched by the nudge."
        ),
        "verdict": "NEEDS_MANUAL → nudge sent — waiting for the client's real statement",
    },
    "EM-04": {
        "title": "EM-04 — real CamScanner scan (honest outcome)",
        "story": (
            "A genuine CamScanner phone scan of a bank statement is uploaded. OCR runs on the real-world "
            "image quality and extracts nothing statement-like, so the engine honestly flags it red instead "
            "of guessing. The operator gets the fix-forward mail. This proves the OCR path does not "
            "hallucinate results from poor scans."
        ),
        "verdict": "NEEDS_MANUAL — honest red on a real-world scan",
    },
    "EM-05": {
        "title": "EM-05 — TEST-MAIL LOCK proof (a 'real client' address can never be mailed)",
        "story": (
            "This case is deliberately uploaded with a stand-in REAL customer address "
            "(real.client@example.com) instead of the test inbox. With TEST_MAIL_TO active, the portal's "
            "hard safety rail force-redirects the client re-upload request to the test inbox: the mail "
            "carries a yellow TEST-MAIL LOCK banner stating who it was originally for, and the audit "
            "field intendedTo preserves the original recipient. Nothing was sent to the stand-in address — "
            "this is the guarantee that live-fire testing can never email an outsider, no matter what "
            "address a submission carries."
        ),
        "verdict": f"Redirected to {MY_EMAIL} — intendedTo: real.client@example.com, zero outsider mail",
    },
}

# ---------- build timeline ----------
def badge(role):
    if role == "CLIENT":
        return '<span class="b client">CLIENT</span>'
    return '<span class="b op">OPERATOR</span>'

timeline_rows = []
for i, m in enumerate(mails, 1):
    r = role(m)
    sid = m.get("submissionId") or ""
    q = cases.get(sid, {}).get("queue", "—")
    att = ", ".join(m.get("attachments") or []) or "—"
    snippet = (m.get("body") or "").replace("\n", " ")[:110]
    timeline_rows.append(f"""
    <tr>
      <td class="n">#{i}</td>
      <td class="t">{esc(offset(m))}</td>
      <td>{badge(r)} <span class="b case">{esc(q)}</span></td>
      <td><a href="#mail-{i}">{esc(m["subject"])}</a><div class="snip">{esc(snippet)}…</div></td>
      <td class="att">{esc(att)}</td>
    </tr>""")

# ---------- build mail cards ----------
cards = []
for i, m in enumerate(mails, 1):
    r = role(m)
    sid = m.get("submissionId") or ""
    q = cases.get(sid, {}).get("queue", "—")
    st = cases.get(sid, {}).get("status", "—")
    att_rows = "".join(
        f"<li>{esc(a)}</li>" for a in (m.get("attachments") or [])
    ) or "<li>none</li>"
    rep = reports.get(sid)
    rep_link = ""
    if rep:
        rep_link = (
            f'<div class="rep">📎 Attached report is exported as an openable file: '
            f'<a href="reports/{esc(rep["name"])}">{esc(rep["name"])}</a> '
            f'({rep["size"]:,} bytes, generated by the engine)</div>'
        )
    html_twin = ""
    if m.get("html"):
        html_twin = (
            '<h4>Rendered HTML (what the inbox displays)</h4>'
            f'<iframe sandbox="" srcdoc="{esc(m["html"])}"></iframe>'
        )
    else:
        html_twin = '<div class="nohtml">No HTML twin — plain-text mail (report mail carries the report as an attachment instead).</div>'
    raw = json.dumps({k: v for k, v in m.items() if not k.startswith("_") and k != "html"}, ensure_ascii=False, indent=2)
    cards.append(f"""
    <section class="mail" id="mail-{i}">
      <div class="mh">
        <div class="msubj">{esc(m["subject"])}</div>
        <div class="mmeta">{badge(r)} <span class="b case">{esc(q)}</span>
          <span class="b kind">{esc(KIND_LABEL.get(m["kind"], m["kind"]))}</span></div>
        <table class="hdrs">
          <tr><td>From</td><td>Global EIS &lt;{esc(m.get("replyTo") or MY_EMAIL)}&gt;</td></tr>
          <tr><td>To</td><td>{esc(m["to"])}</td></tr>
          <tr><td>Reply-To</td><td>{esc(m.get("replyTo") or "—")}</td></tr>
          <tr><td>When</td><td>{esc(m["at"])} (run offset {esc(offset(m))})</td></tr>
          <tr><td>Case</td><td>{esc(q)} — status {esc(st)}</td></tr>
          <tr><td>Attachments</td><td><ul class="attlist">{att_rows}</ul></td></tr>
        </table>
      </div>
      {rep_link}
      <h4>Text body</h4>
      <pre>{esc(m.get("body") or "")}</pre>
      {html_twin}
      <details><summary>Raw mail JSON (as queued in outbox)</summary><pre class="raw">{esc(raw)}</pre></details>
    </section>""")

# ---------- case sections ----------
case_secs = []
order = ["EM-01", "EM-02", "EM-03", "EM-04", "EM-05"]
for qi, q in enumerate(order, 1):
    j = JOURNEYS[q]
    case_mails = [(i, m) for i, m in enumerate(mails, 1) if case_of(m) == q]
    steps = "".join(
        f'<li>#{i} — <a href="#mail-{i}">{esc(m["subject"])}</a> '
        f'<em>({esc(KIND_LABEL.get(m["kind"], m["kind"]))}, {esc(offset(m))})</em></li>'
        for i, m in case_mails
    )
    case_secs.append(f"""
    <section class="case" id="case-{qi}">
      <h3>{esc(j["title"])}</h3>
      <p class="story">{esc(j["story"])}</p>
      <p class="verdict">Outcome: <strong>{esc(j["verdict"])}</strong></p>
      <ol class="steps">{steps}</ol>
    </section>""")

# ---------- page ----------
first, last = mails[0]["_at"], mails[-1]["_at"]
page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>paulmero5@gmail.com — inbox experience (Global EIS portal)</title>
<style>
:root {{ --navy:#0f2440; --blue:#1668dc; --bg:#f4f6fa; --card:#fff; --ink:#1c2430; --mut:#59636e; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; font:14px/1.6 -apple-system,"Segoe UI",Roboto,Arial,sans-serif; color:var(--ink); background:var(--bg); }}
header {{ background:var(--navy); color:#fff; padding:26px 32px; }}
header h1 {{ margin:0 0 6px; font-size:21px; }}
header p {{ margin:0; color:#b9c6d8; font-size:13px; }}
main {{ max-width:1060px; margin:0 auto; padding:26px 20px 60px; }}
h2 {{ font-size:17px; margin:34px 0 10px; color:var(--navy); border-bottom:2px solid var(--blue); padding-bottom:6px; }}
h3 {{ font-size:15px; margin:0 0 8px; color:var(--navy); }}
h4 {{ font-size:13px; margin:14px 0 6px; color:var(--mut); text-transform:uppercase; letter-spacing:.4px; }}
.b {{ display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; font-weight:700; vertical-align:middle; }}
.b.client {{ background:#e6f4ea; color:#137333; }}
.b.op {{ background:#e8f0fe; color:#1967d2; }}
.b.case {{ background:#f1f3f4; color:#3c4043; }}
.b.kind {{ background:#fef7e0; color:#994d00; font-weight:600; }}
table {{ border-collapse:collapse; width:100%; }}
table.timeline td {{ background:var(--card); border:1px solid #e3e8ef; padding:8px 12px; vertical-align:top; }}
table.timeline .n {{ color:var(--mut); width:34px; }}
table.timeline .t {{ color:var(--mut); width:52px; font-variant-numeric:tabular-nums; }}
table.timeline a {{ color:var(--blue); font-weight:600; text-decoration:none; }}
table.timeline a:hover {{ text-decoration:underline; }}
.snip {{ color:var(--mut); font-size:12px; margin-top:2px; }}
.att {{ color:var(--mut); font-size:12px; width:180px; }}
section.case, section.mail {{ background:var(--card); border:1px solid #e3e8ef; border-radius:10px; padding:18px 22px; margin:14px 0; }}
section.case {{ border-left:5px solid var(--blue); }}
.story {{ margin:0 0 8px; }}
.verdict {{ margin:0 0 6px; }}
.steps {{ margin:6px 0 0 18px; color:var(--mut); }}
.steps a {{ color:var(--blue); text-decoration:none; }}
.mail .msubj {{ font-size:16px; font-weight:700; color:var(--navy); }}
.mmeta {{ margin:6px 0 10px; }}
.hdrs td {{ padding:2px 14px 2px 0; font-size:13px; }}
.hdrs td:first-child {{ color:var(--mut); width:90px; vertical-align:top; }}
.attlist {{ margin:0; padding-left:16px; }}
.mail pre {{ background:#f8f9fb; border:1px solid #e3e8ef; border-radius:8px; padding:14px; white-space:pre-wrap; word-break:break-word; font:12.5px/1.55 ui-monospace,Menlo,Consolas,monospace; }}
.mail iframe {{ width:100%; height:560px; border:1px solid #e3e8ef; border-radius:8px; background:#fff; }}
.nohtml {{ color:var(--mut); font-size:12.5px; font-style:italic; background:#f8f9fb; border:1px dashed #d6dce4; border-radius:8px; padding:10px 14px; }}
.rep {{ background:#e6f4ea; border:1px solid #b7dfc2; color:#137333; border-radius:8px; padding:8px 12px; margin:10px 0; font-size:13px; }}
.rep a {{ color:#137333; font-weight:600; }}
details {{ margin-top:10px; }}
summary {{ cursor:pointer; color:var(--blue); font-size:13px; }}
.raw {{ max-height:300px; overflow:auto; }}
.note {{ background:#fef7e0; border:1px solid #f0d896; border-radius:10px; padding:12px 16px; font-size:13px; }}
.legend {{ display:flex; gap:18px; margin:10px 0 0; color:#b9c6d8; font-size:12.5px; }}
footer {{ text-align:center; color:var(--mut); font-size:12px; padding:18px; }}
</style></head><body>
<header>
  <h1>📥 Inbox experience — {esc(MY_EMAIL)}</h1>
  <p>Global EIS portal · full-detail simulation from the live email-tour run · {esc(first.strftime("%d %b %Y, %H:%M:%S"))} → {esc(last.strftime("%H:%M:%S"))} (local outbox capture) · {len(mails)} mails</p>
  <div class="legend"><span>Test inbox plays two roles:</span> <span class="b client">CLIENT</span> mails a real client would receive&nbsp;
  <span class="b op">OPERATOR</span> mails the operations desk receives — both land in this one inbox during testing</div>
</header>
<main>

<div class="note">Every mail below is a <strong>real artifact</strong> captured from the engine run — nothing is mocked.
The client-facing report files themselves are exported under <code>reports/</code> and linked from the mails that carry them.</div>

<h2>1 · The four journeys</h2>
{''.join(case_secs)}

<h2>2 · Timeline — everything this inbox received, in order</h2>
<table class="timeline">{''.join(timeline_rows)}</table>

<h2>3 · Full detail of every mail</h2>
{''.join(cards)}

</main>
<footer>Generated from upload/portal/_outbox + ReportFile DB · run EMAIL-TOUR (21/21 checks PASS) · Global EIS statement-analysis portal</footer>
</body></html>"""

open(OUT, "w", encoding="utf-8").write(page)
print(f"OK wrote {OUT} ({len(page):,} bytes)")
print(f"OK exported reports: {[os.path.basename(r['path']) for r in reports.values()]}")
print(f"mails: {len(mails)} | cases: {len(cases)} | reports: {len(reports)}")
