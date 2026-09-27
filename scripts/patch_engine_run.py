#!/usr/bin/env python3
"""Patch engine-run.ts: OCR reason branch + windowSummary in draft email (text + html)."""
import pathlib

P = pathlib.Path("/home/z/my-project/src/lib/engine-run.ts")
s = P.read_text()
orig = s

# 1) reason: add OCR branch first
old_reason = "    const reason = analysis.allVerified\n"
new_reason = (
    "    const reason = analysis.ocrUsed\n"
    "      ? `OCR shadow mode: this draft was recovered from a scanned image — auto-delivery is disabled for OCR sources; review and mark DONE.\\n\\n`\n"
    "      : analysis.allVerified\n"
)
assert s.count(old_reason) == 1, "reason anchor not unique"
s = s.replace(old_reason, new_reason)

# 2) text body: windowSummary line after Accounts
old_txt = "        `Accounts:\\n${legLines}\\n\\n` +\n        reason +\n"
new_txt = (
    "        `Accounts:\\n${legLines}\\n\\n` +\n"
    "        (analysis.windowSummary ? `Period / 6-month window: ${analysis.windowSummary}\\n\\n` : \"\") +\n"
    "        reason +\n"
)
assert s.count(old_txt) == 1, "text-body anchor not unique"
s = s.replace(old_txt, new_txt)

# 3) html body: windowSummary paragraph after the integrity paragraph
old_html = (
    '`<b>${integrity.join("% / ")}%</b> (gate ${autoDeliverMinPct()}%). The draft is on the portal Reports tab; '
    "review it, then mark DONE to deliver.</p>` +\n"
)
new_html = (
    '`<b>${integrity.join("% / ")}%</b> (gate ${autoDeliverMinPct()}%). The draft is on the portal Reports tab; '
    "review it, then mark DONE to deliver.</p>` +\n"
    "        (analysis.windowSummary\n"
    '          ? `<p style="margin:0 0 12px;color:#59636e;font-size:12px;line-height:1.55;">Period &amp; 6-month window: ${esc(analysis.windowSummary)}</p>`\n'
    '          : "") +\n'
)
assert s.count(old_html) == 1, "html-body anchor not unique"
s = s.replace(old_html, new_html)

P.write_text(s)
print("patched ok —", len(orig), "->", len(s), "bytes")
