# House Forge

Turn the floor plans of a house or flat into a 3D-printable scale model. Attach the plans — a picture from an estate agent or a
house catalogue, an architect's PDF, or a DXF / DWG drawing — and answer a few questions. The skill reads the plans into a
building with its roof, shows you what it read, finds your printer's bed, picks the largest scale at which every part fits, and
builds STL parts after you approve the preview: one part per storey and a removable roof, checked to be watertight solids.

## Install

```bash
claude plugin marketplace add DEVividious/house-forge
claude plugin install house-forge@house-forge
```

## What it runs

One bundled Node script, `skills/house-forge/scripts/house-forge.mjs` (the geometry core of
[Home Simulator](https://github.com/DEVividious/home-simulator) with the manifold-3d kernel, `manifold.wasm` next to it), and
for plan images, PDF sheets and CAD drawings the Python tools `tools.py`, run with `uv run --locked`: on the first run uv
downloads the library versions pinned in `tools.py.lock` from PyPI (pillow, numpy, shapely, ezdxf, pymupdf); later runs use its
cache. The scripts read the files you point them at and write to `house-forge-output/` in your current directory. They make no
network requests of their own, send no data anywhere and need no API key.

## Requirements

Node.js 20 or later; Python 3.11 or later and [uv](https://docs.astral.sh/uv/) for plan images, PDF and CAD; the free ODA File
Converter only for DWG files. Native Windows is not yet verified end to end.
