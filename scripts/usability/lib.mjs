// Usability sessions (ADR 0045) — shared by session.mjs (keeps the server and the browser alive), act.mjs (one persona action
// per call) and report.mjs. The persona sees only screenshots and acts only through act.mjs; everything else — the state after
// every action, what was under the pointer, the visible text, the checker's verdict — goes to the hidden/ directory of the
// session, which the persona is told not to open.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { ROOT, sleep } from '../verify/browser.mjs';

export const HERE = resolve(ROOT, 'scripts/usability');
export const PERSONAS = JSON.parse(readFileSync(join(HERE, 'personas.json'), 'utf8'));
export const TASKS = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8')).tasks;
/** fixed conditions of every session: the same day, time, picture quality */
export const FIXED = { date: '2026-06-21', time: '14:00', quality: 'medium' };
/** after this many actions on one task the persona has run out of patience — the task ends as not done */
export const MAX_ACTIONS = 15;

export const readJson = (f, d = null) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
export const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
export const sessionFile = (dir) => join(dir, 'session.json');
export const hidden = (dir, ...p) => { const d = join(dir, 'hidden'); mkdirSync(d, { recursive: true }); return join(d, ...p); };
export const logHidden = (dir, rec) => appendFileSync(hidden(dir, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n');

/** project facts the tasks refer to by role (read from the package — no building is named in the tasks) */
export function projectFacts(id) {
  const p = JSON.parse(readFileSync(join(ROOT, 'projects', id, 'project.json'), 'utf8'));
  const rooms = p.building.rooms.rooms, levels = p.manifest.levels.map((l) => l.id);
  const largest = (f) => rooms.filter(f).sort((a, b) => b.area - a.area)[0]?.id ?? null;
  return {
    project: id, levels, upper: levels[1] ?? levels[0],
    kitchen: largest((r) => r.kind === 'kitchen' || (r.tags ?? []).includes('kitchen')),
    living: largest((r) => r.kind === 'living'),
    bedroom: largest((r) => r.kind === 'bed'),
  };
}

/** the state the checker sees (hidden from the persona) */
export const snapshot = (page, ctx) => page.evaluate((ctx) => {
  const h = window.__home;
  if (!h?.state) return null;
  const s = h.state(), v = h.variants(), w = window.__home3d?.walk?.() ?? null;
  const rooms = Object.fromEntries([ctx.kitchen, ctx.living, ctx.bedroom].filter(Boolean).map((id) => [id, h.room(id)]));
  return {
    section: s.section, mode: s.mode, houseView: s.houseView, level: s.level, roomId: s.roomId, roomView: s.roomView,
    selection: s.selection?.kind ?? null, past: s.past, future: s.future, variants: v.list.length, compare: v.compare?.kind ?? null,
    walk: w && { on: w.on, kind: w.kind, roomId: w.roomId }, lang: document.documentElement.lang, rooms,
  };
}, ctx).catch(() => null);

/** what is under a screen point: the nearest element with a test id, the tag, a bit of its text (hidden) */
export const hitTest = (page, x, y) => page.evaluate((x, y) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const t = el.closest('[data-testid]');
  return { tag: el.tagName.toLowerCase(), testid: t?.dataset.testid ?? null, text: (el.closest('button,a,label,[role]') ?? el).textContent?.trim().slice(0, 60) ?? '', canvas: el.tagName === 'CANVAS' };
}, x, y).catch(() => null);

export const visibleText = (page) => page.evaluate(() => document.body.innerText.slice(0, 6000)).catch(() => '');

/** waits until the scene camera is at rest (or the time runs out) */
export async function settle(page, ms = 700) {
  await sleep(ms);
  let prev = null;
  for (let i = 0; i < 20; i++) {
    const c = await page.evaluate(() => window.__home3d?.camera?.() ?? null).catch(() => null);
    const cur = JSON.stringify(c && [c.position, c.dir]);
    if (cur === prev) return;
    prev = cur;
    await sleep(200);
  }
}

/** downloads of a task: files and whether one is an STL (or a zip with STL files in it) */
export function downloadsOf(dir) {
  if (!existsSync(dir)) return { files: [], stl: false };
  const files = readdirSync(dir).filter((f) => !f.endsWith('.crdownload'));
  const stl = files.some((f) => /\.stl$/i.test(f) || (/\.zip$/i.test(f) && zipNames(readFileSync(join(dir, f))).some((n) => /\.stl$/i.test(n))));
  return { files, stl };
}
/** names in a zip file (central directory) */
export function zipNames(buf) {
  const names = [];
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return names;
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0, n = buf.readUInt16LE(e + 10); i < n && p + 46 <= buf.length; i++) {
    const len = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + len).toString('utf8'));
    p += 46 + len + extra + comment;
  }
  return names;
}
/** one file of a zip (stored or deflated) */
export function zipFile(buf, name) {
  for (let p = 0; p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50;) {
    const method = buf.readUInt16LE(p + 8), size = buf.readUInt32LE(p + 18), len = buf.readUInt16LE(p + 26), extra = buf.readUInt16LE(p + 28);
    const n = buf.subarray(p + 30, p + 30 + len).toString('utf8'), data = buf.subarray(p + 30 + len + extra, p + 30 + len + extra + size);
    if (n === name) return method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 30 + len + extra + size;
  }
  return null;
}

