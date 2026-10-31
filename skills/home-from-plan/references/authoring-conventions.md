# Authoring conventions (enforced by the compiler where possible)

These rules make a package correct for the engine and stable for the user's saved work.

## Coordinates and units
- Metres; `+X` right on the plan, `+Y` up on the plan, `+Z` up. Images have y DOWN — use `"units": "px"` and let the compiler flip.
- Origin: the **outer** corner of the building at the bottom-left of the plan, so exterior wall faces lie on `x = 0` / `y = 0` and
  every coordinate is positive. Describe it in `project.origin`.
- `Z = 0` is the finished floor of the lowest level; every height (`floorZ`, sills, heads, stairs) uses the same reference.
- Plans need not face north: north is `sun.northAzimuthX` (azimuth of +X, clockwise from north; 90 = +X points east).

## Rooms
- Outline = **inner faces** of the walls (the clear floor area), edges along the plan axes or at 45° to them (§ Walls that are
  not orthogonal). Use `rect` for rectangles, `polygon` for L / U shapes, chamfered corners and triangles. No holes.
- Neighbouring rooms are separated by the wall thickness: interior 0.12 m, exterior 0.30 m (`defaults` if the building differs —
  record the source). Faces that should line up must have the same coordinate.
- An open kitchen + living room is ONE room with `"tags": ["kitchen"]`, even when the plan numbers them separately; put the
  sum of their printed areas in `areaPrinted` and both numbers in the README. A hall with stairs is one room containing the stair
  box.
- A room that opens fully into another (a corridor arm ending in the living room, no wall line between them) is either part of
  that room (an L / U outline) or a separate room with a `passages` entry as wide as the opening — choose what the plan numbers
  as rooms. The second leaves short wall stubs at the ends of the passage.
- `kind` is mandatory and explicit — bath, kitchen, garage, tech, hall, bed, living, office, storage, room. Nothing is inferred
  from names. Tags: `kitchen` (built-in kitchen behaviour), `garage`.
- Room ids: `R1…` in reading order (top-left → bottom-right) per level, or the numbers printed on the plan (verbatim, recorded in
  `source`). Ids never change after `--lock`.

## Doors and openings
- A door is `between: [A, B]` (or `[A, "exterior"]`) with `at` anywhere in the middle of the opening and `width` = clear opening
  in the masonry (typical: 0.8 interior, 0.9 kitchen / living, 1.0 entrance). The compiler finds the wall and writes the gap into
  BOTH rooms.
