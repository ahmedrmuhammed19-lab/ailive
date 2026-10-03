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


def lines_of_t(page):
    """Like lines_of but also returns the line's top y for cropping."""
    rows = {}
    for r in csv.DictReader(open(page), delimiter="\t", quoting=csv.QUOTE_NONE):
        t = (r["text"] or "").strip()
        if t and float(r["conf"]) >= 0:
            k = (r["block_num"], r["par_num"], r["line_num"])
            rows.setdefault(k, []).append((int(r["left"]), int(r["width"]), int(r["top"]), int(r["height"]), t))
    out = []
    for k in sorted(rows, key=lambda k: (int(k[0]), int(k[1]), int(k[2]))):
        ws = sorted(rows[k])
        xc = [(w[0] + w[1] // 2, w[4]) for w in ws]
        top = min(w[2] for w in ws)
        h = max(w[2] + w[3] for w in ws) - top
        out.append((xc[0][1], xc, top, h))
    return out


PT = 72.0  # px = pt * dpi / PT
DEBIT_X_PT = 474.0
DESC_LO_PT, DESC_HI_PT = 252.0, 408.0
RIGHT_PT = 384.0


def parse_pass(pattern, dpi, prefix):
    """Primary structural parse of one TSV set."""
    px = lambda pt: pt * dpi / PT
    bx = px(DEBIT_X_PT)
    rows, bals, totals = [], [], None
    cur = None
    for p in sorted(glob.glob(pattern)):
        pno = int(re.search(prefix + r"-(\d+)", p).group(1))
        for fw, words, top, h in lines_of_t(p):
            txt = " ".join(w[1] for w in words)
            m = BAL_RE.search(txt)
            if m:
                bals.append((pno, fix_date(m.group(1)), fix_num(m.group(2)), words))
                cur = None
                continue
            if "Total movements" in txt:
                amts = [a for w in words if (a := try_amount(w[1])) is not None]
                if len(amts) >= 2:
                    totals = (amts[0], amts[1])
                cur = None
                continue
            w0 = words[0][1]
            if DATE_RE.match(w0):
                d1 = fix_date(w0)
                d2 = fix_date(words[1][1]) if len(words) > 1 and DATE_RE.match(words[1][1]) else ""
                debits = [a for w in words if w[0] < bx and (a := try_amount(w[1])) is not None]
                credits = [a for w in words if w[0] >= bx and (a := try_amount(w[1])) is not None]
                desc = " ".join(w[1] for w in words if px(DESC_LO_PT) < w[0] < px(DESC_HI_PT) and not AMT_RE.match(w[1]))
                desc = re.sub(r"\|+|\}+|\[+|\]+", " ", desc).strip(" |")
                cur = {"page": pno, "date": d1, "valueDate": d2,
                       "debit": debits[0] if debits else None,
                       "credit": credits[0] if credits else None,
                       "desc": desc, "memo": [], "top": top, "h": h,
                       "extraDebits": debits[1:], "extraCredits": credits[1:]}
                rows.append(cur)
            elif cur is not None and txt.strip():
                memo = re.sub(r"\|+|\}+", " ", txt).strip()
                if len(memo) > 1 and not memo.startswith("MOVEMENT") and "Branch" not in memo \
                        and "Account" not in memo and "CUSTOMER" not in memo.upper() and "CTB-" not in memo:
                    cur["memo"].append(memo)
    return rows, bals, totals


def crop_refill(rows, dpi, prefix):
    """Strip-crop re-OCR for rows still missing amounts. Returns filled count."""
    from PIL import Image
    import subprocess, tempfile, os
    filled = 0
    bx = DEBIT_X_PT * (dpi / PT)
    for r in [x for x in rows if x["debit"] is None and x["credit"] is None]:
        png = f"{WORK}/{prefix}-{r['page']:02d}.png"
        if not os.path.exists(png):
            continue
        img = Image.open(png)
        W, H = img.size
        y0 = max(0, r["top"] - int(r["h"] * 0.6))
        y1 = min(H, r["top"] + r["h"] + int(r["h"] * 0.6))
        strip = img.crop((0, y0, W, y1)).resize((W * 2, (y1 - y0) * 2), Image.LANCZOS)
        with tempfile.NamedTemporaryFile(suffix=".png", dir=WORK, delete=False) as f:
            strip.save(f.name)
            tmp = f.name
        try:
            subprocess.run(["tesseract", tmp, tmp[:-4], "--psm", "7", "tsv"],
                           capture_output=True, timeout=60)
            words = []
            for rr in csv.DictReader(open(tmp[:-4] + ".tsv"), delimiter="\t", quoting=csv.QUOTE_NONE):
                t = (rr["text"] or "").strip()
                if t and float(rr["conf"]) >= 0:
                    words.append((int(rr["left"]) + int(rr["width"]) // 2, t))
        except Exception:
            words = []
        finally:
            for ext in (".png", ".tsv", ".txt"):
                try:
                    os.remove(tmp[:-4] + ext)
                except OSError:
                    pass
        debits = [a for x, t in words if x < bx * 2 and (a := try_amount(t)) is not None]
        credits = [a for x, t in words if x >= bx * 2 and (a := try_amount(t)) is not None]
        if debits or credits:
            r["debit"] = r["debit"] if r["debit"] is not None else (debits[0] if debits else None)
            r["credit"] = r["credit"] if r["credit"] is not None else (credits[0] if credits else None)
            r["stripRefilled"] = True
            filled += 1
    return filled


def main():
    rows, bals, totals = parse_pass(f"{WORK}/hi2-*.tsv", 450, "hi2")
    print(f"450dpi primary   : {len(rows)} rows, {len(bals)} bal lines, totals={totals}")
    bal_open = bals[0][2] if bals else None
    bal_close = bals[-1][2] if len(bals) > 1 else None
    tot_debit, tot_credit = totals if totals else (None, None)

    n = crop_refill(rows, 450, "hi2")
    print(f"strip re-OCR     : {n} rows refilled")

    empt = [r for r in rows if r["debit"] is None and r["credit"] is None]
    sd = round(sum(r["debit"] or 0 for r in rows), 2)
    sc = round(sum(r["credit"] or 0 for r in rows), 2)
    print(f"parsed rows      : {len(rows)}  (no amount: {len(empt)})")
    print(f"sum debits       : {sd:,.2f}   (printed {tot_debit:,.2f})  diff {sd - (tot_debit or 0):+,.2f}")
    print(f"sum credits      : {sc:,.2f}   (printed {tot_credit:,.2f})  diff {sc - (tot_credit or 0):+,.2f}")
    net = round(sc - sd, 2)
    expect_close = round((bal_open or 0) + net, 2)
    print(f"opening          : {bal_open:,.2f}")
    print(f"net movement     : {net:,.2f}")
    print(f"computed closing : {expect_close:,.2f}   (printed {bal_close:,.2f})  diff {expect_close - (bal_close or 0):+,.2f}")
    for r in empt[:10]:
        print(f"  EMPTY p{r['page']:02d} {r['date']} | {r['desc'][:50]}")
    ok = (tot_debit is not None and abs(sd - tot_debit) < 0.01
          and tot_credit is not None and abs(sc - tot_credit) < 0.01
          and abs(expect_close - (bal_close or 0)) < 0.01)
    print("CHAIN VERDICT    :", "100% — analyst verified" if ok else "MISMATCH")
    json.dump({"rows": rows, "opening": bal_open, "closing": bal_close,
               "totalDebits": tot_debit, "totalCredits": tot_credit,
               "sumDebits": sd, "sumCredits": sc}, open(f"{WORK}/rows450.json", "w"), indent=1)


if __name__ == "__main__":
    main()
