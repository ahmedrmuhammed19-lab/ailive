#!/usr/bin/env python3
"""Bola Ayad — 3 CIB digital statements parser (Pass A: pdfplumber, x-column exact).

Outputs scripts/bola_work/{key}_rows.json with header + rows in PRINT order
(newest first, as printed) plus chronological index. Each row:
  {page, idx_print, tdate, vdate, ref, desc, debit, credit, balance}
Amounts are floats; None = column empty. Classification by right-edge x1:
  balance x1>=505, credit 440<=x1<505, debit 380<=x1<440  (measured probe).
"""
import pdfplumber, re, json, os, sys

FILES = {
    'saving':  '/home/z/my-project/upload/saving.pdf',
    'current': '/home/z/my-project/upload/current check.pdf',
    'usd':     '/home/z/my-project/upload/USD.pdf',
}
OUT = '/home/z/my-project/scripts/bola_work'
os.makedirs(OUT, exist_ok=True)

AMT = re.compile(r'^-?\d{1,3}(?:,\d{3})*\.\d{2}$')
DATE_FULL = re.compile(r'^\d{1,2}-[A-Za-z]+-\d{4}$')
DATE_PART = re.compile(r'^\d{1,2}-$')
MONTH_CONT = re.compile(r'^[A-Za-z]+-\d{4}$')
INT = re.compile(r'^\d{1,4}$')

def parse_amount(s):
    return float(s.replace(',', ''))

def norm_date(s):
    return re.sub(r'\s+', '', s)

def parse_file(key, path):
    pdf = pdfplumber.open(path)
    header = {}
    rows = []
    for pno, page in enumerate(pdf.pages, 1):
        words = page.extract_words()
        # table header top = the line containing 'Debit'
        hdr_top = None
        for w in words:
            if w['text'] == 'Debit':
                hdr_top = w['top']; break
        if hdr_top is None:
            continue
        # info header (page 1): line above hdr_top containing the account number
        if pno == 1:
            info = [w for w in words if w['top'] < hdr_top - 4]
            acct = next((w['text'] for w in info if re.match(r'^\d{19}$', w['text'])), None)
            amts = [w['text'] for w in sorted(info, key=lambda w: w['x0']) if AMT.match(w['text'])]
            cid  = next((w['text'] for w in info if re.match(r'^\d{8}$', w['text'])), None)
            cur  = next((w['text'] for w in info if w['text'] in ('EGP', 'USD')), None)
            dates = [w['text'] for w in sorted(info, key=lambda w: w['x0']) if DATE_FULL.match(w['text'])]
            header = {'customer_id': cid, 'account': acct, 'currency': cur,
                      'opening': parse_amount(amts[0]) if amts else None,
                      'closing_raw': amts[1] if len(amts) > 1 else None,
                      'closing': parse_amount(amts[1]) if len(amts) > 1 else None,
                      'from': dates[0] if dates else None, 'to': dates[1] if len(dates) > 1 else None}
        # visual lines
        lines = []
        for w in words:
            if w['top'] <= hdr_top + 5:
                continue
            if lines and abs(w['top'] - lines[-1]['top']) <= 3:
                lines[-1]['ws'].append(w)
            else:
                lines.append({'top': w['top'], 'ws': [w]})
        for ln in lines:
            ws = sorted(ln['ws'], key=lambda w: (w['x0'], w['x1']))
            toks = [(w['text'], round(w['x0']), round(w['x1'])) for w in ws]
            # drop pure page-number lines (single int token)
            if len(toks) == 1 and INT.match(toks[0][0]):
                continue
            # drop table-header strayer sub-lines (e.g. the lone 'No.' under Reference)
            if all(t[0] in ('No.',) for t in toks):
                continue
            first = toks[0]
            is_start = first[1] < 60 and (DATE_FULL.match(first[0]) or DATE_PART.match(first[0]))
            if is_start:
                rows.append({'page': pno, 'tdate_t': [], 'vdate_t': [], 'ref_t': [],
                             'desc_t': [], 'amounts': [], 'top': ln['top']})
                cur = rows[-1]
            else:
                if not rows:
                    continue  # stray pre-table content
                cur = rows[-1]
            for t, x0, x1 in toks:
                if AMT.match(t) and x0 >= 370:
                    cur['amounts'].append((t, x1))
                elif x0 < 95:
                    cur['tdate_t'].append(t)
                elif x0 < 160:
                    cur['vdate_t'].append(t)
                elif x0 < 248:
                    cur['ref_t'].append(t)
                else:
                    cur['desc_t'].append(t)
    pdf.close()

    out_rows = []
    for i, r in enumerate(rows):
        tdate = norm_date(' '.join(r['tdate_t']))
        vdate = norm_date(' '.join(r['vdate_t']))
        ref = ' '.join(r['ref_t']).strip()
        desc = ' '.join(r['desc_t']).strip()
        debit = credit = balance = None
        bal_raw = None
        for t, x1 in r['amounts']:
            if x1 >= 505:
                balance = parse_amount(t); bal_raw = t
            elif x1 >= 440:
                credit = parse_amount(t)
            elif x1 >= 380:
                debit = parse_amount(t)
            else:
                # long desc word matched? park it in desc
                desc += ' ' + t
        out_rows.append({'page': r['page'], 'idx_print': i + 1, 'tdate': tdate, 'vdate': vdate,
                         'ref': ref, 'desc': desc, 'debit': debit, 'credit': credit,
                         'balance': balance, 'balance_raw': bal_raw})
    return header, out_rows

summary = {}
for key, path in FILES.items():
    header, rows = parse_file(key, path)
    # fix wrapped dates ("30- September-2026" style already joined by norm_date)
    json.dump({'header': header, 'rows': rows}, open(f'{OUT}/{key}_rowsA.json', 'w'), ensure_ascii=False, indent=1)
    n = len(rows)
    no_bal = [r['idx_print'] for r in rows if r['balance'] is None]
    no_amt = [r['idx_print'] for r in rows if r['debit'] is None and r['credit'] is None]
    both   = [r['idx_print'] for r in rows if r['debit'] is not None and r['credit'] is not None]
    no_ref = [r['idx_print'] for r in rows if not r['ref']]
    pages = sorted(set(r['page'] for r in rows))
    summary[key] = {'rows': n, 'no_balance': no_bal, 'no_amount': no_amt, 'both_amounts': both,
                    'no_ref': no_ref, 'header': header, 'pages_with_rows': pages,
                    'per_page': {p: sum(1 for r in rows if r['page'] == p) for p in pages}}
    print(key, json.dumps(summary[key], ensure_ascii=False)[:600])

json.dump(summary, open(f'{OUT}/parse_summary.json', 'w'), ensure_ascii=False, indent=1)
print('PASS A DONE')
