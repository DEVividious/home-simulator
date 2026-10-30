"""Tests of the import tools on synthetic inputs (no private drawings needed).
Run: .venv/bin/python -m unittest discover -s tools/tests -v"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
ROOT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
PY = sys.executable


def run(*args: str) -> str:
    return subprocess.run([PY, *args], check=True, capture_output=True, text=True).stdout


class Calibration(unittest.TestCase):
    def test_estimates_agree_and_block(self):
        with tempfile.TemporaryDirectory() as td:
            f = str(Path(td) / 'c.json')
            # 100 px per metre: a 3 m dimension line and a 4 × 3 m room
            run(str(TOOLS / 'image/calibrate.py'), '--file', f, 'points', '--a', '0,0', '--b', '300,0', '--length', '3')
            run(str(TOOLS / 'image/calibrate.py'), '--file', f, 'area', '--rect', '0,0,400,300', '--m2', '12')
            out = run(str(TOOLS / 'image/calibrate.py'), '--file', f, 'summary', '--origin', '10,500')
            self.assertIn('OK', out)
            d = json.loads(Path(f).read_text())
            self.assertAlmostEqual(d['result']['pxPerM'], 100, places=3)
            self.assertEqual(d['result']['originPx'], [10.0, 500.0])

    def test_disagreement_fails(self):
        with tempfile.TemporaryDirectory() as td:
            f = str(Path(td) / 'c.json')
            run(str(TOOLS / 'image/calibrate.py'), '--file', f, 'points', '--a', '0,0', '--b', '300,0', '--length', '3')
            run(str(TOOLS / 'image/calibrate.py'), '--file', f, 'area', '--rect', '0,0,400,300', '--m2', '15')
            r = subprocess.run([PY, str(TOOLS / 'image/calibrate.py'), '--file', f, 'summary', '--origin', '0,0'], capture_output=True, text=True)
            self.assertEqual(r.returncode, 3)
            self.assertIn('DISAGREE', r.stdout)

    def test_symbols_only_need_two_kinds(self):
        with tempfile.TemporaryDirectory() as td:
            f = str(Path(td) / 'c.json')
            cal = lambda *a: subprocess.run([PY, str(TOOLS / 'image/calibrate.py'), '--file', f, *a], capture_output=True, text=True)
            # 100 px per metre: three interior doors (0.80 m) — one symbol kind is not enough
            for y in (0, 100, 200):
                cal('symbol', '--kind', 'door', '--a', f'0,{y}', '--b', f'80,{y}')
            r = cal('summary', '--origin', '0,0')
            self.assertEqual(r.returncode, 3)
            self.assertIn('NOT ENOUGH', r.stdout)
            cal('symbol', '--kind', 'bed', '--a', '0,0', '--b', '0,200')
            r = cal('summary', '--origin', '0,0')
            self.assertEqual(r.returncode, 0)
            self.assertIn('PROBABLE', r.stdout)
            self.assertEqual(json.loads(Path(f).read_text())['result']['confidence'], 'probable')


class Prepare(unittest.TestCase):
    def test_grid_and_tiles(self):
        with tempfile.TemporaryDirectory() as td:
            run(str(TOOLS / 'image/prepare.py'), str(ROOT / 'skills/home-from-plan/assets/samples/flat-2room.png'), '--out', td)
            info = json.loads((Path(td) / 'info.json').read_text())
            self.assertEqual(info['size_px'], [1920, 1199])
            self.assertEqual(len(info['tiles']), 4)
            self.assertTrue((Path(td) / 'grid.png').exists())


class Arcs(unittest.TestCase):
    def test_quarter_circle_found(self):
        from hstools.arcs import load_svg_paths, swing_arcs
        # a 90° arc of radius 50 around (100, 100) drawn with one cubic Bézier (k = 0.5523) + a straight leaf line
        k = 0.5523 * 50
        svg = f'<svg xmlns="http://www.w3.org/2000/svg"><path d="M 150 100 C 150 {100 + k} {100 + k} 150 100 150" stroke="black" fill="none"/><path d="M 100 100 L 150 100" stroke="black"/></svg>'
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'a.svg'
            p.write_text(svg)
            arcs = swing_arcs(load_svg_paths(p), 30, 80, 1.0)
        self.assertEqual(len(arcs), 1)
        self.assertAlmostEqual(arcs[0]['hinge'][0], 100, delta=0.5)
        self.assertAlmostEqual(arcs[0]['r'], 50, delta=0.5)


class Dxf(unittest.TestCase):
    def test_two_rooms_with_door_gap(self):
        import ezdxf
        doc = ezdxf.new()
        msp = doc.modelspace()
        def rect(x0, y0, x1, y1, gap=None):
            pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
            for (a, b) in zip(pts, pts[1:]):
                if gap and a[0] == b[0] == gap[0] and min(a[1], b[1]) <= gap[1] <= max(a[1], b[1]):
                    lo, hi = sorted((a[1], b[1]))
                    msp.add_line((a[0], lo), (a[0], gap[1] - 45), dxfattribs={'layer': 'WALLS'})
                    msp.add_line((a[0], gap[1] + 45), (a[0], hi), dxfattribs={'layer': 'WALLS'})
                else:
                    msp.add_line(a, b, dxfattribs={'layer': 'WALLS'})
        # centimetres: outer 0..830 × 0..460, two rooms 400 × 400 and 370 × 400 with a 12 cm wall and a 90 cm door
        rect(0, 0, 830, 460)
        rect(30, 30, 430, 430, gap=(430, 230))
        rect(442, 30, 800, 430, gap=(442, 230))
        msp.add_text('Bedroom', dxfattribs={'layer': 'TEXT', 'insert': (200, 200)})
        with tempfile.TemporaryDirectory() as td:
            f = Path(td) / 'p.dxf'
            doc.saveas(f)
            out = Path(td) / 'out'
            run(str(TOOLS / 'cad/dxf_inspect.py'), str(f), '--out', str(out))
            layers = json.loads((out / 'layers.json').read_text())
            self.assertEqual(layers['unit_guess'], 'cm')
            run(str(TOOLS / 'cad/dxf_walls.py'), str(f), '--layers', 'WALLS', '--unit', 'cm', '--out', str(out), '--text-layers', 'TEXT')
            w = json.loads((out / 'walls.json').read_text())
            areas = sorted(r['area'] for r in w['rooms'])
            self.assertEqual(len(areas), 2, w['rooms'])
            self.assertAlmostEqual(areas[0], 3.58 * 4.0, delta=0.3)  # closing a door gap bites ~1 % off the room
            self.assertAlmostEqual(areas[1], 16.0, delta=0.3)
            self.assertTrue(any('Bedroom' in r['texts'] for r in w['rooms']))


class SheetRoofFacts(unittest.TestCase):
    def test_pitch_and_ridge_from_words(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pdf'))
        from sheet_text import find_roof
        words = [dict(x0=0, y0=0, x1=1, y1=1, t=t) for t in ['PRZEKRÓJ', 'A-A', 'kąt', 'nachylenia', 'dachu', '40°', 'wysokość', 'kalenicy', '+8,45', 'okno', '78/140', '∠', '35', '°']]  # i18n-ok: drawing words in Polish
        found = find_roof(words, ['pitch', 'ridge'])
        self.assertEqual(sorted({w['deg'] for w in found['pitch']}), [35.0, 40.0])
        self.assertEqual([w['m'] for w in found['ridge']], [8.45])


if __name__ == '__main__':
    unittest.main()
