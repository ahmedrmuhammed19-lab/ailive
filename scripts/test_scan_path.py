#!/usr/bin/env python3
"""
SCAN-PATH CAMPAIGN — comprehensive OCR/scan verification through the live
portal API (localhost:3000).

Proves, for EVERY scanner/writer codec the byte-level extractor can meet:
  raw DCTDecode JPEG | ASCII85-armored DCT | FlateDecode raw RGB |
  FlateDecode + PNG predictor 15 | degraded scan (skew+stamp+watermark+noise) |
  2-page scan | direct photo JPG

Expected outcome for every scan: YELLOW DRAFT (engine outcome "draft-review")
  - status stays ANALYZING (shadow rule: OCR-sourced drafts are NEVER
    auto-delivered, even at 100% chain integrity)
  - ParseLog modes carry the "OCR:" prefix
  - report published for analyst review
  - operator mail "draft ready for review" fires
Then: signed deliver link on the clean-scan draft -> DONE (analyst approval
flow), and both controls (digital green -> auto-DONE, insurance -> red).
"""

import hashlib
import hmac as H
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
FX = "/home/z/my-project/tests/e2e_fixtures"
OUTBOX = "/home/z/my-project/upload/portal/_outbox"
OP = ("op.eis", "Op-Test-2026!")
CLIENT_MAIL = "eis.scan.client@example.com"

SESSION_SECRET = None
for _l in open("/home/z/my-project/.env"):
    if _l.startswith("SESSION_SECRET="):
        SESSION_SECRET = _l.split("=", 1)[1].strip()

RESULTS = []


def ck(name, ok, detail=""):
    RESULTS.append(ok)
    print(("PASS" if ok else "FAIL"), f"{name}", detail if not ok else detail)


def http(method, path, body=None, raw=None, cookie=None, timeout=240):
    req = urllib.request.Request(BASE + path, method=method)
    if cookie:
        req.add_header("Cookie", cookie)
    data = None
    if raw:
        data, hdr = raw
        req.add_header("Content-Type", hdr)
    elif body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers
    except Exception as e:  # timeout etc.
        return 0, str(e).encode(), None


def multipart(fields, files):
    b = uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for name, content, ctype in files:
        out += (
            f'--{b}\r\nContent-Disposition: form-data; name="files"; '
            f'filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'
        ).encode()
        out += content + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return out, f"multipart/form-data; boundary={b}"


def login(user, pw):
    st, body, hdrs = http("POST", "/api/login", body={"username": user, "password": pw})
    setc = hdrs.get("Set-Cookie") or ""
    ckie = setc.split(";")[0] if setc else ""
    ck(f"login {user}", st == 200 and bool(ckie), f"st={st}")
    return ckie


def sql(q):
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return (row[0] if row else "") if isinstance(row, tuple) else str(row)
    finally:
        con.close()


def wait_status(sid, pred, timeout=240):
    dl = time.time() + timeout
    while time.time() < dl:
        s = sql(f"SELECT status FROM Submission WHERE id='{sid}';")
        if (pred(s) if callable(pred) else s == pred):
            return s
        time.sleep(2)
    return sql(f"SELECT status FROM Submission WHERE id='{sid}';")


def hmac_token(sid, action):
    return H.new(SESSION_SECRET.encode(), f"{sid}:{action}".encode(), hashlib.sha256).hexdigest()[:32]


def upload(cookie, label, fname, path, ctype="application/pdf"):
    mb, mh = multipart(
        {"userId": label, "email": CLIENT_MAIL, "country": "Canada", "visaType": "Work Permit", "travelers": "1"},
        [(fname, open(path, "rb").read(), ctype)],
    )
    st, body, _ = http("POST", "/api/upload", raw=(mb, mh), cookie=cookie)
    j = json.loads(body or b"{}")
    sid = j.get("submissionId") or j.get("id") or ""
    ck(f"upload {label}", st == 200 and bool(sid), f"st={st} {str(j)[:120]}")
    return sid


def start_and_classify(cookie, sid, label):
    """Signed start -> wait for engine verdict -> classify the outcome."""
    tok = hmac_token(sid, "start")
    st, _, _ = http("GET", f"/api/queue/action?id={sid}&action=start&token={tok}", cookie=cookie, timeout=300)
    ck(f"engine start {label}", st == 200, f"st={st}")
    wait_status(sid, lambda s: s in ("DONE",) or True, timeout=5)  # engine runs inside start
    time.sleep(3)
    row = sql(
        f"SELECT outcome || '|' || COALESCE(modes,'') || '|' || COALESCE(integrityMin,'') "
        f"FROM ParseLog WHERE submissionId='{sid}' ORDER BY createdAt DESC LIMIT 1;"
    )
    return row


