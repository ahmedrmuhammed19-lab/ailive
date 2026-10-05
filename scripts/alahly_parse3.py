#!/usr/bin/env python3
"""NBE parser v3 — row anchors + two-pass consensus + chain solver.

A ROW = line containing a date token at x<601 (every table row starts with
its date; description continuation lines never do). All tokens within the
row's y-span [row.y, next_row.y) belong to the row.

Chain solver: b_i = b_{i-1} + a_i. Candidates per row from 450dpi and 600dpi
readings; digit-confusion variants (4<->9, 0<->5, 1<->7, 3<->8, 5<->6) tried
on balances when direct chaining fails. Missing small fee amounts recovered
exactly from deltas.
"""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
DATE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
CONF = [("4", "9"), ("0", "5"), ("1", "7"), ("3", "8"), ("5", "6"), ("2", "9")]


def fnum(s):
    s = s.replace(",", "").rstrip(".")
    if re.fullmatch(r"-?\d+\.\d{1,2}?", s):
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
    return sorted(lines, key=lambda ln: ln[0]["y"])


def variants(s):
    """Single-digit confusion variants of a numeric string (both .2f forms)."""
    out = {s}
    for a, b in CONF:
        for i, ch in enumerate(s):
            if ch == a:
                out.add(s[:i] + b + s[i + 1:])
            elif ch == b:
                out.add(s[:i] + a + s[i + 1:])
    return out


def bal_variants(v):
    """Float -> formatted variants -> floats."""
    s = f"{v:,.2f}"
    vs = variants(s) | variants(s.replace(",", ""))
    res = set()
    for x in vs:
        f = fnum(x)
        if f is not None:
            res.add(round(f, 2))
    return res


def page_rows(pno):
    d450 = json.load(open(f"{WORK}/page_{pno:02d}.json"))
    d600 = json.load(open(f"{WORK}/p600_{pno:02d}.json"))
    lines = group_lines(d450["words"])
    w600 = group_lines(d600["words"])

    # anchors: lines with a date token at x<601
    anchors = []
    for ln in lines:
        dt = next((w["t"] for w in ln if w["x"] < 601 and DATE.match(w["t"])), None)
        if dt:
            anchors.append({"y": ln[0]["y"], "date": dt, "line": ln})
    rows = []
    for i, a in enumerate(anchors):
        y_end = anchors[i + 1]["y"] if i + 1 < len(anchors) else 10 ** 9
        row = {"page": pno, "y": a["y"], "date": a["date"], "ref": "", "desc": "",
               "amt": [], "bal": [], "vdate": None}
        for ln in lines:
            y = ln[0]["y"]
            if not (a["y"] - 6 <= y < y_end):
                continue
            for w in ln:
                x, t = w["x"], w["t"]
                if 601 <= x < 1070 and t != row["ref"]:
                    if not row["ref"]:
                        row["ref"] = t
                elif 1070 <= x < 1781:
                    if t not in row["desc"]:
                        row["desc"] = (row["desc"] + " " + t).strip()
                elif 1781 <= x < 2530:
                    v = fnum(t)
                    if v is not None:
                        row["amt"].append((v, "450", x >= 2248))
                elif 2530 <= x < 3220:
                    v = fnum(t)
                    if v is not None:
                        row["bal"].append((v, "450"))
                elif x >= 3220 and DATE.match(t):
                    row["vdate"] = t
        for ln in w600:
            y = ln[0]["y"] * 1.0
            if not (a["y"] - 10 <= y < y_end + 10):
                continue
            for w in ln:
                x, t = w["x"], w["t"]
                v = fnum(t)
                if v is None:
                    continue
                if 1781 <= x < 2530:
                    row["amt"].append((v, "600", x >= 2248))
                elif 2530 <= x < 3230:
                    row["bal"].append((v, "600"))
        # dedupe
        row["amt"] = sorted(set((v, s, c) for v, s, c in row["amt"]))
        row["bal"] = sorted(set((v, s) for v, s in row["bal"]))
        rows.append(row)
    return rows


