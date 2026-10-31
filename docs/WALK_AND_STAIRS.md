# Walk mode and stairs

Walk mode moves a person-height camera through the building, between levels by the stairs and out onto the plot — with keys,
mouse look or a touch joystick, without teleporting. The walk model is pure TypeScript and is tested without a browser.

## 1. Two walks

| Walk | Started from | Covers |
|---|---|---|
| **Building walk** | Building → "Walk" (or an eye-level viewpoint, or a bookmark saved in a walk) | every level, the stairs, passable exterior doors and the plot (project with a site) |
| **Room walk** | **Walk** in the scene bar inside a room (Around · From above · Walk) | the current arrangement, including a live preview of edits; doors between rooms of the level switch the room in the panel |

A room walk **hands over seamlessly to the building walk** — same position and view direction — when the camera comes within
25 cm of the stair outline or stands in the threshold of an open exterior door (`CameraController.tsx`). From there the stairs,
exterior doors and the plot work. The walk command carries the room it started in (`WalkGo.from`): furniture reacts in every
walk, the surfaces of the room underfoot stay selectable in a walk started in a room, and ending the walk (`exitWalk`) returns
to the 3D view of the room the user stands in (from the stairs or the plot — to the room they left). The handover is one-way:
the two walks light the scene differently, and switching back at every pass of the stairs would flicker.

## 2. Controls

| Input | Action |
|---|---|
| **W A S D** / arrows | walk (forward, back, sideways) |
| Shift | faster: 4.58 m/s instead of 2.0 m/s (`WALK_SPEED`, the same in both walks) |
| mouse drag (left or right button) | look around (yaw and pitch) |
| wheel | step forward / back |
| click / tap a door | open / close (hold — door card; [DOOR_SYSTEM.md](DOOR_SYSTEM.md)) |
| click furniture | select; dragging the SELECTED item moves it (on its wall or on the floor), a drag beside it looks around |
| Esc | deselect; with nothing selected — end the walk |
| "‹ Building view" | end the walk; a walk started in a room returns to that room's 3D view |
| phone | joystick bottom-left (116 px, 104 px in landscape, 12% dead zone) + look around with another finger |

- **Field of view** 70° (`WALK_FOV`, or the FOV of the viewpoint / bookmark), set on every start and resume of a walk.
- **Eye height** 1.68 m above the floor or ground, adjustable in the settings (the same value for both walks). The eyes follow
  the feet with exponential smoothing, so steps, thresholds and terrace edges do not jolt the image.
- A status line at the top of the scene shows the place (level and room, "Stairs", an exterior opening, or the site surface
  under the feet) and the foot level relative to ±0.00.
- Indoors a soft walk lamp at the camera (`WalkLamp`) keeps ceilings and walls in the sun's shadow from turning black.

## 3. The walk model — `src/home/model/walk.ts`, `src/home/model/walkWorld.ts`

The walkable surface consists of:

| Part | Source | Behaviour |
|---|---|---|
| rooms of all levels | room outlines of the package (`walk.ts`) | clearance from walls = body radius 0.22 m (`BODY_R`); walking straight at a wall stops 1 m before it (`FRONT_STOP`; already closer — off the stairs, out of a doorway — down to 0.45 m, `NEAR_STOP`), open doors and passages ahead do not stop; furniture that reaches eye height (a wardrobe, a tall unit, a wall cupboard — not a sofa, a table, a bed) stops the walk the same way (`store/walkObstacles.ts`), and from inside an item the way out is free; under a sloped ceiling, places where the ceiling is lower than eye height + 12 cm are not walkable; doors and passages are corridors through the wall thickness |
| door gates | `DoorDef` + door state | a closed leaf blocks the corridor; open ≥ 60% or "Show doors" off — passable |
| exterior openings | doors with `rooms: [x, "exterior"]`, windows with `passable: true` (`doorFacts.passableOpenings`) | corridors from the room out through the wall to the plot, gated by the door state |
| plot | `project().site` (module `site`) | outside the building outline (with the body clearance), within `walkBounds` (default: bounding box of the plot boundary); foot height from the ground probe |
| stairs | `project().building.stairs` (module `stairs`, section 4) | ramp over the tread nosings, landing, divider between flights |

