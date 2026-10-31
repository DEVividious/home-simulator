#!/usr/bin/env python3
"""Classify input files for the home-from-plan skill.

  python3 tools/intake.py FILE… [--json]

For each file: kind (dwg / dxf / pdf-vector / pdf-raster / image / other), size, pages and text layer of PDFs (pymupdf or
poppler, hstools.pdfdoc), pixel size of images, and the import branch to use (A raster, B vector PDF, C CAD — the home-from-plan
skill, docs/IMPORT_*.md)."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hstools import pdfdoc  # noqa: E402

BRANCH = {'dwg': 'C. CAD — convert with {dwg2dxf}, then as dxf', 'dxf': 'C. CAD — {inspect} → {walls}',
          'pdf-vector': 'B. vector PDF sheet — {text}, {svg}, {arcs}', 'pdf-raster': 'A. raster — render the page with {render}, then {prepare} → {calibrate}',
          'image': 'A. raster — {prepare} → {calibrate}',
          'room-list': 'room / area list — printed areas for areaPrinted and {calibrate} area / total (not a drawing)',
          'other': 'not a plan — ask the user'}
# the tools as this repository names them, and as the house-forge plugin's commands (its tools.py sets HSTOOLS_NAMES=plugin)
NAMES = {'repo': dict(dwg2dxf='cad/dwg2dxf.py', inspect='cad/dxf_inspect.py', walls='cad/dxf_walls.py', text='pdf/sheet_text.py', svg='pdf/sheet_svg.py',
                      arcs='pdf/door_arcs.py', render='pdf/render.py', prepare='image/prepare.py', calibrate='image/calibrate.py'),
         'plugin': dict(dwg2dxf='cad dwg2dxf', inspect='cad inspect', walls='cad walls', text='pdf text', svg='pdf svg', arcs='pdf arcs', render='pdf render',
                        prepare='image prepare', calibrate='image calibrate')}


def branch(kind: str) -> str:
    names = NAMES['plugin' if os.environ.get('HSTOOLS_NAMES') == 'plugin' else 'repo']
    return BRANCH.get(kind, '').format(**names)


def classify(p: Path) -> dict:
    ext = p.suffix.lower()
    info: dict = dict(file=str(p), bytes=p.stat().st_size if p.exists() else None)
    if not p.exists():
        return dict(info, kind='missing')
    head = p.read_bytes()[:16]
    if ext == '.dwg' or head.startswith(b'AC10'):
        info['kind'] = 'dwg'
    elif ext == '.dxf':
        info['kind'] = 'dxf'
    elif ext == '.pdf' or head.startswith(b'%PDF'):
        if pdfdoc.backend() == 'none':
            info.update(kind='pdf-vector', warning='cannot read PDF: install pymupdf (pip install pymupdf) or poppler-utils')
        else:
            pages = pdfdoc.page_count(p)
            words = len(pdfdoc.words(p, 1)[1]) if pages else 0
            images = pdfdoc.images(p, 1) if pages else 0
            info.update(pages=pages, words_page1=words, images_page1=images)
            info['kind'] = 'pdf-vector' if words > 10 and images <= 2 else 'pdf-raster'
    elif ext in ('.txt', '.csv', '.md', '.tsv'):
        text = p.read_text(errors='replace')
        # lines with an area-like number (12.4, 12,40, 12.4 m2) — a room schedule copied from a listing or a drawing
        areas = re.findall(r'\d+[.,]\d{1,2}(?!\d)', text)
        info.update(kind='room-list' if len(areas) >= 3 else 'other', area_values=len(areas))
    else:
        try:
            from PIL import Image
            with Image.open(p) as im:
                info.update(kind='image', size_px=list(im.size), mode=im.mode)
                if max(im.size) < 1200:
                    info['warning'] = 'small image — read wall faces from close-ups (prepare.py --zoom-box); ask for a larger one if available'
        except Exception:  # noqa: BLE001
            info['kind'] = 'other'
    info['branch'] = branch(info['kind'])
    return info


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    as_json = '--json' in args
    files = [Path(a) for a in args if a != '--json']
    if not files:
        raise SystemExit(__doc__)
    out = [classify(f) for f in files]
    if as_json:
        print(json.dumps(out, indent=1))
    else:
        for i in out:
            extra = ', '.join(f'{k}={v}' for k, v in i.items() if k not in ('file', 'kind', 'branch', 'bytes'))
            print(f"{i['file']}: {i['kind']}{' (' + extra + ')' if extra else ''}\n    → {i.get('branch', '')}")


if __name__ == '__main__':
    main()
