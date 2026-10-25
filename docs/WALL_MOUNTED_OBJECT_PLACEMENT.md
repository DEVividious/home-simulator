# Wall-mounted objects — mounting and dragging

How the engine places and moves everything that hangs on a wall: TV, mirror, shelf, wall lamp, wall cabinet, socket,
switch, thermostat, panel, sensor. One model (`MountSurface`) and one drag engine serve wall-mounted furniture and electrical
devices; nothing in it depends on a specific building. Decisions:
[ADR 0003 — the mount record is the source of truth](adr/0003-mount-record-as-source-of-truth.md) and
[ADR 0004 — wall lock and bounded gain](adr/0004-wall-lock-and-bounded-gain.md).

Files: `src/home/model/mount.ts` (surfaces, picking), `src/home/model/mountDrag.ts` (drag, snapping, placement check,
record), `src/home/model/mountedFurniture.ts` (wall-mounted furniture), `src/home/scene/mountPointer.ts` (screen pointer →
ray), `src/home/scene/interaction.ts` (furniture), `src/home/store/elPlace.ts` + `src/home/scene/electricalInput.ts`
(devices). Free-standing furniture uses a sibling engine with the same principles (grab, plane through the grab point,
bounded gain): `src/home/model/floorDrag.ts`.

## 1. Why a dedicated engine

Dragging a wall object over the floor plane fails in three ways. The ray through an object hanging above the floor hits the
floor far behind the wall, so motion is multiplied by `camera height / (camera height − object height)` — about ×4 from eye
level and without bound when the camera is at the object's height; vertical pointer motion turns into motion across the wall
(the object leaves the wall or sinks into it) and the height cannot be changed. Snapping rules for free-standing furniture
(edge alignment, wall capture, corners without hysteresis) produce steps and jumps on a wall. And without a wall record the
wall is guessed from distances on every pointer move, so in a corner it may switch. A further trap is selecting the object on
press: a panel opening under the pressed pointer narrows the scene, and a start point computed in the old viewport makes the
object jump by metres on the first move.

## 2. Model: the mount surface

```
MountSpace   a room seen as a set of walls (or the exterior — facades, when the project has a site)
MountWall    one edge of the room outline with the inward normal (wall id "<room>-w<n>")
WallRun      collinear edges from corner to corner (doors split a wall into several edges)
MountSurface a wall run as a mounting place: id "<room>#<run>", ends a → b, direction, normal, length, floor level,
             usable height heightAt(u) (ceiling / slope), openings in (u, v), list of segments
```

Local coordinates: **u** — metres along the wall from the start of the run (the right corner as seen from the room),
**v** — metres above the finished floor. The readout for the user gives the distance from the **nearer** corner.

Everything follows from the room outlines of the project package; the code contains no wall id.

## 3. Record: the wall position is the source of truth

| Object | Record in the document | Reference point of v |
|---|---|---|
| wall-mounted furniture (`CatalogItem.mount = "wall"`) | `FurniturePlacement.mount = { wallId, u, height }` | bottom of the object |
| electrical device | `ElPoint { roomId, wallId, positionAlongWall, heightAFFL }` | device axis |

`wallId` names a wall edge of the room, `u` is the distance of the object axis from the start of that edge. For furniture
`x, y, rot, elevation` stay in the record as **derived values** (`mountPose`): rendering, collisions, plans and the PDF read
them as before. Consistency is kept in one place — `updateFurniture`: a height change updates the mount record, a move with a
floor tool removes it; a dimension or variant change (`patchPlacement`) recomputes the outline centre at once, so the back of
the object stays at the wall when its depth changes. On loading a document (`normalizeDocMounted`) positions are recomputed
from the mount records: stale `x, y` in the file do not move the object relative to its wall. A document without differences
is not marked as changed.

