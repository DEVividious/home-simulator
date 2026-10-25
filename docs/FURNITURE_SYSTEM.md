# Furniture system

Furniture items are 1:1 objects in metres, in the project coordinate system (LCS: X and Y in plan, Z up). A
placement in an arrangement is a `FurniturePlacement` (`src/home/model/types.ts`):

```ts
{ id, catalogId, variant?, x, y, rot, elevation?, dims?, materialId?, slots?, mount? }
```

- `(x, y)` — centre of the outline; the bottom stands on the room floor (`elevation` lifts it, e.g. a wall cabinet).
- `rot` — rotation about Z in degrees, counter-clockwise. `rot = 0`: the item front (local +y) faces project +Y.
- three.js: `x = X, y = Z, z = −Y`, `rotation.y = rot`; the front then points at `(−sin rot, cos rot)` in plan.
- `dims` — overridden dimensions of parametric items (clamped to the catalog ranges), `materialId` — main part material,
  `slots` — materials of extra parts (e.g. `{ top: "quartz-white" }` for a worktop).
- `mount` — wall objects only: the mount record `{ wallId, u, height }`; `x, y, rot, elevation` are then derived values
  ([WALL_MOUNTED_OBJECT_PLACEMENT.md](WALL_MOUNTED_OBJECT_PLACEMENT.md)).

## Catalog — `data/furnitureCatalog.json`

The catalog is engine-global: `{ schema: "home-simulator/furniture-catalog", version: 1, units: "m",
categories[], items[] }`. Built-in names are English; the UI name comes from the dictionaries (`furniture.<id>`,
`furniture.<id>.variant.<variantId>`, `furnitureCategory.<id>`, `catalog.slot.<slot>`) with the catalog name as fallback.
A package refers to catalog ids; unknown ids are build and load errors.

| Field | Meaning |
|---|---|
| `id`, `name`, `category`, `tags` | identifier, English name, category, search words |
| `dimensions` | `{ w, d, h }` [m]: width (local x), depth (local y, back → front), height |
| `variants`, `defaultVariant` | variants with their own dimensions and generator options (bed 90 / 120 / 140 / 160 / 180, rug sizes, round table …) |
| `parametric` | edit ranges `{ w: [min, max, step], … }` — sliders in the panel; a value outside the range is clamped |
| `runtimeModel` | `{ type: "parametric", generator, options }` or `{ type: "glb", url, scale, offset, rotation }` |
| `thumbnail` | `auto:parametric` (SVG from the generator parts) or a PNG URL (imported model) |
| `defaultMaterial`, `mainSlot`, `materialSlots`, `materialCategories` | part materials (from the material catalog); the main part is user-selectable from the listed categories |
| `extraSlots` | extra parts with a material choice (e.g. worktop: quartz, concrete, oak) |
| `placement` | `wall` (back to a wall), `free`, `under` (slides under a top), `floor` (rug) |
| `tuckUnder`, `flat`, `clearance` | may go under … (chair under a table / desk); flat (a rug may lie under furniture); free zone in front |
| `elevation`, `defaultElevation`, `mount` | mounting above the floor (wall cabinets, hood, mirror, wall TV); `mount: "wall"` — a wall object with a mount record |
| `inDoorway` | element inside a door opening (no "blocks the passage" warning) |
| `obstructHeight` | height that counts as covering a window (a sink worktop does, the tap above it does not) |
| `source`, `license` | where the dimensions come from (typical retail sizes), licence (built-in / user file / provider) |

Collisions take height into account: a wall cabinet above a base unit or a hood above a cooktop do not collide.

The built-in library has 55 parametric items:

| Category | Items |
|---|---|
| Living room | sofa (2 / 3 / 4 seats), sofa bed, corner sofa (left / right chaise), armchair, coffee table, side table, TV stand, sideboard, pouf, TV on a stand and wall-mounted TV, fireplace (ceiling-high surround / panoramic in a TV wall / free-standing stove) |
| Dining | dining table (4 / 6 / 8 seats, round), dining chair, bench |
| Kitchen | base unit (door / 2 / 3 drawers, 30–120 cm), sink unit, cooktop unit, built-in dishwasher, tall unit (larder / oven / oven + microwave / fridge; up to the ceiling), wall unit (door / flap / shelf; mounted at height), chimney hood, island, bar stool, flush pantry door in the cabinetry, free-standing fridge, side-by-side fridge |
| Bedroom | bed 90–180 × 200, bedside table, wardrobe (2 / 3 doors / sliding), dressing table with mirror, crib, bunk bed |
| Office | desk (parametric), office chair, bookshelf, filing cabinet |
| Bathroom | bathtub, walk-in shower, wall-hung toilet, wall-hung bidet, vanity unit, washing machine, dryer, mirror (rectangular / round / tall) |
| Storage | cabinet (low / tall), dresser, storage shelving |
| Garage | car (generic compact hatchback, simplified body from cross-sections), workbench |
| Decor | rug (several sizes, round), floor lamp, plant, wall shelf, wall lamp |

