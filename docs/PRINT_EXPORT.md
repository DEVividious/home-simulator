# Print export: a scale model as STL

`npm run project:print` turns a project into a printable scale model: STL parts that fit the printer bed, a report of every
check and change, and a preview image. The same code (`packages/core/src/print/`) runs in the `house-forge` plugin
(`house-forge print`, [HOUSE_FORGE.md](HOUSE_FORGE.md)) and in the app (Download › **Print model**), so the same input, printer
and scale give the same bytes everywhere.

```bash
npm run project:print -- projects/<id> --bed K1C                 # automatic scale, FDM 0.4 mm
npm run project:print -- projects/<id> --bed K1C --scales        # every standard scale with the size of each part
npm run project:print -- projects/<id> --bed 256x256x256 --scale 1:100 --dry-run
```

| option | meaning |
|---|---|
| `--bed "<printer>"` or `WxD[xH]` | the printer (a phrase from the table in `packages/core/src/print/printers.ts`: `K1C`, `"bambu a1 mini"`, `"prusa mk4"`) or the bed size in mm; required |
| `--scale auto` or `1:N` | default `auto`: the largest standard scale (1:50, 75, 87, 100, 120, 150, 160, 200, 250, 300) at which every part fits |
| `--nozzle 0.4`, `0.6`, `resin` | the print profile: smallest wall, slab, pier and opening |
| `--min-wall <mm>` | a different smallest wall |
| `--margin <mm>` | kept free on every side of the bed, default 10 |
| `--eaves keep` or `trim` | `trim` cuts eaves and verges at the outer faces of the walls (smaller roof part, no overhangs) |
| `--scales` | list the scales and part sizes; nothing is written |
| `--dry-run` | build and check everything, write the report and the preview, no STL |
| `--out <dir>` | default `projects/<id>/print/1to<N>/` (git-ignored) |
| `--lang en` or `pl` | language of the preview labels (`src/i18n/<lang>/print.json`) |

The input may also be a `plan.json` (compiled without the furniture catalog) or a `project.json`. Exit codes: 0 — written,
2 — bad input, 3 — not printable (the report says why).

## Parts

One part per level — its floor slab and its walls up to the underside of the next slab — and a removable roof. Nothing else:
no bases, pegs, magnets, labels or joints; the parts stand on each other by their flat cut faces.

The last level is split at a height `z` (`split` in the report):

- rooms with flat ceilings only (a cold roof space over a ceiling, a flat roof, no roof): `z` is the lowest ceiling — the
  rooms are open in the level's part, and the roof part (the roof with the space under it and its gables) has no ceiling
  hanging over the bed. Eaves that reach lower are cut off at `z` (note `eaves.cut`).
- rooms under the slopes: `z` is the bottom of the eaves or the lowest ceiling, whichever is lower, at least 0.3 m above
  the floor; the roof part holds the rest of the walls, the rooms as hollows open at the bottom, the roof and the dormers.
- `--eaves trim`: the lowest underside is then at the outer faces of the walls.