/** the hidden checker of a task */
export function judge(task, { final, ever, ctx, downloads }) {
  try { return !!new Function('final', 'ever', 'ctx', 'downloads', `return (${task.check});`)(final, ever, ctx, downloads); } catch (e) { return false; }
}

const fill = (s, ctx) => String(s).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] ?? m));

/** opens a fresh browser context for a task (fresh device data, fresh document), runs its hidden setup, takes step 0 */
export async function beginTask(browser, S, index, old = null) {
  const task = TASKS.find((t) => t.id === S.tasks[index]), persona = PERSONAS[S.persona];
  await old?.close().catch(() => {});
  rmSync(join(S.userdata, S.project), { recursive: true, force: true });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...persona.viewport, deviceScaleFactor: 1, isMobile: persona.touch && persona.viewport.width < 760, hasTouch: persona.touch });
  // tests run without the service worker (the current build is always used)
  await page.evaluateOnNewDocument(() => { try { if (!localStorage.getItem('home-simulator.pwa')) localStorage.setItem('home-simulator.pwa', 'off'); } catch { /* no storage */ } });
  const dl = join(S.dir, 'downloads', task.id);
  mkdirSync(dl, { recursive: true });
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: context.id }).catch(() => {});
  const ctx = { ...S.facts, lang: persona.lang };
  const q = new URLSearchParams({ project: S.project, lang: persona.lang, date: FIXED.date, time: FIXED.time, quality: FIXED.quality });
  if (index > 0) q.set('onboarding', 'off');                           // the welcome screen is seen at the start of the session
  for (const st of task.setup) if (st.query) for (const [k, v] of Object.entries(st.query)) q.set(k, fill(v, ctx));
  await page.goto(`${S.url}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__home?.state?.().loaded, { timeout: 90000 });
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__home3d?.shell?.().status), { timeout: 60000 }).catch(() => {});
  await settle(page, 1200);
  for (const st of task.setup) {
    if (st.eval) Object.assign(ctx, await page.evaluate(`(() => { const ctx = ${JSON.stringify(ctx)}; return ${st.eval}; })()`) ?? {});
    if (st.key) { await page.keyboard.press(st.key); await sleep(400); }
  }
  await settle(page, 600);
  const state = { index, task: task.id, step: 0, actions: 0, ctx };
  Object.assign(S, state);
  writeJson(sessionFile(S.dir), S);
  const shot = await screenshot(page, S);
  const snap = await snapshot(page, ctx);
  writeJson(hidden(S.dir, `${task.id}.ever.json`), [snap]);
  logHidden(S.dir, { task: task.id, kind: 'start', ctx, state: snap, text: await visibleText(page) });
  return { task, shot, page, context };
}

export async function screenshot(page, S) {
  const f = join(S.dir, `${S.task}-step-${S.step}.png`);
  await page.screenshot({ path: f });
  return f;
}
