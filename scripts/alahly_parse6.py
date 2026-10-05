#!/usr/bin/env python3
"""NBE parser v6 — per-page adaptive bands + money normalizer + chain solver.

Per page: locate the balance column as the rightmost dense money-token cluster
(x 2100-3300), the amount column as the rightmost dense cluster left of it.
Handles page-to-page table shift and comma-decimal OCR artifacts.
"""
import json
import re
from collections import Counter

WORK = "/home/z/my-project/scripts/alahly_work"
CONF = [("4", "9"), ("0", "5"), ("1", "7"), ("3", "8"), ("5", "6"), ("2", "9"), ("1", "2")]
MONEY = re.compile(r"^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^-?\d+[.,]\d{2}$")
DATE_OK = re.compile(r"^\d{2}/\d{2}/[0-9OQl]{4}$")


def money(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s)
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    return float(f"{m.group(0)[0] == '-' and '-' or ''}{ip}.{m.group(2)}")


def fnum(s):
    v = money(s)
    return v


def norm_date(s):
    m = re.match(r"^(\d{2})/(\d{2})/([0-9OQl]{4})$", s or "")
    if not m:
        return None
    y = m.group(3).translate(str.maketrans("OQl", "000"))
    if not y.isdigit():
        return None
    if y != "2026":
        y = "2026"
    return f"{m.group(1)}/{m.group(2)}/{y}"


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


def digit_variants(v):
    s = f"{abs(v):,.2f}"
    out = {s, s.replace(",", "")}
    for a, b in CONF:
        for i, ch in enumerate(s):
            if ch == a:
                out.add(s[:i] + b + s[i + 1:])
            elif ch == b:
                out.add(s[:i] + a + s[i + 1:])
    return {abs(fnum(x)) for x in out if fnum(x) is not None}


