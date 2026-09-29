#!/usr/bin/env python3
"""
Build SCANNED bank-statement fixtures for the OCR/scan path campaign.

Renders the known-good B-family statement text (statement_green_B.txt) as
 IMAGES and wraps them into image-only PDFs (DCTDecode JPEG XObjects — the
 exact shape the engine's byte-level extractor handles, and the only codec
 available on Vercel serverless where PDF_RASTER=1/poppler is absent):

  statement_scan_clean.pdf       crisp render, JPEG q88  — the happy scan
  statement_scan_degraded.pdf    gray + noise + 0.8deg skew + blur + stamp
                                 + watermark + JPEG q55 — a realistic
                                 phone/CamScanner capture
  statement_scan_multi.pdf       2-page scan (header page + continuation)
  statement_scan_page.jpg        direct photo upload variant

All land in tests/e2e_fixtures/ next to the digital fixtures.
"""

import os

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as rl_canvas

ROOT = "/home/z/my-project"
FX = os.path.join(ROOT, "tests", "e2e_fixtures")
SRC = os.path.join(FX, "statement_green_B.txt")
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

PAGE_W, PAGE_H = 1240, 1754  # A4 @ 150dpi
MARGIN_X, TOP_Y, LINE_H = 110, 150, 58

try:
    import numpy as np
except ImportError:
    np = None


def render_lines(lines, out_png, stamp_on=None, watermark=False):
    img = Image.new("RGB", (PAGE_W, PAGE_H), (252, 252, 250))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, 30)
    font_bold = ImageFont.truetype(FONT_PATH, 34)
    y = TOP_Y
    for i, line in enumerate(lines):
        f = font_bold if i < 4 else font
        draw.text((MARGIN_X, y), line.rstrip(), font=f, fill=(15, 15, 18))
        y += LINE_H
    if stamp_on is not None:
        # semi-transparent bank-style stamp across a transaction row
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        sx, sy = MARGIN_X + 40, stamp_on
        od.ellipse([sx, sy, sx + 460, sy + 150], outline=(190, 45, 45, 150), width=7)
        od.text((sx + 60, sy + 48), "CIB BRANCH", font=font_bold, fill=(190, 45, 45, 140))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    if watermark:
        wm = Image.new("RGBA", img.size, (0, 0, 0, 0))
        wd = ImageDraw.Draw(wm)
        big = ImageFont.truetype(FONT_PATH, 110)
        txt = Image.new("RGBA", (1400, 260), (0, 0, 0, 0))
        td = ImageDraw.Draw(txt)
        td.text((10, 60), "SPECIMEN", font=big, fill=(120, 140, 190, 46))
        txt = txt.rotate(30, expand=True)
        wm.alpha_composite(txt, (-100, 500))
        wm.alpha_composite(txt, (200, 1050))
        img = Image.alpha_composite(img.convert("RGBA"), wm).convert("RGB")
    img.save(out_png)
    return img


def degrade(img):
    out = img.convert("L")  # grayish photocopy feel
    if np is not None:
        arr = np.asarray(out).astype("int16")
        noise = np.random.default_rng(42).integers(-14, 15, arr.shape, dtype="int16")
        arr = np.clip(arr + noise, 0, 255).astype("uint8")
        out = Image.fromarray(arr, "L")
    out = out.rotate(0.8, resample=Image.BICUBIC, expand=False, fillcolor=250)
    out = out.filter(ImageFilter.GaussianBlur(0.7))
    out = ImageEnhance.Contrast(out).enhance(0.88)
    return out.convert("RGB")


def wrap_pdf(img_path, out_pdf):
    """Embed as raw DCTDecode (JPEG) — mirrors what scanners emit. PNG inputs are
    re-saved as JPEG first because reportlab embeds PNGs as FlateDecode, which
    the engine's byte-level extractor historically couldn't read. useA85=0 is
    set globally in main() so reportlab emits binary DCT streams."""
    if img_path.lower().endswith(".png"):
        jpg_path = img_path[:-4] + "_wrap.jpg"
        Image.open(img_path).save(jpg_path, quality=85)
        img_path = jpg_path
    c = rl_canvas.Canvas(out_pdf, pagesize=A4)
    c.drawImage(img_path, 0, 0, width=A4[0], height=A4[1])
    c.showPage()
    c.save()


def wrap_pdf_ascii85(jpg_path, out_pdf):
    """Embed with reportlab DEFAULT filters (ASCII85 armor + DCTDecode) — the
    writer style that broke the original extractor (eslam's bug class)."""
    from reportlab import rl_config

    rl_config.useA85 = 1
    c = rl_canvas.Canvas(out_pdf, pagesize=A4)
    c.drawImage(jpg_path, 0, 0, width=A4[0], height=A4[1])
    c.showPage()
    c.save()
    rl_config.useA85 = 0


