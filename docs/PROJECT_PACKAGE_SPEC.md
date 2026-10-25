# Project package — specification

A package is a directory `projects/<id>/` with `project.json` (this document) and optional files referenced by `assets`.
Structure: `schemas/project.schema.json` (generated from `src/project/schema.ts`); semantic rules: `src/project/validate.ts`.
`npm run project:validate -- projects/<id>` runs both. Most packages are compiled from `source/plan.json` (docs/AUTHORING.md).

Top level: `{ "schema": "home-simulator/project", "version": 1, manifest, building, interiors, electrical, site?, sun?, assets?, catalog?, views?, viewpoints? }`.

## Coordinates
Metres, right-handed, `+Z` up; `+X` right and `+Y` up on the plan; three.js `(x, y, z) → (x, z, −y)`. All heights share one
reference (`Z = 0` = lowest finished floor, usually). Describe the origin in `manifest.coordinateSystem.description` (ADR 0008).

## manifest
| Field | Required | Meaning |
|---|---|---|
| `projectId` | yes | = directory name; lower-case letters, digits, hyphens; never change after release (user data refers to it) |
| `name`, `description`, `documentTitle` | name | display name; one line under it; title on PDFs |
| `language` | no | preferred UI language (`en`, `pl`); the viewer's choice wins |
| `units` | yes | `"m"` |
| `coordinateSystem` | yes | `{ name, description, up: "Z", handedness: "right" }` |
| `buildingType` | yes | `house` / `apartment` (UI wording, default view) |
| `levels` | yes | `[{ id, name, floorZ }]`, same as `building.rooms.levels` |
| `dataSources` | yes | where each data set comes from (human-readable) |
| `modules` | yes | subset of `site`, `environment`, `sun`, `stairs` — each needs its data |
| `capabilities` | yes | subset of `interiors`, `electrical`, `variants`, `walk` |
| `defaultView` | yes | `{ levelId, roomId?, view?: "exterior" \| "interior" }` |
| `resetNote`, `metadata` | metadata | sentence for "Restore project defaults"; free key–value pairs the engine ignores |

## building.rooms
`{ levels: { <id>: { name, floor_z, cut_height?, plan_wall_offset? } }, rooms: Room[] }` — `cut_height` (default 2.30 m) is the
section height above the floor (the compiler writes it 10 cm above the highest window head of the level, at least 2.30 m and
below the ceiling, unless `plan.json` sets `cutHeight`); `plan_wall_offset` half the wall thickness drawn on plans.

Room: `id`, `name`, `label?`, `level`, `floor_z`, `polygon` (inner wall faces), `bbox`, `rectangular`, `area`, `area_data`
(printed area or `area`), `id_source`, `ceiling` (`{ kind: "flat", z }` absolute height, or `{ kind: "attic", flat_z, ridge_y,
z_at_ridge, slope }`), `doors[]` (gaps: `{ along: "X"|"Y", from_, to, across: [face, face], width, door_id | null, leaf, height }`
— the same gap appears in both rooms; `door_id: null` = passage), `openings[]` (windows: `{ id, kind, plane_axis, inner, from_, to,
sill_z, head_z }` — `plane_axis` is the axis whose coordinate is constant on the wall, `inner` the room-side face; `sill_z`,
`head_z` and `polygon_YZ` heights are absolute project Z like `ceiling.z`, while door gap `height` is above the room floor),
`stair_opening` (`[x0, y0, x1, y1]` or null), `roof_windows` (`[]`), `kind` (bath, kitchen, garage, tech, hall, bed, living,
office, storage, room), `tags` (`kitchen`, `garage`).

Walls (`<room>-w<n>`, n = edge index of the outline in counter-clockwise order), wall runs and mount surfaces are derived. Ids
`EXT`, `exterior` (rooms) and `SITE` (levels) are reserved. Released packages must not change room ids, vertex counts or order
(ADR 0009, `ids.lock.json`).

## building.doors
`{ id, level, rooms: [a, b | "exterior"], floorZ, opening: { along, from, to, faces, width, height }, leafWidth, height, type
(hinged-single | hinged-double | sliding | pocket), hinge, closedDir, openDir, hingeSide, swingInto, openAngle, slide
({ origin, dir, travel } | null), source[], confidence, notes?, flush? }`. Hinged doors rotate around `hinge` from `closedDir` to
`openDir`; sliding doors move along `slide.dir`. Doors to the exterior are drawn, opened and walked through like any other.

`building.doorFacts` (optional): `overrides` (`{ <doorId>: { flush?, source } }`), `passableOpenings` (window ids of floor-level
glazed doors one can walk through onto the site). `building.stairs`: two-flight U-turn stairs `{ id, kind: "u-turn", fromLevel,
toLevel, bbox, risers, riser, tread, flightWidth, gap, landingZ, topZ, split, run, landingEdge, confidence, note? }`.
`building.shell`: generated-shell parameters `{ exteriorWall = 0.30, slab = 0.25 }`.

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
| `viewpoints` | — | `[{ id, name, p, level \| "SITE", look: [x, y, h], fov, hint }]` — walk starts |

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
