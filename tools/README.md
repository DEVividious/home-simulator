# Import tools

Command-line helpers behind the `home-from-plan` skill (skills/home-from-plan/SKILL.md). They turn source material into facts an
agent writes into `projects/<id>/source/plan.json`; `npm run project:build` compiles that into the project package.

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
```

| Tool | Input → output | Needs |
|---|---|---|
| `intake.py FILE…` | classifies files: dwg / dxf / vector or raster PDF / image, and names the import branch | pillow; PDF reader for PDFs |
| `image/prepare.py PLAN.png --out DIR` | `grid.png` with a labelled pixel grid, zoomed `tile_*.png`, `info.json` | pillow |
| `image/calibrate.py --file F points/area/symbol/total/summary` | pixels-per-metre estimates, their agreement, the `calibration` block for plan.json | — |
| `pdf/sheet_text.py SHEET.pdf --out DIR [--find pitch,ridge]` | words with positions, printed areas, numbers, drawing scale; roof pitch and ridge height | PDF reader |
| `pdf/sheet_svg.py SHEET.pdf --out DIR` | vector paths in points, a gridded preview of the sheet | PDF reader, pillow |
| `pdf/render.py SHEET.pdf --out PAGE.png [--page N] [--dpi 200]` | one page as an image, for the raster branch | PDF reader |
| `pdf/door_arcs.py SHEET.pdf --scale 50 --out DIR` | door swing arcs: hinge, both leaf ends, leaf width | PDF reader |
| `cad/dwg2dxf.py DRAWING.dwg` | ASCII DXF R2018 | ODA File Converter |
| `cad/dxf_inspect.py DRAWING.dxf --out DIR` | layers with entity counts and extents, unit guess, texts, one image per layer | ezdxf, pillow |
| `cad/dxf_walls.py DRAWING.dxf --layers … --unit cm --out DIR` | wall segments in metres, texts, candidate room outlines + image | ezdxf, shapely, pillow |

PDF reader: pymupdf when installed (the `house-forge` plugin always has it), otherwise poppler-utils; both give the same words
and paths (`hstools/pdfdoc.py`, `HSTOOLS_PDF=pymupdf|poppler` forces one). The same tools ship in the plugin
(`packages/house-forge`, docs/HOUSE_FORGE.md), where `HSTOOLS_NAMES=plugin` makes intake name them as plugin commands.

Every tool prints a one-line summary and writes JSON next to images an agent can look at. None of them modifies its input.
Tests: `.venv/bin/python -m unittest discover -s tools/tests` (standard library only).
