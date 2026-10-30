# Known limitations

What the engine and its tools do not do yet, grouped by area. Every item was checked against the code; the file that holds
the behaviour is named in brackets. When a limit is lifted, remove it here in the same change.

## Geometry and project package

- **Generated walls need an orthogonal plan.** A project without a building model file gets its shell computed from the room
  outlines. Every room edge must run along X or Y: doors and windows are placed on walls along the plan axes, the compiler
  rejects a slanted edge (`room.orthogonal`), and validation rejects a package without `assets.model` whose outlines are not
  axis-aligned (`packages/core/src/model/building.ts`, `packages/core/src/authoring/compile.ts`, `src/project/validate.ts`).
- **Roofs are unions of rectangular wings.** A generated building is one closed solid per level (the room outlines grown by
  the exterior wall, minus the rooms, the openings and the stair shaft) and one roof solid per level with roof parts
  (`packages/core/src/solid/levels.ts`, `roofSolid.ts`). A pitched part (gable, hip, shed) covers one axis-aligned rectangle;
  only a flat part may cover a polygon. L-, T- and U-shaped roofs are several wings; a wing whose end meets a crossing wing is
  carried into it up to its ridge — joins between parallel wings, or of a shed with another wing, are not resolved (they meet as
  given). Different overhangs of two joined wings (eaves 0.5 against a verge 0.3) leave a small step at the outer corner. No
  roof follows a slanted outline (no straight skeleton), and there are no mansard, gambrel, barrel or conical roofs. Dormers are
  gable or shed boxes on one plane; eyebrow, hipped and wall dormers are not supported. Chimneys are boxes from the slab of the
  lowest level they stand in (inside a room they stand there as a column).
- **The grid fallback has no roof.** With `?shell=grid`, or when the solid kernel cannot run, the shell is the older grid of
  boxes with a flat slab on the top level; sloped ceilings are then only the interior finishes.
- **Old packages: one gable per attic level.** A package written before roofs had attic ceilings only; at load a level whose
  rooms all share one attic ceiling gets a gable with the same planes, the default thicknesses and overhangs
  (`roofFromAttic`, `packages/core/src/model/roof.ts`). A level that mixes attic and flat ceilings gets no roof (its attic
  rooms keep their sloped ceilings inside a flat-topped level). Rebuilding from `plan.json` gives the full roof.
- **A lower level not covered by the one above is open without a roof part.** Where an upper level is smaller than the one
  below it, the part of the lower level outside it needs a roof part (flat or pitched); without one it stays open at the top
  (the compiler warns: `roof.missing`).
- **The roof is hidden in the section of the level it covers.** The level section and the room views show the rooms under the
  slopes from above with the walls cut; the roof itself (and its roof windows) is not cut but hidden there
  (`src/home/scene/CoreShellLayer.tsx`). Wall finishes do not cover the cheeks of a dormer (they show the plain shell wall).
- **The solid kernel needs WebAssembly and module workers.** The shell is built with manifold-3d (WASM, ~0.5 MB, ~0.2 MB
  gzipped) in a worker (`src/home/three/coreWorker.ts`). Where it cannot load or run, the older grid shell is shown
  instead; `?shell=grid` forces it. The grid shell (`packages/core/src/model/gridShell.ts`) stays for one release and still
  gives the wall mass of the plan views.
- **One stair type.** `StairDef` supports only `kind: "u-turn"`: two flights with the same number of risers, a landing and a
  gap between the flights. Straight, L-shaped, winding and spiral stairs are not supported. The stair box is axis-aligned; it
  can face any of the four directions and turn either way (`up`, `turn` in `plan.json`), but not stand at another angle
  (`packages/core/src/model/stairs.ts`).
- **Stair geometry is not editable in the app.** The user chooses only the finish (treads, risers, handrail, balustrade);
  step count and size are building data (`src/home/model/stairsConfig.ts`).
- **Wall ids depend on the outline.** A wall id is `<room>-w<n>`, where `n` is the edge index of the room outline in
  counter-clockwise order from the corner with the smallest y, then the smallest x. Adding a vertex or moving the first corner
  shifts the ids, and user data (finishes, wall-mounted objects, electrical points) refers to them. Mitigation: build with
  `--lock` once the project is in use; `ids.lock.json` then makes the compiler refuse such a change unless `--force-relock` is
  given. Neither example project ships a lock file.
