#!/usr/bin/env python3
"""NBE parser v5 — FINAL: date-anchored rows + tight strict bands + chain solver.

Decoded facts:
- Amounts print in ONE column x~1830-2100 (450dpi), leading '-' is a print
  artifact — direction comes from the balance walk.
- Balances x~2820-2965, format N,NNN.NN. Value dates x>=3200.
- Fee rows are separate rows; small amounts often OCR-missed -> delta recovery.
- Page 1 first ledger row is the b/f opening balance (467,525.43, vdate 26/02).
- Page 23 closing block prints Available/Hold/total at print time.
"""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
CONF = [("4", "9"), ("0", "5"), ("1", "7"), ("3", "8"), ("5", "6"), ("2", "9"), ("1", "2")]
MONEY = re.compile(r"^-?\d{1,3}(?:,\d{3})*\.\d{2}$")


def fnum(s):
    s = s.replace(",", "")
    if re.fullmatch(r"-?\d+\.\d{2}", s):
        return float(s)
    return None


def norm_date(s):
    m = re.match(r"^(\d{2})/(\d{2})/([0-9OQl]{4})$", s or "")
    if not m:
        return None
    y = m.group(3).translate(str.maketrans("OQl", "000"))
    if not y.isdigit():
        return None
    if y != "2026":
        y = "2026"  # statement year is 2026; OCR year digits are unreliable
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
    s = f"{v:,.2f}"
    out = {s, s.replace(",", "")}
    for a, b in CONF:
        for i, ch in enumerate(s):
            if ch == a:
                out.add(s[:i] + b + s[i + 1:])
            elif ch == b:
                out.add(s[:i] + a + s[i + 1:])
    return {fnum(x) for x in out if fnum(x) is not None}


