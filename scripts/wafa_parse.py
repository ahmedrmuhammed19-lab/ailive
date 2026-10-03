#!/usr/bin/env python3
"""WAFA-1 analyst pass: full 48-page transaction parse from tesseract TSV
geometry. Column zones (300dpi, width ~2281): debit x<1975, credit x>=1975.
Validates parsed sums against the printed 'Total movements' + opening/closing
balance chain. Output: scripts/wafa_work/rows.json + validation verdict."""
import csv
import glob
import json
import re

WORK = "/home/z/my-project/scripts/wafa_work"
DEBIT_X = 1975  # boundary between debit and credit amount columns

DATE_RE = re.compile(r"^\d[\dSs]/\d{2}/20\d{2}$")
AMT_RE = re.compile(r"^[\dOoSsl][\dOoSsl,]*\.[\dOoSsl]{2}$")
AMT_COMMA_RE = re.compile(r"^[\dOoSsl][\dOoSsl,]*,[\dOoSsl]{2}$")  # dot read as comma: '4,00', '9,000,00', '0,50'


def try_amount(tok):
    if AMT_RE.match(tok):
        return fix_num(tok)
    if AMT_COMMA_RE.match(tok):
        i = tok.rfind(",")
        return fix_num(tok[:i] + "." + tok[i + 1:])
    if tok.startswith("$") and AMT_RE.match(tok[1:]):  # '2' misread as '$'
        return fix_num("2" + tok[1:])
    return None
BAL_RE = re.compile(r"Bal\.?\s*on\s*(\d[\dSs]/\d{2}/20\d{2})\s*([\dOo,]+\.\d{2})")


def fix_num(s):
    s = s.replace("O", "0").replace("o", "0").replace("S", "5").replace("s", "5").replace("l", "1")
    s = re.sub(r"[^0-9.,]", "", s).replace(",", "")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def fix_date(s):
    return s.replace("S", "5").replace("s", "5")


