# Electrical and smart home planner

A light planner for electrical and smart home points: place devices on walls and ceilings in 3D, on the plan or at eye
level, store their exact position (room, wall, distance from a corner, height) and print a plan with a point table.

> **A design and coordination aid — NOT an electrical installation design.** The app does not size cables, protective
> devices, circuits, cross-sections or loads, and does not check compliance with regulations.

The planner is a project capability (`electrical`); it shows up as the **Electrical** section. Wall placement and dragging
use the shared mount engine — [WALL_MOUNTED_OBJECT_PLACEMENT.md](WALL_MOUNTED_OBJECT_PLACEMENT.md).

## 1. Layers of the implementation

| Layer | File | Role |
|---|---|---|
| point data | `src/home/model/electrical.ts` (`ElPoint`, `ElectricalPlan`) | what and where; stored in the user document |
| device catalog | `src/home/model/devices.ts` (`DEVICES`, `DEVICE_CATEGORIES`) | definitions for the user and the engine; stores nothing in the document |
| placement engine | `src/home/model/elPlacement.ts` | where a device may go, checks, alignment |
| transient state | `src/home/store/elPlace.ts` | new / copy / move / height session; one commit per operation |
| input | `src/home/ui/ElectricalPlan.tsx` (plan), `src/home/scene/electricalInput.ts` (3D, eye level) | pointer → engine → transient state |
| view | `src/home/ui/ElectricalPanels.tsx`, `src/home/scene/ElectricalLayer.tsx`, `src/home/plan/elPlan.ts`, `src/home/three/electricalGeometry.ts` | toolbar, catalog, card; 3D instances; plan and PDF symbols |
| export | `src/home/pdf/` (`electricalPdf.ts`, `exportElectrical.ts`, `pdfText.ts`, `fonts/`) | PDF, JSON, CSV |

## 2. Point data — `ElPoint`

| Field | Meaning |
|---|---|
| `id` | category prefix + number: G sockets, W switches, L lights, R distribution boards, D data, S smart home, C sensors, P high power / EV; numbers are never reused |
| `type` | point type (section 3) |
| `roomId` | a room of the package, or `EXT` (outside — only in a project with a site) |
| `wallId` | wall edge of the room (for `EXT`: an edge of the building outline); `null` — ceiling / free point |
| `positionAlongWall` | distance from the start of the wall edge [m] |
| `heightAFFL` | height of the point axis above the finished floor [m]; outside — above the ground |
| `orientation` | `wall` / `ceiling` / `free` (floor point or a point on the plot: `x`, `y`) |
| `modules` | number of sockets / modules in the frame |
| `label`, `purpose`, `circuitLabel`, `notes` | description, purpose (fridge, gate …), circuit label given by the electrician, notes |
| `smartHome` | `none` / `switched` / `dimmable` / `sensor` / `bus` / `relay` / `network` |
| `source`, `status` | `user` or a source name; `planned` / `confirmed` / `proposed` / `source` / `unresolved` |
| `boardKind`, `width` | distribution board: kind (`unspecified`, `electrical`, `smart`, `teletech`), approximate width |
| `smart` | optional links for a future smart home planner (section 9) |

**Distance from the left corner.** A wall split by doors is several edges in the data; for measuring they are joined into
one **run** (`wallRuns`), so the reference is a real corner of the room. "Left" means left when you face the wall from inside
the room (for a facade — from outside). The report also gives the distance from the right corner; their sum is the run
length. On the plan the left corner is marked with a black triangle and the wall number.

**Identifiers.** A deleted number never comes back — also not the highest one (after deleting G3 the next socket is G4): a
printed plan must not point at another device. The plan remembers the highest issued number per prefix in the optional field
`lastId` (`{ "G": 3 }`), written only on such a deletion; a plan without it is valid, and the exports do not contain it.

## 3. Point types and device catalog

Types (`EL_TYPES`): socket ×1 / ×2 / ×3, outdoor socket, three-phase / high-power point, EV charger (location), switch,
light point, RJ45, TV, Wi-Fi access point, bus / low-voltage point, alarm keypad, ceiling smart device, motion / presence
sensor, temperature sensor, camera, contact sensor, distribution board — 19 in total.

