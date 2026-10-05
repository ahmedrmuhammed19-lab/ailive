#!/usr/bin/env python3
"""NBE parser v7 — v6 + balance-anchored recovery of date-less rows +
multi-digit (2-substitution) variant search. Target: 100% chain."""
import json
import re
from collections import Counter
from itertools import combinations

WORK = "/home/z/my-project/scripts/alahly_work"
CONF = [("4", "9"), ("0", "5"), ("1", "7"), ("3", "8"), ("5", "6"), ("2", "9"), ("1", "2")]
DATE_OK = re.compile(r"^\d{2}/\d{2}/[0-9OQl]{4}$")


def money(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s)
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    neg = s.startswith("-")
    return float(f"{'-' if neg else ''}{ip}.{m.group(2)}")


def fnum(s):
    return money(s)


def norm_date(s):
    m = re.match(r"^(\d{2})/(\d{2})/([0-9OQl]{4})$", s or "")
    if not m:
        return None
    y = m.group(3).translate(str.maketrans("OQl", "000"))
    if not y.isdigit():
        return None
    return f"{m.group(1)}/{m.group(2)}/{'2026' if y != '2026' else y}"


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


def digit_variants2(v):
    """Up to two substitutions."""
    s = f"{abs(v):,.2f}"
    outs = {s, s.replace(",", "")}
    subs = []
    for a, b in CONF:
        subs.append((a, b))
        subs.append((b, a))
    for a, b in subs:
        for i, ch in enumerate(s):
            if ch == a:
                outs.add(s[:i] + b + s[i + 1:])
    two = set()
    for base in outs:
        for a, b in subs:
            for i, ch in enumerate(base):
                if ch == a:
                    two.add(base[:i] + b + base[i + 1:])
    outs |= two
    return {abs(fnum(x)) for x in outs if fnum(x) is not None}


def detect_bands(lines):
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
    W = d450["words"] and max(w["y"] + w["h"] for w in d450["words"])

    # dated anchors
    dated = []
    for ln in lines:
        dt = next((norm_date(w["t"]) for w in ln if w["x"] < 601 and norm_date(w["t"])), None)
        if dt:
            dated.append({"y": ln[0]["y"], "date": dt})
    # spans of dated rows
    spans = []
    for i, a in enumerate(dated):
        y1 = dated[i + 1]["y"] - 8 if i + 1 < len(dated) else 10 ** 9
        spans.append((a["y"] - 8, y1))

    def in_dated(y):
        return any(s0 <= y < s1 for s0, s1 in spans)

    # extra anchors: strict balance-token lines outside dated spans, not header/footer
    extra = []
    footer_y = (W or 5200) - 620 if pno == 1 else (W or 5200) + 1
    for ln in lines:
        y = ln[0]["y"]
        if y < 500 or y > footer_y or in_dated(y):
            continue
        btoks = [w for w in ln if bband[0] <= w["x"] < bband[1] + 60 and fnum(w["t"]) is not None]
        has_ref = any(601 <= w["x"] < 1070 for w in ln)
        has_desc = any(1070 <= w["x"] < aband[0] - 20 for w in ln)
        if btoks and (has_ref or has_desc):
            extra.append({"y": y, "date": None})
    anchors = sorted(dated + extra, key=lambda a: a["y"])
    # dedupe close anchors
    dedup = []
    for a in anchors:
        if dedup and abs(a["y"] - dedup[-1]["y"]) < 60:
            continue
        dedup.append(a)
    anchors = dedup

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
                bvars = []
                for b in r["bals"]:
                    bvars.extend(digit_variants(b))
                avars = []
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
                if not found and r["bals"] and r["amts"]:
                    for b in r["bals"]:
                        for bv in digit_variants2(b):
                            delta = round(bv - prev, 2)
                            if abs(delta) > 500000:
                                continue
                            for a in r["amts"]:
                                for av in digit_variants2(a["v"]):
                                    if abs(av - abs(delta)) <= 0.011:
                                        found = (bv, av, delta)
                                        break
                                if found:
                                    break
                            if found:
                                break
                        if found:
                            break
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
                                   "desc": r["desc"][:60], "kind": "trust-bal"})
                elif r["amts"] and len(r["amts"]) == 1 and r["amts"][0]["v"] <= 300000:
                    chosen_amt = r["amts"][0]["v"]
                    src = "interp"
                    issues.append({"i": i, "page": r["page"], "date": r["date"], "prev": prev,
                                   "bals": [], "amts": [a["v"] for a in r["amts"]],
                                   "desc": r["desc"][:60], "kind": "interp"})
                else:
                    src = "drop"
                    issues.append({"i": i, "page": r["page"], "date": r["date"], "prev": prev,
                                   "bals": r["bals"], "amts": [a["v"] for a in r["amts"]],
                                   "desc": r["desc"][:60], "kind": "drop"})
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
    for it in issues[:14]:
        print("  ", it["kind"], "p", it["page"], it["date"], "prev", it["prev"], "bals", it["bals"][:3], "amts", it["amts"][:3], "|", it["desc"][:44])
    json.dump(events, open(f"{WORK}/events_v7.json", "w"), ensure_ascii=False, indent=1)
    json.dump(issues, open(f"{WORK}/issues_v7.json", "w"), ensure_ascii=False, indent=1)
    print("WROTE events_v7.json / issues_v7.json")


if __name__ == "__main__":
    main()
