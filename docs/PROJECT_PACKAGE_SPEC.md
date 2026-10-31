# Project package — specification

A package is a directory `projects/<id>/` with `project.json` (this document) and optional files referenced by `assets`.
Structure: `schemas/project.schema.json` (generated from `packages/core/src/package/schema.ts`); semantic rules: `src/project/validate.ts`.
`npm run project:validate -- projects/<id>` runs both. Most packages are compiled from `source/plan.json` (docs/AUTHORING.md).

Top level: `{ "schema": "home-simulator/project", "version": 1, manifest, building, interiors, electrical, site?, sun?, assets?, catalog?, views?, viewpoints? }`.

## Coordinates
Metres, right-handed, `+Z` up; `+X` right and `+Y` up on the plan; three.js `(x, y, z) → (x, z, −y)`. All heights share one
reference (`Z = 0` = lowest finished floor, usually). Describe the origin in `manifest.coordinateSystem.description`.

## manifest
| Field | Required | Meaning |
|---|---|---|
| `projectId` | yes | = directory name; lower-case letters, digits, hyphens; never change after release (user data refers to it) |
| `name`, `description`, `documentTitle` | name | display name; one line under it; title on PDFs |
| `names` | no | the name in other languages: `{ "<language code>": "…" }` (see Names in other languages) |
| `language` | no | the language the names are written in, and the preferred UI language (`en`, `pl`); the viewer's choice wins |
| `units` | yes | `"m"` |
| `coordinateSystem` | yes | `{ name, description, up: "Z", handedness: "right" }` |
| `buildingType` | yes | `house` / `apartment` (UI wording, default view) |
| `levels` | yes | `[{ id, name, names?, floorZ }]`, same as `building.rooms.levels` |
| `dataSources` | yes | where each data set comes from (human-readable) |
| `modules` | yes | subset of `site`, `environment`, `sun`, `stairs` — each needs its data |
| `capabilities` | yes | subset of `interiors`, `electrical`, `variants`, `walk` |
| `defaultView` | yes | `{ levelId, roomId?, view?: "exterior" \| "interior" }` |
| `resetNote`, `metadata` | metadata | sentence for "Restore project defaults"; free key–value pairs the engine ignores |

### Names in other languages
Every name a person reads — `manifest.name`, `manifest.levels[].name`, room names, viewpoint names and hints, view labels and
hints — is written in `manifest.language`. An optional `names` (`hints` for hints, `labels` for view labels) next to it gives
the text in other languages: `"names": { "pl": "Kuchnia" }` — two-letter language codes (`en`, `pl`). The app shows each text
in the viewer's language, else as written; nothing else in the package changes with the language. `plan.json` takes the same
fields; the build warns when a language is only partly translated (`names.missing`) or repeats the plan's language
(`names.language`). `projects/index.json` copies `manifest.names`.

## building.rooms
`{ levels: { <id>: { name, floor_z, cut_height?, plan_wall_offset? } }, rooms: Room[] }` — `cut_height` (default 2.30 m) is the
section height above the floor (the compiler writes it 10 cm above the highest window head of the level, at least 2.30 m and
below the ceiling, unless `plan.json` sets `cutHeight`); `plan_wall_offset` half the wall thickness drawn on plans.

