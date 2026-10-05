#!/usr/bin/env python3
"""NBE statement parser: TSV words -> rows -> 100% balance-chain verification.

Column bands (x @450dpi): date 340-601 | ref 601-1070 | desc 1070-1781
| debit 1781-2248 | credit 2248-2530 | balance 2530-3220 | value date 3220-3500
Small fee rows often miss their amount in OCR -> recovered exactly from the
balance delta (chain math is ground truth). Digit noise corrected by chain.
"""
import json
import re
import sys
from datetime import date

WORK = "/home/z/my-project/scripts/alahly_work"
NUM_RE = re.compile(r"^-?\d{1,3}(?:,\d{3})*\.\d{2}$|-?^\d+\.\d{2}$")
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")


def load_lines(pno, ytol=14):
    d = json.load(open(f"{WORK}/page_{pno:02d}.json"))
    words = sorted(d["words"], key=lambda w: (w["y"] + w["h"] / 2, w["x"]))
    lines = []
    cur, cur_y = [], None
    for w in words:
        yc = w["y"] + w["h"] / 2
        if cur_y is None or abs(yc - cur_y) <= ytol:
            cur.append(w)
            cur_y = yc if cur_y is None else (cur_y * (len(cur) - 1) + yc) / len(cur)
        else:
            lines.append(cur)
            cur, cur_y = [w], yc
    for ln in lines:
        ln.sort(key=lambda w: w["x"])
    return lines


def num(s):
    """Parse '1,234.56' / '-1,234.56' -> float or None."""
    s = s.replace(",", "").replace(" ", "")
    if re.fullmatch(r"-?\d+\.\d{2}", s):
        return float(s)
    return None


def parse_page(pno):
    lines = load_lines(pno)
    rows = []
    for ln in lines:
        cells = {"date": [], "ref": [], "desc": [], "debit": [], "credit": [], "bal": [], "vdate": []}
        for w in ln:
            x, t = w["x"], w["t"]
            if x < 340:
                continue  # serial / margin noise
            elif x < 601:
                cells["date"].append(t)
            elif x < 1070:
                cells["ref"].append(t)
            elif x < 1781:
                cells["desc"].append(t)
            elif x < 2248:
                cells["debit"].append(t)
            elif x < 2530:
                cells["credit"].append(t)
            elif x < 3220:
                cells["bal"].append(t)
            else:
                cells["vdate"].append(t)
        date_s = next((t for t in cells["date"] if DATE_RE.match(t)), None)
        vdate_s = next((t for t in cells["vdate"] if DATE_RE.match(t)), None)
        ref = " ".join(cells["ref"]).strip()
        desc = " ".join(cells["desc"]).strip()
        # amounts may land slightly out of band; scan debit/credit/bal for numeric tokens
        amt = None
        for tok in cells["debit"] + cells["credit"]:
            v = num(tok)
            if v is not None:
                amt = v
        bal = None
        for tok in cells["bal"] + cells["credit"]:
            v = num(tok)
            if v is not None and (amt is None or tok in cells["bal"]):
                bal = v
                break
        if not (date_s and bal is not None and (ref or desc)):
            continue
        rows.append({
            "page": pno, "date": date_s, "ref": ref,
            "desc": desc, "amt": amt, "bal": bal, "vdate": vdate_s,
        })
    return rows


def parse_all():
    rows = []
    for p in range(1, 24):
        rows.extend(parse_page(p))
    return rows


def chain_verify(rows):
    """Walk rows; recover missing amounts from deltas; report chain breaks."""
    events = []
    fixed = 0
    breaks = []
    prev_bal = None
    for i, r in enumerate(rows):
        if prev_bal is None:
            prev_bal = r["bal"]
            events.append({**r, "signed": None, "src": "first"})
            continue
        delta = round(r["bal"] - prev_bal, 2)
        if r["amt"] is None:
            if abs(delta) < 0.005:
                signed = 0.0
            else:
                signed = delta
            src = "delta"
            fixed += 1
        else:
            if abs(abs(r["amt"]) - abs(delta)) < 0.005 and (r["amt"] * delta >= 0 or abs(r["amt"]) == abs(delta)):
                signed = delta if abs(delta) > 0.005 else 0.0
                # trust printed sign for classification: debit printed negative
                signed = r["amt"]
                src = "printed"
            else:
                # mismatch: trust the delta (chain) over OCR digits
                signed = delta
                src = "chain-fix"
                fixed += 1
                breaks.append({"i": i, "page": r["page"], "printed": r["amt"], "delta": delta})
        events.append({**r, "signed": signed, "src": src})
        prev_bal = r["bal"]
    return events, fixed, breaks


def main():
    rows = parse_all()
    print(f"parsed rows: {len(rows)}")
    # consecutive-balance sanity: same-balance duplicates (row continuation lines)
    events, fixed, breaks = chain_verify(rows)
    print(f"chain: fixed-from-delta {fixed}, printed-vs-chain mismatches {len(breaks)}")
    deb = round(sum(e["signed"] for e in events if e["signed"] and e["signed"] < 0), 2)
    cre = round(sum(e["signed"] for e in events if e["signed"] and e["signed"] > 0), 2)
    print(f"credits {cre:,.2f}  debits {deb:,.2f}  net {round(cre+deb,2):,.2f}")
    print(f"first: {events[0]['date']} bal={events[0]['bal']:,.2f}")
    print(f"last:  {events[-1]['date']} bal={events[-1]['bal']:,.2f} page {events[-1]['page']}")
    json.dump(events, open(f"{WORK}/events.json", "w"), ensure_ascii=False, indent=1)
    print("WROTE events.json")
    for b in breaks[:20]:
        print("  BREAK:", b)


if __name__ == "__main__":
    main()
