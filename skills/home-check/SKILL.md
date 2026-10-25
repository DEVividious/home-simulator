---
name: home-check
description: Validate, preview, run or diagnose a Home Simulator project package (projects/<id>). Use after editing plan.json or project.json, or when the user says "check my project", "show me the plan", "run the app", "open my flat in 3D", "why does my project not load", "the 3D looks wrong".
allowed-tools: Bash(npm run project:*) Bash(npm run -s project:*) Bash(npm run dev*) Bash(npm run build) Bash(node scripts/*) Read Edit Glob Grep
metadata:
  version: 1
  requires: node>=22.12, Chrome or Chromium for previews (CHROME=/path if not found)
---

# home-check

The loop to run after any change to a building, and the first aid when a project does not load.

## Validate

```bash
npm run -s project:build -- projects/<id>      # only when projects/<id>/source/plan.json exists — recompiles project.json
npm run -s project:validate -- projects/<id>   # the same checks the app runs at load time; exit 2 = errors
```
Every message has the form `path: message` or `<thing> "<id>": message`. Look it up in `references/errors.md` and fix the
SOURCE (`plan.json`; `project.json` only for packages without a plan). Rebuild until there are no errors; read the warnings.

## Preview

```bash
npm run -s project:preview -- projects/<id> [--room <roomId>]
```
Renders the package headless in Chrome into `projects/<id>/preview/`: `plan-<level>.png` (top-down section of each level with
rooms, doors and windows) and `3d.png` (exterior view; `room-<id>.png` with --room). Look at the images; compare them with the
source drawing when the package was imported.

## Run

```bash
npm run dev            # http://localhost:5173/?project=<id>
```
In a session without a display, use the preview instead. The settings (gear icon) switch projects and language; expert mode
shows data confidence colours, axes and raw JSON.

## Doctor

- `node scripts/audit/no-house-refs.mjs` — no leaks of the source building in engine code (for contributors).
- The app shows "Project package … is invalid: …" → the same list as `project:validate`.
- Blank scene / spinner forever: open the browser console; `npm run build` must pass (`npm run typecheck`).
- Saving fails with "conflict": the document changed on disk (another tab or the phone) — the app asks which version to keep.
- Phone problems → the `home-to-phone` skill.
