#!/usr/bin/env python3
"""CHUNK-TEST: reproduce the owner's failed upload (File 1/1 part 1/2 -> 404).

Replicates upload-panel.tsx chunked protocol exactly:
  part 0: uploadId/fileIdx/chunkIndex/chunksTotal/fileName/fileChunk  -> stage
  part 1: same + final=1 + manifest + intake fields                   -> finalize
Asserts 200 on both parts, case row created, reassembled byte size EXACT,
then operator-clears the test case. Run with mail creds stashed (no SMTP).
"""
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
SRC = "/home/z/my-project/tests/e2e_fixtures/statement_scan_clean.pdf"
PAD_TO = 6_500_000  # > 2 chunks at 4 MiB -> "File 1/1 (part 1/2)" scenario
OP = ("op.eis", "Op-Test-2026!")
ok = True


def ck(name, cond, detail=""):
    global ok
    ok = ok and bool(cond)
    print(("PASS" if cond else "FAIL"), name, detail if not cond else detail)


def http(method, path, body=None, raw=None, cookie=None, timeout=120):
    req = urllib.request.Request(BASE + path, method=method)
    if cookie:
        req.add_header("Cookie", cookie)
    data, hdr = (None, None)
    if raw is not None:
        data, hdr = raw
        req.add_header("Content-Type", hdr)
    elif body is not None:
        data = json.dumps(body).encode()
        hdr = "application/json"
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def multipart(fields, files):
    b = uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, (fname, blob) in files.items():
        out += (
            f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; "
            f"filename=\"{fname}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        ).encode()
        out += blob + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={b}"


def db_q(sql):
    con = sqlite3.connect(DB)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def main():
    global ok
    # operator session (capture Set-Cookie)
    req = urllib.request.Request(BASE + "/api/login", method="POST",
                                 data=json.dumps({"username": OP[0], "password": OP[1]}).encode(),
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=30)
    cookie = resp.headers.get("Set-Cookie", "").split(";")[0]
    ck("operator login", resp.status == 200 and len(cookie) > 0, f"cookie={cookie[:20]}")

    # padded statement > 2 chunks
    blob = open(SRC, "rb").read()
    padded = blob + b"\n%" + b"PADDING" * 100 + b"\n"
    padded += b"%" + b"A" * (PAD_TO - len(padded)) + b"\n"
    name = "chunk_regression_scan.pdf"
    chunks = 2
    size = len(padded)
    ck("fixture built", size > 4 * 1024 * 1024, f"size={size}")

    upload_id = str(uuid.uuid4())
    manifest = [{"fileIdx": 0, "chunksTotal": chunks, "fileName": name}]
    before = db_q("SELECT COUNT(*) FROM Submission")[0][0]

    # part 0 (stage)
    fd, ct = multipart(
        {"uploadId": upload_id, "fileIdx": "0", "chunkIndex": "0",
         "chunksTotal": str(chunks), "fileName": name},
        {"fileChunk": (f"{name}.part0", padded[: 4 * 1024 * 1024])},
    )
    st0, b0 = http("POST", "/api/upload", raw=(fd, ct), cookie=cookie)
    ck("part 1/2 accepted (was 404 before restore)", st0 == 200, f"st={st0} {b0[:200]}")

    # part 1 (final: manifest + intake)
    fields = {"uploadId": upload_id, "fileIdx": "0", "chunkIndex": "1",
              "chunksTotal": str(chunks), "fileName": name, "final": "1",
              "manifest": json.dumps(manifest), "userId": f"CHUNKTEST-{uuid.uuid4().hex[:8]}",
              "email": "", "country": "", "visaType": "", "travelers": "1"}
    fd, ct = multipart(fields, {"fileChunk": (f"{name}.part1", padded[4 * 1024 * 1024:])})
    st1, b1 = http("POST", "/api/upload", raw=(fd, ct), cookie=cookie)
    ck("part 2/2 finalize accepted", st1 == 200, f"st={st1} {b1[:200]}")
    out = json.loads(b1) if st1 == 200 else {}
    ck("batch ok=true", out.get("ok") is True, str(out)[:200])

    time.sleep(1.0)
    rows = db_q("SELECT id, originalName, LENGTH(data) FROM StatementFile "
                "WHERE originalName=? ORDER BY id DESC LIMIT 1", ) if False else None
    con = sqlite3.connect(DB)
    row = con.execute("SELECT id, originalName, sizeBytes, LENGTH(data), storedPath FROM StatementFile "
                      "WHERE originalName=? ORDER BY rowid DESC LIMIT 1", (name,)).fetchone()
    con.close()
    ck("file row created", row is not None)
    if row:
        stored = row[2] if row[2] is not None else 0
        blob_len = row[3] if row[3] is not None else 0
        sp = row[4]
        fs_len = os.path.getsize(sp) if sp and os.path.exists(sp) else 0
        # reassembly EXACT in whichever storage mode is active (DB blob or fs)
        ck("reassembled size EXACT", stored == size and (blob_len == size or fs_len == size),
           f"sizeBytes={stored} dataLen={blob_len} fsLen={fs_len} sent={size}")

    subs_after = db_q("SELECT COUNT(*) FROM Submission")[0][0]
    ck("submission queued", subs_after == before + 1, f"{before}->{subs_after}")

    # cleanup test case (operator clear, keep other data)
    if out.get("ok") and out.get("cases"):
        cid = out["cases"][0].get("id") if isinstance(out["cases"], list) else None
        if cid:
            stc, _ = http("POST", "/api/queue/clear", {"confirm": "DELETE", "caseId": cid},
                          cookie=cookie)
            print("cleanup clear st=", stc, "(non-fatal)")
    print("\nCHUNK-TEST:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
