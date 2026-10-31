---
name: house-forge
description: Turn floor plans of a house or flat — plan images (PNG / JPG from an estate agent or a catalogue), architect's PDF sheets, DXF / DWG drawings — into a 3D-printable scale model (STL parts that fit the printer bed), with the roof, a preview of what was read and approval before the build. Use for "print my house", "make a 3D model of this floor plan for my printer", "makieta domu do druku 3D", "wydrukuj rzut", and for changes to models made with this skill.
---

# house-forge: a printable scale model from floor plans

The skill runs the conversation like a helpful friend who reads plans and owns a 3D printer: one question at a time, in the
user's language; it shows what it read before it goes on and builds the STL only after the user approves the dry run. Reuse
what the user already said (the files, the printer, the name); ask only for what is missing and what the drawings do not show.
All geometry — the plan compiler, the roof, the solids, the printability changes, the checks, the STL and the previews — comes
from `scripts/house-forge.mjs`. Plans are read by you, with the tools of the script, into `plan.json`.

Don't: build the STL before the user approves the dry run (step 6); guess the printer, the scale, a dimension or a roof pitch
you can ask for; write your own geometry, STL or image code when a command does it; retype or recompute values the script
prints (quote them); make up file names or paths — the script chooses them and prints the real ones.

## Runtime and tools

Resolve this skill's directory from the location of the `SKILL.md` you read; `references/` and `scripts/` are relative to it.
In the examples `HF` is the absolute path of the script — set it in every shell call (calls may not share variables):

```bash
HF="/absolute/path/to/house-forge/scripts/house-forge.mjs"
node "$HF" doctor
```

`node` (20 or newer) runs the geometry. Plan images, PDF sheets and CAD files need the Python tools, which the script runs with
`uv run --locked` (the exact library versions of `scripts/tools.py.lock`; the first run downloads them — it needs network once
and a writable uv cache; follow the host's permission flow if blocked). If `doctor` says uv is missing, point the user to
https://docs.astral.sh/uv/getting-started/installation/ and ask them to reopen the host afterwards. DWG drawings also need the
free ODA File Converter (`doctor` says whether it is there; otherwise ask the user to export DXF or PDF from their CAD program).

Run every command from the user's project directory, never from the skill installation. All files go to
`./house-forge-output/<name>/` (see "Files"). Open PNG previews with an image-capable tool; if you cannot view images, give
the user the path and ask them to look — never claim to have seen a picture you did not open. For choices, use a
multiple-choice question tool when the host has one, otherwise ask in the conversation and wait.

## Language

Talk to the user in the language they write in, from the first reply on. The script prints in English; `--lang pl` makes
the preview labels Polish (`preview`, `print`). Translate only labels and descriptions when you show the script's output:
keep every number, unit, file name, id and command exactly as printed (switch only the decimal separator to the user's
convention). Room names in `plan.json` stay as printed on the drawing.

## Workflow

### 1. The plans

Ask for the drawings: every floor plan (one per storey), and the section or the roof plan or an elevation of a house when they
exist — the roof pitch, the knee wall and the ridge height are on those. A real-estate or catalogue plan image works; an
architect's PDF or a DXF is more exact. Agree on a short name now (lower-case, hyphens, e.g. `dom-anny`; it becomes the plan's
project id) and pass it as `--name` to every command, so all files of the house land in one workspace.

```bash
node "$HF" intake plan-parter.png plan-pietro.png --name dom-anny
node "$HF" paths --name dom-anny
```

`intake` says what each file is and which branch reads it (A raster, B vector PDF, C CAD) and copies the files into the
workspace (`source/inputs/`); `paths` prints where `plan.json`, the previews and the builds go.

### 2. Read the plans into plan.json

Read first, every time: `references/authoring-conventions.md` (the rules), `references/plan-schema.md` (the format; worked
examples in `references/examples/`), then the branch in `references/reading-plans.md`. Symbols: `references/symbol-legend.md`;
roofs: `references/roofs.md`. The tools of the branches:

```bash
node "$HF" image prepare <image> --out house-forge-output/<name>/source/prep        # grid.png and close-ups to read pixels from
node "$HF" image calibrate --file house-forge-output/<name>/source/calibration.json points|area|total|symbol|summary …
node "$HF" pdf text <sheet.pdf> --out house-forge-output/<name>/source/pdf --find pitch,ridge
node "$HF" pdf svg <sheet.pdf> --out house-forge-output/<name>/source/pdf
node "$HF" pdf arcs <sheet.pdf> --out house-forge-output/<name>/source/pdf --scale <N>
node "$HF" pdf render <sheet.pdf> --out house-forge-output/<name>/source/pdf/page-1.png      # a scanned PDF → the raster branch
node "$HF" cad inspect <drawing.dxf> --out house-forge-output/<name>/source/cad
node "$HF" cad walls <drawing.dxf> --layers "<walls>" --unit cm --out house-forge-output/<name>/source/cad/<level>
node "$HF" cad dwg2dxf <drawing.dwg> -o house-forge-output/<name>/source/cad
```

Each tool's options: `node "$HF" <group> <tool> --help`. Write `house-forge-output/<name>/source/plan.json` (project id = the
name). Only the building matters for the print: levels, rooms, doors, passages, windows, stairs, the roof, roof windows — leave
out furniture, electrical points, the plot and the sun. Then:

