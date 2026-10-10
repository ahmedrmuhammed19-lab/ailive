#!/usr/bin/env python3
"""Bola Ayad — G9 ADVERSARIAL AUDIT (cross-statement binding).

Hunts:
  H1  identical transaction refs appearing in >=2 statements (076/208/211) —
      verify opposite directions + amounts (FX implied for EGP<->USD pairs)
  H2  saving reversal pairs: originals vs bank-printed negative rows (ref match)
  H3  suspiciously equal pairs / flow-through: credit followed within 7 days
      by debit of the same amount (round-number tell)
  H4  sweep cover: current-account sweep credits vs saving debits same window
  H5  shared instruments: credit card number, certificate account numbers
Output: scripts/bola_work/g9.json (+ enriched rows with reconstructed Arabic).
"""
import json, re
from collections import defaultdict

OUT = '/home/z/my-project/scripts/bola_work'
KEYS = ['saving', 'current', 'usd']
DATA = {k: json.load(open(f'{OUT}/{k}_rowsA.json')) for k in KEYS}

AR = re.compile(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]')
AR_ONLY_DIGIT = re.compile(r'^(?=[^\d]*[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF])(?=.*\d)')

def fix_token(t):
    if AR.search(t):
        if AR_ONLY_DIGIT.match(t):
            return t[::-1]                      # mixed arabic+digit: full reverse
        # reverse only arabic sub-runs, keep latin/digit sub-run order
        parts = re.split(r'([\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+)', t)
        return ''.join(p[::-1] if AR.search(p) else p for p in parts)
    return t

def fix_desc(desc):
    toks = desc.split(' ')
    # find contiguous runs of arabic-bearing tokens; reverse run order + tokens
    out, run = [], []
    for t in toks:
        if AR.search(t):
            run.append(t)
        else:
            if run:
                out.extend(reversed([fix_token(x) for x in run])); run = []
            out.append(t)
    if run:
        out.extend(reversed([fix_token(x) for x in run]))
    return ' '.join(out)

for k in KEYS:
    for r in DATA[k]['rows']:
        r['desc_fixed'] = fix_desc(r['desc'])

# reconstruct the account holder's name from page-1 visual glyphs (verified form)
HOLDER_EN = 'Bola Ayad Salama Awad Gerges'
HOLDER_AR = 'بولا عياد سلامه عوض جرجس'

# ---------------- H1: cross-statement ref bindings ----------------
ref_map = defaultdict(list)
for k in KEYS:
    for r in DATA[k]['rows']:
        ref = r['ref'].strip()
        if ref:
            ref_map[ref].append({'stmt': k, 'page': r['page'], 'idx': r['idx_print'],
                                 'tdate': r['tdate'], 'vdate': r['vdate'],
                                 'debit': r['debit'], 'credit': r['credit'],
                                 'balance': r['balance'], 'desc': r['desc_fixed']})
cross = {ref: rows for ref, rows in ref_map.items() if len({x['stmt'] for x in rows}) >= 2}
bindings = []
for ref, rows in sorted(cross.items()):
    if len(rows) != 2:
        bindings.append({'ref': ref, 'n': len(rows), 'note': 'multiple rows', 'rows': rows}); continue
    a, b = rows
    # direction: money leaves one (debit) and arrives in the other (credit)
    out_row = a if a['debit'] is not None else b
    in_row = b if out_row is a else a
    ok_dir = out_row['debit'] is not None and in_row['credit'] is not None
    fx = None
    cur_out = DATA[out_row['stmt']]['header']['currency']
    cur_in = DATA[in_row['stmt']]['header']['currency']
    if cur_out != cur_in and ok_dir:
        fx = round(out_row['debit'] / in_row['credit'], 4)
    bindings.append({'ref': ref, 'out_stmt': out_row['stmt'], 'out_amt': out_row['debit'],
                     'in_stmt': in_row['stmt'], 'in_amt': in_row['credit'],
                     'out_date': out_row['tdate'], 'in_date': in_row['tdate'],
                     'direction_ok': ok_dir, 'implied_fx': fx,
                     'desc_out': out_row['desc'][:70], 'desc_in': in_row['desc'][:70]})

# ---------------- H2: saving reversal pairs ----------------
sav = DATA['saving']['rows']
neg = [r for r in sav if (r['debit'] is not None and r['debit'] < 0) or (r['credit'] is not None and r['credit'] < 0)]
rev_pairs = []
for n in neg:
    ref = n['ref'].strip()
    sibs = [r for r in sav if r['ref'].strip() == ref and r is not n]
    rev_pairs.append({'neg_row': {'idx': n['idx_print'], 'page': n['page'], 'tdate': n['tdate'],
                                  'ref': ref, 'printed': n['debit'] if n['debit'] is not None else n['credit'],
                                  'desc': n['desc_fixed'][:80]},
                      'siblings': [{'idx': s['idx_print'], 'tdate': s['tdate'],
                                    'debit': s['debit'], 'credit': s['credit'],
                                    'desc': s['desc_fixed'][:60]} for s in sibs]})

