// E2E — the building features beyond the two examples, on the synthetic plan fixtures of the core
// (packages/core/tests/fixtures/<id>.plan.json, compiled into temporary projects projects/e2e-<id>/, removed in `finally`):
//   • straight and L-shaped stairs: the stairs are in the scene, the walk goes up them from the ground floor to the upper
//     level (the level follows), and Download › Print model gives the STL of `npm run project:print` with the stairs in it;
//   • exits in the walk (usability issue B8): a sign over the front door, a click on it opens the door and walks out;
//   • double and folding doors: a click on the double door in the walk opens both leaves about their own hinges, the bifold
//     folds, the double entrance door lets the walk out, and the print download works;
//   • walls at 45°: the shell is built with the slanted walls (no grid fallback for them), a click on the door in the slanted
//     partition opens it and the walk goes through into the room behind; the print download works;
//   • a flat-roofed wing and walls that bound no room: the screen wall with slats stands in the scene and stops the walk on the
//     site; the downloaded print has the wing's roof in the upper floor's part and the parts joined by registration tabs.
// Usage: node scripts/verify/verify_features.mjs [--no-build] [--only stairs-straight,stairs-l]
//        HOME_SIM_BROWSER=auto|gpu|swiftshader. Output: reports/e2e/features/ (screenshots, features.json).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { stairDrawing } from '@home-sim/core/model/stairs';
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
const FIXTURES = ['stairs-straight', 'stairs-l', 'doors', 'walls-45', 'roof-wing-flat'].filter((f) => !ONLY.length || ONLY.includes(f));
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
    // along the walking line (core stairDrawing): from 0.6 m before its foot, facing up, until 0.3 m past its top
    const d = stairDrawing(s), a = d.path[0], b = d.path[d.path.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const past = `((window.__home3d.walk().p[0] - ${b[0]}) * ${u[0]} + (window.__home3d.walk().p[1] - ${b[1]}) * ${u[1]}) > 0.25`;
    return { start: [a[0] - u[0] * 0.6, a[1] - u[1] * 0.6], yaw: Math.atan2(-u[0], u[1]), legs: [['KeyW', `${upper} && ${past}`]] };
  }
  // l-turn up north along the east side, turning left: up the lower flight to the landing, then left (−X) up the upper flight
  return { start: [x1 - 0.45, y0 - 0.6], yaw: 0, legs: [['KeyW', `Math.abs(window.__home3d.walk().z - ${s.landingZ}) < 0.01 && window.__home3d.walk().p[1] > ${y1 - 0.75}`], ['KeyA', `${upper} && window.__home3d.walk().p[0] < ${x0 - 0.3}`]] };
}