def page_rows(pno):
    d450 = json.load(open(f"{WORK}/page_{pno:02d}.json"))
    d600 = json.load(open(f"{WORK}/p600_{pno:02d}.json"))
    lines = group_lines(d450["words"])
    w600 = group_lines(d600["words"])

    anchors = []  # (y, date)
    for ln in lines:
        dt = next((norm_date(w["t"]) for w in ln if w["x"] < 601 and norm_date(w["t"])), None)
        if dt:
            anchors.append({"y": ln[0]["y"], "date": dt})
    # page-1 pre-anchor rows with strict balance (the b/f row)
    pre = []
    first_y = anchors[0]["y"] if anchors else 10 ** 9
    if pno == 1:
        for ln in lines:
            y = ln[0]["y"]
            if y >= first_y:
                break
            for w in ln:
                if 2820 <= w["x"] < 2965 and MONEY.match(w["t"]):
                    pre.append({"y": y, "date": None})
                    break
    anchors = sorted(pre + anchors, key=lambda a: a["y"])

    rows = []
    for i, a in enumerate(anchors):
        y0 = a["y"] - 8
        y1 = anchors[i + 1]["y"] - 8 if i + 1 < len(anchors) else 10 ** 9
        row = {"page": pno, "y": a["y"], "date": a["date"], "ref": "", "desc": "",
               "amts": [], "bals": [], "vdate": None}
        for ln in lines:
            y = ln[0]["y"]
            if not (y0 <= y < y1):
                continue
            for w in ln:
                x, t = w["x"], w["t"]
                if 601 <= x < 1070 and not row["ref"] and not MONEY.match(t):
                    row["ref"] = t
                elif 1070 <= x < 1781 and not MONEY.match(t):
                    if t not in row["desc"]:
                        row["desc"] = (row["desc"] + " " + t).strip()
                elif 1830 <= x < 2100 and MONEY.match(t):
                    v = fnum(t)
                    if v is not None:
                        row["amts"].append({"v": abs(v), "src": "450"})
                elif 2820 <= x < 2965 and MONEY.match(t):
                    v = fnum(t)
                    if v is not None:
                        row["bals"].append(v)
                elif x >= 3200 and norm_date(t):
                    row["vdate"] = norm_date(t)
        for ln in w600:
            y = ln[0]["y"]
            if not (y0 - 6 <= y < y1 + 6):
                continue
            for w in ln:
                x, t = w["x"], w["t"]
                if 1830 <= x < 2100 and MONEY.match(t):
                    v = fnum(t)
                    if v is not None:
                        row["amts"].append({"v": abs(v), "src": "600"})
                elif 2820 <= x < 2965 and MONEY.match(t):
                    v = fnum(t)
                    if v is not None:
                        row["bals"].append(v)
        # dedupe keeping order
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
                        chosen_bal, chosen_amt = b, a["v"]
                        signed = delta if abs(delta) > 0.005 else 0.0
                        src = "chain"
                        done = True
                        break
                if done:
                    break
                if not r["amts"] and 0 < abs(delta) <= 2000:
                    chosen_bal, chosen_amt = b, abs(delta)
                    signed = delta
                    src = "delta-fee"
                    done = True
                    break
            if not done:
                # variants on balances and amounts
                bvars = []
                for b in r["bals"]:
                    bvars.extend(digit_variants(b))
                avars = []
                for a in r["amts"]:
                    avars.extend(digit_variants(a["v"]))
                found = None
                for bv in bvars:
                    delta = round(bv - prev, 2)
                    if abs(delta) > 400000:
                        continue
                    for av in avars:
                        if abs(av - abs(delta)) <= 0.011:
                            found = (bv, av, delta)
                            break
                    if not found and not r["amts"] and 0 < abs(delta) <= 2000:
                        found = (bv, abs(delta), delta)
                        break
                    if found:
                        break
                if found:
                    chosen_bal, chosen_amt, signed = found[0], found[1], found[2]
                    src = "variant"
                elif r["bals"]:
                    chosen_bal = r["bals"][0]
                    delta = round(chosen_bal - prev, 2)
                    if r["amts"]:
                        chosen_amt = r["amts"][0]["v"]
                        signed = delta
                    src = "BREAK-bal"
                    issues.append({"i": i, "page": r["page"], "date": r["date"], "prev": prev,
                                   "bals": r["bals"], "amts": [a["v"] for a in r["amts"]],
                                   "desc": r["desc"][:50]})
                elif r["amts"] and len(r["amts"]) == 1 and r["amts"][0]["v"] <= 300000:
                    chosen_amt = r["amts"][0]["v"]
                    signed = None
                    chosen_bal = None
                    src = "interp"
                else:
                    src = "BREAK-nobal"
                    issues.append({"i": i, "page": r["page"], "date": r["date"], "prev": prev,
                                   "bals": r["bals"], "amts": [a["v"] for a in r["amts"]],
                                   "desc": r["desc"][:50]})
        if chosen_amt is not None and signed is None and chosen_bal is not None:
            signed = None
        events.append({"page": r["page"], "y": r["y"], "date": r["date"], "ref": r["ref"],
                       "desc": r["desc"], "vdate": r["vdate"],
                       "amt": chosen_amt, "signed": signed, "bal": chosen_bal, "src": src})
        if signed is not None and chosen_amt is not None:
            prev = chosen_bal
        elif chosen_bal is not None:
            prev = chosen_bal
    return events, issues


def main():
    rows = []
    for p in range(1, 24):
        rows.extend(page_rows(p))
    print(f"rows: {len(rows)}")
    events, issues = solve(rows)
    srcs = {}
    for e in events:
        srcs[e["src"]] = srcs.get(e["src"], 0) + 1
    print("srcs:", srcs)
    known = [e for e in events if e["signed"] is not None and e["amt"] is not None]
    cre = round(sum(e["signed"] for e in known if e["signed"] > 0), 2)
    deb = round(sum(e["signed"] for e in known if e["signed"] < 0), 2)
    print(f"known signed rows: {len(known)}  credits {cre:,.2f} debits {deb:,.2f} net {round(cre + deb, 2):,.2f}")
    print(f"breaks: {len(issues)}")
    for it in issues[:10]:
        print("  ", it)
    json.dump(events, open(f"{WORK}/events_v5.json", "w"), ensure_ascii=False, indent=1)
    json.dump(issues, open(f"{WORK}/issues_v5.json", "w"), ensure_ascii=False, indent=1)
    print("WROTE events_v5.json / issues_v5.json")


if __name__ == "__main__":
    main()
