#!/usr/bin/env python3
"""DL-8 analytics: fee law, category buckets, monthly flow, stats."""
from ledger import R, OPENING, CLOSING
from collections import defaultdict
import calendar

tot_cr_all = round(sum(r['cr'] for r in R), 2)          # includes negatives
tot_dr_all = round(sum(r['dr'] for r in R), 2)          # includes negatives
print(f'Σcredits(all, incl neg) = {tot_cr_all:,.2f}')
print(f'Σdebits(all, incl neg)  = {tot_dr_all:,.2f}')
print(f'telescope = {OPENING:,.2f} + {tot_cr_all:,.2f} - {tot_dr_all:,.2f} = {round(OPENING+tot_cr_all-tot_dr_all,2):,.2f} vs {CLOSING:,.2f}')

# ---- fee law: IPN BANK FEE = max(ceil(0.001*T,2), 0.50) vs paired transfer ----
conf = 0; mism = []; fee_rows = 0
for i, r in enumerate(R):
    if r['desc'] == 'IPN BANK FEE' and r['dr'] > 0:
        fee_rows += 1
        # find paired transfer: next row with desc 'IPN Network Fund Transfer' and same ref
        T = None
        for j in (i + 1, i - 1):
            if 0 <= j < len(R) and R[j]['desc'] == 'IPN Network Fund Transfer' and R[j]['ref'] == r['ref'] and R[j]['dr'] > 0:
                T = R[j]['dr']; break
        if T is None: continue
        import math
        expect = max(math.ceil(T * 0.001 * 100) / 100, 0.50)
        if abs(expect - r['dr']) < 0.005:
            conf += 1
        else:
            mism.append((i + 1, r['d'], r['ref'], r['dr'], T, expect))
print(f'IPN fee rows: {fee_rows}, paired-law confirmations: {conf}, mismatches: {len(mism)}')
for m in mism[:12]: print('   mismatch row %d %s ref %s fee=%.2f T=%.2f expect=%.2f' % m)

# ---- category buckets ----
def bucket(r):
    d = r['desc']
    if d == 'IPN BANK FEE': return 'IPN Bank Fees'
    if d == 'IPN Network Fund Transfer':
        return 'IPN Transfers — Outgoing' if r['dr'] > 0 else 'IPN Transfers — Incoming'
    if d == 'Purchase - IPN':
        return 'IPN Card Purchases' if r['dr'] > 0 else 'IPN Card Purchase Reversal'
    if d == 'POS PURCHASE ON-US': return 'POS Purchases (On-Us)'
    if d == 'ATM Cash Withdrawal': return 'ATM Cash Withdrawals'
    if d == 'ATM Cash Deposit': return 'ATM Cash Deposits'
    if d == 'Incoming Domestic Transfer': return 'Incoming Domestic Transfers'
    if d == 'BP Online CR': return 'BP Online Credits'
    if d == 'Fund transfer credit': return 'Branch Fund Transfer Credit'
    if d == 'Credit interest': return 'Credit Interest'
    if d == 'Settlement interest previous date': return 'Interest Adjustment'
    if d == 'Instapay applied fees': return 'Instapay Fees'
    if d in ('Miscellaneous Debit',): return 'Miscellaneous Debits'
    if d in ('Account Management fees', 'Account statement charges', 'Account Service Charges', 'Renewal Fees', 'Inquiry Fees'):
        return 'Account Service Charges'
    if d == 'File Uploading': return 'File Uploading Credit'
    return 'Other: ' + d

agg = defaultdict(lambda: [0, 0.0, 0.0])   # n, dr_sum, cr_sum
for r in R:
    b = bucket(r); a = agg[b]
    a[0] += 1
    a[1] += r['dr'] if r['dr'] > 0 else 0
    a[2] += r['cr'] if r['cr'] > 0 else 0
    if r['dr'] < 0: a[1] += r['dr']
    if r['cr'] < 0: a[2] += r['cr']
print('\ncategory buckets (n, debits, credits):')
for b, (n, ds, cs) in sorted(agg.items(), key=lambda kv: -(kv[1][1] + kv[1][2])):
    print(f'  {b:34s} n={n:3d}  dr={ds:>12,.2f}  cr={cs:>12,.2f}')

# ---- monthly flow ----
mon = defaultdict(lambda: [0, 0.0, 0.0])
for r in R:
    m = r['d'][3:5] + '/' + r['d'][6:]   # MM/YYYY as printed (dd/mm/yyyy)
    a = mon[m]; a[0] += 1; a[1] += r['dr'] if r['dr'] > 0 else 0; a[2] += r['cr'] if r['cr'] > 0 else 0
order = ['02/2026','03/2026','04/2026','05/2026','06/2026','07/2026','08/2026','09/2026']
print('\nmonthly flow (as-printed dd/mm/yyyy):')
for m in order:
    n, ds, cs = mon[m]
    print(f'  {m}: n={n:3d}  debits={ds:>12,.2f}  credits={cs:>12,.2f}')

# ---- stats ----
atm_out = sum(r['dr'] for r in R if r['desc'] == 'ATM Cash Withdrawal')
pos = sum(r['dr'] for r in R if r['desc'] == 'POS PURCHASE ON-US')
ipn_out = sum(r['dr'] for r in R if r['desc'] == 'IPN Network Fund Transfer')
print(f'\nATM withdrawals total = {atm_out:,.2f} ({sum(1 for r in R if r["desc"]=="ATM Cash Withdrawal")} txns)')
print(f'POS purchases total   = {pos:,.2f} ({sum(1 for r in R if r["desc"]=="POS PURCHASE ON-US")} txns)')
print(f'IPN outgoing total    = {ipn_out:,.2f} ({sum(1 for r in R if r["desc"]=="IPN Network Fund Transfer" and r["dr"]>0)} txns)')
peak = max(R, key=lambda r: r['bal'])
low = min(R, key=lambda r: r['bal'])
print(f'peak balance {peak["bal"]:,.2f} on {peak["d"]}; lowest {low["bal"]:,.2f} on {low["d"]}')
neg_rows = [(i+1, r) for i, r in enumerate(R) if r['dr'] < 0 or r['cr'] < 0]
print('negative-printed rows:')
for i, r in neg_rows:
    col = 'debit' if r['dr'] < 0 else 'credit'
    print(f'  row {i} pg{r["pg"]} {r["d"]} {r["desc"]} printed {col} {r["dr"] if r["dr"]<0 else r["cr"]:,.2f} -> bal {r["bal"]:,.2f}')
# largest txns
print('top 5 debits:')
for r in sorted([r for r in R if r['dr'] > 0], key=lambda r: -r['dr'])[:5]:
    print(f'  {r["d"]} {r["desc"]} {r["dr"]:,.2f} -> {r["bal"]:,.2f}')
print('top 5 credits:')
for r in sorted([r for r in R if r['cr'] > 0], key=lambda r: -r['cr'])[:5]:
    print(f'  {r["d"]} {r["desc"]} {r["cr"]:,.2f} -> {r["bal"]:,.2f}')
