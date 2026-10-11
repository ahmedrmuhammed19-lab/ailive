#!/usr/bin/env python3
"""Detect table row boundaries via horizontal grid lines, crop single cells."""
from PIL import Image
import numpy as np
import sys

def rows_of(page_png, x_probe=1200, y0=700, y1=3200, thresh=120, minrun=3):
    im = Image.open(page_png).convert('L')
    a = np.array(im)
    col = a[y0:y1, x_probe-4:x_probe+4].mean(axis=1)
    dark = col < thresh
    ys = []
    i = 0
    while i < len(dark):
        if dark[i]:
            j = i
            while j < len(dark) and dark[j]:
                j += 1
            if j - i >= minrun:
                ys.append(y0 + (i + j) // 2)
            i = j
        else:
            i += 1
    return ys

def zoom(page_png, box, out, scale=3):
    im = Image.open(page_png)
    c = im.crop(box)
    c = c.resize((c.width * scale, c.height * scale), Image.LANCZOS)
    c.save(out)
    print(out, c.size)

if __name__ == '__main__':
    page = sys.argv[1]
    png = f'pages/pg-{page}.png'
    ys = rows_of(png)
    print('lines:', ys)
    print('n_rows:', len(ys) - 1)