# ---------------- H3: equal-pair / flow-through hunt ----------------
flow = []
for k in KEYS:
    rows = sorted(DATA[k]['rows'], key=lambda r: r['idx_print'])  # print order = newest first
    chron = list(reversed(rows))
    from datetime import date
    def dk(s):
        m = re.match(r'^(\d{1,2})-([A-Za-z]+)-(\d{4})$', s)
        MONTHS = {m_: i+1 for i, m_ in enumerate(['January','February','March','April','May','June','July','August','September','October','November','December'])}
        return date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1))) if m else None
    for i, r in enumerate(chron):
        amt_in = r['credit']
        if amt_in and amt_in >= 5000:
            for j in range(i+1, min(i+15, len(chron))):
                d2 = dk(chron[j]['tdate']); d1 = dk(r['tdate'])
                if not d1 or not d2: break
                if (d2 - d1).days > 10: break
                if chron[j]['debit'] == amt_in:
                    flow.append({'stmt': k, 'in_idx': r['idx_print'], 'in_date': r['tdate'],
                                 'in_amt': amt_in, 'in_desc': r['desc_fixed'][:60], 'in_ref': r['ref'],
                                 'out_idx': chron[j]['idx_print'], 'out_date': chron[j]['tdate'],
                                 'out_desc': chron[j]['desc_fixed'][:60], 'out_ref': chron[j]['ref'],
                                 'days': (d2 - d1).days})
                    break

# ---------------- H4: sweep cover (current sweeps vs saving) ----------------
sweeps_cur = [r for r in DATA['current']['rows'] if 'sweeping' in r['desc'].lower()]
sweep_cover = []
for s in sweeps_cur:
    cand = [r for r in sav if r['tdate'] == s['tdate'] and r['debit'] == s['credit']]
    sweep_cover.append({'current_sweep': {'idx': s['idx_print'], 'tdate': s['tdate'], 'credit': s['credit'], 'ref': s['ref']},
                        'saving_debit_match': [{'idx': c['idx_print'], 'tdate': c['tdate'], 'debit': c['debit'],
                                                'ref': c['ref'], 'desc': c['desc_fixed'][:60]} for c in cand]})

# ---------------- H5: shared instruments ----------------
instruments = {}
cc = set()
for k in KEYS:
    for r in DATA[k]['rows']:
        for mnum in re.findall(r'49149545\d+|4914\d{12}', r['desc']):
            cc.add((mnum[:6] + '******' + mnum[-4:], k))
instruments['credit_card'] = sorted(cc)
certs = set()
for k in KEYS:
    for r in DATA[k]['rows']:
        for mnum in re.findall(r'\b(076798|211621)\d{13}\b', r['desc']):
            certs.add((mnum, k))
instruments['certificate_accounts'] = sorted(certs)

g9 = {'bindings': bindings, 'n_cross_refs': len(cross), 'reversal_pairs': rev_pairs,
      'flow_through': flow, 'sweep_cover': sweep_cover, 'instruments': instruments}
json.dump(g9, open(f'{OUT}/g9.json', 'w'), ensure_ascii=False, indent=1)
json.dump({k: DATA[k] for k in KEYS}, open(f'{OUT}/all_rows_enriched.json', 'w'), ensure_ascii=False, indent=1)

print("H1 cross-statement refs:", len(cross))
for b in bindings:
    if 'out_stmt' in b:
        print("  ", b['ref'], b['out_stmt'], b['out_amt'], '->', b['in_stmt'], b['in_amt'],
              'dir_ok:', b['direction_ok'], 'fx:', b['implied_fx'], '|', b['out_date'], '->', b['in_date'])
    else:
        print("  ", b['ref'], 'n=', b['n'])
print("H2 reversal pairs:", len(rev_pairs))
for p in rev_pairs:
    print("  neg:", p['neg_row']['printed'], p['neg_row']['ref'], '| sibs:', [(s['debit'], s['credit']) for s in p['siblings']])
print("H3 flow-through:", len(flow))
for f in flow[:10]:
    print("  ", f['stmt'], f['in_amt'], f['in_date'], '->', f['out_date'], f['out_desc'][:40], f'in', f['days'], 'd')
print("H4 sweeps:", len(sweep_cover))
for s in sweep_cover:
    print("  ", s['current_sweep'], '->', s['saving_debit_match'])
print("H5 instruments:", instruments)
print("G9 DONE")
