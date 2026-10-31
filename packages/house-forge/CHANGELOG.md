# Changelog

## 0.1.1

- Every reply in the user's language, also the first sentence after a long run of tools.
- `plan.json` takes names in a second language (`names`, viewpoint `hints`) for the Home Simulator app; the compiler warns when a
  language is only partly translated. The print does not need them.

## 0.1.0

- First version: plan images, vector PDF sheets (pymupdf) and DXF / DWG drawings read into `plan.json` with the Home Simulator
  tools; compile with "what the plan says"; previews of every level, the roof and the building without a browser; printer
  table; scale table; dry run with an approval card; versioned builds of STL parts (one per storey and a removable roof)
  byte-identical to the engine's print export; `--from` for changes.