Default heights (sockets 30 cm, switches 110 cm, boards 140 cm, temperature sensor 150 cm, camera 240 cm …) are **starting
values to change**, not standard recommendations. Three-phase and EV points are places on the plan — the app does not design
high-current circuits.

```ts
interface DeviceDef {
  id: ElType; name: string; short: string;
  category: 'sockets' | 'lighting' | 'control' | 'smart' | 'data' | 'sensors';
  icon: string;
  mountType: 'WALL' | 'CEILING' | 'FLOOR' | 'FREE';
  defaultHeight: number;                 // m above the finished floor
  heightPresets: { label: string; height: number }[];
  allowedSurfaces: ('wall' | 'facade' | 'ceiling' | 'floor' | 'site')[];
  visualRepresentation: 'device' | 'board';
  planSymbol: 'socket' | 'switch' | 'light' | 'data' | 'smart' | 'sensor' | 'board';
  capabilities: ('power' | 'switching' | 'dimming' | 'lighting' | 'network' | 'bus' | 'sensing' | 'security' | 'video' | 'charging' | 'distribution')[];
  footprint: number;                     // width on the wall — collisions and edge distance
}
```

Supported mounts: `WALL` (room walls and facades) and `CEILING` (a point in a room or on the plot). `FLOOR` and `FREE` are
reserved in the type, with no devices yet. Names are translated getters (`devices.<id>`).

**Adding a wall device** (thermostat, blind controller, touch panel):

1. a point type in `EL_TYPE_DEFS` (`src/home/model/electrical.ts`): ID prefix, layer, PDF group, default height, modules;
2. a row in `ROWS` (`src/home/model/devices.ts`): category, icon, quick heights, capabilities, plan symbol;
3. dictionary entries (`electrical.type.*`, `devices.*`) in English and Polish;
4. optionally a 3D shape in `src/home/three/electricalGeometry.ts` (`shapeOf`) and a plan symbol variant in
   `src/home/plan/elPlan.ts` (`symbolPrims`).

The placement engine, dragging, card, validation, saving, PDF and the interaction tests work unchanged — they read the
definition.

## 4. Storage: global plan and per-variant layout

- **Global by default:** `ConfiguratorDoc.electrical` — one plan for the whole document; switching the interior variant does
  not change it. The field is optional: without it the planner shows the points from the package (`project().electrical`,
  compiled from the `electrical` list of `plan.json` — e.g. distribution boards found on a drawing).
- **Own layout of a variant:** the "Plan scope" switch copies the plan into `Variant.electrical`; from then on that variant
  has its own copy and the global plan stays untouched. Returning to the global plan removes the copy (with Undo). "Restore
  project settings" keeps a variant's own electrical layout.
- Validation (`planErrors`) on loading the document and on variant import: type, room, wall, ranges; at most 2000 points.
- Adding, moving, editing and deleting a point are ordinary entries of the document history.

## 5. Interaction model

**PICK A DEVICE → PLACE IT ON A WALL → DRAG IT WHERE YOU WANT → DONE.**

The user never sees wall or room ids, coordinates, normals or internal type names. Everywhere in Home mode there are catalog
names ("Double socket"), the room name, the distance from the nearer wall corner and the height above the floor. Technical data
is available only in Expert mode (card → More → technical data, with LCS coordinates and the JSON record).

### 5.1 Screen

On entering **Electrical**, the home UI gives way to the electrical workspace (`ElWorkspace`): the sun panel, the view bar
and scene hints disappear, and on a phone also the regular drawer — the scene fills the space between the top bar and the
navigation. Device symbols are drawn in 3D in every section (they are part of the home, subject to the layer switches);
selecting, moving and adding work only in this section.

| Element | Content |
|---|---|
| toolbar | **+ Add** · Layers · snapping (off / 1 cm / 5 cm / 10 cm) · Undo · Redo · Export. Desktop: above the scene; phone: bottom bar, every button ≥ 48 px |
| top of the scene | level (and **Site** in a project with a site) **or**, with a focused room, "‹ Room · Whole home"; view: **Plan · 3D · Eye level** |
| device card | after selection: desktop — right panel; phone — a low bottom card **instead of** the toolbar (the scene ends above it, so the device stays visible) |
| left panel (desktop) | "Add device", level thumbnail (click a room = focus it), named device list, items "to check" |

