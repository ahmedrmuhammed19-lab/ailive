#!/usr/bin/env python3
"""NBE parser v2: two-pass (450/600dpi) consensus + chain solver.

Row anatomy (450dpi coords): date 340-601 | ref 601-1070 | desc 1070-1781
| debit 1781-2248 | credit 2248-2530 | balance 2530-3220 | vdate 3220+
A row = line group containing a date token AND/OR balance token near x 2820-2960.
"""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
NUM = re.compile(r"^-?\d{1,3}(?:,\d{3})*\.\d{1,2}$")
DATE = re.compile(r"^\d{2}/\d{2}/\d{4}$")


def fnum(s):
    s = s.replace(",", "")
    if re.fullmatch(r"-?\d+\.\d{1,2}", s):
        return float(s)
    return None


def group_lines(words, ytol=14):
    words = sorted(words, key=lambda w: (w["y"] + w["h"] / 2, w["x"]))
    lines, cur, cur_y = [], [], None
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


def harvest(pno):
    """Collect candidate rows from 450dpi words + merge 600dpi numeric words."""
    d = json.load(open(f"{WORK}/page_{pno:02d}.json"))
    lines = group_lines(d["words"])
    d600 = json.load(open(f"{WORK}/p600_{pno:02d}.json"))
    w600 = group_lines(d600["words"])

    rows = []
    for ln in lines:
        row = {"page": pno, "date": None, "ref": "", "desc": "", "amt450": None,
               "amt600": None, "bal450": None, "bal600": None, "vdate": None}
        for w in ln:
            x, t = w["x"], w["t"]
            if x < 340:
                continue
            if DATE.match(t) and x < 601 and not row["date"]:
                row["date"] = t
            elif 601 <= x < 1070:
                row["ref"] = (row["ref"] + " " + t).strip()
            elif 1070 <= x < 1781:
                row["desc"] = (row["desc"] + " " + t).strip()
            elif 1781 <= x < 2530:
                v = fnum(t)
                if v is not None and row["amt450"] is None:
                    row["amt450"] = v
            elif 2530 <= x < 3220:
                v = fnum(t)
                if v is not None and row["bal450"] is None:
                    row["bal450"] = v
            elif x >= 3220 and DATE.match(t):
                row["vdate"] = t
        if row["date"] or row["bal450"] is not None or row["amt450"] is not None:
            rows.append(row)

    # merge 600dpi numeric lines by y proximity
    for ln in w600:
        toks = [(w["x"], w["t"]) for w in ln]
        amts = [fnum(t) for x, t in toks if 1781 <= x < 2530 and fnum(t) is not None]
        bals = [fnum(t) for x, t in toks if 2530 <= x < 3230 and fnum(t) is not None]
        if not amts and not bals:
            continue
        ymid = ln[0]["y"] + ln[0]["h"] / 2
        # attach to nearest 450 row within 30px
        best, bd = None, 1e9
        for r in rows:
            pass  # rows lack y; handled below via re-scan
        # simpler: store by nearest row y — recompute rows' y
        for r in rows:
            pass
        ln600_y = ymid
        target = min(rows, key=lambda r: min(abs(r.get("y", 0) - ln600_y), 1e9), default=None)
        # rows don't carry y -> attach via second pass below
    return rows, w600


def attach600(rows, w600):
    """Attach 600dpi amounts/balances to rows via y overlap.
    Rows get y from their original line groups — recompute here."""
    # rebuild row y by re-walking 450 words (cheap)
    d = json.load(open(f"{WORK}/page_{pno:02d}.json")) if False else None


def main():
    all_rows = []
    for p in range(1, 24):
        rows, _ = harvest(p)
        all_rows.extend(rows)
    print(f"candidate rows: {len(all_rows)}")
    dated = [r for r in all_rows if r["date"]]
    print(f"rows with date: {len(dated)}")
    withbal = [r for r in all_rows if r["bal450"] is not None]
    print(f"rows with 450-balance: {len(withbal)}")
    withamt = [r for r in all_rows if r["amt450"] is not None]
    print(f"rows with 450-amount: {len(withamt)}")


if __name__ == "__main__":
    main()
