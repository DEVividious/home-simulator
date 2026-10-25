# Variants and arrangements

A **variant** is a complete version of the user's design of a project; an **arrangement** is one furnishing of one room
inside a variant. Both live in the user document (`home-simulator/document` v1, `userdata/<id>/document.json`, ADR 0002) and
never change the project package: the building geometry, plot and surroundings are the same in every variant. Variants are a
project capability (`variants`).

## 1. What a variant contains

`Variant` (`src/home/model/variantData.ts`):

| Group | Content | Field | Edited in |
|---|---|---|---|
| interiors | room arrangements: furniture (rugs are furniture too), wall / floor / ceiling finishes | `interiors` | Interiors / Materials / Furniture |
| stairs | finishes of the stairs: treads, risers, handrail, balustrade (project with stairs) | `stairs` | stairs card ([WALK_AND_STAIRS.md](WALK_AND_STAIRS.md)) |
| electrical | own electrical layout, when split from the global plan | `electrical` | Electrical → "Plan scope" ([ELECTRICAL_PLANNER.md](ELECTRICAL_PLANNER.md)) |
| view | camera (position, target), FOV, surroundings on / off | `view` `{ position, target, fov, environment }` | "Save" in Variants |
| sun | date and time of the sun simulation (project with the `sun` module) | `sun` `{ date, minutes }` | "Save" (from the sun panel) |
| thumbnail | JPEG 320 × 200 (data URL) | `thumbnail` | "Save" / "Save as…" |
| saved at | ISO 8601 | `updatedAt` | "Save" |

Every field except `id`, `name` and `interiors` is optional; a missing view or sun means "current". Exterior joinery, facade
materials and outdoor elements are not part of the engine and therefore not part of a variant.

**Validation** runs with the document (`variantExtrasErrors` in `docErrors`): stairs config, electrical plan, FOV 10–120°,
date `YYYY-MM-DD`, minutes 0–1439, thumbnail as an image data URL (≤ 300 kB). The save server applies the same validation.

## 2. Variant operations (Variants section)

| Operation | Effect |
|---|---|
| **New** | a new variant with the given name: interiors empty (the project default furnishing), stairs bare; becomes active |
| **Save** | stores the **current view** (camera, FOV, surroundings), the **sun date and time** and a **thumbnail** (crop of the current image) in the active variant, then saves the document |
| **Save as…** | copy of the active variant under a new (unique) name, with the current view, sun and thumbnail; becomes active; document saved |
| **Duplicate** | copy of the active variant ("<name> (copy)"), active |
| **Rename** | name of the active variant |
| **Delete** | the active variant (when there is more than one) |
| **Restore project settings** | the active variant returns to the package state (empty interiors, bare stairs, no view, no sun); its own electrical layout is kept |
| **Restore project furniture** | the active arrangement of every room gets the project default furnishing; finishes, saved arrangements and the rest stay |

Every operation is **one history entry** (Undo / Redo). The variant list shows cards with the **thumbnail**, name, number of
furnished rooms, saved time of day and save time; a variant without a saved view shows "no thumbnail — Save".

**Selecting a variant** (click a card) switches the interiors in the scene, restores the saved **sun** and **surroundings**, and
in the building view from outside also the variant's **camera**. In a room or a level section the camera stays, so the user is
not pulled out of editing.

## 3. A/B comparison

Variants → "Compare A / B": choose variants A and B, then "Compare (split screen)".

- **One canvas, two render passes** (`SplitRenderer`, `src/home/scene/CompareRenderer.tsx`): the left half is side A, the right
  half side B. Before each half only the **variant data** are switched — visibility of the groups `SIDE_A` / `SIDE_B` (finishes,
  furniture, stairs). The shadow map is recomputed for each half.
- **Identical on both sides:** the same camera (half-frame aspect; orbit and zoom act on both halves at once), the same lights,
  sun, sky, IBL, surroundings and building shell.
- Comparison is for viewing: clicks in the scene (editing) are disabled.
- Overlay: labels "A · name" and "B · name", divider line; **⇄ Swap**, **Screenshot**, **Exit** (or Esc).
- On a phone the comparison shows **one side on the full frame** with an **A | B** switch — half the draw calls of a split
  screen ([MOBILE_UX.md](MOBILE_UX.md)).

**Room arrangement comparison** (e.g. "Office A vs Office B"): Interiors → room → Arrangement → choose A and B → "Compare
arrangements A / B". Both sides are the same variant; only the active arrangement of that room differs. Works in 3D, top view
and room walk.

State: `ui.compare = { kind: "variants", a, b } | { kind: "room", roomId, a, b } | null` (view state, not saved). The sides are
computed by `sidesOf(doc, compare)` in `src/home/store/sides.ts`.

## 4. Screenshot with metadata

The camera button in the top bar, "Screenshot" in Variants or "Screenshot" in the comparison creates
`screenshot-<variant>-<YYYYMMDD-HHMM>.png` (`src/home/screenshot.ts`):

- **scene image** — in a comparison both halves with A / B labels and the divider;
- **caption band** under the image: project, variant or comparison sides, sun date and time with azimuth and elevation (project
  with the `sun` module), view and room, camera (position, FOV), surroundings, quality profile, time taken;
- **PNG metadata**: an `iTXt` chunk (UTF-8, keyword `home-simulator`) with the `ScreenshotMeta` JSON — `app`, `project`,
  `takenAt`, `variants[]` (side, id, name, label, saved at), `compare`, `view { mode, room, camera, environment, quality }`,
  `sun { date, time, azimuth, elevation } | null`, `image`.

