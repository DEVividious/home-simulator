# The house-forge plugin

`house-forge` is a Claude Code plugin for people who do not use this repository: "here are the plans of my house, I have a
Creality K1C — make me a model to print". It reads the plans into a `plan.json` with the import tools, compiles and previews
it, picks the scale and builds the STL parts after the user approves a dry run. Its source and tests live here; the owner
publishes the assembled directory as `DEVividious/house-forge`.

## Layout

| Path | What |
|---|---|
| `packages/house-forge/src/` | the CLI (`cli.ts`: commands; `print.ts`: scales, dry run card, versioned builds; `workspace.ts`: `house-forge-output/<name>/`; `python.ts`: the Python tools through uv) |
| `packages/house-forge/python/tools.py` + `tools.py.lock` | PEP 723 entry of the Python tools (`uv run --locked`): pillow, numpy, shapely, ezdxf, pymupdf |
| `packages/house-forge/skill/` | `SKILL.md` and the templates of `references/printers.md`, `print-profiles.md` |
| `packages/house-forge/plugin/` | the plugin's README and the published repository's README |
| `packages/house-forge/tests/` | the plugin tests (vitest project `plugin`) |
| `scripts/plugin/build.mjs`, `references.mjs` | `npm run plugin:build`: the bundle and the generated references |

The CLI imports the core as `@home-sim/core/...` like every other tool, and the Python tools are the repository's `tools/` —
nothing is copied by hand. From source: `node packages/house-forge/src/cli.ts --help` (Python tools through uv, or
`HOUSE_FORGE_PYTHON=.venv/bin/python` to use the repository's virtual environment).

## Build

```bash
npm run plugin:build                         # → dist/house-forge
npm run plugin:build -- --out ../house-forge # into a checkout of DEVividious/house-forge (only the plugin's paths are replaced)
```

The output:

```text
.claude-plugin/marketplace.json   README.md  LICENSE  CHANGELOG.md  .gitignore
plugins/house-forge/.claude-plugin/plugin.json, icon.png   README.md  LICENSE
plugins/house-forge/skills/house-forge/SKILL.md
  references/  printers.md, print-profiles.md (from the core's tables), reading-plans.md (skills/home-from-plan/SKILL.md § 2),
               authoring-conventions.md, plan-schema.md, symbol-legend.md, roofs.md, cad-layer-heuristics.md (rewritten for the
               plugin's commands), plan.schema.json, examples/*.plan.json
  scripts/     house-forge.mjs (esbuild bundle of the CLI and the core), manifold.wasm, tools.py, tools.py.lock, intake.py,
               hstools/ image/ pdf/ cad/, VERSION.json (version, engine commit, lock hash), THIRD-PARTY-NOTICES.md
```

A reference line that still names a repository path after the rewrite fails the build: add a rule to
`scripts/plugin/references.mjs`. Two builds of one commit are byte-identical.

## Commands

`doctor`, `paths`, `intake`, `image prepare|calibrate`, `pdf text|svg|arcs|render`, `cad inspect|walls|dwg2dxf`, `compile`,
`preview`, `printers`, `print` — `house-forge <command> --help` for each. Results go to the user's
`./house-forge-output/<name>/`: `source/plan.json` (and the tool output), `project.json`, `previews/` (plans, roof, 3D, print
previews), `builds/1to<N>-v<K>/` (STL parts, `print-report.json`, `build.json`). A build with the settings and plan of an
earlier one reuses it; anything else is the next version. `print --from <build>` changes settings of an earlier build.

`print` gives the same STL bytes as `npm run project:print` for the same plan and settings (the core's `printModel`; the
report's `meta` names the plugin version too). Previews are drawn by the core's rasteriser (`packages/core/src/preview/`), with
the labels of `src/i18n/<lang>/print.json` and `preview.json` (`--lang`).

## Tests

`npx vitest run --project plugin` builds the plugin twice into temporary directories and checks: identical trees; manifests,
kernel and tools present; every `node "$HF" <command>` of `SKILL.md` exists in the bundle's help and every `references/…` it
or a reference names exists; STL from the bundle equal to `printModel` in the test process; previews without a browser;
`tools.py intake` (uv) equal to the repository's `tools/intake.py`; build versions. The PDF backends of the Python tools
(pymupdf for the plugin, poppler as a fallback here) are compared in `tools/tests` on a generated sheet.

## Release

1. Bump `version` in `packages/house-forge/package.json` (semver) and add the entry to `packages/house-forge/CHANGELOG.md`;
   commit.
2. `npm run plugin:build -- --out ../house-forge` from that commit (the output says so if the tree has changes).
3. In `../house-forge`: try it (`claude --plugin-dir plugins/house-forge` in an empty directory with a plan image), then commit
   "house-forge X.Y.Z (engine <sha>)" and publish. `tools.py.lock` changes only through `uv lock --script tools.py` in
   `packages/house-forge/python/`.
