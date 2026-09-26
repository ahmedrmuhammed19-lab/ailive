#!/usr/bin/env python3
"""Global EIS — Design Standard v1.3 compliance gate (permanent, reusable).

Usage:
  python3 scripts/qa_v13_check.py <report.html> [more.html ...]
  python3 scripts/qa_v13_check.py --all     # the active client reports

Exit 0 = ALL PASS (deliverable may ship)  |  Exit 1 = any FAIL (fix first).

Rules enforced (Standard ratified 26/09/2026 — see templates/global_eis_standard_v1.3.html):
  R1  <style> block == standard v1.3 CSS verbatim; only whitelisted generator-local
      extensions allowed (currently: .tag.mut). No embedded palettes, teal retired.
  R2  every class used in the body is defined in the CSS (no unstyled leaks).
  R3  shell present: Download-PDF button + ref-line citing Standard v1.3.
  R4  canonical footer: "Prepared By: Global EIS" + full legal disclaimer.
  R5  no legacy wording (Standard/Pipeline v1.2) anywhere in the file.
"""
import re
import sys
from pathlib import Path

BASE = Path('/home/z/my-project')
STD = BASE / 'templates' / 'global_eis_standard_v1.3.html'
ALLOWED_EXTRA_CLASSES = {'tag', 'mut'}          # .tag.mut generator-local extension
# --all discovers report files locally at runtime; client names are never
# hardcoded in the repo (privacy: this repository is public).
ACTIVE_REPORTS = sorted(str(p) for p in BASE.glob('download/*EIS_Report*.html'))


def _css_of(html: str) -> str:
    m = re.search(r'<style>(.*?)</style>', html, re.S)
    return m.group(1) if m else ''


def check_report(path: str):
    html = Path(path).read_text(encoding='utf-8')
    css = _css_of(html)
    body = html[html.find('</style>'):] if '</style>' in html else html
    rows = []

    std_css = _css_of(STD.read_text(encoding='utf-8'))
    plain = re.sub(r'/\*.*?\*/', '', css, flags=re.S).strip()
    std_plain = re.sub(r'/\*.*?\*/', '', std_css, flags=re.S).strip()
    extra_selectors = set(re.findall(r'\.([a-zA-Z][\w-]*)', plain.replace(std_plain, '', 1)))
    r1 = plain == std_plain or extra_selectors <= ALLOWED_EXTRA_CLASSES
    rows.append(('R1 CSS == standard v1.3 verbatim (whitelist .tag.mut)', r1,
                 f'extra selectors: {sorted(extra_selectors) or "none"}' if not r1 else ''))

    used = set()
    for c in re.findall(r'class="([^"]+)"', body):
        used.update(c.split())
    defined = set(re.findall(r'\.([a-zA-Z][\w-]*)', css))
    undef = sorted(used - defined)
    rows.append(('R2 no undefined body classes', not undef, f'undefined: {undef}' if undef else ''))

    r3 = ('Download PDF Report' in html and 'download-btn' in html
          and bool(re.search(r'Global EIS\s+(Design\s+)?(Standard\s+)?v1\.3', html)))
    rows.append(('R3 shell: PDF button + ref-line cites v1.3', r3, ''))

    r4 = ('Prepared By:</strong> Global EIS' in html
          and 'does not constitute legal advice' in html)
    rows.append(('R4 canonical footer + full legal disclaimer', r4, ''))

    legacy = [w for w in ('Standard v1.2', 'Pipeline v1.2', 'Design v1.2') if w in html]
    rows.append(('R5 no legacy v1.2 wording', not legacy, f'found: {legacy}' if legacy else ''))

    return all(b for _, b, _ in rows), rows


def main(argv):
    files = ACTIVE_REPORTS if (not argv or argv[0] == '--all') else argv
    files = [f if f.startswith('/') else str(BASE / f) for f in files]
    all_ok = True
    for f in files:
        ok, rows = check_report(f)
        all_ok &= ok
        print(f"\n{Path(f).name}: {'PASS' if ok else 'FAIL'}")
        for label, b, detail in rows:
            print(f"   [{'PASS' if b else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    print(f"\n== Design Standard v1.3 gate: {'PASS' if all_ok else 'FAIL'} ==")
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