Start view: **Plan** on first use (easiest for many points), then the last used one (Plan / 3D; eye level is not resumed).
`?elview=2d|3d` forces the view (tests).

### 5.2 + Add — catalog

Desktop: a popover under the toolbar; phone: a bottom sheet. Categories **Sockets · Lighting · Control · Smart home ·
Network / data · Sensors**, tiles with icon and name (≥ 56 px). A tile goes **straight** to placing — no form. At the bottom:
the **Add multiple** switch.

### 5.3 Placing

The placing bar replaces the toolbar: device icon and name, hint ("click a wall" / "tap a wall or drag with your finger"),
the series switch, `Cancel` or `✓ Done`.

| Pointer | Behaviour |
|---|---|
| mouse | a translucent preview follows the cursor over the walls; click places |
| finger (plan, 3D) | tap places; dragging leads the preview — **lifted 56 px above the finger** (growing over the first 40 px of motion, so it does not jump), with a cross at the mounting spot; release places. Camera / plan stay still |
| finger (eye level) | tapping a wall places; dragging looks around |

After placing, the device is **selected** (card) and can be dragged at once. In an "Add multiple" series nothing is
selected; each tap adds another device; `✓ Done` ends the series. Height of a new device: the last one used for that type, else
the catalog default. Adding at the spot of an existing point (≤ 6 cm along the wall and vertically; ceiling / free point
≤ 10 cm) selects the existing point instead of creating a duplicate (`pointAt`) — two coincident devices would z-fight.

Badge at the pointer (placing and dragging) — never X / Y / Z:

```
Double socket
Living room
↔ 1.24 m from the left corner
↕ 0.30 m
```

plus "aligned to 30 cm" and at most one warning.

### 5.4 Dragging

Pressing a device and moving = dragging (no prior selection needed). In one continuous motion the device goes **along the
wall → around the corner → onto the next wall → into another room**; the active wall is highlighted and the original spot is
greyed until release. Release = one change and **one** Undo entry. The height does not change. On a phone dragging takes
precedence over panning the plan and turning the camera; a second finger (pinch) cancels the drag without a change.

- **Fixed grab on the plan.** The pointer holds the symbol where it grabbed it — mouse and finger alike. An existing device is
  **not** lifted above the finger (the 56 px lift is only for new devices and copies): motion along the wall maps 1 : 1. The
  symbol is drawn inside the room, so the spot is computed from the point pushed onto the **current wall** by the symbol offset
  (`surfaceFromDrag`): a device at a corner does not jump to the neighbouring wall after a few pixels; it moves to another wall
  of the room when the symbol is clearly at it; it moves into the neighbouring room only when **the pointer itself** crosses the
  wall.
- **Release outside a valid surface** (far from the house, in a door opening): the device stays where it was, with a short
  "Drag onto a wall." — no error, no history entry.
- **Move** (card): "point at a new spot" mode — tapping any wall moves the device (handy when zoomed in). **Duplicate**: a
  preview of the copy that goes onto any wall; the copy takes type, height, label and settings.
- **A ceiling device** (light, sensor, Wi-Fi point) dropped inside a wall stays in place ("Point at a spot in the room."); an
  outside point is created only beyond the building outline; on the Site plan only outside the building.
- **A ceiling device grabbed in 3D** follows the pointer at its own height — on a horizontal plane through the grab point, like
  free-standing furniture. A NEW ceiling device is still placed by pointing at the room (a point above the pointed floor). Over a
  neighbouring room the device moves under its ceiling; over a wall the preview is red.
- **Furniture is background** in Electrical mode: it does not react to the pointer in any view; a drag started on furniture
  turns the camera (3D) or looks around (eye level).

### 5.5 Device card

Compact: icon, name, "Living room · 1.24 m from the left corner"; **Height [−] 30 cm [+]** (step 5 cm, 1 cm when snapping is
below 5 cm; tapping the value lets you type it); quick heights from the catalog (suggestions, not requirements); **Move ·
Duplicate · Delete**; warnings in one line.

- Height limits are the same as for dragging and the ↕ handle: 5 cm above the floor … 5 cm below the ceiling or slope at the
  device (`heightRange`). An empty field or non-numeric text does not change the height; `Esc` discards the typed value.
