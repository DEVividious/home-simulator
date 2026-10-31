// Usability session (ADR 0045): starts the app (vite preview of a build) and a browser for one persona run, writes
// <out>/session.json and runs the persona's commands (act.mjs passes them on over a local HTTP port) until `act.mjs end`.
// The session owns the page, so the persona's screen size and touch emulation stay for the whole run.
// Usage: node scripts/usability/session.mjs --persona kid10 --out reports/usability/<date>/kid10-1 [--dist dist] [--port 4400]
//        [--project sample-house] [--tasks T1,T2] [--model <id of the model playing the persona>]
// Prints "READY <out>" when the first task can start.
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, ROOT, sleep, startServer } from '../verify/browser.mjs';
import {
  MAX_ACTIONS, PERSONAS, TASKS, beginTask, downloadsOf, hidden, hitTest, judge, logHidden, projectFacts, readJson, screenshot,
  sessionFile, settle, snapshot, visibleText, writeJson,
} from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const personaId = arg('persona');
if (!PERSONAS[personaId]) { console.error(`unknown persona "${personaId}" — ${Object.keys(PERSONAS).join(', ')}`); process.exit(2); }
const persona = PERSONAS[personaId];
const out = resolve(ROOT, arg('out', `reports/usability/${new Date().toISOString().slice(0, 10)}/${personaId}-1`));
const project = arg('project', 'sample-house'), port = Number(arg('port', '4400')), dist = resolve(ROOT, arg('dist', 'dist'));
const tasks = (arg('tasks', '') || TASKS.map((t) => t.id).join(',')).split(',').filter(Boolean);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const userdata = mkdtempSync(join(tmpdir(), `home-sim-usability-${personaId}-`));
const server = await startServer({ port, mode: 'preview', userdata, outDir: dist });
const { browser, renderer } = await launch({ viewport: persona.viewport });
let sha = null;
try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() + (execSync('git status --porcelain', { cwd: ROOT }).toString().trim() ? '+dirty' : ''); } catch { /* not a checkout */ }
const S = {
  dir: out, persona: personaId, project, tasks, url: server.url, userdata, pid: process.pid, renderer, sha, control: port + 1000,
  model: arg('model', null), dist, facts: projectFacts(project), index: -1, startedAt: new Date().toISOString(),
};
let page = null, context = null;
const goal = (task) => task.goal[persona.lang] ?? task.goal.en;

async function start(index) {
  const r = await beginTask(browser, S, index, context);
  page = r.page; context = r.context;
  return [`Task ${index + 1} of ${S.tasks.length}: ${goal(r.task)}`, `Screenshot: ${r.shot}`];
}

async function finish(how, say, tired = false) {
  const task = TASKS.find((t) => t.id === S.task);
  await sleep(1500);                                                     // a download in progress finishes
  const final = page ? await snapshot(page, S.ctx) : null;
  const ever = readJson(hidden(out, `${S.task}.ever.json`), []);
  const downloads = downloadsOf(join(out, 'downloads', task.id));
  const ok = !!final && judge(task, { final, ever, ctx: S.ctx, downloads });
  const results = readJson(hidden(out, 'results.json'), {});
  results[task.id] = { said: how, tired, success: ok, actions: S.actions, steps: S.step, downloads: downloads.files };
  writeJson(hidden(out, 'results.json'), results);
  logHidden(out, { task: task.id, kind: how, say, success: ok, state: final });
  if (S.index + 1 < S.tasks.length) return ['Task finished.', ...(await start(S.index + 1))];
  S.index = S.tasks.length; writeJson(sessionFile(out), S);
  return ['All tasks finished. Now answer the questionnaire with the "sus" command, then run "end".'];
}

