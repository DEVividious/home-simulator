#!/usr/bin/env python3
"""Door swing arcs on a vector PDF sheet → hinge points and leaf directions.

  python3 tools/pdf/door_arcs.py SHEET.pdf --out DIR [--page 1] --scale 50 | --pt-per-m S  [--origin-pt X,Y]

A door is drawn as a quarter circle around the hinge: one end of the arc meets the wall (closed leaf), the other is the open
leaf. Writes DIR/arcs.json with every arc in points and — with a scale — in metres in project coordinates (x right, y up,
origin at --origin-pt, default: the page's bottom-left corner). Which end is the closed leaf depends on the wall; plan.json
only needs the hinge side and the room the door opens into, which the agent reads from these arcs. Reads the PDF with pymupdf or
poppler (hstools.pdfdoc)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hstools import parse_pt, pdfdoc, r3, write_json  # noqa: E402
from hstools.arcs import swing_arcs  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf'); ap.add_argument('--out', required=True); ap.add_argument('--page', type=int, default=1)
    ap.add_argument('--scale', type=float, help='drawing scale 1:N (e.g. 50)'); ap.add_argument('--pt-per-m', type=float)
    ap.add_argument('--origin-pt', help='page point of the project origin (default: bottom-left corner of the page)')
    a = ap.parse_args(argv)
    s = a.pt_per_m or (72 / 0.0254 / a.scale if a.scale else None)
    paths = pdfdoc.paths(a.pdf, a.page)
    size, _ = pdfdoc.words(a.pdf, a.page)
    page_h = size[1] if size else 0.0
    # door leaves 0.6–1.3 m; without a scale assume 1:50 for the search window
    k = s or 72 / 0.0254 / 50
    arcs = swing_arcs(paths, 0.55 * k, 1.35 * k, 0.012 * k)
    ox, oy = parse_pt(a.origin_pt) if a.origin_pt else (0.0, page_h)
    to_m = (lambda p: [r3((p[0] - ox) / s), r3((oy - p[1]) / s)]) if s else None
    out = []
    for i, arc in enumerate(arcs):
        e = dict(id=f'arc{i + 1}', hinge_pt=[round(v, 2) for v in arc['hinge']], end_a_pt=[round(v, 2) for v in arc['a']], end_b_pt=[round(v, 2) for v in arc['b']], radius_pt=round(arc['r'], 2))
        if to_m:
            e.update(hinge_m=to_m(arc['hinge']), end_a_m=to_m(arc['a']), end_b_m=to_m(arc['b']), leaf_m=r3(arc['r'] / s))
        out.append(e)
    write_json(Path(a.out) / 'arcs.json', dict(source=a.pdf, page=a.page, pt_per_m=s, origin_pt=[ox, oy], arcs=out))
    print(f'{a.pdf} p.{a.page}: {len(out)} door swing arcs' + (f' (leaves {min(e["leaf_m"] for e in out):.2f}–{max(e["leaf_m"] for e in out):.2f} m)' if out and s else ''))


if __name__ == '__main__':
    main()