def lines_of(page):
    rows = {}
    for r in csv.DictReader(open(page), delimiter="\t", quoting=csv.QUOTE_NONE):
        t = (r["text"] or "").strip()
        if t and float(r["conf"]) >= 0:
            k = (r["block_num"], r["par_num"], r["line_num"])
            rows.setdefault(k, []).append((int(r["left"]), int(r["width"]), t))
    out = []
    for k in sorted(rows, key=lambda k: (int(k[0]), int(k[1]), int(k[2]))):
        ws = sorted(rows[k])
        xc = [(w[0] + w[1] // 2, w[2]) for w in ws]
        out.append((xc[0][1], xc))  # (line text, words with x-centers)
    return out


def rel_debit_boundary(dpi):
    """Debit/credit boundary in A4 points (474pt measured at 300dpi = 1975px)."""
    return 474.0 * dpi / 72.0


def main():
    rows = []
    raw300 = {}
    raw450 = {}
    bal_open = bal_close = None
    tot_debit = tot_credit = None
    cur = None
    page_of = {}
    for p in sorted(glob.glob(f"{WORK}/pg-*.tsv")):
        pno = int(re.search(r"pg-(\d+)", p).group(1))
        for first_word, words in lines_of(p):
            txt = " ".join(w[1] for w in words)
            m = BAL_RE.search(txt)
            if m:
                amt = fix_num(m.group(2))
                if bal_open is None:
                    bal_open = amt
                else:
                    bal_close = amt
                cur = None
                continue
            if "Total movements" in txt:
                amts = [fix_num(w[1]) for w in words if AMT_RE.match(w[1])]
                if len(amts) >= 2:
                    # printed order: debit total then credit total (left col first)
                    tot_debit, tot_credit = amts[0], amts[1]
                cur = None
                continue
            w0 = words[0][1]
            if DATE_RE.match(w0):
                d1 = fix_date(w0)
                d2 = fix_date(words[1][1]) if len(words) > 1 and DATE_RE.match(words[1][1]) else ""
                debits = [a for w in words if w[0] < DEBIT_X and (a := try_amount(w[1])) is not None]
                credits = [a for w in words if w[0] >= DEBIT_X and (a := try_amount(w[1])) is not None]
                debits = [a for a in debits if a]
                credits = [a for a in credits if a]
                # description zone: after record/evo columns (~x>1100), before amount zone
                desc = " ".join(w[1] for w in words if 1050 < w[0] < 1700 and not AMT_RE.match(w[1]))
                desc = re.sub(r"\|+|\}+|\[+|\]+", " ", desc).strip(" |")
                cur = {
                    "page": pno, "date": d1, "valueDate": d2,
                    "debit": debits[0] if debits else None,
                    "credit": credits[0] if credits else None,
                    "desc": desc, "memo": [],
                    "extraDebits": debits[1:], "extraCredits": credits[1:],
                }
                kcount = sum(1 for x in rows if x["page"] == pno and x["date"] == d1)
                cur["k"] = kcount
                raw300[(pno, d1, kcount)] = words
                rows.append(cur)
                page_of[len(rows) - 1] = pno
            elif cur is not None and txt not in ("",):
                # continuation memo (Ref..., counterparty, Fees line)
                memo = re.sub(r"\|+|\}+", " ", txt).strip()
                if len(memo) > 1 and not memo.startswith("MOVEMENT") and "Branch" not in memo \
                        and "Account" not in memo and "CUSTOMER" not in memo.upper() and "CTB-" not in memo:
                    cur["memo"].append(memo)

    # --- chain-gap repair: fill amount-less rows from 450dpi re-OCR ---
    hi_index = {}
    for p in sorted(glob.glob(f"{WORK}/hi2-*.tsv")):
        pno = int(re.search(r"hi2-(\d+)", p).group(1))
        seen = {}
        for first_word, words in lines_of(p):
            w0 = words[0][1]
            if DATE_RE.match(w0):
                d1 = fix_date(w0)
                k = seen.get(d1, 0)
                seen[d1] = k + 1
                raw450[(pno, d1, k)] = words
                bx = rel_debit_boundary(450)
                debits = [a for w in words if w[0] < bx and (a := try_amount(w[1])) is not None]
                credits = [a for w in words if w[0] >= bx and (a := try_amount(w[1])) is not None]
                debits = [a for a in debits if a is not None]
                credits = [a for a in credits if a is not None]
                if debits or credits:
                    hi_index[(pno, d1, k)] = (debits[0] if debits else None,
                                              credits[0] if credits else None,
                                              " ".join(w[1] for w in words if 1575 < w[0] < 2550 and not AMT_RE.match(w[1])).strip())
    filled = 0
    inserted = 0
    seen = {}
    for r in rows:
        k = seen.get((r["page"], r["date"]), 0)
        seen[(r["page"], r["date"])] = k + 1
        r["k"] = k
        if r["debit"] is None and r["credit"] is None:
            hit = hi_index.get((r["page"], r["date"], k))
            if hit:
                r["debit"], r["credit"], r["desc"] = hit[0], hit[1], (r["desc"] or hit[2])
                r["filledFromHi"] = True
                filled += 1
    # insert rows 300dpi missed entirely (key exists only in hi-res)
    for (pno, d1, k), (d, c, dsc) in sorted(hi_index.items(), key=lambda x: (x[0][0], x[0][2])):
        if all((x["page"], x["date"], x.get("k")) != (pno, d1, k) for x in rows):
            rows.append({"page": pno, "date": d1, "valueDate": "", "debit": d, "credit": c,
                         "desc": dsc[:120], "memo": [], "extraDebits": [], "extraCredits": [],
                         "k": k, "insertedFromHi": True})
            inserted += 1
    print(f"gap-fill from 450dpi: {filled} rows repaired, {inserted} rows inserted")

    sd = round(sum(r["debit"] or 0 for r in rows), 2)
    sc = round(sum(r["credit"] or 0 for r in rows), 2)
    print(f"parsed rows      : {len(rows)}")
    print(f"rows w/o amount  : {sum(1 for r in rows if r['debit'] is None and r['credit'] is None)}")
    print(f"extra-col rows   : {sum(1 for r in rows if r['extraDebits'] or r['extraCredits'])}")
    print(f"sum debits       : {sd:,.2f}   (printed {tot_debit:,.2f})  diff {sd - (tot_debit or 0):+,.2f}")
    print(f"sum credits      : {sc:,.2f}   (printed {tot_credit:,.2f})  diff {sc - (tot_credit or 0):+,.2f}")
    net = round(sc - sd, 2)
    expect_close = round((bal_open or 0) + net, 2)
    print(f"opening          : {bal_open:,.2f}")
    print(f"net movement     : {net:,.2f}")
    print(f"computed closing : {expect_close:,.2f}   (printed {bal_close:,.2f})  diff {expect_close - (bal_close or 0):+,.2f}")
    # diagnostic: amount-less rows + suspicious unparseable tokens in amount zones
    empties = [r for r in rows if r["debit"] is None and r["credit"] is None]
    print("--- amount-less rows (page/date/k/desc + raw right-zone tokens) ---")
    for r in empties[:20]:
        ws300 = [w for w in raw300.get((r["page"], r["date"], r.get("k", 0)), []) if w[0] > 1600]
        ws450 = [w for w in raw450.get((r["page"], r["date"], r.get("k", 0)), []) if w[0] > 2400]
        print(f"  p{r['page']:02d} {r['date']} k={r.get('k',0)} | {r['desc'][:40]}")
        print(f"      300: {[(w[1], w[0]) for w in ws300][:6]}")
        print(f"      450: {[(w[1], w[0]) for w in ws450][:6]}")

    ok = (
        tot_debit is not None and abs(sd - tot_debit) < 0.01
        and tot_credit is not None and abs(sc - tot_credit) < 0.01
        and abs(expect_close - (bal_close or 0)) < 0.01
    )
    print("CHAIN VERDICT    :", "100% — analyst verified" if ok else "MISMATCH — needs targeted re-OCR")
    json.dump({"rows": rows, "opening": bal_open, "closing": bal_close,
               "totalDebits": tot_debit, "totalCredits": tot_credit,
               "sumDebits": sd, "sumCredits": sc}, open(f"{WORK}/rows.json", "w"), indent=1)


if __name__ == "__main__":
    main()
