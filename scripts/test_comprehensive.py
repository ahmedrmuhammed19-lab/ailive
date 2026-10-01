#!/usr/bin/env python3
"""
test_comprehensive.py — FULL operator-view + client-view portal test, email paths
exercised in NO-SEND mode (no SMTP credentials -> every mail lands in the outbox
as QUEUED, zero real delivery).

Covers: auth matrix, role gates, operator happy path (upload -> work -> DONE 100%
-> report), client flow + cross-client scoping, red path + nudge + signed retry,
HMAC action links (forged + valid), statement/report access control, accounts
admin round-trip, dashboard, logout, outbox no-send audit, DB truth.

Usage: python3 scripts/test_comprehensive.py
"""
import glob
import hmac as H
import hashlib
import json
import subprocess
import time
import urllib.request
import urllib.error
import uuid

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
OUTBOX = "/home/z/my-project/upload/portal/_outbox"
GREEN_PDF = "/home/z/my-project/tests/e2e_fixtures/statement_green_B.pdf"
RED_PDF = "/home/z/my-project/tests/e2e_fixtures/insurance_red.pdf"
OP = ("op.eis", "Op-Test-2026!")
CL_A = ("client.workq", "Client-2026!")
CL_B = ("client.other", "Client-2026!")
# Sentinel client emails — TEST_MAIL_TO lock redirects everything, and no SMTP
# creds exist, so nothing is ever delivered anywhere.
MAIL_A = "eis.client.test@example.com"
MAIL_B = "eis.client.b@example.com"
MAIL_RED = "eis.client.red@example.com"
OPERATOR_MAIL = "ahmedr.muhammed19@gmail.com"

RESULTS = []


def ck(name, ok, extra=""):
    RESULTS.append((name, ok, extra))
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f"  [{extra}]" if extra and not ok else ""))


def http(method, path, body=None, cookie=None, raw_body=None, timeout=120):
    """Returns (status, raw_bytes, parsed_json_or_None, lowercased_headers)."""
    url = BASE + path
    data = None
    hdrs = {}
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    elif raw_body is not None:
        data = raw_body[0]
        hdrs.update(raw_body[1])
    if cookie:
        hdrs["Cookie"] = cookie
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read()
            h = {k.lower(): v for k, v in r.getheaders()}
    except urllib.error.HTTPError as e:
        b = e.read()
        h = {k.lower(): v for k, v in e.headers.items()}
        try:
            st = e.code
        except Exception:
            st = 500
    else:
        st = r.status if hasattr(r, "status") else 200
    j = None
    try:
        j = json.loads(b.decode())
    except Exception:
        pass
    return st, b, j, h


def login(user, pw):
    st, b, j, h = http("POST", "/api/login", {"username": user, "password": pw})
    sc = h.get("set-cookie", "")
    cookie = sc.split(";")[0] if "eis_session=" in sc else ""
    return st, j or {}, cookie


