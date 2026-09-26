#!/usr/bin/env python3
"""CIB statement extraction — Statements_28FEB26_to_31AUG26.pdf
Column semantics (verified empirically):
  date      x0 ~ 40-41
  desc      x0 ~ 149+
  DEBIT amt  right edge x1 ~ 425-445
  CREDIT amt right edge x1 ~ 495-515
  BALANCE   right edge x1 > 520
Output: /home/z/my-project/scripts/cib_txns.json
"""
import pdfplumber, re, json
from collections import defaultdict

PDF = '/home/z/my-project/upload/Statements_28FEB26_to_31AUG26.pdf'
OUT = '/home/z/my-project/scripts/cib_txns.json'

date_re = re.compile(r'^\d{2}[A-Z]{3}26$')
amt_re = re.compile(r'^\d{1,3}(?:,\d{3})*\.\d{2}$')
int_re = re.compile(r'^\d{1,4}$')

pdf = pdfplumber.open(PDF)
rows_out = []       # transactions
checkpoints = []    # printed balances (opening/closing/running)
strips = []         # monthly summary strips
cur_month = None
last_date = None

for pno, page in enumerate(pdf.pages, start=1):
    words = page.extract_words()
    # group words into visual rows by 'top' with tolerance
    ws = sorted(words, key=lambda w: (round(w['top']), w['x0']))
    lines = []
    for w in ws:
        if lines and abs(w['top'] - lines[-1][-1]['top']) <= 3:
            lines[-1].append(w)
        else:
            lines.append([w])
    page_tx = 0
    for ln in lines:
        ln = sorted(ln, key=lambda w: w['x0'])
        texts = [w['text'] for w in ln]
        # strip line: y > 660 and >=4 numeric tokens
        top = ln[0]['top']
        nums = [w for w in ln if amt_re.match(w['text'])]
        if top > 660 and len(nums) >= 4:
            strips.append({
                'page': pno,
                'raw': texts,
                'nums': [w['text'] for w in nums],
                'xs': [round(w['x0']) for w in nums],
            })
            continue
        # transaction date row: first token is date at x<60
        first = ln[0]
        if date_re.match(first['text']) and first['x0'] < 60:
            d = first['text']
            last_date = d
            # classify numeric tokens by right edge
            debit = credit = balance = None
            for w in ln:
                if amt_re.match(w['text']):
                    x1 = w['x1']
                    if x1 > 520:
                        balance = w['text']
                    elif x1 > 445:
                        credit = w['text']
                    else:
                        debit = w['text']
            # opening/closing balance rows
            joined = ' '.join(texts)
            if 'OPENING BALANCE' in joined or 'CLOSING BALANCE' in joined:
                kind = 'OPENING' if 'OPENING' in joined else 'CLOSING'
                checkpoints.append({'page': pno, 'kind': kind, 'date': d,
                                    'balance': balance or (nums[0]['text'] if nums else None)})
                continue
            if debit is None and credit is None:
                # date row without amount -> continuation anomaly; record raw
                rows_out.append({'page': pno, 'date': d, 'dir': '?',
                                 'amount': None, 'balance': None,
                                 'desc': joined, 'anomaly': 'no_amount'})
                continue
            page_tx += 1
            rows_out.append({
                'page': pno, 'date': d,
                'dir': 'DR' if debit else 'CR',
                'amount': debit if debit else credit,
                'balance': balance,
                'desc': joined,
            })
        elif first['x0'] >= 140 and texts[0] not in ('*',) and top < 660 and top > 240:
            # continuation line -> append desc to previous txn
            if rows_out and not date_re.match(first['text']):
                prev = rows_out[-1]
                if prev.get('desc') is not None:
                    prev['desc'] += ' | ' + ' '.join(texts)
    # chunk boundary detection via CLOSING BALANCE count

# ---- parse numbers ----
def f(x):
    return float(x.replace(',', '')) if x else None

for t in rows_out:
    t['amt'] = f(t['amount'])
    t['bal'] = f(t['balance'])

print(f'Total txn rows: {len(rows_out)}')
print(f'  DR: {sum(1 for t in rows_out if t["dir"]=="DR")}')
print(f'  CR: {sum(1 for t in rows_out if t["dir"]=="CR")}')
print(f'  anomalies: {sum(1 for t in rows_out if t.get("anomaly"))}')
print(f'Checkpoints: {len(checkpoints)}')
for c in checkpoints:
    print(f'  p{c["page"]} {c["kind"]} {c["date"]} = {c["balance"]}')
print(f'Strips: {len(strips)}')
for s in strips:
    print(f'  p{s["page"]}: {s["nums"]}')

json.dump({'txns': rows_out, 'checkpoints': checkpoints, 'strips': strips},
          open(OUT, 'w'), ensure_ascii=False)
print('saved ->', OUT)
