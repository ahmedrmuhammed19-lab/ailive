#!/usr/bin/env python3
# DL-7: KPI specimen — default (label-first) vs value-first option, Master v1.2.2
# CSS extracted verbatim from src/lib/report_design.ts (the source of truth, SO-9).
import hashlib, re, datetime

SRC = '/home/z/my-project/src/lib/report_design.ts'
OUT = '/home/z/my-project/download/00_Specimen_KPI_Styles_Master_v122.html'

ts = open(SRC, encoding='utf-8').read()
css = re.search(r'export const REPORT_CSS = `(.*?)`;', ts, re.S).group(1)
assert '${' not in css, 'unexpected interpolation in REPORT_CSS'
assert '.kpi-card.value-first' in css, 'v1.2.2 modifier missing from source'

version = re.search(r'TEMPLATE_VERSION = "([^"]+)"', ts).group(1)
TODAY = datetime.date.today().isoformat()

def card(mods, label, value, note=None, vf=False):
    cls = 'kpi-card' + (f' {mods}' if mods else '') + (' value-first' if vf else '')
    n = f'<div class="note">{note}</div>' if note else ''
    return f'<div class="{cls}"><h3>{label}</h3><div class="value">{value}</div>{n}</div>'

default_grid = '\n'.join([
    card(None, 'Closing Balance (EGP) &mdash; 26 Aug 2026', '2,537,761.72'),
    card('success', 'Transaction Chain Verified', '440/440', 'Every opening balance reconciles to the prior closing.'),
    card('warning', 'Joint 2-Traveller UK Coverage', '6.18&times; (617.6%)', 'Combined funds vs embassy threshold.'),
])

vf_grid = '\n'.join([
    card(None, 'Closing Balance (EGP) &mdash; 26 Aug 2026', '2,537,761.72', vf=True),
    card('success', 'Transaction Chain Verified', '440/440', 'Every opening balance reconciles to the prior closing.', vf=True),
    card('warning', 'Joint 2-Traveller UK Coverage', '6.18&times; (617.6%)', 'Combined funds vs embassy threshold.', vf=True),
])

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KPI Specimen &mdash; {version}</title>
<style>{css}</style>
</head>
<body>
<div class="container">

<div class="header">
<button class="download-btn" onclick="window.print()">Print / Save as PDF</button>
<div class="tag">GLOBAL EIS &middot; DESIGN SYSTEM SPECIMEN &middot; CASE DL-7</div>
<h1>KPI Card Styles</h1>
<p class="small">{version}</p>
<p class="small">Advantage adopted from the challenger variant &mdash; value on top, label below, accents intact</p>
</div>

<div class="content">

<div class="section-title">Default &mdash; label first (all existing reports, unchanged)</div>
<div class="kpi-grid">
{default_grid}
</div>

<div class="section-title">New option &mdash; value first (opt-in per card, add class "value-first")</div>
<div class="kpi-grid">
{vf_grid}
</div>

<div class="alert-box"><b>USAGE GUIDANCE.</b> Keep the default label-first card for verification metrics (chain counts, checkpoint matches) where the qualifier matters most. Use the value-first card for hero metrics &mdash; closing balance, totals &mdash; where the number itself is the headline. Both share the same accent system: green for verified strengths, amber for context, red for flags. Existing reports never change; the option only activates where a generator explicitly adds the class.</div>

<div class="signoff">
<div class="sig-line"><b>Source of truth.</b> CSS extracted verbatim from src/lib/report_design.ts &mdash; {version} &middot; Generated {TODAY} &middot; Specimen sha256 recorded in worklog DL-7</div>
</div>

</div>

<div class="footer">
<p class="small">Global EIS &middot; {version} &middot; Specimen page {TODAY} &middot; Built entirely from the Master stylesheet (SO-9 compliant)</p>
</div>

</div>
</body>
</html>'''

open(OUT, 'w', encoding='utf-8').write(html)
out = open(OUT, 'rb').read()
print(f'WROTE {OUT}')
print(f'size: {len(out):,} B | sha256 {hashlib.sha256(out).hexdigest()[:16]}...')
print(f'version: {version}')
print('modifier present in page:', 'value-first' in html)