- **Project catalogs only extend.** Furniture and materials come from `data/furnitureCatalog.json` and
  `data/materialCatalog.json`; a package may add items in its own files (`catalog.furniture` / `catalog.materials`, ids
  `<projectId>:…`). It cannot change or hide an engine item, and a new
  parametric item must use one of the engine's generators — anything else needs a GLB model. Names of project items are
  translated only through their own `names` field. Users can also import GLB furniture in the app (it lives in the user
  document).
- **Fixed vocabularies.** Room `kind` is one of bath, kitchen, garage, tech, hall, bed, living, office, storage, room;
  `buildingType` is `house` or `apartment`. Behaviour keyed on anything else needs an engine change.
- **Project ids are permanent.** `manifest.projectId` names the user's saved data; renaming it orphans that data.

## Print export

- **Only the last level's roof comes off.** The print is one part per level and a removable roof over the last level; a roof
  over a lower level (a wing beside a smaller upper floor) is printed with that level, and its rooms are closed under it
  (`packages/core/src/print/parts.ts`). There are no connectors: the parts stand on flat faces and are not glued or keyed.
- **The split is horizontal.** Over a cold roof space the roof part starts at the ceiling, so eaves reaching lower are cut
  flat at that height (`eaves.cut` says how much); under the slopes it starts at the bottom of the eaves, so the walls of the
  rooms there are mostly in the roof part. Rooms with a flat top under the slopes (collar ties) and shallow dormer roofs are
  overhangs inside the roof part — the report lists them as needing supports.
- **Stairs are solid blocks.** They stand on the floor of their lower level; the steps inside the slab of the upper level are a
  small block in that level's part (left out when lower than 0.5 mm on the print, as at 1:300). The opening in the upper slab
  is the whole stair outline, as in the app. Railings, glass, window frames in walls, door leaves and furniture are not
  printed; roof and dormer windows are recesses with a frame, left out when they are too small at the scale.
- **Printability is judged, not simulated.** Thin spots come from horizontal sections at a few heights; overhangs from face
  angles, with bridges recognised only when held on two opposite sides of an axis-aligned region. Nothing measures warping,
  first-layer adhesion or the strength of the parts; the owner's test print decides (`print-report.json` says what was
  changed and what needs supports).
- **Standard scales and 90° turns only.** The automatic scale is the largest of 1:50 … 1:300 that fits; a part is never placed
  diagonally on the bed and never split to fit. A building too large for the bed at 1:300 is not printable.

## Authoring and import

- **Model files are not made by the tools.** `plan.json` can name a building, terrain or surroundings GLB (`assets`), camera
  views and catalog files; the compiler copies them into `project.json` as given. Producing the GLB is up to the author, and
  only `npm run project:validate` checks that the files exist.
- **No double or folding doors.** Doors are `hinged-single`, `sliding` or `pocket`. The package format reserves
  `hinged-double`, but the engine draws and animates a single leaf only, and `plan.json` cannot express it. A bifold door is
  modelled as one hinged or sliding leaf.
- **Raster calibration is a heuristic.** `tools/image/calibrate.py` estimates the scale from a scale bar, printed areas, the
  total area or typical symbol sizes. Two estimates within 5 % are required, but the result still needs a human check against
  one real dimension and the preview. Typical accuracy:
  1 to 3 % on room sizes, about 5 cm on door and window positions ([IMPORT_RASTER.md](IMPORT_RASTER.md)).
- **Reading the drawing is done by the agent**, not by computer vision. Room outlines, door swings and windows depend on the
  agent's reading; the preview comparison is the safety net.
- **DWG needs the external ODA File Converter** (`ODA_FILE_CONVERTER`, headless via `xvfb-run`). DXF files and the rest of the
  tools work without it ([IMPORT_CAD.md](IMPORT_CAD.md)).
- **CAD layer mapping needs judgement.** `dxf_walls.py` proposes candidate rooms with orthogonal outlines only; layer choice
  and units must be confirmed with a dimension, because DXF header units are often wrong.
