# Reading floor-plan symbols

| Symbol | Looks like | What to write |
|---|---|---|
| Wall | thick black / hatched band; exterior ~0.25–0.45 m, interior ~0.08–0.15 m | room outlines on the inner faces; thickness = gap between neighbouring rooms |
| Door (hinged) | a gap in the wall + a straight leaf line + a quarter arc | `doors[]`: arc centre = hinge, the arc lies in the room the door opens into (`swingInto`); arc radius ≈ leaf width (0.8–0.9 m, entrance 0.9–1.0) |
| Double door | two arcs meeting in the middle | one door of the full width (`hinged-single` is used by the engine; note it in the README) |
| Sliding door | leaf drawn parallel to the wall, often with an arrow | `"type": "sliding"`, `slideTo` = direction of the arrow |
| Pocket door | leaf drawn inside the wall thickness | `"type": "pocket"` |
| Opening without door | a gap without a leaf | `passages[]` |
| Window | thin double / triple lines across the wall band, often lighter | `windows[]` on that wall; width = length of the glazing lines |
| Balcony / terrace door | window symbol reaching the floor, sometimes with an arc | window with `sill: 0` (`passable: true` if the plot is modelled) |
| Stairs | parallel tread lines with an arrow towards "up" | `stairs[]` (U-turn only) or a note |
| Bathtub | rounded rectangle ~1.6–1.8 × 0.7–0.8 m | `bathtub` (variant by length) — also a scale check |
| WC | oval bowl + tank against a wall, ~0.4 × 0.65 m | `toilet` against that wall |
| Washbasin | small oval / rectangle at a wall | `vanity` |
| Shower | square ~0.9 × 0.9 m with a cross or a drain dot | `shower` |
| Kitchen | run of squares 0.6 m deep along a wall; hob = 4 circles, sink = basin with tap | `kitchen-base`, `kitchen-cooktop`, `kitchen-sink`, `kitchen-tall`, `fridge-freestanding` along that wall |
| Wardrobe | rectangle 0.6 m deep with an X or diagonal lines | `wardrobe` (variant by width) |
| Bed | rectangle 1.4–1.8 × 2.0 m with pillows at the head | `bed` (variant = mattress width) against the head wall |
| Table + chairs | rectangle / circle with small squares around | `dining-table` + `dining-chair` |
| Sofa | long rectangle with arm and back bands | `sofa` / `corner-sofa` |
| Washing machine | square ~0.6 m, sometimes a circle inside or "WM", "*" | `washer` |
| Radiator, plant, rug | thin rectangle at a window / decorative symbol | usually skip (rug: `rug`) |
| Room label | name + area "12.4 m²" | `name`, `areaPrinted` (calibration!) |
| Arrow triangle at an entrance | entrance marker | the exterior door is there |

Size priors for calibration (`tools/image/calibrate.py symbol`): door 0.9 (0.8–1.0), bathtub 1.7 (1.5–1.8), bed length 2.0,
WC depth 0.65. Symbols are weak evidence — prefer printed areas and dimensions.
