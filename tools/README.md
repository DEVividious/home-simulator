# Import tools

Command-line helpers behind the `home-from-plan` skill (skills/home-from-plan/SKILL.md). They turn source material into facts an
agent writes into `projects/<id>/source/plan.json`; `npm run project:build` compiles that into the project package.

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
```

| Tool | Input → output | Needs |
|---|---|---|
| `intake.py FILE…` | classifies files: dwg / dxf / vector or raster PDF / image, and names the import branch | pillow; poppler for PDFs |
| `image/prepare.py PLAN.png --out DIR` | `grid.png` with a labelled pixel grid, zoomed `tile_*.png`, `info.json` | pillow |
| `image/calibrate.py --file F points/area/symbol/total/summary` | pixels-per-metre estimates, their agreement, the `calibration` block for plan.json | — |
| `pdf/sheet_text.py SHEET.pdf --out DIR` | words with positions, printed areas, numbers, drawing scale | poppler |
| `pdf/sheet_svg.py SHEET.pdf --out DIR` | vector paths in points, a gridded preview of the sheet | poppler |
| `pdf/door_arcs.py SHEET.pdf --scale 50 --out DIR` | door swing arcs: hinge, both leaf ends, leaf width | poppler |
| `cad/dwg2dxf.py DRAWING.dwg` | ASCII DXF R2018 | ODA File Converter |
| `cad/dxf_inspect.py DRAWING.dxf --out DIR` | layers with entity counts and extents, unit guess, texts, one image per layer | ezdxf, pillow |
| `cad/dxf_walls.py DRAWING.dxf --layers … --unit cm --out DIR` | wall segments in metres, texts, candidate room outlines + image | ezdxf, shapely, pillow |

Every tool prints a one-line summary and writes JSON next to images an agent can look at. None of them modifies its input.
Tests: `.venv/bin/python -m unittest discover -s tools/tests` (standard library only).
