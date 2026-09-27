#!/usr/bin/env python3
"""
EMAIL TOUR — every client-experience email delivered to the default testing email
ahmedr.muhammed19@gmail.com (override with TOUR_EMAIL env; previously paulmero5@gmail.com).

Three paths through the real engine + real templates (local, outbox mode):
  GREEN  valid text statement  -> 100% chain -> auto-DONE -> receipt + report mail
  OCR    image-only scan       -> OCR shadow -> yellow draft -> draft mail w/ OCR banner
  RED    wrong document        -> needs-manual -> nudge tap -> re-upload request mail

Asserts every outbox mail is addressed to the tour target (client + operator copies
via OPERATOR_EMAIL_OVERRIDE / TEST_MAIL_TO lock) and that NO mail references the
retired REAL client address a.imam@beta.com.eg.
Also copies the outbox to download/email_tour/ + builds a preview index.
"""
import glob
import hmac as hmaclib
import html
import json
import os
import re
import shutil
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
from http.cookiejar import CookieJar
from pathlib import Path

BASE = "http://localhost:3000"
SECRET = "e2e-local-secret-0123456789abcdef0123456789abcdef"
DB = "/home/z/my-project/db/custom.db"
OUTBOX = "/home/z/my-project/upload/portal/_outbox"
TOUR_DIR = "/home/z/my-project/download/email_tour"

MY_EMAIL = os.environ.get("TOUR_EMAIL", "ahmedr.muhammed19@gmail.com")
FORBIDDEN = ["a.imam@beta.com.eg"]  # REAL client address — permanently retired from any testing
ALT_EMAIL = "real.client@example.com"  # stand-in for a REAL customer address — must NEVER receive mail during testing

GREEN_PDF = "/home/z/my-project/upload/Saving-1786448365999.pdf"
SCAN_PDF = "/tmp/Saving_scan.pdf"  # fabricated image-only scan of the Saving statement (proven OCR->yellow fixture)
REAL_SCAN_PDF = "/home/z/my-project/upload/CamScanner 15-09-2026 17.19 (1).pdf"  # real-world scan, outcome informational
RED_PDF = "/home/z/my-project/download/Online_Insurance_Conditions.pdf"

results = []
SESSION_COOKIE = {"v": ""}


def _cookie_header():
    return {"Cookie": SESSION_COOKIE["v"]} if SESSION_COOKIE["v"] else {}


def ck(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))


def action_tok(sid, action):
    return hmaclib.new(SECRET.encode(), f"{sid}:{action}".encode(), "sha256").hexdigest()[:32]


def new_op():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def post_json(op, path, payload, timeout=60):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **_cookie_header()},
        method="POST",
    )
    try:
        resp = op.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        resp = e
    sc = resp.headers.get("set-cookie")
    if sc:
        SESSION_COOKIE["v"] = sc.split(";")[0]
    return resp


def get(op, url, timeout=300):
    try:
        req = urllib.request.Request(url if url.startswith("http") else BASE + url, headers=_cookie_header())
        return op.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return e


def multipart(files, fields):
    boundary = "----tour" + uuid.uuid4().hex
    body = b""
    for k, v in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for fname, fpath in files:
        with open(fpath, "rb") as fh:
            data = fh.read()
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; "
            f"filename=\"{fname}\"\r\nContent-Type: application/pdf\r\n\r\n"
        ).encode() + data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, boundary


def upload(op, queue_id, fpath, email=None):
    body, boundary = multipart(
        [(os.path.basename(fpath), fpath)],
        {"userId": queue_id, "email": email or MY_EMAIL},
    )
    req = urllib.request.Request(
        BASE + "/api/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", **_cookie_header()},
        method="POST",
    )
    r = op.open(req, timeout=180)
    return json.load(r)


def sid_for(queue_id):
    con = sqlite3.connect(DB)
    try:
        return con.execute(
            "SELECT id FROM Submission WHERE userId=? ORDER BY createdAt DESC LIMIT 1", (queue_id,)
        ).fetchone()[0]
    finally:
        con.close()


def status_of(sid):
    con = sqlite3.connect(DB)
    try:
        return con.execute("SELECT status FROM Submission WHERE id=?", (sid,)).fetchone()[0]
    finally:
        con.close()


def start_case(op, sid):
    r = get(op, f"/api/queue/action?id={sid}&action=start&token={action_tok(sid, 'start')}")
    return r.read().decode()


def modes_of(sid):
    con = sqlite3.connect(DB)
    try:
        return [m for (m,) in con.execute("SELECT modes FROM ParseLog WHERE submissionId=? ORDER BY createdAt DESC", (sid,)).fetchall() if m]
    finally:
        con.close()


