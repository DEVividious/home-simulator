# Instructions for AI coding agents

This repository is a 3D home / apartment configurator engine. Buildings are data packages in `projects/<id>/`.

**Skills** live in `skills/<name>/SKILL.md` (Agent Skills format). Before acting on any of these requests, read the SKILL.md
and follow it:
- build / import / update a home or flat from plans, drawings, images → `skills/home-from-plan/SKILL.md`
- check, preview, run a project, explain an error → `skills/home-check/SKILL.md`
- install or update the app on an Android phone → `skills/home-to-phone/SKILL.md`

Rules:
- Never put facts of a particular building into `src/` — they belong in `projects/<id>/` (docs/adr/0005, 0007).
- Write `projects/<id>/source/plan.json`, then `npm run project:build`; never hand-edit a compiled `project.json`.
- Every authored package is validated and previewed before you call it done (docs/adr/0015).
- English for code, comments and docs; UI strings through `t()` with keys in `src/i18n/en` and `src/i18n/pl`.
- Checks before finishing a code change: `npm run typecheck && npm test && npm run audit:genericity && npm run audit:i18n`.
