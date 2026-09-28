#!/usr/bin/env python3
"""
FULL CYCLE — comprehensive acceptance suite (production parity).

Runs on a boot WITHOUT OUTBOX_KEEP_HTML / OPERATOR_EMAIL_OVERRIDE (prod parity).

  A  auth & session guards (bad creds, no-session upload, me, setup one-shot,
     client role 403, logout semantics)
  B  signed-token guards (forged, wrong action, cross-case)
  C  upload validation (no files, bad extension, valid)
  D  engine lifecycle (green DONE, idempotent start, retry-DONE 409, OCR draft ->
     deliver -> client mail, deliver safety rail on report-less case, retry red)
  E  reports & statement views (list, signed view link bytes, report content)
  F  queue & outbox integrity (list, work-all, collision regression, prod-parity
     html suppression, nudge mail, complete-all safety rails)
  G  DB state integrity (statuses, reports, parse modes)
"""
import glob
import hmac as hmaclib
import json
import os
import re
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

MY_EMAIL = "paulmero5@gmail.com"
GREEN_PDF = "/home/z/my-project/upload/Saving-1786448365999.pdf"
SCAN_PDF = "/tmp/Saving_scan.pdf"
RED_PDF = "/home/z/my-project/upload/GlobalEIS_Report_HaythamElsayed_USD.pdf"
BAD_TXT = "/tmp/FC_not_a_statement.txt"

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
    boundary = "----fc" + uuid.uuid4().hex
    body = b""
    for k, v in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for fname, fpath, ctype in files:
        with open(fpath, "rb") as fh:
            data = fh.read()
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; "
            f"filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n"
        ).encode() + data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, boundary


def upload_raw(op, files, fields):
    body, boundary = multipart(files, fields)
    req = urllib.request.Request(
        BASE + "/api/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", **_cookie_header()},
        method="POST",
    )
    try:
        r = op.open(req, timeout=180)
        return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def upload(op, queue_id, fpath):
    return upload_raw(
        op,
        [(os.path.basename(fpath), fpath, "application/pdf")],
        {"userId": queue_id, "email": MY_EMAIL},
    )


def sid_for(queue_id):
    con = sqlite3.connect(DB)
    try:
        return con.execute(
            "SELECT id FROM Submission WHERE userId=? ORDER BY createdAt DESC LIMIT 1", (queue_id,)
        ).fetchone()[0]
    finally:
        con.close()


def row_of(sid):
    con = sqlite3.connect(DB)
    try:
        return con.execute("SELECT status FROM Submission WHERE id=?", (sid,)).fetchone()[0]
    finally:
        con.close()


def report_count(sid):
    con = sqlite3.connect(DB)
    try:
        return con.execute("SELECT COUNT(*) FROM ReportFile WHERE submissionId=?", (sid,)).fetchone()[0]
    finally:
        con.close()


def report_html(sid):
    con = sqlite3.connect(DB)
    try:
        rows = con.execute(
            "SELECT data FROM ReportFile WHERE submissionId=? ORDER BY createdAt DESC LIMIT 1", (sid,)
        ).fetchall()
        return bytes(rows[0][0]).decode("utf8", "ignore") if rows else ""
    finally:
        con.close()


def modes_of(sid):
    con = sqlite3.connect(DB)
    try:
        return [m for (m,) in con.execute("SELECT modes FROM ParseLog WHERE submissionId=? ORDER BY createdAt DESC", (sid,)).fetchall() if m]
    finally:
        con.close()


def start_case(op, sid, action="start"):
    r = get(op, f"/api/queue/action?id={sid}&action={action}&token={action_tok(sid, action)}")
    return r


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


