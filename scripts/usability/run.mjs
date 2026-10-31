// Usability run (ADR 0045): starts one session per persona run (scripts/usability/session.mjs, each with its own port and data)
// and writes, next to each session, the prompt for the agent that plays the persona. The default executor is a Claude Code
// subagent that acts only through act.mjs; the model playing the persona is recorded with --model.
// Usage: node scripts/usability/run.mjs [--label before] [--personas kid10,firstHome] [--only kid10:T4,seniorPhone:T6]
//        [--runs 1] [--dist dist] [--build] [--model claude-sonnet-5-5] [--project sample-house]
//        --build makes a fresh build into <run>/dist first (the run then does not depend on later changes to dist/).
// Output: reports/usability/<date>[-label]/<persona>-<n>/ with session.json, prompt.md and, after the run, the screenshots and
// hidden/; sessions.json lists them. Close a session with act.mjs end; report with scripts/usability/report.mjs <dir>.
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT, sleep } from '../verify/browser.mjs';
import { PERSONAS, TASKS, sessionFile, writeJson } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', ''), model = arg('model', 'claude-sonnet-5-5'), project = arg('project', 'sample-house');
const root = resolve(ROOT, 'reports/usability', `${new Date().toISOString().slice(0, 10)}${label ? `-${label}` : ''}`);
mkdirSync(root, { recursive: true });
let dist = resolve(ROOT, arg('dist', 'dist'));
if (process.argv.includes('--build')) {
  dist = join(root, 'dist');
  process.stdout.write(`build → ${relative(ROOT, dist)} … `);
  execSync(`npx vite build --outDir ${JSON.stringify(dist)} --emptyOutDir`, { cwd: ROOT, stdio: 'pipe' });
  console.log('done');
}
if (!existsSync(join(dist, 'index.html'))) { console.error(`no build in ${dist} — run with --build or npm run build`); process.exit(2); }

// what to run: every task of each persona (runs per persona from personas.json, or --runs), or only the listed persona:task pairs
const only = (arg('only', '') ?? '').split(',').filter(Boolean).map((x) => x.split(':'));
const personas = only.length ? [...new Set(only.map(([p]) => p))] : (arg('personas', '') || Object.keys(PERSONAS).join(',')).split(',');
const plan = [];
for (const p of personas) {
  if (!PERSONAS[p]) { console.error(`unknown persona ${p}`); process.exit(2); }
  const tasks = only.length ? only.filter(([q]) => q === p).map(([, t]) => t) : TASKS.map((t) => t.id);
  const runs = Number(arg('runs', only.length ? 1 : PERSONAS[p].runs));
  for (let n = 1; n <= runs; n++) plan.push({ persona: p, n, tasks });
}

const sessions = [];
let port = Number(arg('port', '4400'));
for (const r of plan) {
  const out = join(root, `${r.persona}-${r.n}`);
  const log = openSync(join(root, `${r.persona}-${r.n}.session.log`), 'w');
  const child = spawn(process.execPath, [join(ROOT, 'scripts/usability/session.mjs'), '--persona', r.persona, '--out', out, '--dist', dist, '--port', String(port++), '--project', project, '--tasks', r.tasks.join(','), '--model', model], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 240 && !existsSync(sessionFile(out)); i++) await sleep(500);
  if (!existsSync(sessionFile(out))) { console.error(`session ${r.persona}-${r.n} did not start — see ${relative(ROOT, out)}.session.log`); continue; }
  writeFileSync(join(out, 'prompt.md'), prompt(r.persona, out, r.tasks.length));
  sessions.push({ persona: r.persona, run: r.n, dir: relative(ROOT, out), tasks: r.tasks, prompt: relative(ROOT, join(out, 'prompt.md')) });
  console.log(`${r.persona}-${r.n}: ${relative(ROOT, out)} (${r.tasks.join(',')})`);
}
writeJson(join(root, 'sessions.json'), { model, project, dist: relative(ROOT, dist), sessions });

function prompt(id, out, n) {
  const p = PERSONAS[id], rel = relative(ROOT, out), act = `node scripts/usability/act.mjs --session ${rel}`;
  const tap = p.touch ? 'tap' : 'click';
  return `# Usability test — you play a person using an app

${p.brief}

Device: ${p.device}. Screen ${p.viewport.width} × ${p.viewport.height} pixels.

You are testing a home design app the way this person would. You get ${n} small tasks, one at a time. Work in the
repository directory ${ROOT}.

## Rules (strict)
- You see the app ONLY through screenshots. After every command, open the printed screenshot with the Read tool and look
  at it. Coordinates are pixels of that screenshot.
- You act ONLY with the commands below, run with Bash. Do NOT read, search or open any other file or directory (no source
  code, no \`hidden/\` folder, no session.json, no logs) and do not run any other program. Do not use a browser tool.
- Behave like the person: notice what they would notice, read only as much as they would read, guess like they would.
  Do not use knowledge of how such apps are built. If something is unclear to the person, it is unclear to you.
- Add \`--say "…"\` to a command to think aloud in the person's own words and language (one short sentence).
- When you believe the task is done, run \`done\`. If the person would give up, run \`giveup\`. The next task then starts by
  itself and its first screenshot is printed. After ${15} actions on one task the person runs out of patience.
- When something confuses the person, record it with \`note\` (add \`--dead-end\` if there was no way forward, and
  \`--too-much-text\` if the person needed more than one sentence to understand).

## Commands
\`\`\`
${act} start                       # first task and first screenshot
${act} ${tap} X Y [--say "…"]
${act} drag X1 Y1 X2 Y2
${act} scroll X Y DY                # mouse wheel, DY > 0 = down
${act} type "text"
${act} key Enter                     # also Escape, Control+z …
${act} wait                          # look again after a moment
${act} done [--say "…"]
${act} giveup [--say "…"]
${act} note "…" [--dead-end] [--too-much-text]
${act} sus 4,2,5,1,4,2,5,1,4,2       # at the very end
${act} end
\`\`\`

## At the end
Answer the ten System Usability Scale statements as this person (1 = strongly disagree … 5 = strongly agree), in this order:
1 I would like to use this app often. 2 The app was unnecessarily complex. 3 The app was easy to use. 4 I would need help
from a technical person to use it. 5 The functions were well integrated. 6 There was too much inconsistency. 7 Most people
would learn to use it very quickly. 8 It was very cumbersome to use. 9 I felt very confident using it. 10 I needed to learn a
lot before I could get going. Run \`sus\` with your ten answers, then \`end\`.

Finally reply with a short summary in the person's voice: for each task, what you did and how it felt (quote yourself), and
the three moments that confused you most.
`;
}
