# Material system

Materials cover wall, floor and ceiling finishes and the parts of furniture and rugs. The catalog is engine-global
(projects may add materials of their own); every texture is procedural and drawn in the browser at real-world scale.

## Catalog — `data/materialCatalog.json`

`{ schema: "home-simulator/material-catalog", version: 1, units: "m", categories[], materials[] }` — 114 materials. UI
names come from the dictionaries (`material.<id>`).

| Field | Meaning |
|---|---|
| `id`, `name`, `category` | categories: `wall-paint`, `wallpaper`, `wall-panel`, `decorative-slats`, `brick`, `wall-tile`, `floor-tile`, `parquet`, `vinyl`, `laminate`, `wood`, `stone` (concrete / stone), `fabric`, `rug`, `metal`, `accessory`, `fronts`, `countertop`, `car-paint` |
| `surfaces` | where it may be used: `wall`, `floor`, `ceiling`, `furniture`, `rug` |
| `thumbnail` | `auto:procedural` — a texture sample drawn in the browser |
| `baseColor` | base colour (paints: the default colour; the user may pick any colour) |
| `textureSet` | texture description: `solid`, `tiles` (grout width and colour, variation), `planks` (board width / length, pattern, grain, gaps), `panels`, `fluted`, `slats`, `wallpaper`, `noise`, `weave`, `terrazzo`, `rug`, `herringbone`, `chevron`, `brick` |
| `physicalSize` | **real** size of the pattern repeat [m]: a tile — its module (e.g. 0.60 × 0.60), planks — `[length, width × rows of the pattern]` |
| `repeat` | pattern density multiplier (1 = real scale; not meant for arbitrary scaling) |
| `rotation` | pattern rotation [°] (planks: laying direction) |
| `roughness`, `metalness`, `normalScale` | PBR parameters; `normalScale` — relief strength of the generated normal map |
| `emissive`, `emissiveIntensity`, `opacity` | glowing materials (fireplace flame), transparent ones (glass) |
| `source` | description (e.g. "porcelain tile 60 × 60 cm, 3 mm grout") |

## Real scale

All finish UVs are in **metres** (wall: distance along the wall and height; floor and ceiling: LCS `(X, Y)`; furniture:
metres on every face of a solid). A procedural texture covers `textureExtent = module × number of modules` (tiles 4 × 4,
planks 2 × 1, slats 10 × 10 — so tiles and boards vary in shade), and `repeat = 1 / textureExtent`. A 0.60 × 0.60 m tile
covers exactly 0.60 × 0.60 m of floor regardless of room size (test in `src/home/tests/model.test.ts`). Resolution:
420 px / m, capped by the quality profile (at most 1024 px per texture).

## Patterns

- **Parquet** (category `parquet`, floor and wall; plus vinyl and laminate variants): classic herringbone (staves at right
  angles, 45°) in oak shades, walnut and double herringbone; French herringbone (chevron — ends cut at 45°, joined on an
  axis). Drawn at real scale by `paintParquet` (`src/home/three/textures.ts`): classic — staves A and B in a frame rotated by
  45° (repeat √2·length × √2·width); chevron — columns of parallelograms. Editable: stave width and length, direction
  (0° / 45° / 90°), offset. Every stave has its own shade and grain.
- **Brick**: 250 × 65 mm brick, 10 mm joint (editable 0–10 mm), half bond; repeat of two courses 0.26 × 0.15 m. Every brick
  gets its own shade from the material's palette (`chips`) or, without one, from the base colour.
- **Wallpaper**: repeat within a 53 cm roll width — stripes 26.5 × 53 cm, dots 26.5 × 26.5 cm, geometric 53 × 53 cm.

## PBR maps

Every textured material gets colour (sRGB) + **normal** + **ORM** (R — ambient occlusion of joints and gaps, G — roughness
multiplier), generated from a height map drawn with the same pattern; the maps have the size of the colour texture. PBR maps
are off in the profiles that disable them (`pbrMaps` in `src/home/quality/profile.ts`).