try {
  for (const fixture of FIXTURES) {
    const F = install(fixture), tag = fixture, s = F.p.building.stairs?.[0], [lo, hi] = F.p.manifest.levels.map((l) => l.id);
    // ---------------------------------------------------------------- load
    await stage(`[${tag}] load`, async () => {
      await page.goto(`${BASE}/?onboarding=off&lang=en&project=${F.id}`, { waitUntil: 'load' });
      await ready(); await sleep(1200);
      const pr = await page.evaluate(() => window.__home.project()), sh = await s3('shell'), stairs = await obj('HOME_STAIRS');
      await shot(`${tag}_01_start`);
      const front = F.p.building.doors.find((d) => d.rooms.includes('exterior')), leaf = front ? await obj(`DOOR_LEAF_${front.id}`) : null;
      check(`[${tag}] from outside the front door ${front?.id} is drawn (doors to the outside appear in the exterior view)`, !front || (leaf?.tris ?? 0) > 0, `${leaf?.tris} triangles`);
      check(`[${tag}] the package loads, the generated shell is built${s ? ` and the ${s.kind} stairs are in the scene` : ''}`, pr.id === F.id && sh.status === 'ready' && sh.kind !== 'grid' && (!s || (stairs?.tris ?? 0) > 50), `shell ${sh.status} (${sh.kind}); stairs ${stairs?.tris} triangles`);
    });

    // ---------------------------------------------------------------- walk up the stairs
    if (s) await stage(`[${tag}] walk up`, async () => {
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
      // on the landing: on to the line of the lower flight (its middle), then down it
      const onLine = `Math.abs(window.__home3d.walk().p[0] - ${c.start[0]}) < 0.3`;
      for (let i = c.legs.length - 1; i >= 0; i--) downOk.push(await hold(opposite[c.legs[i][0]], i ? `window.__home3d.walk().z < ${s.landingZ + 0.01} && ${onLine}` : 'window.__home3d.walk().z < 0.01'));
      const w2 = await s3('walk');
      check(`[${tag}] and back down to the ${lo} floor`, downOk.every(Boolean) && w2.z < 0.01 && (await st()).level === lo, `z ${w2.z} "${w2.place}"`);
    });

    // ---------------------------------------------------------------- double and folding doors
    if (F.p.building.doors.some((d) => d.type === 'hinged-double')) await stage(`[${tag}] door types`, async () => {
      if (!(await s3('walk')).on) { await click(S.view('walk'), 2500); await waitFor(async () => { const w = await s3('walk'); return w.on && w.place ? w : null; }, 20000); }
      const dbl = F.p.building.doors.find((d) => d.type === 'hinged-double' && !d.rooms.includes('exterior')), fold = F.p.building.doors.find((d) => d.type === 'folding');
      const mid = [(dbl.opening.from + dbl.opening.to) / 2, (dbl.opening.faces[0] + dbl.opening.faces[1]) / 2];
      // stand in the room the double door opens into, 2.4 m from it, facing it
      const stand = [mid[0] + dbl.openDir[0] * 2.4, mid[1] + dbl.openDir[1] * 2.4];
      await goTo(stand, 0, Math.atan2(-(mid[0] - stand[0]), mid[1] - stand[1]), -0.1);
      await sleep(700);
      const leaves = () => page.evaluate((id) => [`DOOR_LEAF_${id}`, `DOOR_LEAF_${id}_1`].map((n) => { const o = window.__homeScene.getObjectByName(n); if (!o) return null; o.updateMatrixWorld(true); const e = o.matrixWorld.elements; return { x: e[12], y: -e[14], ax: e[0], ay: -e[2] }; }), dbl.id);
      const before = await leaves();
      await shot(`${tag}_06_double_closed`);
      let q = null;
      for (const [h, al] of [[1.2, 0.5], [1.5, 0.4], [0.9, 0.6]]) { q = await s3('screenOfDoor', dbl.id, 0, h, al); if (await onCanvas(q)) break; q = null; }
      if (q) await clickAt(q, 200);
      const opened = await page.waitForFunction((id) => (window.__home3d.doors().motion[id] ?? 0) > 0.99, { timeout: 15000, polling: 100 }, dbl.id).then(() => true).catch(() => false);
      await sleep(300);
      const after = await leaves();
      await shot(`${tag}_07_double_open`);
      // both leaves: their origin (hinge) stays, their direction turns from along the wall to the opening direction
      const ok = before.every(Boolean) && after.every(Boolean) && before.every((b, i) => Math.hypot(b.x - after[i].x, b.y - after[i].y) < 1e-3 && Math.abs(b.ax * after[i].ax + b.ay * after[i].ay) < 0.05)
        && Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y) > dbl.leafWidth - 0.05;
      check(`[${tag}] walk: a click on the double door ${dbl.id} opens both leaves, each about its own hinge at a jamb`, !!q && opened && ok, JSON.stringify({ before, after }));
      // the bifold: opened from its card state, its second panel ends near the hinge, folded into a V
      await page.evaluate((id) => window.__home.doors.open(id, 1), fold.id);
      await page.waitForFunction((id) => (window.__home3d.doors().motion[id] ?? 0) > 0.99, { timeout: 15000, polling: 100 }, fold.id).catch(() => {});
      await sleep(300);
      const panels = await page.evaluate((id) => [`DOOR_LEAF_${id}`, `DOOR_LEAF_${id}_1`].map((n) => { const o = window.__homeScene.getObjectByName(n); if (!o) return null; o.updateMatrixWorld(true); const e = o.matrixWorld.elements; return { x: e[12], y: -e[14], ax: e[0], ay: -e[2] }; }), fold.id);
      const w = fold.leafWidth / 2, h = fold.hinge, end = panels[1] ? [panels[1].x + panels[1].ax * w, panels[1].y + panels[1].ay * w] : null;
      const fmid = [(fold.opening.from + fold.opening.to) / 2, (fold.opening.faces[0] + fold.opening.faces[1]) / 2], f2 = [fmid[0] + fold.openDir[0] * 2.4, fmid[1] + fold.openDir[1] * 2.4];
      await goTo(f2, 0, Math.atan2(-(fmid[0] - f2[0]), fmid[1] - f2[1]), -0.1); await sleep(700);
      await shot(`${tag}_08_bifold_open`);
      check(`[${tag}] the bifold ${fold.id} opened: two panels, the first about the hinge, the second from the fold back to the wall by the hinge`,
        panels.every(Boolean) && Math.hypot(panels[0].x - h[0], panels[0].y - h[1]) < 0.05 && !!end && Math.hypot(end[0] - h[0], end[1] - h[1]) < 0.3, JSON.stringify(panels));
      await page.evaluate((id) => window.__home.doors.open(id, 0), fold.id);
    });

    // ---------------------------------------------------------------- walls at 45°
    const slanted = F.p.building.doors.find((d) => d.opening.along === 'D');
    if (slanted) await stage(`[${tag}] slanted walls`, async () => {
      // from outside: the chamfered corner, and the walls of the level section
      await page.evaluate(() => window.__home.ui({ houseView: 'exterior' })); await sleep(1500);
      await shot(`${tag}_09_exterior`);
      const sh = await s3('shell');
      check(`[${tag}] the generated shell is built with the walls at 45° (the solid kernel, not the grid)`, sh.status === 'ready' && sh.kind === 'core', JSON.stringify(sh));
      if (!(await s3('walk')).on) { await click(S.view('walk'), 2500); await waitFor(async () => { const w = await s3('walk'); return w.on && w.place ? w : null; }, 20000); }
      // in the room the door does not open into, 2.2 m from the door, facing it across the slanted wall
      const o = slanted.opening, n = [-o.dir[1], o.dir[0]], t = (o.from + o.to) / 2, c = (o.faces[0] + o.faces[1]) / 2;
      const mid = [o.dir[0] * t + n[0] * c, o.dir[1] * t + n[1] * c], into = slanted.openDir, stand = [mid[0] - into[0] * 2.2, mid[1] - into[1] * 2.2];
      const yaw = Math.atan2(-into[0], into[1]);
      await goTo(stand, 0, yaw, -0.1); await sleep(700);
      await shot(`${tag}_10_slanted_door`);
      let q = null;
      for (const [h, al] of [[1.2, 0.5], [1.5, 0.4], [0.9, 0.6]]) { q = await s3('screenOfDoor', slanted.id, 0, h, al); if (await onCanvas(q)) break; q = null; }
      if (q) await clickAt(q, 200);
      const opened = await page.waitForFunction((id) => (window.__home3d.doors().motion[id] ?? 0) > 0.99, { timeout: 15000, polling: 100 }, slanted.id).then(() => true).catch(() => false);
      const behind = slanted.swingInto, through = await hold('KeyW', `window.__home3d.walk().roomId === ${JSON.stringify(behind)}`, 15000);
      await sleep(400);
      const w = await s3('walk');
      await shot(`${tag}_11_through`);
      check(`[${tag}] walk: a click on the door ${slanted.id} in the slanted wall opens it, and the walk goes through into ${behind}`, !!q && opened && through && w.roomId === behind, `${w.place} (${w.roomId})`);
    });

    // ---------------------------------------------------------------- walls that bound no room
    const screen = (F.p.building.walls ?? []).find((w) => w.openings.some((o) => o.infill));
    if (screen) await stage(`[${tag}] walls without a room`, async () => {
      if (!(await s3('walk')).on) { await click(S.view('walk'), 2500); await waitFor(async () => { const w = await s3('walk'); return w.on && w.place ? w : null; }, 20000); }
      const o = screen.openings.find((x) => x.infill), L = Math.hypot(screen.b[0] - screen.a[0], screen.b[1] - screen.a[1]), u = [(screen.b[0] - screen.a[0]) / L, (screen.b[1] - screen.a[1]) / L];
      const mid = [screen.a[0] + u[0] * (o.t0 + o.t1) / 2, screen.a[1] + u[1] * (o.t0 + o.t1) / 2], n = [-u[1], u[0]];
      // on the site, 2.5 m before the slats on the side away from the house, facing them
      const stand = [mid[0] - n[0] * 2.5, mid[1] - n[1] * 2.5], g = F.p.site.groundLevel;
      await goTo(stand, g, Math.atan2(-n[0], n[1]), -0.05); await sleep(800);
      await shot(`${tag}_12_screen_wall`);
      await hold('KeyW', 'false', 2500);
      const w = await s3('walk'), past = (w.p[0] - mid[0]) * n[0] + (w.p[1] - mid[1]) * n[1];
      check(`[${tag}] the screen wall ${screen.id} with slats stands on the site and stops the walk (${o.id} is filled)`, past < -screen.thickness / 2, `${past.toFixed(2)} m from the wall's axis`);
    });

    // ---------------------------------------------------------------- exits (usability issue B8)
    await stage(`[${tag}] exit sign`, async () => {
      const D = F.p.building.doors.find((d) => d.rooms.includes('exterior')), mid = [(D.opening.faces[0] + D.opening.faces[1]) / 2, (D.opening.from + D.opening.to) / 2];
      // the front door (closed) is in the west wall: stand up to 3.6 m inside it (in its room), facing it (−X), looking a little down
      const inRoom = F.p.building.rooms.rooms.find((r) => r.id === D.rooms[0]), far = Math.min(3.6, inRoom.bbox[2] - mid[0] - 0.4);
      await goTo([mid[0] + far, mid[1]], 0, Math.PI / 2, far < 3 ? -0.2 : -0.3);
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
        const parts = F.p.manifest.levels.length + 1, joints = report?.joints ?? [];
        if (F.p.building.roof?.parts?.some((x) => x.level === lo) && hi) check(`[${tag}] the print: the roof over the ${lo} wing goes with ${hi}'s part (${lo}'s part open from above), the parts are joined by tabs`,
          notes.includes('roof.carried') && joints.length === parts - 1 && joints.every((j) => j.made && j.tabs >= 3), JSON.stringify(joints.map((j) => [j.between.join('→'), j.tabs])));
        check(`[${tag}] Download › Print model: the STL parts are the bytes of npm run project:print${s ? `, the stairs are printed (the steps in the upper slab go with ${hi}'s part)` : ''}`,
          same && stl.length === parts && (!s || notes.includes('stairs.split')), `${zip}: ${stl.join(', ')}; same bytes ${same}; notes ${notes.join(', ')}`);
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
