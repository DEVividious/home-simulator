# Importing a vector PDF sheet

Architectural PDFs exported from CAD keep text and vector paths. Tools (poppler + python):

| Command | Result |
|---|---|
| `tools/pdf/sheet_text.py SHEET.pdf --out DIR` | `words.json`: words with positions (pt, y down), printed areas, numbers, drawing scale (1:N) |
| `tools/pdf/sheet_svg.py SHEET.pdf --out DIR` | `paths.json` (all paths in pt), `sheet_grid.png` (page with a grid labelled in pt) |
| `tools/pdf/door_arcs.py SHEET.pdf --out DIR --scale N` | `arcs.json`: door swing arcs — hinge and both leaf ends in pt and metres, leaf width |

Scale: `pt per metre = 72 / 0.0254 / N`. Confirm it with a printed dimension. Then either convert coordinates yourself
(`"units": "m"`) or write `"units": "px"` with `calibration: { pxPerM: <pt per metre>, originPx: [<pt of the origin>] }` — PDF
points behave like image pixels (y down).

Door arcs give the hinge (arc centre) and the room the leaf opens into (the side the arc is drawn on). Sheets with several
plans: crop the coordinates to one plan; scale notes like "1:50" may be printed once per sheet.