async function act({ cmd, args = [], say = null, deadEnd = false, tooMuch = false }) {
  const num = (i) => { const v = Number(args[i]); if (!Number.isFinite(v)) throw new Error(`${cmd}: expected a number as argument ${i + 1}`); return v; };
  if (cmd === 'note') { logHidden(out, { task: S.task ?? null, kind: 'note', text: args.join(' '), deadEnd, tooMuch, step: S.step ?? 0 }); return ['Noted.']; }
  if (cmd === 'sus') {
    const a = String(args[0] ?? '').split(',').map(Number);
    if (a.length !== 10 || a.some((x) => !(x >= 1 && x <= 5))) throw new Error('sus: give ten answers 1–5 separated by commas');
    writeJson(hidden(out, 'sus.json'), { answers: a, say });
    return ['Thank you — answers saved.'];
  }
  if (cmd === 'start') return start(0);
  if (S.index < 0 || !page) throw new Error('run "start" first');
  if (S.index >= S.tasks.length) throw new Error('all tasks are finished — answer "sus", then "end"');
  if (cmd === 'done' || cmd === 'giveup') return finish(cmd, say);
  const jit = (v) => (persona.jitter ? v + Math.round((Math.random() * 2 - 1) * persona.jitter) : v);
  const before = await snapshot(page, S.ctx);
  const rec = { task: S.task, kind: 'action', cmd, args, say, step: S.step + 1 };
  if (cmd === 'click' || cmd === 'tap') {
    const x = jit(num(0)), y = jit(num(1));
    rec.at = [x, y]; rec.hit = await hitTest(page, x, y);
    if (persona.touch) await page.touchscreen.tap(x, y); else { await page.mouse.move(x, y); await sleep(60); await page.mouse.click(x, y); }
  } else if (cmd === 'drag') {
    const [x1, y1, x2, y2] = [jit(num(0)), jit(num(1)), num(2), num(3)];
    rec.at = [x1, y1, x2, y2]; rec.hit = await hitTest(page, x1, y1);
    if (persona.touch) {
      await page.touchscreen.touchStart(x1, y1);
      for (let i = 1; i <= 12; i++) { await page.touchscreen.touchMove(x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12); await sleep(25); }
      await page.touchscreen.touchEnd();
    } else {
      await page.mouse.move(x1, y1); await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12); await sleep(25); }
      await page.mouse.up();
    }
  } else if (cmd === 'scroll') {
    await page.mouse.move(num(0), num(1)); await page.mouse.wheel({ deltaY: num(2) });
  } else if (cmd === 'type') {
    await page.keyboard.type(args.join(' '), { delay: 30 });
  } else if (cmd === 'key') {
    const keys = String(args[0] ?? '').split('+');
    for (const k of keys.slice(0, -1)) await page.keyboard.down(k);
    await page.keyboard.press(keys.at(-1));
    for (const k of keys.slice(0, -1).reverse()) await page.keyboard.up(k);
  } else if (cmd === 'hold') {
    // press and hold: a key (hold W 2) or a finger / the mouse button at a point (hold X Y 2), at most 10 s
    const pointer = args.length >= 3, s = Math.min(10, Math.max(0.1, num(pointer ? 2 : 1)));
    if (pointer) {
      const x = jit(num(0)), y = jit(num(1));
      rec.at = [x, y]; rec.hit = await hitTest(page, x, y);
      if (persona.touch) { await page.touchscreen.touchStart(x, y); await sleep(s * 1000); await page.touchscreen.touchEnd(); }
      else { await page.mouse.move(x, y); await page.mouse.down(); await sleep(s * 1000); await page.mouse.up(); }
    } else {
      const keys = String(args[0] ?? '').split('+');
      for (const k of keys) await page.keyboard.down(k);
      await sleep(s * 1000);
      for (const k of keys.reverse()) await page.keyboard.up(k);
    }
  } else if (cmd !== 'wait') throw new Error(`unknown command "${cmd}"`);
  if (cmd !== 'wait') S.actions++;
  await settle(page, cmd === 'wait' ? 1500 : 700);
  // a language or project switch reloads the page: wait for the app again
  await page.waitForFunction(() => !!window.__home?.state?.().loaded, { timeout: 60000 }).catch(() => {});
  S.step++;
  const after = await snapshot(page, S.ctx);
  const shot = await screenshot(page, S);
  Object.assign(rec, { effect: JSON.stringify(before) !== JSON.stringify(after), state: after, text: await visibleText(page) });
  logHidden(out, rec);
  const ever = readJson(hidden(out, `${S.task}.ever.json`), []); ever.push(after); writeJson(hidden(out, `${S.task}.ever.json`), ever);
  writeJson(sessionFile(out), S);
  if (S.actions >= MAX_ACTIONS) return [`You have used ${MAX_ACTIONS} actions on this task and run out of patience.`, ...(await finish('giveup', null, true))];
  return [`Screenshot: ${shot}`];
}

const stop = async () => { await browser.close().catch(() => {}); server.stop(); rmSync(userdata, { recursive: true, force: true }); writeFileSync(join(out, 'ended'), new Date().toISOString()); process.exit(0); };
// one command at a time, in the order they arrive
let queue = Promise.resolve();
createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    queue = queue.then(async () => {
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch { msg = {}; }
      if (msg.cmd === 'end') { res.end(JSON.stringify({ ok: true, text: 'Session closed.' })); setTimeout(stop, 100); return; }
      try { res.end(JSON.stringify({ ok: true, text: (await act(msg)).join('\n') })); } catch (e) { res.end(JSON.stringify({ ok: false, text: String(e?.message ?? e) })); }
    });
  });
}).listen(S.control, '127.0.0.1', () => {
  writeJson(sessionFile(out), S);
  console.log(`READY ${out}`);
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
