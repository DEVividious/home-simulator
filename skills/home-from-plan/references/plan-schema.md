# plan.json — the authoring format

JSON Schema: `schemas/plan.schema.json` (put `"$schema": "../../../schemas/plan.schema.json"` at the top for editor help).
Worked examples: `projects/demo-apartment/source/plan.json` (flat, metres, explicit furniture positions) and
`projects/sample-house/source/plan.json` (two storeys, stairs, plot, sun, furniture against walls).

```jsonc
{
  "schema": "home-simulator/plan", "version": 1,
  "project": { "id": "my-flat", "name": "My flat", "buildingType": "apartment", "language": "en",
               "origin": "outer corner at the bottom-left of the plan; +X right, +Y up", "description": "optional one line" },
  "units": "px",                                   // "m" (project metres) or "px" (image pixels, y down) — POINTS only
  "calibration": { "pxPerM": 94.2, "originPx": [182, 1180], "methods": [ … from calibrate.py summary … ] },
  "source": "floor plan image plan.png (estate agent), scale from printed areas",
  "defaults": { "exteriorWall": 0.3, "interiorWall": 0.12, "confidence": "probable" },
  "levels": [ { "id": "L1", "name": "Apartment", "floorZ": 0, "ceiling": 2.6 } ],
  "rooms": [
    { "id": "R1", "name": "Bedroom", "level": "L1", "kind": "bed", "rect": [245, 60, 770, 572], "areaPrinted": 12.4 },
    { "id": "R2", "name": "Living room with kitchen", "level": "L1", "kind": "living", "tags": ["kitchen"],
      "polygon": [[1125, 60], [1830, 60], [1830, 1120], [1125, 1120]] }
  ],
  "doors": [
    { "id": "D1", "between": ["R3", "exterior"], "at": [210, 690], "width": 1.0, "swingInto": "R3", "hinge": "right" },
    { "id": "D2", "between": ["R3", "R1"], "at": [690, 580], "width": 0.8, "swingInto": "R1", "hinge": "left" },
    { "id": "D3", "between": ["R4", "R2"], "at": [900, 640], "width": 0.9, "type": "sliding", "slideTo": "end" },
    { "id": "D4", "between": ["R2", "R5"], "at": [1300, 640], "width": 1.4, "type": "hinged-double", "swingInto": "R2" }    // or "folding" + "hinge"
  ],
  "passages": [ { "between": ["R3", "R2"], "at": [1100, 700], "width": 1.2 } ],
  "windows": [
    { "id": "W1", "room": "R1", "at": [210, 340], "width": 1.4 },
    { "id": "W2", "room": "R2", "at": [1860, 850], "width": 2.0, "sill": 0, "passable": true },
    { "id": "W3", "room": "R5", "at": [60, 400], "outline": [[300, 0.2], [300, 1.6], [420, 2.6], [540, 1.6], [540, 0.2]] }   // a gable window
  ],
  "stairs": [ { "id": "S1", "kind": "u-turn", "from": "L0", "to": "L1", "box": [x0, y0, x1, y1], "up": "N", "turn": "left", "risers": 9, "tread": 0.27, "flightWidth": 0.95, "gap": 0.05 } ],
                                                             // or "kind": "straight" (risers = all), "l-turn" (+ "upperRisers")
  "roof": { "ridgeHeight": 8.45, "parts": [ { "id": "main", "level": "L1", "type": "gable", "ridge": "X", "pitch": 40, "knee": 1.0 } ],
            "dormers": [], "chimneys": [] },                 // houses: references/roofs.md
  "furniture": [
    { "room": "R1", "catalogId": "bed", "variant": "160", "wall": "W", "along": 300, "basis": "drawn" },   // along: px in a px plan
    { "room": "R2", "catalogId": "sofa", "variant": "3", "at": [1630, 700], "rot": 180, "basis": "drawn" },
    { "room": "R2", "catalogId": "tv-wall", "variant": "65", "wall": "S", "along": 1600, "elevation": 1.0 }
  ],
  "notIncluded": [ { "room": "R2", "what": "plant", "why": "not in the catalog" } ],
  "electrical": [ { "type": "socket-2", "room": "R1", "wall": "W", "along": 4.2, "height": 0.3, "label": "Socket by the bed" } ],
  "site": { "margin": 6, "groundLevel": -0.15 },           // houses: plot around the building (or "boundary": [[x, y], …])
  "sun": { "lat": 52.2, "lon": 21.0, "timeZone": "Europe/Berlin", "northAzimuthX": 90 },
  "viewpoints": [ { "id": "vp-entry", "name": "Entrance", "level": "L1", "at": [300, 700], "look": [900, 700, 1.5] } ],
  "notes": { "R2": "kitchen layout as drawn by the agent's plan" }
}
```