- **Vector PDF import needs poppler** (`pdftotext`, `pdftocairo`, `pdftoppm`) and a confirmed drawing scale
  ([IMPORT_PDF.md](IMPORT_PDF.md)).
- **Python 3.11 is needed for imports only.** The engine and the build need Node.js only.

## Scene and walk

- **No camera or walk obstacles from trees.** The surroundings model carries no tree data the engine reads:
  `treeObstacles()` returns an empty list, so exterior views do not avoid trees, and the walk world is built with no
  obstacles, so you can walk through trees (`src/home/scene/CameraController.tsx`, `src/home/scene/WalkLayer.tsx`). Trees in a
  node named `ENV_TREES` only turn see-through between the camera and the building.
- **Walking outside needs the `site` module.** Without it the walk stays inside the building. Terrain is flat at
  `site.groundLevel` unless the package brings a terrain model.
- **Level changes only by stairs.** A walk moves between levels only on a `u-turn` stair of the package.
- **Default views are generic.** A compiled project gets "Overview", "Other side" and "From above" plus "Interior"; named
  views need `views` in the package, which `plan.json` cannot write (see above).
- **Software rendering is slow.** Without GPU acceleration (SwiftShader, llvmpipe) the scene works but is very slow; Settings
  shows the renderer.

## Electrical

- **A concept plan, not an installation design.** Points carry room, wall, distance from a corner and height. There are no
  circuits, cable routes, loads or standards checks; the circuit field is free text.
- **Warnings never block.** Points within openings, next to sanitary fittings, behind tall units or near a door leaf are only
  flagged.
- **PDF font coverage.** The PDF embeds a DejaVu Sans subset. A character the font lacks is spelled out or replaced by "?", and
  the export reports how many were replaced (`src/home/pdf/pdfText.ts`).
- **Kitchen socket proposals** recognise appliances by the furniture name in the UI language (fridge, oven, hob, dishwasher);
  other appliances get no proposal, and proposals carry no power ratings.

## Storage and sync

- **Saving to the PC needs the app's own server.** The document goes to `userdata/<id>/document.json` through
  `/__api/document`, which only `npm run dev`, `npm run preview` and the phone `serve` command provide. Static hosting saves to
  the device only.
- **Size limits:** a project document up to 8 MB, an imported model up to 50 MB (GLB or glTF with embedded resources).
- **Conflicts are resolved by choice, not merged.** When the file and the device both changed, the user keeps one version; the
  other goes to the backups. Only the last 8 backups per project are kept on the device.
- **Device data lives in the browser.** Clearing site data in the browser deletes the device copy and the backups. "Protect
  data" (Settings → App and data) asks for persistent storage, but the browser may refuse it.
- **No migration from other applications.** The document format starts at `home-simulator/document` version 1
 .

## Phone and PWA

- **Android with Chrome only.** The phone flow uses `adb` and opens Chrome (`com.android.chrome`). iOS is not covered
 .
- **Port 4170 is fixed.** The phone treats `http://localhost:4170` as the app. Offline data belongs to that origin; another
  port is another app with separate, empty storage ([PHONE.md](PHONE.md)).
- **Saves reach the PC only while the cable is connected and `serve` runs.** Otherwise they wait on the phone.
- **Offline mode needs a production build.** The service worker is registered only in a built app (`npm run preview`, phone
  `serve`), never under `npm run dev`.
- **Updates are manual.** A new version waits until the user presses "Update"; the app never reloads by itself.

## Projects, tabs and language

- **One tab = one project.** Engine models are derived for the active package; switching projects in place is not supported.
  Switching saves the current project and reloads the page.
- **An unknown `?project=` id is ignored silently**; the app opens the tab's, the last or the default project instead.
- **Switching the language reloads the page.** Labels derived per package may be cached, so the change is applied on reload.

## i18n

- **Two languages: English and Polish.** The language list in `src/i18n/index.ts` is fixed; a new language needs its
  dictionaries and an entry there.
- **No plural rules.** Counted phrases use neutral forms ("Rooms: 4").
- **Package texts are not translated.** Room names, level names, view labels and notes are shown as the package wrote them.
- **Catalog names:** English names live in `data/*.json`; other languages translate them by key (`furniture.<id>`,
  `material.<id>`). A missing translation falls back to English.