def scan_case(cookie, label, fname, path, ctype="application/pdf"):
    sid = upload(cookie, label, fname, path, ctype)
    row = start_and_classify(cookie, sid, label)
    outcome = row.split("|")[0] if row else "(no ParseLog)"
    modes = row.split("|")[1] if "|" in row else ""
    ck(f"{label}: draft-review (yellow, analyst review)", outcome == "draft-review", f"outcome={outcome}")
    ck(f"{label}: status NOT DONE (no auto-delivery)", sql(f"SELECT status FROM Submission WHERE id='{sid}';") != "DONE")
    ck(f"{label}: OCR provenance in modes", "OCR:" in modes, f"modes={modes[:60]}")
    rep = sql(f"SELECT COUNT(*) FROM ReportFile WHERE submissionId='{sid}';")
    ck(f"{label}: draft report published", bool(rep) and int(rep) >= 1, f"reports={rep}")
    integrity = row.split("|")[2] if row.count("|") >= 2 else ""
    print(f"    -> {label}: outcome={outcome} modes={modes[:40]} integrityMin={integrity}")
    return sid, outcome, integrity


def main():
    print("=== SCAN-PATH CAMPAIGN — OCR fixtures end-to-end ===")
    op = login(*OP)

    # --- controls -----------------------------------------------------------
    print("\n--- controls: digital green + insurance red ---")
    g = upload(op, "SCAN-CTL-GREEN", "statement_green_B.pdf", f"{FX}/statement_green_B.pdf")
    grow = start_and_classify(op, g, "CTL-GREEN")
    ck("control green: auto-delivered DONE", sql(f"SELECT status FROM Submission WHERE id='{g}';") == "DONE", grow)
    r = upload(op, "SCAN-CTL-RED", "insurance_red.pdf", f"{FX}/insurance_red.pdf")
    rrow = start_and_classify(op, r, "CTL-RED")
    ck("control red: unrecognized (not draft)", (rrow.split("|")[0] if rrow else "") == "unrecognized", rrow)

    # --- scan codec matrix ----------------------------------------------------
    print("\n--- scan codec matrix (every fixture must land YELLOW draft) ---")
    cases = [
        ("SCAN-CLEAN", "statement_scan_clean.pdf", "application/pdf"),
        ("SCAN-A85", "statement_scan_ascii85.pdf", "application/pdf"),
        ("SCAN-FLATE", "statement_scan_flate.pdf", "application/pdf"),
        ("SCAN-FLATEPNG", "statement_scan_flatepng.pdf", "application/pdf"),
        ("SCAN-DEGRADED", "statement_scan_degraded.pdf", "application/pdf"),
        ("SCAN-MULTI", "statement_scan_multi.pdf", "application/pdf"),
        ("SCAN-PHOTO", "statement_scan_page.jpg", "image/jpeg"),
    ]
    sids = {}
    for label, fname, ctype in cases:
        sid, outcome, integrity = scan_case(op, label, fname, f"{FX}/{fname}", ctype)
        sids[label] = sid

    # --- analyst approval flow on the clean scan -----------------------------
    print("\n--- analyst approval flow on SCAN-CLEAN ---")
    sid = sids.get("SCAN-CLEAN")
    tok = hmac_token(sid, "deliver")
    st, body, _ = http("GET", f"/api/queue/action?id={sid}&action=deliver&token={tok}", timeout=120)
    final = wait_status(sid, lambda s: s == "DONE", timeout=60)
    ck("deliver link 200 + scan case DONE", st == 200 and final == "DONE", f"st={st} final={final}")

    # --- operator mail audit --------------------------------------------------
    print("\n--- operator mail audit (draft-review mails sent) ---")
    log = open(f"{OUTBOX}/NOTIFICATIONS.log").read() if os.path.exists(f"{OUTBOX}/NOTIFICATIONS.log") else ""
    n_draft = log.count("draft ready for review")
    ck("operator draft-review mails fired", n_draft >= 7, f"count={n_draft}")

    passed = sum(RESULTS)
    print(f"\n===== SUMMARY: {passed}/{len(RESULTS)} PASS =====")
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
