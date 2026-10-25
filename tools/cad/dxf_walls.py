#!/usr/bin/env python3
"""Wall geometry of chosen DXF layers in metres, plus candidate room outlines.

  python3 tools/cad/dxf_walls.py DRAWING.dxf --layers "WALLS,PARTITIONS" --unit cm --out DIR
         [--origin X,Y] [--box x0,y0,x1,y1] [--text-layers "ROOMS"] [--min-room 1.5]

--unit: unit of the drawing (m / cm / mm) — from dxf_inspect.py (the header is often wrong).
--origin: drawing point that becomes the project origin (default: bottom-left corner of the wall extents).
Writes
  DIR/walls.json   segments [x0, y0, x1, y1] in metres (project coordinates, +Y up), texts with positions in metres,
                   room candidates: faces of the wall network (openings closed by a morphological closing, --gap) larger than --min-room m² that are not
                   wall poché, each with area, bbox, an orthogonal outline and the texts found inside (names, areas)
  DIR/rooms.png    the candidates numbered over the walls
The candidates are suggestions (areas within ~1–2 %: closed openings bite a little off the rooms): the agent maps them to rooms (name, kind) and writes plan.json; doors and windows come from the
door / window layers or the drawing."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ezdxf  # noqa: E402
from PIL import ImageDraw  # noqa: E402
from shapely.geometry import LineString, Point, Polygon  # noqa: E402
from shapely.geometry import box as shp_box  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

from hstools import parse_box, parse_pt, r3, write_json  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dxf_inspect import entities, geometry, render  # noqa: E402

SCALE = {'m': 1.0, 'cm': 0.01, 'mm': 0.001}


def orthogonal(poly: Polygon) -> list[list[float]]:
    """outline simplified and snapped to axis-aligned edges (5 mm)"""
    s = poly.simplify(0.02)
    pts = [(round(x * 200) / 200, round(y * 200) / 200) for x, y in list(s.exterior.coords)[:-1]]
    out: list[tuple[float, float]] = []
    for i, (x, y) in enumerate(pts):
        px, py = out[-1] if out else pts[i - 1]
        if out and abs(x - px) < abs(y - py):
            x = px
        elif out:
            y = py
        out.append((x, y))
    return [[r3(x), r3(y)] for x, y in out]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dxf'); ap.add_argument('--layers', required=True); ap.add_argument('--unit', required=True, choices=sorted(SCALE)); ap.add_argument('--out', required=True)
    ap.add_argument('--origin'); ap.add_argument('--box'); ap.add_argument('--text-layers', default=''); ap.add_argument('--min-room', type=float, default=1.5)
    ap.add_argument('--gap', type=float, default=0.55, help='close openings up to 2·gap metres wide when looking for rooms (default 0.55)')
    a = ap.parse_args(argv)
    doc = ezdxf.readfile(a.dxf)
    wanted = [s.strip() for s in a.layers.split(',') if s.strip()]
    tl = [s.strip() for s in a.text_layers.split(',') if s.strip()]
    box = parse_box(a.box) if a.box else None
    inside = (lambda x, y: box[0] <= x <= box[2] and box[1] <= y <= box[3]) if box else (lambda x, y: True)
    k = SCALE[a.unit]
    raw, texts = [], []
    for e in entities(doc):
        L = e.dxf.layer
        if e.dxftype() in ('TEXT', 'MTEXT'):
            if tl and L not in tl:
                continue
            p = e.dxf.insert
            if inside(p.x, p.y):
                texts.append((p.x, p.y, (e.plain_text() if e.dxftype() == 'MTEXT' else e.dxf.text).strip(), L))
            continue
        if L not in wanted:
            continue
        for pl in geometry(e):
            if all(inside(x, y) for x, y in pl):
                raw.append(pl)
    if not raw:
        raise SystemExit(f'no geometry on layers {wanted} — check the names with dxf_inspect.py')
    xs = [x for pl in raw for x, _ in pl]; ys = [y for pl in raw for _, y in pl]
    ox, oy = parse_pt(a.origin) if a.origin else (min(xs), min(ys))
    tm = lambda x, y: ((x - ox) * k, (y - oy) * k)  # noqa: E731
    segs, lines = [], []
    for pl in raw:
        q = [tm(x, y) for x, y in pl]
        for p0, p1 in zip(q, q[1:]):
            if p0 != p1:
                segs.append([r3(p0[0]), r3(p0[1]), r3(p1[0]), r3(p1[1])])
                lines.append(LineString([p0, p1]))
    # close door / window gaps (≤ 2·gap) so that rooms become closed faces: dilate the wall lines, then erode them back
    net = unary_union(lines)
    mass = net.buffer(0.01, cap_style='flat').buffer(a.gap, join_style='mitre').buffer(-a.gap, join_style='mitre')
    env = shp_box(*net.bounds).buffer(0.5, join_style='mitre')
    free = env.difference(mass)
    parts = list(free.geoms) if hasattr(free, 'geoms') else [free]
    faces = [f for f in parts if f.area >= a.min_room and not f.exterior.intersects(env.exterior)]
    tmt = [(tm(x, y), t, L) for x, y, t, L in texts]
    rooms = []
    for f in sorted(faces, key=lambda f: (-f.centroid.y, f.centroid.x)):
        # wall poché is thin: area / (perimeter / 2) ≈ thickness
        thickness = f.area / (f.length / 2)
        if thickness < 0.6 or f.area > 400:
            continue
        inner = [t for (p, t, L) in tmt if f.contains(Point(p))]
        b = f.bounds
        rooms.append(dict(id=f'C{len(rooms) + 1}', area=round(f.area, 2), bbox=[r3(v) for v in b], outline=orthogonal(f), rectangular=abs(f.area - (b[2] - b[0]) * (b[3] - b[1])) < 0.05, texts=inner))
    write_json(Path(a.out) / 'walls.json', dict(source=a.dxf, layers=wanted, unit=a.unit, origin_drawing=[ox, oy], units='m', segments=segs,
                                                texts=[dict(x=r3(p[0]), y=r3(p[1]), text=t, layer=L) for p, t, L in tmt], rooms=rooms))
    ext = (0, 0, (max(xs) - ox) * k, (max(ys) - oy) * k)
    img, s = render([[(x0, y0), (x1, y1)] for x0, y0, x1, y1 in segs], ext, px=1600, colour=(60, 60, 60))
    d = ImageDraw.Draw(img)
    for r in rooms:
        pts = [((x - ext[0]) * s, (ext[3] - y) * s) for x, y in r['outline']]
        d.polygon(pts, outline=(30, 90, 220))
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        d.text((cx, cy), f"{r['id']} {r['area']} m2", fill=(30, 90, 220), anchor='mm')
    img.save(Path(a.out) / 'rooms.png')
    print(f'{a.dxf}: {len(segs)} wall segments, {len(rooms)} room candidates ({", ".join(r["id"] + " " + str(r["area"]) for r in rooms[:12])}{" …" if len(rooms) > 12 else ""})')


if __name__ == '__main__':
    main()
