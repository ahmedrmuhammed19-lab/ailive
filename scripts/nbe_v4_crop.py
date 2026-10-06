#!/usr/bin/env python3
"""NBE v4 STAGE 3b — VISUAL EVIDENCE CROPS for the residual zones.

Runs nbe_v4_extract.py per needed page (cached band geometry, EXACT same
rules_of logic as the pipeline), maps walk-row band idx -> y-range, and renders
high-dpi full-width crops of each zone with fitz clip rendering.

Output: scripts/alahly_work/adj3/<tag>.png  (600dpi grayscale band crops)
"""
import json, os, subprocess, sys
import fitz

ST = "/home/z/my-project/scripts/alahly_work_state"
WORK = "/home/z/my-project/scripts/alahly_work"
OUT = f"{WORK}/adj3"
PATH = "/home/z/my-project/upload/nbe_eid_farag.pdf"
os.makedirs(OUT, exist_ok=True)

PAGES = [4, 5, 7, 8, 9, 10, 15, 17, 22]

# (tag, page, i_lo, i_hi, extra_bands_above, extra_bands_below)
SPECS = [
    ("p4_s57_s67",   4, 56, 65, 0, 0),
    ("p5_s80_s88",   5, 78, 84, 0, 0),
    ("p7_s127_s136", 7, 122, 128, 0, 0),
    ("p7_s146_s149", 7, 137, 140, 1, 0),
    ("p8_s149_s156", 8, 140, 145, 0, 0),
    ("p8_s164_s168", 8, 153, 157, 0, 0),
    ("p9_s170_s178", 9, 159, 168, 0, 0),
    ("p10_s196_s200", 10, 185, 189, 0, 0),
    ("p15_s296_s301", 15, 275, 284, 0, 0),
    ("p17_s337_s343", 17, 316, 320, 0, 0),
]

def run_extract():
    for p in PAGES:
        out = f"{WORK}/v4_bands_p{p:02d}.json"
        if os.path.exists(out):
            print(f"extract p{p}: cached")
            continue
        print(f"extract p{p}: running...", flush=True)
        r = subprocess.run([sys.executable, "/home/z/my-project/scripts/nbe_v4_extract.py",
                            str(p), str(p)], capture_output=True, text=True)
        if not os.path.exists(out):
            print(r.stdout[-2000:]); print(r.stderr[-2000:])
            raise SystemExit(f"extract failed for page {p}")

def main():
    run_extract()
    walk = json.load(open(f"{ST}/v4_solved.json"))
    by_i = {r["i"]: r for r in walk}
    doc = fitz.open(PATH)
    made = []
    for tag, page, i_lo, i_hi, up, dn in SPECS:
        bands = json.load(open(f"{WORK}/v4_bands_p{page:02d}.json"))["bands"]
        bmap = {b["idx"]: b for b in bands}
        idxs = [by_i[i]["band"] for i in range(i_lo, i_hi + 1)
                if i in by_i and by_i[i]["page"] == page and by_i[i].get("band") is not None]
        if not idxs:
            print(f"{tag}: no bands found, skip"); continue
        lo, hi = min(idxs) - up, max(idxs) + dn
        y0 = min(bmap[b]["y0_150"] for b in (lo,) if b in bmap) if lo in bmap else None
        y1 = max(bmap[b]["y1_150"] for b in (hi,) if b in bmap) if hi in bmap else None
        # fall back to full span of the involved bands
        ys0 = [bmap[b]["y0_150"] for b in range(lo, hi + 1) if b in bmap]
        ys1 = [bmap[b]["y1_150"] for b in range(lo, hi + 1) if b in bmap]
        y0, y1 = min(ys0), max(ys1)
        page_h_150 = doc[page - 1].rect.height * 150 / 72
        y0c = max(0, y0 - 6) * 72 / 150
        y1c = min(page_h_150, y1 + 6) * 72 / 150
        clip = fitz.Rect(0, y0c, doc[page - 1].rect.width, y1c)
        pm = doc[page - 1].get_pixmap(dpi=600, colorspace=fitz.csGRAY, clip=clip)
        fp = f"{OUT}/{tag}.png"
        pm.save(fp)
        rows = [(i, by_i[i].get("serial"), by_i[i].get("balance")) for i in range(i_lo, i_hi + 1)
                if i in by_i and by_i[i]["page"] == page]
        print(f"{tag}: bands {lo}..{hi} y[{y0:.0f}..{y1:.0f}]150 -> {fp} "
              f"({pm.width}x{pm.height}) rows={rows}")
        made.append(fp)

    # p22 top: bands 0 .. band(i=410)+1  (s441..s448 absorbed zone)
    bands22 = json.load(open(f"{WORK}/v4_bands_p22.json"))["bands"]
    bmap = {b["idx"]: b for b in bands22}
    b410 = by_i[410]["band"]
    ys0 = [bmap[b]["y0_150"] for b in range(0, b410 + 1) if b in bmap]
    ys1 = [bmap[b]["y1_150"] for b in range(0, b410 + 1) if b in bmap]
    y0, y1 = min(ys0), max(ys1)
    clip = fitz.Rect(0, max(0, y0 - 6) * 72 / 150, doc[21].rect.width,
                     min(doc[21].rect.height, (y1 + 6) * 72 / 150))
    pm = doc[21].get_pixmap(dpi=600, colorspace=fitz.csGRAY, clip=clip)
    fp = f"{OUT}/p22_top_s441_s449.png"
    pm.save(fp)
    print(f"p22_top_s441_s449: bands 0..{b410} y[{y0:.0f}..{y1:.0f}]150 -> {fp} ({pm.width}x{pm.height})")

if __name__ == "__main__":
    main()
