#!/usr/bin/env python3
"""Bola Ayad — FINAL data synthesis for report generation.

Pass B (pdftotext, bidi-correct) supplies the authoritative display text for
descriptions (Arabic logical order). Each pass-A row (positional, glyph-exact
amounts/balances) is matched to its pass-B row by signature (tdate, amt,
balance) with monotonic within-group matching. Output per statement:
  report_data_{key}.json = {header, rows (A rows + desc_t overlay), stats,
                            gates, g9_summary, beneficiaries}
All NUMBERS in reports are recomputed in TS from `rows` (G8); desc_t is
display-only.
"""
import subprocess, re, json
from collections import defaultdict, Counter

FILES = {
    'saving':  '/home/z/my-project/upload/saving.pdf',
    'current': '/home/z/my-project/upload/current check.pdf',
    'usd':     '/home/z/my-project/upload/USD.pdf',
}
OUT = '/home/z/my-project/scripts/bola_work'
AMT = re.compile(r'^-?\d{1,3}(?:,\d{3})*\.\d{2}$')
DATE_FULL = re.compile(r'^\d{1,2}-[A-Za-z]+-\d{4}$')
DATE_PART = re.compile(r'^\d{1,2}-$')
MONTH_CONT = re.compile(r'^[A-Za-z]+-\d{4}$')
MONTHS = {m: i + 1 for i, m in enumerate(['January','February','March','April','May','June','July','August','September','October','November','December'])}

def pamt(s): return round(float(s.replace(',', '')), 2)

def passB(path):
    txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    lines = txt.split('\n')
    rows = []
    for i, ln in enumerate(lines):
        s = ln.rstrip()
        st = s.strip()
        first = st.split()[0] if st else ''
        if DATE_FULL.match(first) or DATE_PART.match(first):
            toks = st.split()
            amts = []
            j = len(toks) - 1
            while j >= 0 and AMT.match(toks[j]):
                amts.insert(0, toks[j]); j -= 1
            if not amts:
                continue
            tdate = toks[0]
            if DATE_PART.match(tdate):
                for k in (i + 1, i + 2):
                    if k < len(lines):
                        nt = lines[k].strip().split()
                        if nt and MONTH_CONT.match(nt[0]):
                            tdate = tdate + nt[0]; break
            # description text = line content minus leading date columns minus trailing amounts
            m = re.match(r'^\s*(\S+\s+\S+?)\s{2,}(\S+)\s{2,}(.+?)\s{2,}(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s*$', ln)
            desc = ''
            if m:
                desc = m.group(3).strip()
            else:
                # fallback: strip tokens
                keep = []
                for t in toks[:len(toks) - len(amts)]:
                    keep.append(t)
                desc = ' '.join(keep[1:])
            # attach continuation lines (desc wraps) until next row-start
            k = i + 1
            while k < len(lines):
                nx = lines[k].strip()
                if not nx: k += 1; continue
                nf = nx.split()[0]
                if DATE_FULL.match(nf) or DATE_PART.match(nf): break
                # wrapped date-cell month tokens (e.g. 'September-2026 September-2026')
                if all(MONTH_CONT.match(t) for t in nx.split()): k += 1; continue
                # next page's repeated table header — stop
                if nx.startswith('Transaction Date') or 'Transaction Reference' in nx[:60]: break
                if AMT.match(nx.split()[-1]) and len(nx.split()) <= 3: k += 1; continue
                if re.match(r'^\d{1,4}$', nf) and len(nx.split()) == 1: k += 1; continue
                desc += ' ' + nx
                k += 1
            rows.append({'tdate': tdate, 'amt': pamt(amts[0]) if len(amts) >= 2 else None,
                         'balance': pamt(amts[-1]), 'desc_t': re.sub(r'\s+', ' ', desc).strip()})
    return rows

def date_key(s):
    m = re.match(r'^(\d{1,2})-([A-Za-z]+)-(\d{4})$', s)
    return (int(m.group(3)), MONTHS.get(m.group(2), 0), int(m.group(1))) if m else None

def overlay(key):
    A = json.load(open(f'{OUT}/{key}_rowsA.json'))
    hdr, rowsA = A['header'], A['rows']
    rowsB = passB(FILES[key])
    # group both by signature, match monotonically within group
    gA, gB = defaultdict(list), defaultdict(list)
    for r in rowsA:
        amt = r['debit'] if r['debit'] is not None else r['credit']
        gA[(r['tdate'], round(amt, 2), round(r['balance'], 2))].append(r)
    for r in rowsB:
        gB[(r['tdate'], round(r['amt'], 2) if r['amt'] is not None else None, round(r['balance'], 2))].append(r)
    unmatched = 0
    for sig, lst in gA.items():
        src = gB.get(sig, [])
        for i, r in enumerate(lst):
            r['desc_t'] = src[i]['desc_t'] if i < len(src) else ''
            if not r['desc_t']: unmatched += 1
    return hdr, rowsA, unmatched

MARKS = re.compile(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]')

def clean_name(s):
    s = MARKS.sub('', s)
    s = re.sub(r'\s*\d+~\S*$', '', s)          # trailing '~51' style evidence tails
    s = re.sub(r'^\d+~', '', s)
    s = re.sub(r'\b[A-Za-z]+-\d{4}\b', ' ', s)  # wrapped-date leftovers
    return re.sub(r'\s+', ' ', s).strip(' ~')

