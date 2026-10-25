# CAD layers: which is which

Offices name layers differently; look at `layer_*.png` from `dxf_inspect.py` and confirm with the user.

| Content | Typical names (any language, case-insensitive) |
|---|---|
| Load-bearing / exterior walls | `A-WALL`, `A-WALL-EXT`, `WALL`, `WALLS`, `MUR`, `MURS`, `Ściany`, `SCIANY`, `WAND`, `Wände`, `PARED`, `*-K Ściany*`, `*Walls*` | <!-- i18n-ok: layer names in several languages -->
| Partitions | `A-WALL-PRTN`, `PARTITION`, `Ściany działowe`, `Trennwand`, `TABIQUE` | <!-- i18n-ok: layer names in several languages -->
| Doors | `A-DOOR`, `DOOR`, `DRZWI`, `TÜREN`, `PUERTAS`, `*Drzwi*` |
| Windows | `A-GLAZ`, `WINDOW`, `OKNA`, `FENSTER`, `VENTANAS`, `*Okna*` |
| Room names / areas | `A-AREA-IDEN`, `ROOM`, `TEXT`, `OPIS`, `Pomieszczenia`, `RAUM` |
| Dimensions | `A-ANNO-DIMS`, `DIM`, `WYMIARY`, `BEMASSUNG` (use to confirm units) |
| Furniture / equipment | `A-FURN`, `FURNITURE`, `Wyposażenie`, `MÖBEL` (optional) | <!-- i18n-ok: layer names in several languages -->
| Ignore | axes / grids (`Osie`, `A-GRID`), hatches, title block, viewports, reinforcement, structural details |

Units: `dxf_inspect.py` guesses from the size of wall-like layers (a building is 5–40 m). The DXF header (`$INSUNITS`) is often
wrong. Confirm with one dimension text or a known room width before writing `plan.json`.
Several drawings on one sheet (plans of each level side by side): use `--box` per level in both tools.
