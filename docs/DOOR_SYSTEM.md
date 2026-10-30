# Door system

Doors are part of the project package: every door is a `DoorDef` in `project().building.doors`, usually compiled from the
`doors` list of `plan.json` (`packages/core/src/authoring/compile.ts`). The engine draws the leaves with a pivot on the hinge, opens them
from a card or by tapping in walk mode, uses them as gates in the walk model and offers a global "Show doors" switch. Door
behaviour follows from the data only — the engine has no door ids of its own.

## 1. Authoring — `plan.json`

A door is stated once, as a fact about the plan (`packages/core/src/authoring/plan.ts`):

| Field | Meaning |
|---|---|
| `id` | door id (stable) |
| `between` | the two rooms on either side; `"exterior"` for an outside door |
| `at` | any point in the middle of the opening (on or inside the wall between the rooms) |
| `width` | clear opening in the masonry [m] |
| `type` | `hinged-single` (default), `sliding`, `pocket` |
| `swingInto` | hinged: the room the leaf opens into (default: the second room; for an exterior door — the room) |
| `hinge` | hinged: `left` / `right`, as seen from the room the door opens into, looking at the wall |
| `slideTo` | sliding / pocket: the leaf moves towards the `start` (smaller coordinate) or `end` of the opening |
| `height`, `leafHeight` | opening and leaf height (defaults from `defaults.doorHeight` = 2.05 m, `defaults.leafHeight` = 2.00 m) |
| `confidence`, `source` | provenance |

The compiler finds the wall shared by the two rooms (or the outer wall of the room for an exterior door) that holds the
opening, cuts the door gap into **both** rooms, and derives the hinge point and direction vectors. The leaf width is the
opening width − 0.10 m; the hinge sits 5 cm from the jamb, on the face of the room the door opens into. A door to the
outside opens inwards unless `swingInto` is `"exterior"`; then the hinge sits on the outer face of the exterior wall and the
leaf swings outwards. Two leaves that sweep the same floor are reported (`door.swingOverlap`). A door without a stated direction is
not guessed by the engine: the authoring skill decides (from a swing arc on a drawing, or as an assumption with
`confidence: "probable"`).

## 2. Data model — `DoorDef` (`src/home/model/doors.ts`)

| Field | Meaning |
|---|---|
| `id`, `level`, `floorZ` | identifier, level, floor height |
| `rooms: [A, B]` | rooms on both sides; B = `exterior` for an outside door |
| `opening` | `along` (wall axis `X` / `Y`), `from`, `to`, `faces` (wall faces, cross coordinate), `width`, `height` — the masonry opening |
| `leafWidth`, `height` | the leaf |
| `type` | `hinged-single` · `hinged-double` · `sliding` · `pocket` |
| `hinge` | hinge axis in plan (LCS); `null` for sliding leaves |
| `closedDir`, `openDir` | unit vectors: closed leaf (hinge → lock) and leaf opened by 90° |
| `hingeSide` | `left` / `right`, as seen from the room the door opens into |
| `swingInto` | room the leaf opens into |
| `openAngle` | full opening angle (90°) |
| `slide` | sliding leaf: `{ origin, dir, travel }` — start on the wall axis, sliding direction, travel |
| `source`, `confidence`, `notes` | provenance and confidence |
| `flush` | door flush with the wall: concealed frame in the leaf colour, flat pull instead of a handle on the opening side |

Facts beyond geometry live in `project().building.doorFacts`: `overrides` (e.g. `{ flush: true, source }` for one door) and
`passableOpenings` — floor-level windows (glazed doors, `passable: true` in `plan.json`) through which the walk can leave the
building onto the plot.

**Exterior doors are ordinary doors** with `rooms: [room, "exterior"]`: they have a hinge or a sliding track, open and close
like interior doors and, when open, let the walk pass out onto the plot (in a project with the `site` module).

A door is interactive when it has a hinge or a sliding track (`isInteractive`). Leaf geometry follows from
`leafSegment(d, t)`: hinged — rotation about the hinge point (the hinge point is fixed for every `t`), sliding — a shift along
the wall by `travel · t`. `swingArc` gives the plan arc, `inDoorway` tells whether a point stands in the clear opening.

## 3. Door state (view state, not part of the document)

`DoorState = { show, open: { [id]: 0…1 } }` — `src/home/store/doors.ts`. It is stored in the browser preferences under
`home-simulator.doors.v1:<projectId>` (version, `show`, only doors that are not closed); unknown doors and invalid values are
skipped on reading. The state is not written to the user document and creates no history entries (like the camera); it never
changes or removes door definitions.