- Hinged doors: `swingInto` = the room the leaf opens into (on drawings: the side the arc is drawn), `hinge` = left / right as
  seen standing in that room looking at the wall (the arc's centre is the hinge). Exterior doors open into the building unless
  the arc is drawn outside: then `"swingInto": "exterior"`.
- Double door (two arcs meeting in the middle): `"type": "hinged-double"`, `swingInto` as above; `hinge` is not needed.
- Bifold (a zig-zag of two short leaves): `"type": "folding"`, `swingInto` = the room the panels stand out into, `hinge` = the
  jamb they fold to, as seen from that room.
- Sliding / pocket: `"type": "sliding"`, `slideTo: "start" | "end"` (towards the smaller / larger coordinate along the wall).
- An opening without a door leaf → `passages` (no door id).
- Garage door (sectional, up-and-over, roller): no such door type — a `"type": "sliding"` door of the full width in the garage's
  exterior wall (`height` ≈ the printed height, e.g. 2.25), noted in the README. Cars drawn in a garage are context, not
  furniture, unless the user wants them: the catalog item `car` fits one.
- Heights default to 2.05 m opening / 2.00 m leaf.

## Windows
- `room`, `at` = a point on the wall in the middle of the window, `width`. Defaults: sill 0.85, head 2.35; bathrooms often sill
  1.4 / head 2.1; kitchen above the worktop sill ~1.0. A glazed door to a terrace or balcony: `sill: 0` and `passable: true` if
  the plot (`site`) exists and one can walk out.
- A glazing that is not a rectangle — a gable window under the roof (a trapezoid, a pentagon up into the gable) — has
  `outline` instead of `width` / `sill` / `head`: its corners as `[coordinate along the wall, height above the room floor]`
  (x for a wall along X, y for a wall along Y; px in a px plan), every corner under the ceiling at its place; `at` still
  names the wall. Walls along the plan axes only. Only a glazing one can walk through gets `passable` (a lift-and-slide or a
  balcony door) — a fixed pane reaching the floor does not.
- Windows belong on exterior walls (the compiler warns otherwise).

## Stairs
- Three kinds (`kind`), read from the tread lines and the arrow:
  - `straight` — one flight. `risers` = all the risers (count the tread lines and add one; or the "n × 17.5" note); the box is
    flightWidth wide and (risers − 1) × tread long. A box a little longer ends in a landing at the upper floor.
  - `l-turn` — a flight, a square landing in the corner, a flight at a right angle. `risers` = the lower flight's,
    `upperRisers` = the upper flight's; the box is the rectangle around the L: (risers − 1) × tread + landing deep along the
    lower flight, (upperRisers − 1) × tread + landing wide along the upper one. Its free corner stays part of the room.
  - `u-turn` (the default) — two flights side by side, a landing across both ends. `risers` per flight; width across the
    flights = 2 × flightWidth + `gap`; length ≥ (risers − 1) × tread + landing.
- `up` = the direction one walks up the lower flight (on drawings: the arrow, from the "start" dot; N = plan up), `turn` = left /
  right on the landing (l-turn, u-turn). `box` [x0, y0, x1, y1] = every flight and landing.
- The riser comes from the level heights: (upper floorZ − lower floorZ) / all the risers — 0.15–0.19 m is normal; anything else
  means a miscounted flight.
- The centre of the box must lie in a room of the lower level and in a room of the upper level (the opening in its floor). On
  the lower level the space under the upper flight belongs to the room around the foot of the stairs; printed areas usually
  leave the stair out — say so in the README when `areaPrinted` differs for that reason.
- Draw the box on the inner faces; a box reaching a few centimetres into a wall is clipped to the room.
- Winding or spiral stairs, and a straight flight with a landing half way: the nearest of the three kinds with the same
  footprint and the same number of risers (winders → `l-turn` with the turning steps counted as the landing), and say it in
  the README.

## Walls that are not orthogonal
- Walls at 45° (a chamfered corner, a bay, a slanted partition, a wall under the stairs) are modelled as drawn: the room
  `polygon` has the slanted edge, with its corners read on the inner faces. The two rooms of a slanted partition have parallel
  faces one wall thickness apart, measured square to the wall (0.12 m interior: the corners differ by 0.17 m along x or y).
- Doors and windows in a slanted wall work like any other: `at` in the middle of the opening on (or in) the wall, `width`
  along the wall; `hinge` left / right as seen from the room the door opens into.
- Other angles (30°, 60°, curves): the nearest of 0°, 45°, 90° keeping the room's area close; the compiler rejects them
  (`room.angle`). A wall bending through a curve: a few 45° segments. List every such change in the README.
- Furniture or electrical points against a slanted wall: `at` + `rot` (a multiple of 45°) — `wall: N | S | E | W` finds walls
  along the axes only. A pitched roof needs a rectangle: over a chamfered corner give the part `rect` of the walls' bounding
  rectangle only when the drawing shows the roof running over it (a flat roof part needs edges along the axes).

## Provenance
- `source` (plan-level default) says where the facts come from; per item `source` when it differs.
- `defaults.confidence`: `confirmed` (CAD / dimensioned drawing), `probable` (calibrated image), `unknown` (interview / guess).
- Furniture `basis`: `dimensioned`, `drawn` (outline on the plan), `approximate` (default layout).
- Record printed areas in `areaPrinted`; the compiler compares them with the outline (> 10 % → warning: check the scale or the
  outline).

## Furniture
- `at` = centre of the footprint; `rot`: 0 front faces +Y, 90 → −X, 180 → −Y, 270 → +X.
- Against a wall: `"wall": "N|S|E|W"` + `"along"` (x for N / S walls, y for E / W walls) — the compiler puts the back 5 mm off
  the wall and turns the front into the room.
- Wall-mounted items (TV on the wall, mirror, wall cabinet, wall shelf, wall lamp) need `elevation` (bottom edge above the floor).

## Electrical points
- On a wall of their room (within 5 cm): `wall` + `along`, or `at` on the wall line. `height` above the finished floor.

## Text
- ids ASCII; names and labels in the user's language (`project.language`), as printed on the drawing. No personal data (names,
  addresses, parcel numbers) in ids.
- The app speaks English and Polish: give every name a person reads — the project, the levels, the rooms, the viewpoints and
  their hints — its translation into the other language in `names` / `hints` (plan-schema.md). Translate what the room is
  for (a porch at the entrance is an "Entrance porch", not a transliteration), keep numbers ("Room 2" stays numbered 2); never
  leave the other language out for some names only. A walk place for each room the user will ask about by its use (e.g. a kitchen inside a
  living room) is welcome.
