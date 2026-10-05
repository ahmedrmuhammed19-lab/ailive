#!/usr/bin/env python3
"""Duplicate search: are the 13 interp rows second captures of rows already
in the ledger? Match on date + amount + ref/desc overlap."""
import json
import re

WORK = "/home/z/my-project/scripts/alahly_work"
d = json.load(open(f"{WORK}/report_data.json"))
rows = d["rows"]
interp = [r for r in rows if r.get("signed") is None and r["src"] == "interp"]
others = [r for r in rows if r not in interp]

print(f"interp rows: {len(interp)}, others: {len(others)}\n")

def ref_of(desc):
    m = re.search(r"([0-9A-F]{8,}|[0-9A-F]{16,})", (desc or "").upper())
    return m.group(1) if m else None

for p in interp:
    ref = ref_of(p["desc"])
    hits = []
    for o in others:
        if o["page"] == p["page"] and abs((o["y"] or 0) - (p["y"] or 0)) < 120:
            hits.append(("NEARBY", o))
            continue
        if p["date"] and o["date"] == p["date"] and p["amt"] and \
           o["amt"] and abs(o["amt"] - p["amt"]) < 0.011:
            oref = ref_of(o["desc"])
            tag = "DATE+AMT" + ("+REF" if ref and oref and (ref in oref or oref in ref) else "")
            hits.append((tag, o))
    print(f"p{p['page']} y{p['y']} [{p['date']}] amt={p['amt']} ref={ref}")
    print(f"   desc: {(p['desc'] or '')[:75]}")
    if hits:
        for tag, o in hits:
            print(f"   -> {tag}: p{o['page']} y{o['y']} [{o['date']}] amt={o['amt']} signed={o.get('signed')} bal={o['bal']}")
            print(f"      desc: {(o['desc'] or '')[:75]}")
    else:
        print("   -> NO MATCH (unique row?)")
    print()
