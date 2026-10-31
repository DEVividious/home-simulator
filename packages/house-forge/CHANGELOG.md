# Changelog

## 0.2.0

- Stairs of three kinds: straight, L-shaped (a landing in the corner) and U-turn — `plan.json` stairs take `kind` and, for an L,
  `upperRisers`; the print has solid steps of every kind (a straight flight no longer prints as an empty floor), and the slab
  opening of an L follows the L.
- Double doors (`hinged-double`) and bifold doors (`folding`).
- Walls at 45° to the plan axes (chamfered corners, bays, slanted partitions) with doors and windows in them; a room may be a
  triangle. Other angles are an error (`room.angle`).
- The approval card is written wholly in the user's language, the kind of stairs included.
- The parts stack like bricks: registration tabs on the top of the exterior walls fit pockets in the part above (`--joints
  off` leaves them out); the card says how many.
- A flat roof over a single-storey wing prints with the storey above it, so every storey's part is open from above.
- Gable windows that are not rectangles (`outline` in `plan.json`: a trapezoid or pentagon under the roof).
- Fewer questions: the skill names the workspace itself and takes the largest scale that fits, offering a smaller one on the
  approval card.
- A straight flight ending at a wall with a short landing printed with an open ground-floor part; the landing now runs into the
  walls around it.

## 0.1.1

- Every reply in the user's language, also the first sentence after a long run of tools.
- `plan.json` takes names in a second language (`names`, viewpoint `hints`) for the Home Simulator app; the compiler warns when a
  language is only partly translated. The print does not need them.

## 0.1.0

- First version: plan images, vector PDF sheets (pymupdf) and DXF / DWG drawings read into `plan.json` with the Home Simulator
  tools; compile with "what the plan says"; previews of every level, the roof and the building without a browser; printer
  table; scale table; dry run with an approval card; versioned builds of STL parts (one per storey and a removable roof)
  byte-identical to the engine's print export; `--from` for changes.
