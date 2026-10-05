#!/usr/bin/env python3
"""NBE parser v4 — balance-anchored rows + two-pass consensus + chain solver.

Every printed table row shows a running balance at x~2530-3220. Rows anchor on
balance tokens (450+600 merged, y-clustered); date/ref/desc/amount merged from
the y-span between consecutive anchors. Chain solver resolves signs, recovers
missing amounts from deltas, and interpolates missing balances.
"""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
DATE = re.compile(r"^\d{2}/\d{2}/[0-9OQ]{4}$")
CONF = [("4", "9"), ("0", "5"), ("1", "7"), ("3", "8"), ("5", "6"), ("2", "9")]


def fnum(s):
    s = s.replace(",", "").rstrip(".")
    if re.fullmatch(r"-?\d+(\.\d{1,2})?", s):
        return float(s)
    return None


def norm_date(s):
    if not s:
        return None
    m = re.match(r"^(\d{2})/(\d{2})/([0-9OQ]{4})$", s)
    if not m:
        return None
    y = m.group(3).replace("O", "0").replace("Q", "0")
    if y == "2016":
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


def page_rows(pno):
    d450 = json.load(open(f"{WORK}/page_{pno:02d}.json"))
    d600 = json.load(open(f"{WORK}/p600_{pno:02d}.json"))
    lines = group_lines(d450["words"])
    w600 = group_lines(d600["words"])

    # 1) balance-token anchors from both passes
    anchors = []  # (y, bal_value, src)
    for ln in lines:
        for w in ln:
            if 2530 <= w["x"] < 3220:
                v = fnum(w["t"])
                if v is not None:
                    anchors.append({"y": ln[0]["y"], "y_w": w["y"], "bal": v, "src": "450"})
    for ln in w600:
        for w in ln:
            if 2530 <= w["x"] < 3230:
                v = fnum(w["t"])
                if v is not None:
                    anchors.append({"y": w["y"], "y_w": w["y"], "bal": v, "src": "600"})
    # cluster anchors by y (within 25px)
    anchors.sort(key=lambda a: a["y"])
    clusters = []
    for a in anchors:
        if clusters and abs(a["y"] - clusters[-1][-1]["y"]) <= 25:
            clusters[-1].append(a)
        else:
            clusters.append([a])
    rowmarks = []
    for cl in clusters:
        ymid = sum(a["y"] for a in cl) / len(cl)
        vals = {round(a["bal"], 2) for a in cl}
        rowmarks.append({"y": ymid, "bals": sorted(vals)})

    # 2) merge tokens between consecutive rowmarks
    all_marks = sorted(rowmarks, key=lambda r: r["y"])
    rows = []
    for i, rm in enumerate(all_marks):
        y0 = (all_marks[i - 1]["y"] + all_marks[i]["y"]) / 2 if i else -1
        y1 = (all_marks[i]["y"] + all_marks[i + 1]["y"]) / 2 if i + 1 < len(all_marks) else 10 ** 9
        row = {"page": pno, "y": rm["y"], "date": None, "ref": "", "desc": "",
               "amts": [], "bals": rm["bals"], "vdate": None}
        for ln in lines:
            y = ln[0]["y"]
            if not (y0 <= y < y1):
                continue
            for w in ln:
                x, t = w["x"], w["t"]
                nd = norm_date(t)
                if x < 601 and nd and not row["date"]:
                    row["date"] = nd
                elif 601 <= x < 1070 and not row["ref"]:
                    row["ref"] = t
                elif 1070 <= x < 1781:
                    if t not in row["desc"]:
                        row["desc"] = (row["desc"] + " " + t).strip()
                elif 1781 <= x < 2530:
                    v = fnum(t)
                    if v is not None:
                        row["amts"].append({"v": v, "src": "450", "credit_band": x >= 2248})
                elif x >= 3220 and norm_date(t):
                    row["vdate"] = norm_date(t)
        for ln in w600:
            y = ln[0]["y"]
            if not (y0 - 5 <= y < y1 + 5):
                continue
            for w in ln:
                x, t = w["x"], w["t"]
                v = fnum(t)
                if v is None:
                    continue
                if 1781 <= x < 2530:
                    row["amts"].append({"v": v, "src": "600", "credit_band": x >= 2248})
        # dedupe amts
        seen = set()
        dd = []
        for a in row["amts"]:
            k = (a["v"], a["credit_band"])
            if k not in seen:
                seen.add(k)
                dd.append(a)
        row["amts"] = dd
        if row["date"] or row["ref"] or row["desc"] or row["amts"]:
            rows.append(row)
    return rows


def amt_variants(v):
    vs = {abs(v)}
    s = f"{abs(v):,.2f}"
    for a, b in CONF:
        for i, ch in enumerate(s):
            if ch == a:
                vs.add(fnum_or(s[:i] + b + s[i + 1:]))
            elif ch == b:
                vs.add(fnum_or(s[:i] + a + s[i + 1:]))
    return {round(x, 2) for x in vs if x is not None}


def fnum_or(s):
    s = s.replace(",", "")
    return float(s) if re.fullmatch(r"-?\d+(\.\d{1,2})?", s) else None