## Default furnishing — `src/home/model/defaults.ts`

A room without a saved arrangement shows the project default furnishing; it is written to the user document only on the
first change. The facts come from the package (`project().interiors`, compiled from the `furniture` list of `plan.json`):

- `items` — elements described by the project sources, with ids `arch-<key>`, a `basis` (`dimensioned`, `drawn`,
  `approximate`) and a note; `fit: "ceiling"` sets the height to the ceiling at the item position − 2 cm (max. 2.80 m),
  `fit: "hood"` — from 1.60 m up to the ceiling;
- `extra` — ready-made placements per room that are not in the sources;
- `notIncluded` — what the sources did not allow to place (shown in the UI).

Every default element is an ordinary arrangement item (move, delete, change variant). Items of the group `kitchen` can be
inserted again into the current arrangement ("Insert the project kitchen into this arrangement", `kitchenBuiltIn` / `applyKitchen`). Wall objects of
the default arrangement get a mount record automatically. The engine knows nothing about the rooms of a specific project.

## Generators — `src/home/catalog/generators.ts`

Pure TS: an item is a list of simple solids in item coordinates (outline centre at (0, 0), bottom at z = 0), each with a
material slot. Shapes: `box`, `cyl`, `sphere`, `prism` (side section extruded along the width), `wheel` (cylinder with a
horizontal axis — wheels, washing-machine door), `loft` (smooth solid from successive cross-sections — car body). Tests
check that every solid fits into `w × d × h`. The same parts build:

- the 3D mesh (`src/home/three/furnitureGeometry.ts`) — one merged geometry per material (few draw calls), UVs in metres,
  cached by (generator, dimensions, options), so items with equal dimensions share geometry;
- the thumbnail (`src/home/catalog/thumbnails.ts`) — an axonometric SVG with face shading, no renderer, no files.

## Catalog providers — `src/home/catalog/providers.ts`

`FurnitureProvider { id, name, items(ctx) }` feeds one item registry (`catalogItems`, `itemById`). Built-in providers:
`builtin` (the catalog file) and `imported` (user models from `ConfiguratorDoc.importedAssets`, ids `imported:<id>`). The
app depends on no external API; a manufacturer catalog can be added later as another provider (`registerProvider`) with
`runtimeModel.type = "glb"` items and its own `source` / `license`, without changes to the scene or the UI.

## GLB / glTF import

Files: `src/home/three/importGlb.ts`, `src/home/ui/ImportDialog.tsx`, `src/home/server.ts`. Furniture → "Import your own
model (GLB / glTF)":

1. **Load** (`GLTFLoader.parseAsync`, file ≤ 50 MB; `.glb` or `.gltf` with embedded resources).
2. **Bounding box** in file units (glTF axes, y up), number of meshes, materials, textures, triangles.
3. **Scale**: unit detection (m / cm / mm — the first scale at which the largest dimension falls into 0.25–6 m); the user
   can change it.
4. **Pivot**: outline centre in plan → (0, 0), bottom → floor (`offset` in file units).
5. **Front direction**: rotation about the vertical (glTF front +Z → 180°; 0° / 90° / 270° selectable).
6. **Footprint**: convex hull of the projected vertices after normalisation; `w × d × h` in metres.
7. **Warnings**: heavy model (> 150 000 triangles), very heavy (> 500 000), large textures (> 4096 px), large file
   (> 20 MB), unusual dimensions (probably wrong units).
8. **Thumbnail**: PNG rendered with a temporary renderer.
9. **Save**: `POST /__api/furniture-import` (safe names, GLB / glTF / PNG signature, size limits) stores the model in
   `userdata/imports/furniture/` and the thumbnail in `userdata/imports/thumbnails/`, served under
   `/user-assets/furniture/imported/` and `/user-assets/thumbnails/imported/`. Metadata goes into the document
   (`importedAssets`, one history entry). Offline, the files stay on the device and are uploaded later
   ([PWA_AND_OFFLINE.md](PWA_AND_OFFLINE.md)).

The item appears in the catalog ("My models") and behaves like any item (drag, rotate, collisions by its dimensions). The
model loads lazily; until then, and when the file is missing, a translucent box stands in its place and the item can still be
selected, moved and deleted. There is no automatic download of manufacturer catalogs.

## Files

`data/furnitureCatalog.json`, `src/home/catalog/furniture.ts`, `generators.ts`, `providers.ts`, `thumbnails.ts`,
`src/home/model/defaults.ts`, `placement.ts`, `collision.ts`, `snapping.ts`, `src/home/three/furnitureGeometry.ts`,
`src/home/scene/FurnitureLayer.tsx`, `src/home/ui/SectionFurniture.tsx`. Materials of furniture parts:
[MATERIAL_SYSTEM.md](MATERIAL_SYSTEM.md).