Room: `id`, `name`, `label?`, `names?` (the name in other languages), `level`, `floor_z`, `polygon` (inner wall faces), `bbox`, `rectangular`, `area`, `area_data`
(printed area or `area`), `id_source`, `ceiling` (`{ kind: "flat", z }` absolute height; `{ kind: "roof", flat_z }` under the roof
of the room's level — the underside of `building.roof` there, capped by the flat top `flat_z`; or, in packages written before the
roof, `{ kind: "attic", flat_z, ridge_y | ridge_x, z_at_ridge, slope }` — ridge along X at `ridge_y` or along Y at `ridge_x`,
absolute heights, `slope` in m per m; a level whose rooms all share one attic ceiling gets a gable roof with those planes at
load), `doors[]` (gaps: `{ along: "X"|"Y", from_, to, across: [face, face], width, door_id | null, leaf, height }`
— the same gap appears in both rooms; `door_id: null` = passage), `openings[]` (windows: `{ id, kind, plane_axis, inner, from_, to,
sill_z, head_z }` — `plane_axis` is the axis whose coordinate is constant on the wall, `inner` the room-side face; `sill_z`,
`head_z` and `polygon_YZ` heights are absolute project Z like `ceiling.z`, while door gap `height` is above the room floor),
`stair_opening` (`[x0, y0, x1, y1]` or null), `roof_windows` (`[]`), `kind` (bath, kitchen, garage, tech, hall, bed, living,
office, storage, room), `tags` (`kitchen`, `garage`).

Walls (`<room>-w<n>`, n = edge index of the outline in counter-clockwise order), wall runs and mount surfaces are derived. Ids
`EXT`, `exterior` (rooms) and `SITE` (levels) are reserved. Released packages must not change room ids, vertex counts or order
(`ids.lock.json`).

## building.doors
`{ id, level, rooms: [a, b | "exterior"], floorZ, opening: { along, from, to, faces, width, height }, leafWidth, height, type
(hinged-single | hinged-double | sliding | pocket), hinge, closedDir, openDir, hingeSide, swingInto, openAngle, slide
({ origin, dir, travel } | null), source[], confidence, notes?, flush? }`. Hinged doors rotate around `hinge` from `closedDir` to
`openDir`; sliding doors move along `slide.dir`. Doors to the exterior are drawn, opened and walked through like any other.

`building.doorFacts` (optional): `overrides` (`{ <doorId>: { flush?, source } }`), `passableOpenings` (window ids of floor-level
glazed doors one can walk through onto the site). `building.stairs`: two-flight U-turn stairs `{ id, kind: "u-turn", fromLevel,
toLevel, bbox, risers, riser, tread, flightWidth, gap, landingZ, topZ, split, run, landingEdge, confidence, note?, orient? }` —
`split` and `landingEdge` in the canonical frame (lower flight rising towards −Y on the larger-X side); `orient: { rotate: 0 | 90
| 180 | 270, mirror }` turns it counter-clockwise onto `bbox` after mirroring (docs/WALK_AND_STAIRS.md).
`building.shell`: generated-shell parameters `{ exteriorWall = 0.30, slab = 0.25 }`.

## building.roof
Optional (ADR 0027–0029; the format version stays 1). Metres, absolute z. `{ covering, buildup, parts[], dormers?, chimneys?,
source?, confidence? }` — `covering` and `buildup` are the thicknesses of the covering and of the structure under it, across the
planes. A plane is `{ n: [nx, ny, nz], d }` (unit normal pointing up, `n·p = d`); a part lies **above** its planes, which are the
underside of its structure — the ceiling of the rooms below.
- Part: `{ id, level, type: gable | hip | shed | flat, rect? | polygon? (outer wall faces; a polygon only for flat), extent:
  [x0, y0, x1, y1][] (the outline grown by the overhangs, plus the strips that carry a wing into the wing it joins, up to that
  wing's ridge), extentPolygon? (flat part over a polygon), planes[], parapet?, ridge?, pitch? }`. The roof over a level is the
  union of its parts: at each point the highest part, each part the lowest of its planes; the covering top is every plane raised
  by `covering + buildup` across itself. The walls of the level rise to the underside; its rooms open into it up to their flat top.
- Dormer: `{ id, part, type: gable | shed, front: N | S | E | W, rect (outer faces of its walls), inner (the room space it adds),
  extent (its roof), planes[], window? }` — `window: { id, roomId, width, sill_z, head_z }` only for a front set back from the
  wall (a front in a wall plane holds an ordinary room window).
