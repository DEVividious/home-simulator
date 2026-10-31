# Error messages and fixes

## Build (npm run project:build) — fix in plan.json

| Code | Meaning | Fix |
|---|---|---|
| `schema` | a field is missing, misspelled or has the wrong type | compare with `schemas/plan.schema.json` / skills/home-from-plan/references/plan-schema.md |
| `calibration` | `units: "px"` without a calibration block | run `tools/image/calibrate.py … summary` and paste its block |
| `calibration.methods` / `calibration.agreement` (warning) | fewer than two scale estimates / they differ by > 5 % | add an independent estimate or ask the user for one real dimension |
| `room.orthogonal` | an outline edge is slanted | make edges horizontal / vertical (the generated shell needs it) or provide a GLB model |
| `room.overlap` | two rooms of a level overlap | outlines are inner faces — rooms must be separated by the wall |
| `wall.thickness` (warning) | a shared wall is neither the interior nor the exterior thickness | align the faces if the drawing shows the standard thickness; if most interior walls have that thickness set `defaults.interiorWall`; a few thicker walls (load-bearing, installation walls) are fine as drawn — the generated shell fills the real gap; say so in the README |
| `door.swingOverlap` (warning) | two door leaves sweep the same floor | re-read the arcs on the drawing (hinge side, which room); an entrance door drawn with its arc outside opens outwards: `"swingInto": "exterior"`; a real clash stays — note it in the README |
| `door.wall` | no wall between the two rooms holds an opening of that width at `at` | move `at` into the wall between them; check the room ids; check that the width fits the shared wall length |
| `door.swing` | `swingInto` is not one of the two rooms (or `exterior` for an outside door) | use a room id of `between`; for an outside door that opens outwards, `"exterior"` |
| `window.wall` / `window.span` | `at` is not on a wall of the room / the window is longer than the wall | put `at` on the wall line; check the width |
| `window.interior` (warning) | a window on a wall shared with another room | probably the wrong room or wall |
| `stairs.*` | box too short for the treads (`stairs.depth`: and the landing) / centre not in a room of both levels / unusual riser / box width across the flights | see authoring-conventions.md § Stairs: check `kind` (straight, l-turn, u-turn), the risers of each flight and the tread; `up` and `turn` set the direction |
| `furniture.ceiling` (warning) | an item is taller than the sloped ceiling above part of it | move it towards the ridge, choose a lower variant or give `dims.h`; a knee-wall cupboard is fine below 1.40 |
| `furniture.catalog` / `furniture.variant` | unknown catalog id / variant | skills/home-from-plan/references/catalog-ids.md |
| `furniture.outside` (warning) | the centre of an item is outside its room | wrong room id or coordinates |
| `electrical.wall` (warning) | a point is not on a wall of its room | use `wall` + `along` |
| `site.boundary` | the building is not inside the plot | larger `margin` or correct `boundary` |
| `sun.timeZone` | not an IANA time zone | e.g. `Europe/Berlin`, `America/New_York` |
| `ids.lock` | a released room changed its outline order | revert, or `--force-relock` after warning the user that saved furniture and electrical points on that room may move |

## Validation (npm run project:validate and the app at load time)

| Message | Fix |
|---|---|
| `manifest.projectId "x" ≠ id in the project index "y"` | the directory name must equal `project.id` |
| `level "X": no rooms` | every level needs at least one room |
| `room "R": unknown level` / `door "D": unknown room` | ids must match exactly (case-sensitive) |
| `room "R": door gap points to unknown door` | hand-written package: add the door to `building.doors` |
| `a project without a building model file (assets.model) needs orthogonal room outlines` | as `room.orthogonal` |
| `module "site" requires …` | enabled module without its data — add the data or remove the module |
| `view "v": needs a direction (dir) or a camera pose (pose)` | add one of them |
| `furniture "k": unknown catalog item` | see catalog-ids.md |
| `assets.model: file … not found` | put the GLB into the project directory or fix the path |
