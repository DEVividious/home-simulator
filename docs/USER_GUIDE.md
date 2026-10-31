# User guide

How to use the app, task by task. Names in **bold** are labels from the English UI. Some controls appear only when the open
project uses them (for example the time of day, stairs or a plot to walk on).

## Opening a project

- On the computer run `npm run dev` and open `http://localhost:5173/`. On a phone, see [Installing on a phone](#installing-on-a-phone).
- The app opens the project of this tab, else the last one you chose on this device, else the default one.
- To open a given project, add `?project=<id>` to the address, e.g. `http://localhost:5173/?project=sample-house`.
- With more than one project installed, the house name at the top left is a list (▾): choose another house. The current one
  is saved first and the page reloads.
- Each project has its own versions, rooms and installation points. They never mix between projects.
- One browser tab shows one project. Use a second tab for a second project.
- On the first start a welcome screen shows the three steps. **Help** in the top bar shows it again.

## The screen

- Top bar: the house name, the three steps **Look**, **Arrange** and **Versions**, undo ↶ and redo ↷, the save status,
  **Download**, **Help** and **Settings**. In advanced mode two more steps appear: **Electrical** and **Expert**.
- Side panel: what the chosen step offers. When something is selected, its card (its properties) opens on the right.
- Scene bar (under the scene): the only camera control — **Around**, **From above**, **Walk**, the floors, **Doors** on / off,
  and inside a room the way back ("← Ground floor · Kitchen").
- Object bar (above the scene bar, when a piece of furniture is selected): **Turn left**, **Turn right**, **Copy**,
  **Delete**, **Done**; for an object on a wall **Left**, **Right**, **Up**, **Down** (1 cm each) instead of turning.
- A one-sentence hint above the scene says what you can do right now; × hides it.
- On a phone the steps are at the bottom of the screen and the panel is a drawer with three heights. Tapping the step you are
  in folds the drawer away or opens it. The system "back" closes the dialog, the drawer, the selection, the walk and the room,
  in that order.

## Look

- Mouse: left button orbits, right button or Shift + left pans, the wheel zooms, double-click sets the orbit centre.
- Touch: one finger orbits, two fingers zoom and pan, a tap selects.
- Scene bar: **Around** shows the house from outside, **From above** looks down on it, **Walk** starts a walk at eye level.
  A floor (**Ground floor**, **First floor** …) shows a section through that level — the house as a doll's house.
- **Places** in Look: the other views of the project (for example **Other side**), the walk places of the project (**Front
  door**, **Garden** …) and your own views. **Save view** keeps the current camera as "My view 1", "My view 2" …; × deletes one.
- **Time of day** (only when the project knows its location): **Morning**, **Noon**, **Afternoon**, **Sunset** and a day bar to
  drag the sun. In advanced mode also the date, the 24-hour dial, the sun's position and the north arrow.
- **Doors** in the scene bar hides or shows the door leaves. Click a door to open its card: **Open** / **Close** and the
  opening angle (or how far it slides).
- **Surroundings** (Settings, only with a surroundings model) shows trees, neighbouring buildings and the road.

## Arrange

- **Arrange** shows the rooms as big buttons (grouped by floor) and a small plan; the scene shows the floor in section. Click
  a room button, a room on the plan or the room's floor in the scene to go in. **Stairs** (when the house has them) opens the
  stairs' card: treads, risers, handrail, balustrade and ready-made sets.
- In a room: **Furniture** | **Colours**. The scene bar shows "← floor · room" — click it (or press Esc) to leave the room.
- Walls between the camera and the room are cut away. **From above** shows the room from the top; keys `1`, `2`, `3` switch
  Around / From above / Walk.

### Furniture

- Search, or pick one of the category chips (the ones that fit the room come first; **All** shows everything).
- Add: click or tap a card — the item goes to a free spot in the room. With a mouse you can also drag a card into the room.
- Move: drag the item over the floor. Arrow keys move it 1 cm, Shift + arrow 10 cm.
- Turn: the object bar turns it by 90°; Q / E turn by 15° (with Shift 45°) and R by 90°; or drag the blue ring.
- **Copy** (Ctrl+D) and **Delete** (the Delete or Backspace key) are in the object bar; **Done** ends the selection.
- The card shows the item's properties: size (**Variant**), **Dimensions**, **Material**, height, angle and warnings
  (collision, door swing, window). Warnings never block you.
- **Start from**: **As planned** (the furniture of the project's plans), **Office** and **Guest room** (proposals for bedrooms
  and offices from 7 m²) or **Empty**. It replaces the room's furniture — one undo step.
- **In this room** lists the furniture; click a name to select it.
- **Add yours…** imports your own model (GLB / glTF): choose the file units and the model front, then **Add to catalogue**.
  Items go to **My models**. Limit: 50 MB, resources embedded in the file.
- Snapping to walls, corners and other furniture is on; hold Alt to turn it off for one move (the grid is in advanced mode).

### Colours

- **Walls**, **Floor** or **Ceiling**. **Walls** means all walls of the room. Click one wall in the scene to colour only that
  one — the button then says **This wall**; click **Walls** again for the whole room.
- Pick a kind (paint, wallpaper, panels, slats, brick, tiles, herringbone, vinyl, laminate, wood, concrete / stone), then a
  colour from the palette or a material. **Original** (the first one) goes back to the project's finish.
- Patterns are at real scale. In advanced mode you also get the tile and board layout, several chosen walls and
  **Whole home**.
- **Settings** → **Neutral interior** (advanced) shows white walls where nothing was chosen. It does not change your design.

## Wall-mounted objects

TVs, mirrors, shelves, wall cabinets and lamps hang on a wall. More in
[WALL_MOUNTED_OBJECT_PLACEMENT.md](WALL_MOUNTED_OBJECT_PLACEMENT.md).

- Drag the object along the wall; grab it anywhere. Keep dragging past a corner or onto another wall to move it there.
- A tip shows the distance from the corner and the height, and when it is aligned to an opening, another object or the wall
  centre. Alt turns snapping off.
- The object bar moves it 1 cm with **Left**, **Right**, **Up** and **Down**; the arrow keys do the same. The card shows
  **From the left corner** (or right) and **Bottom edge above the floor**.

## Walking

- **Walk** in the scene bar. Outside a room the walk starts in front of the entrance; a walk place in **Look › Places** starts
  it there. With a plot you can walk out through an exterior door; with stairs you can walk to another floor.
- Inside a room **Walk** walks in the room. At stairs or an exterior door it turns into a walk through the building; ending it
  returns you to the room.
- Keyboard and mouse: W A S D or the arrow keys walk, Shift runs, drag looks around, the wheel steps forward or back.
  Click a door to open or close it. Closed doors block the way.
- Touch: the round pad in the bottom-left corner walks; drag anywhere else to look around; tap a door to open it.
- **Around** or Esc ends the walk (Esc first clears a selection). The bar at the top shows where you are.
- **Settings** → **Eye height** (advanced): 1.50, 1.60, 1.68 or 1.80 m.

## Versions

A version is a complete copy of your design: furniture, colours, stairs, the view and, with sun, the time of day.

- **Your versions** shows a card with a picture for each version. Click a card to switch to it.
- **New version** copies the current design as "Version 2", "Version 3" … and switches to it.
- ⋯ on a card: **Rename**, **Start over** (the version goes back to the project — one undo step), **Delete**.
- **Compare** (from two versions): with two versions it compares them at once; with more, click the card to compare with.
  Both halves share the camera and the light. In the overlay: **Swap**, **Exit** (or Esc). On a phone one side is shown, with
  an A | B switch.
- Nothing needs saving: switching versions keeps the view and the picture of the version you leave.

## Download

**Download** in the top bar:

- **Picture** — a PNG of the current view with a caption (project, version, time of day, view).
- **Print model** — a model for a 3D printer: `<project>-print-1to<N>.zip` with one STL part per floor and a removable roof,
  `print-report.json` and a preview picture. The app uses a 220 × 220 × 250 mm bed, a 0.4 mm nozzle and the largest standard
  scale at which every part fits. The STL files are the same bytes as `npm run project:print -- projects/<id> --bed 220x220x250`
  ([PRINT_EXPORT.md](PRINT_EXPORT.md) has other printers and options).
- **Project file** (advanced mode) — the whole design with all versions as JSON.

## Undo, redo and shortcuts

| Keys | Action |
|---|---|
| Ctrl+Z | undo |
| Ctrl+Shift+Z or Ctrl+Y | redo |
| Ctrl+S | save now (saving is automatic) |
| Ctrl+D | copy the selected item or device |
| Delete, Backspace | delete the selected item or device |
| Q / E (Shift: 45°), R | turn furniture by 15° / 90° |
| Arrows (Shift: 10 cm) | move the selected item by 1 cm |
| 1 / 2 / 3 | room view Around / From above / Walk |
| Esc | close the topmost thing: settings, welcome, menu, comparison, selection, walk, room |

On a Mac, Cmd works in place of Ctrl. Every change can be undone; the undo button names the change.

## Saving

- Everything is saved automatically: every change is written to this device at once and to the project file on the PC about
  two seconds later. There is no Save button.
- The status in the top bar shows **Saved**, **Saving…** or **On this phone** (waiting for the PC). It becomes a button
  (**Save now**) only when the design is not in the file yet; clicking it tries again.
- Offline, changes wait on the device and reach the PC when the connection returns.
- If the project changed both on the PC and on this device, **Two versions of the project** asks which to keep: **Keep the
  version from this device** or **Load the version from the PC**. The other one goes to the backups; nothing is lost.

## Settings

For everyone: **Language** (English or Polish — the project is saved and the page reloads), **Picture** (**Best**,
**Balanced**, **Save battery**), **Surroundings** (with a surroundings model) and **Advanced mode**.

## Advanced mode

Turn it on in **Settings** → **Advanced mode**, or open the app with `?mode=advanced` (the old `?mode=expert` works too). It
adds:

- the **Electrical** and **Expert** steps;
- room arrangements in Arrange › Furniture (several furniture layouts per room — [VARIANTS_AND_ARRANGEMENTS.md](VARIANTS_AND_ARRANGEMENTS.md));
- in Colours: one wall, several walls, the whole room or **Whole home**, and the tile and board layout;
- in Settings: the device and graphics details, **Neutral interior**, snapping and the snap grid, eye height, **Files** (load a
  project file, export or import a version, restore the project furniture in every room) and **App and data** (offline state,
  backups with **Restore**, storage, **Install app**, updates);
- the date, the dial and the sun's position in the time of day, technical data in the cards, and **Project file** in Download.

### Expert

- **Layers**: **XYZ axes**, **1 m grid**, **Wireframe**, **Colours by data confidence**. Click a building element to see its
  data.
- **Configuration**: the project document, read only.
- **Performance**: frames per second, draw calls, triangles, geometries and textures on the GPU.

### Electrical planner

Pick a device, click a wall, then drag it where you want. The plan is a concept for talking to your electrician, not an
installation design.

- Toolbar: **Add**, **Layers**, **Export**. Undo and redo are in the top bar; snapping (off, 1, 5 or 10 cm) is in **Layers**.
- View: **Plan**, **3D** or **Eye level**. Click a room on the plan to zoom in.
- **Add**: categories **Sockets**, **Lighting**, **Controls**, **Smart Home**, **Network / Data**, **Sensors**. Choosing a
  device starts placing it. **Add multiple** keeps adding the same device on every click; **Done** ends it.
- Drag a device along a wall, round a corner, to another wall or into another room.
- Device card: **Height** with **Higher** / **Lower**, **Move**, **Duplicate**, **Delete**; **More** for type, label,
  **What for**, smart home, **Circuit**, **Notes** and **Status**. Delete key and Ctrl+D work too.
- **Layers** hides groups (Sockets, Lights, Smart Home, Data, Sensors, Boards) and sets **Labels on the plan**.
- **Propose sockets for kitchen appliances** adds proposals next to the appliances in the furniture.
- **Plan scope**: one plan **shared by all variants**, or a copy **own to this variant**.

**Export**: choose **Format (landscape)** A4 or A3, the page groups (230 V, Lighting, Data / LAN, Smart Home / sensors, All)
and **Furniture as a light background**, then **Download PDF plan**. The PDF has plans with symbols and IDs, a point table
(room, wall, distance from the left corner, height) and a legend. **List (JSON)** and **Spreadsheet (CSV)** export the points.
Files are made in the browser and work offline.

## Installing on a phone

The app installs on an Android phone with Chrome over a USB cable and then works offline. Steps and troubleshooting:
[PHONE.md](PHONE.md). In short: run `npm run phone -- serve` on the computer, wait in Chrome on the phone until **Offline
mode** says ready (Settings → Advanced mode → **App and data**), then choose **Install app** from the Chrome menu. New
versions show **A new version of the app is ready.** with **Update** and **Later**.