- The "room · distance" line is never truncated — in a narrow card the distance wraps; a floor point shows "· floor".
- The card belongs to a device that exists and is visible: hiding its layer deselects it (Delete never removes an invisible
  device); selecting a point that no longer exists leaves no empty panel and creates no history entry.

**More** (second tap or the button): type, number of modules, label, purpose, smart home mode, circuit, notes, status, for a
board — kind and width, and "On the printout: G5" (the id in the PDF table).

In 3D a selected wall device has a **↕** handle above it — dragging changes the height (with alignment to the heights of
neighbouring devices).

### 5.6 Plan, 3D and eye level

- **Plan** (`src/home/ui/ElectricalPlan.tsx`) is the same vector drawing as in the PDF: walls, windows, doors with arcs,
  stairs, furniture as a light background (switchable in Layers), device symbols, room names. One finger on the background pans,
  two fingers / the wheel zoom. Labels: **symbols only** by default; Layers offer "Symbols + ID" and "Full labels"; when zoomed
  out, labels are reduced automatically. All outside points are shown on the ground-level plan; the "within 2.5 m of the
  building, the rest on the Site page" rule applies only to the printout.
- **Focus on a room:** tapping a room (with nothing selected) frames it; "Whole home" returns to the level. An empty room shows
  "No points in this room" + **Add the first socket**. On a phone the frame shifts only as much as needed to keep a selected
  device clear of the card, and returns when the card closes.
- **3D:** level section or a focused room; all devices of the level are visible and draggable (also into the neighbouring
  room). The preview of a device being moved is drawn without depth test — visible through walls and furniture; the active wall
  is softly highlighted. Room labels do not capture the pointer.
- **Eye level:** a walk through the building (starting in the current room, facing a full wall) with the same catalog and the
  same placing. The initial pitch depends on the distance to the wall (`eyeLevelPitch`), so the 30 cm socket line and the new
  device preview are in frame at once; field of view 70°. A slab hides walls of other levels.

Changing the level while placing removes a preview pointed on the previous level (the session continues).

### 5.7 Warnings (non-blocking)

| Situation | Reaction |
|---|---|
| off a wall / outside the house | red preview, "Drag onto a wall."; the device is not created / returns |
| ceiling device in a wall / outside the room | red preview, "Point at a spot in the room." (Site plan: outside the building); as above |
| door opening | red preview, "In a door opening — move it onto the wall."; as above |
| window | yellow, "On a window — check that there is a wall here."; can be placed |
| < 5 cm from a wall or opening edge | yellow, "Very close to the wall edge." |
| overlaps another device | yellow, "Overlaps the … next to it." |
| door leaf swing zone (open leaf < 12 cm from the point, below 2.05 m) | yellow, "Possible clash with a door leaf." |
| behind tall built-in furniture / wardrobe (≥ 1.8 m) | yellow, "Behind built-in furniture (…)." |
| next to sanitary fixtures | yellow, "Next to sanitary fixtures." |

**Kitchen:** "Propose sockets for kitchen appliances" (`proposeKitchenPoints`) adds one socket next to each fridge, oven, cooktop and
dishwasher of the current arrangement (status `proposed`, position and height to be confirmed; an appliance away from a wall
gets a floor point). The hood and small appliances are added by hand with the "purpose" field. No power ratings or protection.

**Outside** (project with a site): outdoor sockets on the facade, an EV charger, free points on the plot (gate power and
control, garden lighting) — the purpose field has ready suggestions.

### 5.8 First entry, back and keys

On first entry one card shows three tips ("+ Add…", "Drag…", "Tap a device…") with a "Got it" button. The phone's back button
closes in turn: placing → panel → selection → eye-level view → focused room → leaves the mode to the Building section
(`src/home/backNav.ts`). Keys: Esc — cancel placing / panel, then deselect, at eye level — back to the 3D view of the mode,
with a focused room — whole home; Delete — remove the selected device; Ctrl + D — duplicate; Alt during a move — no snapping.
The room view keys 1 / 2 / 3 of other sections are inactive here; the Plan | 3D | Eye level switch selects the view.

### 5.9 Taps per task (phone)

