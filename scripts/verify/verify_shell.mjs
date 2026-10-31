// E2E — the generated shell from the core's manifold solids against the grid shell it replaces (ADR 0024, 0026), on BOTH example
// projects: the same views (start, from above, the level section of every level, a room) render alike (≤ 1 % of the canvas
// pixels differ), the core shell adds at most 2 draw calls per level (and 4 per roof), and its budget holds — the WASM file ≤ 1 MB,
// served as application/wasm and fetched only for packages without a model file, ≤ 60k triangles, a rebuild leaves no main-thread
// task over 50 ms, the geometries take < 50 ms on the main thread. A kernel failure falls back to the grid shell. A package with a
// roof (ADR 0027; the grid shell has none): the views from outside show the roof (they differ from the grid shell by intent), the
// sections and the room are compared as above — the roof is hidden there.
// Usage: node scripts/verify/verify_shell.mjs [--no-build] [--only demo-apartment,sample-house]
//        HOME_SIM_BROWSER=auto|gpu|swiftshader. Output: reports/e2e/shell/ (screenshots of both shells and their difference, shell.json).
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

/** a pixel differs when a channel differs by more than this; a view passes when at most MAX_DIFF of its pixels differ */
const PIXEL_TOL = 32, MAX_DIFF = 0.01;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).replace(/\s+/g, ' ').slice(0, 400)}`); };
const pkg = (id) => JSON.parse(readFileSync(resolve(ROOT, 'projects', id, 'project.json'), 'utf8'));

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
async function open(id, shell) {
  await page.goto(`${BASE}/?onboarding=off&project=${id}&date=2026-06-21&time=12:00${shell === 'grid' ? '&shell=grid' : ''}`, { waitUntil: 'load' });
  await waitForApp(page);
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__home3d?.shell?.().status), { timeout: 60000 });
  await sleep(800); await still();
}
const uiSet = async (patch) => { await page.evaluate((p) => window.__home.ui(p), patch); await sleep(1200); await still(); };
const click = async (testid) => { const el = await page.$(`[data-testid="${testid}"]`); await el.click(); await sleep(900); await still(); };
/** a rendered frame of the canvas: PNG and the draw calls of a fresh frame */
async function capture(file) {
  await page.evaluate(() => window.__home3d.invalidate()); await frames(4); await sleep(250);
  const calls = await page.evaluate(() => window.__home3d.renderInfo().frame.calls);
  // a roof solid shown in this view (visible with its parents)
  const roof = await page.evaluate(() => { let on = false; window.__homeScene.traverse((o) => { if (/^ROOF_SOLID_/.test(o.name)) { let v = true; for (let q = o; q; q = q.parent) v = v && q.visible; on ||= v; } }); return on; });
  const box = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  const png = await page.screenshot({ path: resolve(OUT, file), clip: box });
  return { png, calls, roof };
}

/** the same views in one shell: start, from above, the section of every level, the largest room of the start level */
async function views(F, shell) {
  await open(F.id, shell);
  const out = {}, state = await shellState();
  out.start = await capture(`${F.id}_start_${shell}.png`);
  await click('view-above');
  out.top = await capture(`${F.id}_top_${shell}.png`);
  for (const l of F.levels) {
    await uiSet({ section: 'arrange', houseView: 'interior', roomId: null, level: l });
    out[`section-${l}`] = await capture(`${F.id}_section-${l}_${shell}.png`);
  }
  await uiSet({ section: 'arrange', houseView: 'interior', level: F.room.level, roomId: F.room.id });
  out.room = await capture(`${F.id}_room_${shell}.png`);
  await uiSet({ roomId: null, section: 'look', houseView: 'exterior' });
  return { views: out, state };
}

/** share of pixels that differ between two PNGs of the same size (decoded in the page — no image library in Node) and a difference image */
async function diff(a, b, file) {
  const r = await page.evaluate(async (a, b, tol) => {
    const img = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const [ia, ib] = await Promise.all([img(a), img(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { share: 1, size: `${ia.width}×${ia.height} vs ${ib.width}×${ib.height}` };
    const px = (i) => { const c = new OffscreenCanvas(i.width, i.height), x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height); };
    const da = px(ia), db = px(ib), out = new OffscreenCanvas(ia.width, ia.height), ox = out.getContext('2d'), od = ox.createImageData(ia.width, ia.height);
    let n = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
      const hit = d > tol; if (hit) n++;
      od.data[i] = hit ? 255 : da.data[i] * 0.3 + 170; od.data[i + 1] = hit ? 0 : da.data[i + 1] * 0.3 + 170; od.data[i + 2] = hit ? 0 : da.data[i + 2] * 0.3 + 170; od.data[i + 3] = 255;
    }
    ox.putImageData(od, 0, 0);
    const blob = await out.convertToBlob({ type: 'image/png' }), buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { share: n / (da.data.length / 4), image: btoa(s) };
  }, a.toString('base64'), b.toString('base64'), PIXEL_TOL);
  if (r.image) writeFileSync(resolve(OUT, file), Buffer.from(r.image, 'base64'));
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
    const grid = await views(F, 'grid');
    const gridWasm = wasm.length;
    const core = await views(F, 'core');
    check(`[${tag}] ?shell=grid shows the grid shell and fetches no WASM; by default the core shell is built in the worker`,
      grid.state.kind === 'grid' && grid.state.status === 'ready' && gridWasm === 0 && core.state.kind === 'core' && core.state.status === 'ready' && !core.state.error,
      `grid: ${JSON.stringify(grid.state)} (${gridWasm} wasm); core: ${JSON.stringify(core.state)}`);
    const w = wasm.find((x) => x.status === 200) ?? firstWasm;
    firstWasm ??= w;
    check(`[${tag}] the solid kernel: one WASM file ≤ 1 MB, served as application/wasm (or revalidated from the cache)`, wasm.length >= 1 && !!w && w.type === 'application/wasm' && w.bytes > 0 && w.bytes <= 1024 * 1024,
      wasm.map((x) => `${x.url} ${x.status} ${x.type ?? ''} ${(x.bytes / 1024).toFixed(0)} kB`).join(' · '));
    check(`[${tag}] budget: ≤ 60k triangles in the level solids, < 50 ms on the main thread for the geometries`, core.state.triangles > 0 && core.state.triangles <= 60000 && core.state.mainMs < 50,
      `${core.state.triangles} triangles; worker ${core.state.ms} ms (kernel load ${core.state.loadMs} ms); main thread ${core.state.mainMs} ms`);
    const roofs = core.state.roofs ?? 0, outside = (k) => k === 'start' || k === 'top';
    const extra = Object.keys(core.views).map((k) => core.views[k].calls - grid.views[k].calls - (outside(k) ? 4 * roofs : 0));
    check(`[${tag}] draw calls: the core shell adds at most 2 per level (${F.levels.length} level(s)) and 4 per roof (${roofs}) in every view`, extra.every((d) => d <= 2 * F.levels.length),
      Object.keys(core.views).map((k) => `${k}: ${grid.views[k].calls} → ${core.views[k].calls}`).join(' · '));
    for (const k of Object.keys(core.views)) {
      const d = await diff(grid.views[k].png, core.views[k].png, `${tag}_${k}_diff.png`);
      if (roofs && outside(k)) check(`[${tag}] view "${k}": the roof is drawn (the picture differs from the flat-topped grid shell)`, d.share > 0.02 && core.views[k].roof, `${(d.share * 100).toFixed(3)} % differ; roof visible ${core.views[k].roof}`);
      else check(`[${tag}] view "${k}": the core shell renders like the grid shell (≤ ${MAX_DIFF * 100} % of the pixels differ)${roofs ? ' — the roof hidden' : ''}`, d.share <= MAX_DIFF && !core.views[k].roof, `${(d.share * 100).toFixed(3)} % differ${d.size ? ` (${d.size})` : ''}; roof visible ${core.views[k].roof}`);
    }
    // a rebuild after the app is idle: the whole path (worker, transfer, geometries, first frame) without a long main-thread task
    const before = await page.evaluate(() => { const n = window.__longTasks.length; window.__home3d.shell(true); return n; });
    await page.waitForFunction(() => window.__home3d.shell().status === 'ready', { timeout: 30000 });
    await frames(6); await sleep(600);
    const long = await page.evaluate((n) => window.__longTasks.slice(n), before), worst = Math.max(0, ...long.map((t) => t.ms));
    check(`[${tag}] a shell rebuild leaves no main-thread task over 50 ms`, worst <= 50, `${long.length} long task(s), longest ${worst.toFixed(0)} ms; ${JSON.stringify(await shellState())}`);
  }

  // the kernel cannot load: the grid shell is shown instead (one release of fallback)
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  const block = (r) => (/\.wasm$/.test(new URL(r.url()).pathname) ? r.abort() : r.continue());
  page.on('request', block);
  const seen = errors.length;
  await page.goto(`${BASE}/?onboarding=off&project=demo-apartment`, { waitUntil: 'load' });
  await waitForApp(page);
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__home3d?.shell?.().status) && window.__home3d.shell().kind !== 'core', { timeout: 60000 }).catch(() => {});
  await sleep(800);
  const fb = await shellState(), wall = await page.evaluate(() => !!window.__homeScene.getObjectByName('WALL_L1'));
  check('WASM unavailable: the grid shell is shown instead (fallback, a warning in the console)', fb.kind === 'grid' && fb.status === 'error' && wall && errors.slice(seen).some((e) => /grid shell/.test(e)), `${JSON.stringify(fb)}; grid walls ${wall}`);
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