## Neutral finish

`neutralFinish(kind, surface)` (`src/home/catalog/materials.ts`) is the preview finish where the user chose nothing: warm
white walls (bathrooms — 30 × 60 tiles, garages and technical rooms — light grey paint), white ceiling, floor by room kind.
It is never saved in the arrangement and can be switched off in the settings (`?neutral=off`).

## Tile and plank layout (`FinishLayout`)

User parameters (surface panel → "Tile / plank layout") override the catalog values:

| Material | Parameters |
|---|---|
| tiles, terrazzo | tile size (30 × 30, 30 × 60, 60 × 60, 60 × 120, 80 × 80, 120 × 120, 20 × 20, 10 × 30 cm), joint 0–10 mm, pattern rotation 0° / 45° / 90°, offset |
| planks (vinyl, laminate, wood) | board width 6–40 cm, length 30–300 cm, row offset (straight, 1/2, 1/3, random), direction 0° / 45° / 90°, offset |
| parquet | stave width and length, direction, offset |
| brick | joint, offset |
| wallpaper, panels, slats | rotation, offset |
| paints | colour (palette of interior colours + any colour + recently used) |

## Assignment to surfaces

An arrangement has `finishes = { walls: { [wallId]: FinishRef }, floor: FinishRef | null, ceiling: FinishRef | null }`,
`FinishRef = { materialId, color?, layout? }`. No entry = the finish of the building shell. `setFinish(arrangement, target,
ref)` (`src/home/model/interiors.ts`) takes `floor`, `ceiling`, `wall` (one wall) or `walls` (a list). Arrange › Colours works
on the walls of the whole room by default; a click on a wall in the scene chooses that wall alone ("This wall"). Advanced mode
adds several walls (Ctrl / Shift + click or the wall buttons) and **Whole home** (all rooms except bathrooms, garages and
technical rooms — `applyWallsHouse`). **Original** (`null`) restores the shell finish. One change = one history entry, also for
the whole home.

Room walls (`packages/core/src/model/building.ts`) are the edges of the room outline (`<roomId>-w<n>`) with their openings:
doors and passages, windows (sill / head), roof windows. A finish (`src/home/three/surfaces.ts`) is a thin layer 3 mm
(`SURFACE_OFFSET`) in front of the shell face — the shell itself is never changed:

- wall: vertical strips between opening edges (and slope breaks under a pitched ceiling), each strip filled between the
  openings; the height follows the ceiling profile of the room;
- window reveals: from the wall face to the frame, sides and head in the wall material, sill in the floor material
  (`revealGeometry`);
- floor: the room outline (with the stair opening cut out where stairs arrive);
- ceiling: flat or in strips following the ceiling profile, with stair and roof-window openings.

Surface selection: click a wall or floor in 3D (the ceiling in walk mode) or the **Walls** / **Floor** / **Ceiling** buttons
of Arrange › Colours. Hover highlights the surface; selection highlights it more strongly.

## Furniture and rug materials

The main part of an item (`mainSlot`) takes a material from the item's `materialCategories` (fabrics for sofas, wood for
desks, `rug` for rugs); other parts use the materials listed in the furniture catalog. Furniture materials include fronts
(matt white, greige, sage, navy, graphite, oak, walnut), worktops (quartz, concrete, oak), ceramics, glass (`opacity`),
mirror, chrome, flame (emissive) and car paints. Furniture wood is a continuous veneer: tops show no board joints.

## Performance

three.js materials and textures are cached by (material, layout, colour, side): many surfaces and items share one
material, and each texture is drawn once (seeded from the material id — deterministic). Cache statistics: Expert →
Performance.

## Files

`data/materialCatalog.json`, `src/home/catalog/materials.ts` (catalog, scale, layout), `src/home/three/textures.ts`
(procedural textures, thumbnails), `src/home/three/materials.ts` (three.js materials), `src/home/three/surfaces.ts` (finish
geometry), `src/home/ui/ArrangeColours.tsx` (Arrange › Colours).
