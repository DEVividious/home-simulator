// E2E — the generated shell from the core's manifold solids (ADR 0024, 0026), on BOTH example projects: the views (start, from
// above, the level section of every level, a room) draw the level solids, at most 3 meshes per level and per roof (solid, frames,
// panes); a roof (ADR 0027) shows from outside and is hidden in the sections and the room; the budget holds — the WASM file
// ≤ 1 MB, served as application/wasm, ≤ 60k triangles, a rebuild leaves no main-thread task over 50 ms, the geometries take
// < 50 ms on the main thread; the electrical plan draws the wall mass from the section of the solids. When the kernel cannot
// load (the WASM blocked) there is no shell: only the room finishes in the scene, a message with the cause, the plan draws the
// level footprint.
// Usage: node scripts/verify/verify_shell.mjs [--no-build] [--only demo-apartment,sample-house]
//        HOME_SIM_BROWSER=auto|gpu|swiftshader. Output: reports/e2e/shell/ (screenshots of the views, shell.json).
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, ROOT, sleep, startServer, waitForApp } from './browser.mjs';

const NAME = 'shell', PORT = 4306;
const OUT = resolve(ROOT, 'reports/e2e', NAME);
const UD = mkdtempSync(join(tmpdir(), 'home-sim-e2e-shell-'));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = (arg('only', '') ?? '').split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(resolve(OUT, f), { recursive: true, force: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).replace(/\s+/g, ' ').slice(0, 400)}`); };
const pkg = (id) => JSON.parse(readFileSync(resolve(ROOT, 'projects', id, 'project.json'), 'utf8'));
const EN = Object.assign({}, ...readdirSync(resolve(ROOT, 'src/i18n/en')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(ROOT, 'src/i18n/en', f), 'utf8'))));

if (!process.argv.includes('--no-build')) execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
const server = await startServer({ port: PORT, mode: 'preview', userdata: UD });
const BASE = server.url;
const { browser, renderer, profile } = await launch({ viewport: { width: 1400, height: 900 } });
console.log(`[browser] ${profile} — ${renderer}`);
const page = await browser.newPage();
const errors = [], wasm = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warn' && /shell/i.test(m.text())) && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('response', async (r) => { if (/\.wasm$/.test(new URL(r.url()).pathname)) wasm.push({ url: new URL(r.url()).pathname, status: r.status(), type: r.headers()['content-type'], bytes: Number(r.headers()['content-length'] ?? (await r.buffer().catch(() => Buffer.alloc(0))).length) }); });
// long main-thread tasks, collected from the start of every document
await page.evaluateOnNewDocument(() => {
  window.__longTasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask API */ }
});

const frames = (n = 3) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function still(timeout = 8000) {
  const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < timeout) {
    const c = await page.evaluate(() => window.__home3d?.camera?.() ?? null);
    const cur = JSON.stringify(c && [c.position, c.dir, c.zoom]);
    if (c && cur === prev && Math.abs(c.aspect - c.canvasAspect) < 3e-3) return;
    prev = cur; await frames(3); await sleep(60);
  }
}
const shellState = () => page.evaluate(() => window.__home3d.shell());
async function open(id, extra = '') {
  await page.goto(`${BASE}/?onboarding=off&project=${id}&date=2026-06-21&time=12:00&lang=en${extra}`, { waitUntil: 'load' });
  await waitForApp(page);
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__home3d?.shell?.().status), { timeout: 60000 });
  await sleep(800); await still();
}
const uiSet = async (patch) => { await page.evaluate((p) => window.__home.ui(p), patch); await sleep(1200); await still(); };
const click = async (testid) => { const el = await page.$(`[data-testid="${testid}"]`); await el.click(); await sleep(900); await still(); };
/** a rendered frame of the canvas: PNG, the draw calls of a fresh frame and the visible level solids */
async function capture(file) {
  await page.evaluate(() => window.__home3d.invalidate()); await frames(4); await sleep(250);
  const calls = await page.evaluate(() => window.__home3d.renderInfo().frame.calls);
  const solids = await page.evaluate(() => { const out = []; window.__homeScene.traverse((o) => { if (/^SOLID_/.test(o.name)) { let v = true; for (let q = o; q; q = q.parent) v = v && q.visible; if (v) out.push(o.name); } }); return out; });
  // a roof solid shown in this view (visible with its parents)
  const roof = await page.evaluate(() => { let on = false; window.__homeScene.traverse((o) => { if (/^ROOF_SOLID_/.test(o.name)) { let v = true; for (let q = o; q; q = q.parent) v = v && q.visible; on ||= v; } }); return on; });
  const box = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  await page.screenshot({ path: resolve(OUT, file), clip: box });
  return { calls, roof, solids };
}

/** the views: start, from above, the section of every level, the largest room of the start level */
async function views(F) {
  await open(F.id);
  const out = {}, state = await shellState();
  out.start = await capture(`${F.id}_start.png`);
  await click('view-above');
  out.top = await capture(`${F.id}_top.png`);
  for (const l of F.levels) {
    await uiSet({ section: 'arrange', houseView: 'interior', roomId: null, level: l });
    out[`section-${l}`] = await capture(`${F.id}_section-${l}.png`);
  }
  await uiSet({ section: 'arrange', houseView: 'interior', level: F.room.level, roomId: F.room.id });
  out.room = await capture(`${F.id}_room.png`);
  await uiSet({ roomId: null, section: 'look', houseView: 'exterior' });
  return { views: out, state };
}

/** the meshes of the generated shell in the scene */
const houseMeshes = () => page.evaluate(() => { const h = window.__homeScene.getObjectByName('HOUSE'); let n = 0; h?.traverse((o) => { if (o.isMesh) n++; }); return h ? n : null; });
/** the electrical plan of the start level (advanced mode, the Electrical step, opened fresh): where its wall mass comes from, its
 *  polygons; `want` — the source to wait for */
async function elPlan(id, want) {
  await page.goto(`${BASE}/?onboarding=off&project=${id}&mode=advanced&lang=en&env=off`, { waitUntil: 'load' });
  await waitForApp(page);
  const step = await page.waitForSelector('[data-testid="step-electrical"]', { timeout: 15000 }).catch(() => null);
  if (!step) return null;
  await step.click(); await sleep(1500);
  await page.waitForFunction((w) => document.querySelector('[data-testid="el-plan-svg"]')?.dataset.walls === w, { timeout: 30000 }, want).catch(() => {});
  const r = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="el-plan-svg"]');
    if (!svg) return null;
    const polys = [...svg.querySelectorAll('polygon')];
    return { walls: svg.dataset.walls, view: svg.dataset.view, mass: polys.filter((p) => p.getAttribute('fill') === '#7d838c').length, white: polys.filter((p) => p.getAttribute('fill') === '#ffffff' && p.getAttribute('stroke') === 'none').length };
  });
  await page.evaluate(() => window.__home.ui({ mode: 'simple' })); await sleep(300);   // the mode is remembered on the device
  return r;
}

const facts = (id) => {
  const p = pkg(id), lv0 = p.manifest.defaultView.levelId;
  return { id, levels: p.manifest.levels.map((l) => l.id), room: p.building.rooms.rooms.filter((r) => r.level === lv0).sort((a, b) => b.area - a.area)[0] };
};

let firstWasm = null;
try {
  for (const F of ['demo-apartment', 'sample-house'].filter((id) => !ONLY.length || ONLY.includes(id)).map(facts)) {
    const tag = F.id;
    wasm.length = 0;
    const core = await views(F);
    check(`[${tag}] the core shell is built in the worker`, core.state.kind === 'core' && core.state.status === 'ready' && !core.state.error, JSON.stringify(core.state));
    const w = wasm.find((x) => x.status === 200) ?? firstWasm;
    firstWasm ??= w;
    check(`[${tag}] the solid kernel: one WASM file ≤ 1 MB, served as application/wasm (or revalidated from the cache)`, wasm.length >= 1 && !!w && w.type === 'application/wasm' && w.bytes > 0 && w.bytes <= 1024 * 1024,
      wasm.map((x) => `${x.url} ${x.status} ${x.type ?? ''} ${(x.bytes / 1024).toFixed(0)} kB`).join(' · '));
    check(`[${tag}] budget: ≤ 60k triangles in the level solids, < 50 ms on the main thread for the geometries`, core.state.triangles > 0 && core.state.triangles <= 60000 && core.state.mainMs < 50,
      `${core.state.triangles} triangles; worker ${core.state.ms} ms (kernel load ${core.state.loadMs} ms); main thread ${core.state.mainMs} ms`);
    const roofs = core.state.roofs ?? 0, outside = (k) => k === 'start' || k === 'top', meshes = await houseMeshes();
    check(`[${tag}] at most 3 meshes per level (${F.levels.length}) and per roof (${roofs}): the solid, the window frames, the panes`, meshes > 0 && meshes <= 3 * (F.levels.length + roofs),
      `${meshes} meshes; draw calls ${Object.keys(core.views).map((k) => `${k} ${core.views[k].calls}`).join(' · ')}`);
    for (const k of Object.keys(core.views)) {
      const v = core.views[k], level = k.startsWith('section-') ? k.slice(8) : null;
      check(`[${tag}] view "${k}": the level solids are drawn${roofs ? (outside(k) ? ', the roof shown' : ', the roof hidden') : ''}`,
        v.solids.length > 0 && (!level || v.solids.includes(`SOLID_${level}`)) && (!roofs || v.roof === outside(k)), `solids ${v.solids.join(', ')}; roof visible ${v.roof}; ${v.calls} draw calls`);
    }
    // a rebuild after the app is idle: the whole path (worker, transfer, geometries, first frame) without a long main-thread task
    const before = await page.evaluate(() => { const n = window.__longTasks.length; window.__home3d.shell(true); return n; });
    await page.waitForFunction(() => window.__home3d.shell().status === 'ready', { timeout: 30000 });
    await frames(6); await sleep(600);
    const long = await page.evaluate((n) => window.__longTasks.slice(n), before), worst = Math.max(0, ...long.map((t) => t.ms));
    check(`[${tag}] a shell rebuild leaves no main-thread task over 50 ms`, worst <= 50, `${long.length} long task(s), longest ${worst.toFixed(0)} ms; ${JSON.stringify(await shellState())}`);
    const plan = await elPlan(F.id, 'section');
    check(`[${tag}] the electrical plan draws the wall mass from the section of the level solid (the rooms as holes in it)`, plan?.walls === 'section' && plan.mass >= 1 && plan.white >= 2, JSON.stringify(plan));
  }

  // the kernel cannot load: no shell, a message with the cause, the plan draws the level footprint
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  const block = (r) => (/\.wasm$/.test(new URL(r.url()).pathname) ? r.abort() : r.continue());
  page.on('request', block);
  const seen = errors.length;
  await open('demo-apartment');
  const fb = await shellState(), meshes = await houseMeshes();
  const msg = await page.$eval('[data-testid="toast"]', (e) => e.textContent).catch(() => null), lead = EN['scene.wallsFailed'].split('{error}')[0];
  await page.screenshot({ path: resolve(OUT, 'kernel-failed.png') });
  const warned = errors.slice(seen).some((e) => /solid kernel failed/.test(e));
  check('WASM unavailable: no shell in the scene (the room finishes stay), the status and a message carry the cause, a warning in the console',
    fb.kind === 'core' && fb.status === 'error' && !!fb.error && meshes === null && !!msg?.startsWith(lead) && msg.includes(fb.error) && warned, `${JSON.stringify(fb)}; house meshes ${meshes}; message "${msg}"`);
  errors.splice(seen);
  const plan = await elPlan('demo-apartment', 'footprint');
  check('WASM unavailable: the electrical plan draws the level footprint as the wall mass', plan?.walls === 'footprint' && plan.mass === 1, JSON.stringify(plan));
  errors.splice(seen);
  page.off('request', block);
  await page.setRequestInterception(false);

  check('no console errors / page exceptions', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
} catch (e) {
  check('scenario completed', false, String(e?.stack ?? e).slice(0, 600));
} finally {
  await browser.close().catch(() => {});
  server.stop();
  rmSync(UD, { recursive: true, force: true });
  const fail = results.filter((r) => r.status === 'FAIL').length;
  writeFileSync(resolve(OUT, `${NAME}.json`), JSON.stringify({ at: new Date().toISOString(), renderer, profile, pass: results.length - fail, fail, results }, null, 1));
  console.log(`\n${results.length - fail} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