def hand_pdf_flate(out_pdf, png_path, predictor):
    """Hand-rolled single-page PDF whose page image is a raw FlateDecode RGB
    bitmap (predictor=None) or a Flate+PNG-predictor-15 bitmap — the two
    scanner/writer codecs the byte-level extractor historically missed."""
    import io
    import zlib

    W, H = PAGE_W, PAGE_H
    px = Image.open(png_path).convert("RGB")
    if px.size != (W, H):
        px = px.resize((W, H))
    raw = px.tobytes()
    row = W * 3
    if predictor == 15:
        # PNG-style filtered scanlines: filter byte 0 (None) per row
        buf = bytearray()
        for y in range(H):
            buf.append(0)
            buf += raw[y * row : (y + 1) * row]
        data = zlib.compress(bytes(buf), 6)
        parms = f"/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns {W} /Rows {H} >> "
    else:
        data = zlib.compress(raw, 6)
        parms = ""
    content = f"q {W} 0 0 {H} 0 0 cm /Im0 Do Q".encode()

    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "
        + str(W).encode()
        + b" 0 "
        + str(H).encode()
        + b"] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>"
    )
    objs.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
    objs.append(
        (
            f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceRGB "
            f"/BitsPerComponent 8 {parms}/Filter /FlateDecode /Length {len(data)} >>\nstream\n"
        ).encode()
        + data
        + b"\nendstream"
    )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    )
    with open(out_pdf, "wb") as f:
        f.write(bytes(out))


def main():
    from reportlab import rl_config

    rl_config.useA85 = 0  # raw binary DCTDecode streams (scanner-style)
    os.makedirs(FX, exist_ok=True)
    lines = [ln for ln in open(SRC).read().splitlines() if ln.strip()]
    print(f"source rows: {len(lines)}")

    # --- clean single-page ---
    png_clean = os.path.join(FX, "_scan_clean.png")
    render_lines(lines, png_clean)
    jpg_clean = os.path.join(FX, "_scan_clean.jpg")
    Image.open(png_clean).save(jpg_clean, quality=85)
    wrap_pdf(jpg_clean, os.path.join(FX, "statement_scan_clean.pdf"))
    print("clean (raw DCT): statement_scan_clean.pdf")

    # --- ascii85-armored DCT (reportlab default style — eslam's bug class) ---
    wrap_pdf_ascii85(jpg_clean, os.path.join(FX, "statement_scan_ascii85.pdf"))
    print("ascii85 (armored DCT): statement_scan_ascii85.pdf")

    # --- flate raw bitmap (no predictor) ---
    hand_pdf_flate(os.path.join(FX, "statement_scan_flate.pdf"), png_clean, predictor=None)
    print("flate (raw RGB): statement_scan_flate.pdf")

    # --- flate + PNG predictor 15 ---
    hand_pdf_flate(os.path.join(FX, "statement_scan_flatepng.pdf"), png_clean, predictor=15)
    print("flate+predictor: statement_scan_flatepng.pdf")

    # --- degraded single-page (stamp over row ~7, watermark) ---
    png_deg = os.path.join(FX, "_scan_deg.png")
    deg = render_lines(lines, png_deg, stamp_on=TOP_Y + 7 * LINE_H - 20, watermark=True)
    deg = degrade(deg)
    jpg_deg = os.path.join(FX, "_scan_deg.jpg")
    deg.save(jpg_deg, quality=55)
    wrap_pdf(jpg_deg, os.path.join(FX, "statement_scan_degraded.pdf"))
    print("degraded (raw DCT): statement_scan_degraded.pdf")

    # --- 2-page scan: header page (first 8 rows) + continuation (rest) ---
    split = 8
    png_p1 = os.path.join(FX, "_scan_p1.png")
    render_lines(lines[:split], png_p1)
    png_p2 = os.path.join(FX, "_scan_p2.png")
    render_lines(lines[split:], png_p2)
    jpg_p1 = os.path.join(FX, "_scan_p1.jpg")
    jpg_p2 = os.path.join(FX, "_scan_p2.jpg")
    Image.open(png_p1).save(jpg_p1, quality=85)
    Image.open(png_p2).save(jpg_p2, quality=85)
    c = rl_canvas.Canvas(os.path.join(FX, "statement_scan_multi.pdf"), pagesize=A4)
    for p in (jpg_p1, jpg_p2):
        c.drawImage(p, 0, 0, width=A4[0], height=A4[1])
        c.showPage()
    c.save()
    print("multi (2p raw DCT): statement_scan_multi.pdf")

    # --- direct photo (clean page as JPEG upload) ---
    jpg_photo = os.path.join(FX, "statement_scan_page.jpg")
    Image.open(png_clean).save(jpg_photo, quality=85)
    print("photo: statement_scan_page.jpg")

    for f in (
        "statement_scan_clean.pdf",
        "statement_scan_ascii85.pdf",
        "statement_scan_flate.pdf",
        "statement_scan_flatepng.pdf",
        "statement_scan_degraded.pdf",
        "statement_scan_multi.pdf",
        "statement_scan_page.jpg",
    ):
        p = os.path.join(FX, f)
        print(f"  {f}: {os.path.getsize(p)} bytes")


if __name__ == "__main__":
    main()
