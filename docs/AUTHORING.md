# Authoring a building

The human version of the `home-from-plan` skill. You write `projects/<id>/source/plan.json`; the compiler writes
`project.json`.

1. **Start from an example**: copy `source/plan.json` of `projects/demo-apartment/` (flat, metres) or `projects/sample-house/`
   (house, stairs, plot) to `projects/<your-id>/source/plan.json`, set `project.id` (= the directory name) and `project.name`,
   and edit it (format: skills/home-from-plan/references/plan-schema.md; rules:
   skills/home-from-plan/references/authoring-conventions.md). `project.json` is written by the build — never copy or edit it.
   **From a description** (no drawing): the same, in metres, with `defaults.confidence: "unknown"`; say in the project's
   `README.md` that the geometry is approximate.
2. **From an image**: `.venv/bin/python tools/image/prepare.py plan.png --out projects/<id>/source/prep`, read pixel coordinates
   from `grid.png`, calibrate (docs/IMPORT_RASTER.md) and write the plan with `"units": "px"`.
3. **From a PDF or CAD drawing**: docs/IMPORT_PDF.md, docs/IMPORT_CAD.md.
4. **Build and check**:
   ```bash
   npm run project:build -- projects/<id>
   npm run project:validate -- projects/<id>
   npm run project:preview -- projects/<id>     # compare preview/plan-*.png with the drawing
   npm run dev                                   # http://localhost:5173/?project=<id>
   ```
5. **Release**: `npm run project:build -- projects/<id> --lock` once you start using the project — wall ids are then frozen.

Things the format cannot express yet (walls at angles other than 45° without a model, winding or spiral stairs) are listed in
docs/KNOWN_LIMITATIONS.md. A building with such geometry can supply a GLB model (`assets.model` in `plan.json`, copied into the package; docs/PROJECT_PACKAGE_SPEC.md).

**Local projects.** A building you keep for yourself — your own home, a client's house, anything that must not be published —
goes to `projects/local-<name>/` (`project.id` = the directory name). Such a directory is ignored by git, skipped by the
genericity audit, and seen only by the dev server (`npm run dev`) and the command-line tools (`project:build`, `project:validate`,
`project:preview`, `project:print`): the preview server, the build, the PWA, the phone install and the browser tests never list
or serve it (`isLocalProject` in `src/project/node.ts`). In the dev server a local project opens by default.
