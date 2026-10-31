# Usability tests with agent personas

Agents play people using the app: they see **only screenshots** and act **only** with clicks, taps, drags, typing and keys.
A hidden checker reads the app's state and decides whether a task succeeded. The thresholds are release criteria for UI
changes. Scripts: `scripts/usability/`.

## Personas and tasks

`personas.json`: **kid10** (English, mouse, reads at most one sentence; three runs), **firstHome** (Polish adult with a
catalogue house plan, laptop), **seniorPhone** (English, 412 × 915 touch, taps land up to 10 px off, gives up after three
misses), **plSpeaker** (Polish only, tablet in landscape, touch).

`tasks.json` — one sentence each, in the persona's language: T1 look at the house from outside · T2 go to the first floor ·
T3 go into the kitchen · T4 put a sofa in the living room · T5 paint the walls of the main bedroom · T6 make a second version
and compare it · T7 download a model to 3D-print · T8 walk out into the garden · T9 bring back a sofa deleted by mistake ·
T10 switch the language. Each task has a hidden setup (URL parameters, a page script, keys), a hidden check, the clicks of the
shortest path and the threshold. Rooms are referred to by role (the kitchen, the largest living room, the largest bedroom, the
upper level) and read from the package — no building is named.

## Running

```bash
node scripts/usability/run.mjs --label before --build            # one session per persona run; --only kid10:T4 for one task
# then, for each session, an agent follows <session>/prompt.md (a Claude Code subagent; the model id is recorded with --model)
node scripts/usability/report.mjs reports/usability/<date>-<label>
```

- `session.mjs` starts `vite preview` of a build (`--build` builds into the run directory, so later changes do not leak in),
  a browser with the persona's screen and touch, and a local control port. Every task starts in a fresh browser context with
  fresh data; the welcome screen is shown at the start of the session; date, time and picture quality are fixed.
- `act.mjs` is the only tool the persona has: `start`, `click X Y` / `tap X Y`, `drag`, `scroll`, `type`, `key`, `hold KEY S` /
  `hold X Y S` (press and hold a key, or a finger / the mouse button, for S seconds — walking), `wait`, `done`, `giveup`,
  `note "…" [--dead-end] [--too-much-text]`, `sus a,b,…`, `end`; `--say "…"` records a thought. It prints the path of the
  next screenshot and nothing else.
- Executors: by default a Claude Code subagent per session follows `<session>/prompt.md` (the model is recorded with
  `--model`). `--executor api` plays every session right away through the Claude API (`computer.mjs`: a computer-use loop
  with the computer toolset — each member becomes an `act.mjs` command — and the persona tools `say`, `task_done`,
  `give_up`, `note`, `answer_questionnaire`; plain `fetch`, `ANTHROPIC_API_KEY`; the models that answered and the token use go
  to `hidden/executor.json`) and makes the report at the end.
- Hidden (`<session>/hidden/`): the state after every action, the element under the pointer, the visible text, the checker's
  verdicts, the SUS answers.

## Report and thresholds

`report.md` / `report.json`: per persona and task — success, actions against the shortest path and the threshold, whether the
first click was right, actions without effect, the time by the keystroke-level model, quotes; confusion notes with screenshots,
dead ends, jargon seen on screen in simple mode (the word lists of `src/home/ui/language.json`), SUS; issues from
`issues.json` (id, severity 0–4, evidence, the action ids of `reports/ui/actions.md`, proposal).

Thresholds: success 100 % for adults and ≥ 90 % for the child (three runs); actions ≤ shortest path + 2 (≤ 4 for T1–T5 and T7,
≤ 6 for T6); first click right ≥ 80 %; no dead ends, no "needed more than one sentence", no jargon; SUS in role ≥ 80. A fix
that changes behaviour also gets a browser test.

## The skill / plugin dialog

`skill_dialog.mjs` tests the conversation with the `house-forge` plugin (ADR 0046). A persona from `skill-personas.json`
(**anna**: plan pictures and a Creality K1C, no knowledge of architecture or CAD) talks to a Claude Code session that has the
plugin; two `claude -p` sessions are joined turn by turn:

```bash
npm run plugin:build -- --out /tmp/house-forge          # or an existing build of the plugin repository
node scripts/usability/skill_dialog.mjs --plugin /tmp/house-forge/plugins/house-forge --files plan.png [more…] --label anna-flat
```

- The assistant runs in an empty temporary project directory holding only the persona's files, with no user settings or MCP
  servers (like a fresh install); the persona sees only the replies and the pictures they name (copied to its `seen/`).
- The hidden checker validates the package the plugin wrote (`project:validate`), reads every STL (closed surface — every edge
  twice in opposite directions — no degenerate triangles) and checks that it fits the bed (turned by 90° when that helps).
- Thresholds: success, ≤ 6 persona turns, ≤ 2 clarifying questions, no technical question the persona could not answer (the
  persona's own count after the dialog).
- `reports/usability/<date>-<label>/dialog.md` and `dialog.json`: transcript, verdict, models, cost. The project directory with
  the pictures stays in the temporary directory: catalogue plans used for testing never enter the repository.
