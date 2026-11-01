# Reading roofs

The roof is part of the package: it closes the building from outside and gives the rooms under it their sloped ceilings (one
source — the 1.40 / 2.20 lines, the furniture checks and the 3D view all come from it). Describe it in the `roof` block of
`plan.json` whenever the drawings show one; a level `slope` alone still works (it becomes one gable over that level).

## Where the facts are on the drawings

| Drawing | What to read |
|---|---|
| Attic floor plan | the **1.40 / 2.20 height lines** — dashed lines parallel to the eaves, labelled at the margin; the ridge runs parallel to them; **knee wall** (ścianka kolankowa) height, e.g. "h = 100", "ścianka kolankowa 1,0 m"; roof windows (rectangles with "78/140"); dormers (a bay in the outline with its own window) | <!-- i18n-ok: drawing terms in Polish -->
| Section A-A (przekrój) | **pitch** — "kąt nachylenia dachu 40°", "∠ 40°", "40°" on the slope; knee wall height; **ridge height** — "kalenica +8,45", "wysokość budynku 8,45 m" (above ±0.00 = the finished ground floor); the eaves overhang | <!-- i18n-ok: drawing terms in Polish -->
| Roof plan (rzut dachu, widok z góry) | **ridges** (kalenica) — the top lines; **hips** (narożnik) — diagonal lines from the corners up to the ridge; **valleys** (kosz) — diagonal lines from an inner corner; the **eaves** outline (okap) around the walls; chimneys (komin), roof windows, dormers; arrows down the slope with the pitch | <!-- i18n-ok: drawing terms in Polish -->
| Elevations (elewacje) | the roof type (gable ends show a triangle of wall, hips do not); dormers and their windows; chimneys above the ridge |

PDF sheets: `python3 tools/pdf/sheet_text.py SHEET.pdf --out DIR --find pitch,ridge` lists the angles and the ridge heights it
finds (`words.json › found`). Raster plans: read them off the image. Quote what you read in `source`.

## Writing it

```jsonc
"roof": {
  "ridgeHeight": 8.45,                     // from the section — checked against the built roof (±10 cm)
  "eaves": 0.5, "verge": 0.3,              // overhangs [m]: at the eaves, at a gable end (defaults)
  "covering": 0.05, "buildup": 0.25,       // covering and structure thickness [m] (defaults)
  "parts": [
    { "id": "main", "level": "L1", "type": "gable", "rect": [0, 0, 12, 8], "ridge": "X", "pitch": 40, "knee": 1.0 },
    { "id": "wing", "level": "L1", "type": "gable", "rect": [0, 8, 6, 14], "ridge": "Y", "pitch": 40, "knee": 1.0 }
  ],
  "dormers": [
    { "id": "DG1", "part": "main", "type": "gable", "rect": [5, 0, 7, 2], "front": 2.3, "pitch": 40,
      "window": { "id": "W9", "room": "R5", "width": 1.2, "sill": 0.9, "head": 2.1 } }
  ],
  "chimneys": [ { "id": "C1", "rect": [3.6, 5.0, 4.2, 5.6], "top": 9.2 } ]
}
```

- **Parts** are rectangles of the walls under them — `rect` = the OUTER faces (points, like room rects), or `rooms: [ids]` (their
  outline grown by the exterior wall), or nothing (the whole level, if its outline is a rectangle). `level` = the storey the roof
  sits on: its rooms get their ceilings from the part.
- `type`: `gable` (two planes, triangles of wall at the ends), `hip` (four planes; `pitchEnds` for steeper or flatter ends),
  `shed` (one plane falling to `down`: N / S / E / W), `flat` (`pitch` 0–5, a `polygon` outline allowed, `parapet` height).
- Height: `knee` = height above the floor of the level where the underside of the roof meets the OUTER face of the eaves walls
  (the knee wall). Instead, `lines` like a level slope: `[{ "at": 1.2, "height": 1.4 }, { "at": 2.2, "height": 2.2 }]` (the
  1.40 / 2.20 lines, `at` across the ridge). Neither → a roof resting on the ceiling of the level (ceiling + slab): the usual
  "roof over the upper floor" with a cold attic.
- **L, T, U**: one part per wing, each its own rectangle. A wing whose end meets another wing with a crossing ridge (at least as
  high) is carried into it up to its ridge — valleys, and a lower ridge running into the higher roof, come out by themselves. Give
  joined wings the same knee height (their eaves meet; a difference over 2 cm is a warning).
- **Dormers**: `rect` = the outer faces of its walls; its front faces down the slope it stands on; the back is carried to the
  ridge. A front in the plane of the wall below (the most common in plans) holds an ordinary room window (`window` → the room's
  wall); a front set back on the roof gets its own window (`sill` / `head` between the roof below and the dormer roof). `front` =
  height of the dormer roof's eaves above the floor.
- **Roof windows**: the top-level `roofWindows` (`room`, `rect` seen from above) — inside one sloped plane of that room's ceiling.
- **Chimneys**: `rect` (points), `top` above z = 0; they stand from the slab of the lowest level they are in. A duct that starts
  at a ceiling — a kitchen hood vent drawn dashed on the plan below — gets `from` = the level it stands in first.
- Rooms on a roofed level keep their flat ceiling (`ceiling` or the level's) as the flat top (collar ties); the roof cuts it
  where it is lower. A level `slope` given together with the roof is a cross-check (a difference over 5 cm is a warning).

## When a fact is missing

- No pitch anywhere → ask ONE question: "What is the roof pitch — 30°, 35°, 40°, 45°, or don't you know?" "Don't know" → 40° and
  `"confidence": "probable"` on the roof, noted in the README.
- No knee wall height on an attic → the 1.40 / 2.20 lines give it (`lines`); with neither, ask for one of them.
- No roof drawn at all (only floor plans of a house) → say so; a gable over the top level with 40° and the default knee is a
  placeholder the user should confirm.

## Checks (errors stop the build)

- `roof.cover` — walls of a level are under no part (and no level above them) — exact area, a corner left out of a polygon
  counts; `roof.levelAbove` — a level stands on a part.
- `window.roof` / `door.roof` — an opening higher than the roof plane at its wall (lower it, or put it in a dormer); a gable
  glazing (`outline`) may rise past the flat ceiling up to the roof plane.
- `chimney.level` — `from` names no level; `chimney.outside` — the chimney is not over the walls of that level.
- `roofWindow.plane` — a roof window across a ridge, a hip, a valley or the flat top; `dormer.plane` / `dormer.high` — a dormer
  across two planes, or higher than the roof behind it.
- `roof.pitch` — pitched parts 5–75°, flat 0–5°.
- Warnings: `roof.hip` (the ends meet before the ridge: a pyramid), `roof.eaves`, `roof.ridgeHeight`, `roof.slope`,
  `roof.missing` (a part of the building with nothing above it — also when there is no roof block: a ground floor
  larger than the floor above stays open there), `chimney.low`.

Usable areas under a roof (PN-ISO 9836: full above 2.20 m, half between 1.40 and 2.20 m) are compared with `areaPrinted` too —
put the printed number as it is.

## Preview

`npm run -s project:preview -- projects/<id>` writes `preview/roof.png`: the planes shaded by their slope, ridges and hips (red),
valleys (blue), eaves, dormers, chimneys, roof windows, the walls below dashed and the height of the top. Compare it with the roof
plan or the elevations; the plan previews show the 140 / 220 lines the roof gives each room under it.
