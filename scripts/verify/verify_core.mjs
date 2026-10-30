// E2E — core flows of the configurator on BOTH example projects (demo-apartment: flat, one level; sample-house: two levels,
// stairs, site). The same engine code runs both packages; nothing here branches on the project id except the expectations
// read from the package itself (projects/<id>/project.json).
// Per project: load via ?project=, generated shell, level section, views from the bottom bar, entering a room by clicking it in
// the section, furniture select / move / rotate / delete / undo, wall finish, doors open / close, walk (sample-house: up the
// stairs to the first floor and out of the front door onto the site), variants (new, rename, switch, compare), save → reload.
// Across projects: isolation of documents and device keys, project switch from Settings, language switch (Polish and back),
// the project index, a broken package (temporary directory projects/__e2e_broken/, removed in `finally`) → readable error.
// Both shells run the same scenario: by default the core's manifold solids, with --shell grid the grid shell (?shell=grid, the
// fallback kept for one release — ADR 0026).
// Usage: node scripts/verify/verify_core.mjs [--no-build] [--only demo-apartment,sample-house] [--shell core|grid]
//        HOME_SIM_BROWSER=auto|gpu|swiftshader. Output: reports/e2e/core/ (core-grid/ with --shell grid; screenshots, core.json).
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, ROOT, sleep, startServer, waitForApp } from './browser.mjs';
import { appKeys, resetOrigin } from './app_data.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SHELL = arg('shell', 'core') === 'grid' ? 'grid' : 'core', SHELL_Q = SHELL === 'grid' ? '&shell=grid' : '';
const NAME = SHELL === 'grid' ? 'core-grid' : 'core', PORT = SHELL === 'grid' ? 4307 : 4301;
const OUT = resolve(ROOT, 'reports/e2e', NAME);
const UD = mkdtempSync(join(tmpdir(), `home-sim-e2e-${NAME}-`));
const BROKEN_ID = SHELL === 'grid' ? '__e2e_broken_grid' : '__e2e_broken', BROKEN = resolve(ROOT, 'projects', BROKEN_ID);
const ONLY = (arg('only', '') ?? '').split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(resolve(OUT, f), { recursive: true, force: true });

/** UI dictionaries (expected texts are read, not hard-coded — the Polish one is data) */
const dict = (lang) => Object.assign({}, ...readdirSync(resolve(ROOT, 'src/i18n', lang)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(ROOT, 'src/i18n', lang, f), 'utf8'))));
const EN = dict('en'), PL = dict('pl');
const pkg = (id) => JSON.parse(readFileSync(resolve(ROOT, 'projects', id, 'project.json'), 'utf8'));
const docFile = (id) => join(UD, id, 'document.json');
const readDoc = (id) => (existsSync(docFile(id)) ? JSON.parse(readFileSync(docFile(id), 'utf8')) : null);
const sha = (f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).replace(/\s+/g, ' ').slice(0, 400)}`); };

if (!process.argv.includes('--no-build')) execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
const server = await startServer({ port: PORT, mode: 'preview', userdata: UD });
const BASE = server.url;
const { browser, renderer, profile } = await launch({ viewport: { width: 1400, height: 900 } });
console.log(`[browser] ${profile} — ${renderer}`);
let page = await browser.newPage();
const errors = [];
const watch = (p, tag) => {
  p.on('pageerror', (e) => errors.push(`[${tag}] ${String(e).slice(0, 300)}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
};
watch(page, 'main');

