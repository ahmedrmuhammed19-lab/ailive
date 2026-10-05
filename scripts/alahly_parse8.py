#!/usr/bin/env python3
"""NBE parser v8 — FINAL INTEGRATION: 450 + 600 + 900c passes, per-page bands,
chain solver with closing-anchor cross-check. Output: events_v8.json"""
import json
import re
from collections import Counter

WORK = "/home/z/my-project/scripts/alahly_work"
CONF = [("4", "9"), ("0", "5"), ("1", "7"), ("3", "8"), ("5", "6"), ("2", "9"), ("1", "2")]
MONEY = re.compile(r"^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^-?\d+[.,]\d{2}$")


def fnum(s):
    m = re.match(r"^-?(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{2})$", s)
    if not m:
        return None
    ip = re.sub(r"[.,]", "", m.group(1))
    neg = s.startswith("-")
    return float(f"{'-' if neg else ''}{ip}.{m.group(2)}")


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
    s = f"{abs(v):,.2f}"
    outs = {s, s.replace(",", "")}
    subs = []
    for a, b in CONF:
        subs += [(a, b), (b, a)]
    for a, b in subs:
        for i, ch in enumerate(s):
            if ch == a:
                outs.add(s[:i] + b + s[i + 1:])
    two = {base[:i] + b + base[i + 1:]
           for base in outs for a, b in subs
           for i, ch in enumerate(base) if ch == a}
    outs |= two
    return {abs(fnum(x)) for x in outs if fnum(x) is not None}


def page_rows(pno):
    d450 = json.load(open(f"{WORK}/page_{pno:02d}.json"))
    d600 = json.load(open(f"{WORK}/p600_{pno:02d}.json"))
    d900 = json.load(open(f"{WORK}/p900c_{pno:02d}.json"))
    lines = group_lines(d450["words"])
    w600 = group_lines(d600["words"])
    w900 = group_lines([dict(w, h=20) for w in d900["words"]])

    # per-page balance x center
    bxs = [w["x"] for w in d450["words"] if w["x"] > 2000 and fnum(w["t"]) is not None]
    bc = max(set(bxs), key=bxs.count) if bxs else 2890
    bband = (bc - 130, bc + 45)
    cband = (max(1500, bc - 820), bc - 330)   # credit column
    aband = (max(1500, bc - 1090), bc - 830)  # debit column

    anchors = []
    for ln in lines:
        dt = next((norm_date(w["t"]) for w in ln if w["x"] < 601 and norm_date(w["t"])), None)
        if dt:
            anchors.append({"y": ln[0]["y"], "date": dt})
    pre = []
    if pno == 1 and anchors:
        fy = anchors[0]["y"]
        for ln in lines:
            if ln[0]["y"] >= fy:
                break
            if any(bband[0] <= w["x"] < bband[1] and fnum(w["t"]) is not None for w in ln):
                pre.append({"y": ln[0]["y"], "date": None})
    # extra balance-anchored rows outside dated spans
    dated = list(anchors)
    spans = []
    for i2, a in enumerate(dated):
        y1 = anchors[i2 + 1]["y"] - 8 if i2 + 1 < len(anchors) else 10 ** 9
        spans.append((a["y"] - 8, y1))

    def in_dated(y):
        return any(s0 <= y < s1 for s0, s1 in spans)

    W = max(w["y"] + w["h"] for w in d450["words"])
    footer_y = W - 620 if pno == 1 else W + 1
    extra = []
    for ln in lines:
        y = ln[0]["y"]
        if y < 500 or y > footer_y or in_dated(y):
            continue
        bt = [w for w in ln if bband[0] <= w["x"] < bband[1] and fnum(w["t"]) is not None]
        hs = any((601 <= w["x"] < 1070 and not fnum(w["t"])) or
                 (1070 <= w["x"] < aband[0] and not fnum(w["t"])) for w in ln)
        if bt and hs:
            extra.append({"y": y, "date": None})
    anchors = sorted(dated + pre + extra, key=lambda a: a["y"])
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
        for src_lines, tag in ((lines, "450"), (w600, "600"), (w900, "900")):
            for ln in src_lines:
                y = ln[0]["y"]
                pad = {"450": -8, "600": -14, "900": -16}[tag]
                if not (y0 + pad <= y < y1 + 8):
                    continue
                for w in ln:
                    x, t = w["x"], w["t"]
                    v = fnum(t)
                    if 601 <= x < 1070 and not row["ref"] and v is None:
                        row["ref"] = t
                    elif 1070 <= x < aband[0] and v is None:
                        if t not in row["desc"]:
                            row["desc"] = (row["desc"] + " " + t).strip()
                    elif aband[0] <= x < aband[1] and v is not None:
                        row["amts"].append({"v": abs(v), "src": tag, "credit": False})
                    elif cband[0] <= x < cband[1] and v is not None:
                        row["amts"].append({"v": abs(v), "src": tag, "credit": True})
                    elif bband[0] <= x < bband[1] and v is not None:
                        row["bals"].append(v)
                    elif x > bband[1] and norm_date(t):
                        row["vdate"] = norm_date(t)
        seen, amts = set(), []
        for x2 in row["amts"]:
            k = (round(x2["v"], 2), x2["credit"])
            if k not in seen:
                seen.add(k)
                amts.append(x2)
        row["amts"] = amts
        row["bals"] = sorted(set(round(b, 2) for b in row["bals"]))
        if row["date"] or row["bals"]:
            rows.append(row)
    return rows


