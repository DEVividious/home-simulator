# Authoring a building

The human version of the `home-from-plan` skill. You write `projects/<id>/source/plan.json`; the compiler writes
`project.json`.

1. **Start from an example**: copy `projects/demo-apartment/` (flat, metres) or `projects/sample-house/` (house, stairs, plot)
   to `projects/<your-id>/` and edit `source/plan.json` (format: skills/home-from-plan/references/plan-schema.md; rules:
   skills/home-from-plan/references/authoring-conventions.md).
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

Things the format cannot express yet (slanted walls without a model, sloped ceilings, other stair shapes, roofs) are listed in
docs/KNOWN_LIMITATIONS.md. A building with such geometry can supply a GLB model (`assets.model` in `plan.json`, copied into the package; docs/PROJECT_PACKAGE_SPEC.md).
