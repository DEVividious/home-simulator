"""PDF pages for the import tools: page count, words with their boxes, vector paths, embedded images and rendering.

Two backends give the same output: pymupdf when it is installed (the house-forge plugin always has it), otherwise poppler-utils
(pdfinfo, pdftotext, pdftocairo, pdftoppm, pdfimages). HSTOOLS_PDF=pymupdf|poppler forces one. Coordinates are PDF points with
the origin at the top-left corner of the page and y down, in both. Pages are numbered from 1."""
from __future__ import annotations

import html
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')


def backend() -> str:
    """'pymupdf' or 'poppler' (or 'none' when neither is available)"""
    forced = os.environ.get('HSTOOLS_PDF')
    if forced in ('pymupdf', 'poppler'):
        return forced
    try:
        import pymupdf  # noqa: F401
        return 'pymupdf'
    except ImportError:
        return 'poppler' if shutil.which('pdftotext') else 'none'


def _need_poppler():
    if not shutil.which('pdftotext'):
        raise SystemExit('reading PDF needs pymupdf (pip install pymupdf) or poppler-utils (pdftotext, pdftocairo, pdftoppm)')


def _run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=120).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ''


def _open(path):
    import pymupdf
    return pymupdf.open(str(path))


def page_count(path) -> int:
    if backend() == 'pymupdf':
        with _open(path) as doc:
            return doc.page_count
    _need_poppler()
    for line in _run(['pdfinfo', str(path)]).splitlines():
        if line.startswith('Pages:'):
            return int(line.split()[1])
    return 0


def words(path, page: int = 1) -> tuple[list[float] | None, list[dict]]:
    """page size [w, h] in pt and every word {x0, y0, x1, y1, t} in reading order"""
    if backend() == 'pymupdf':
        with _open(path) as doc:
            p = doc[page - 1]
            ws = [dict(x0=_r(w[0]), y0=_r(w[1]), x1=_r(w[2]), y1=_r(w[3]), t=w[4]) for w in p.get_text('words')]
            return [round(p.rect.width, 3), round(p.rect.height, 3)], _reading_order(ws)
    _need_poppler()
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / 'w.html'
        subprocess.run(['pdftotext', '-f', str(page), '-l', str(page), '-bbox-layout', str(path), str(f)], check=True)
        t = f.read_text(encoding='utf-8')
    m = re.search(r'<page width="([\d.]+)" height="([\d.]+)"', t)
    size = [float(m.group(1)), float(m.group(2))] if m else None
    return size, _reading_order([dict(x0=_r(float(x0)), y0=_r(float(y0)), x1=_r(float(x1)), y1=_r(float(y1)), t=html.unescape(w)) for x0, y0, x1, y1, w in WORD_RE.findall(t)])


def _reading_order(ws: list[dict]) -> list[dict]:
    """rows from the top (by the middle of the word, to the point), left to right — the same order from both backends, whose
    boxes differ in height (pymupdf: the font's box, poppler: ascent to descent) but share the baseline region"""
    return sorted(ws, key=lambda w: (round((w['y0'] + w['y1']) / 2), w['x0']))


def _r(x: float) -> float:
    return round(float(x), 3)


def _hex(c) -> str | None:
    """a pymupdf colour (floats 0–1) as #rrggbb"""
    if c is None:
        return None
    v = list(c)
    if len(v) == 1:
        v = v * 3
    if len(v) == 4:  # CMYK
        k = v[3]
        v = [(1 - v[i]) * (1 - k) for i in range(3)]
    return '#' + ''.join(f'{max(0, min(255, round(x * 255))):02x}' for x in v[:3])


def _svg_colour(s: str | None) -> str | None:
    """an SVG colour (pdftocairo writes rgb(r%, g%, b%) or #rrggbb) as #rrggbb; none → None"""
    if not s or s == 'none':
        return None
    m = re.match(r'rgb\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)', s)
    if m:
        return '#' + ''.join(f'{max(0, min(255, round(float(x) * 2.55))):02x}' for x in m.groups())
    m = re.match(r'#([0-9a-fA-F]{6})$', s)
    return '#' + m.group(1).lower() if m else s


