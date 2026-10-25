#!/usr/bin/env python3
"""Vector content of a PDF sheet: every path in page points, plus a gridded preview image for the agent.

  python3 tools/pdf/sheet_svg.py SHEET.pdf --out DIR [--page 1] [--dpi 100]

Writes DIR/paths.json ({stroke, fill, width, curved, subs}), DIR/sheet.svg, DIR/sheet.png and DIR/sheet_grid.png (grid
labels in PDF points, x right, y down). Thick filled polygons are usually wall poché; thin open polylines are furniture, hatches
and dimension lines; quarter arcs are door swings (tools/pdf/door_arcs.py)."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image  # noqa: E402

from hstools import write_json  # noqa: E402
from hstools.arcs import load_svg_paths  # noqa: E402
from hstools.grid import gridded  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf'); ap.add_argument('--out', required=True); ap.add_argument('--page', type=int, default=1); ap.add_argument('--dpi', type=int, default=100)
    a = ap.parse_args(argv)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    svg = out / 'sheet.svg'
    subprocess.run(['pdftocairo', '-svg', '-f', str(a.page), '-l', str(a.page), a.pdf, str(svg)], check=True)
    paths = load_svg_paths(svg)
    write_json(out / 'paths.json', dict(source=a.pdf, page=a.page, units='pt', paths=[dict(p, subs=[[[round(x, 2), round(y, 2)] for x, y in s] for s in p['subs']]) for p in paths]))
    subprocess.run(['pdftoppm', '-f', str(a.page), '-l', str(a.page), '-r', str(a.dpi), '-png', '-singlefile', a.pdf, str(out / 'sheet')], check=True)
    img = Image.open(out / 'sheet.png')
    k = a.dpi / 72  # px per pt
    gridded(img, step=50, major=100, scale=k).save(out / 'sheet_grid.png')
    print(f'{a.pdf} p.{a.page}: {len(paths)} paths ({sum(1 for p in paths if p["curved"])} with curves) → {out}/paths.json, sheet_grid.png (labels in pt)')


if __name__ == '__main__':
    main()