def solve(rows):
    events, prev, issues = [], None, []
    for i, r in enumerate(rows):
        bals = r["bals"]
        amts = r["amts"]
        chosen_bal, chosen_amt, src = None, None, None
        if prev is None:
            chosen_bal = bals[0] if bals else None
            src = "first"
        else:
            ok = False
            # 1) direct: some bal chains with prev, some amount matches delta
            for b in bals:
                delta = round(b - prev, 2)
                for a in amts:
                    if abs(abs(a["v"]) - abs(delta)) <= 0.011:
                        chosen_bal, chosen_amt = b, a
                        chosen_amt = dict(a)
                        chosen_amt["signed"] = round(delta, 2) if abs(delta) > 0.005 else 0.0
                        src = "chain"
                        ok = True
                        break
                if ok:
                    break
                if abs(delta) <= 20000 and not amts:
                    chosen_bal = b
                    chosen_amt = {"v": abs(delta), "src": "450", "credit_band": delta > 0,
                                  "signed": round(delta, 2)}
                    src = "delta-recovered"
                    ok = True
                    break
            # 2) variant search on balances and amounts
            if not ok:
                avars = []
                for a in amts:
                    for m in amt_variants(a["v"]):
                        avars.append({**a, "mag": m})
                found = None
                for b in bals:
                    for bv in {v for v in bals} | {round(x, 2) for x in
                                                   [fnum_or(s) for s in
                                                    [alt for v in bals for alt in
                                                     [f"{v:,.2f}".replace(",", "")] ] ] }:
                        pass
                # digit variants of balance strings
                bvars = []
                for b in bals:
                    s = f"{b:,.2f}"
                    vs = {s, s.replace(",", "")}
                    for a, c in CONF:
                        for j, ch in enumerate(s):
                            if ch == a:
                                vs.add(s[:j] + c + s[j + 1:])
                            elif ch == c:
                                vs.add(s[:j] + a + s[j + 1:])
                    for x in vs:
                        fv = fnum_or(x)
                        if fv is not None:
                            bvars.append(fv)
                for bv in bvars:
                    delta = round(bv - prev, 2)
                    if abs(delta) > 400000:
                        continue
                    if not amts and abs(delta) <= 20000:
                        found = (bv, {"v": abs(delta), "signed": round(delta, 2),
                                      "credit_band": delta > 0, "src": "var"})
                        break
                    for a in avars:
                        if abs(abs(a["mag"]) - abs(delta)) <= 0.011:
                            aa = dict(a)
                            aa["signed"] = round(delta, 2) if abs(delta) > 0.005 else 0.0
                            found = (bv, aa)
                            break
                    if found:
                        break
                if found:
                    chosen_bal, chosen_amt = found
                    src = "variant"
            if chosen_bal is None:
                # no balance at all: interpolate from amount if plausible
                if amts and len(amts) == 1 and abs(amts[0]["v"]) <= 20000:
                    signed = amts[0]["signed"] if "signed" in amts[0] else None
                    if signed is None:
                        signed = -amts[0]["v"] if not amts[0]["credit_band"] else amts[0]["v"]
                    chosen_amt = {**amts[0], "signed": round(signed, 2)}
                    chosen_bal = round(prev + signed, 2)
                    src = "interp"
                else:
                    src = "BREAK"
                    issues.append({"i": i, "page": r["page"], "prev": prev,
                                   "bals": bals, "amts": [a["v"] for a in amts],
                                   "desc": r["desc"][:60]})
        events.append({"page": r["page"], "date": r["date"], "ref": r["ref"],
                       "desc": r["desc"], "vdate": r["vdate"],
                       "bal": chosen_bal,
                       "amt": chosen_amt["signed"] if chosen_amt and "signed" in chosen_amt else (chosen_amt["v"] if chosen_amt else None),
                       "src": src})
        if chosen_bal is not None:
            prev = chosen_bal
    return events, issues


def main():
    rows = []
    for p in range(1, 24):
        pr = page_rows(p)
        rows.extend(pr)
    print(f"TOTAL balance-anchored rows: {len(rows)}")
    events, issues = solve(rows)
    print(f"BREAKS: {len(issues)}")
    srcs = {}
    for e in events:
        srcs[e["src"]] = srcs.get(e["src"], 0) + 1
    print("srcs:", srcs)
    cre = round(sum(e["amt"] for e in events if e["amt"] and e["amt"] > 0), 2)
    deb = round(sum(e["amt"] for e in events if e["amt"] and e["amt"] < 0), 2)
    print(f"credits {cre:,.2f} debits {deb:,.2f} net {round(cre + deb, 2):,.2f}")
    if events:
        f, l = events[0], events[-1]
        print("first:", f["date"], f["bal"], "| last:", l["date"], l["bal"], "page", l["page"])
    for it in issues[:12]:
        print("  BREAK:", it)
    json.dump(events, open(f"{WORK}/events_v4.json", "w"), ensure_ascii=False, indent=1)
    json.dump(issues, open(f"{WORK}/issues_v4.json", "w"), ensure_ascii=False, indent=1)
    print("WROTE events_v4.json / issues_v4.json")


if __name__ == "__main__":
    main()