```bash
node "$HF" compile --name <name>      # errors, warnings, adjustments, then "what the plan says"
node "$HF" preview --name <name>      # previews/plan-<level>.png, roof.png, 3d.png
```

Fix every error in `plan.json` and read every warning. Open each plan preview next to its drawing and compare room by room
(shape, sizes against printed dimensions, doors and their swing, windows on the right walls, stairs), the roof preview against
the section or roof plan, and `3d.png` for the overall shape. After three silent rounds of fixes, show both images to the user
and ask about the specific doubt.

Then show the user what you read, as a short card (from the `compile` output and the previews, values as printed):

- levels with their rooms: name, area from the outline, and the area printed on the drawing when it differs by more than 5 %;
- the roof: type, pitch, knee wall, ridge height, dormers and roof windows — and which of these you assumed;
- doors and windows per level (counts), stairs;
- the plan preview images (one per level) and `3d.png`;
- at most two questions about what you could not read.

Ask: **is this your house — or should I change something?** Turn every remark into a change of `plan.json`, compile, preview,
and show the changed card.

### 3. Roof facts that are missing

A flat needs no roof. For a house, every fact `references/roofs.md` names that the drawings do not show is one question, asked
one at a time, in plain words — for example "What is the roof pitch — 30°, 35°, 40°, 45°, or don't you know?" ("don't know" → 40°
and `"confidence": "probable"` on the roof, said on the card). Never ask about technical values the user cannot know
(covering, buildup, eaves width): the defaults are fine for a model.

### 4. Printer

Ask which printer they have and look it up:

```bash
node "$HF" printers "k1c"
```

The bed table is `references/printers.md`. Not listed: ask for the bed size (width × depth × height in mm — in the manual or
the slicer's printer profile) or look it up and confirm it with the user; then use `--bed 220x220x250`. The nozzle is 0.4 mm
unless the user says otherwise (`--nozzle 0.6`, `--nozzle resin`; `references/print-profiles.md`).

### 5. Scale

```bash
node "$HF" print --name <name> --bed "K1C" --scales
```

The table gives the size of every part (one per storey and a removable roof) at each standard scale and whether all of them
fit the bed (10 mm margin). Suggest the largest scale that fits (`auto` picks it), and one smaller if the user wants a quicker
print; say plainly how big the model will be. Pass a chosen scale as `--scale 1:N` to the dry run and the build.

### 6. Approval card

```bash
node "$HF" print --name <name> --bed "K1C" --dry-run
```

The dry run builds and checks everything without STL and prints a card: the scale, the printer, every part with its size and
share of the bed, where the roof comes off, what was thickened for printing, where supports are needed, notes, and the build
version. Show the card's list (labels translated, values as printed) and the preview image it names (assembled model, the
parts, each part on the bed). Leave out the "Build command" section: it is for you. Add one sentence about what the preview
shows and ask: **do you approve, or would you like to change something?** Build only after a "yes". `--details` lists every
change and overhang when the user asks why.

### 7. Build and hand over

Run the card's build command exactly (only adapt shell quoting):

```bash
node "$HF" print --name <name> --bed "K1C"
```

The script checks each part (watertight, one solid, read back from the file) and writes the STL files only when all pass, into
`house-forge-output/<name>/builds/1to<N>-v<K>/` with `print-report.json`, and the preview into `previews/`. Hand over its
report in the user's language with the file list as printed (links when the host supports them) and the preview. "Already
built" means identical settings were built before: nothing was rebuilt; offer `--new-version` only if they want a copy.

End with one short paragraph on printing: each part on its own, lying as in the STL (flat side down; the roof may be upside
down — the card says so), PLA, 0.2 mm layers, 15 % infill; supports only where the card lists them (tree supports come out of
window openings most easily). Full settings: `references/print-profiles.md`, only when asked.

Changes later ("make it smaller", "a different printer", "trim the eaves"): `node "$HF" print --from
house-forge-output/<name>/builds/<build> --scale 1:100 --dry-run` keeps every other setting; show the new card, build after a
"yes" — a new version, the old one stays. A change of the house itself is a change of `plan.json`: compile, preview, then
the dry run again.

## Files

The script owns names and locations; quote the paths it prints.

```text
house-forge-output/<name>/
  source/plan.json             what you write; source/inputs/ the user's files, prep/ pdf/ cad/ tool output, calibration.json
  project.json                 compiled by `compile`
  previews/plan-<level>.png    `preview`: plans, roof.png, 3d.png; 1to<N>-v<K>-dry-run.png and -print.png from `print`
  builds/1to<N>-v<K>/          STL parts, print-report.json, build.json (settings), dry-run.json
```

## Skill files

- `scripts/house-forge.mjs` — every command (`node "$HF" --help`); `manifold.wasm` next to it; `tools.py` and its lock run the
  Python tools (`hstools/`, `image/`, `pdf/`, `cad/`); `VERSION.json` names the engine commit.
- `references/reading-plans.md` — the three branches (raster, vector PDF, CAD) and no drawing at all.
- `references/authoring-conventions.md`, `references/plan-schema.md`, `references/plan.schema.json`, `references/examples/` —
  the format of `plan.json`.
- `references/symbol-legend.md`, `references/roofs.md` — what the drawings show and where.
- `references/printers.md` — printer beds; `references/print-profiles.md` — profiles and print settings.