**Collisions and ground.** A step is allowed when the target point belongs to the walkable surface **and** the foot height
changes by at most **0.30 m per 8 cm segment** (`MAX_STEP`). Longer steps are split into segments, so a wall cannot be
"jumped". At an obstacle the motion slides along it (X and Y separately). This one rule also gives:

- from a lower level you cannot walk under the upper flight or onto the landing — the height would jump by more than 0.30 m;
- from an upper level you cannot fall into the stair opening — it acts as a balustrade;
- thresholds (terrain a few cm below the floor) and terrace edges are passable.

**Ground height** (`GroundProbe`, `src/home/scene/WalkLayer.tsx`): a vertical raycast on the site model (meshes listed in
`assets.groundMeshes`, or all), the highest hit, with a 5 cm cache; a site without a terrain model is flat at
`site.groundLevel` (`FlatGround`). The probe is also available to tests as `sceneApi.ground(x, y)`.

**Main walls.** Collisions come from room outlines, i.e. inner wall faces. Furniture does not block the walk — it is an obstacle
only in the arrangement editor. Levels change by foot height (`levelAtZ`: above the midpoint between two floor levels the upper level applies), and the UI
switches to it.

A project without a site has no corridors to the outside and no walking on the ground; a project without stairs keeps the walk
on its single level.

## 3.1 Exits

On the level at ground every exterior door and floor-level passable glazing shows a green **Exit** sign just inside its head
and a green arrow on the floor pointing out — so the way out, and which glazing opens, can be seen from inside (usability issue
B8). A click or tap on either walks out: a closed door opens, the walk goes up to the opening and through it onto the plot
(`src/home/model/exits.ts`, `src/home/scene/ExitSigns.tsx`, `walkOutside` in `src/home/actions.ts`). The signs exist only
while walking and only in projects with a site.

## 4. Stairs — `packages/core/src/model/stairs.ts`, `src/home/model/stairs.ts`

The engine knows three stair kinds, in any of four directions and (with a landing) turning either way:

| `kind` | shape | `risers` |
|---|---|---|
| `straight` | one flight; a box longer than the flight leaves a short landing at the upper floor height at its top | all of them |
| `l-turn` | lower flight, a landing in the corner, upper flight at a right angle (`upperRisers`) | of the lower flight |
| `u-turn` (default) | two flights side by side, a landing across both ends, a `gap` between the flights | per flight |

```json
"stairs": [{ "id": "S1", "kind": "l-turn", "from": "L0", "to": "L1", "box": [x0, y0, x1, y1], "up": "N", "turn": "left",
             "risers": 8, "upperRisers": 8, "tread": 0.27, "flightWidth": 0.9 }]
```

- `box` — the plan outline of every flight and landing; for an L the box around the L (its free corner stays part of the room
  on both levels — only the L is the floor opening of the upper level).
- `up` — the direction one walks up the **lower flight** (`N` = +Y, `S`, `E`, `W`); a straight flight arrives at that end, an
  L or U has its landing there.
- `turn` — which way one turns on the landing going up (L, U); a U's upper flight returns beside the lower one and arrives on
  the upper level at the end where the lower flight starts, an L's upper flight runs along the box edge at the landing's end.
- the riser height follows from the level heights and the risers of all flights (`StairDef.riser`, `landingZ`, `topZ`).

The engine computes in one canonical frame (up `S`, turn `right`: the lower flight on the larger-X side rising towards −Y, the
landing at the smaller-Y end — across the box for a U, in the corner for an L — and the upper flight towards −X);
`StairDef.orient` (`rotate` 0 / 90 / 180 / 270 counter-clockwise, `mirror`) maps it onto the plan (`stairFrame` in
`packages/core/src/model/stairs.ts`). The layout is a list of **pieces** — flights and landings as canonical rectangles
(`stairPieces`) — and their **sides**: entry, exit, joined to the next piece, wall, open (a drop) or the U's partition
(`stairSides`). The walk, the 3D stairs, the plan drawings and the print all read them. A U's walls are its smaller-X and
smaller-Y sides (the lower flight's outer side is open); an L stands in a corner (its outer sides are walls, the inner sides of
the L are open); a straight flight is open on both sides.

