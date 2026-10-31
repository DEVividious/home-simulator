# Printers and bed sizes

Dimensions are the build volume X × Y × Z in mm (width × depth × height). `house-forge.mjs` reads the same table
(`--bed "name"` and `printers "<phrase>"`); a model named exactly wins ("k1" is the Creality K1, "k1c" the K1C). If a printer is
not listed, ask the user for the bed size (it is in the manual or in the printer profile of their slicer) or look it up online,
and pass it as `--bed 220x220x250`.

Every part has to fit in the bed reduced by a margin (10 mm on each side by default, `--margin`): the bed is often less level
near the edges, the brim starts there, and clips or sensors take up a strip of it. A part may be turned by 90° to fit; the card
says so.

<!-- PRINTERS: generated from the core's printer table by scripts/plugin/build.mjs -->
