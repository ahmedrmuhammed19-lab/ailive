#!/usr/bin/env python3
"""SO-9 class audit: every class= used in an HTML file must be defined in the
canonical REPORT_CSS (src/lib/report_design.ts) or be a template-state class
emitted by reportShell itself. Usage: python3 so9_class_audit.py <file.html>"""
import re, sys

SRC = "/home/z/my-project/src/lib/report_design.ts"
ts = open(SRC, encoding="utf-8").read()
css = re.search(r"export const REPORT_CSS = `(.*?)`;", ts, re.S).group(1)

path = sys.argv[1]
doc = open(path, encoding="utf-8").read()

used = set()
for m in re.finditer(r'class="([^"]+)"', doc):
    for c in m.group(1).split():
        used.add(c)

defined = set(re.findall(r"\.([A-Za-z][\w-]*)", css))
# classes state-dependent in the shell/print contract
implicit = {"pass", "fail", "row-active", "full-width", "value-first", "in", "out",
            "warn", "low", "blue", "red", "green", "danger", "success", "warning",
            "big", "small", "watermark-box", "ref-line", "legal", "sig-line",
            "kpi-value", "kpi-label", "note", "value", "num", "text-right",
            "text-center", "text-success", "text-danger"}
# tag() emits "tag <tone>" — tones covered by implicit; legacy one-off builds may
# carry .badge/.verdict-box/.section — flag them if seen outside specimens.
missing = sorted(c for c in used if c not in defined and c not in implicit)

print(f"used={len(used)} defined_css={len(defined)}")
if missing:
    print("MISSING:", ", ".join(missing))
    sys.exit(1)
print("SO-9 CLASS AUDIT: NONE missing — PASS")
