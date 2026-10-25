"""Pixel grids drawn over images so that an AI agent can read coordinates off a picture.

The source image is copied onto a larger canvas with margins; light lines every `step` px, darker lines every `major` px,
coordinate labels on all four margins (in SOURCE pixel units, also on zoomed tiles)."""
from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont, ImageOps


def _font(size: int):
    for name in ('DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'Arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def normalise(img: Image.Image, contrast: bool = True) -> Image.Image:
    """RGB copy; optional auto-contrast that keeps light fills readable."""
    im = img.convert('RGB')
    return ImageOps.autocontrast(im, cutoff=1) if contrast else im


def gridded(img: Image.Image, step: int = 50, major: int = 100, origin: tuple[float, float] = (0, 0), scale: float = 1.0,
            margin: int = 46, label_size: int = 13) -> Image.Image:
    """Image with a coordinate grid. `origin` — source pixel of the image's top-left corner, `scale` — output px per source px
    (tiles are crops scaled up); labels show source pixel coordinates."""
    w, h = img.size
    out = Image.new('RGB', (w + 2 * margin, h + 2 * margin), 'white')
    out.paste(img, (margin, margin))
    d = ImageDraw.Draw(out, 'RGBA')
    f = _font(label_size)
    x0, y0 = origin
    sx0, sy0, sx1, sy1 = x0, y0, x0 + w / scale, y0 + h / scale
    first = lambda a: int(-(-a // step) * step)  # noqa: E731 — first grid value ≥ a
    v = first(sx0)
    while v <= sx1:
        X = margin + (v - x0) * scale
        is_major = v % major == 0
        d.line([(X, margin), (X, margin + h)], fill=(220, 30, 30, 120 if is_major else 55), width=1)
        if is_major:
            for yy in (margin - 16, margin + h + 3):
                d.text((X, yy), str(int(v)), fill=(170, 0, 0), font=f, anchor='ma' if yy > margin else 'ma')
        v += step
    v = first(sy0)
    while v <= sy1:
        Y = margin + (v - y0) * scale
        is_major = v % major == 0
        d.line([(margin, Y), (margin + w, Y)], fill=(30, 60, 220, 120 if is_major else 55), width=1)
        if is_major:
            d.text((margin - 4, Y), str(int(v)), fill=(0, 0, 170), font=f, anchor='rm')
            d.text((margin + w + 4, Y), str(int(v)), fill=(0, 0, 170), font=f, anchor='lm')
        v += step
    d.rectangle([margin - 1, margin - 1, margin + w, margin + h], outline=(0, 0, 0, 160))
    return out
