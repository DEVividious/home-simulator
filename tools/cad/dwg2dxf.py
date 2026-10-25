#!/usr/bin/env python3
"""DWG → ASCII DXF R2018 with the ODA File Converter (free download from opendesign.com; not bundled).

  python3 tools/cad/dwg2dxf.py DRAWING.dwg [-o OUT_DIR]

The converter is found through the ODA_FILE_CONVERTER environment variable (path to the executable or AppImage) or on PATH as
ODAFileConverter. The source file is copied to a temporary directory first, so the original is never touched. Headless Linux:
run under `xvfb-run -a` if the converter needs a display."""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def converter() -> str:
    env = os.environ.get('ODA_FILE_CONVERTER')
    if env and Path(env).exists():
        return env
    for name in ('ODAFileConverter', 'ODAFileConverter.AppImage'):
        p = shutil.which(name)
        if p:
            return p
    for cand in Path.home().glob('.local/opt/oda*/**/ODAFileConverter*'):
        if cand.is_file() and os.access(cand, os.X_OK):
            return str(cand)
    raise SystemExit('ODA File Converter not found — install it and set ODA_FILE_CONVERTER=/path/to/ODAFileConverter (see docs/IMPORT_CAD.md)')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dwg'); ap.add_argument('-o', '--out', default=None)
    a = ap.parse_args(argv)
    src = Path(a.dwg)
    out = Path(a.out) if a.out else src.parent
    out.mkdir(parents=True, exist_ok=True)
    exe = converter()
    with tempfile.TemporaryDirectory(prefix='dwg_in_') as tin, tempfile.TemporaryDirectory(prefix='dxf_out_') as tout:
        shutil.copy2(src, Path(tin) / src.name)
        env = dict(os.environ); env.setdefault('QT_QPA_PLATFORM', 'offscreen')
        subprocess.run([exe, tin, tout, 'ACAD2018', 'DXF', '0', '1', '*.dwg'], check=True, env=env, capture_output=True)
        produced = list(Path(tout).glob('*.dxf'))
        if not produced:
            raise SystemExit('the converter produced no DXF (try running it under xvfb-run -a)')
        dst = out / (src.stem + '.dxf')
        shutil.move(str(produced[0]), dst)
    print(f'{src} → {dst}')


if __name__ == '__main__':
    main()
