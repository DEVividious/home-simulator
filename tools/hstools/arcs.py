"""Vector paths and door swing arcs.

Parsing of SVG produced by `pdftocairo -svg` (group and path transforms, M / L / C / Z commands, Béziers sampled), circle
fitting, and detection of door swing arcs: quarter circles whose centre is the hinge, one end lies on the wall line (closed
leaf) and the other end is the open leaf. Coordinates stay in the units of the drawing; callers convert to metres."""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET

import numpy as np

NS = '{http://www.w3.org/2000/svg}'
NUM = r'-?\d*\.?\d+(?:e-?\d+)?'


def _mat(t: str | None):
    m = [1.0, 0, 0, 1.0, 0, 0]
    for name, args in re.findall(r'(\w+)\(([^)]*)\)', t or ''):
        a = [float(v) for v in re.split(r'[ ,]+', args.strip()) if v]
        if name == 'matrix':
            n = a
        elif name == 'translate':
            n = [1, 0, 0, 1, a[0], a[1] if len(a) > 1 else 0]
        elif name == 'scale':
            n = [a[0], 0, 0, a[1] if len(a) > 1 else a[0], 0, 0]
        else:
            continue
        m = _mul(m, n)
    return m


def _mul(A, B):
    a, b, c, d, e, f = A
    g, h, i, j, k, l = B
    return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f]


def _app(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def _subpaths(d: str, m):
    toks = re.findall(r'[MLCZmlcz]|' + NUM, d)
    subs, cur, pos, i, cmd = [], [], (0.0, 0.0), 0, None
    while i < len(toks):
        t = toks[i]
        if t in 'MLCZmlcz':
            cmd = t
            i += 1
            if cmd in 'Zz' and cur:
                cur.append(cur[0])
                subs.append(cur)
                cur = []
            continue
        if cmd in ('M', 'L'):
            pos = (float(toks[i]), float(toks[i + 1]))
            i += 2
            if cmd == 'M' and cur:
                subs.append(cur)
                cur = []
            cur.append(_app(m, *pos))
            if cmd == 'M':
                cmd = 'L'
        elif cmd == 'C':
            p1, p2, p3 = [(float(toks[i + k]), float(toks[i + k + 1])) for k in (0, 2, 4)]
            for s in (0.25, 0.5, 0.75, 1.0):
                x = (1 - s) ** 3 * pos[0] + 3 * (1 - s) ** 2 * s * p1[0] + 3 * (1 - s) * s * s * p2[0] + s ** 3 * p3[0]
                y = (1 - s) ** 3 * pos[1] + 3 * (1 - s) ** 2 * s * p1[1] + 3 * (1 - s) * s * s * p2[1] + s ** 3 * p3[1]
                cur.append(_app(m, x, y))
            pos = p3
            i += 6
        else:
            i += 1
    if cur:
        subs.append(cur)
    return subs


def load_svg_paths(svg_path) -> list[dict]:
    """Every path of an SVG as {stroke, fill, width, subs: [[(x, y), …], …], curved} in SVG user units (pt for pdftocairo)."""
    root = ET.parse(str(svg_path)).getroot()
    out: list[dict] = []

    def walk(el, m):
        m2 = _mul(m, _mat(el.get('transform')))
        tag = el.tag.replace(NS, '')
        if tag == 'path':
            st = el.get('style', '')
            get = lambda k: el.get(k) or (re.search(k + r':([^;]+)', st).group(1).strip() if k + ':' in st else None)  # noqa: E731
            d = el.get('d', '')
            out.append(dict(stroke=get('stroke'), fill=get('fill'), width=get('stroke-width'), curved='C' in d or 'c' in d, subs=_subpaths(d, m2)))
        for ch in el:
            walk(ch, m2)

    walk(root, [1.0, 0, 0, 1.0, 0, 0])
    return out


def fit_circle(P: np.ndarray):
    """least-squares circle through points → (cx, cy, r, max deviation)"""
    A = np.c_[2 * P[:, 0], 2 * P[:, 1], np.ones(len(P))]
    c, *_ = np.linalg.lstsq(A, (P ** 2).sum(axis=1), rcond=None)
    r = math.sqrt(max(c[2] + c[0] ** 2 + c[1] ** 2, 0))
    dev = float(np.abs(np.hypot(P[:, 0] - c[0], P[:, 1] - c[1]) - r).max())
    return float(c[0]), float(c[1]), r, dev


def swing_arcs(paths: list[dict], r_min: float, r_max: float, tol: float) -> list[dict]:
    """Quarter-circle arcs of radius r_min…r_max (drawing units): [{hinge, a, b, r}] — a / b are the two ends; which end is the
    closed leaf is decided by the caller (the end lying on the wall line)."""
    out = []
    for p in paths:
        if not p['curved']:
            continue
        for sp in p['subs']:
            if len(sp) < 5:
                continue
            P = np.array(sp)
            if np.hypot(*(P[0] - P[-1])) < r_min * 0.2:
                continue
            cx, cy, r, dev = fit_circle(P)
            if not (r_min <= r <= r_max) or dev > tol:
                continue
            a0, a1 = (math.atan2(q[1] - cy, q[0] - cx) for q in (P[0], P[-1]))
            sweep = abs((math.degrees(a1 - a0) + 180) % 360 - 180)
            if abs(sweep - 90) > 4:
                continue
            out.append(dict(hinge=[cx, cy], a=[float(P[0][0]), float(P[0][1])], b=[float(P[-1][0]), float(P[-1][1])], r=r))
    # the same arc may be drawn twice (stroke + hairline) — keep one
    uniq: list[dict] = []
    for a in out:
        if not any(math.hypot(a['hinge'][0] - u['hinge'][0], a['hinge'][1] - u['hinge'][1]) < tol * 3 and abs(a['r'] - u['r']) < tol * 3 for u in uniq):
            uniq.append(a)
    return uniq
