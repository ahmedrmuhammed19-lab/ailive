#!/usr/bin/env python3
"""Probe column geometry of the 3 CIB digital statements (Bola Ayad accounts)."""
import pdfplumber, re, json

FILES = {
    'saving':  '/home/z/my-project/upload/saving.pdf',
    'current': '/home/z/my-project/upload/current check.pdf',
    'usd':     '/home/z/my-project/upload/USD.pdf',
}

for key, path in FILES.items():
    pdf = pdfplumber.open(path)
    p = pdf.pages[0]
    words = p.extract_words()
    # header words
    hdr = {w['text']: (round(w['x0']), round(w['x1']), round(w['top'])) for w in words}
    print(f"== {key} == page size {round(p.width)}x{round(p.height)}")
    for t in ['Transaction', 'Debit', 'Credit', 'Balance', 'Reference', 'Description']:
        cands = [(w['text'], round(w['x0']), round(w['x1']), round(w['top'])) for w in words if t in w['text']]
        print('  hdr', t, cands[:4])
    # amount tokens on page 1 with x1
    amt_re = re.compile(r'^-?\d{1,3}(?:,\d{3})*\.\d{2}$')
    toks = [(round(w['x0']), round(w['x1']), round(w['top']), w['text']) for w in words if amt_re.match(w['text'])]
    xs1 = sorted(set(x1 for _, x1, _, _ in toks))
    print('  amount x1 clusters:', xs1)
    # date tokens x0
    date_re = re.compile(r'^\d{2}-[A-Za-z]+-?2026|^\d{1,2}-$')
    dtoks = [(round(w['x0']), round(w['x1']), w['text']) for w in words if date_re.match(w['text'])]
    print('  date x0 sample:', dtoks[:6], '... count', len(dtoks))
    pdf.close()
