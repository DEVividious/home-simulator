// E2E — the building features beyond the two examples, on the synthetic plan fixtures of the core
// (packages/core/tests/fixtures/<id>.plan.json, compiled into temporary projects projects/e2e-<id>/, removed in `finally`):
//   • straight and L-shaped stairs: the stairs are in the scene, the walk goes up them from the ground floor to the upper
//     level (the level follows), and Download › Print model gives the STL of `npm run project:print` with the stairs in it;
//   • exits in the walk (usability issue B8): a sign over the front door, a click on it opens the door and walks out.
// Usage: node scripts/verify/verify_features.mjs [--no-build] [--only stairs-straight,stairs-l]
//        HOME_SIM_BROWSER=auto|gpu|swiftshader. Output: reports/e2e/features/ (screenshots, features.json).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { launch, ROOT, sleep, startServer, waitForApp } from './browser.mjs';
import { S } from './selectors.mjs';
import { zipFile, zipNames } from '../usability/lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NAME = 'features', PORT = 4309, OUT = resolve(ROOT, 'reports/e2e', NAME);
const UD = mkdtempSync(join(tmpdir(), `home-sim-e2e-${NAME}-`));
const ONLY = (arg('only', '') ?? '').split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(resolve(OUT, f), { recursive: true, force: true });
const EN = Object.assign({}, ...readdirSync(resolve(ROOT, 'src/i18n/en')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(ROOT, 'src/i18n/en', f), 'utf8'))));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).replace(/\s+/g, ' ').slice(0, 400)}`); };

// ------------------------------------------------------------------ temporary projects from the fixtures
const FIXTURES = ['stairs-straight', 'stairs-l'].filter((f) => !ONLY.length || ONLY.includes(f));
const installed = [];
function install(fixture) {
  const id = `e2e-${fixture}`, dir = resolve(ROOT, 'projects', id);
  const r = compilePlan(JSON.parse(readFileSync(resolve(ROOT, 'packages/core/tests/fixtures', `${fixture}.plan.json`), 'utf8')), { catalog: null });
  if (!r.project) throw new Error(`${fixture}: ${JSON.stringify(r.issues)}`);
  r.project.manifest.projectId = id;
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'project.json'), JSON.stringify(r.project, null, 1));
  installed.push(dir);
  return { id, dir, p: r.project };
}

if (!process.argv.includes('--no-build')) execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
const server = await startServer({ port: PORT, mode: 'preview', userdata: UD });
const BASE = server.url;
const { browser, renderer, profile } = await launch({ viewport: { width: 1400, height: 900 } });
console.log(`[browser] ${profile} — ${renderer}`);
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });

const T = (id) => `[data-testid="${id}"]`;
const st = () => page.evaluate(() => window.__home.state());
const s3 = (fn, ...a) => page.evaluate((fn, a) => window.__home3d[fn](...a), fn, a);
const text = (s) => page.$eval(s, (e) => e.textContent.trim()).catch(() => null);
const shot = (n) => page.screenshot({ path: resolve(OUT, `${n}.png`) }).catch(() => {});
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const click = async (s, wait = 400) => { const el = await page.$(s); if (!el) throw new Error(`no element ${s}`); await el.click(); await sleep(wait); };
const waitFor = async (fn, ms = 15000, step = 150) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } };
const ready = async () => { await waitForApp(page); await page.waitForFunction(() => !!window.__home3d?.camera?.() && !!window.__homeScene && ['ready', 'error'].includes(window.__home3d.shell?.().status), { timeout: 60000 }); };
const onCanvas = (p) => page.evaluate((p) => !!p && document.elementFromPoint(p[0], p[1])?.tagName === 'CANVAS', p);
async function clickAt(p, wait = 600) { await page.mouse.move(p[0] - 3, p[1]); await sleep(60); await page.mouse.move(p[0], p[1]); await sleep(80); await page.mouse.click(p[0], p[1]); await sleep(wait); }
const obj = (name) => page.evaluate((name) => { const o = window.__homeScene.getObjectByName(name); if (!o) return null; let tris = 0; o.traverse((m) => { if (m.isMesh) { const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return { tris }; }, name);
async function stage(name, fn) {
  try { await fn(); } catch (e) { check(`${name}: completed`, false, String(e?.stack ?? e).slice(0, 500)); await shot(`error_${name.replace(/[^a-z0-9]+/gi, '_')}`); }
}
/** walking: to a pose (walkGo), keys held until a condition in the page holds */
const goTo = async (p, z, yaw, pitch = -0.15) => {
  await page.evaluate((go) => window.__home.ui({ walkGo: go }), { pose: { p, z, yaw, pitch }, n: Date.now() });
  return waitFor(async () => { const w = await s3('walk'); return w.on && Math.hypot(w.p[0] - p[0], w.p[1] - p[1]) < 0.3 && Math.abs(w.z - z) < 0.05 ? w : null; }, 15000);
};
const hold = async (k, cond, ms = 25000) => { await page.keyboard.down(k); const ok = await page.waitForFunction(cond, { timeout: ms, polling: 100 }).then(() => true).catch(() => false); await page.keyboard.up(k); await sleep(300); return ok; };

/** a walk from the foot of the stairs to the upper level: [start point, yaw, legs of [key, condition]] per stair kind */
function climbOf(s) {
  const [x0, y0, x1, y1] = s.bbox, top = s.topZ;
  const upper = `Math.abs(window.__home3d.walk().z - ${top}) < 0.01`;
  if (s.kind === 'straight') {
    // up east: from 0.6 m west of the box, facing +X
    return { start: [x0 - 0.6, (y0 + y1) / 2], yaw: -Math.PI / 2, legs: [['KeyW', `${upper} && window.__home3d.walk().p[0] > ${x1 + 0.3}`]] };
  }
  // l-turn up north along the east side, turning left: up the lower flight to the landing, then left (−X) up the upper flight
  return { start: [x1 - 0.45, y0 - 0.6], yaw: 0, legs: [['KeyW', `Math.abs(window.__home3d.walk().z - ${s.landingZ}) < 0.01 && window.__home3d.walk().p[1] > ${y1 - 0.75}`], ['KeyA', `${upper} && window.__home3d.walk().p[0] < ${x0 - 0.3}`]] };
}

try {
  for (const fixture of FIXTURES) {
    const F = install(fixture), tag = fixture, s = F.p.building.stairs[0], [lo, hi] = F.p.manifest.levels.map((l) => l.id);
    // ---------------------------------------------------------------- load
    await stage(`[${tag}] load`, async () => {
      await page.goto(`${BASE}/?onboarding=off&lang=en&project=${F.id}`, { waitUntil: 'load' });
      await ready(); await sleep(1200);
      const pr = await page.evaluate(() => window.__home.project()), sh = await s3('shell'), stairs = await obj('HOME_STAIRS');
      await shot(`${tag}_01_start`);
      check(`[${tag}] the package loads, the generated shell is built and the ${s.kind} stairs are in the scene`, pr.id === F.id && sh.status === 'ready' && sh.kind !== 'grid' && (stairs?.tris ?? 0) > 50, `shell ${sh.status} (${sh.kind}); stairs ${stairs?.tris} triangles`);
    });

    // ---------------------------------------------------------------- walk up the stairs
    await stage(`[${tag}] walk up`, async () => {
      await click(S.view('walk'), 2500);
      await waitFor(async () => { const w = await s3('walk'); return w.on && w.place ? w : null; }, 20000);
      const c = climbOf(s), w0 = await goTo(c.start, 0, c.yaw);
      await shot(`${tag}_02_foot`);
      const ok = [];
      for (const [k, cond] of c.legs) ok.push(await hold(k, `(() => ${cond})()`));
      const w1 = await s3('walk'), state = await st();
      await shot(`${tag}_03_top`);
      check(`[${tag}] walk up the ${s.kind} stairs with the keys (${c.legs.map(([k]) => k.slice(3)).join(' then ')}): from the ${lo} floor (0) to the ${hi} floor (+${s.topZ}); the level follows`,
        !!w0 && ok.every(Boolean) && near(w1.z, s.topZ, 0.01) && state.level === hi && w1.kind === 'room', `legs ${ok.join(',')}; z ${w1.z} "${w1.place}" level ${state.level}`);
      // and down again: the same legs backwards, facing the same way (W ↔ S, A ↔ D)
      await page.evaluate((y) => { const w = window.__home3d.walk(); window.__home.ui({ walkGo: { pose: { p: w.p, z: w.z, yaw: y, pitch: -0.2 }, n: Date.now() } }); }, c.yaw);
      await sleep(600);
      const opposite = { KeyW: 'KeyS', KeyS: 'KeyW', KeyA: 'KeyD', KeyD: 'KeyA' }, downOk = [];
      for (let i = c.legs.length - 1; i >= 0; i--) downOk.push(await hold(opposite[c.legs[i][0]], `window.__home3d.walk().z < ${i ? s.landingZ + 0.01 : 0.01}`));
      const w2 = await s3('walk');
      check(`[${tag}] and back down to the ${lo} floor`, downOk.every(Boolean) && w2.z < 0.01 && (await st()).level === lo, `z ${w2.z} "${w2.place}"`);
    });

    // ---------------------------------------------------------------- exits (usability issue B8)
    await stage(`[${tag}] exit sign`, async () => {
      const D = F.p.building.doors.find((d) => d.rooms.includes('exterior')), mid = [(D.opening.faces[0] + D.opening.faces[1]) / 2, (D.opening.from + D.opening.to) / 2];
      // the front door (closed) is in the west wall: stand 3.6 m inside it, facing it (−X), looking a little down
      await goTo([mid[0] + 3.6, mid[1]], 0, Math.PI / 2, -0.3);
      await sleep(800);
      const ex = await s3('exits'), sign = ex.find((e) => e.id === D.id);
      await shot(`${tag}_04_exit_sign`);
      check(`[${tag}] walk: the front door ${D.id} has an exit sign "${EN['walk.exit']}" and a floor arrow, both in view from inside`, !!sign && sign.shown && sign.kind === 'door' && (await onCanvas(sign.sign)) && (await onCanvas(sign.arrow)), JSON.stringify(sign));
      if (sign) await clickAt(sign.sign, 300);
      const out = await page.waitForFunction(() => window.__home3d.walk().kind === 'site', { timeout: 20000, polling: 100 }).then(() => true).catch(() => false);
      const w = await s3('walk'), opened = (await s3('doors')).open[D.id] ?? 0;
      await shot(`${tag}_05_outside`);
      check(`[${tag}] a click on the exit sign opens the door and walks out onto the site`, out && opened > 0.5 && w.p[0] < D.opening.faces[0], `kind ${w.kind} at ${w.p.map((v) => v.toFixed(2))}, door open ${opened}`);
    });

    // ---------------------------------------------------------------- Download › Print model
    await stage(`[${tag}] print`, async () => {
      await page.goto(`${BASE}/?onboarding=off&lang=en&project=${F.id}`, { waitUntil: 'load' });
      await ready(); await sleep(800);
      const dl = mkdtempSync(join(tmpdir(), 'home-sim-e2e-dl-features-')), cli = mkdtempSync(join(tmpdir(), 'home-sim-e2e-print-features-'));
      try {
        const cdp = await page.createCDPSession();
        await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
        await click(S.download, 300); await click(S.downloadPrint, 300);
        const zip = await waitFor(async () => readdirSync(dl).find((f) => f.endsWith('.zip')), 120000, 500);
        await sleep(500);
        execSync(`node scripts/project/print.mjs ${JSON.stringify(F.dir)} --bed 220x220x250 --out ${JSON.stringify(cli)}`, { cwd: ROOT, stdio: 'ignore' });
        const buf = zip ? readFileSync(join(dl, zip)) : Buffer.alloc(0), names = zip ? zipNames(buf) : [];
        const stl = names.filter((n) => n.endsWith('.stl')), cliStl = readdirSync(cli).filter((f) => f.endsWith('.stl')).sort();
        const same = stl.length > 0 && stl.slice().sort().join() === cliStl.join() && stl.every((n) => zipFile(buf, n).equals(readFileSync(join(cli, n))));
        const report = names.includes('print-report.json') ? JSON.parse(zipFile(buf, 'print-report.json').toString('utf8')) : null;
        const notes = (report?.notes ?? []).map((n) => n.code);
        check(`[${tag}] Download › Print model: the STL parts are the bytes of npm run project:print, the stairs are printed (the steps in the upper slab go with ${hi}'s part)`,
          same && stl.length === 3 && notes.includes('stairs.split'), `${zip}: ${stl.join(', ')}; same bytes ${same}; notes ${notes.join(', ')}`);
      } finally { rmSync(dl, { recursive: true, force: true }); rmSync(cli, { recursive: true, force: true }); }
    });
  }
  check('no console errors / page exceptions', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
} catch (e) {
  check('scenario completed', false, String(e?.stack ?? e).slice(0, 600));
  await shot('error');
} finally {
  for (const d of installed) rmSync(d, { recursive: true, force: true });
  check('the temporary projects are removed again', installed.every((d) => !existsSync(d)), installed.join(', '));
  await browser.close().catch(() => {});
  server.stop();
  rmSync(UD, { recursive: true, force: true });
  const fail = results.filter((r) => r.status === 'FAIL').length;
  writeFileSync(resolve(OUT, `${NAME}.json`), JSON.stringify({ at: new Date().toISOString(), renderer, profile, pass: results.length - fail, fail, results }, null, 1));
  console.log(`\n${results.length - fail} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
