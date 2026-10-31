#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10", "numpy>=1.26", "shapely>=2.0", "ezdxf>=1.3", "pymupdf>=1.24"]
# ///
"""The import tools of house-forge, run as `uv run --locked tools.py <group> <tool> …` by house-forge.mjs.

The tools are the Home Simulator repository's tools/ (copied next to this file in the plugin): intake, image prepare / calibrate,
pdf text / svg / arcs / render, cad inspect / walls / dwg2dxf. `doctor` reports the libraries. PDF sheets are read with pymupdf.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# next to this file in the plugin; the repository's tools/ when run from packages/house-forge/python
BASE = HERE if (HERE / 'hstools').is_dir() else HERE.parents[1].parent / 'tools'

TOOLS = {
    ('intake',): 'intake.py',
    ('image', 'prepare'): 'image/prepare.py', ('image', 'calibrate'): 'image/calibrate.py',
    ('pdf', 'text'): 'pdf/sheet_text.py', ('pdf', 'svg'): 'pdf/sheet_svg.py', ('pdf', 'arcs'): 'pdf/door_arcs.py', ('pdf', 'render'): 'pdf/render.py',
    ('cad', 'inspect'): 'cad/dxf_inspect.py', ('cad', 'walls'): 'cad/dxf_walls.py', ('cad', 'dwg2dxf'): 'cad/dwg2dxf.py',
}
USAGE = 'usage: tools.py intake FILE… | image prepare|calibrate … | pdf text|svg|arcs|render … | cad inspect|walls|dwg2dxf … | doctor'


def doctor() -> int:
    ok = True
    print(f'  ✓ python {sys.version.split()[0]}')
    for mod, what in (('PIL', 'pillow'), ('numpy', 'numpy'), ('shapely', 'shapely'), ('ezdxf', 'ezdxf'), ('pymupdf', 'pymupdf')):
        try:
            m = __import__(mod)
            print(f'  ✓ {what} {getattr(m, "__version__", getattr(m, "VersionBind", ""))}')
        except ImportError as e:
            ok = False
            print(f'  ✗ {what}: {e}')
    print(f'  ✓ tools in {BASE}' if (BASE / 'hstools').is_dir() else f'  ✗ tools not found in {BASE}')
    return 0 if ok and (BASE / 'hstools').is_dir() else 1


def main(argv: list[str]) -> int:
    os.environ.setdefault('HSTOOLS_NAMES', 'plugin')
    os.environ.setdefault('HSTOOLS_PDF', 'pymupdf')
    if argv[:1] == ['doctor']:
        return doctor()
    key = tuple(argv[:1]) if argv[:1] == ['intake'] else tuple(argv[:2])
    if key not in TOOLS:
        print(USAGE, file=sys.stderr)
        return 2
    rest = argv[len(key):]
    sys.path.insert(0, str(BASE))
    file = BASE / TOOLS[key]
    spec = importlib.util.spec_from_file_location(f'hf_{"_".join(key)}', file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # the usage lines of the tool name it as this plugin does
    if mod.__doc__:
        for k, rel in TOOLS.items():
            mod.__doc__ = mod.__doc__.replace(f'python3 tools/{rel}', f'house-forge {" ".join(k)}').replace(f'tools/{rel}', f'house-forge {" ".join(k)}')
    sys.argv = [f'house-forge {" ".join(key)}', *rest]
    res = mod.main(rest)
    return res if isinstance(res, int) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