def solve(rows):
    events, prev, issues = [], None, []
    for i, r in enumerate(rows):
        chosen_bal, chosen_amt, signed, src, credit = None, None, None, None, None
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
                        credit = delta > 0
                        src = "chain"
                        done = True
                        break
                if not done and abs(delta) <= 2000:
                    chosen_bal, chosen_amt, signed = b, abs(delta), delta
                    credit = delta > 0
                    src = "delta"
                    done = True
                if done:
                    break
            if not done:
                bvars, avars = [], []
                for b in r["bals"]:
                    bvars.extend(digit_variants(b))
                for a in r["amts"]:
                    for dv in digit_variants(a["v"]):
                        avars.append((dv, a["credit"]))
                found = None
                for bv in bvars:
                    delta = round(bv - prev, 2)
                    if abs(delta) > 600000:
                        continue
                    for av, cb in avars:
                        if abs(av - abs(delta)) <= 0.011:
                            found = (bv, av, delta, cb)
                            break
                    if not found and not r["amts"] and 0 < abs(delta) <= 2000:
                        found = (bv, abs(delta), delta, delta > 0)
                    if found:
                        break
                if not found and r["bals"] and r["amts"]:
                    for b in r["bals"]:
                        for bv in digit_variants2(b):
                            delta = round(bv - prev, 2)
                            if abs(delta) > 600000:
                                continue
                            for a in r["amts"]:
                                for av in digit_variants2(a["v"]):
                                    if abs(av - abs(delta)) <= 0.011:
                                        found = (bv, av, delta, a["credit"])
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
                                found = (b, round(a["v"] / k, 2), delta, a["credit"])
                                break
                        if found:
                            break
                if found:
                    chosen_bal, chosen_amt, signed, credit = found
                    src = "variant"
                elif r["bals"]:
                    chosen_bal = r["bals"][0]
                    delta = round(chosen_bal - prev, 2)
                    signed = delta
                    chosen_amt = abs(delta) if abs(delta) > 0.005 else 0.0
                    credit = delta > 0
                    src = "trust-bal"
                    issues.append({"i": i, "page": pno_i(r), "date": r["date"], "prev": prev,
                                   "bals": r["bals"], "amts": [(a["v"], a["credit"]) for a in r["amts"]],
                                   "desc": r["desc"][:60], "kind": "trust-bal"})
                elif r["amts"]:
                    a = r["amts"][0]
                    chosen_amt = a["v"]
                    signed = None
                    credit = a["credit"]
                    src = "interp"
                    issues.append({"i": i, "page": pno_i(r), "date": r["date"], "prev": prev,
                                   "bals": [], "amts": [(a["v"], a["credit"])],
                                   "desc": r["desc"][:60], "kind": "interp"})
                else:
                    src = "drop"
                    issues.append({"i": i, "page": pno_i(r), "date": r["date"], "prev": prev,
                                   "bals": r["bals"], "amts": [], "desc": r["desc"][:60],
                                   "kind": "drop"})
        events.append({"page": r["page"], "y": r["y"], "date": r["date"], "ref": r["ref"],
                       "desc": r["desc"], "vdate": r["vdate"], "amt": chosen_amt,
                       "signed": signed, "bal": chosen_bal, "src": src, "credit": credit})
        if chosen_bal is not None:
            prev = chosen_bal
    return events, issues


def pno_i(r):
    return r["page"]


def main():
    rows = []
    for p in range(1, 24):
        rows.extend(page_rows(p))
    print(f"rows: {len(rows)}")
    events, issues = solve(rows)
    srcs = Counter(e["src"] for e in events)
    print("srcs:", dict(srcs))
    known = [e for e in events if e["signed"] is not None and e["src"] in
             ("opening", "chain", "delta", "variant")]
    cre = round(sum(e["signed"] for e in known if e["signed"] > 0), 2)
    deb = round(sum(e["signed"] for e in known if e["signed"] < 0), 2)
    print(f"high-conf rows {len(known)}  credits {cre:,.2f}  debits {deb:,.2f}  net {round(cre + deb, 2):,.2f}")
    print(f"anchor net: 163,656.81  residual {round(cre + deb - 163656.81, 2):,.2f}")
    print(f"issues: {len(issues)} ({Counter(i2['kind'] for i2 in issues)})")
    json.dump(events, open(f"{WORK}/events_v8.json", "w"), ensure_ascii=False, indent=1)
    json.dump(issues, open(f"{WORK}/issues_v8.json", "w"), ensure_ascii=False, indent=1)
    for it in issues[:10]:
        print("  ", it["kind"], "p", it["page"], it["date"], "prev", it["prev"], "bals", it["bals"][:2], "amts", it["amts"][:2], "|", it["desc"][:40])


if __name__ == "__main__":
    main()