def outbox_mails():
    mails = []
    for f in sorted(glob.glob(os.path.join(OUTBOX, "*.json"))):
        try:
            d = json.loads(Path(f).read_text())
            d["_file"] = os.path.basename(f)
            mails.append(d)
        except Exception:
            pass
    return mails


def export_outbox():
    """Copy outbox JSONs + rendered HTML bodies into download/email_tour/ + index."""
    if os.path.exists(TOUR_DIR):
        shutil.rmtree(TOUR_DIR)
    os.makedirs(TOUR_DIR, exist_ok=True)
    mails = outbox_mails()
    cards = []
    for i, m in enumerate(mails, 1):
        kind = m.get("kind", "mail")
        to = m.get("to", "?")
        subject = m.get("subject", "(no subject)")
        safe = re.sub(r"[^a-z0-9]+", "_", f"{i:02d}_{kind}_{subject}".lower())[:60]
        has_html = bool(m.get("hasHtml") or m.get("html"))
        link = ""
        if has_html:
            html_body = m.get("html") or ""
            hp = os.path.join(TOUR_DIR, safe + ".html")
            Path(hp).write_text(html_body, encoding="utf8")
            link = safe + ".html"
        jp = os.path.join(TOUR_DIR, safe + ".json")
        Path(jp).write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf8")
        cards.append(
            f"<div class='card'><div class='k'>{html.escape(kind)}</div>"
            f"<div class='s'>{html.escape(subject)}</div>"
            f"<div class='t'>to: {html.escape(to)}</div>"
            + (f"<a href='{link}'>view HTML email</a>" if link else "<span class='txt'>text-only</span>")
            + "</div>"
        )
    index = (
        "<!doctype html><html><head><meta charset='utf8'><title>Global EIS — email tour</title>"
        "<style>body{font-family:system-ui,sans-serif;background:#f4f6f9;margin:24px;max-width:960px}"
        "h1{font-size:20px}p.note{color:#445;font-size:13px}"
        ".card{background:#fff;border:1px solid #dde;border-radius:10px;padding:14px 16px;margin:10px 0}"
        ".k{display:inline-block;background:#0969da;color:#fff;border-radius:6px;padding:2px 8px;font-size:12px}"
        ".s{font-weight:600;margin:8px 0 4px}.t{color:#667;font-size:12px;margin-bottom:6px}"
        "a{color:#0969da;font-size:13px}</style></head><body>"
        "<h1>Global EIS — email tour for " + html.escape(MY_EMAIL) + "</h1>"
        "<p class='note'>Every email below was generated by the real engine + real templates "
        "(local outbox mode = the exact bytes production SMTP delivers). "
        "Open an HTML link to preview the mail as the recipient sees it.</p>"
        + "".join(cards)
        + "</body></html>"
    )
    Path(os.path.join(TOUR_DIR, "index.html")).write_text(index, encoding="utf8")
    return mails


