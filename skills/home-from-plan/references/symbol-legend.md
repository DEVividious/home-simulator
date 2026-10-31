# Reading floor-plan symbols

| Symbol | Looks like | What to write |
|---|---|---|
| Wall | thick black / hatched band; exterior ~0.25–0.45 m, interior ~0.08–0.15 m | room outlines on the inner faces; thickness = gap between neighbouring rooms |
| Door (hinged) | a gap in the wall + a straight leaf line + a quarter arc | `doors[]`: arc centre = hinge, the arc lies in the room the door opens into (`swingInto`; an arc outside the building = `"exterior"`); arc radius ≈ leaf width (interior 0.7–0.9 m, entrance 0.9–1.0) |
| Double door | two arcs meeting in the middle | one door of the full width (`hinged-single` is used by the engine; note it in the README) |
| Folding / bifold door | a zig-zag of short leaf lines, sometimes two small arcs | not supported — the nearest is one `hinged-single` (or `sliding` when it folds along the wall); note it in the README |
| Sliding door | leaf drawn parallel to the wall, often with an arrow | `"type": "sliding"`, `slideTo` = direction of the arrow |
| Pocket door | leaf drawn inside the wall thickness | `"type": "pocket"` |
| Opening without door | a gap without a leaf | `passages[]` |
| Window | thin double / triple lines across the wall band, often lighter | `windows[]` on that wall; width = length of the glazing lines |
| Balcony / terrace door | window symbol reaching the floor, sometimes with an arc | window with `sill: 0` (`passable: true` if the plot is modelled) |
| Stairs | parallel tread lines, a line with a dot at the start and an arrow towards "up" | `stairs[]` with `kind`: `straight` (one run of treads), `l-turn` (two runs at a right angle, a square landing in the corner), `u-turn` (two runs side by side); `up` = arrow direction on the lower flight, `turn` on the landing; winders / spiral: nearest kind and a README note |
| Bathtub | rounded rectangle ~1.6–1.8 × 0.7–0.8 m | `bathtub` (variant by length) — also a scale check |
| WC | oval bowl + tank against a wall, ~0.4 × 0.65 m | `toilet` against that wall |
| Washbasin | small oval / rectangle at a wall | `vanity` |
| Shower | square ~0.9 × 0.9 m with a cross or a drain dot | `shower` |
| Kitchen | run of squares 0.6 m deep along a wall; hob = 4 circles, sink = basin with tap | `kitchen-base`, `kitchen-cooktop`, `kitchen-sink`, `kitchen-tall`, `fridge-freestanding` along that wall |
| Wardrobe | rectangle 0.6 m deep with an X or diagonal lines | `wardrobe` (variant by width) |
| Bed | rectangle 1.4–1.8 × 2.0 m with pillows at the head | `bed` (variant = mattress width) against the head wall |
| Table + chairs | rectangle / circle with small squares around | `dining-table` + `dining-chair` |
| Sofa | long rectangle with arm and back bands | `sofa` / `corner-sofa` |
| Washing machine | square ~0.6 m, sometimes a circle inside or "WM" | `washer` |
| Fridge / freezer | square ~0.6 m in the kitchen run, often with "*" (a snowflake) or "LOD" | `fridge-freestanding` — "*" next to the hob or sink is a fridge, in a bathroom or utility room it may be a washer |
| Radiator, plant, rug | thin rectangle at a window / decorative symbol | usually skip (rug: `rug`) |
| Room label | name + area "12.4 m²" | `name`, `areaPrinted` (calibration!) |
| Arrow triangle at an entrance | entrance marker | the exterior door is there |
| Dimension chain | numbers along a line with ticks, in cm on most European plans (e.g. "458", "1500") | the best scale evidence: `calibrate.py points` with `--length`; room sizes like "458 × 341" are inner faces |
| Window label | circle / oval with "w/h" in cm, e.g. "180/150", "78/140" | opening width w and height h; the head is usually 2.20–2.35 m (lintel line), so sill = head − h; a floor-level door "180/230" → `sill: 0`; a label inside the roof area means a roof window |
| Attic height lines | dashed or thin lines parallel to the eaves, labelled 140 / 220 (cm) at the margin, grey band between | roof part `lines` (or level `slope.lines`) — 1.40 and 2.20 m above the floor; the ridge runs parallel to them |
| Knee wall | "ścianka kolankowa", "h = 100" next to the exterior wall of an attic, in the section a short wall under the slope | roof part `knee` (height above the floor at the outer face) | <!-- i18n-ok: drawing terms in Polish -->
| Roof window | rectangle in the sloped zone with a "78/140"-style label | `roofWindows[]` |
| Ridge (roof plan) | the top line of the roof, often with "kalenica" and a height "+8,45" | the part's `ridge` axis; the height → `roof.ridgeHeight` |
| Hip / valley (roof plan) | diagonal lines from an outer corner (hip, narożnik) / from an inner corner (valley, kosz) up to a ridge | `type: "hip"`; valleys come from two wings (one part per wing) | <!-- i18n-ok: drawing terms in Polish -->
| Eaves line (roof plan) | the outline of the roof outside the walls, dashed on floor plans | `roof.eaves` / `verge` = its distance from the outer wall face |
| Pitch | "40°", "∠ 40°", "kąt nachylenia 40°" on a slope or in the section | the part's `pitch` | <!-- i18n-ok: drawing terms in Polish -->
| Dormer (lukarna) | a bay in the roof outline with its own small roof and window; on the attic plan a recess in the knee wall | `roof.dormers[]` |
| Chimney (komin) | small filled or hatched rectangle in a wall, above the roof on elevations | `roof.chimneys[]` |
| Car outline, garden plants, terrace paving | context drawings | not furniture by default — garage `kind: "garage"`; terrace as a note; the catalog `car` only if the user wants cars |
| Garage door | wide gap in the garage's exterior wall, label like "500/225" | `"type": "sliding"` door of that width and `height` (no sectional door type; note it) |
| Watermark / logo | large diagonal text or a logo over the drawing | ignore |

Size priors for calibration (`tools/image/calibrate.py symbol --kind …`) — for doors measure the **arc radius** (hinge to the tip
of the leaf = the leaf width; `width` in plan.json is the clear opening ≈ leaf + 0.10): `door` 0.8 (0.7–0.9), `entrance-door`
0.9 (0.85–1.0), `bathtub` 1.7 (1.5–1.8), `bed` length 2.0, `wc` depth 0.65. Symbols are weak evidence — prefer printed areas and
dimensions; with symbols only, use at least three estimates of two different kinds.
