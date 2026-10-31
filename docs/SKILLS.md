# Skills

Skills are short procedures for AI coding agents in the open Agent Skills format: `skills/<name>/SKILL.md` (YAML front matter:
`name`, `description`, `allowed-tools`, `metadata`) with `scripts/`, `references/` and `assets/` next to it.
Claude Code finds them through `.claude/skills/` (links), Codex / Gemini CLI through `AGENTS.md`, Cursor through
`.cursor/rules/home-simulator.mdc`.

| Skill | Use | Main commands |
|---|---|---|
| `home-from-plan` | build or update a building from DWG / DXF, PDF, images or a description | `tools/*`, `npm run project:build / validate / preview` |
| `home-check` | validate, preview, run, print (STL), explain errors | `npm run project:validate / preview / print`, `npm run dev` |
| `home-to-phone` | install / update the PWA on Android over USB | `node scripts/phone/phone.mjs …` |

Writing a skill: keep it a procedure (what to run, what to look at, when to ask the user); put logic into versioned tools; every
step must also work when a person runs it by hand. Generated references (`catalog-ids.md`) are refreshed by
`npm run skills:catalog`.

The plugin `house-forge` (`packages/house-forge`, [HOUSE_FORGE.md](HOUSE_FORGE.md)) carries a skill of its own built from these:
its references are generated from `home-from-plan`'s, its commands run the same core and tools. Change the repository skill,
then `npm run plugin:build`.

Sample input for trying `home-from-plan`: `skills/home-from-plan/assets/samples/flat-2room.png` (a flat with a bedroom,
bathroom, open kitchen and living room, hallway and stairs).
