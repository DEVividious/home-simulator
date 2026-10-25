# Furniture catalog ids

Generated from `data/furnitureCatalog.json` by `npm run skills:catalog` — do not edit by hand.

Use these ids in `plan.json → furniture[].catalogId`. Dimensions are w × d × h in cm (front of the item faces +Y at rot 0; the back is at −d/2).
Placement: **wall** — back against a wall (use `"wall": "N|S|E|W"`), **free** — free-standing (use `"at"` + `"rot"`), **under** — slides under a table, **floor** — rugs.
Wall-mounted items (**mount: wall**) need `"elevation"` (height of the bottom edge above the floor, m).

## Living room

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `sofa` | Sofa | 210 × 92 × 84 | wall | `2` (w 160), `3` (w 210), `4` (w 250) |
| `sofa-bed` | Sofa bed | 200 × 95 × 85 | wall | — |
| `armchair` | Armchair | 80 × 85 × 85 | free | — |
| `coffee-table` | Coffee table | 110 × 60 × 42 | free | `rect` (w 110, d 60), `round` (w 80, d 80) |
| `tv-stand` | TV cabinet | 160 × 40 × 50 | wall | — |
| `corner-sofa` | Corner sofa | 280 × 165 × 84 | wall | `right`, `left` |
| `tv` | TV | 145 × 30 × 92 | free | `55` (w 123, d 27, h 80), `65` (w 145, d 30, h 92), `75` (w 168, d 34, h 105) |
| `tv-wall` | Wall-mounted TV | 145 × 5 × 84 | wall · mount: wall | `55` (w 123, d 5, h 71), `65` (w 145, d 5, h 84), `75` (w 168, d 5, h 97), `85` (w 190, d 5, h 109) |
| `sideboard` | Sideboard / media unit | 180 × 45 × 75 | wall | — |
| `pouf` | Pouf | 50 × 50 × 42 | free | — |
| `side-table` | Side table | 45 × 45 × 55 | free | — |
| `fireplace` | Fireplace | 120 × 55 × 275 | wall | `built-in` (w 120, d 55, h 275), `tv` (w 240, d 50, h 275), `stove` (w 55, d 55, h 275) |

## Dining

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `dining-table` | Dining table | 160 × 90 × 75 | free | `4` (w 120, d 80), `6` (w 160, d 90), `8` (w 220, d 100), `round` (w 120, d 120) |
| `dining-chair` | Chair | 45 × 52 × 88 | under | — |
| `bench` | Bench | 140 × 38 × 45 | free | — |

## Kitchen

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `kitchen-base` | Base cabinet | 60 × 60 × 90 | wall | `doors`, `drawers3`, `drawers2` |
| `kitchen-sink` | Sink cabinet | 80 × 60 × 120 | wall | — |
| `kitchen-cooktop` | Cooktop cabinet | 80 × 60 × 90 | wall | — |
| `kitchen-dishwasher` | Built-in dishwasher | 60 × 60 × 90 | wall | — |
| `kitchen-tall` | Tall kitchen unit | 60 × 60 × 220 | wall | `pantry`, `oven`, `oven-micro`, `fridge` |
| `kitchen-wall` | Wall cabinet | 60 × 35 × 72 | wall · mount: wall | `doors`, `lift`, `open` |
| `kitchen-hood` | Cooker hood | 90 × 50 × 115 | wall | `wall`, `island` |
| `kitchen-island` | Kitchen island | 180 × 95 × 90 | free | — |
| `bar-stool` | Bar stool | 42 × 42 × 75 | under | — |
| `pantry-front` | Flush pantry door in cabinetry | 120 × 60 × 240 | wall | `left`, `right` |
| `fridge-freestanding` | Free-standing fridge | 60 × 66 × 186 | wall | — |
| `fridge-sbs` | Side-by-side fridge | 91 × 72 × 178 | wall | — |

## Bedroom

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `bed` | Bed | 150 × 210 × 100 | wall | `90` (w 100), `120` (w 130), `140` (w 150), `160` (w 170), `180` (w 190) |
| `bedside-table` | Bedside table | 45 × 40 × 52 | wall | — |
| `wardrobe` | Wardrobe | 150 × 60 × 220 | wall | `2d` (w 100), `3d` (w 150), `slide` (w 200, d 65) |
| `dressing-table` | Dressing table with mirror | 100 × 45 × 145 | wall | — |
| `crib` | Baby cot | 66 × 126 × 90 | wall | — |
| `bunk-bed` | Bunk bed | 98 × 208 × 165 | wall | — |

## Office

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `desk` | Desk | 140 × 70 × 75 | wall | — |
| `office-chair` | Office chair | 64 × 64 × 112 | under | — |
| `shelves` | Bookcase | 80 × 35 × 200 | wall | — |
| `filing-cabinet` | Desk pedestal | 42 × 55 × 60 | under | — |

## Bathroom

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `bathtub` | Bathtub | 170 × 75 × 58 | wall | `160` (w 160, d 75, h 58), `170` (w 170, d 75, h 58), `180` (w 180, d 80, h 58) |
| `shower` | Walk-in shower | 120 × 90 × 200 | wall | `90` (w 90, d 90, h 200), `120` (w 120, d 90, h 200), `140` (w 140, d 90, h 200) |
| `toilet` | Wall-hung toilet | 40 × 67 × 112 | wall | — |
| `bidet` | Wall-hung bidet | 38 × 62 × 112 | wall | — |
| `vanity` | Vanity unit | 80 × 46 × 115 | wall | `60` (w 60, d 46, h 115), `80` (w 80, d 46, h 115), `100` (w 100, d 46, h 115), `120` (w 120, d 46, h 115) |
| `washer` | Washing machine | 60 × 60 × 85 | wall | — |
| `dryer` | Tumble dryer | 60 × 60 × 85 | wall | — |
| `mirror` | Mirror | 80 × 3 × 90 | wall · mount: wall | `rect`, `round` (w 80, d 3, h 80), `tall` (w 60, d 3, h 170) |

## Storage

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `cabinet` | Cabinet | 100 × 45 × 90 | wall | `low` (h 90), `tall` (h 200) |
| `dresser` | Chest of drawers | 120 × 45 × 85 | wall | — |
| `shelving` | Storage shelving | 90 × 40 × 180 | wall | — |

## Garage

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `car` | Car — compact hatchback | 180 × 410 × 145 | free | — |
| `workbench` | Workbench | 160 × 65 × 160 | wall | — |

## Decor

| id | name | w × d × h cm | placement | variants |
|---|---|---|---|---|
| `rug` | Rug | 160 × 230 × 1 | floor | `120x170` (w 120, d 170), `160x230` (w 160, d 230), `200x300` (w 200, d 300), `80x150` (w 80, d 150), `round160` (w 160, d 160) |
| `floor-lamp` | Floor lamp | 40 × 40 × 160 | free | — |
| `plant` | Plant | 50 × 50 × 120 | free | — |
| `wall-shelf` | Wall shelf | 90 × 22 × 20 | wall · mount: wall | — |
| `wall-lamp` | Wall lamp | 18 × 24 × 30 | wall · mount: wall | — |