def detect_bands(lines):
    """Find balance/amount column x-centers from money tokens."""
    bals, amts = [], []
    for ln in lines:
        for w in ln:
            if w["x"] > 2000 and fnum(w["t"]) is not None:
                bals.append(w["x"])
            elif 1500 < w["x"] <= 2100 and fnum(w["t"]) is not None:
                amts.append(w["x"])
    if not bals:
        return (2820, 2965), (1830, 2100)
    bc = Counter(x // 40 * 40 for x in bals).most_common(1)[0][0]
    bband = (bc - 130, bc + 40)
    if amts:
        ac = Counter(x // 40 * 40 for x in amts).most_common(1)[0][0]
        aband = (ac - 120, ac + 60)
    else:
        aband = (1830, 2100)
    return bband, aband


def page_rows(pno):
    d450 = json.load(open(f"{WORK}/page_{pno:02d}.json"))
    d600 = json.load(open(f"{WORK}/p600_{pno:02d}.json"))
    lines = group_lines(d450["words"])
    w600 = group_lines(d600["words"])
    bband, aband = detect_bands(lines + w600)

    anchors = []
    for ln in lines:
        dt = next((norm_date(w["t"]) for w in ln if w["x"] < 601 and norm_date(w["t"])), None)
        if dt:
            anchors.append({"y": ln[0]["y"], "date": dt})
    pre = []
    if pno == 1 and anchors:
        first_y = anchors[0]["y"]
        for ln in lines:
            if ln[0]["y"] >= first_y:
                break
            if any(bband[0] <= w["x"] < bband[1] and fnum(w["t"]) is not None for w in ln):
                pre.append({"y": ln[0]["y"], "date": None})
    anchors = sorted(pre + anchors, key=lambda a: a["y"])

    rows = []
    for i, a in enumerate(anchors):
        y0 = a["y"] - 8
        y1 = anchors[i + 1]["y"] - 8 if i + 1 < len(anchors) else 10 ** 9
        row = {"page": pno, "y": a["y"], "date": a["date"], "ref": "", "desc": "",
               "amts": [], "bals": [], "vdate": None}
        for src_lines, tag in ((lines, "450"), (w600, "600")):
            for ln in src_lines:
                y = ln[0]["y"]
                pad = -8 if tag == "450" else -14
                if not (y0 + pad <= y < y1 + 6):
                    continue
                for w in ln:
                    x, t = w["x"], w["t"]
                    if 601 <= x < 1070 and not row["ref"] and not fnum(t):
                        row["ref"] = t
                    elif 1070 <= x < (aband[0] - 20) and not fnum(t):
                        if t not in row["desc"]:
                            row["desc"] = (row["desc"] + " " + t).strip()
                    elif aband[0] <= x < aband[1] and fnum(t) is not None:
                        row["amts"].append({"v": abs(fnum(t)), "src": tag})
                    elif bband[0] <= x < bband[1] + 60 and fnum(t) is not None:
                        row["bals"].append(fnum(t))
                    elif x > bband[1] + 60 and norm_date(t):
                        row["vdate"] = norm_date(t)
        seen, amts = set(), []
        for x2 in row["amts"]:
            if round(x2["v"], 2) not in seen:
                seen.add(round(x2["v"], 2))
                amts.append(x2)
        row["amts"] = amts
        row["bals"] = sorted(set(round(b, 2) for b in row["bals"]))
        if row["date"] or row["bals"]:
            rows.append(row)
    return rows


def solve(rows):
    events, prev, issues = [], None, []
    for i, r in enumerate(rows):
        chosen_bal, chosen_amt, signed, src = None, None, None, None
        if prev is None:
            chosen_bal = r["bals"][0] if r["bals"] else None
            src = "opening"
        else:
            done = False
            for b in r["bals"]:
                delta = round(b - prev, 2)
                for a in r["amts"]:
                    if abs(a["v"] - abs(delta)) <= 0.011:
                        chosen_bal, chosen_amt, signed = b, a["v"], delta
                        src = "chain"
                        done = True
                        break
                if not done and abs(delta) <= 2000:
                    chosen_bal, chosen_amt, signed = b, abs(delta), delta
                    src = "delta"
                    done = True
                if done:
                    break
            if not done:
                bvars, avars = [], []
                for b in r["bals"]:
                    bvars.extend(digit_variants(b))
                for a in r["amts"]:
                    avars.extend(digit_variants(a["v"]))
                found = None
                for bv in bvars:
                    delta = round(bv - prev, 2)
                    if abs(delta) > 500000:
                        continue
                    for av in avars:
                        if abs(av - abs(delta)) <= 0.011:
                            found = (bv, av, delta)
                            break
                    if not found and not r["amts"] and 0 < abs(delta) <= 2000:
                        found = (bv, abs(delta), delta)
                    if found:
                        break
                # decimal-slip: printed 2.50 -> 2500.00 style
                if not found and r["amts"] and r["bals"]:
                    b = r["bals"][0]
                    delta = round(b - prev, 2)
                    for a in r["amts"]:
                        for k in (10, 100, 1000):
                            if abs(a["v"] / k - abs(delta)) <= 0.011 and abs(delta) < 3000:
                                found = (b, round(a["v"] / k, 2), delta)
                                break
                        if found:
                            break
                if found:
                    chosen_bal, chosen_amt, signed = found
                    src = "variant"
                elif r["bals"]:
                    chosen_bal = r["bals"][0]
                    delta = round(chosen_bal - prev, 2)
                    chosen_amt = r["amts"][0]["v"] if r["amts"] else abs(delta) if abs(delta) > 0.005 else 0.0
                    signed = delta if abs(delta) > 0.005 else 0.0
                    src = "trust-bal"
                    issues.append({"i": i, "page": r["page"], "date": r["date"], "prev": prev,
                                   "bals": r["bals"], "amts": [a["v"] for a in r["amts"]],
                                   "desc": r["desc"][:50], "kind": "trust-bal"})
                elif r["amts"] and len(r["amts"]) == 1 and r["amts"][0]["v"] <= 300000:
                    chosen_amt = r["amts"][0]["v"]
                    src = "interp"
                    issues.append({"i": i, "page": r["page"], "date": r["date"], "prev": prev,
                                   "bals": [], "amts": [a["v"] for a in r["amts"]],
                                   "desc": r["desc"][:50], "kind": "interp"})
                else:
                    src = "drop"
                    issues.append({"i": i, "page": r["page"], "date": r["date"], "prev": prev,
                                   "bals": r["bals"], "amts": [a["v"] for a in r["amts"]],
                                   "desc": r["desc"][:50], "kind": "drop"})
        events.append({"page": r["page"], "y": r["y"], "date": r["date"], "ref": r["ref"],
                       "desc": r["desc"], "vdate": r["vdate"],
                       "amt": chosen_amt, "signed": signed, "bal": chosen_bal, "src": src})
        if chosen_bal is not None:
            prev = chosen_bal
    return events, issues


def main():
    rows = []
    for p in range(1, 24):
        rows.extend(page_rows(p))
    print(f"rows: {len(rows)}")
    events, issues = solve(rows)
    srcs = Counter(e["src"] for e in events)
    print("srcs:", dict(srcs))
    known = [e for e in events if e["signed"] is not None and e["amt"] is not None]
    cre = round(sum(e["signed"] for e in known if e["signed"] > 0), 2)
    deb = round(sum(e["signed"] for e in known if e["signed"] < 0), 2)
    print(f"signed rows {len(known)}  credits {cre:,.2f}  debits {deb:,.2f}  net {round(cre + deb, 2):,.2f}")
    print(f"issues: {len(issues)} ({Counter(i2['kind'] for i2 in issues)})")
    for it in issues[:12]:
        print("  ", it["kind"], "p", it["page"], it["date"], "prev", it["prev"], "bals", it["bals"][:3], "amts", it["amts"][:3], "|", it["desc"][:40])
    json.dump(events, open(f"{WORK}/events_v6.json", "w"), ensure_ascii=False, indent=1)
    json.dump(issues, open(f"{WORK}/issues_v6.json", "w"), ensure_ascii=False, indent=1)
    print("WROTE events_v6.json / issues_v6.json")


if __name__ == "__main__":
    main()
