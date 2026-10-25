#!/usr/bin/env python3
"""Classify input files for the home-from-plan skill.

  python3 tools/intake.py FILE… [--json]

For each file: kind (dwg / dxf / pdf-vector / pdf-raster / image / other), size, pages and text layer of PDFs (poppler),
pixel size of images, and the import branch to use (docs/IMPORT_*.md)."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

BRANCH = {'dwg': 'CAD (convert with tools/cad/dwg2dxf.py, then dxf)', 'dxf': 'CAD (tools/cad/dxf_inspect.py → dxf_walls.py)',
          'pdf-vector': 'PDF sheet (tools/pdf/sheet_text.py, sheet_svg.py, door_arcs.py)', 'pdf-raster': 'raster (render a page with pdftoppm, then tools/image/prepare.py)',
          'image': 'raster (tools/image/prepare.py → calibrate.py)', 'other': 'not a plan — ask the user'}


def run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ''


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
        pages = 0
        for line in run(['pdfinfo', str(p)]).splitlines():
            if line.startswith('Pages:'):
                pages = int(line.split()[1])
        words = len(run(['pdftotext', '-l', '1', str(p), '-']).split()) if shutil.which('pdftotext') else None
        images = max(0, len(run(['pdfimages', '-l', '1', '-list', str(p)]).splitlines()) - 2) if shutil.which('pdfimages') else None
        info.update(pages=pages, words_page1=words, images_page1=images)
        info['kind'] = 'pdf-vector' if (words or 0) > 10 and (images or 0) <= 2 else 'pdf-raster'
        if not shutil.which('pdftotext'):
            info['warning'] = 'poppler-utils not installed (pdftotext, pdftocairo, pdftoppm)'
    else:
        try:
            from PIL import Image
            with Image.open(p) as im:
                info.update(kind='image', size_px=list(im.size), mode=im.mode)
        except Exception:  # noqa: BLE001
            info['kind'] = 'other'
    info['branch'] = BRANCH.get(info['kind'], '')
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