const T = (id) => `[data-testid="${id}"]`;
const st = () => page.evaluate(() => window.__home.state());
const s3 = (fn, ...a) => page.evaluate((fn, a) => window.__home3d[fn](...a), fn, a);
const uiSet = (patch) => page.evaluate((p) => window.__home.ui(p), patch);
const exists = async (s) => !!(await page.$(s));
const text = (s) => page.$eval(s, (e) => e.textContent.trim()).catch(() => null);
const shot = (n) => page.screenshot({ path: resolve(OUT, `${n}.png`) }).catch(() => {});
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const frames = (n = 2) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
/** camera at rest: the same pose (and aspect fitted to the canvas) in two reads a few frames apart */
async function still(timeout = 8000) {
  const t0 = Date.now(); let prev = null;
  while (Date.now() - t0 < timeout) {
    const c = await page.evaluate(() => window.__home3d?.camera?.() ?? null);
    if (!c) return;
    const cur = JSON.stringify([c.position, c.dir, c.zoom]), fitted = Math.abs(c.aspect - c.canvasAspect) < 3e-3;
    if (cur === prev && fitted) return;
    prev = fitted ? cur : null;
    await frames(3); await sleep(60);
  }
}
const click = async (s, wait = 400) => { const el = await page.$(s); if (!el) throw new Error(`no element ${s}`); await el.scrollIntoView(); await sleep(60); await el.click(); await sleep(wait); };
const key = async (mods, k) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(k); for (const m of [...mods].reverse()) await page.keyboard.up(m); await sleep(350); };
const waitFor = async (fn, ms = 15000, step = 150) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } };
/** app up, scene up and the generated shell built (the core shell arrives from a worker) */
const ready = async (p = page) => { await waitForApp(p); await p.waitForFunction(() => !!window.__home3d?.camera?.() && !!window.__homeScene && ['ready', 'error'].includes(window.__home3d.shell?.().status), { timeout: 60000 }); };
async function open(id, extra = '') {
  await page.goto(`${BASE}/?onboarding=off&project=${id}${SHELL_Q}${extra}`, { waitUntil: 'load' });
  await ready(); await sleep(800); await still();
}
/** the element at a screen point is the 3D canvas (not covered by a panel, label or button) */
const onCanvas = (p) => page.evaluate((p) => !!p && document.elementFromPoint(p[0], p[1])?.tagName === 'CANVAS', p);
async function clickAt(p, wait = 600) { await page.mouse.move(p[0] - 3, p[1]); await sleep(60); await page.mouse.move(p[0], p[1]); await sleep(80); await page.mouse.click(p[0], p[1]); await sleep(wait); }
async function dragPath(path, steps = 14) {
  await page.mouse.move(path[0][0], path[0][1]); await sleep(80); await page.mouse.down(); await sleep(80);
  for (let k = 1; k < path.length; k++) for (let i = 1; i <= steps; i++) { await page.mouse.move(path[k - 1][0] + ((path[k][0] - path[k - 1][0]) * i) / steps, path[k - 1][1] + ((path[k][1] - path[k - 1][1]) * i) / steps); await sleep(20); }
  await frames(2); await sleep(120); await page.mouse.up(); await sleep(600);
}
const setCamera = async (position, target, fov = 55) => { await page.evaluate((pose) => window.__home.ui({ camera: { preset: 'pose', n: Date.now(), pose } }), { position, target, fov }); await sleep(900); await still(); };
/** scene object: exists, visible (with parents), triangle count */
const obj = (name) => page.evaluate((name) => {
  const o = window.__homeScene.getObjectByName(name);
  if (!o) return null;
  let tris = 0; o.traverse((m) => { if (m.isMesh) { const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  let v = true; for (let q = o; q; q = q.parent) v = v && q.visible;
  return { tris, visible: v };
}, name);
/** runs a block; an exception becomes one FAIL (the next blocks still run) */
async function stage(name, fn) {
  try { await fn(); } catch (e) { check(`${name}: completed`, false, String(e?.stack ?? e).slice(0, 500)); await shot(`error_${name.replace(/[^a-z0-9]+/gi, '_')}`); }
}

// ------------------------------------------------------------------ expectations from the packages
function factsOf(id) {
  const p = pkg(id), rooms = p.building.rooms.rooms, lv0 = p.manifest.defaultView.levelId;
  const levelRooms = (l) => rooms.filter((r) => r.level === l);
  // the largest room of the start level: entered by a click in the section; its furniture, wall, door are used below
  const room = levelRooms(lv0).slice().sort((a, b) => b.area - a.area)[0];
  const door = p.building.doors.find((d) => d.rooms.includes(room.id) && !d.rooms.includes('exterior') && d.type?.startsWith('hinged'));
  const front = p.building.doors.find((d) => d.rooms.includes('exterior'));
  return { id, p, name: p.manifest.name, type: p.manifest.buildingType, levels: p.manifest.levels.map((l) => l.id), lv0, levelRooms, room, door, front, hasSite: !!p.site, stairs: p.building.stairs ?? [] };
}

// ================================================================== per project
async function runProject(F) {
  const tag = F.id;
  // ---------------------------------------------------------------- load
  await stage(`[${tag}] load`, async () => {
    const reqs = [];
    const onReq = (r) => reqs.push(new URL(r.url()).pathname);
    page.on('request', onReq);
    await open(F.id);
    page.off('request', onReq);
    const pr = await page.evaluate(() => window.__home.project()), s = await st();
    const nav = await page.evaluate(() => [...document.querySelectorAll('.hm-nav [data-testid^="nav-"]')].map((b) => [b.dataset.testid.slice(4), b.textContent.trim()]));
    check(`[${tag}] ?project=${F.id}: package loaded (id, levels), document title from the manifest`, pr.id === F.id && pr.levels.join() === F.levels.join() && (await page.title()) === `${F.name} — Home Simulator` && s.loaded && !s.dirty,
      `${JSON.stringify(pr)} · "${await page.title()}"`);
    const wantNav = ['building', 'interiors', 'materials', 'furniture', 'electrical', 'variants'];
    check(`[${tag}] section navigation from the package capabilities; first section named after the building type ("${EN[`section.building.${F.type}`]}")`,
      nav.map((n) => n[0]).join() === wantNav.join() && nav[0][1] === EN[`section.building.${F.type}`] && nav[1][1] === EN['section.interiors'] && (await exists(T('section-building'))), nav.map((n) => n.join(':')).join(' '));
    const models = reqs.filter((u) => /\.(glb|gltf)$/i.test(u));
    check(`[${tag}] project without model files: no model (GLB) is requested; package fetched from /projects/${F.id}/project.json`, models.length === 0 && reqs.includes(`/projects/${F.id}/project.json`) && reqs.includes('/projects/index.json'), models.join(' ') || `${reqs.length} requests`);
  });

  // ---------------------------------------------------------------- generated shell
  await stage(`[${tag}] shell`, async () => {
    await click(T('cam-overview'), 900); await still();
    const parts = {};
    // core: one closed solid per level (walls and slabs); grid: walls and slabs as separate meshes
    for (const l of F.levels) parts[l] = SHELL === 'grid'
      ? { wall: await obj(`WALL_${l}`), floor: await obj(`SLAB_${l}_Floor`), frames: await obj(`WINDOW_FRAMES_${l}`) }
      : { wall: await obj(`SOLID_${l}`), floor: await obj(`SOLID_${l}`), frames: await obj(`WINDOW_FRAMES_${l}`) };
    const house = await obj('HOUSE'), s = await st(), shell = await s3('shell');
    await shot(`${tag}_01_shell`);
    // the shell is drawn: pixels in the middle of the building differ from the background
    const px = await page.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const a = window.__home3d.pixel(c.left + c.width / 2, c.top + c.height / 2), b = window.__home3d.pixel(c.left + 4, c.top + 4); return { a, b }; });
    const diff = Math.max(...px.a.map((v, i) => Math.abs(v - px.b[i])));
    check(`[${tag}] generated shell (${SHELL}) visible: walls, floor slab and window frames of every level (${F.levels.join(', ')}) in the scene; building drawn over the background`,
      shell.kind === SHELL && shell.status === 'ready' && !!house?.visible && F.levels.every((l) => parts[l].wall?.visible && parts[l].wall.tris > 50 && parts[l].floor && parts[l].frames?.tris > 0) && s.houseView === 'exterior' && diff > 12,
      `${shell.kind} ${shell.status}; ${F.levels.map((l) => `${l}: walls ${parts[l].wall?.tris} tris, frames ${parts[l].frames?.tris}`).join('; ')}; centre ${px.a} vs corner ${px.b}`);
  });

  // ---------------------------------------------------------------- views from the bottom bar
  await stage(`[${tag}] views`, async () => {
    const presets = await page.evaluate(() => [...document.querySelectorAll('[data-testid="bottom-house"] [data-testid^="cam-"]')].map((b) => b.dataset.testid.slice(4)));
    const cams = {};
    for (const p of presets) { await click(T(`cam-${p}`), 900); await still(); cams[p] = { cam: await s3('camera'), view: (await st()).houseView, clip: await s3('clipping') }; }
    const ext = presets.filter((p) => p !== 'interior');
    const distinct = new Set(ext.map((p) => JSON.stringify(cams[p].cam.position))).size === ext.length;
    const top = cams.top?.cam;
    check(`[${tag}] bottom bar views (${presets.join(', ')}): each exterior view moves the camera, "top" looks down, "interior" opens the level section (cut plane)`,
      presets.includes('interior') && ext.length >= 2 && distinct && ext.every((p) => cams[p].view === 'exterior' && cams[p].clip.length === 0) && (!top || top.dir[2] < -0.8) && cams.interior.view === 'interior' && cams.interior.clip.length === 1,
      presets.map((p) => `${p}: ${cams[p].view} cam ${cams[p].cam.position} clip ${cams[p].clip}`).join(' · '));
  });

  // ---------------------------------------------------------------- level section
  await stage(`[${tag}] level section`, async () => {
    await click(T('nav-interiors'), 900); await still();
    const s = await st(), listed = await page.$$eval(`${T('room-list')} button`, (b) => b.map((x) => x.dataset.testid.slice(5)));
    const want = F.levelRooms(s.level).map((r) => r.id).sort();
    const clip = await s3('clipping'), tag0 = await text(T('level-tag'));
    await shot(`${tag}_02_section`);
    check(`[${tag}] Interiors: level section of ${s.level} (cut plane), the room list of the level, section tag`,
      s.section === 'interiors' && s.houseView === 'interior' && (await exists(T('section-interiors'))) && clip.length === 1 && listed.slice().sort().join() === want.join() && !!tag0,
      `level ${s.level}; cut ${clip}; rooms ${listed.join(',')}; tag "${tag0}"`);
    if (F.levels.length > 1) {
      const other = F.levels.find((l) => l !== s.level);
      await click(`${T('bottom-level')} button[data-value="${other}"]`, 900); await still();
      const s2 = await st(), listed2 = await page.$$eval(`${T('room-list')} button`, (b) => b.map((x) => x.dataset.testid.slice(5)));
      const clip2 = await s3('clipping');
      check(`[${tag}] level switch in the bottom bar: ${s.level} → ${other} — room list and cut height follow the level`,
        s2.level === other && listed2.slice().sort().join() === F.levelRooms(other).map((r) => r.id).sort().join() && clip2[0] > clip[0] + 1, `cut ${clip} → ${clip2}; rooms ${listed2.join(',')}`);
      await click(`${T('bottom-level')} button[data-value="${s.level}"]`, 900); await still();
    }
  });

  // ---------------------------------------------------------------- enter a room by clicking it in the section
  await stage(`[${tag}] enter room`, async () => {
    const R = F.room;
    let p = await s3('screenOfRoom', R.id);
    if (!(await onCanvas(p))) { // a label may sit on the room centre: a point a little off the centre
      for (const [dx, dy] of [[0.25, 0.25], [-0.25, 0.25], [0.25, -0.25], [-0.25, -0.25]]) {
        const q = await s3('screenOfFloor', R.id, R.bbox[0] + (R.bbox[2] - R.bbox[0]) * (0.5 + dx), R.bbox[1] + (R.bbox[3] - R.bbox[1]) * (0.5 + dy));
        if (await onCanvas(q)) { p = q; break; }
      }
    }
    await clickAt(p, 1500); await still();
    const s = await st();
    await shot(`${tag}_03_room`);
    check(`[${tag}] click on the floor of "${R.name}" in the level section enters the room (Interiors, room view, its arrangement)`,
      s.roomId === R.id && s.section === 'interiors' && (await text(T('room-title'))) === R.name && s.arrangement?.furniture.length > 0, `room ${s.roomId}; title "${await text(T('room-title'))}"; furniture ${s.arrangement?.furniture.length}`);
    if (s.roomId !== R.id) { await uiSet({ roomId: R.id, level: R.level, section: 'interiors', houseView: 'interior' }); await sleep(1200); await still(); }
  });

  // ---------------------------------------------------------------- furniture: select / move / rotate / delete / undo
  await stage(`[${tag}] furniture`, async () => {
    const R = F.room;
    await click(T('nav-furniture'), 600);
    await click(`${T('bottom-view')} button[data-value="top"]`, 1200); await still();
    const s0 = await st();
    // a free-standing item (not wall-mounted, not in a kitchen run) with its centre visible on the canvas
    const pick = ['coffee-table', 'dining-table', 'bed', 'sofa', 'desk'].map((c) => s0.arrangement.furniture.find((f) => f.catalogId === c)).filter(Boolean);
    let F0 = null, at = null;
    for (const f of pick) { const q = await s3('screenOfFurniture', f.id, 1); if (await onCanvas(q)) { F0 = f; at = q; break; } }
    if (!F0) throw new Error(`no free-standing item visible in ${R.id}: ${s0.arrangement.furniture.map((f) => f.catalogId).join(',')}`);
    await clickAt(at, 700);
    const sel = (await st()).selection;
    check(`[${tag}] click on furniture (${F0.catalogId}) selects it — card in the panel`, sel?.kind === 'furniture' && sel.id === F0.id && (await exists(`${T('inspector')}[data-kind="furniture"]`)), JSON.stringify(sel));
    // move: drag 0.4 m along X of the room (screen vector of a floor step). The card opened with the selection narrows the
    // canvas — the item is located again once the camera has adapted
    await still(); await frames(3);
    at = await s3('screenOfFurniture', F0.id, 1);
    const z = 0.05, a0 = await s3('screenOfPoint', F0.x, F0.y, z), a1 = await s3('screenOfPoint', F0.x + 0.4, F0.y, z);
    const dir = F0.x + 0.4 < R.bbox[2] - 0.3 ? 1 : -1, b1 = dir > 0 ? a1 : await s3('screenOfPoint', F0.x - 0.4, F0.y, z);
    const past0 = (await st()).past;
    await dragPath([at, [at[0] + 6, at[1]], [at[0] + (b1[0] - a0[0]), at[1] + (b1[1] - a0[1])]]);
    const f1 = (await st()).arrangement.furniture.find((f) => f.id === F0.id);
    check(`[${tag}] drag moves the selected item over the floor by the pointer distance (≈ 0.4 m, one history entry)`,
      near(Math.abs(f1.x - F0.x), 0.4, 0.12) && near(f1.y, F0.y, 0.12) && (await st()).past === past0 + 1, `(${F0.x}; ${F0.y}) → (${f1.x}; ${f1.y}); history ${past0} → ${(await st()).past}`);
    if ((await st()).selection?.id !== F0.id) await uiSet({ selection: { kind: 'furniture', roomId: R.id, id: F0.id } });
    await key([], 'KeyR');
    const f2 = (await st()).arrangement.furniture.find((f) => f.id === F0.id);
    await click(T('rot-left'), 400);
    const f3 = (await st()).arrangement.furniture.find((f) => f.id === F0.id);
    const norm = (x) => ((x % 360) + 360) % 360;
    check(`[${tag}] rotate: key R −90°, panel button +15°`, norm(f2.rot - f1.rot) === 270 && norm(f3.rot - f2.rot) === 15, `${f1.rot}° → ${f2.rot}° → ${f3.rot}°`);
    const n0 = (await st()).arrangement.furniture.length;
    await key([], 'Delete');
    const s4 = await st();
    await key(['Control'], 'KeyZ');
    const s5 = await st(), back = s5.arrangement.furniture.find((f) => f.id === F0.id);
    check(`[${tag}] Delete removes the selected item, Ctrl+Z brings it back where it was`, s4.arrangement.furniture.length === n0 - 1 && !s4.arrangement.furniture.some((f) => f.id === F0.id) && s4.selection === null
      && s5.arrangement.furniture.length === n0 && !!back && back.x === f3.x && back.y === f3.y && back.rot === f3.rot, `${n0} → ${s4.arrangement.furniture.length} → ${s5.arrangement.furniture.length}`);
    F.moved = { id: F0.id, x: f3.x, y: f3.y, rot: f3.rot };
    await uiSet({ selection: null });
    await click(`${T('bottom-view')} button[data-value="3d"]`, 1200); await still();
  });

  // ---------------------------------------------------------------- wall finish (Materials)
  await stage(`[${tag}] materials`, async () => {
    await click(T('nav-materials'), 700);
    const walls = await page.$$eval(`${T('section-materials')} button[data-testid^="wall-"]`, (b) => b.map((x) => x.dataset.testid).filter((x) => /^wall-\d+$/.test(x)));
    await click(T(walls[0]), 600);
    const sel = (await st()).selection;
    const mats = await page.$$eval(`${T('inspector')} ${T('materials')} button`, (b) => b.map((x) => ({ id: x.dataset.testid, on: x.classList.contains('on') })));
    const m = mats.find((x) => !x.on);
    await click(T(m.id), 800);
    const fin = (await st()).arrangement.finishes;
    const want = m.id.slice(4);
    check(`[${tag}] Materials: wall picked from the room's wall list, a material from the card is applied to that wall only`,
      sel?.kind === 'wall' && fin.walls?.[sel.wallId]?.materialId === want && Object.keys(fin.walls).length === 1, `${walls.length} walls; ${sel?.wallId}: ${fin.walls?.[sel?.wallId]?.materialId} (picked ${want})`);
    F.wall = { id: sel?.wallId, material: want };
    await shot(`${tag}_04_wall`);
    await uiSet({ selection: null });
  });

  // ---------------------------------------------------------------- doors
  await stage(`[${tag}] doors`, async () => {
    const D = F.door, R = F.room;
    await click(T('nav-interiors'), 500);
    // camera inside the room, looking at the door from 2.5 m
    const c = [(D.opening.along === 'Y' ? (D.opening.faces[0] + D.opening.faces[1]) / 2 : (D.opening.from + D.opening.to) / 2), (D.opening.along === 'Y' ? (D.opening.from + D.opening.to) / 2 : (D.opening.faces[0] + D.opening.faces[1]) / 2)];
    const rc = [(R.bbox[0] + R.bbox[2]) / 2, (R.bbox[1] + R.bbox[3]) / 2], dl = Math.hypot(rc[0] - c[0], rc[1] - c[1]);
    const eye = [c[0] + ((rc[0] - c[0]) / dl) * 2.5, c[1] + ((rc[1] - c[1]) / dl) * 2.5, (R.floor_z ?? 0) + 1.6];
    await setCamera(eye, [c[0], c[1], (R.floor_z ?? 0) + 1.0]);
    let hit = null;
    for (const [h, al] of [[1.2, 0.5], [1.6, 0.4], [0.9, 0.6], [1.8, 0.5]]) {
      const q = await s3('screenOfDoor', D.id, 0, h, al);
      if (!(await onCanvas(q))) continue;
      await clickAt(q, 700);
      const s = (await st()).selection;
      if (s?.kind === 'door' && s.id === D.id) { hit = q; break; }
      if (s) await uiSet({ selection: null });
    }
    const card = await exists(T('door-open'));
    check(`[${tag}] click on the door leaf ${D.id} (${D.rooms.join(' ↔ ')}) selects the door — card with Open / Close`, !!hit && card, hit ? `at ${hit.map(Math.round)}` : 'no click point selected the door');
    if (!hit) await uiSet({ selection: { kind: 'door', id: D.id } });
    await sleep(300);
    const waitDoor = (t) => page.waitForFunction((id, t) => { const d = window.__home3d.doors(); return Math.abs((d.open[id] ?? 0) - t) < 1e-3 && Math.abs((d.motion[id] ?? 0) - t) < 1e-3; }, { timeout: 15000, polling: 100 }, D.id, t).then(() => true).catch(() => false);
    await click(T('door-open'), 100);
    const opened = await waitDoor(1);
    await shot(`${tag}_05_door_open`);
    await click(T('door-close'), 100);
    const closed = await waitDoor(0);
    check(`[${tag}] door card: Open swings the leaf open (animation to the end), Close shuts it`, opened && closed, JSON.stringify(await s3('doors')));
    await uiSet({ selection: null });
  });

  // ---------------------------------------------------------------- walk
  await stage(`[${tag}] walk`, async () => {
    await uiSet({ roomId: null, selection: null }); await sleep(500);
    await click(T('nav-building'), 600);
    const vps = await page.$$eval(`${T('viewpoints')} button`, (b) => b.map((x) => x.dataset.testid));
    await click(T('walk-start'), 2500);
    const w0 = await waitFor(async () => { const w = await s3('walk'); return w.on && w.place ? w : null; }, 20000);
    const p0 = w0?.p;
    // W held until the walk has moved (frames are slower when several tests share the machine)
    await page.keyboard.down('KeyW');
    await page.waitForFunction((p0) => { const w = window.__home3d.walk(); return Math.hypot(w.p[0] - p0[0], w.p[1] - p0[1]) > 0.5; }, { timeout: 15000, polling: 100 }, p0 ?? [0, 0]).catch(() => {});
    await page.keyboard.up('KeyW'); await sleep(400);
    const w1 = await s3('walk');
    await shot(`${tag}_06_walk`);
    check(`[${tag}] walk: "Start walk" → eye-level walk mode, the place is shown; W walks forward`, (await st()).houseView === 'walk' && !!w0 && Math.hypot(w1.p[0] - p0[0], w1.p[1] - p0[1]) > 0.3 && !!(await text(T('walk-place'))),
      `start ${w0?.place} (${p0}) → ${w1.place} (${w1.p}); viewpoints ${vps.join(',')}`);
    // walking to a pose: walkGo command, keys held until a condition holds (or a timeout)
    const goTo = async (p, z, yaw) => {
      await page.evaluate((go) => window.__home.ui({ walkGo: go }), { pose: { p, z, yaw, pitch: 0 }, n: Date.now() });
      return waitFor(async () => { const w = await s3('walk'); return w.on && Math.hypot(w.p[0] - p[0], w.p[1] - p[1]) < 0.3 && Math.abs(w.z - z) < 0.05 ? w : null; }, 15000);
    };
    const hold = async (k, cond, ms = 25000) => { await page.keyboard.down(k); const ok = await page.waitForFunction(cond, { timeout: ms, polling: 100 }).then(() => true).catch(() => false); await page.keyboard.up(k); await sleep(300); return ok; };
    if (F.stairs.length) {
      // U-turn stairs: lower flight away from the hall (−Y), across the landing (−X), upper flight back (+Y) to the upper level
      const S = F.stairs[0], up = F.levels[1];
      const entryX = (S.split + S.bbox[2]) / 2, upX = (S.bbox[0] + S.split) / 2;
      await goTo([entryX, S.bbox[3] + 0.6], 0, Math.PI);
      const a = await hold('KeyW', `(() => { const w = window.__home3d.walk(); return Math.abs(w.z - ${S.landingZ}) < 0.02 && w.p[1] < ${S.landingEdge}; })()`);
      const wa = await s3('walk');
      const b = await hold('KeyD', `window.__home3d.walk().p[0] < ${upX + 0.1}`, 15000);
      const c = await hold('KeyS', `(() => { const w = window.__home3d.walk(); return Math.abs(w.z - ${S.topZ}) < 0.01 && w.p[1] > ${S.bbox[3] + 0.3}; })()`);
      const wc = await s3('walk'), s = await st();
      await shot(`${tag}_07_upstairs`);
      check(`[${tag}] walk up the stairs ${S.id} with the keys: lower flight → landing (+${S.landingZ}) → upper flight → ${up} (+${S.topZ}); the level follows`,
        a && b && c && near(wa.z, S.landingZ, 0.02) && near(wc.z, S.topZ, 0.01) && s.level === up && /^First floor/.test(wc.place), `landing z ${wa.z} (${wa.place}); top z ${wc.z} "${wc.place}" level ${s.level}`);
      // front door: closed blocks, open lets the walk out onto the site
      const D = F.front, room = F.p.building.rooms.rooms.find((r) => r.id === D.rooms.find((x) => x !== 'exterior'));
      const dy = (D.opening.from + D.opening.to) / 2, inX = room.bbox[0] + 0.7, out = D.opening.faces[0] < room.bbox[0];
      await page.evaluate((id) => window.__home.doors.open(id, 0), D.id); await sleep(300);
      await goTo([inX, dy], 0, out ? Math.PI / 2 : -Math.PI / 2);
      const blocked = !(await hold('KeyW', `window.__home3d.walk().p[0] < -0.5`, 3500));
      const wb = await s3('walk');
      await page.evaluate((id) => window.__home.doors.open(id, 1), D.id);
      await page.waitForFunction((id) => (window.__home3d.doors().motion[id] ?? 0) > 0.99, { timeout: 15000 }, D.id).catch(() => {});
      const outside = await hold('KeyW', `(() => { const w = window.__home3d.walk(); return w.kind === 'site' && w.p[0] < -1.5; })()`);
      const wo = await s3('walk');
      await shot(`${tag}_08_site`);
      check(`[${tag}] front door ${D.id}: closed — the walk stops at the door; open — out of the door onto the site (ground level ${F.p.site.groundLevel})`,
        blocked && wb.p[0] > 0.2 && outside && wo.kind === 'site' && near(wo.z, F.p.site.groundLevel, 0.02), `closed: stopped at x ${wb.p[0].toFixed(2)}; open: ${wo.place} (${wo.p.map((v) => v.toFixed(2))}) z ${wo.z}`);
      await page.evaluate((id) => window.__home.doors.open(id, 0), D.id);
    } else {
      // a project without a site: the walk stays inside — the exterior door does not lead out
      const D = F.front;
      if (D) {
        const room = F.p.building.rooms.rooms.find((r) => r.id === D.rooms.find((x) => x !== 'exterior'));
        const dy = (D.opening.from + D.opening.to) / 2, inX = room.bbox[0] + 0.7;
        await page.evaluate((id) => window.__home.doors.open(id, 1), D.id); await sleep(600);
        await goTo([inX, dy], 0, Math.PI / 2);
        await hold('KeyW', `window.__home3d.walk().p[0] < -0.5`, 3000);
        const w = await s3('walk');
        check(`[${tag}] project without a site: an open exterior door ${D.id} does not lead out of the building`, w.p[0] > 0.2 && w.kind !== 'site', `${w.place} (${w.p.map((v) => v.toFixed(2))})`);
        await page.evaluate((id) => window.__home.doors.open(id, 0), D.id);
      }
    }
    await click(T('bottom-walk-exit'), 1200);
    check(`[${tag}] walk exit returns to the building view`, (await st()).houseView === 'exterior' && !(await s3('walk')).on, (await st()).houseView);
  });

  // ---------------------------------------------------------------- variants
  await stage(`[${tag}] variants`, async () => {
    await click(T('nav-variants'), 700);
    const v0 = await page.evaluate(() => window.__home.variants());
    await click(T('variant-new'), 400);
    await page.type(T('variant-new-name'), 'Variant B'); await page.keyboard.press('Enter'); await sleep(1200);
    const v1 = await page.evaluate(() => window.__home.variants());
    const nb = v1.list.find((v) => v.name === 'Variant B');
    check(`[${tag}] variants: "New" creates a variant with the given name and makes it active`, v1.list.length === v0.list.length + 1 && !!nb && v1.active === nb.id, v1.list.map((v) => v.name).join(' / '));
    await click(T('variant-rename'), 400);
    await page.click(T('variant-name'), { count: 3 }); await page.keyboard.type('Variant B2'); await page.keyboard.press('Enter'); await sleep(800);
    const v2 = await page.evaluate(() => window.__home.variants());
    check(`[${tag}] rename: the active variant gets the new name`, v2.list.find((v) => v.id === nb?.id)?.name === 'Variant B2' && (await exists(T('variant-Variant B2'))), v2.list.map((v) => v.name).join(' / '));
    const first = v2.list[0];
    await click(T(`variant-${first.name}`), 1800); await still();
    const v3 = await page.evaluate(() => window.__home.variants()), s3x = await st();
    check(`[${tag}] switch: clicking the "${first.name}" card activates it (brand line shows its name)`, v3.active === first.id && s3x.variant === first.name, `active ${v3.active} (${s3x.variant})`);
    await click(T('compare-start'), 2500);
    const cmp = await page.evaluate(() => ({ c: window.__home.variants().compare, bar: !!document.querySelector('[data-testid="compare"], [data-testid="compare-bar"]'), sides: ['SIDE_A', 'SIDE_B'].map((n) => !!window.__homeScene.getObjectByName(n)) }));
    await shot(`${tag}_09_compare`);
    const exitSel = (await exists(T('compare-exit'))) ? T('compare-exit') : T('compare-stop');
    await click(exitSel, 1200);
    const after = await page.evaluate(() => window.__home.variants().compare);
    check(`[${tag}] compare A | B: two variants side by side (both sides in the scene), exit ends the comparison`, cmp.c?.kind === 'variants' && cmp.c.a !== cmp.c.b && cmp.bar && cmp.sides.every(Boolean) && after === null, JSON.stringify(cmp));
    F.variants = v3.list.map((v) => v.name);
  });

  // ---------------------------------------------------------------- save → reload
  await stage(`[${tag}] save`, async () => {
    const other = F.id === 'demo-apartment' ? 'sample-house' : 'demo-apartment', otherSha = sha(docFile(other));
    await key(['Control'], 'KeyS');
    await waitFor(async () => !(await st()).dirty && existsSync(docFile(F.id)), 20000);
    await sleep(500);
    const doc = readDoc(F.id);
    const v0 = doc?.variants?.find((v) => v.id === doc.activeVariantId) ?? doc?.variants?.[0];
    const fm = v0?.interiors?.[F.room.id]?.arrangements?.flatMap((a) => a.furniture ?? []).find((f) => f.id === F.moved?.id);
    check(`[${tag}] Ctrl+S: document saved to $userdata/${F.id}/document.json — project id, variants, moved furniture and wall finish; the other project's file untouched`,
      doc?.projectId === F.id && doc.variants.map((v) => v.name).join() === F.variants.join() && !!fm && near(fm.x, F.moved.x, 1e-6) && fm.rot === F.moved.rot && sha(docFile(other)) === otherSha && (await text(T('save'))) === EN['shell.saved'],
      `${docFile(F.id).replace(UD, '$userdata')}: ${doc?.projectId}, variants ${doc?.variants?.map((v) => v.name).join(' / ')}; furniture ${fm && `${fm.x};${fm.y} ${fm.rot}°`}; button "${await text(T('save'))}"`);
    await open(F.id);
    await uiSet({ roomId: F.room.id, level: F.room.level, section: 'interiors', houseView: 'interior' }); await sleep(1200);
    const s = await st(), v = await page.evaluate(() => window.__home.variants());
    const f = s.arrangement.furniture.find((x) => x.id === F.moved?.id);
    check(`[${tag}] reload: variants, furniture position / rotation and the wall finish come back from the file; nothing unsaved`,
      v.list.map((x) => x.name).join() === F.variants.join() && !!f && f.x === F.moved.x && f.rot === F.moved.rot && s.arrangement.finishes.walls?.[F.wall?.id]?.materialId === F.wall?.material && !s.dirty,
      `variants ${v.list.map((x) => x.name).join(' / ')}; ${f && `${f.x};${f.y} ${f.rot}°`}; wall ${F.wall?.id} ${s.arrangement.finishes.walls?.[F.wall?.id]?.materialId}`);
    F.saved = sha(docFile(F.id));
    await uiSet({ roomId: null, section: 'building' });
  });
}

try {
  await resetOrigin(page, BASE);
  // ================================================================== project index
  const idx = await (await fetch(`${BASE}/projects/index.json`)).json();
  const dirs = readdirSync(resolve(ROOT, 'projects'), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(resolve(ROOT, 'projects', e.name, 'project.json')) && !e.name.startsWith('__e2e_broken')).map((e) => e.name).sort();
  check('project index /projects/index.json: schema, one entry per package directory (id, name, dir), default project', idx.schema === 'home-simulator/projects-index' && idx.version === 1
    && dirs.every((d) => idx.projects.some((p) => p.id === d && p.dir === `projects/${d}/` && p.name === pkg(d).manifest.name)) && dirs.includes(idx.default) && ['demo-apartment', 'sample-house'].every((d) => dirs.includes(d)),
    `${idx.projects.map((p) => `${p.id} "${p.name}"`).join(', ')}; default ${idx.default}`);

  const facts = ['demo-apartment', 'sample-house'].filter((id) => !ONLY.length || ONLY.includes(id)).map(factsOf);
  for (const F of facts) await runProject(F);

  // ================================================================== isolation of the projects
  if (facts.length === 2) await stage('isolation', async () => {
    const [A, B] = facts, docA = readDoc(A.id), docB = readDoc(B.id);
    const keys = await appKeys(page);
    const scopedA = keys.filter((k) => k.endsWith(`:${A.id}`)), scopedB = keys.filter((k) => k.endsWith(`:${B.id}`));
    const idb = await page.evaluate(() => new Promise((ok) => { const r = indexedDB.open('home-simulator'); r.onsuccess = () => { const db = r.result; try { const q = db.transaction('project').objectStore('project').getAllKeys(); q.onsuccess = () => { ok(q.result); db.close(); }; } catch { ok([]); db.close(); } }; r.onerror = () => ok(null); }));
    check('isolation: each project has its own document file (own project id, own variants); saving the second did not change the first',
      docA?.projectId === A.id && docB?.projectId === B.id && sha(docFile(A.id)) === A.saved && !docB.variants.some((v) => v.name === 'Variant B2' && !B.variants.includes(v.name)) && JSON.stringify(Object.keys(docB.variants[0].interiors ?? {})).indexOf(A.room.id) < 0,
      `${A.id}: ${docA?.variants?.length} variants; ${B.id}: ${docB?.variants?.length} variants; first file unchanged: ${sha(docFile(A.id)) === A.saved}`);
    check('isolation: device storage keys are scoped by project (localStorage ":<id>", IndexedDB record per project)',
      scopedA.length > 0 && scopedB.length > 0 && Array.isArray(idb) && idb.some((k) => String(k).endsWith(`:${A.id}`)) && idb.some((k) => String(k).endsWith(`:${B.id}`)), `localStorage: ${keys.join(' ')}; IndexedDB: ${JSON.stringify(idb)}`);
  });

  // ================================================================== project switch from Settings
  await stage('project switch', async () => {
    await open('sample-house');
    await click(T('settings'), 600);
    const opts = await page.$$eval(`${T('project-select')} option`, (o) => o.map((x) => x.value));
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }), page.select(T('project-select'), 'demo-apartment')]);
    await ready(); await sleep(800);
    const pr = await page.evaluate(() => window.__home.project()), v = await page.evaluate(() => window.__home.variants());
    check('Settings → Project: lists the installed projects; choosing another reloads the app on it (?project= in the URL) with its saved state',
      opts.includes('demo-apartment') && opts.includes('sample-house') && pr.id === 'demo-apartment' && new URL(page.url()).searchParams.get('project') === 'demo-apartment' && v.list.length === (readDoc('demo-apartment')?.variants.length ?? 1),
      `options ${opts.join(', ')} → ${pr.id}; ${page.url().replace(BASE, '')}; variants ${v.list.length}`);
    // a new tab without the parameter opens the project chosen last on the device
    const tab = await browser.newPage(); watch(tab, 'tab');
    await tab.goto(`${BASE}/?onboarding=off`, { waitUntil: 'load' }); await ready(tab);
    const last = await tab.evaluate(() => window.__home.project().id);
    await tab.close(); await page.bringToFront();
    check('the project chosen in Settings is remembered on the device (a new tab without ?project= opens it)', last === 'demo-apartment', last);
  });

  // ================================================================== language
  await stage('language', async () => {
    await open('demo-apartment');
    await click(T('settings'), 600);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }), page.select(T('language-select'), 'pl')]);
    await ready(); await sleep(800);
    const pl = await page.evaluate(() => ({ lang: document.documentElement.lang, nav: document.querySelector('[data-testid="nav-interiors"]')?.textContent.trim(), b: document.querySelector('[data-testid="nav-building"]')?.textContent.trim(), save: document.querySelector('[data-testid="save"]')?.textContent.trim() }));
    await shot('lang_pl');
    check(`language switch (Settings → Language → Polski): the page reloads in Polish — "${PL['section.interiors']}", "${PL['section.building.apartment']}", "${PL['shell.saved']}"`,
      pl.lang === 'pl' && pl.nav === PL['section.interiors'] && pl.b === PL['section.building.apartment'] && pl.save === PL['shell.saved'] && PL['section.interiors'] !== EN['section.interiors'], JSON.stringify(pl));
    await click(T('settings'), 600);
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }), page.select(T('language-select'), 'en')]);
    await ready(); await sleep(500);
    const en = await page.evaluate(() => ({ lang: document.documentElement.lang, nav: document.querySelector('[data-testid="nav-interiors"]')?.textContent.trim() }));
    check('…and back to English ("Interiors")', en.lang === 'en' && en.nav === EN['section.interiors'], JSON.stringify(en));
  });

  // ================================================================== broken package → readable error
  await stage('broken package', async () => {
    const bad = pkg('demo-apartment');
    bad.manifest.projectId = BROKEN_ID.replace(/_/g, '');            // stays a valid id; the index id differs
    delete bad.building.rooms;                                        // structural error
    mkdirSync(BROKEN, { recursive: true });
    writeFileSync(resolve(BROKEN, 'project.json'), JSON.stringify(bad));
    try {
      const idx = await (await fetch(`${BASE}/projects/index.json`)).json();
      const tab = await browser.newPage();
      await tab.goto(`${BASE}/?onboarding=off&project=${BROKEN_ID}`, { waitUntil: 'load' });
      await tab.waitForSelector(T('app-error'), { timeout: 30000 }).catch(() => {});
      const e = await tab.evaluate(() => ({ text: document.querySelector('[data-testid="app-error"]')?.innerText ?? '', cause: document.querySelector('[data-testid="app-error-cause"]')?.textContent ?? '', reload: !!document.querySelector('[data-testid="app-error-reload"]'), app: !!window.__home }));
      await tab.screenshot({ path: resolve(OUT, 'broken_package.png') });
      await tab.close(); await page.bringToFront();
      check(`broken package (projects/${BROKEN_ID}/ without building.rooms): listed in the index, the app shows a readable error with the cause and "Reload" instead of a blank page`,
        idx.projects.some((p) => p.id === BROKEN_ID) && e.text.includes(EN['errorUi.title']) && e.cause.includes(`Project package "${BROKEN_ID}" is invalid`) && /building/.test(e.cause) && e.reload && !e.app,
        `cause: "${e.cause.slice(0, 220)}"`);
    } finally { rmSync(BROKEN, { recursive: true, force: true }); }
    const idx2 = await (await fetch(`${BASE}/projects/index.json`)).json();
    check('the temporary package directory is removed again (index without it)', !existsSync(BROKEN) && !idx2.projects.some((p) => p.id === BROKEN_ID), idx2.projects.map((p) => p.id).join(', '));
  });

  check('no console errors / page exceptions (both projects)', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
} catch (e) {
  check('scenario completed', false, String(e?.stack ?? e).slice(0, 600));
  await shot('error');
} finally {
  rmSync(BROKEN, { recursive: true, force: true });
  await browser.close().catch(() => {});
  server.stop();
  rmSync(UD, { recursive: true, force: true });
  const fail = results.filter((r) => r.status === 'FAIL').length;
  writeFileSync(resolve(OUT, `${NAME}.json`), JSON.stringify({ at: new Date().toISOString(), renderer, profile, pass: results.length - fail, fail, results }, null, 1));
  console.log(`\n${results.length - fail} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
