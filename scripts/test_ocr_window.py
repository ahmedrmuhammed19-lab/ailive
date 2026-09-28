#!/usr/bin/env python3
"""
OCR-SHADOW + 6-MONTH WINDOW — end-to-end (local server).

Covers:
  W1  operator login
  W2  upload IMAGE-ONLY CIB scan (fabricated from Saving fixture) -> start ->
      engine OCRs it -> DRAFT (yellow), NOT auto-delivered even at 100% integrity
  W3  draft report carries the OCR-SOURCE shadow banner; ParseLog mode OCR:*
  W4  OCR case status stays ANALYZING (never DONE automatically)
  W5  upload 6.1-month statement -> window note "most recent 6 months" + trim
  W6  upload short/other-period statement -> period note present (covers only / covers / spans)
  W7  work-all page still renders per-case links
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

BASE = "http://localhost:3000"
SECRET = "e2e-local-secret-0123456789abcdef0123456789abcdef"
DB = "/home/z/my-project/db/custom.db"
OUTBOX = "/home/z/my-project/upload/portal/_outbox"
SCAN_PDF = "/tmp/Saving_scan.pdf"
LONG_PDF = "/home/z/my-project/upload/Statements_28FEB26_to_31AUG26.pdf"
SHORT_PDF = "/home/z/my-project/upload/Current-1786448428276.pdf"

results = []
SESSION_COOKIE = {"v": ""}


def _cookie_header():
    return {"Cookie": SESSION_COOKIE["v"]} if SESSION_COOKIE["v"] else {}


def ck(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))


def action_tok(sid, action):
    return hmaclib.new(SECRET.encode(), f"{sid}:{action}".encode(), "sha256").hexdigest()[:32]


def strip_base(url):
    return re.sub(r"^https?://[^/]+", "", url)


def new_op():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


from http.cookiejar import CookieJar  # noqa: E402


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


def get(op, url, timeout=240):
    try:
        req = urllib.request.Request(url if url.startswith("http") else BASE + url, headers=_cookie_header())
        return op.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return e


def multipart(files, fields):
    boundary = "----ocrw" + uuid.uuid4().hex
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


def upload(op, queue_id, fpath):
    body, boundary = multipart([(os.path.basename(fpath), fpath)], {"userId": queue_id, "email": f"{queue_id.lower()}@example.com"})
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


def reports_of(sid):
    con = sqlite3.connect(DB)
    try:
        rows = con.execute("SELECT name, data FROM ReportFile WHERE submissionId=? ORDER BY createdAt DESC", (sid,)).fetchall()
        return [(n, bytes(d).decode("utf8", "ignore")) for n, d in rows]
    finally:
        con.close()


def modes_of(sid):
    con = sqlite3.connect(DB)
    try:
        return [m for (m,) in con.execute("SELECT modes FROM ParseLog WHERE submissionId=? ORDER BY createdAt DESC", (sid,)).fetchall() if m]
    finally:
        con.close()


def start_case(op, sid):
    r = get(op, f"/api/queue/action?id={sid}&action=start&token={action_tok(sid, 'start')}")
    return r.read().decode()


def main():
    op = new_op()

    # W1 login
    r = post_json(op, "/api/login", {"username": "op.eis", "password": "Op-Test-2026!"})
    ck("W1 operator login", r.status == 200, f"status={getattr(r,'status',r)}")

    # W2-W4: image-only CIB scan -> OCR shadow -> yellow draft
    up = upload(op, "OCR-01", SCAN_PDF)
    ck("W2a scan uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid1 = sid_for("OCR-01")
    t0 = time.time()
    page = start_case(op, sid1)
    print(f"   engine run took {time.time() - t0:.0f}s")
    ck("W2b OCR scan -> draft (not auto-delivered)", "draft report ready" in page and "Analysis complete — report delivered" not in page, page[:240])
    reps = reports_of(sid1)
    ck("W3a OCR-SOURCE banner in report", any("OCR-SOURCE DRAFT (SHADOW MODE)" in h for _, h in reps))
    ck("W3b ParseLog mode tagged OCR:*", any(m.startswith("OCR:") for m in modes_of(sid1)), str(modes_of(sid1)))
    ck("W4 OCR case stays ANALYZING", status_of(sid1) == "ANALYZING", status_of(sid1))

    # W5: 6.1-month statement -> trimmed to the most recent 6 months
    up = upload(op, "WIN-01", LONG_PDF)
    ck("W5a long statement uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid2 = sid_for("WIN-01")
    page = start_case(op, sid2)
    reps2 = reports_of(sid2)
    ck("W5b parsed (draft or delivered page)", "draft report ready" in page or "report delivered" in page, page[:240])
    ck("W5c window note: spans + most-recent-6-months", any("most recent 6 months" in h for _, h in reps2), str([n for n, _ in reps2]))
    ck("W5d excluded-rows wording present", any("excluded from window metrics" in h for _, h in reps2))

    # W6: short/other-period statement -> a period note is always present
    up = upload(op, "WIN-02", SHORT_PDF)
    ck("W6a short statement uploaded", up.get("ok") is True, json.dumps(up)[:160])
    sid3 = sid_for("WIN-02")
    page = start_case(op, sid3)
    reps3 = reports_of(sid3)
    ck("W6b period note present", any(("Statement covers" in h or "Statement spans" in h) for _, h in reps3))

    # W7: work-all page still lists cases with links
    r = get(op, f"/api/queue/work-all?token={action_tok('__queue__', 'workall')}")
    page_html = r.read().decode()
    ck("W7 work-all page renders case links", "Case links" in page_html)

    fails = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(fails)}/{len(results)} checks passed" + (f" — FAILURES: {fails}" if fails else ""))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