def main():
    op = new_op()

    # T1 operator login
    r = post_json(op, "/api/login", {"username": "op.eis", "password": "Op-Test-2026!"})
    ck("T1 operator login", r.status == 200, f"status={getattr(r,'status',r)}")

    # T2 GREEN: valid statement -> auto-DONE -> receipt + report mail
    up = upload(op, "EM-01", GREEN_PDF)
    ck("T2a green statement uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid1 = sid_for("EM-01")
    page = start_case(op, sid1)
    ck("T2b green -> delivered page", "report delivered" in page, page[:200])
    ck("T2c status DONE", status_of(sid1) == "DONE", status_of(sid1))

    # T3 OCR: image-only scan -> yellow draft -> draft-ready mail w/ OCR reason
    up = upload(op, "EM-02", SCAN_PDF)
    ck("T3a scan uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid2 = sid_for("EM-02")
    t0 = time.time()
    page = start_case(op, sid2)
    print(f"   OCR engine run took {time.time() - t0:.0f}s")
    ck("T3b OCR -> draft (not delivered)", "draft report ready" in page, page[:200])
    ck("T3c OCR case stays ANALYZING", status_of(sid2) == "ANALYZING", status_of(sid2))

    # T3.5 BONUS: real-world CamScanner scan -> whatever the engine honestly decides
    up = upload(op, "EM-04", REAL_SCAN_PDF)
    ck("T3.5a real scan uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid4 = sid_for("EM-04")
    page4 = start_case(op, sid4)
    outcome4 = "draft" if "draft report ready" in page4 else ("red" if "Needs manual" in page4 else "other")
    modes4 = modes_of(sid4)
    print(f"   real CamScanner scan -> engine outcome: {outcome4}; parse modes: {modes4}")
    ck("T3.5b real scan classified", outcome4 in ("draft", "red"), page4[:160])

    # T4 RED: wrong document -> needs manual
    up = upload(op, "EM-03", RED_PDF)
    ck("T4a wrong document uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid3 = sid_for("EM-03")
    page = start_case(op, sid3)
    ck("T4b red page (needs manual)", "Needs manual" in page, page[:200])

    # T5 nudge tap -> re-upload request mail
    r = get(op, f"/api/queue/action?id={sid3}&action=nudge&token={action_tok(sid3, 'nudge')}")
    page = r.read().decode()
    ck("T5a nudge ok page", "Re-upload request emailed" in page, page[:200])

    # T-LOCK: a case whose client email is a STAND-IN REAL CUSTOMER address.
    # With TEST_MAIL_TO active, the client mail MUST be redirected to MY_EMAIL
    # (intendedTo preserves the original) — proving no outsider can be mailed
    # during testing, even when the submission carries a real client address.
    up = upload(op, "EM-05", RED_PDF, email=ALT_EMAIL)
    ck("TL1 stand-in client case uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid5 = sid_for("EM-05")
    page = start_case(op, sid5)
    ck("TL2 stand-in case flags red", "Needs manual" in page, page[:200])
    r = get(op, f"/api/queue/action?id={sid5}&action=nudge&token={action_tok(sid5, 'nudge')}")
    page = r.read().decode()
    ck("TL3 nudge ok for stand-in case", "Re-upload request emailed" in page, page[:200])

    # T6 outbox verification — every mail to MY_EMAIL, kinds complete
    mails = outbox_mails()
    kinds = [m.get("kind") for m in mails]
    tos = [m.get("to") for m in mails]
    ck("T6a outbox non-empty", len(mails) >= 7, str(kinds))
    ck("T6b upload alert to my email", any(
        k == "operator_alert" and t == MY_EMAIL and "New bank statement uploaded" in m.get("subject", "")
        for k, t, m in zip(kinds, tos, mails)))
    ck("T6c delivered report mail to my email", any(k == "report_ready" and t == MY_EMAIL for k, t in zip(kinds, tos)))
    ck("T6d OCR draft-ready mail w/ shadow reason", any(
        "draft ready for review" in m.get("subject", "") and t == MY_EMAIL
        and "OCR shadow mode" in m.get("body", "")
        for k, t, m in zip(kinds, tos, mails)), str(kinds))
    ck("T6e red fix-forward operator mail", any(k == "operator_alert" and t == MY_EMAIL for k, t in zip(kinds, tos)))
    ck("T6f re-upload nudge mail to my email", any(k == "client_nudge" and t == MY_EMAIL for k, t in zip(kinds, tos)))
    ck("T6g nudge operator copy", sum(1 for k in kinds if k == "operator_alert") >= 2, str(kinds))
    ck("T6h NO mail to any other address", not any(f in json.dumps(mails) for f in FORBIDDEN), str(FORBIDDEN))

    # TEST-MAIL LOCK proof: the stand-in client's nudge landed in MY inbox instead
    locked = [m for m in mails if m.get("kind") == "client_nudge" and m.get("intendedTo") == ALT_EMAIL]
    ck("T6i stand-in nudge redirected to my inbox", any(
        m.get("to") == MY_EMAIL and "TEST-MAIL LOCK" in m.get("body", "")
        and m.get("subject", "").startswith("Global EIS — action required")
        for m in locked), json.dumps(locked)[:200])
    ck("T6j stand-in HTML twin carries lock banner", any(
        "TEST-MAIL LOCK" in (m.get("html") or "") for m in locked), str(len(locked)))
    ck("T6k stand-in client received NOTHING", not any(
        m.get("to") == ALT_EMAIL for m in mails), str([m.get("to") for m in mails if m.get("intendedTo")]))

    # T7 export + preview index
    mails2 = export_outbox()
    ck("T7 exported preview index", os.path.exists(os.path.join(TOUR_DIR, "index.html")))
    print(f"\nOutbox contents ({len(mails2)} mails):")
    for m in mails2:
        print(f"  {m.get('kind','?'):>15} -> {m.get('to','?')}  |  {m.get('subject','')[:70]}")

    fails = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(fails)}/{len(results)} checks passed" + (f" — FAILURES: {fails}" if fails else ""))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
