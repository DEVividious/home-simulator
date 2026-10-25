"""Shared helpers of the Home Simulator import tools (tools/*). Pure Python + numpy / pillow; optional shapely / ezdxf."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def write_json(path: Path | str, data, quiet: bool = False) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    if not quiet:
        print(f'wrote {p}', file=sys.stderr)
    return p


def r3(x: float) -> float:
    return round(float(x), 3)


def parse_pt(s: str) -> tuple[float, float]:
    """'x,y' → (x, y)"""
    a, b = s.split(',')
    return float(a), float(b)


def parse_box(s: str) -> tuple[float, float, float, float]:
    v = [float(x) for x in s.split(',')]
    if len(v) != 4:
        raise SystemExit(f'expected x0,y0,x1,y1, got {s!r}')
    return v[0], v[1], v[2], v[3]