def _bezier(p0, p1, p2, p3):
    """a cubic Bézier sampled at 1/4, 1/2, 3/4 and its end (as hstools.arcs does for SVG paths)"""
    out = []
    for s in (0.25, 0.5, 0.75, 1.0):
        x = (1 - s) ** 3 * p0[0] + 3 * (1 - s) ** 2 * s * p1[0] + 3 * (1 - s) * s * s * p2[0] + s ** 3 * p3[0]
        y = (1 - s) ** 3 * p0[1] + 3 * (1 - s) ** 2 * s * p1[1] + 3 * (1 - s) * s * s * p2[1] + s ** 3 * p3[1]
        out.append((x, y))
    return out


def paths(path, page: int = 1) -> list[dict]:
    """every vector path of the page: {stroke, fill (#rrggbb or None), width (pt or None), curved, subs: [[(x, y), …], …]}"""
    if backend() == 'pymupdf':
        out = []
        with _open(path) as doc:
            for d in doc[page - 1].get_drawings():
                subs, cur, curved = [], [], False
                for it in d['items']:
                    kind = it[0]
                    if kind in ('re', 'qu'):
                        if cur:
                            subs.append(cur)
                            cur = []
                        if kind == 're':
                            r = it[1]
                            pts = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
                        else:
                            q = it[1]
                            pts = [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
                        subs.append(pts + [pts[0]])
                        continue
                    a = (it[1].x, it[1].y)
                    if not cur or abs(cur[-1][0] - a[0]) > 1e-6 or abs(cur[-1][1] - a[1]) > 1e-6:
                        if cur:
                            subs.append(cur)
                        cur = [a]
                    if kind == 'l':
                        cur.append((it[2].x, it[2].y))
                    elif kind == 'c':
                        curved = True
                        cur.extend(_bezier(a, (it[2].x, it[2].y), (it[3].x, it[3].y), (it[4].x, it[4].y)))
                if cur:
                    if d.get('closePath') and cur[0] != cur[-1]:
                        cur.append(cur[0])
                    subs.append(cur)
                stroke = _hex(d.get('color')) if 's' in (d.get('type') or '') else None
                fill = _hex(d.get('fill')) if 'f' in (d.get('type') or '') else None
                w = d.get('width')
                out.append(dict(stroke=stroke, fill=fill, width=_r(w) if (w is not None and stroke) else None, curved=curved, subs=subs))
        return out
    _need_poppler()
    from hstools.arcs import load_svg_paths
    with tempfile.TemporaryDirectory() as td:
        svg = Path(td) / 's.svg'
        subprocess.run(['pdftocairo', '-svg', '-f', str(page), '-l', str(page), str(path), str(svg)], check=True)
        raw = load_svg_paths(svg)
    out = []
    for p in raw:
        stroke, fill = _svg_colour(p['stroke']), _svg_colour(p['fill'])
        if p['fill'] is None and p['stroke'] is None:
            fill = '#000000'  # SVG default: filled black
        subs = [sp for sp in p['subs'] if len(sp) >= 2]  # a move after the close of a path leaves a lone point
        out.append(dict(stroke=stroke, fill=fill, width=_r(float(p['width'])) if (p['width'] and stroke) else (1.0 if stroke else None), curved=p['curved'], subs=subs))
    return out


def images(path, page: int = 1) -> int:
    """number of raster images placed on the page"""
    if backend() == 'pymupdf':
        with _open(path) as doc:
            return len(doc[page - 1].get_images())
    if not shutil.which('pdfimages'):
        return 0
    return max(0, len(_run(['pdfimages', '-f', str(page), '-l', str(page), '-list', str(path)]).splitlines()) - 2)


def render(path, page: int, dpi: int, out_png) -> Path:
    """the page as a PNG at `dpi`"""
    out = Path(out_png)
    out.parent.mkdir(parents=True, exist_ok=True)
    if backend() == 'pymupdf':
        with _open(path) as doc:
            doc[page - 1].get_pixmap(dpi=dpi, alpha=False).save(str(out))
        return out
    _need_poppler()
    stem = out.with_suffix('')
    subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-r', str(dpi), '-png', '-singlefile', str(path), str(stem)], check=True)
    return out


def svg(path, page: int, out_svg) -> Path:
    """the page as SVG (for a human to open; the tools read paths())"""
    out = Path(out_svg)
    out.parent.mkdir(parents=True, exist_ok=True)
    if backend() == 'pymupdf':
        with _open(path) as doc:
            out.write_text(doc[page - 1].get_svg_image(text_as_path=False), encoding='utf-8')
        return out
    _need_poppler()
    subprocess.run(['pdftocairo', '-svg', '-f', str(page), '-l', str(page), str(path), str(out)], check=True)
    return out
