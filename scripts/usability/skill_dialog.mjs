// Skill / plugin dialog test (ADR 0046): a persona who has floor-plan files and a 3D printer talks to a Claude Code session
// that has the house-forge plugin. Two `claude -p` sessions are joined turn by turn (no Agent SDK dependency):
//  • the assistant — the plugin loaded with --plugin-dir, in an empty temporary project directory holding only the persona's
//    files, no user settings or MCP servers (like a fresh install), permissions bypassed inside that directory;
//  • the persona (Claude Sonnet 5.5 by default) — sees only the assistant's replies and the pictures the assistant names (copied
//    to its seen/ folder; it may open those and its own files, nothing else).
// The hidden checker then validates the package the plugin wrote (npm run project:validate), reads every STL (closed surface,
// no degenerate triangles) and checks it fits the bed. Thresholds: success, ≤ 6 persona turns, ≤ 2 clarifying questions, no
// technical question the persona could not answer (her own count, asked after the dialog).
// Usage: node scripts/usability/skill_dialog.mjs --plugin ../house-forge/plugins/house-forge --files plan.png [more…]
//        [--persona anna] [--label anna-flat] [--work /tmp/dir] [--max-turns 10] [--assistant-model <id>]
//        [--persona-model claude-sonnet-5-5]
//        node scripts/usability/skill_dialog.mjs --account reports/usability/<run>/dialog.json   asks the persona of a finished
//        dialog the closing questions again (same session) and rewrites the report.
// Output: reports/usability/<date>-<label>/dialog.md (transcript and verdict) and dialog.json. The project directory (the
// plugin's output, the previews) stays in the temporary --work directory — plan images that may not enter the repository
// (e.g. catalogue plans used for testing) are never copied into it.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ROOT } from '../verify/browser.mjs';
import { fitsBed, stlCheck, writeJson } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const list = (k) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) return []; const out = []; for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith('--'); j++) out.push(process.argv[j]); return out; };
const PERSONAS = JSON.parse(readFileSync(join(ROOT, 'scripts/usability/skill-personas.json'), 'utf8'));
const personaId = arg('persona', 'anna'), P = PERSONAS[personaId];
if (!P) { console.error(`unknown persona ${personaId} — ${Object.keys(PERSONAS).join(', ')}`); process.exit(2); }
/** the persona's system prompt: who she is, her files, what she may see */
const systemFor = (fileNames) => `${P.brief}

Your files (in the folder my-files/): ${fileNames.join(', ')}. ${P.printer}

You are chatting with an assistant in an app on your computer that should turn your plan into a model you can print. Write
like a person in a chat: short, in ${P.language}, in your own words. You see only the assistant's messages and the pictures
listed with them (in seen/ — open each with the Read tool and look at it; you may also open your own files in my-files/).
Do not open any other file. Answer what you know; when you do not know something, say so. When the assistant says the files
to print are ready and you are content, answer briefly and end with [DONE]. If you would give up, end with [GIVE UP].`;
/** asked after the dialog: what the thresholds count (a confirmation is not a clarifying question; a fact of the home the
 *  person simply did not know is not a technical question) */
const ACCOUNT = `The chat is over. Answer only with JSON, no other text:
{"clarifying_questions": <how many times the assistant asked you for a fact about your home or a wish (a size, what is where,
  which option you want) — do NOT count "is this right?" or "do you approve?" confirmations>,
 "technical_questions_i_could_not_answer": [<questions that only someone who knows building or 3D printing could answer —
  e.g. a roof pitch in degrees, a wall thickness, a nozzle or a layer height — that you could not answer; NOT facts about your
  home you happened not to know>],
 "facts_i_did_not_know": [<questions about your home you could not answer>],
 "content": true|false, "comment": "<one sentence>"}`;
const personaModel = arg('persona-model', 'claude-sonnet-5-5');
const accountOf = (text) => { try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return { raw: text }; } };

