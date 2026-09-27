"""Self-improvement telemetry for the workspace parser engines.

Every analysis appends one JSONL record to parser_samples/learn_log.jsonl:
parser version, layout mode, chain integrity, and the exact rows that failed
verification. Over time this file becomes the training ledger — recurring
breakage patterns (glued amounts, missing balances, odd date formats) show up
here first and feed the next parser iteration.

Usage (from any engine script):
    from learn_log import log_learn
    try:
        log_learn(source=path, mode="CIB-pdfplumber-zones",
                  integrity_pct=94.8, ok_rows=94, total_rows=97,
                  unmatched=issues)
    except Exception as e:
        print(f"[learn] skipped: {e}")

The logger never raises into the caller — a telemetry failure must never
break an analysis run.
"""

import datetime
import json
import pathlib

PARSER_VERSION = "eis-py/1.1"

LOG_DIR = pathlib.Path(__file__).resolve().parent.parent / "parser_samples"
LOG_FILE = LOG_DIR / "learn_log.jsonl"


def log_learn(
    *,
    source,
    mode,
    integrity_pct,
    ok_rows=None,
    total_rows=None,
    unmatched=None,
    extra=None,
):
    """Append one learning record; best-effort, never raises."""
    rec = {
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
        "parser": PARSER_VERSION,
        "source": str(source),
        "mode": mode,
        "integrity_pct": integrity_pct,
        "ok_rows": ok_rows,
        "total_rows": total_rows,
        "unmatched": (unmatched or [])[:40],
        "extra": extra or {},
    }
    LOG_DIR.mkdir(exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(
        f"[learn] {pathlib.Path(str(source)).name} mode={mode} "
        f"integrity={integrity_pct}% rows={ok_rows}/{total_rows} -> {LOG_FILE}"
    )


def tail(n=10):
    """Print the last n records — quick self-review of recent failures."""
    if not LOG_FILE.exists():
        print(f"[learn] no log yet at {LOG_FILE}")
        return
    lines = LOG_FILE.read_text(encoding="utf-8").strip().splitlines()
    for line in lines[-n:]:
        try:
            r = json.loads(line)
            print(
                f"{r['ts']}  {r['source'][:40]:40} {r['mode']:24} "
                f"integrity={r['integrity_pct']}% rows={r['ok_rows']}/{r['total_rows']} "
                f"unmatched={len(r['unmatched'])}"
            )
        except Exception:
            continue
