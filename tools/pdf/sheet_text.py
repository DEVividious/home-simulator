#!/usr/bin/env python3
"""Words of a vector PDF sheet with positions (pdftotext -bbox-layout) and what they probably are.

  python3 tools/pdf/sheet_text.py SHEET.pdf --out DIR [--page 1]

Writes DIR/words.json: page size [pt], every word {x0, y0, x1, y1, t} (pt, y down) and detected candidates:
  areas       "12.45 m²", "12,45 m2"            → printed room areas (use for calibration and plan.json areaPrinted)
  dimensions  numbers that look like lengths in cm or m ("345", "3,45", "3.45")
  scales      "1:50", "1:100", "skala 1:50" …   → drawing scale (pt per metre = 72 / 0.0254 / scale)
  labels      other words (room names, door / window tags)"""
from __future__ import annotations

import argparse
import html
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hstools import write_json  # noqa: E402

WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
AREA_RE = re.compile(r'^(\d{1,3}[.,]\d{1,2})$')
NUM_RE = re.compile(r'^\d{1,4}([.,]\d{1,3})?$')
SCALE_RE = re.compile(r'1\s*:\s*(\d{2,4})')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf'); ap.add_argument('--out', required=True); ap.add_argument('--page', type=int, default=1)
    a = ap.parse_args(argv)
    with tempfile.TemporaryDirectory() as td:
        html_file = Path(td) / 'w.html'
        subprocess.run(['pdftotext', '-f', str(a.page), '-l', str(a.page), '-bbox-layout', a.pdf, str(html_file)], check=True)
        t = html_file.read_text(encoding='utf-8')
    m = re.search(r'<page width="([\d.]+)" height="([\d.]+)"', t)
    page = [float(m.group(1)), float(m.group(2))] if m else None
    words = [dict(x0=float(x0), y0=float(y0), x1=float(x1), y1=float(y1), t=html.unescape(w)) for x0, y0, x1, y1, w in WORD_RE.findall(t)]
    areas, dims, labels = [], [], []
    scales = sorted({int(s) for s in SCALE_RE.findall(' '.join(w['t'] for w in words))})
    for i, w in enumerate(words):
        nxt = words[i + 1]['t'] if i + 1 < len(words) else ''
        if AREA_RE.match(w['t']) and re.match(r'^m(2|²)', nxt):
            areas.append(dict(w, m2=float(w['t'].replace(',', '.'))))
        elif re.match(r'^\d{1,3}[.,]\d{1,2}m(2|²)$', w['t']):
            areas.append(dict(w, m2=float(re.sub(r'm.*$', '', w['t']).replace(',', '.'))))
        elif NUM_RE.match(w['t']):
            dims.append(w)
        elif re.search(r'[A-Za-z]', w['t']):
            labels.append(w)
    write_json(Path(a.out) / 'words.json', dict(source=a.pdf, page=a.page, page_size_pt=page, scales=scales, areas=areas, dimensions=dims, labels=labels, words=words))
    print(f'{a.pdf} p.{a.page}: {len(words)} words · {len(areas)} areas · {len(dims)} numbers · scales {scales or "none found"}')
    if scales:
        print('  pt per metre at 1:%d = %.4f' % (scales[0], 72 / 0.0254 / scales[0]))


if __name__ == '__main__':
    main()