/** one turn of a `claude -p` session; returns the reply, the session id, the models that answered */
function claude(cwd, prompt, opts) {
  return new Promise((done, fail) => {
    const a = ['-p', prompt, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', ...opts];
    const p = spawn('claude', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { e += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), 45 * 60 * 1000);
    p.on('close', (code) => {
      clearTimeout(timer);
      try { const j = JSON.parse(o); done({ text: String(j.result ?? ''), session: j.session_id, models: Object.keys(j.modelUsage ?? {}), cost: j.total_cost_usd ?? 0, error: j.is_error ? j.subtype : null }); }
      catch { fail(new Error(`claude exited ${code}: ${(e || o).slice(0, 600)}`)); }
    });
  });
}

/** the thresholds of ADR 0046 */
function thresholdsOf(r) {
  const c = r.check, a = r.account ?? {}, tech = a.technical_questions_i_could_not_answer;
  const success = !!c.package?.valid && c.parts.length > 0 && c.parts.every((p) => p.ok && p.fits);
  return [
    ['package valid, every STL closed and on the bed', success],
    [`persona turns ≤ 6 (${r.personaTurns})`, r.personaTurns <= 6],
    [`clarifying questions ≤ 2 (${a.clarifying_questions ?? '?'})`, Number(a.clarifying_questions) <= 2],
    [`no technical question she could not answer (${Array.isArray(tech) ? tech.length : '?'})`, Array.isArray(tech) && tech.length === 0],
  ].map(([criterion, met]) => ({ criterion, met }));
}

function writeReport(r, dir) {
  const c = r.check;
  writeJson(join(dir, 'dialog.json'), r);
  writeFileSync(join(dir, 'dialog.md'), [
    `# Skill dialog — ${r.persona} with house-forge ${r.pluginVersion}`, '',
    `Files: ${r.files.join(', ')} · assistant ${r.models.assistant.join(', ')} · persona ${r.models.persona.join(', ')} · ended: ${r.ended ?? 'turn limit'} · cost $${r.costUsd}`, '',
    `Project directory (not in the repository): ${r.work}`, '',
    '## Thresholds', '', '| criterion | met |', '|---|---|', ...r.thresholds.map((t) => `| ${t.criterion} | ${t.met ? 'yes' : '**no**'} |`), '',
    '## Checker', '', `Package: ${c.package ? `${c.package.house} ${c.package.valid ? 'valid' : `**invalid** — ${c.package.why}`}` : '**none written**'} · build ${c.build ?? '**none**'}`, '',
    ...c.parts.map((p) => `- ${p.file}: ${p.triangles} triangles, ${p.closed ? 'closed' : `**${p.openEdges} open edges**`}, ${p.degenerate} degenerate, ${p.size?.join(' × ')} mm${p.fits ? '' : ' **does not fit the bed**'}`), '',
    '## Her account', '', '```json', JSON.stringify(r.account, null, 2), '```', '',
    '## Transcript', '', ...r.turns.map((t) => `**${t.who === 'persona' ? r.persona : 'assistant'}**${t.seconds ? ` (${t.seconds} s)` : ''}${t.pictures?.length ? ` — pictures: ${t.pictures.join(', ')}` : ''}\n\n${t.text}\n`),
  ].join('\n'));
  console.log(`\n${relative(ROOT, join(dir, 'dialog.md'))}`);
  for (const t of r.thresholds) console.log(`  ${t.met ? 'met ' : 'NOT '} ${t.criterion}`);
}

// --account: the closing questions again, to the persona of a finished dialog (its session resumed)
if (arg('account')) {
  const file = resolve(arg('account')), r = JSON.parse(readFileSync(file, 'utf8'));
  if (!r.sessions?.persona) { console.error(`${file}: no persona session recorded`); process.exit(2); }
  const a = await claude(`${r.work}-persona`, ACCOUNT, ['--model', personaModel, '--tools', 'Read', '--permission-mode', 'bypassPermissions', '--system-prompt', systemFor(r.files), '--resume', r.sessions.persona]);
  r.account = accountOf(a.text); r.costUsd = Math.round((r.costUsd + a.cost) * 100) / 100; r.thresholds = thresholdsOf(r);
  writeReport(r, dirname(file));
  process.exit(0);
}

const plugin = resolve(arg('plugin', join(ROOT, '../house-forge/plugins/house-forge')));
if (!existsSync(join(plugin, '.claude-plugin/plugin.json'))) { console.error(`no plugin in ${plugin} (build one: npm run plugin:build -- --out <dir>)`); process.exit(2); }
const files = list('files').map((f) => resolve(f));
if (!files.length || files.some((f) => !existsSync(f))) { console.error('give the persona\'s plan files with --files'); process.exit(2); }
const label = arg('label', personaId), maxTurns = Number(arg('max-turns', '10'));
const out = resolve(ROOT, 'reports/usability', `${new Date().toISOString().slice(0, 10)}-${label}`);
const work = resolve(arg('work', mkdtempSync(join(tmpdir(), `house-forge-${personaId}-`))));
const me = join(work, '..', `${basename(work)}-persona`);
for (const d of [out, work, join(me, 'seen'), join(me, 'my-files')]) mkdirSync(d, { recursive: true });
for (const f of files) { copyFileSync(f, join(work, basename(f))); copyFileSync(f, join(me, 'my-files', basename(f))); }

/** the pictures a reply names (paths ending in .png inside the project directory) → copied for the persona to see */
let shown = 0;
function pictures(text) {
  const seen = [];
  for (const m of text.matchAll(/([\w./~-]*[\w-]+\.png)\b/g)) {
    const f = isAbsolute(m[1]) ? m[1] : join(work, m[1]);
    if (!existsSync(f) || !f.startsWith(work) || seen.some((s) => s.from === f)) continue;
    const to = `seen/${String(++shown).padStart(2, '0')}-${basename(f)}`;
    copyFileSync(f, join(me, to)); seen.push({ from: f, to });
  }
  return seen;
}

const system = systemFor(files.map((f) => basename(f)));
const sessions = { assistant: null, persona: null }, turns = [], models = { assistant: new Set(), persona: new Set() };
let cost = 0, ended = null;
const personaOpts = () => ['--model', personaModel, '--tools', 'Read', '--permission-mode', 'bypassPermissions', '--system-prompt', system, ...(sessions.persona ? ['--resume', sessions.persona] : [])];
const assistantOpts = () => ['--plugin-dir', plugin, '--permission-mode', 'bypassPermissions', '--disallowedTools', 'AskUserQuestion', ...(arg('assistant-model') ? ['--model', arg('assistant-model')] : []), ...(sessions.assistant ? ['--resume', sessions.assistant] : [])];

let say = await claude(me, P.opening, personaOpts());
for (let n = 1; n <= maxTurns; n++) {
  sessions.persona = say.session; say.models.forEach((m) => models.persona.add(m)); cost += say.cost;
  const persona = say.text.trim();
  turns.push({ who: 'persona', text: persona });
  console.log(`\n— ${personaId} (${n}): ${persona}`);
  const end = /\[(DONE|GIVE UP)\]/.exec(persona)?.[1];
  if (end) { ended = end; break; }
  const t0 = Date.now();
  const r = await claude(work, persona.replace(/\[(DONE|GIVE UP)\]/g, '').trim(), assistantOpts());
  sessions.assistant = r.session; r.models.forEach((m) => models.assistant.add(m)); cost += r.cost;
  const seen = pictures(r.text);
  turns.push({ who: 'assistant', text: r.text, seconds: Math.round((Date.now() - t0) / 1000), pictures: seen.map((s) => relative(work, s.from)), error: r.error });
  console.log(`\n— assistant (${Math.round((Date.now() - t0) / 1000)} s${seen.length ? `, ${seen.length} picture(s)` : ''}): ${r.text}`);
  say = await claude(me, `The assistant wrote:\n\n${r.text}\n\n${seen.length ? `Pictures shown with this message: ${seen.map((s) => s.to).join(', ')}` : 'No pictures with this message.'}\n\nWrite your reply.`, personaOpts());
}
const personaTurns = turns.filter((t) => t.who === 'persona').length;

// the persona's own account, after the dialog (hidden from the assistant)
const ask = await claude(me, ACCOUNT, personaOpts());
const account = accountOf(ask.text);
cost += ask.cost;

// hidden checker: the package and the STL parts the plugin wrote
const outRoot = join(work, 'house-forge-output'), houses = existsSync(outRoot) ? readdirSync(outRoot).filter((d) => statSync(join(outRoot, d)).isDirectory()) : [];
const check = { houses, package: null, build: null, parts: [], bed: P.bed };
for (const h of houses) {
  const dir = join(outRoot, h);
  if (existsSync(join(dir, 'project.json'))) {
    try { execFileSync('npx', ['vite-node', 'scripts/project/validate.ts', '--', dir], { cwd: ROOT, stdio: 'pipe' }); check.package = { house: h, valid: true }; }
    catch (e) { check.package = { house: h, valid: false, why: String(e.stdout ?? e.message).slice(-600) }; }
  }
  const builds = existsSync(join(dir, 'builds')) ? readdirSync(join(dir, 'builds')).map((b) => join(dir, 'builds', b)).filter((b) => readdirSync(b).some((f) => f.endsWith('.stl'))) : [];
  const last = builds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (last) {
    check.build = relative(work, last);
    for (const f of readdirSync(last).filter((x) => x.endsWith('.stl')).sort()) { const s = stlCheck(readFileSync(join(last, f))); check.parts.push({ file: f, ...s, fits: !!s.size && fitsBed(s.size, P.bed) }); }
  }
}
const result = { persona: personaId, sessions, plugin, pluginVersion: JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8')).version, files: files.map((f) => basename(f)), work, ended, personaTurns,
  models: { assistant: [...models.assistant], persona: [...models.persona] }, costUsd: Math.round(cost * 100) / 100, account, check, thresholds: [], turns };
result.thresholds = thresholdsOf(result);
writeReport(result, out);