Field notes:
- `rect` / `polygon` / `at` / `box` / `boundary` / `along` are points (pixels in a px plan); `width`, `sill`, `head`, `height`,
  `elevation`, `dims`, `ceiling`, `tread`, `flightWidth`, `margin` are metres — always.
- `look` of a viewpoint: [x, y, height above the floor in metres] — x, y are points.
- Names in two languages: `name` (project, level, room, viewpoint) and a viewpoint's `hint` are written in
  `project.language`; `names` / `hints` give the other app language (`en` or `pl`), e.g.
  `{ "id": "R2", "name": "Kitchen", "names": { "pl": "<the name in Polish>" }, … }`. The app shows each name in the viewer's language. Give
  every name the same languages — the build warns (`names.missing`) when a language is only partly there, and
  (`names.language`) when `names` repeat the plan's own language.
- One image per level (px plans): give each level its own `calibration` (same block as the plan's) with `originPx` at the SAME
  building corner on every image — usually the outer bottom-left corner of the walls, which stay in place between floors.
  Every point converts with the calibration of its level (rooms, doors, windows, furniture of rooms on that level; a stair box
  with its `from` level). Check the alignment on the previews: outer walls and chimneys must coincide.
- `rot` (furniture) is in degrees in project axes, also in a px plan: 0 = the front faces +Y (up on the image), 90 = −X, 180 =
  −Y (down), 270 = +X. `elevation` (metres above the floor) works on any item, e.g. a TV on a stand or a wall cabinet.
- Doors to the outside open inwards by default; `"swingInto": "exterior"` makes one open outwards (the arc is drawn outside).
- `regularize` (default true for px plans) snaps to 5 mm, aligns faces within 4 cm and sets shared walls within 8 cm of the
  interior thickness to exactly that thickness, keeping the wall's centre line — the build prints every adjustment. When a
  printed size or area says which side is right (the centre line may move a face by 2.5 mm), put both faces where they belong
  (exactly the interior thickness apart) and the build leaves them.
- Electrical point `along` is metres in project coordinates (the compiler does not convert it) — prefer `at` in px plans.
- Optional pass-through blocks, copied into `project.json` unchanged: `assets` (a GLB of the building instead of the generated
  shell, terrain, surroundings — the last one switches on the `environment` module), `views` (camera presets with `pose`),
  `catalog` (the project's own furniture / material files, ids `<project id>:…`, docs/PROJECT_PACKAGE_SPEC.md), `capabilities`
  (sections the app offers; default all four). Use them only when the user brings such files or asks for it.
- Roof (houses): the `roof` block — parts (gable, hip, shed, flat) over rectangles of a level's walls, with the pitch and the
  knee wall height or the 1.40 / 2.20 lines; dormers, chimneys; `references/roofs.md` explains where each fact is on the drawings.
  The rooms under it get their sloped ceilings from it (a room's own `ceiling`, or the level's, is the flat top).
- Attic levels without a roof block: `slope` on the level —
  `{ "ridge": "X", "lines": [ { "at": 120, "height": 1.4 }, { "at": 210, "height": 2.2 } ], "flat": 2.5 }` becomes one gable over
  the level. `ridge` is the plan axis the ridge runs along; `lines` are the height lines drawn on attic plans (typically 1.40 and
  2.20, often dashed, labelled at the margin), `at` is their coordinate across the ridge (px in a px plan), both on the same side
  of the ridge; `ridgeAt` defaults to the middle of the level. With only one line give `pitch` (degrees). With a roof block a
  `slope` is a cross-check. Printed attic areas are often *usable* areas (50 % under 1.40–2.20 m, none below 1.40) — put the
  printed number in `areaPrinted`: the build compares it with both the floor area and the usable area.
- `roofWindows`: `[ { "id": "RW1", "room": "R5", "rect": [x0, y0, x1, y1] } ]` — windows in a sloped ceiling, seen from above
  (on Polish plans a rectangle labelled like 78/140), each inside one sloped plane.
- `notes` keys are room ids (a note about a door goes under the room it opens from); the app shows them to the user with the
  room's furnishings, so write them for the user, not as working notes.
- Unknown fields are errors — check spelling against the schema.
