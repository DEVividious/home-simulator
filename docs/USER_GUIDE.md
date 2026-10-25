# User guide

How to use the app, task by task. Names in **bold** are labels from the English UI. Some sections and panels appear only
when the open project uses them (for example sun and stairs).

## Opening a project

- On the computer run `npm run dev` and open `http://localhost:5173/`. On a phone, see [Installing on a phone](#installing-on-a-phone).
- The app opens the project of this tab, else the last one you chose on this device, else the default one.
- To open a given project, add `?project=<id>` to the address, e.g. `http://localhost:5173/?project=sample-house`.
- With more than one project installed, **Settings** → **Project** switches between them. The current project is saved first
  and the page reloads.
- Each project has its own variants, arrangements and installation points. They never mix between projects.
- One browser tab shows one project. Use a second tab for a second project.
- On the first start a welcome screen explains the basics. **Settings** → **Show the welcome screen again** brings it back.

## The screen

- Top bar: the project name ("My home" or "My apartment") with the active variant, the sections, undo and redo, the save
  button, a screenshot button and **Settings**.
- Sections: the building section (**House** or **Apartment**), **Interiors**, **Materials**, **Furniture**,
  **Electrical**, **Variants**, and **Expert** in expert mode.
- Side panel: the content of the chosen section. The inspector opens when something is selected.
- Bottom bar: camera views of the building; inside a room, the way back, the room name and the view switch.
- A short hint above the scene says what you can do right now. **Controls** in the corner lists the mouse controls.
- On a phone the sections are in a bottom bar (a rail on the left in landscape) and the panel is a drawer with three heights.
  The system "back" closes the dialog, the drawer, the selection, the walk and the room, in that order.

## Looking around

- Mouse: left button orbits, right button or Shift + left pans, the wheel zooms, double-click sets the orbit centre.
- Touch: one finger orbits, two fingers zoom and pan, a tap selects.
- **Views** (bottom bar and **Explore the …** in the building section): **Overview**, **Other side**, **From above** and
  **Interior** (a section through one level). A project may define its own views instead of the first three.
- With **Interior**, a level switch appears when the building has more than one level.
- **Saved views**: **Save this view** stores the camera under a name; click it to return.
- **Interior doors**: **Show doors** hides or shows door leaves; **Open all** and **Close all** set every door. Click a door to
  open its card: **Open** / **Close**, **Opening angle**, or **Slide** for sliding doors.
- **Surroundings** (only with a surroundings model): **Show surroundings** toggles trees, neighbouring buildings and the road.
- Sun (only when the project knows its location): the sun button opens date and time, a 24-hour dial and the presets
  **Morning**, **Noon**, **Afternoon**, **Sunset**. Arrow keys move 5 minutes, Shift + arrow one hour.

## Entering a room

- Choose **Interiors** and click a room in the model, on the plan or in the list. In the building section, **Levels** →
  **Enter ›** opens a level.
- Room views: **3D**, **Top** (called **Plan** on a phone) and **Walk**. Keys `1`, `2`, `3` switch them.
- Walls between the camera and the room are cut away.
- Leave with the level button at the left of the bottom bar or with Esc.

## Walking

- Through the building: building section → **Walk …** → **Start walk**. With a plot you can walk out through an exterior
  door; with stairs you can walk to another level.
- Inside a room: the **Walk** view or **Walk inside the room**. At stairs or an exterior door it turns into a walk through
  the building; ending it returns you to the room.
- Keyboard and mouse: W A S D or the arrow keys walk, Shift runs, drag looks around, the wheel steps forward or back.
  Click a door to open or close it. Closed doors block the way.
- Touch: the joystick in the bottom-left corner walks; drag anywhere else to look around; tap a door to open it.
  Landscape is easier.
- **End walk** or Esc ends the walk (Esc first clears a selection). The bar at the top shows where you are and the feet level.
- **Settings** → **Eye height in walk mode**: 1.50, 1.60, 1.68 or 1.80 m.

## Furnishing

- Open **Furniture** inside a room. Search ("bed, desk, rug…") or pick a category.
- Add: drag a card into the room, or click it. On a phone, tap the card.
- Move: drag the item over the floor. Arrow keys move it 1 cm, Shift + arrow 10 cm.
- Rotate: drag the blue ring, use the buttons, or press Q / E (15°, with Shift 45°) and R (90°).
- Duplicate: Ctrl+D. Delete: the Delete or Backspace key.
- The inspector also changes the **Variant**, **Dimensions** and **Material** of the item.
- Snapping to walls, corners and other furniture is set in **Settings** (**Furniture snapping**, **Snap grid** 5 / 10 /
  25 cm). Hold Alt to turn it off for one move.
- Warnings (collision, door swing, window) never block you.
- Arrangements: each room can keep several. Use **Save**, **Save as…**, **Copy as…**, **Rename**, **Delete arrangement**;
  click one to load it. **Layout proposals** create a new arrangement. **Project layout as a new arrangement** brings back the
  furnishing from the project. **Compare arrangements A / B** shows two side by side. **Remove all furniture** empties the
  room.
- Your own models: **Import your own model (GLB / glTF)**. Choose the file units and the model front, then
  **Add to catalogue**. Items go to **My models**. Limit: 50 MB, resources embedded in the file.

## Materials

- Open **Materials** inside a room. **Surfaces**: **Floor**, **Walls**, **Ceiling**.
- Click a wall or the floor in the model or on the plan to pick it. Ctrl + click (or Shift + click) selects several walls.
- For walls, choose the scope: **This wall**, **Selected**, **Whole room** or **Whole home**.
- Pick a category (paint, wallpaper, panels, slats, brick, tiles, herringbone, vinyl, laminate, wood, concrete / stone), a
  colour and the layout (tile size, board size, pattern rotation, offset, grout). Patterns are at real scale.
- **Restore the finish from the project** undoes your choice for that surface.
- **Settings** → **Neutral interior finish** shows white walls where nothing was chosen. It does not change your design.
- Stairs (when the building has them): click the stairs or **Stairs — cladding, handrail, balustrade** to set
  **Treads**, **Risers**, **Handrail**, **Balustrade** or pick from **Ready-made sets**. The stair geometry does not change.

## Wall-mounted objects

TVs, mirrors, shelves, wall cabinets and lamps hang on a wall. More in
[WALL_MOUNTED_OBJECT_PLACEMENT.md](WALL_MOUNTED_OBJECT_PLACEMENT.md).

- Drag the object along the wall; grab it anywhere. Keep dragging past a corner or onto another wall to move it there.
- A tip shows the distance from the corner and the height, and when it is aligned to an opening, another object or the wall
  centre. Alt turns snapping off.
- **On the wall** in the inspector shows **From the left corner** (or right) and **Bottom edge above the floor**, with 1 cm and
  5 cm step buttons. Arrow keys move it 1 cm.

## Electrical planner

Pick a device, click a wall, then drag it where you want. The plan is a concept for talking to your electrician, not an
installation design.

- Toolbar: **Add**, **Layers**, snapping (magnet: off, 1, 5 or 10 cm), **Undo**, **Redo**, **Export**.
- View: **Plan**, **3D** or **Eye level**. Click a room on the plan to zoom in; **Whole home** goes back.
- **Add**: categories **Sockets**, **Lighting**, **Controls**, **Smart Home**, **Network / Data**, **Sensors**. Choosing a
  device starts placing it. **Add multiple** keeps adding the same device on every click; **Done** ends it.
- Drag a device along a wall, round a corner, to another wall or into another room.
- Device card: **Height** with **Higher** / **Lower**, **Move**, **Duplicate**, **Delete**; **More** for type, label,
  **What for**, smart home, **Circuit**, **Notes** and **Status**. Delete key and Ctrl+D work too.
- **Layers** hides groups (Sockets, Lights, Smart Home, Data, Sensors, Boards) and sets **Labels on the plan**.
- **Propose sockets for kitchen appliances** adds proposals next to the appliances in the arrangement.
- **Plan scope**: one plan **shared by all variants**, or a copy **own to this variant**.

**Export**: choose **Format (landscape)** A4 or A3, the page groups (230 V, Lighting, Data / LAN, Smart Home / sensors, All)
and **Furniture as a light background**, then **Download PDF plan**. The PDF has plans with symbols and IDs, a point table
(room, wall, distance from the left corner, height) and a legend. **List (JSON)** and **Spreadsheet (CSV)** export the points.
Files are made in the browser and work offline.

## Variants and comparison

A variant is a complete version of your design: interiors, view and, with sun, the time of day.

- **New**, **Save**, **Save as…**, **Duplicate**, **Rename**, **Delete**. Click a card to switch. **Save** also stores the
  current view and a thumbnail.
- **Compare A / B** → choose two variants → **Compare (split screen)**. Both halves share the camera and the light. In the
  overlay: **Swap**, **Screenshot**, **Exit** (or Esc). On a phone one side is shown, with an A | B switch.
- **Export variant (JSON)** saves one variant to a file; **Import variant** loads it back. A broken file is refused with a
  message.
- **Project**: **Save project**, **Download file** and **Load file** handle the whole design with all variants.
- **Restore project settings** resets the active variant to the project data. **Restore project furniture** puts the project
  furniture back in every room and keeps colours and saved arrangements. Both are one undo step.

## Undo, redo and shortcuts

| Keys | Action |
|---|---|
| Ctrl+Z | undo |
| Ctrl+Shift+Z or Ctrl+Y | redo |
| Ctrl+S | save |
| Ctrl+D | duplicate the selected item or device |
| Delete, Backspace | delete the selected item or device |
| Q / E (Shift: 45°), R | rotate furniture by 15° / 90° |
| Arrows (Shift: 10 cm) | move the selected item by 1 cm |
| 1 / 2 / 3 | room view 3D / Top / Walk |
| Esc | close the topmost thing: settings, welcome, comparison, selection, walk, room |

On a Mac, Cmd works in place of Ctrl. Every change can be undone; the undo button names the change.

## Saving

- Every change is written to this device at once. With **Save automatically** on (Settings), it also goes to the project file
  on the PC about two seconds later. Without it, use the save button or Ctrl+S.
- The save button shows **Saved**, **Save** (unsaved changes), **Saving…** or **On device** (waiting for the PC).
- Offline, changes wait on the device and reach the PC when the connection returns.
- If the project changed both on the PC and on this device, **Two versions of the project** asks which to keep: **Keep the
  version from this device** or **Load the version from the PC**. The other one goes to the backups; nothing is lost.
- **Settings** → **App and data** shows the offline state, where the project is stored, **Project backups** with **Restore**,
  storage use and **Protect data**.

## Settings

**Expert mode**, **Surroundings**, **Furniture snapping**, **Snap grid**, **Graphics quality** (**High**, **Balanced**,
**Low**), **Device** (**Automatic**, **Computer**, **Phone / tablet**), **Save battery** (phones), **Neutral interior
finish**, **Save automatically**, **Eye height in walk mode**, **App and data**, **Language**, **Project**.

**Language**: English or Polish. The choice is kept on this device; the project is saved and the page reloads.

## Installing on a phone

The app installs on an Android phone with Chrome over a USB cable and then works offline. Steps and troubleshooting:
[PHONE.md](PHONE.md). In short: run `npm run phone -- serve` on the computer, wait in Chrome on the phone until **Offline
mode** says ready (Settings → **App and data**), then choose **Install app** from the Chrome menu. New versions show
**A new version of the app is ready.** with **Update** and **Later**; **Check for updates** looks for one.

## Expert mode

Turn it on in **Settings** → **Expert mode** or open the app with `?mode=expert`. The **Expert** section has three tabs:

- **Layers**: **XYZ axes**, **1 m grid**, **Wireframe**, **Colours by data confidence**. Click a building element to see its
  data.
- **Configuration**: the project document, read only.
- **Performance**: frames per second, draw calls, triangles, geometries and textures on the GPU.

The inspector also shows **Technical data (Expert)** for the selected item or device.
