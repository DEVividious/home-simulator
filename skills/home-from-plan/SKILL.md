---
name: home-from-plan
description: Build, import or update a 3D home / apartment project for Home Simulator from floor plans — CAD files (DWG, DXF), architectural PDF sheets, or plain 2D floor-plan images (PNG / JPG real-estate plans, scans, screenshots), or from a description. Use when the user says "build my home / flat from these files", "import this floor plan", "make a 3D model of my apartment", "add a room / door / window to my project", or drops a plan image. Produces projects/<id>/source/plan.json and the compiled projects/<id>/project.json, validated and previewed.
allowed-tools: Bash(python3 tools/*) Bash(.venv/bin/python tools/*) Bash(npm run project:*) Bash(npm run -s project:*) Bash(pdftotext *) Bash(pdftocairo *) Bash(pdftoppm *) Bash(mkdir -p projects/*) Bash(cp *) Read Write Edit Glob Grep
metadata:
  version: 1
  requires: node>=20; python3>=3.11 with tools/requirements.txt for CAD / PDF / raster tools; poppler-utils for PDF; ODA File Converter for DWG
---

# home-from-plan

Turn whatever the user has into a **project package** the engine loads: `projects/<id>/source/plan.json` (what you write) →
`npm run project:build -- projects/<id>` → `projects/<id>/project.json` (compiled, never hand-edited when a plan exists).

Read first, every time: `references/authoring-conventions.md` (the rules) and `references/plan-schema.md` (the format, with the
demo apartment as a worked example). Furniture ids: `references/catalog-ids.md`. Symbols on plans: `references/symbol-legend.md`.

## 0. Set up (once)

```bash
npm install                                     # engine, compiler, preview
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt   # only for CAD / PDF / raster tools
bash skills/home-from-plan/scripts/preflight.sh  # what is available
```

## 1. Intake

```bash
.venv/bin/python tools/intake.py <files…>
```

Ask the user, in one message, only what the files do not show: project id (lower-case, hyphens — it never changes later),
display name, house or apartment, which file is which level, and known facts (ceiling height, total area, floor of the flat,
where north is if they care about sunlight). Record answers in `plan.json` (`project`, `levels`, `source`, `notes`).

Create `projects/<id>/source/` and copy the inputs to `projects/<id>/source/inputs/` (never modify originals).

## 2. Read the plan — pick the branch from intake

### A. Raster image (real-estate plan, scan, photo of a drawing, PDF page rendered with pdftoppm)

1. `.venv/bin/python tools/image/prepare.py <image> --out projects/<id>/source/prep` → look at `grid.png` and the
   `tile_*.png` zooms. Labels are SOURCE pixel coordinates (x right, y down). On a small image (intake warns below 1200 px; walls
   are then 3–5 px thick) read wall faces and openings from close-ups: add `--zoom-box x0,y0,x1,y1` (repeatable, 4×, 10 px grid)
   for every area you need.
2. Write down, for every room: name (as printed), kind, the rectangle (or polygon) of its **inner wall faces** in pixels —
   the boundary between wall and floor, not the centre of a wall line; fractional pixels (e.g. 111.5) are fine and matter on
   small images, here and in `--origin` — and its printed area if any. For every door: the two rooms (or `exterior`), the pixel in the middle of the opening, the swing arc —
   which room it opens into and on which side the hinge is (the arc's centre). Windows: the room, a pixel on the wall in the
   middle of the window, its width. Fixtures (bathtub, WC, washbasin, kitchen run, bed, wardrobe, stairs).
3. Scale — at least two independent estimates (ADR 0016):
   ```bash
   C=projects/<id>/source/calibration.json
   .venv/bin/python tools/image/calibrate.py --file $C points --a X,Y --b X,Y --length <metres>     # dimension line / scale bar
   .venv/bin/python tools/image/calibrate.py --file $C area --rect X0,Y0,X1,Y1 --m2 <printed area>  # a rectangular room
   .venv/bin/python tools/image/calibrate.py --file $C total --rects "X0,Y0,X1,Y1;…" --m2 <sum>     # several rooms
   .venv/bin/python tools/image/calibrate.py --file $C symbol --kind door --a X,Y --b X,Y           # weak prior: door,
   #                                                    entrance-door, bathtub, bed, wc (references/symbol-legend.md)
   .venv/bin/python tools/image/calibrate.py --file $C summary --origin <pixel of the outer bottom-left corner> [--use 0,2]
   ```
   `summary` must say OK. If it says DISAGREE: re-check the picked pixels, drop a wrong estimate with `--use` (indexes it
   lists); if still not OK, ask the user for ONE real dimension (a room width, the total area).
   - **Dimensioned plan** (numbers along the walls, in cm on most European plans): the overall chains are the best evidence —
     measure the longest ones with `points` (both directions). Printed room sizes (e.g. 458 × 341) are inner faces: use them
     for the outlines, not only the pixels, and after the build check every room against them (the plan preview shows sizes on
     the 1 m grid). Printed areas are often 2–5 % below length × width (plaster, rounding); prefer chains over areas for the
     scale.
   - **No dimension and no area printed**: only symbol priors are left. Use at least three symbols of two kinds (interior
     doors, bed length, bathtub, WC) — `summary` then says PROBABLE. Set `defaults.confidence` to `"probable"`, say in the README
     that the scale rests on symbols, and ask the user for one real dimension when you hand over.
4. Several images (one per level): prepare and calibrate each one (its own `calibration.json`), pick the same building corner as
   `--origin` on every image, and put each `summary` block into that level's `calibration` (references/plan-schema.md).
5. Write `plan.json` with `"units": "px"` and the `calibration` block from `summary`. Sizes (door / window widths, sills,
   heights, furniture dims) are always metres. The compiler converts, snaps to 5 mm and regularises walls.

### B. Vector PDF sheet (architect's drawing)

```bash
.venv/bin/python tools/pdf/sheet_text.py <sheet.pdf> --out projects/<id>/source/pdf     # words, printed areas, scale
.venv/bin/python tools/pdf/sheet_svg.py  <sheet.pdf> --out projects/<id>/source/pdf     # sheet_grid.png, paths in pt
.venv/bin/python tools/pdf/door_arcs.py  <sheet.pdf> --out projects/<id>/source/pdf --scale <N>   # hinges, leaves
```
Scale: `pt per metre = 72 / 0.0254 / N` (1:N from `sheet_text`); confirm it with one printed dimension. Read room outlines from
`sheet_grid.png` (labels in pt), convert to metres yourself or write a `"units": "px"` plan whose calibration uses
`pxPerM = pt per metre` and the origin in pt (the PDF y axis points down like an image). Door hinges come from `arcs.json`.

### C. CAD (DWG / DXF)

```bash
.venv/bin/python tools/cad/dwg2dxf.py <file.dwg> -o projects/<id>/source/cad          # DWG only (ODA File Converter)
.venv/bin/python tools/cad/dxf_inspect.py <file.dxf> --out projects/<id>/source/cad    # layers.json, layer_*.png, texts.json
```
Look at the layer images; propose which layers are walls / partitions / doors / windows / room texts (see
`references/cad-layer-heuristics.md`) and confirm with the user. Several plans on one sheet → pick a `--box` around one level.
```bash
.venv/bin/python tools/cad/dxf_walls.py <file.dxf> --layers "<walls>,<partitions>" --unit <cm|mm|m> --text-layers "<texts>" \
    --box x0,y0,x1,y1 --out projects/<id>/source/cad/<level>
```
Use `rooms.png` / `walls.json` candidates (metres, origin at the bottom-left of the walls) as room rectangles; map texts inside
them to names and areas; doors and windows from the plan images or the door / window layers. Write `"units": "m"`.

### D. No drawing

Interview: rooms with sizes, which walls they share, where the entrance, windows and bathroom are. Write `"units": "m"`, set
`defaults.confidence` to `"unknown"`, and say clearly in the README that the geometry is approximate.

## 3. Build, then fix until clean

```bash
npm run -s project:build -- projects/<id>       # compiles plan.json; prints adjustments, warnings, ERRORS
npm run -s project:validate -- projects/<id>
```
Fix every error in `plan.json` (never in `project.json`). Read every warning and either fix it or write in the README why it is
acceptable. Common fixes: `skills/home-check/references/errors.md`.

## 4. Preview and compare — mandatory (ADR 0015)

```bash
npm run -s project:preview -- projects/<id>              # projects/<id>/preview/plan-<level>.png, 3d.png (outside)
npm run -s project:preview -- projects/<id> --room R3    # room-R3.png: the room in 3D, cut away from above
npm run -s project:preview -- projects/<id> --viewpoint vp-attic   # view-<id>.png: eye level from a plan.json viewpoint
```
Open the plan preview next to the source drawing and compare room by room: shape and proportions, sizes against printed
dimensions, door positions and swing direction, windows on the right walls, stairs (direction of the arrow), attic height lines
and roof windows. Look inside at least the largest room (`--room`); for every room with a sloped ceiling add a `viewpoints`
entry in plan.json (also useful to the user) and check it with `--viewpoint` — the cut-away hides the slope. With several
levels, check that outer walls and the stairs line up between the plan previews. Fix and rebuild. After three silent iterations, show both images to the user and
ask about the specific doubt instead of iterating further.

## 5. Furnish

Furniture drawn on the plan → `furniture` entries with `"basis": "drawn"` (positions from the drawing). Rooms without drawn
furniture → the defaults per room kind in `references/furnishing-defaults.md` with `"basis": "approximate"`. Something on the plan
the catalog lacks → `notIncluded` entry. Rebuild and preview.

## 6. Hand over

- Write `projects/<id>/README.md`: sources, calibration method and value (or CAD units and origin), every assumption, open
  questions, what the user could measure to improve it.
- Tell the user how to open it: `npm run dev` then `http://localhost:5173/?project=<id>` (or use the `home-check` skill), and offer
  the `home-to-phone` skill.
- When the user is happy with ids, run `npm run -s project:build -- projects/<id> --lock` so later edits cannot renumber walls
  (user furniture and electrical points refer to them).

## Never

- Never invent dimensions you could ask for; never take sizes from photos or 3D renders.
- Never put names of real people, addresses or private data into ids; ids are ASCII; names may be in the user's language.
- Never edit files under `src/` to make a building work — if the format cannot express something, say so (docs/KNOWN_LIMITATIONS.md).