def multipart(fields, files):
    b = uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, (fname, fbytes, ctype) in files.items():
        out += (
            f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode() + fbytes + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return out, {"Content-Type": f"multipart/form-data; boundary={b}"}


def sql(q):
    import sqlite3
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return (row[0] if row else "") if isinstance(row, tuple) else (str(row) if row else "")
    finally:
        con.close()


def hmac_token(secret, submission_id, action):
    return H.new(secret.encode(), f"{submission_id}:{action}".encode(), hashlib.sha256).hexdigest()[:32]


SESSION_SECRET = None
for _line in open("/home/z/my-project/.env"):
    if _line.startswith("SESSION_SECRET="):
        SESSION_SECRET = _line.split("=", 1)[1].strip()

# ============================================================ 0. CLEAN SLATE
# Previous runs leave non-DONE cases behind (red cases intentionally stay
# ANALYZING in the DB — the "Needs manual" badge is a display-only override),
# and work-all's take-5 oldest-first batch would otherwise fill with them.
# Phase 0 wipes case data (users kept) so THIS run is fully deterministic.
print("\n===== 0. CLEAN SLATE (wipe case data, keep users) =====")
import sqlite3 as _s3
_con = _s3.connect(DB, timeout=15)
for _t in ["ParseLog", "ReportFile", "StatementFile", "UploadChunk", "Submission"]:
    _con.execute(f"DELETE FROM {_t};")
_con.commit()
_con.close()
print("case data wiped")


def wait_status(sub_id, want, secs=90):
    """Poll DB until Submission.status == want (or predicate), return final status."""
    deadline = time.time() + secs
    st_now = ""
    while time.time() < deadline:
        st_now = sql(f"SELECT status FROM Submission WHERE id='{sub_id}';")
        if callable(want):
            if want(st_now):
                return st_now
        elif st_now == want:
            return st_now
        time.sleep(2)
    return st_now

# Rerun-safe: clean the outbox so assertions only see THIS run's mails.
for _p in glob.glob(f"{OUTBOX}/*.json") + glob.glob(f"{OUTBOX}/NOTIFICATIONS.log"):
    import os
    os.remove(_p)

# ============================================================ A. AUTH MATRIX
print("\n===== A. AUTH MATRIX =====")
st, b, j, h = http("GET", "/api/me")
ck("A1 anonymous /api/me -> user null", st == 200 and j and j.get("user") is None, f"{st} {j}")
for p in ["/api/queue", "/api/dashboard", "/api/reports", "/api/users", "/api/engine/logs"]:
    st, _, _, _ = http("GET", p)
    ck(f"A2 anonymous {p} 401", st == 401, str(st))

st, _, _, _ = http("POST", "/api/login", {"username": OP[0], "password": "WRONG-pass"})
ck("A3 bad password rejected", st in (401, 403), str(st))

st, j, ck_op = login(*OP)
ck("A4 operator login ok", st == 200 and j.get("ok") and ck_op, f"{st} {j}")
st, j, ck_a = login(*CL_A)
ck("A5 client A login ok", st == 200 and j.get("ok") and ck_a, f"{st} {j}")
st, j, ck_b = login(*CL_B)
ck("A6 client B login ok", st == 200 and j.get("ok") and ck_b, f"{st} {j}")

st, b, j, _ = http("GET", "/api/me", cookie=ck_op)
ck("A7 /api/me operator role", j and j.get("user", {}).get("role") == "operator", str(j)[:120])
st, b, j, _ = http("GET", "/api/me", cookie=ck_a)
ck("A8 /api/me client role", j and j.get("user", {}).get("role") == "client", str(j)[:120])

# ============================================================ B. ROLE GATES
print("\n===== B. ROLE GATES (client blocked from operator endpoints) =====")
st, _, _, _ = http("POST", "/api/users", {"action": "add", "username": "qa.hack", "password": "x", "role": "client"}, cookie=ck_a)
ck("B1 client POST /api/users 403", st == 403, str(st))
st, _, _, _ = http("POST", "/api/queue/work-all", {}, cookie=ck_a)
ck("B2 client work-all 403", st == 403, str(st))
st, _, _, _ = http("POST", "/api/queue/complete-all", {}, cookie=ck_a)
ck("B3 client complete-all 403", st == 403, str(st))
st, _, _, _ = http("POST", "/api/queue/retry", {"id": "cmtest"}, cookie=ck_a)
ck("B4 client retry 403", st == 403, str(st))
st, _, _, _ = http("GET", "/api/engine/logs?id=cmtest", cookie=ck_a)
ck("B5 client engine logs 403", st == 403, str(st))
st, _, _, _ = http("GET", "/api/users", cookie=ck_a)
ck("B6 client GET users 403", st == 403, str(st))

# ============================================================ C. OPERATOR HAPPY PATH
print("\n===== C. OPERATOR HAPPY PATH (upload -> work -> DONE 100 -> report) =====")
pdf_bytes = open(GREEN_PDF, "rb").read()
mb, mh = multipart(
    {"userId": "EISQA-OP-GREEN", "email": MAIL_A, "country": "Canada", "visaType": "Work Permit", "travelers": "2"},
    {"files": ("statement_green_B.pdf", pdf_bytes, "application/pdf")},
)
st, b, j, _ = http("POST", "/api/upload", raw_body=(mb, mh), cookie=ck_op)
ck("C1 operator upload accepted", st == 200 and j and j.get("ok"), f"{st} {str(j)[:160]}")
GREEN_ID = (j or {}).get("submissionId") or (j or {}).get("id") or ""
ck("C2 submission id returned", bool(GREEN_ID), str(j)[:160])

st, b, j, _ = http("GET", "/api/queue", cookie=ck_op)
q = (j or {}).get("queue", [])
row = next((r for r in q if r.get("id") == GREEN_ID), None)
ck("C3 queue lists green case", row is not None, str(q)[:200])
# AUTO_WORK mode: the engine may already be ANALYZING or DONE by the time we
# look; manual mode: WAITING. All three are healthy here.
ck("C4 green case present (WAITING/ANALYZING/DONE)", row is not None and row.get("status") in ("WAITING", "ANALYZING", "DONE"), str(row and row.get("status")))
ck("C5 green case queueId", row is not None and row.get("userId") == "EISQA-OP-GREEN", str(row and row.get("userId")))

st, b, j, _ = http("GET", "/api/queue", cookie=ck_a)
ck("C6 client A does NOT see op case", not any(r.get("id") == GREEN_ID for r in (j or {}).get("queue", [])))
st, b, j, _ = http("GET", "/api/queue", cookie=ck_b)
ck("C7 client B does NOT see op case", not any(r.get("id") == GREEN_ID for r in (j or {}).get("queue", [])))

st, b, j, _ = http("POST", "/api/queue/work-all", {}, cookie=ck_op)
_green_status_now = sql(f"SELECT status FROM Submission WHERE id='{GREEN_ID}';")
ck("C8 work-all runs + attempts our case (or AUTO_WORK beat it)",
   st == 200 and j and j.get("ok") and (j.get("attempted", 0) >= 1 or _green_status_now == "DONE"),
   f"{st} attempted={j and j.get('attempted')} status={_green_status_now}")
row_status = wait_status(GREEN_ID, "DONE")
ck("C9 green case DONE (DB truth)", row_status == "DONE", row_status)

def wait_parselog(sid, timeout=90):
    dl = time.time() + timeout
    while time.time() < dl:
        pl = sql(f"SELECT outcome || ' ' || integrityMin || '/' || integrityAvg FROM ParseLog WHERE submissionId='{sid}' ORDER BY createdAt DESC LIMIT 1;")
        if pl and pl.strip() and "None" not in pl:
            return pl
        time.sleep(2)
    return pl

pl = wait_parselog(GREEN_ID)
ck("C10 ParseLog auto-delivered 100/100", "auto-delivered" in pl and "100" in pl, pl or "(no rows)")

st, b, j, _ = http("GET", "/api/reports", cookie=ck_op)
reps = (j or {}).get("reports", [])
rep = next((r for r in reps if "EISQA-OP-GREEN" in (r.get("name") or "")), None)
ck("C11 reports list has green report", rep is not None, str(reps)[:200])
if rep:
    fname = rep.get("name") or ""
    st, b, _, _ = http("GET", f"/api/report/download?file={fname}", cookie=ck_op)
    body_txt = b.decode("utf-8", "ignore")
    ck("C12 report download 200 + HTML report", st == 200 and len(b) > 500 and ("Balance" in body_txt or "integrity" in body_txt.lower()), f"{st} len={len(b)}")
st, b, j, _ = http("GET", "/api/engine/logs", cookie=ck_op)
logs_list = (j or {}).get("logs", [])
ck("C13a engine logs list accessible", st == 200 and j and j.get("ok") and len(logs_list) >= 1, str(st))
pl_id = logs_list[0].get("id") if logs_list else ""
st, b, j, _ = http("GET", f"/api/engine/logs?id={pl_id}", cookie=ck_op)
ck("C13b engine log detail by ParseLog id", st == 200 and j and j.get("ok") and (j.get("log") or {}).get("id") == pl_id, str(st))

st, b, _, _ = http("GET", f"/api/queue/action?id={GREEN_ID}&action=deliver&token=badtoken")
ck("C14 forged deliver token rejected", st in (400, 403, 404), str(st))

# ============================================================ D. CLIENT FLOW
print("\n===== D. CLIENT FLOW (own upload -> operator works -> client sees report; scoping) =====")
mb, mh = multipart(
    {"userId": "EISQA-CL-OWN", "email": MAIL_B, "country": "Germany", "visaType": "Student", "travelers": "1"},
    {"files": ("statement_green_B.pdf", pdf_bytes, "application/pdf")},
)
st, b, j, _ = http("POST", "/api/upload", raw_body=(mb, mh), cookie=ck_a)
ck("D1 client A upload accepted", st == 200 and j and j.get("ok"), f"{st} {str(j)[:160]}")
CL_ID = (j or {}).get("submissionId") or (j or {}).get("id") or ""
ck("D2 client case id returned", bool(CL_ID), str(j)[:160])

st, b, j, _ = http("GET", "/api/queue", cookie=ck_a)
ck("D3 client A sees own case", any(r.get("id") == CL_ID for r in (j or {}).get("queue", [])))
st, b, j, _ = http("GET", "/api/queue", cookie=ck_b)
ck("D4 client B does NOT see A's case", not any(r.get("id") == CL_ID for r in (j or {}).get("queue", [])))
st, b, j, _ = http("GET", "/api/queue", cookie=ck_op)
ck("D5 operator sees client case", any(r.get("id") == CL_ID for r in (j or {}).get("queue", [])))

st, b, j, _ = http("POST", "/api/queue/work-all", {}, cookie=ck_op)
_cl_status_now = sql(f"SELECT status FROM Submission WHERE id='{CL_ID}';")
ck("D6 work-all runs client case (or AUTO_WORK beat it)",
   st == 200 and j and j.get("ok") and (j.get("attempted", 0) >= 1 or _cl_status_now == "DONE"),
   f"{st} attempted={j and j.get('attempted')} status={_cl_status_now}")
row_status = wait_status(CL_ID, "DONE")
ck("D7 client case DONE (DB truth)", row_status == "DONE", row_status)

st, b, j, _ = http("GET", "/api/reports", cookie=ck_a)
own_rep = [r for r in (j or {}).get("reports", []) if "EISQA-CL-OWN" in (r.get("name") or "")]
ck("D8 client A sees OWN report", len(own_rep) >= 1, str((j or {}).get("reports", []))[:200])
st, b, j, _ = http("GET", "/api/reports", cookie=ck_b)
ck("D9 client B does NOT see A's report", not any("EISQA-CL-OWN" in (r.get("name") or "") for r in (j or {}).get("reports", [])))

sfid = sql(f"SELECT id FROM StatementFile WHERE submissionId='{CL_ID}' LIMIT 1;")
if sfid:
    st, _, _, _ = http("GET", f"/api/statement?id={sfid}", cookie=ck_a)
    ck("D10 client A downloads OWN statement", st == 200, str(st))
    st, _, _, _ = http("GET", f"/api/statement?id={sfid}", cookie=ck_b)
    ck("D11 client B blocked from A's statement", st == 403, str(st))
else:
    ck("D10 statement file exists", False, "no StatementFile row")
    ck("D11 statement access control", False, "no StatementFile row")

# ============================================================ E. RED PATH + NUDGE
print("\n===== E. RED PATH (non-statement -> needs-manual -> nudge -> signed retry) =====")
red_bytes = open(RED_PDF, "rb").read()
mb, mh = multipart(
    {"userId": "EISQA-RED", "email": MAIL_RED, "country": "", "visaType": "", "travelers": "1"},
    {"files": ("insurance_red.pdf", red_bytes, "application/pdf")},
)
st, b, j, _ = http("POST", "/api/upload", raw_body=(mb, mh), cookie=ck_op)
ck("E1 red upload accepted", st == 200 and j and j.get("ok"), f"{st} {str(j)[:160]}")
RED_ID = (j or {}).get("submissionId") or (j or {}).get("id") or ""
ck("E2 red case id returned", bool(RED_ID), str(j)[:160])

st, b, j, _ = http("POST", "/api/queue/work-all", {}, cookie=ck_op)
ck("E3 work-all runs red case", st == 200 and j and j.get("ok") and j.get("attempted", 0) >= 1,
   f"{st} attempted={j and j.get('attempted')}")
wait_status(RED_ID, lambda s: s in ("ANALYZING", "DONE"))
row_status = sql(f"SELECT status FROM Submission WHERE id='{RED_ID}';")
ck("E4 red case NOT DONE (DB truth)", row_status != "DONE", row_status)

def _pl_count():
    return int(sql(f"SELECT COUNT(*) FROM ParseLog WHERE submissionId='{RED_ID}';"))

_deadline = time.time() + 60
while _pl_count() < 1 and time.time() < _deadline:
    time.sleep(2)
pl = sql(f"SELECT outcome FROM ParseLog WHERE submissionId='{RED_ID}' ORDER BY createdAt DESC LIMIT 1;")
ck("E5 ParseLog unrecognized", "unrecognized" in pl, pl or "(no rows)")

st, b, j, _ = http("GET", "/api/queue", cookie=ck_op)
redrow = next((r for r in (j or {}).get("queue", []) if r.get("id") == RED_ID), None)
ck("E6 red case present in queue API", redrow is not None, str(redrow)[:160] if redrow else "missing")

tok = hmac_token(SESSION_SECRET, RED_ID, "retry")
st, b, _, _ = http("GET", f"/api/queue/action?id={RED_ID}&action=retry&token={tok}")
ck("E7 signed retry link 200 ok-page", st == 200, str(st))
_deadline = time.time() + 90
pl2 = 0
while time.time() < _deadline:
    pl2 = int(sql(f"SELECT COUNT(*) FROM ParseLog WHERE submissionId='{RED_ID}';"))
    if pl2 >= 2:
        break
    time.sleep(2)
ck("E8 retry re-ran engine", pl2 >= 2, str(pl2))

tok = hmac_token(SESSION_SECRET, RED_ID, "deliver")
st, b, _, _ = http("GET", f"/api/queue/action?id={RED_ID}&action=deliver&token={tok}")
ck("E9 deliver on red case refused", st in (200, 409) and any(w in b.lower() for w in [b"not", b"refus", b"error", b"danger", b"cannot", b"fail"]), f"{st}")

tok = hmac_token(SESSION_SECRET, RED_ID, "nudge")
st, b, _, _ = http("GET", f"/api/queue/action?id={RED_ID}&action=nudge&token={tok}")
ck("E10 signed nudge link 200", st == 200, str(st))

st, b, _, _ = http("POST", "/api/queue/complete-all", {}, cookie=ck_op)
ck("E11 complete-all 200", st == 200, str(st))
row_status = sql(f"SELECT status FROM Submission WHERE id='{RED_ID}';")
ck("E12 red stays non-DONE after complete-all", row_status != "DONE", row_status)

# ============================================================ F. SIGNED LINKS
print("\n===== F. SIGNED LINKS (start / workall / statement view) =====")
tok = hmac_token(SESSION_SECRET, GREEN_ID, "start")
st, b, _, _ = http("GET", f"/api/queue/action?id={GREEN_ID}&action=start&token={tok}")
ck("F1 signed start link handled (idempotent on DONE)", st in (200, 409), str(st))
wat = hmac_token(SESSION_SECRET, "__queue__", "workall")
st, b, _, _ = http("GET", f"/api/queue/work-all?token={wat}")
ck("F2 signed session-free work-all 200", st == 200, str(st))
st, b, _, _ = http("GET", f"/api/queue/work-all?token=deadbeef{'0' * 24}")
ck("F3 forged work-all token rejected", st in (400, 401, 403), str(st))
sfid_g = sql(f"SELECT id FROM StatementFile WHERE submissionId='{GREEN_ID}' LIMIT 1;")
svt = hmac_token(SESSION_SECRET, sfid_g, "view")
st, b, _, _ = http("GET", f"/api/statement/view?id={sfid_g}&token={svt}")
ck("F4 signed statement-view link 200", st == 200, str(st))
st, b, _, _ = http("GET", f"/api/statement/view?id={sfid_g}&token=badbadbad{'0' * 23}")
ck("F5 forged statement-view rejected", st in (400, 401, 403), str(st))

# ============================================================ G. ACCOUNTS ADMIN
print("\n===== G. ACCOUNTS ADMIN (add/reset/deactivate/reactivate) =====")
st, b, j, _ = http("GET", "/api/users", cookie=ck_op)
users0 = (j or {}).get("users", [])
ck("G1 users list (operator)", st == 200 and any(u.get("username") == "op.eis" for u in users0), str(st))
QA_USER = f"qa.temp{int(time.time()) % 1000000}"
st, b, j, _ = http("POST", "/api/users", {"action": "add", "username": QA_USER, "password": "Qa-Temp-2026!", "label": "QA temp", "role": "client"}, cookie=ck_op)
ck("G2 add user", st == 200 and j and j.get("ok"), f"{st} {str(j)[:120]}")
st, j, ck_tmp = login(QA_USER, "Qa-Temp-2026!")
ck("G3 new user can log in", st == 200 and ck_tmp, str(st))
st, b, j, _ = http("POST", "/api/users", {"action": "reset", "username": QA_USER, "password": "Qa-New-2026!"}, cookie=ck_op)
ck("G4 reset password", st == 200 and j and j.get("ok"), str(st))
st, j, _ = login(QA_USER, "Qa-New-2026!")
ck("G5 login with new password", st == 200, str(st))
st, b, j, _ = http("POST", "/api/users", {"action": "deactivate", "username": QA_USER}, cookie=ck_op)
ck("G6 deactivate user", st == 200 and j and j.get("ok"), str(st))
st, j, _ = login(QA_USER, "Qa-New-2026!")
ck("G7 deactivated login rejected", st in (401, 403) or not j.get("ok"), f"{st} {str(j)[:80]}")
st, b, j, _ = http("POST", "/api/users", {"action": "activate", "username": QA_USER}, cookie=ck_op)
ck("G8 reactivate user", st == 200 and j and j.get("ok"), str(st))
st, j, _ = login(QA_USER, "Qa-New-2026!")
ck("G9 reactivated login works", st == 200, str(st))

# ============================================================ H. DASHBOARD + LOGOUT
print("\n===== H. DASHBOARD + LOGOUT =====")
st, b, j, _ = http("GET", "/api/dashboard", cookie=ck_op)
ck("H1 operator dashboard 200 + totals", st == 200 and "totals" in json.dumps(j or {}), str(j)[:160])
st, b, j, _ = http("GET", "/api/dashboard", cookie=ck_a)
ck("H2 client dashboard scoped 200", st == 200, str(st))
st, b, j, h = http("POST", "/api/logout", cookie=ck_tmp)
sc = h.get("set-cookie", "")
ck("H3 logout clears session cookie", st == 200 and ("eis_session=" in sc) and ("Max-Age=0" in sc or "Expires=Thu, 01 Jan 1970" in sc or "eis_session=;" in sc), f"{st} {sc[:80]}")

# ============================================================ I. OUTBOX NO-SEND AUDIT
print("\n===== I. OUTBOX NO-SEND AUDIT (zero SMTP delivery) =====")
mails = [json.load(open(p)) for p in sorted(glob.glob(f"{OUTBOX}/*.json"))]
ck("I1 outbox has mails", len(mails) >= 4, str(len(mails)))
ck("I2 ZERO mails sent (all QUEUED, no-send)", all(m.get("status") == "QUEUED" for m in mails),
   f"sent={sum(1 for m in mails if m.get('status') == 'SENT')}")
ck("I3 every mail reason = no SMTP credentials", all(
    "no SMTP credentials" in (m.get("error") or "") for m in mails), str({m.get("error") for m in mails}))
kinds = {m.get("kind") for m in mails}
ck("I4 mail kinds cover alert+report+nudge", {"operator_alert", "report_ready", "client_nudge"} <= kinds, str(kinds))
lock_mails = [m for m in mails if m.get("intendedTo")]
ck("I5 lock intendedTo recorded", len(lock_mails) >= 1, str(len(lock_mails)))
alert = next((m for m in mails if m.get("kind") == "operator_alert"), None)
# Lock contract: when the recipient IS the lock address, no redirect happens
# (intendedTo absent); when it differs, to is force-redirected + intendedTo kept.
ck("I6 operator alert addressed to operator mailbox", bool(alert) and alert.get("to") == OPERATOR_MAIL
   and alert.get("intendedTo") in (None, OPERATOR_MAIL), str(alert and (alert.get("to"), alert.get("intendedTo"))))
rep_mail = next((m for m in mails if m.get("kind") == "report_ready" and m.get("submissionId") == CL_ID), None)
ck("I7 client report mail intendedTo = client addr", bool(rep_mail) and rep_mail.get("intendedTo") == MAIL_B, str(rep_mail and rep_mail.get("intendedTo")))
nudge = next((m for m in mails if m.get("kind") == "client_nudge"), None)
ck("I8 nudge intendedTo = red case email", bool(nudge) and nudge.get("intendedTo") == MAIL_RED, str(nudge and nudge.get("intendedTo")))
try:
    log = open(f"{OUTBOX}/NOTIFICATIONS.log").read()
    ck("I9 NOTIFICATIONS.log consistent", "QUEUED" in log, "")
except FileNotFoundError:
    ck("I9 NOTIFICATIONS.log consistent", False, "missing")
allblob = json.dumps(mails)
ck("I10 ZERO forbidden-address occurrences", "beta.com.eg" not in allblob)

# ============================================================ SUMMARY
print("\n===== SUMMARY =====")
fails = [r for r in RESULTS if not r[1]]
print(f"{len(RESULTS) - len(fails)}/{len(RESULTS)} PASS" + (f" | FAILURES: {[f[0] for f in fails]}" if fails else " | ALL PASS"))
