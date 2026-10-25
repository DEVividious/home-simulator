# Importing CAD (DWG / DXF)

1. DWG → DXF: `tools/cad/dwg2dxf.py DRAWING.dwg -o DIR` (needs the free ODA File Converter; set `ODA_FILE_CONVERTER`; headless:
   `xvfb-run -a`). The original is copied first and never modified.
2. Overview: `tools/cad/dxf_inspect.py DRAWING.dxf --out DIR` → `layers.json` (entity counts, extents, header units, unit guess),
   `texts.json`, `all.png`, `layer_*.png`. Choose layers (skills/home-from-plan/references/cad-layer-heuristics.md) and confirm
   the unit with a dimension — the header is often wrong. Several plans on one sheet: `--box x0,y0,x1,y1` per plan.
3. Walls and room candidates: `tools/cad/dxf_walls.py DRAWING.dxf --layers "WALLS,PARTITIONS" --unit cm --text-layers "TEXT"
   --box … --out DIR/L0` → `walls.json` (segments in metres from the bottom-left of the walls, texts, candidate rooms with
   orthogonal outlines and the texts inside), `rooms.png`. Openings up to ~1.1 m are closed when looking for rooms (`--gap`).
4. Write `plan.json` in metres (rooms from candidates, doors and windows from the drawing), build, preview, compare.

Tested on a real architectural DXF: unit guess correct (cm with an mm header), all rooms of a storey found as candidates.