| Task | Taps |
|---|---|
| add a socket on this wall | 3 (+ Add → tile → wall) |
| add 5 sockets | 8 (+ Add → Add multiple → tile → 5 × wall → Done) |
| move along a wall / to another wall / to another room | 1 drag |
| set height to 110 cm | 2 (device → "110 cm") |
| duplicate onto another wall | 3 (device → Duplicate → wall) |
| delete | 2 (device → Delete) |
| undo · plan ↔ 3D · focus room / whole home | 1 |
| PDF plan | 2 (Export → Download PDF plan) |

## 6. 3D look

Devices are 3D fittings, not flat tiles (`src/home/three/electricalGeometry.ts`): a socket with an 8 × 8 cm frame, round recess,
holes and earth pin; multiple frames at 71 mm pitch; a switch with a rocker; RJ45, TV, keypad, sensors, camera, ceiling points,
garden post. One instanced mesh per shape, vertex colours, no textures — a dozen draw calls regardless of the number of
devices. The look is **illustrative** and does not depict a specific product range.

A distribution board is a recess in the wall with a frame, rails and rows of devices — breakers, smart home modules, patch
panel, terminal strips, a wire bundle (`boardGeometry`). The box height follows its width (0.8…1.4 m). **The content is
illustrative** (pseudo-random but repeatable) — not a schematic and not a selection of equipment.

## 7. Export: PDF, JSON, CSV

**Electrical → Export** or the PDF button on the plan:

- format **A4** or **A3**, always landscape;
- layer groups — each selected one gives its own plan pages: **Power**, **Lighting**, **Data / LAN**, **Smart home /
  sensors**, **All** (distribution boards appear on every page as a reference);
- "Furniture as a light background" (off by default);
- the PDF file is named by the dictionary (`electrical-plan-<date>.pdf` in English); JSON: `electrical-points.json`; CSV:
  `electrical-points.csv`.

Files are produced in the browser (also on a phone, offline) — nothing is sent to a server.

### 7.1 PDF content

| Page | Content |
|---|---|
| plan of each level | walls, openings, doors with arcs, stairs, room names; point symbols with ids; site context as a light background |
| **Site** plan | only when there are points farther than 2.5 m from the building: plot boundary, building, outside points |
| **Point table** | ID, Room, Type, Wall, Distance, Height, Quantity, Description, Smart home, Circuit, Notes — wrapped and split across pages |

For "All" every level plan is printed; for a single group only the levels where that group has points. Every page: a header
(title, scale, project, plan scope, date), a **legend of the symbols used**, "How to find a point on site", a scale bar, the page
number and the disclaimer:

> CONCEPT / COORDINATION PLAN. Point locations must be verified on site. The selection of cables, protective devices,
> circuits, cross-sections and shock protection, and compliance with applicable regulations, are the responsibility of a
> suitably qualified person.

Layout rules: a table row taller than a page (a very long note) is split into parts — the following parts read "G1 (cont.)" in
the ID column, nothing is cut or overlaps the footer (`splitTallRow`); long legend names wrap; "How to find a point" is drawn
only when it fits under the legend (the legend has priority), and with even more entries the spacing shrinks (`legendLayout`).

### 7.2 Finding a point from the PDF

1. **ID** next to the symbol on the plan → row in the table.
2. **Room** and **wall number** — the number at the black triangle in the room corner; the Wall column also gives the side on
   the plan (top / bottom / left / right).
3. **Distance** — along the wall from the corner with the triangle: the left corner when facing the wall from inside the room.
4. **Height** — of the point axis above the finished floor.

With few points on a plan (≤ 28) the symbol also carries `distance · h height` in cm; when denser only the ID remains and the
dimensions are in the table. Ceiling points read "ceiling — see plan", floor points "floor — see plan" with the height above
the floor, points on the plot give x / y in project coordinates.

### 7.3 Scale, vectors, fonts

- The scale is chosen from the series 1:20 … 1:1000 (`SCALES`) so that the plan fits the drawing area; scale and scale bar are on
  the page (the bar protects against "fit to page" printing).
- The drawing is **vectors** (lines, polygons, circles) and text — no raster images; symbols and labels have a fixed paper size
  (symbol 4.2 mm, ID 2.2 mm).