## 5. Variant export and import (JSON)

**Export** (`exportVariant`) writes `variant-<name>.json`:

```json
{ "schema": "home-simulator/variant", "version": 1, "exportedAt": "…",
  "project": { "id": "<projectId>", "name": "<project name>", "docVersion": 1 },
  "variant": { "id", "name", "interiors", "stairs", "electrical", "view", "sun", "thumbnail", "updatedAt" },
  "importedAssets": [ /* metadata of imported furniture models used by the variant */ ] }
```

**Import** (`importVariant`) in order:

1. checks the JSON syntax;
2. checks the **schema** (`home-simulator/variant`) and **version** (1);
3. rejects a variant of **another project** (`project.id` ≠ the document's `projectId`);
4. assigns a new id if it already exists and a unique name ("(2)" — with a warning);
5. adds missing imported-model metadata;
6. **validates the whole document after adding the variant** with the same rules as loading (`docErrors`): known furniture
   and materials, numbers, optional fields.

An invalid file is rejected with a message and the document does not change. A valid variant is added as active (one history
entry). GLB files of imported furniture are not part of the JSON; to move to another computer, copy
`userdata/imports/` as well.

## 6. Room arrangements

Every room may have any number of arrangements (e.g. Office A / Office B / Office C). They belong to the variant
(`Variant.interiors[roomId]`), so different variants can have different interiors:

```
interiors: {
  "<roomId>": {
    activeArrangementId: "arr-…",
    arrangements: [{
      id, name: "Office A", saved: true,
      furniture: [{ id, catalogId: "desk", variant?, x, y, rot, elevation?, dims?, materialId?, slots?, mount? }, …],
      finishes: { walls: { "<roomId>-w3": { materialId: "paint-white", color: "#9aa88f" } },
                  floor: { materialId: "vinyl-oak-natural", layout: { rotation: 90 } }, ceiling: null },
      scenario: "office" | "guest" | "hybrid" | null      // when created from a proposal
    }]
  }
}
```

An arrangement stores furniture (positions, rotations, variants, parametric dimensions, part materials, mount records), rugs and
wall / floor / ceiling finishes. A room without a saved interior shows the project default furnishing in an implicit first
arrangement, created on the first change — the document is not touched before that.

Operations (`src/home/model/interiors.ts`; UI: Interiors → Arrangement):

| Operation | Effect |
|---|---|
| **Save as…** | names the active arrangement and marks it saved (names unique within the room: "Office A (2)") |
| **Copy as…** | copy of the active arrangement under a new name (new furniture ids); the copy becomes active |
| **Rename** (✎) | rename any arrangement |
| **Delete** (bin) | delete an arrangement — a room always keeps at least one |
| **Load** (click in the list) | switch the active arrangement |
| **New** (＋) | an empty arrangement |

Every operation = one history entry (Ctrl+Z undoes e.g. deleting an arrangement). Name fields work in the panel (Enter —
confirm, Esc — cancel), without browser dialogs. The document is saved with Ctrl+S, "Save" or autosave.

## 7. Layout proposals

For living rooms of at least 7 m² (kinds office, bedroom, room) the Interiors panel offers **layout proposals**: **Office**,
**Guest room**, **Hybrid**. A proposal creates a **new** arrangement with furniture placed heuristically
(`arrangeScenario`, `src/home/model/placement.ts`): items with their backs to full walls, bed and wardrobe on walls without
openings, desk near a window, chair in front of the desk, bedside table next to the bed, rug by the bed. Positions with a
collision, in a door zone, in front of a window for items taller than the sill, or under a slope are rejected. **The room
geometry does not change** — items that cannot be placed without a collision are skipped (with a message).

| Proposal | Items |
|---|---|
| Office | desk, office chair, bookshelf, tall cabinet |
| Guest room | bed 140 × 200, bedside table, 2-door wardrobe, rug 120 × 170 |
| Hybrid | sofa bed, 120 cm desk, office chair, 2-door wardrobe |

## 8. Camera bookmarks

Building → "Save this view": camera position and target (LCS), FOV, room and view mode — stored in the document
(`bookmarks`). Clicking a bookmark moves the camera (and enters the room, or resumes the walk, when the bookmark was made
there).

## 9. Files and tests

- Model: `src/home/model/variantData.ts` (fields, validation, export / import), `src/document/model.ts` (`Variant` in the
  document, `docErrors`), `src/home/model/interiors.ts` (arrangements), `src/home/model/placement.ts` (proposals).
- State: `src/home/store/sides.ts`, `src/home/store/ui.ts` (`compare`).
- Actions: `src/home/actions.ts` (`newVariant`, `saveVariant`, `saveVariantAs`, `switchVariant`, `applyVariantView`,
  `resetVariantToProject`, `resetFurnitureToProject`, `exportVariantFile`, `importVariantFile`, `startCompare`,
  `startRoomCompare`, `swapCompare`, `exitCompare`).
- Scene: `src/home/scene/CompareRenderer.tsx`, `src/home/scene/HomeCanvas.tsx` (groups `SIDE_A` / `SIDE_B`).
- Screenshot: `src/home/screenshot.ts`. UI: `src/home/ui/SectionVariants.tsx`, `SectionInteriors.tsx`, `Compare.tsx`,
  `Shell.tsx`.
- Tests: `src/home/tests/variants.test.ts` (fields, validation, unique names, export / import incl. rejection of syntax,
  schema, version, foreign project and unknown furniture, comparison sides, PNG `iTXt`), `src/document/tests/model.test.ts`.