The `mount` field is optional. A wall item without it works unchanged: `surfaceOfPose` finds its wall (back at the face
within 12 cm, front facing the room) and the record is created on the first move. A wall item standing away from a wall is
hung on the nearest one on the first move. The project default arrangement gets mount records automatically.

## 4. Dragging

The drag state (`MountDrag`) is a value: `beginMountDrag` → `moveMountDrag` (every pointer event returns a new state) → save
on release. While moving, only the transient store changes (`src/home/store/drag.ts` or `src/home/store/elPlace.ts`).

### 4.1 Wall lock

The object has a known wall. The pointer is projected onto **the plane of that wall** (`planeHit`) — not onto the floor and
not onto "the nearest object under the pointer". The face may point away from the camera (room view through a cut-away wall).

**Pointer on the floor.** When the pointer shows the floor, the ray meets the wall plane only below the floor — the farther
along the wall, the farther the pointer stands from it. The position along the wall is then **the wall point nearest to the
pointed floor spot** (`hitOn`: projection of the floor point onto the wall, as in the 2D plan). At the wall / floor edge both
methods give the same point, so the transition is continuous. Moving the pointer perpendicular to the wall does not move the
object along it.

### 4.2 Grab

`grab = pointer hit − object position`, stored at grab time and constant for the whole drag. Grabbing a TV at its edge does
not move it under the pointer. The drag threshold (4 px mouse, 8 px finger) is included in the grab: after the threshold the
object stays put, and only further motion moves it — no jerk.

The grab is recomputed in two situations, always **without moving the object**:

- the view changed without pointer motion (`viewStamp`: scene rectangle + camera matrices) — a panel narrowed the scene, the
  camera was still moving, the phone rotated;
- the step was limited (4.3).

Furniture is selected on pointer **release**, so the inspector does not open under the pressed button; the grab recomputation
covers the remaining view changes. Free-standing furniture has the same protection.

### 4.3 Bounded gain

Projecting a ray onto a plane is unstable when the camera looks along the wall: at 88° one pixel is more than 10 cm. The step
per event is limited to `gainMax × (metres per pixel on a camera-facing plane at the object's distance) × pointer travel in
pixels`, `gainMax = 3`. Up to about 70° from the wall normal tracking is exact (grabbed point under the pointer); at sharper
angles the object moves slower than the pointer and the excess goes into the grab, so a change of pointer direction changes the
object's direction at once. When the ray misses the plane altogether, the object moves towards the pointer with the same limit.

The target is first clamped to the wall bounds and only then limited: an object stopped in a corner waits until the pointer
returns to the grab point. The excess goes into the grab only on the axis whose step was shortened: limiting vertical motion
does not change the along-wall grab of an object standing at the wall end.

### 4.4 Top view

An orthographic camera looking straight down gives the pointer as a plan point (`kind: "plan"`): the position along the wall
follows the pointer with the grab kept; the height does not change.

### 4.5 Transfer to another wall

The object changes surface only when **both** conditions hold:

1. the pointer is off the current surface: beyond the wall end, below the floor or above the ceiling by the margin `M`, or in
   the clear opening of a passage the object **fits** through (opening width ≥ object width; the ray passes through the opening
   between the jambs, above the floor, below the head);
2. another visible mount surface is under the pointer (`pickFromRay` — a face turned to the camera, or the wall nearest to the
   pointed floor spot), and the pointed spot on it is at least `M` away from the current wall.

`M = min(0.25, 0.07 + 0.1 × object width)` (`transferMargin`): a 1.45 m TV — 21.5 cm, a socket — 7.9 cm. The same margin
applies on the way back, so around a corner there is a `2M` band in which the wall does not change — no A ↔ B flicker. While
the candidate is closer than `M` the state reports it as `candidate` (badge: "drag further to move") — only when the pointer has
**left** the current surface; a pointer on an object seen from behind gives no hint.