- Chimney: `{ id, rect, bottom, top }` — a box from `bottom` (the slab underside of the lowest level it stands in) to `top`.
Room roof windows (`roof_windows[].plan_rect`) are cut through the roof perpendicular to the plane over their centre, with a
frame in the slope. A phone with an app installed before roofs cannot open a package with `kind: "roof"` ceilings until the app
is updated (docs/PHONE.md).

## interiors, electrical
- `interiors.items[]`: `{ key, room, catalogId, variant, x, y, rot, dims?, elevation?, materialId?, group?, source, basis, note }`
  — default furnishing (`rot` 0: front faces +Y, 90: −X). Wall-mounted catalog items get their mount record computed.
- `interiors.notIncluded[]` (`{ room, what, why }`), `extra?` (placements per room), `notes?` (per room text).
- `electrical.points[]`: `{ id, type, roomId, x, y, heightAFFL, width?, label, source, status, notes? }` — on a wall of the room
  (≤ 5 cm), `type` from the device catalog (`socket-1`, `socket-2`, `switch`, `board`, …).

## Optional data
| Field | Module | Meaning |
|---|---|---|
| `site` | `site` | `{ footprint, boundary, groundLevel, levelId, walkBounds? }` — terrain is flat at `groundLevel` unless `assets.site` |
| `sun` | `sun` | `{ lat, lon, gridAzimuthX, convergence, trueAzimuthX, confidence, uncertaintyDeg, timeZone (IANA), placeName? }` |
| `assets` | — | `{ model?, site?, environment?, bounds?, sectionCaps?, plinthExtra?, groundMeshes? }`, paths relative to the package |
| `catalog` | — | `{ furniture?, materials? }` extension files; ids prefixed `<projectId>:` |
| `views` | — | `{ presets: [{ id, label, icon, hint, dir? \| pose?: { position, target, fov }, fit? }], home? }` |
| `viewpoints` | — | `[{ id, name, names?, p, level \| "SITE", look: [x, y, h], fov, hint, hints? }]` — walk starts |

### Model conventions (assets)
- `model`: any GLB in project coordinates mapped to glTF (`x`, `z` up → glTF `y`, project `y` → glTF `−z`); the engine wraps it
  in a `HOUSE` node. `sectionCaps: { <level>: ["WALL_L0_", …] }` — name prefixes of meshes a level section closes;
  `plinthExtra` — meshes a room cut-away opens. Material names containing `Window` / `Glass` get tuned glass and frames.
  Node extras `confidence` colour the model in expert mode. `bounds` frames the camera (default: from rooms).
- `site` / `environment`: material names from `SITE_KINDS` (`src/home/three/siteStyle.ts`, e.g. `MAT_Terrain_Design`,
  `MAT_Paving_Driveway`, `MAT_Paving_Terrace`, `MAT_Gravel`, `MAT_Env_Road`) get procedural surfaces; a node `ENV_TREES` turns
  see-through between camera and building. `groundMeshes` limits the walkable terrain meshes.

### Catalog extensions (catalog)
`catalog.furniture` and `catalog.materials` name JSON files in the package with the shape of the engine catalogs:
`{ categories?: [{ id, name, names?, icon }], items: [CatalogItem] }` and `{ categories?: [{ id, name, names?, surfaces }],
materials: [MaterialDef] }` (see `data/*.json` for complete items; `src/project/catalogs.ts` for the required fields and
defaults). Every id — items, materials, categories — starts with `<projectId>:` and never repeats an engine id. Items may use
engine categories and materials or the project's own; a parametric item names an engine generator, otherwise
`runtimeModel: { type: "glb", url: "models/x.glb" }` with a path relative to the package. `names: { "pl": "…" }` translates a
name. The loader checks the files before the package, so default furniture may place project items.

## Validation (summary)
Format and version; levels consistent; every level has rooms; ids unique (rooms, doors, windows, furniture keys, points); every
reference resolves; reserved ids unused; orthogonal outlines without a model; module data present; views have `dir` or `pose`;
catalog ids exist (engine or the package's own catalog files, which are checked first).