def beneficiaries(rows):
    """Aggregate outgoing IPN transfers by beneficiary (from desc_t).
    Principal rows: desc contains 'outgoing transfer ipn'. Fee rows: desc
    starts with 'outgoing transfer fees' — counted in fees, never in sum."""
    ben = defaultdict(lambda: {'n': 0, 'sum': 0.0, 'fees': 0.0, 'dates': [], 'ev': set()})
    for r in rows:
        d = MARKS.sub('', r.get('desc_t') or '')
        dl = d.lower()
        if 'ipn' not in dl:
            continue
        is_fee = dl.startswith('outgoing transfer fees')
        m = re.search(r'(?:network\s+to|to)\s+(.+?)\s*$', d, re.I)
        if not m:
            continue
        name = clean_name(m.group(1))
        # evidence token if present (attached by ~ to the name)
        ev = None
        m2 = re.search(r'~\s*([A-Za-z0-9]{6,})\s*$', name)
        if m2:
            ev = m2.group(1); name = clean_name(name[:m2.start()])
        if not name or len(name) < 3:
            continue
        key = name.lower()
        if is_fee:
            if r['debit'] and r['debit'] > 0:
                # match fee to the nearest principal row with same evidence token
                tgt = None
                if ev:
                    for k2, v2 in ben.items():
                        if ev in v2['ev']: tgt = k2; break
                if tgt is None: tgt = key
                ben[tgt]['fees'] = round(ben[tgt]['fees'] + r['debit'], 2)
                if ev: ben[tgt]['ev'].add(ev)
            continue
        if r['debit'] and r['debit'] > 0:
            ben[key]['n'] += 1
            ben[key]['sum'] = round(ben[key]['sum'] + r['debit'], 2)
            ben[key]['dates'].append(r['tdate'])
            if ev: ben[key]['ev'].add(ev)
    return {k: {'n': v['n'], 'sum': v['sum'], 'fees': v['fees'],
                'dates': v['dates'], 'ev': sorted(v['ev'])[:3]}
            for k, v in sorted(ben.items(), key=lambda kv: -kv[1]['sum'])}

def classify(r):
    d = ((r.get('desc_t') or '') + ' ' + (r.get('desc_fixed') or '')).lower()
    if (r['debit'] is not None and r['debit'] < 0) or (r['credit'] is not None and r['credit'] < 0):
        return 'Reversals (bank-printed negatives)'
    if 'account balance coverage' in d or 'sweeping' in d: return 'Own-account sweep (auto)'
    if re.search(r'\bipn\b', d) and 'fees' in d: return 'IPN transfer fees'
    if re.search(r'outgoing transfer ipn', d): return 'IPN remittances (external beneficiaries)'
    if 'account to account transfer' in d: return 'Own-account A2A transfer'
    if 'cash withdrawal' in d: return 'Cash withdrawal (ATM/branch)'
    if 'cash deposit' in d: return 'Cash deposit'
    if 'credit card payment' in d: return 'Credit card payment'
    if 'inward cheque' in d: return 'Cheque clearing (outward debit)'
    if 'interest' in d: return 'Interest earned'
    if 'purchase' in d or 'fawry' in d or 'mastercard' in d: return 'Card purchases'
    if 'i-score' in d or 'fees' in d or 'charges' in d or 'commission' in d or 'admin' in d: return 'Fees & charges'
    if 'certificate' in d or 'term deposit' in d: return 'Certificate/term deposit'
    if 'swift' in d or 'incoming transfer' in d: return 'Incoming SWIFT transfer'
    if 'transfer' in d: return 'Other transfers'
    return 'Other'

allrows = {}
for key in FILES:
    hdr, rows, unmatched = overlay(key)
    A = json.load(open(f'{OUT}/{key}_rowsA.json'))
    for r in rows:
        # recover desc_fixed for Latin-only fallback matching in classify
        r.setdefault('desc_fixed', r.get('desc', ''))
    allrows[key] = rows
    from collections import Counter
    monthly = defaultdict(lambda: {'c': 0.0, 'd': 0.0, 'n': 0, 'close': None})
    run = hdr['opening']
    for r in reversed(rows):
        amt = r['debit'] if r['debit'] is not None else r['credit']
        sign = -1 if r['debit'] is not None else 1
        run = round(run + sign * amt, 2)
        dk = date_key(r['tdate'])
        mk = f"{dk[1]:02d}/{dk[0]}" if dk else r['tdate']
        monthly[mk]['c'] += (r['credit'] or 0); monthly[mk]['d'] += (r['debit'] or 0)
        monthly[mk]['n'] += 1; monthly[mk]['close'] = run
    cats = Counter(); cat_sum = defaultdict(float); cat_n = Counter()
    for r in rows:
        c = classify(r)
        cats[c] += 1; cat_n[c] += 1
        cat_sum[c] += abs(r['debit'] or r['credit'] or 0)
    stats = {'n_rows': len(rows),
             'sum_debits': round(sum(r['debit'] or 0 for r in rows), 2),
             'sum_credits': round(sum(r['credit'] or 0 for r in rows), 2),
             'n_debits': sum(1 for r in rows if (r['debit'] or 0) > 0),
             'n_credits': sum(1 for r in rows if (r['credit'] or 0) > 0),
             'monthly': dict(sorted(monthly.items())),
             'categories': {c: {'n': cat_n[c], 'sum': round(cat_sum[c], 2)} for c in cats},
             'min_balance': min(r['balance'] for r in rows),
             'max_balance': max(r['balance'] for r in rows)}
    data = {'header': hdr, 'rows': rows, 'stats': stats, 'beneficiaries': beneficiaries(rows),
            'desc_unmatched': unmatched}
    json.dump(data, open(f'{OUT}/report_data_{key}.json', 'w'), ensure_ascii=False, indent=1)
    print(key, 'rows', len(rows), 'unmatched_desc', unmatched,
          '| D', stats['sum_debits'], 'C', stats['sum_credits'])
    print('  beneficiaries:', json.dumps(data['beneficiaries'], ensure_ascii=False)[:500])
print('FINAL DATA DONE')