- **Pointer on the floor** works as in the plan: the new wall must be closer to the pointed floor spot than the current one by
  `M`, both ways. Jitter on a corner bisector does not switch walls. The object lands at the point of the new wall nearest to
  the pointed spot (4.1), not where the ray crosses its plane below the floor.
- **Another room.** With a ray pointer an object moves into another room **only through a passage in its own wall that it fits
  through** (condition 1). The floor or a wall face of another room visible below, above or beyond the wall is neither a target
  nor a hint. The object may return to a room it has already been in during this drag (`MountDrag.visited`); a wall face of such
  a room lying closer to the camera than the current surface hides it, so pointing at the solid wall next to the door moves the
  object straight back. Devices dragged in the planner use `rooms: "any"` — the planner shows the whole level and the device
  moves onto the pointed wall also in a neighbouring room.
- **A wall shorter than the object** does not accept it (ray and plan): the object must be wholly on the wall.
- **The grab along the wall is kept** after a transfer (the same part of the object stays under the pointer), within the
  object's extent (± half its width). An object that cannot get closer to the corner than half its width stands at the end of
  the new wall and **waits for the pointer**.
- **Height on transfer.** The object takes, on the new wall, the height it **had on screen** (after axis lock and snapping),
  not the raw pointer height, which drifts by millimetres during sideways motion. The landing point becomes the new reference
  for the axis lock: further motion along the new wall keeps that height, so an opening edge or another object on the new wall
  does not capture it until the user moves vertically. The motion direction for the axis lock is computed from the **pointer**
  path (target before clamping), so an object waiting at a corner keeps its height.
- **Accepted surfaces** (`MountDragOptions.accept`): wall-mounted furniture stays on room walls — the building facade is a
  mount surface only for exterior devices.
- Beyond the wall end, the height comes from the surface actually visible there, not from the extended plane of the current
  wall. For this reason picking during a drag does not use the corner hysteresis (`HYST_RAY`): the margin `M` applies both ways
  anyway, and hysteresis would hide the neighbouring wall for the first 7 cm beyond the corner.
- **Pointer away from all surfaces** (`MountDrag.away`): the ray left the current surface by more than `M` and points neither
  at a surface the object may move to nor into its own space (lawn, sky, an inaccessible room). The object stays clamped to its
  wall and keeps the grab — when the pointer returns, it is under it again. The floor and ceiling of the object's room are not
  "away": at eye level, a pointer on the ceiling above the wall moves a device horizontally (height unchanged). Furniture ignores
  this state; a device released in it returns to its place.

### 4.6 Slabs hide walls of other levels

In walk mode the candidates are the walls of all levels (on the stairs both are visible). `pickFromRay` checks the slabs
between levels (`slabsClear`): a ray may cross the floor level of a higher level only inside the stair opening (the stair
outline from the package). A project without stairs: each level sees only itself.

## 5. Snapping

The raw position (`u`, `v`) is never changed by snapping; the result (`out`) is derived from it on every event.

| Mechanism | Value | Notes |
|---|---|---|
| fine grid | 1 cm | default for wall-mounted furniture; measured from the **left corner** of the wall and from the floor |
| normal grid | 5 cm | devices ("magnet" setting), furniture when the grid is chosen in the settings |
| alignment — capture / release | 3.5 cm / 5.5 cm | to axes and edges of other objects on the wall, opening axis, wall centre, window head and sill |
| axis lock by motion direction | — | mostly sideways motion keeps the start height, mostly vertical motion keeps the position along the wall |
| button and key step | 1 cm / 5 cm | arrows: 1 cm (Shift: 10 cm, as for free-standing furniture) |

The values for wall-mounted furniture are in one object, `MOUNT` (`src/home/model/mountDrag.ts`); the 5 cm grid comes from
the settings (furniture) or from the planner's "magnet" setting (devices). Snapping never moves the object farther than half a
grid step or the capture distance. **Alt** disables snapping for the duration of the move.

## 6. Precision without aiming

