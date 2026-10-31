#!/usr/bin/env python3
"""One page of a PDF as a PNG — a scanned or raster sheet goes on through the raster branch (tools/image/prepare.py).

  python3 tools/pdf/render.py SHEET.pdf --out PAGE.png [--page 1] [--dpi 200]

Reads the PDF with pymupdf or poppler (hstools.pdfdoc). 200 dpi keeps 1 cm of an A3 sheet at ~80 px: enough for walls and
dimension texts; go higher for small print."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image  # noqa: E402

from hstools import pdfdoc  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf'); ap.add_argument('--out', required=True); ap.add_argument('--page', type=int, default=1); ap.add_argument('--dpi', type=int, default=200)
    a = ap.parse_args(argv)
    n = pdfdoc.page_count(a.pdf)
    if not 1 <= a.page <= n:
        raise SystemExit(f'{a.pdf} has {n} page(s); --page {a.page} is not one of them')
    out = pdfdoc.render(a.pdf, a.page, a.dpi, a.out)
    with Image.open(out) as im:
        print(f'{a.pdf} p.{a.page}/{n} at {a.dpi} dpi → {out} ({im.size[0]} × {im.size[1]} px)')


if __name__ == '__main__':
    main()