Diagnostics and tests: `?doors=open | closed | hidden`.

## 4. 3D scene — `src/home/scene/DoorsLayer.tsx`, `src/home/three/doorGeometry.ts`

- **Pivot on the hinge.** The leaf matrix (`leafMatrix`) is built from the hinge point and the leaf direction: the local
  origin lies on the hinge axis, local X runs to the lock. The closed leaf face is flush with the wall face on the opening
  side. Tests check that the hinge edge never moves and the handle edge describes an arc of the leaf radius.
- Leaf with handles = one mesh (vertex colours) → one draw call per door; the frames of a level are merged into one mesh;
  flush doors have a separate frame mesh in the leaf colour.
- Leaves belong to the architecture group: the level section and the cutaway of occluding walls apply to them as to walls.
- Sliding and pocket leaves move along the wall by their travel.
- An invisible hit box thicker than the leaf (22 cm) makes a tap at a grazing angle easier.
- Animation: 0.55 s (`DOOR_ANIM_S`) with ease-in / ease-out; leaf thickness 4 cm (`LEAF_T`).

## 5. Interaction

| View | Click / tap on a door |
|---|---|
| level section, room (3D, plan) | select → **door card**: Open / Close, angle slider (0–90°; sliding: 0–100%), data from the package |
| 2D plan in the panel (level, room) | swing arc + leaf in its current position; tapping the symbol selects the door |
| walk (room and building) | **tap** — open / close at once, animated; **long press** (0.55 s without moving, `LONG_PRESS_MS`) — the door card |

One rule in walk mode for everything that opens: **tap = action, hold = configuration**. The same applies to the stairs (hold
= stairs card). Outside walk mode a tap selects the element.

- Only the object **actually visible under the finger** reacts (`isNearest`, `src/home/scene/press.ts`): a door behind a
  wall or on the other side of the building does not; invisible debug layers are skipped.
- The click that ends a long press is swallowed: a card opened by a long press changes the layout (on a phone the drawer
  narrows the scene), and without this the lifted finger would hit a button that slid under it.

In walk mode doors react within 3.2 m (`DOOR_REACH`); a door whose opening the camera stands in cannot be closed (a message
explains why). In the top view of a room the swing arcs are also drawn in the scene.

**Performance:** the scene renders on demand. A door state change wakes frames only for the duration of the animation
(`wake()`), after which the idle frame count returns to zero. Continuous rendering is never enabled for doors.

## 6. Collision in walk mode

The walk model (`src/home/model/walk.ts`) has a corridor through the wall thickness in every door opening. The corridor
carries the door id and a gate: passing is allowed when leaves are hidden **or** the door is open at least 60%
(`PASS_OPEN`). A closed door blocks (the camera stops in front of the leaf and slides along the wall). Passages without doors
are always open. Doors to the exterior get corridors to the plot in `src/home/model/walkWorld.ts`, gated in the same way. The
collision is simplified: an open leaf is not an obstacle itself; there is no rigid-body physics.

Furniture warnings use the door model: the swing zone (leaf width) applies only on the side the leaf opens to; on the other
side a free clear width is enough.

## 7. "Show doors"

The **Doors** switch (`src/home/ui/DoorsToggle.tsx`) sits in the view bar under the scene (desktop), next to the sun button
(phone, 44 px), in the Building and Interiors panels and in the Expert layers. Off: leaves hidden, frames and openings stay,
leaf collisions are off (every door passable). Door data and open states are kept. The panels also offer "Open all" /
"Close all".

## 8. Phone

Tap a door → selection → card in the drawer (44 px buttons). Walk: tapping a door opens / closes it, the joystick leads
through open doors.

## 9. Tests

`src/home/tests/doors.test.ts` — fields, types, directions, pivot on the hinge, angle, leaf matrix, sliding leaves,
serialisation, "Show doors", walk collision. `src/home/tests/pantryDoor.test.ts` — a door hidden in a line of cabinet fronts.
`src/authoring/tests/compile.test.ts` — compiling doors from `plan.json`.

## 10. Limitations

- The hinge side cannot be changed in the UI — it is a fact of the package; change `plan.json` and rebuild.
- An open leaf blocks neither movement nor furniture.
- One leaf colour for the whole project; a flush leaf does not follow the wall colour of the room.
- Garage doors, gates and other exterior joinery are not part of the engine.