- **Desktop:** ordinary drag with the 1 cm grid; Alt — no grid; arrows — 1 cm in the direction visible on screen (the camera
  may look at the wall from behind); step buttons in the inspector.
- **Phone:** an object moves only after it is selected (a drag over an unselected object turns the camera); dragging locks the
  camera; the quick action bar offers ◀ ▶ ▲ ▼ by 1 cm and a "distance · height" readout instead of rotation; small objects (wall
  lamp, shelf) have a hit area of at least 36 cm; the dimension badge is drawn above the object, away from the finger.
- **Walk:** in both walks (room and building) a click / tap selects the object visible under the pointer, a drag of the
  selected object moves it (same engine, the pointer as a ray from eye level), a drag beside it looks around. Looking around is
  paused during the drag.

## 7. Placement check

`checkMount` works on the object rectangle in (u, v), not on a point. It warns and never blocks: beyond the wall, covers a door
opening, overlaps a window, overlaps another wall object, does not fit under the ceiling or slope. The only hard limits are
physical: the object wholly on the wall, above the floor and below the ceiling. After release the panel and the scene outline
evaluate the stored object with the same mount rules (`storedMountWarnings`, `mountWarnings`), not with the rules for
free-standing furniture; a collision with a free-standing item is still reported by that item. Devices keep their own check
(`checkPlacement`: a door opening is an error, a window or a door leaf a warning).

## 8. Shared infrastructure

| | Wall-mounted furniture | Electrical devices |
|---|---|---|
| surface model | `mount.ts` | `mount.ts` (`ElRoom` / `ElWall` are the same types) |
| picking a new object | `pickFromRay` / `wallFromPlan` | the same functions |
| dragging in 3D | `moveMountDrag`, axes `uv` | `moveMountDrag`, axis `u`; the ↕ handle — axis `v` |
| pointer | `scene/mountPointer.ts` | the same |
| surfaces accepting the object | room walls only (`accept`) | room walls and the facade |
| another room in 3D | only through a passage in its own wall, and back | any pointed wall of the level (`rooms: "any"`) |
| pointer away from all surfaces (`away`) | no effect — the object stays at the wall bound | invalid spot: release does not change the position |
| grid and alignment | `snapped` in `mountDrag.ts` (`MOUNT`) | **own**: `snapAlong`, `alignPlacement` (`electrical.ts`, `elPlacement.ts`) — grid from the "magnet" setting |
| placement check | `checkMount` | **own**: `checkPlacement` (device spacing, zones, type heights) |
| moving on the 2D plan | `moveMountDrag` with a plan pointer | **picking** the nearest wall of the room under the pointer (`surfaceFromDrag`, `wallFromPlan`) |
| record | `mount` + derived position | `wallId`, `positionAlongWall`, `heightAFFL` |

Shared are the **mount surface model, picking and the 3D drag kinematics** (wall lock, grab, bounded gain, transfer with a
margin). Not shared are the snapping and placement rules of electrical devices (they carry installation rules) and their
movement on the plan. The gap between object and wall is an engine constant (`MOUNT.wallGap` = 5 mm + half the depth) and the
orientation follows from the wall normal — neither is a stored field. Unifying snapping and placement checks of both families
is an open task.

## 9. Interaction details

- **Who drives the drag.** Move, release and cancel are accepted only from the pointer that started the drag; a second press
  during it starts nothing (`canStartDrag`). A second finger on the scene cancels a finger drag — it is a camera gesture (pinch
  zooms). After Esc, and after releasing only the left button while another is held, the camera stays paused until the pointer
  is released (otherwise it would rotate by a jump).
- **Top view.** The furniture raycast rejects only what lies above the **level** section (`furnitureCutY`), not above the
  plan cut height, so wall objects and tall wardrobes can be selected and dragged in the plan; furniture of upper levels still
  does not capture clicks.
