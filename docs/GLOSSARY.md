# Glossary

The shared language of code, documents and conversations. English names are the identifiers in code.

## Project
- **Project** — one building with what belongs to it: levels, rooms, openings, optionally a plot and surroundings. Immutable id `projectId`. *Avoid*: "house" (one kind of project), "model".
- **Project package** (`ProjectPackage`) — the facts of a project in the form the engine loads: `projects/<id>/project.json` plus optional model files. *Avoid*: "configuration", "house data".
- **Plan** (`plan.json`) — the authoring source of a package, compiled by `npm run project:build`.
- **Manifest** (`ProjectManifest`) — id, name, units, coordinate system, building type, levels, modules, capabilities, start view.
- **Module** (`ProjectModule`) — an optional part of the engine a package enables with its data: `site`, `environment`, `sun`, `stairs`. *Avoid*: plugin.
- **Capability** (`ProjectCapability`) — a core feature a package uses: `interiors`, `electrical`, `variants`, `walk`.
- **Project index** (`projects/index.json`) — the installed packages; generated from the `projects/` directory.
- **Project document** (`ConfiguratorDoc`) — everything the user designed in one project: variants, bookmarks, imported models, the electrical plan. Belongs to exactly one project. *Avoid*: "state", "config file".
- **Variant** — one complete version of the user's design, comparable with another.
- **Project assets** (`ProjectAssets`) — files of the package the engine loads (building, terrain and surroundings models). The engine knows no path outside them.

## Building
- **Level** — a storey with its own floor; one or more, ordered by floor height. *Avoid*: ground floor / attic as code concepts.
- **Room** — a space of one level bounded by walls; a display name and explicit **kind** and **tags**.
- **Tag** — an explicit property that drives engine behaviour (room `kitchen`, `garage`). A display name is never a tag.
- **Wall** — one straight edge of a room outline, seen from inside the room (`<room>-w<n>`). A partition has a separate wall in each of its two rooms.
- **Wall run** — the longest run of collinear walls of one room — the real wall from corner to corner.
- **Opening** — a gap in a wall: door, passage, window; in wall coordinates a **wall hole**.
- **Door** — an opening with a moving leaf joining two rooms or a room and the exterior; behaviour from data (hinge, direction, angle, type).
- **Shell** — walls, slabs and roof in the scene: from the package's **model file** or **generated** from room outlines.
- **Roof part** (wing) — the roof over a rectangle of a level's walls: gable, hip, shed or flat, bounded by its **planes** (the
  underside of the structure; the covering lies above). A complex roof is the union of parts; a **dormer** is a small wing
  standing on one plane of a part. *Avoid*: "attic" as a code concept — a room under the roof has a ceiling of kind `roof`.
- **Knee wall** — the height above the floor where the underside of the roof meets the outer face of the eaves walls (`knee`).
- **Eaves / verge** — the roof's overhang beyond the walls at the low edges / at a gable end.
- **Site** and **environment** — the plot and what is around it. Both optional.

## Furnishing
- **Catalog item** — a reusable furniture definition: dimensions, geometry, materials, placement.
- **Furniture** (`FurniturePlacement`) — an instance of a catalog item in a room.
- **Arrangement** — furniture and finishes of one room; a room may have several, one is active.
- **Project default arrangement** — the furnishing a project starts with, before the user changes anything. A fact of the package.
- **Finish** (`FinishRef`) — a catalog material assigned to a wall, floor or ceiling.

## Mounting on walls
- **Mount surface** — a wall run (or facade) where something can be mounted: `u` along it, `v` height above the finished floor.
- **Mount space** — a room (or the building's exterior) seen as the set of its mount surfaces.
- **Wall object** — anything whose position is stored relative to a mount surface: wall-hung furniture (`mount: 'wall'`) or an electrical device. *Avoid*: "furniture against a wall" (that stands on the floor).
- **Mount record** (`WallMount`) — `{ wallId, u, height }`; the world position is derived from it.
- **Grab offset** — difference between the grabbed point and the object's reference point, constant during a drag.
- **Transfer** — a deliberate change of mount surface during a drag (wall → corner → another wall → another room).

## Installations
- **Device definition** (`DeviceDef`) — a kind of device: category, mounting, default height, plan symbol, capabilities.
- **Device** (`ElPoint`) — an instance placed in the project. *Avoid*: "point" except in tables and PDFs.

## View
- **Building view** (`ViewPreset`) — a named exterior shot from the package (or an engine default), by direction or explicit camera pose. The level section ("Interior") always exists.
- **Viewpoint** — an eye-level camera start provided by the package.
- **Bookmark** (`CameraBookmark`) — a camera view saved by the user in the document.
