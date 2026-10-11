#!/usr/bin/env python3
"""Crop high-res row bands from 300-DPI page renders for forensic verification."""
from PIL import Image
import os

W = '/home/z/my-project/scripts/gehad_work'
P = W + '/pages'
OUT = W + '/crops'
os.makedirs(OUT, exist_ok=True)


def bands(page, regions, tag):
    im = Image.open(f'{P}/pg-{page:02d}.png')
    w, h = im.size
    print(f'pg{page:02d}: {w}x{h}')
    for i, (y0, y1) in enumerate(regions):
        crop = im.crop((0, max(0, y0), w, min(h, y1)))
        crop.save(f'{OUT}/{tag}_p{page:02d}_band{i}.png')
        print(f'  band{i}: y {y0}-{y1} -> {crop.size}')


# Page 8: 23 rows, table approx y 700-3050 -> 3 overlapping bands
bands(8, [(620, 1560), (1500, 2360), (2300, 3120)], 'band')
# Page 12: same layout
bands(12, [(620, 1560), (1500, 2360), (2300, 3120)], 'band')
# Page 4: deposit pair rows 7-10 (y~1350-1750) + Fal row 21-23 (y~2650-3050)
bands(4, [(1250, 1800), (2600, 3120)], 'zone')
# Page 5: POS row 91 region (row ~16-19 of page, y~2250-2700)
bands(5, [(2200, 2750)], 'zone')
print('done')