- **Arrows and step buttons** (`screenAxis`). ← → move along the wall, ↑ ↓ change the height — with the sign in which that
  axis appears on screen. When the height is not visible (top view), ↑ ↓ do not change it: on a wall vertical on screen they move
  the object along the wall in the arrow direction, on a horizontal one they do nothing. The ◀ ▶ buttons in the panel and on
  the phone bar go the same way as the keys (`nudgeMountedSide`).
- **Wall bounds on shape change and load** (`normalizeMounted`). The record gives the object axis, so a larger variant, a
  typed dimension or an out-of-bounds record in the file push the object to the bound (`clampMount`) and fix the record; an
  object that fits is not touched. A record naming a wall that does not exist in the project: the object is first re-hung by
  its position (record repaired); only when no wall is near it is the record removed.
- **New object from the catalog.** Dragging a card (`mountedDrop`): the default height is limited to the wall — the preview,
  its warnings and the dropped record agree (knee wall, slope). Clicking a card (`findFreeSpot` → `freeMount`): candidates along
  the walls are evaluated with the mount rules on the object rectangle — off windows and doors, without overlapping other wall
  objects; spots without collisions with free-standing furniture come first. Ctrl+D (`duplicateSpot`): the nearest spot on the
  same wall and height without overlap; no spot — a message, no copy.
- **Project furnishing** ("Project layout as a new arrangement", "Insert the project kitchen into this arrangement") gets
  mount records like the default arrangement.
- **GLB model without its file** (import from another computer, phone offline): an error boundary around the model
  (`ModelBoundary` in `FurnitureLayer.tsx`) draws a stand-in box and reports the missing file once; the item can be selected,
  moved and deleted, and the document does not change.
- **Selection after Undo / Redo** (`src/home/store/design.ts`): an item moved back into another room stays selected there; an
  item or device that no longer exists is deselected.

## 10. Performance

Pointer motion changes only the transient store; it is subscribed to by the dragged object, the badge and the guides. The
document, the history and saving are not touched until release: one drag — also with a transfer to another room — is one Undo
entry. The number of GPU geometries and textures after a drag equals the number before it.

## 11. Tests

- `src/home/tests/mount.test.ts` — the engine with a pinhole camera independent of the engine: 1 cm / 5 cm moves, height, grab
  at the edge, view change during the drag, angles 0° / 30° / 60° / 88°, corner and hysteresis, transfer with alignment (height
  kept despite an opening edge and pointer drift), passing through an opening, grid and alignment, bounds, warnings, record ↔
  position, top view, slabs in walk mode, pointer on the floor, wall shorter than the object, `away`, a project without a site.
- `src/home/tests/mountedDoc.test.ts` — the mount record as the source of truth after loading and after a depth change.
- `src/home/tests/elPlacement.test.ts` — a device dragged in 3D by the same engine, the height handle, neighbouring room in the
  level view, pointer off the walls and off the scene.
- `src/home/tests/furnitureInteraction.test.ts`, `src/home/tests/modelBoundary.test.ts` — interaction details of section 9.

## 12. Limitations

- Mount surfaces are the vertical walls of rooms; sloped ceilings only limit the height (`heightAt`), they are not surfaces of
  their own.
- Moving furniture between rooms in 3D requires a passage **in the wall it hangs on** that it fits through (and the pointer in
  that opening); on the plan the object goes to the nearest wall of the room under the pointer. Devices in the planner move onto
  any pointed wall in 3D.
- A pointer on the floor picks the **nearest** wall to the pointed spot; when it is shorter than the object, the object stays
  on its wall — the next one by distance is not tried.
- The pointer is projected onto the plane of the **wall face**, not the object front: with a deep object (a 35 cm wall cabinet)
  the grabbed front point leads the pointer by `depth / (camera distance − depth)` — 13% from 3 m, 37% from 1.3 m. The engine
  does not know the depth of the grab point; for a TV or a mirror (3–5 cm) the error is 1–3%.