The level and the roof are one solid before the cut (the walls run 5 mm into the roof so the two unite without a seam); faces
lying in the split plane are moved 5 mm off it in the inputs, so the cut never meets a face. A roof over a lower level (a
wing beside a smaller upper floor) goes with the part of the level above it: the lower level is built as a level under another
one — its rooms open through the top at the underside of the next slab — and the roof above that height is joined to the next
part (where it meets the upper level's walls a 5 mm strip in the slab makes them overlap, so no seam stays); what of it lies
under the cut is not printed (note `roof.carried`). Every level's part is open from above, and the parts stack floor by floor.

**Joints** (`print/joints.ts`, `--joints off` leaves them out). On the top of each part's exterior walls — on the inner part
of the wall, 1.8 mm from the outer face, so the outside stays one plane when stacked — registration tabs 1.6 mm high stand in
squares round every corner of the outline (an L at a corner holds both directions) and at most every 45 mm along the walls;
the part above has a pocket for each with the profile's clearance per side and a 0.3 mm gap over the tab (it rests on the
walls, not on the tabs), a mouth widened over its first 0.4 mm (the elephant's foot on the bed) and the tab top chamfered. A tab
is made only where the part above has material over and around its pocket (a wall around it and a slab over it); fewer than
three tabs, or tabs in one direction only, make no joint (note `joint.none`). The report lists every joint (`joints`).
Stairs are solid flights from the floor — stepped, or a ramp
when the steps are lower than the profile's smallest step. The steps in the thickness of the slab above (higher than the top
of their level's part) are printed with the upper level's part: a block standing on the bed in the opening of its floor, run
5 mm into the edge of the floor the stairs lead onto, right on top of the lower flight when the parts are stacked (note
`stairs.split`; left out with `stairs.clipped` when lower than the smallest step on the print). Roof
windows and dormer windows are recesses inside a frame (left out with a note when too small); glass, frames, door leaves and
furniture are not printed.

## Printability

The scale is chosen first; then the building's **inputs** are changed where they are smaller than the profile allows, and
every change is listed in `adjustments` with the element, the size in the building and on the print, and the rule:

| profile | wall | slab | pier | opening | overhang | bridge | step |
|---|---|---|---|---|---|---|---|
| FDM 0.4 mm | 1.2 | 1.0 | 2.0 | 1.5 | 45° | 15 | 0.5 |
| FDM 0.6 mm | 1.8 | 1.2 | 3.0 | 2.0 | 45° | 15 | 0.6 |
| resin | 0.6 | 0.6 | 1.0 | 0.8 | 30° | 5 | 0.2 |

(mm on the print). Exterior walls, slabs and the roof are thickened (the roof outlines move out with the walls); an interior
wall that is too thin moves both of its faces back by half the difference (a partition end inside one room too), and its
doors and windows follow; openings that are too small are widened or closed; lintels that are too thin are lowered, and a sill
just above the split drops to it; piers between two openings that are too narrow merge them (a window next to a door shrinks
instead); chimneys grow to a pier.

## Checks

A part gets no file when a blocking check fails: the kernel's status; every piece standing on the bed (one piece is usual;
separate buildings of one level print side by side; crumbs of zero volume are dropped); a positive volume; the STL read back
closed — every edge twice in opposite directions with vertices compared bit for bit, no degenerate triangle, the same volume.
Needles left by the boolean (a corner lying on the opposite edge) are split into their neighbour before writing.

Reported, not blocking: thin spots in horizontal sections (the middle of each level, just above the sills and below the heads;
the bottom of the roof part inside the walls) — material a morphological opening by the smallest wall removes; overhangs in
the print orientation — up to 15° steeper than the profile's angle count as moderate, flat ones held on two opposite sides and
no longer than the profile's bridge are bridges, the rest need supports and are located in the building (`at`, metres) and
named when an opening head or a ceiling is there (`what`: "lintel of W1", "ceiling of R2").

Each part lies on the bed in the STL: centred, from z = 0, turned by 90° when it fits only that way; a roof part prints upside
down when that needs fewer supports and it still lies as flat.

## Report and preview

`print-report.json`: versions (`meta`: core, engine commit, SHA-256 of the input), printer and margin, profile, scale and the
candidates tried, the split, the smallest features on the print (`minimumsMm`), per part the file, size, share of the bed,
orientation, volume, triangles, pieces, thin spots and overhangs, the adjustments, notes, warnings, problems, and the SHA-256
of every STL written.

`preview-1to<N>.png`: the assembled model, the parts lifted apart, and every part on the bed as it is printed, with its size —
drawn by the core's software rasteriser (z-buffer, Lambert shading, outlines, 2× supersampling, a 5×7 font), no browser.

## In the app

Download › **Print model** (top bar) makes the model in the core's worker (`src/home/three/coreWorker.ts`, the same kernel as
the generated shell) with a 220 × 220 × 250 mm bed, a 0.4 mm nozzle, a 10 mm margin and the automatic scale (`APP_PRINT` in
`src/home/download.ts`), and saves one file `<project>-print-1to<N>.zip`: the STL parts (stored, not recompressed — the bytes of
`npm run project:print -- projects/<id> --bed 220x220x250`), `print-report.json` and the preview picture. A model that does not
print (a part fails a check) is not saved; the message names the first problem. The browser test `verify_core.mjs` compares
the STL bytes with the CLI's for both example projects.