def amt_variants(v):
    """Variants of an amount: sign fixes + digit confusions (magnitude only)."""
    vs = {v, -v}
    s = f"{abs(v):,.2f}"
    for x in variants(s) | variants(s.replace(",", "")):
        f = fnum(x)
        if f is not None:
            vs |= {f, -f}
    return {round(x, 2) for x in vs}


def solve(rows):
    """Chain solver. Returns (events, report)."""
    events = []
    prev = None
    issues = []
    for i, r in enumerate(rows):
        bals = [v for v, _ in r["bal"]]
        amts = [v for v, _, _ in r["amt"]]
        chosen_bal = None
        chosen_amt = None
        src = None
        if prev is None:
            chosen_bal = bals[0] if bals else None
            chosen_amt = None
            src = "first"
        else:
            # try: (bal candidate) - prev == (amount candidate)
            ok = False
            for bi, b in enumerate(bals + [None]):
                if b is None:
                    continue
                delta = round(b - prev, 2)
                for a in amts:
                    if abs(abs(a) - abs(delta)) < 0.011:
                        chosen_bal, chosen_amt = b, a
                        src = f"chain:{'450' if bals and b in [v for v,_ in r['bal']][:1] else ''}"
                        ok = True
                        break
                if ok:
                    break
            if not ok:
                # digit-variant search on balances
                cands = []
                for b in bals:
                    for bv in bal_variants(b):
                        delta = round(bv - prev, 2)
                        cands.append((bv, delta))
                # also amount variants
                avars = set()
                for a in amts:
                    avars |= amt_variants(a)
                best = None
                for bv, delta in cands:
                    for a in avars:
                        if abs(abs(a) - abs(delta)) < 0.011:
                            score = 0 if (bv, round(a, 2)) in {(v, round(v2, 2)) for v, v2 in [(x, x) for x in []]} else 1
                            if best is None or score < best[0]:
                                best = (score, bv, a)
                    # missing-amount row: exact delta
                    if best is None and abs(delta) < 20000:
                        best = (2, bv, None)
                if best:
                    _, chosen_bal, chosen_amt = best
                    src = "variant" if best[0] <= 1 else "delta"
                else:
                    chosen_bal = bals[0] if bals else None
                    chosen_amt = amts[0] if amts else None
                    src = "BREAK"
                    issues.append({"i": i, "page": r["page"], "date": r["date"],
                                   "prev": prev, "bals": bals, "amts": amts})
        events.append({**{k: r[k] for k in ("page", "date", "ref", "desc", "vdate")},
                       "bal": chosen_bal, "amt": chosen_amt, "src": src})
        if chosen_bal is not None:
            prev = chosen_bal
    return events, issues


def main():
    all_rows = []
    for p in range(1, 24):
        pr = page_rows(p)
        all_rows.extend(pr)
        print(f"page {p}: {len(pr)} rows", flush=True)
    print(f"TOTAL rows: {len(all_rows)}")
    events, issues = solve(all_rows)
    print(f"chain BREAKS: {len(issues)}")
    for it in issues[:15]:
        print("  ", it)
    cre = round(sum(e["amt"] for e in events if e["amt"] and e["amt"] > 0), 2)
    deb = round(sum(e["amt"] for e in events if e["amt"] and e["amt"] < 0), 2)
    print(f"credits {cre:,.2f} debits {deb:,.2f} net {round(cre + deb, 2):,.2f}")
    if events:
        print("first:", events[0]["date"], f"{events[0]['bal']:,.2f}")
        print("last :", events[-1]["date"], f"{events[-1]['bal']:,.2f}", "page", events[-1]["page"])
    json.dump(events, open(f"{WORK}/events_v3.json", "w"), ensure_ascii=False, indent=1)
    json.dump(issues, open(f"{WORK}/issues_v3.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