- DejaVu Sans (subset, licence in `src/home/pdf/fonts/`) is embedded. jsPDF silently drops characters without a glyph, so every
  drawn text goes through `pdfSafe()` (`src/home/pdf/pdfText.ts`): a character of the font stays, a known one gets a readable
  spelling (Ω → Ohm, ≈ → ~, € → EUR, ✓ → OK, Greek letters → names, subscripts → digits …), any other becomes "?". The character
  set is read from the `cmap` table of the embedded TTF files (`fontCodePoints`), and **the export reports how many characters
  were replaced and which**. JSON and CSV keep the text unchanged.
- The same drawing is used on screen and in the PDF: `src/home/plan/elPlan.ts` builds primitives, `ElectricalPlan.tsx` draws
  SVG, `electricalPdf.ts` draws them with jsPDF (loaded only on export).

Symbols are a readable legend modelled on installation symbols: shape = layer (half circle — sockets, square — data, diamond —
smart home, circle — sensors, circle with a cross — light, half-filled rectangle — board), letter code = type. **They are not
declared compliant with any standard.**

### 7.4 JSON and CSV

- `electrical-points.json` — schema `home-simulator/electrical-points` v1: all point fields + computed distances from the left
  and right corner, room name, wall description and the LCS position (x, y, z in metres), with the disclaimer.
- `electrical-points.csv` — semicolon-separated, UTF-8 with BOM, 18 columns (id, room, level, type, wall, from left, from right,
  height, quantity, description, smart home, circuit, notes, status, source, x, y, z). Coordinates use the decimal separator of
  the UI language; text starting with `=`, `+`, `-` or `@` gets a leading apostrophe so a spreadsheet does not run it as a
  formula.

## 8. Scale and performance

- data: up to 2000 points; table, CSV and PDF are generated from the same list;
- 3D: one instanced mesh per shape, boards separately;
- plan: SVG symbols; the drawing is rebuilt only when the plan, level, layers or zoom threshold change;
- pointer motion touches neither the document nor the other devices (transient state).

With several hundred devices the next limit is readability, not performance — hence layers, label density and room focus.

## 9. Room for smart home links

`ElPoint.smart?: SmartLinks` — optional, stored and validated (`smartLinksErrors`), no UI yet:

| Field | Meaning |
|---|---|
| `controlledBy: string[]` | ids of points that control this device (switch → light) |
| `controls: string[]` | what this device controls |
| `sensorType: string` | sensor kind |
| `automationGroup: string` | automation group / zone |
| `network: string` | network (VLAN, SSID, segment) |
| `bus: string` | bus line |

Placement reads none of these fields. A smart home extension means more fields or a section in the "More" card, and possibly a
layer of link lines on the plan next to `PlaceOverlay` — no changes to the engine. Point ids are permanent, so links by id
survive moving devices between walls and rooms.

## 10. Not included

Automation scenes and rules, integrations (KNX, Home Assistant, Matter), cable / protection / load sizing, circuit balance,
board design, cable routes, boxes and chases, floor and free-standing devices in the catalog, bulk operations on many devices.

## 11. Limitations

- Room walls are inner faces from the package; the plan knows no cable routes.
- Facade points lie on the building outline; their height is measured from the ground level at the building.
- Points under a sloped ceiling: the height is measured on the vertical wall plane (no projection onto the roof plane).
- No point → board / circuit assignment beyond the free-text "Circuit" field.
- In 3D a dragged device keeps its height — it follows the pointer horizontally, not necessarily vertically (the height is
  changed with the ↕ handle or the card). The card's height clamp is silent.
- At a corner a dragged device stays on its wall until the symbol is clearly at the next one (symbol offset + 10 cm) —
  deliberately: otherwise a device near a corner jumped at grab time.
- On a phone, at whole-level zoom the 48 px device hit areas cover about 1.2 m of plan — tap the middle of a room or zoom in to
  focus it.
- PDF labels are spread with a simple heuristic and may touch in very dense layouts (A3 or per-group export helps); the Site
  scale can be small — exact outside positions are in the table.

## 12. Tests

`src/home/tests/electrical.test.ts` (types, walls and runs, measuring, snapping, validation, warnings, table / CSV / JSON, PDF
pages, scale and bytes), `src/home/tests/elPlacement.test.ts` (engine, transient state, catalog, saving),
`src/home/tests/electrical14b.test.ts` (grab while dragging, ceiling device in a wall, height limits and field, outside points on
the plan, selection of a missing point, layers, preview after a level change, eye-level start, identifiers, PDF characters,
table and legend layout, CSV).
