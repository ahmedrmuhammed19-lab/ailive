#!/usr/bin/env python3
"""Dump word geometry of a page: group into lines, show x-positions."""
import json
import sys

WORK = "/home/z/my-project/scripts/alahly_work"
pno = int(sys.argv[1]) if len(sys.argv) > 1 else 2
d = json.load(open(f"{WORK}/page_{pno:02d}.json"))

# group words into lines by y-center
words = sorted(d["words"], key=lambda w: (w["y"] + w["h"] / 2, w["x"]))
lines = []
cur, cur_y = [], None
for w in words:
    yc = w["y"] + w["h"] / 2
    if cur_y is None or abs(yc - cur_y) <= 14:
        cur.append(w)
        cur_y = yc if cur_y is None else (cur_y * (len(cur) - 1) + yc) / len(cur)
    else:
        lines.append(cur)
        cur, cur_y = [w], yc

for ln in lines:
    ln.sort(key=lambda w: w["x"])
    ys = ln[0]["y"]
    parts = " ".join(f"{w['t']}@{w['x']}" for w in ln)
    print(f"y={ys:5d} | {parts[:200]}")