def main():
    op = new_op()

    # ---------- A. AUTH & SESSION ----------
    r = post_json(op, "/api/login", {"username": "op.eis", "password": "wrong-pass"})
    ck("A1 wrong password -> 401", getattr(r, "status", 0) == 401, str(getattr(r, "status", r)))
    r = post_json(op, "/api/login", {"username": "ghost.user", "password": "whatever1"})
    ck("A2 unknown user -> 401", getattr(r, "status", 0) == 401, str(getattr(r, "status", r)))

    body, boundary = multipart([], {"userId": "FC-X", "email": MY_EMAIL})
    req = urllib.request.Request(
        BASE + "/api/upload", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        resp = op.open(req, timeout=60)
        code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    ck("A3 upload without session -> 401", code == 401, str(code))

    r = post_json(op, "/api/login", {"username": "op.eis", "password": "Op-Test-2026!"})
    ck("A4 operator login", getattr(r, "status", 0) == 200, str(getattr(r, "status", r)))
    r = get(op, "/api/me")
    me = r.read().decode() if hasattr(r, "status") else ""
    ck("A5 /api/me shows operator", getattr(r, "status", 0) == 200 and "operator" in me, me[:120])

    r = post_json(op, "/api/setup", {"setupKey": "anything", "id": "hacker", "password": "hunter2222"})
    ck("A6 setup one-shot rejected on non-empty portal", 400 <= getattr(r, "status", 0) < 500, str(getattr(r, "status", r)))

    r = post_json(op, "/api/login", {"username": "client.workq", "password": "Client-2026!"})
    ck("A7 client login", getattr(r, "status", 0) == 200, str(getattr(r, "status", r)))
    r = post_json(op, "/api/queue/complete-all", {})
    ck("A8 client complete-all -> 403", getattr(r, "status", 0) == 403, str(getattr(r, "status", r)))
    r = post_json(op, "/api/login", {"username": "op.eis", "password": "Op-Test-2026!"})
    ck("A9 operator session restored", getattr(r, "status", 0) == 200, str(getattr(r, "status", r)))

    # ---------- B. TOKEN GUARDS ----------
    up = upload(op, "FC-01", GREEN_PDF)
    ck("B0 green case uploaded", up[0] == 200 and up[1].get("ok") is True, json.dumps(up[1])[:120])
    sid1 = sid_for("FC-01")
    r = get(op, f"/api/queue/action?id={sid1}&action=nudge&token={'0' * 32}")
    ck("B1 forged token -> 403", getattr(r, "status", 0) == 403, str(getattr(r, "status", r)))
    r = get(op, f"/api/queue/action?id={sid1}&action=nudge&token={action_tok(sid1, 'start')}")
    ck("B2 start-token on nudge -> 403", getattr(r, "status", 0) == 403, str(getattr(r, "status", r)))
    up = upload(op, "FC-03", RED_PDF)
    ck("B0b red case uploaded", up[0] == 200 and up[1].get("ok") is True, json.dumps(up[1])[:120])
    sid3 = sid_for("FC-03")
    r = get(op, f"/api/queue/action?id={sid3}&action=start&token={action_tok(sid1, 'start')}")
    ck("B3 cross-case token -> 403", getattr(r, "status", 0) == 403, str(getattr(r, "status", r)))

    # ---------- C. UPLOAD VALIDATION ----------
    code, data = upload_raw(op, [], {"userId": "FC-X", "email": MY_EMAIL})
    ck("C1 no files -> 400", code == 400 and "No files" in data.get("error", ""), f"{code} {data}")
    Path(BAD_TXT).write_text("this is not a statement")
    code, data = upload_raw(
        op, [("notes.txt", BAD_TXT, "text/plain")], {"userId": "FC-X", "email": MY_EMAIL})
    ck("C2 .txt rejected -> 400", code == 400 and "Unsupported file type" in data.get("error", ""), f"{code} {data}")

    # ---------- D. LIFECYCLE ----------
    t0 = time.time()
    page = start_case(op, sid1).read().decode()
    print(f"   green engine run took {time.time() - t0:.0f}s")
    ck("D1a green auto-delivered page", "report delivered" in page, page[:160])
    ck("D1b green status DONE", row_of(sid1) == "DONE", row_of(sid1))
    page = start_case(op, sid1).read().decode()
    ck("D2 start on DONE -> idempotent page", "DONE" in page and "delivered" in page.lower(), page[:160])
    r = post_json(op, "/api/queue/retry", {"id": sid1})
    ck("D3 retry on DONE -> 409", getattr(r, "status", 0) == 409, str(getattr(r, "status", r)))

    up = upload(op, "FC-02", SCAN_PDF)
    ck("D4a OCR case uploaded", up[0] == 200 and up[1].get("ok") is True, json.dumps(up[1])[:120])
    sid2 = sid_for("FC-02")
    t0 = time.time()
    page = start_case(op, sid2).read().decode()
    print(f"   OCR engine run took {time.time() - t0:.0f}s")
    ck("D4b OCR -> draft, not delivered", "draft report ready" in page, page[:160])
    ck("D4c OCR status ANALYZING", row_of(sid2) == "ANALYZING", row_of(sid2))
    page = start_case(op, sid2).read().decode()
    ck("D5 start on ANALYZING -> already running", "Already running" in page, page[:160])

    r = get(op, f"/api/queue/action?id={sid2}&action=deliver&token={action_tok(sid2, 'deliver')}")
    page = r.read().decode()
    ck("D6a deliver OCR draft -> delivered page", "Report delivered" in page, page[:160])
    ck("D6b OCR case now DONE", row_of(sid2) == "DONE", row_of(sid2))
    mails = outbox_mails()
    ck("D6c client report mail for FC-02", any(
        m.get("kind") == "report_ready" and m.get("to") == MY_EMAIL and "FC-02" in m.get("subject", "")
        for m in mails), str([m.get("kind") for m in mails]))

    page = start_case(op, sid3).read().decode()
    ck("D7a red case -> needs manual", "Needs manual" in page, page[:160])
    r = get(op, f"/api/queue/action?id={sid3}&action=deliver&token={action_tok(sid3, 'deliver')}")
    page = r.read().decode()
    ck("D7b deliver without report -> safety rail", "No report is ready" in page, page[:160])
    ck("D7c red case NOT delivered", row_of(sid3) == "ANALYZING", row_of(sid3))

    r = post_json(op, "/api/queue/retry", {"id": sid3})
    try:
        rj = json.loads(r.read().decode())
    except Exception:
        rj = {}
    ck("D8 retry red case re-runs engine", getattr(r, "status", 0) == 200 and rj.get("ok") is True and rj.get("outcome") == "unrecognized", f"{getattr(r,'status',r)} {rj}")

    # ---------- E. REPORTS & VIEWS ----------
    r = get(op, "/api/reports")
    rep_page = r.read().decode() if hasattr(r, "status") else ""
    ck("E1 reports list contains FC-01 report", getattr(r, "status", 0) == 200 and "FC-01" in rep_page, rep_page[:120])
    mails = outbox_mails()
    view_url = None
    for m in mails:
        if m.get("submissionId") == sid1 and m.get("kind") == "operator_alert":
            mm = re.search(r"https?://\S*/api/statement/view\S+", m.get("body", ""))
            if mm:
                # mail links carry PORTAL_BASE_URL (prod by default) — test locally
                view_url = re.sub(r"^https?://[^/]+", BASE, mm.group(0).rstrip(")\r\n"))
                break
    ck("E2a statement view link found in upload alert", bool(view_url), str(view_url))
    if view_url:
        r = get(op, view_url)
        head = r.read(5)
        ck("E2b view link returns PDF bytes", getattr(r, "status", 0) == 200 and head.startswith(b"%PDF"), repr(head))
    h1 = report_html(sid1)
    ck("E3a green report carries window note", "Statement covers" in h1, h1[:120])
    ck("E3b green report carries integrity wording", "chain-verified" in h1 or "Chain integrity" in h1)
    h2 = report_html(sid2)
    ck("E3c OCR report carries shadow banner", "OCR-SOURCE" in h2)

    # ---------- F. QUEUE & OUTBOX ----------
    r = get(op, "/api/queue")
    q = r.read().decode() if hasattr(r, "status") else ""
    ck("F1 queue list has all cases", getattr(r, "status", 0) == 200 and all(x in q for x in ("FC-01", "FC-02", "FC-03")), q[:120])
    r = get(op, f"/api/queue/work-all?token={action_tok('__queue__', 'workall')}")
    wa = r.read().decode()
    ck("F2 work-all page renders", getattr(r, "status", 0) == 200 and "Case links" in wa, wa[:120])

    mails = outbox_mails()
    names = [m["_file"] for m in mails]
    ck("F3 no outbox filename collisions", len(names) == len(set(names)), str(len(names)))
    ck("F4 prod parity: html bodies suppressed", all(m.get("html") is None for m in mails),
       str([m["_file"] for m in mails if m.get("html") is not None][:2]))
    ck("F5 client mails addressed to test target", all(
        m.get("to") == MY_EMAIL for m in mails if m.get("kind") in ("report_ready", "client_nudge")),
       str([(m.get("kind"), m.get("to")) for m in mails]))

    r = get(op, f"/api/queue/action?id={sid3}&action=nudge&token={action_tok(sid3, 'nudge')}")
    page = r.read().decode()
    ck("F6a nudge ok page", "Re-upload request emailed" in page, page[:160])
    mails = outbox_mails()
    ck("F6b client_nudge mail present", any(m.get("kind") == "client_nudge" and m.get("to") == MY_EMAIL for m in mails))

    r = post_json(op, "/api/queue/complete-all", {})
    try:
        rj = json.loads(r.read().decode())
    except Exception:
        rj = {}
    ck("F7a complete-all ok (operator)", getattr(r, "status", 0) == 200 and rj.get("ok") is True, f"{getattr(r,'status',r)} {rj}")
    ck("F7b report-less case skipped by safety rail", any("FC-03" in str(s) or sid3 in str(s) for s in rj.get("skipped", [])), str(rj))
    ck("F7c red case still not DONE", row_of(sid3) == "ANALYZING", row_of(sid3))

    # ---------- G. DB STATE ----------
    ck("G1 statuses (DONE/DONE/ANALYZING)", (row_of(sid1), row_of(sid2), row_of(sid3)) == ("DONE", "DONE", "ANALYZING"),
       f"{row_of(sid1)}/{row_of(sid2)}/{row_of(sid3)}")
    ck("G2a reports exist for FC-01+FC-02", report_count(sid1) >= 1 and report_count(sid2) >= 1)
    ck("G2b no report for FC-03", report_count(sid3) == 0)
    ck("G3 parse logs exist (OCR tagged)", len(modes_of(sid1)) >= 1 and len(modes_of(sid2)) >= 1
       and any(m.startswith("OCR:") for m in modes_of(sid2)), str(modes_of(sid2)))

    fails = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(fails)}/{len(results)} checks passed" + (f" — FAILURES: {fails}" if fails else ""))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
