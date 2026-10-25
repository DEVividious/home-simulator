#!/usr/bin/env python3
"""Overview of a DXF drawing for choosing the layers that hold walls, doors, windows, texts and dimensions.

  python3 tools/cad/dxf_inspect.py DRAWING.dxf --out DIR [--layers-png 40] [--box x0,y0,x1,y1]

Writes
  DIR/layers.json  every layer: entity counts by type, extents (drawing units), colour; header units ($INSUNITS) and a unit
                   guess from the size of the drawing (a building is 5–40 m: extents in the thousands → mm, hundreds → cm)
  DIR/texts.json   TEXT / MTEXT with positions (room names, areas, door / window tags)
  DIR/all.png      all layers with a labelled grid in drawing units (y up as in the drawing; labels show drawing coordinates)
  DIR/layer_<n>.png one image per layer with geometry (largest first, at most --layers-png)
Model space only; blocks (INSERT) are exploded. --box limits everything to a part of the model (several plans on one sheet)."""
from __future__ import annotations

import argparse
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ezdxf  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from hstools import parse_box, write_json  # noqa: E402
from hstools.grid import gridded  # noqa: E402

UNITS = {0: 'unitless', 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm'}


def geometry(e):
    """polylines of an entity in drawing units (arcs sampled)"""
    t = e.dxftype()
    try:
        if t == 'LINE':
            return [[(e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y)]]
        if t == 'LWPOLYLINE':
            pts = [tuple(p[:2]) for p in e.get_points('xy')]
            return [pts + ([pts[0]] if e.closed else [])]
        if t == 'POLYLINE':
            pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
            return [pts + ([pts[0]] if e.is_closed else [])]
        if t in ('ARC', 'CIRCLE'):
            c, r = e.dxf.center, e.dxf.radius
            a0, a1 = (math.radians(e.dxf.start_angle), math.radians(e.dxf.end_angle)) if t == 'ARC' else (0, 2 * math.pi)
            if a1 < a0:
                a1 += 2 * math.pi
            n = max(6, int((a1 - a0) / 0.15))
            return [[(c.x + r * math.cos(a0 + (a1 - a0) * i / n), c.y + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]]
    except Exception:  # noqa: BLE001 — malformed entity
        return []
    return []


def entities(doc):
    """model space entities with INSERTs exploded (layer of nested entities kept, '0' inherits the insert layer)"""
    for e in doc.modelspace():
        if e.dxftype() == 'INSERT':
            try:
                for v in e.virtual_entities():
                    if v.dxf.layer == '0':
                        v.dxf.layer = e.dxf.layer
                    yield v
            except Exception:  # noqa: BLE001
                continue
        else:
            yield e


def render(polys, box, px=1600, colour=(0, 0, 0)):
    x0, y0, x1, y1 = box
    w, h = max(x1 - x0, 1e-9), max(y1 - y0, 1e-9)
    k = px / max(w, h)
    img = Image.new('RGB', (int(w * k) + 1, int(h * k) + 1), 'white')
    d = ImageDraw.Draw(img)
    for pl in polys:
        pts = [((x - x0) * k, (y1 - y) * k) for x, y in pl]
        if len(pts) >= 2:
            d.line(pts, fill=colour, width=1)
    return img, k


def nice_step(span: float) -> float:
    raw = span / 12
    p = 10 ** math.floor(math.log10(raw))
    return next(m * p for m in (1, 2, 5, 10) if m * p >= raw)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dxf'); ap.add_argument('--out', required=True); ap.add_argument('--layers-png', type=int, default=40); ap.add_argument('--box')
    a = ap.parse_args(argv)
    doc = ezdxf.readfile(a.dxf)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    box = parse_box(a.box) if a.box else None
    counts: dict[str, Counter] = defaultdict(Counter)
    polys: dict[str, list] = defaultdict(list)
    texts = []
    inside = (lambda x, y: box[0] <= x <= box[2] and box[1] <= y <= box[3]) if box else (lambda x, y: True)
    for e in entities(doc):
        L = e.dxf.layer
        t = e.dxftype()
        if t in ('TEXT', 'MTEXT'):
            p = e.dxf.insert
            if not inside(p.x, p.y):
                continue
            txt = e.plain_text() if t == 'MTEXT' else e.dxf.text
            texts.append(dict(layer=L, text=re.sub(r'\s+', ' ', txt).strip(), x=round(p.x, 3), y=round(p.y, 3), height=round((e.dxf.get('char_height', 0) if t == 'MTEXT' else e.dxf.get('height', 0)) or 0, 3)))
            counts[L][t] += 1
            continue
        g = [pl for pl in geometry(e) if all(inside(x, y) for x, y in pl)]
        if g:
            polys[L] += g
            counts[L][t] += 1
        elif t not in ('LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE'):
            counts[L][t] += 1
    allp = [p for pl in polys.values() for p in pl]
    xs = [x for pl in allp for x, _ in pl]; ys = [y for pl in allp for _, y in pl]
    ext = (min(xs), min(ys), max(xs), max(ys)) if xs else (0, 0, 1, 1)
    size = max(ext[2] - ext[0], ext[3] - ext[1])
    # unit guess: a building is ~5–40 m across. Sheets often hold several plans side by side, so use the SHORTER side of the
    # layers that look like walls (else of everything): < 60 → m, < 6 000 → cm, otherwise mm. Always confirm with a dimension.
    wallish = [L for L in polys if re.search(r'wall|ścian|scian|mur|A-WALL|WAND|MURS|PARED', L, re.I)]  # i18n-ok: layer names in several languages
    basis = [p for L in (wallish or list(polys)) for p in polys[L]]
    bx = [x for pl in basis for x, _ in pl] or xs; by = [y for pl in basis for _, y in pl] or ys
    short = min(max(bx) - min(bx), max(by) - min(by)) if bx else size
    guess = 'm' if short < 60 else 'cm' if short < 6000 else 'mm'
    ins = doc.header.get('$INSUNITS', 0)
    layers = []
    for L in sorted(counts, key=lambda k: -len(polys[k])):
        lx = [x for pl in polys[L] for x, _ in pl]; ly = [y for pl in polys[L] for _, y in pl]
        layer = doc.layers.get(L) if L in doc.layers else None
        layers.append(dict(name=L, entities=dict(counts[L]), polylines=len(polys[L]), extents=[round(min(lx), 2), round(min(ly), 2), round(max(lx), 2), round(max(ly), 2)] if lx else None, color=layer.dxf.color if layer else None))
    write_json(out / 'layers.json', dict(source=a.dxf, header_units=UNITS.get(ins, str(ins)), unit_guess=guess, extents=[round(v, 3) for v in ext], box=box, layers=layers))
    write_json(out / 'texts.json', dict(source=a.dxf, texts=texts))
    img, k = render(allp, ext)
    step = nice_step(size) * k
    gridded(img, step=max(10, int(step / 2)), major=max(20, int(step)), label_size=12).save(out / 'all.png')
    for i, L in enumerate([x['name'] for x in layers if x['polylines']][: a.layers_png]):
        im, _ = render(polys[L], ext, px=1000, colour=(200, 30, 30))
        im.save(out / f'layer_{i:02d}.png')
        layers[[x['name'] for x in layers].index(L)]['png'] = f'layer_{i:02d}.png'
    write_json(out / 'layers.json', dict(source=a.dxf, header_units=UNITS.get(ins, str(ins)), unit_guess=guess, extents=[round(v, 3) for v in ext], box=box, layers=layers), quiet=True)
    print(f'{a.dxf}: {len(layers)} layers, {len(allp)} polylines, {len(texts)} texts · extents {size:.1f} drawing units · header units {UNITS.get(ins, ins)} · guess: {guess} (from {"wall-like layers" if wallish else "all layers"}, short side {short:.0f})')
    print('  note: all.png grid labels are pixel offsets; drawing coordinates = extents + offset / scale (see layers.json)')


if __name__ == '__main__':
    main()
