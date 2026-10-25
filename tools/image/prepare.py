#!/usr/bin/env python3
"""Prepare a raster floor plan for reading by an AI agent.

  python3 tools/image/prepare.py PLAN.png --out projects/<id>/source/prep [--grid 50] [--major 100] [--tiles 2]
         [--zoom 2] [--crop x0,y0,x1,y1] [--rotate 0|90|180|270] [--no-contrast]

Writes
  grid.png        the plan with a labelled pixel grid (labels = SOURCE pixel coordinates, x right, y down)
  tile_<r>_<c>.png  zoomed crops (default 2 × 2, 2× magnification, 10 % overlap), grid labels still in source pixels
  info.json       size, grid, tiles (their source pixel boxes), applied crop / rotation
The original file is not modified. Coordinates read from these images go into plan.json with "units": "px".
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image  # noqa: E402

from hstools import parse_box, write_json  # noqa: E402
from hstools.grid import gridded, normalise  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('image')
    ap.add_argument('--out', required=True)
    ap.add_argument('--grid', type=int, default=50, help='minor grid step [px]')
    ap.add_argument('--major', type=int, default=100, help='labelled grid step [px]')
    ap.add_argument('--tiles', type=int, default=2, help='tiles per side (0 = none)')
    ap.add_argument('--zoom', type=float, default=2.0)
    ap.add_argument('--crop', help='x0,y0,x1,y1 in source pixels (labels keep source coordinates)')
    ap.add_argument('--rotate', type=int, default=0, choices=[0, 90, 180, 270], help='rotate clockwise first (labels then refer to the rotated image)')
    ap.add_argument('--no-contrast', action='store_true')
    a = ap.parse_args(argv)
    src = Image.open(a.image)
    src.load()
    img = normalise(src, contrast=not a.no_contrast)
    if a.rotate:
        img = img.rotate(-a.rotate, expand=True)
    ox, oy = 0, 0
    if a.crop:
        x0, y0, x1, y1 = (int(v) for v in parse_box(a.crop))
        img = img.crop((x0, y0, x1, y1))
        ox, oy = x0, y0
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    W, H = img.size
    gridded(img, a.grid, a.major, origin=(ox, oy)).save(out / 'grid.png')
    tiles = []
    n = max(0, a.tiles)
    if n > 1:
        tw, th = W / n, H / n
        ovx, ovy = tw * 0.1, th * 0.1
        for r in range(n):
            for c in range(n):
                bx0, by0 = max(0, int(c * tw - ovx)), max(0, int(r * th - ovy))
                bx1, by1 = min(W, int((c + 1) * tw + ovx)), min(H, int((r + 1) * th + ovy))
                crop = img.crop((bx0, by0, bx1, by1))
                crop = crop.resize((int(crop.width * a.zoom), int(crop.height * a.zoom)), Image.LANCZOS)
                step = max(10, int(a.grid / 2))
                name = f'tile_{r}_{c}.png'
                gridded(crop, step, a.grid, origin=(ox + bx0, oy + by0), scale=a.zoom).save(out / name)
                tiles.append(dict(file=name, box_px=[ox + bx0, oy + by0, ox + bx1, oy + by1]))
    info = dict(source=str(a.image), size_px=[src.width, src.height], rotated=a.rotate, crop=[ox, oy, ox + W, oy + H] if a.crop else None,
                grid=dict(step=a.grid, major=a.major), tiles=tiles, note='labels are source pixel coordinates: x right, y down')
    write_json(out / 'info.json', info)
    print(f'{a.image}: {src.width} × {src.height} px → {out}/grid.png' + (f' + {len(tiles)} tiles' if tiles else ''))


if __name__ == '__main__':
    main()
