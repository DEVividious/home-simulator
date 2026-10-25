#!/usr/bin/env python3
"""Scale of a raster floor plan: collect independent estimates of pixels-per-metre and check that they agree.

Estimates are appended to a JSON file (default projects/<id>/source/calibration.json):
  calibrate.py --file F points  --a X,Y --b X,Y --length METRES [--note TEXT]     two pixels a known distance apart (scale bar,
                                                                                   a printed dimension line)
  calibrate.py --file F area    --rect X0,Y0,X1,Y1 --m2 AREA [--wall inner|axis]   a room with a printed area; the rectangle is the
                                                                                   room's inner faces in pixels
  calibrate.py --file F symbol  --kind door|entrance-door|bathtub|bed|wc --a X,Y --b X,Y           size priors of drawn symbols
  calibrate.py --file F total   --rects "X0,Y0,X1,Y1;…" --m2 TOTAL                   several rooms against a total area
  calibrate.py --file F summary --origin X,Y                                         agreement + the plan.json calibration block

Rule (ADR 0016): at least two independent methods within 5 % of each other; otherwise ask the user for one real dimension.
A plan with no printed dimension or area can only use symbol priors: then at least three estimates from at least two symbol
kinds must agree, and the result is only "probable" (exit 0, but say so in the README and ask the user for one dimension).
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hstools import parse_box, parse_pt, write_json  # noqa: E402

# typical real sizes [m] of plan symbols: (nominal, low, high) — the length between the two picked points
PRIORS = {
    'door': (0.80, 0.70, 0.90),          # swing radius = leaf width of an interior door
    'single-door': (0.80, 0.70, 0.90),   # same as door (older name)
    'entrance-door': (0.90, 0.85, 1.00), # leaf of an entrance door
    'bathtub': (1.70, 1.50, 1.80),       # long side
    'bed': (2.00, 1.95, 2.10),           # bed length
    'bed-single': (2.00, 1.95, 2.10),    # same as bed (older name)
    'wc': (0.65, 0.55, 0.70),            # depth of a toilet from the wall
}

# symbols of the same thing are one kind when counting independent symbol estimates
SYMBOL_KIND = {'single-door': 'door', 'entrance-door': 'door', 'bed-single': 'bed'}


def load(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {'schema': 'home-simulator/calibration', 'estimates': []}


def add(path: Path, est: dict):
    d = load(path)
    d['estimates'].append(est)
    write_json(path, d, quiet=True)
    lo, hi = est.get('range', [est['pxPerM'], est['pxPerM']])
    print(f"{est['method']}: {est['pxPerM']:.3f} px/m" + (f' (range {lo:.2f}…{hi:.2f})' if lo != hi else '') + f'  → {path}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--file', required=True)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('points'); p.add_argument('--a', required=True); p.add_argument('--b', required=True); p.add_argument('--length', type=float, required=True); p.add_argument('--note', default='')
    p = sub.add_parser('area'); p.add_argument('--rect', required=True); p.add_argument('--m2', type=float, required=True); p.add_argument('--note', default='')
    p = sub.add_parser('symbol'); p.add_argument('--kind', required=True, choices=sorted(PRIORS)); p.add_argument('--a', required=True); p.add_argument('--b', required=True); p.add_argument('--note', default='')
    p = sub.add_parser('total'); p.add_argument('--rects', required=True); p.add_argument('--m2', type=float, required=True); p.add_argument('--note', default='')
    p = sub.add_parser('summary'); p.add_argument('--origin', required=True, help='pixel of the project origin (outer corner, bottom-left of the plan)')
    p.add_argument('--use', help='comma-separated indexes of estimates to use (default: all)')
    a = ap.parse_args(argv)
    path = Path(a.file)
    if a.cmd == 'points':
        (x0, y0), (x1, y1) = parse_pt(a.a), parse_pt(a.b)
        px = math.hypot(x1 - x0, y1 - y0)
        add(path, dict(method='points', pxPerM=px / a.length, input=dict(a=[x0, y0], b=[x1, y1], length_m=a.length), note=a.note))
    elif a.cmd == 'area':
        x0, y0, x1, y1 = parse_box(a.rect)
        apx = abs(x1 - x0) * abs(y1 - y0)
        add(path, dict(method='area', pxPerM=math.sqrt(apx / a.m2), input=dict(rect=[x0, y0, x1, y1], m2=a.m2), note=a.note))
    elif a.cmd == 'symbol':
        (x0, y0), (x1, y1) = parse_pt(a.a), parse_pt(a.b)
        px = math.hypot(x1 - x0, y1 - y0)
        nom, lo, hi = PRIORS[a.kind]
        add(path, dict(method=f'symbol:{a.kind}', pxPerM=px / nom, range=[px / hi, px / lo], input=dict(a=[x0, y0], b=[x1, y1], prior_m=[nom, lo, hi]), note=a.note, weak=True))
    elif a.cmd == 'total':
        rects = [parse_box(r) for r in a.rects.split(';') if r.strip()]
        apx = sum(abs(r[2] - r[0]) * abs(r[3] - r[1]) for r in rects)
        add(path, dict(method='total-area', pxPerM=math.sqrt(apx / a.m2), input=dict(rects=rects, m2=a.m2), note=a.note))
    else:
        d = load(path)
        est = d['estimates']
        if a.use:
            idx = {int(i) for i in a.use.split(',')}
            est = [e for i, e in enumerate(est) if i in idx]
        if not est:
            raise SystemExit('no estimates — add some with points / area / symbol / total')
        strong = [e for e in est if not e.get('weak')]
        base = strong or est
        value = statistics.median(e['pxPerM'] for e in base)
        print('estimates:')
        for i, e in enumerate(d['estimates']):
            mark = '' if e in est else '  (not used)'
            print(f"  [{i}] {e['method']:<16} {e['pxPerM']:9.3f} px/m  {100 * (e['pxPerM'] / value - 1):+6.1f} %{mark}")
        spread = (max(e['pxPerM'] for e in base) - min(e['pxPerM'] for e in base)) / value
        # symbol-only: at least three estimates from two different symbol kinds (door / bed / bathtub …)
        kinds = {SYMBOL_KIND.get(k, k) for k in (e['method'].split(':')[-1] for e in base)}
        enough = len(base) >= 2 if strong else len(base) >= 3 and len(kinds) >= 2
        ok = enough and spread <= 0.05
        verdict = ('OK — independent estimates agree within 5 %' if strong else
                   'PROBABLE — symbol priors agree within 5 %, but no printed dimension or area was used; record it in the README and ask the user for one real dimension') if ok else (
            ('NOT ENOUGH — need at least two measured estimates (a dimension, a scale bar, a printed area)' if strong else
             'NOT ENOUGH — symbol priors alone need at least three estimates from two different symbol kinds') + '; ask the user for one real dimension'
            if not enough else f'DISAGREE — estimates differ by {100 * spread:.1f} % (> 5 %); re-check the picked points, drop a bad one with --use, or ask for one real dimension')
        print(f'\npxPerM = {value:.3f} (median of {len(base)} {"measured" if strong else "symbol"} estimates) · {verdict}')
        block = dict(pxPerM=round(value, 4), originPx=list(parse_pt(a.origin)), methods=[dict(method=e['method'], pxPerM=round(e['pxPerM'], 4), **({'note': e['note']} if e.get('note') else {})) for e in est])
        d['result'] = dict(block, agreement=round(spread, 4), ok=ok, confidence='measured' if strong else 'probable')
        write_json(path, d, quiet=True)
        print('\nplan.json → "calibration":')
        print(json.dumps(block, indent=1))
        if not ok:
            sys.exit(3)


if __name__ == '__main__':
    main()