**Walking on stairs.** The rendered steps are real; navigation uses an **invisible ramp** over the step nosings that matches the
flights (`stairZ`): each flight from its lower end to its upper end, landings flat. Single steps are
not obstacles, and with 8 cm segments a 17.5 cm riser is about 5.5 cm of height change per segment — well under `MAX_STEP`. Edges
do not catch: motion slides along the divider or a wall (walking up diagonally works). A figure keeps clear of walls, open sides
and the partition beside them (not around their ends); movement between flights is possible only via the landing. Typical climb
on a keyboard: forward (W) up the lower flight to the landing, turn with the mouse or step sideways (A / D) along the landing,
forward up the upper flight; on a phone the joystick does the same.

### 4.1 Stairs finishes

The structure — number and size of steps, landing, outline — is package data that configuration does not change. The
**finish** is a user choice stored in the variant (`Variant.stairs`, optional; missing = bare concrete), modelled in
`src/home/model/stairsConfig.ts`:

| Element | Options |
|---|---|
| treads and landing | cladding: concrete, oak, dark oak, walnut, ash, white, graphite, black, steel — or a custom colour; thickness 0–6 cm (0 = bare concrete), nosing 0–4 cm |
| risers | no cladding or any finish / colour |
| handrail | none · outer side of the flights · by the divider · both; height 0.80–1.10 m; round or rectangular profile; finish |
| balustrade | none · bars · glass · solid; height 0.90–1.20 m; finish — divider between flights, open side of the lower flight and landing, railing around the stair opening on the upper level |

Presets: "Concrete", "Oak + wall handrail", "Oak + black steel", "Ash + glass", "Walnut + solid balustrade". The stairs card opens
by clicking / tapping the stairs in the section or a room, with **Stairs** next to the rooms in Arrange, or by a long press in
walk mode. Every change
is one history entry and is saved and exported with the variant. Cladding does not change the step levels (the concrete under
it is lower by its thickness), so the walking surface stays the same. Geometry: `src/home/three/stairGeometry.ts` (at most six
meshes merged by material).

## 5. Eye-level viewpoints and bookmarks

**Viewpoints** come from the package (`project().viewpoints`, compiled from `viewpoints` in `plan.json`: `id`, `name`, `level`
(or the site), `at`, `look` (a point with height), `fov`, `hint`), and are listed in Building → walk. On opening, each point is
settled in the walk model (`WalkWorld.settle`): moved off walls (spiral search up to 3 m) and matched to the floor or ground
height. View direction: `lookAngles(p, look, eye)` — yaw with forward = `(−sin yaw, cos yaw)` in LCS, pitch upwards.

**User bookmarks** saved during a walk have `view: "walk"`; opening one resumes the walk at the same spot, view direction and
level ([VARIANTS_AND_ARRANGEMENTS.md](VARIANTS_AND_ARRANGEMENTS.md)).

## 6. Scene modes

`sceneMode` (`src/home/scene/sceneMode.ts`) has a `walk` kind: the whole building without a section, room ceilings visible,
surroundings per the switch. The camera is then driven by `WalkController` (`src/home/scene/WalkLayer.tsx`), the orbit
controller is off. Room walk is a view of the room mode (`roomView: "walk"`) driven by `CameraController.tsx`. Both read the
joystick through `src/home/scene/walkInput.ts`.

## 7. Limitations

- Furniture is not an obstacle in the walk; collisions are with wall faces (room outlines), the building outline and the plot
  bounds.
- Walking on the plot is limited to `walkBounds`; beyond it there is no walkable surface.
- Stairs are straight, L-shaped or U-turn with a box along the plan axes; no winders, spiral stairs or straight flights with a
  landing half way.
- Photo matching, garage doors and gates are not part of the engine.

## Files and tests

- Model: `src/home/model/walk.ts`, `walkWorld.ts`, `stairs.ts`, `stairsConfig.ts`, `viewpoints.ts`.
- Scene: `src/home/scene/WalkLayer.tsx` (`GroundProbe`, stairs mesh, `WalkController`, `WalkLamp`), `CameraController.tsx`
  (room walk, handover), `walkInput.ts`, `sceneMode.ts`. State: `src/home/store/walk.ts`, `src/home/store/ui.ts`.
- Tests: `src/home/tests/walkWorld.test.ts` (ramp and flights, up and down, no entry under the upper flight or into the opening,
  exits to the plot), `stairs.test.ts` (finish config, presets, validation, cladding geometry, room walk → building walk zone),
  `walkInput.test.ts`, `walkEdit.test.ts` (editing in walk mode).
