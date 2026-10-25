// E2E — ELECTRICAL planner (section "Electrical"): plan view of a level with the project's points, + Add → catalogue →
// placing on a wall (plan and 3D), dragging along a wall, through a corner and into another room (one Undo each), invalid spots
// and non-blocking coordination warnings (door opening, window), height (− / + / typed / quick values), Duplicate, Delete,
// layers and label density, snapping, eye-level view, the global plan vs a variant's own layout, PDF export through the test hook
// (valid PDF, embedded fonts, one plan page per level), CSV / JSON in English, the site plan only for a project with a site,
// save + reload.
// Runs on both bundled projects (HOME_SIM_PROJECT=<id> — one). Needs dist/ (npx vite build) and poppler-utils (pdftotext,
// pdffonts, pdfinfo). Output: reports/e2e/verify_electrical/
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, ROOT, sleep, startServer, waitForApp } from './browser.mjs';

const OUT = resolve(ROOT, 'reports/e2e/verify_electrical');
mkdirSync(OUT, { recursive: true });
const PORT = 4331;

/**
 * Test data per project (bundled packages — projects/<id>/project.json). Plan points are LCS [x, y] inside a room near a wall:
 *  add — first socket (room, wall it lands on), along — a point further along the same wall, corner — a point on the next
 *  wall past the corner (path through the corner), other — a point in another room (room, wall), door / window — a point
 *  in a door opening / in front of a window, outside — far outside the building, wall3d — camera and a wall point for 3D work.
 */
const SCENES = {
  'demo-apartment': {
    levels: ['L1'], site: false, sourceIds: ['B1', 'S1', 'S2', 'S3', 'S4', 'S5', 'SW1', 'SW2', 'SW3', 'SW4'],
    add: { q: [2.7, 4.4], room: 'R2', wall: 'R2-w4' }, along: [2.7, 5.0],
    corner: { path: [[2.7, 6.45], [2.75, 6.55], [3.3, 6.55], [3.8, 6.55]], wall: 'R2-w3' },
    other: { path: [[3.8, 5.6], [5.0, 4.4], [5.0, 3.75]], room: 'R1', wall: 'R1-w3' },
    copyTo: { q: [8.55, 5.6], room: 'R2' },
    door: [2.66, 1.45], window: [6.3, 0.45], outside: [14, 12], emptyRoom: 'R3',
    wall3d: { room: 'R1', camera: [5.0, 1.4, 1.6], target: [5.0, 3.9, 1.1], at: [4.8, 3.89, 1.1], dir: [1, 0], wall: 'R1-w3' },
  },
  'sample-house': {
    levels: ['L0', 'L1'], site: true, sourceIds: ['B1', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'SW1', 'SW2', 'SW3', 'SW4'],
    add: { q: [9.5, 6.0], room: 'LK', wall: 'LK-w2' }, along: [9.5, 6.6],
    corner: { path: [[9.5, 7.35], [9.45, 7.5], [9.1, 7.5], [8.9, 7.5]], wall: 'LK-w3' },
    other: { path: [[8.0, 6.0], [4.5, 3.2], [3.15, 3.2]], room: 'H0', wall: 'H0-w2' },
    copyTo: { q: [9.5, 1.2], room: 'LK' },
    door: [3.56, 4.25], window: [6.0, 0.45], outside: [26, 22], emptyRoom: 'B0',
    wall3d: { room: 'LK', camera: [4.6, 5.6, 1.6], target: [9.7, 5.6, 1.1], at: [9.69, 5.0, 1.1], dir: [0, 1], wall: 'LK-w2' },
    garden: [15.0, 4.0],                                                   // > 2.5 m from the facade: a site-plan point
  },
};
const PROJECTS = process.env.HOME_SIM_PROJECT ? [process.env.HOME_SIM_PROJECT] : Object.keys(SCENES);

const results = [];
let prefix = '';
const check = (name, ok, detail = '') => { results.push({ name: `${prefix}${name}`, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${prefix}${name} | ${String(detail).slice(0, 340)}`); };
const near = (a, b, t) => Math.abs(a - b) <= t;
const pdftool = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 32 << 20 });
/** words of the UI that must not appear in an English export (Polish diacritics) */
const NOT_ENGLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/; // i18n-ok
/** technical data hidden in Home mode */
const TECH = /wallId|roomId|positionAlongWall|heightAFFL|"x":|lcs/;

const userdata = mkdtempSync(join(tmpdir(), 'hs-electrical-'));
const server = await startServer({ port: PORT, mode: 'preview', userdata });
const { browser, renderer, profile } = await launch({ viewport: { width: 1600, height: 950 } });
console.log(`renderer: ${profile} (${renderer})`);

async function runProject(PROJECT) {
  const S = SCENES[PROJECT];
  if (!S) { check('scene defined for the project', false, `no test data for "${PROJECT}"`); return; }
  prefix = `[${PROJECT}] `;
  console.log(`\n=== ${PROJECT}`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  let navigating = false;
  // a reload the test did not ask for (app update after dist/ was rebuilt during the run) invalidates the scenario
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && !navigating) consoleErrors.push(`unexpected page reload: ${f.url()} (was dist/ rebuilt during the run?)`); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`); });

  const URL = `${server.url}/?project=${PROJECT}&onboarding=off&lang=en&env=off&platform=desktop`;
  const T = (id) => `[data-testid="${id}"]`;
  const st = () => page.evaluate(() => window.__home.state());
  const s3 = (fn, ...a) => page.evaluate((fn, a) => window.__home3d[fn](...a), fn, a);
  const exists = async (s) => !!(await page.$(s));
  const text = (s) => page.$eval(s, (e) => e.textContent ?? '').catch(() => '');
  const shot = (n) => page.screenshot({ path: resolve(OUT, `${PROJECT}_${n}.png`) });
  const plan = () => page.evaluate(() => window.__home.electrical.plan());
  const rows = () => page.evaluate(() => window.__home.electrical.rows());
  const el3 = () => page.evaluate(() => window.__homeElectrical?.() ?? null);
  const pt = async (id) => (await plan()).points.find((p) => p.id === id) ?? null;
  const count = async () => (await plan()).points.length;
  const newest = async (before) => (await plan()).points.find((p) => !before.includes(p.id)) ?? null;
  const ids = async () => (await plan()).points.map((p) => p.id);
  const sel = async () => (await st()).selection;
  const session = () => page.evaluate(() => { const s = window.__home.electrical.session(); return s && { mode: s.mode, type: s.type, id: s.id, multi: s.multi, placed: s.placed, live: s.live, level: s.check.level, msg: s.check.messages, at: s.at, dragging: s.dragging }; });
  const elUi = () => page.evaluate(() => { const r = document.querySelector('[data-testid="home-app"]'); return { el: r?.dataset.el ?? null, layout: r?.dataset.layout ?? null }; });
  const uiSet = (patch) => page.evaluate((p) => window.__home.ui(p), patch);
  /** plan point (LCS) → screen; null — the plan is not shown */
  const P = (q) => page.evaluate((x, y) => { const svg = document.querySelector('[data-testid="el-plan-svg"]'); if (!svg) return null; const p = new DOMPoint(x, -y).matrixTransform(svg.getScreenCTM()); return [p.x, p.y]; }, q[0], q[1]);
  /** centre of a device symbol on the plan (screen) */
  const symAt = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-el-id="${id}"] .hit`)?.getBoundingClientRect(); return b ? [b.left + b.width / 2, b.top + b.height / 2] : null; }, id);
  const symCount = () => page.$$eval('[data-el-id]', (g) => g.length);
  const tap = async (p, wait = 450) => { await page.mouse.move(p[0], p[1]); await sleep(60); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(wait); };
  const click = async (s, wait = 400) => { const el = await page.$(s); if (!el) throw new Error(`no element ${s}`); await el.scrollIntoView(); await sleep(60); const b = await el.boundingBox(); if (!b) throw new Error(`element not visible ${s}`); await tap([b.x + b.width / 2, b.y + b.height / 2], wait); };
  const hover = async (p) => { await page.mouse.move(p[0] - 8, p[1]); await sleep(100); await page.mouse.move(p[0], p[1]); await sleep(300); };
  const key = async (mod, k) => { await page.keyboard.down(mod); await page.keyboard.press(k); await page.keyboard.up(mod); await sleep(350); };
  /** drag along a polyline of screen points; `each` after every segment, `probe` just before the release */
  async function dragPath(path, probe = null, steps = 10, each = null) {
    await page.mouse.move(path[0][0], path[0][1]); await sleep(60); await page.mouse.down(); await sleep(60);
    for (let k = 1; k < path.length; k++) { for (let i = 1; i <= steps; i++) { await page.mouse.move(path[k - 1][0] + ((path[k][0] - path[k - 1][0]) * i) / steps, path[k - 1][1] + ((path[k][1] - path[k - 1][1]) * i) / steps); await sleep(20); } if (each) await each(k); }
    await sleep(150);
    const out = probe ? await probe() : null;
    await page.mouse.up(); await sleep(450);
    return out;
  }
  const still = async () => { let p = null; for (let i = 0; i < 60; i++) { const c = JSON.stringify(await s3('camera')); if (c === p) return; p = c; await sleep(150); } };
  const pdfOf = async (opts, name) => {
    const r = await page.evaluate((o) => window.__home.electrical.pdf(o), opts);
    if (!r) return null;
    const buf = Buffer.from(r.base64, 'base64'), file = resolve(OUT, `${PROJECT}_${name}`);
    writeFileSync(file, buf);
    return { name: r.name, pages: r.pages, size: r.size, head: buf.subarray(0, 5).toString('latin1'), file };
  };

  try {
    navigating = true; await page.goto(URL, { waitUntil: 'load' }); navigating = false;
    await waitForApp(page);
    const proj = await page.evaluate(() => window.__home.project());
    check('0. project loaded (levels, modules)', proj.id === PROJECT && JSON.stringify(proj.levels) === JSON.stringify(S.levels), `${proj.name}: levels ${proj.levels.join(', ')}; modules ${proj.modules.join(', ') || '—'}`);

    // ================================================================== 1. entering the mode, plan view
    const e0 = await el3();
    check('1. outside the Electrical section the devices are part of the home, not editable; the navigation has "Electrical"', (await text(T('nav-electrical'))).includes('Electrical') && !e0?.on && !(await exists(T('el-workspace'))), `edit ${e0?.on}, shown ${e0?.show}`);
    await click(T('nav-electrical'), 1200);
    const tb = await page.$$eval(`${T('el-toolbar')} button`, (b) => b.map((x) => x.textContent.trim()));
    const ws = await elUi();
    check('2. the electrical workspace: toolbar Add · Layers · snapping · Undo · Redo · Export; Plan | 3D | eye-level switch; side panel with the device list',
      tb.length === 6 && tb[0] === 'Add' && tb[1] === 'Layers' && /cm|off/.test(tb[2]) && tb[3] === 'Undo' && tb[4] === 'Redo' && tb[5] === 'Export' && (await exists(T('el-view'))) && (await exists(T('section-electrical'))), tb.join(' · '));
    const lvl = await st();
    const roomsShown = await page.$$eval(`${T('el-plan-rooms')} [data-room]`, (t) => t.map((x) => x.dataset.room));
    const p0 = await plan(), onLevel = p0.points.filter((p) => roomsShown.includes(p.roomId)).map((p) => p.id).sort();
    const symIds = (await page.$$eval('[data-el-id]', (g) => g.map((x) => x.dataset.elId))).sort();
    await shot('01_plan');
    check('3. the PLAN opens first: the level with its rooms and the project\'s existing points as symbols',
      ws.el === '2d' && (await exists(T('el-plan-svg'))) && roomsShown.length >= 3 && onLevel.length > 0 && JSON.stringify(symIds) === JSON.stringify(onLevel), `level ${lvl.level}; rooms ${roomsShown.join(', ')}; symbols ${symIds.join(', ')}`);
    check('4. the plan of the project: all source points (ids from the package) present, global scope', S.sourceIds.every((id) => p0.points.some((p) => p.id === id)) && (await page.evaluate(() => window.__home.electrical.scope())) === 'global',
      `${p0.points.length} points: ${p0.points.map((p) => p.id).join(', ')}`);
    const levelOpts = await page.$$eval(`${T('el-level')} [data-value]`, (b) => b.map((x) => x.dataset.value));
    check(`5. level choice: one plan per level${S.site ? ' + the site plan (project with a site)' : ' — no site plan (project without a site)'}`, JSON.stringify(levelOpts) === JSON.stringify([...S.levels, ...(S.site ? ['SITE'] : [])]), levelOpts.join(' | '));

    // ================================================================== 6–8. + Add → catalogue → placing on a wall
    await click(T('el-add'));
    const cats = await page.$$eval(`${T('el-catalog')} h4`, (h) => h.map((x) => x.textContent.trim()));
    await shot('02_catalog');
    check('6. "+ Add" opens the catalogue: Sockets · Lighting · Controls · Smart Home · Network / Data · Sensors', cats.join('|') === 'Sockets|Lighting|Controls|Smart Home|Network / Data|Sensors' && (await text(T('el-device-socket-2'))).trim() === 'Double socket', cats.join(' · '));
    const pastA = (await st()).past, before = await ids();
    await click(T('el-device-socket-2'));
    const s1 = await session(), g1 = await P(S.add.q);
    await hover(g1);
    const s2 = await session(), tip = await text(T('el-place-tip')), ov = await page.$eval(T('el-place-overlay'), (g) => ({ level: g.dataset.level, room: g.dataset.room, wall: g.dataset.wall })).catch(() => null);
    await shot('03_ghost');
    check('7. picking a device goes straight to placing (no form): the bar names the device; the preview follows the pointer on the wall; the badge shows room, ↔ from the corner, ↕ height — no technical data',
      s1?.mode === 'new' && s1.type === 'socket-2' && !(await exists(T('el-catalog'))) && (await text(T('el-placebar-name'))) === 'Double socket' && !!s2?.live && s2.at?.roomId === S.add.room && ov?.level === 'ok' && /↔ \d\.\d\d m/.test(tip) && /↕ 0\.30 m/.test(tip) && !TECH.test(tip) && (await count()) === before.length,
      tip.replace(/\s+/g, ' '));
    await tap(g1);
    const G1 = await newest(before);
    check('8. a click places the device on the wall (type default height 30 cm); it stays selected with a card; one history entry',
      !!G1 && G1.type === 'socket-2' && G1.roomId === S.add.room && G1.wallId === S.add.wall && near(G1.heightAFFL, 0.3, 1e-6) && (await sel())?.id === G1.id && !(await session()) && (await st()).past === pastA + 1 && (await text(T('el-card-title'))) === 'Double socket',
      G1 ? `${G1.id}: ${G1.roomId} / ${G1.wallId} @ ${G1.positionAlongWall} m; card "${(await text(T('el-card-where'))).trim()}"` : 'no new point');
    if (!G1) throw new Error('the device was not placed — the rest of the scenario depends on it');
    const card = await text(T('el-card'));
    check('9. the card in Home mode has no technical data (wall ids, coordinates); actions Move · Duplicate · Delete; details under "More"', !TECH.test(card) && /Move/.test(card) && /Duplicate/.test(card) && /Delete/.test(card) && /More/.test(card) && !(await exists(T('el-form'))), card.replace(/\s+/g, ' ').slice(0, 140));

    // ================================================================== 10–14. dragging: along a wall, corner, another room
    const perf0 = await page.evaluate(() => window.__home.electrical.planPerf());
    const pastB = (await st()).past;
    let from = await symAt(G1.id);
    const mid = await dragPath([from, await P(S.along)], async () => ({ s: await session(), hl: await exists(T('el-active-wall')), tip: await text(T('el-place-tip')) }));
    const a1 = await pt(G1.id), perf1 = await page.evaluate(() => window.__home.electrical.planPerf());
    const k0 = await P([0, 0]), k1 = await P([1, 0]), pxPerM = Math.hypot(k1[0] - k0[0], k1[1] - k0[1]);
    const wantAlong = Math.hypot(S.along[0] - S.add.q[0], S.along[1] - S.add.q[1]);
    check('10. dragging moves the device along its wall (active wall highlighted, badge with distance); height kept; one history entry',
      a1.wallId === G1.wallId && near(Math.abs(a1.positionAlongWall - G1.positionAlongWall), wantAlong, 0.06) && near(a1.heightAFFL, 0.3, 1e-6) && (await st()).past === pastB + 1 && mid.s?.mode === 'move' && mid.s.dragging && mid.hl && /↔/.test(mid.tip),
      `${G1.positionAlongWall} → ${a1.positionAlongWall} m (pointer ${wantAlong.toFixed(2)} m, ${pxPerM.toFixed(0)} px/m)`);
    check('11. while dragging the plan drawing is not rebuilt (only the preview re-renders); the project changes once — on release', perf1.builds - perf0.builds <= 1 && perf1.overlay - perf0.overlay > 5,
      `plan drawing +${perf1.builds - perf0.builds}, stage +${perf1.stage - perf0.stage}, preview +${perf1.overlay - perf0.overlay}`);
    from = await symAt(G1.id);
    const walls = [], pastC = (await st()).past, cpath = [from];
    for (const q of S.corner.path) cpath.push(await P(q));
    await dragPath(cpath, () => shot('04_drag_corner'), 8, async () => walls.push((await session())?.at?.wallId));
    const a2 = await pt(G1.id);
    check('12. one continuous drag THROUGH THE CORNER onto the next wall — the device changes wall and orientation by itself; height kept; one history entry',
      walls[0] === G1.wallId && a2.wallId === S.corner.wall && a2.roomId === S.add.room && near(a2.heightAFFL, 0.3, 1e-6) && (await st()).past === pastC + 1, `walls on the way: ${walls.join(' → ')}; now ${a2.wallId}`);
    from = await symAt(G1.id);
    const rooms = [], pastD = (await st()).past, opath = [from];
    for (const q of S.other.path) opath.push(await P(q));
    const tipRoom = await dragPath(opath, async () => { await shot('05_drag_room'); return text(T('el-place-tip')); }, 10, async () => rooms.push((await session())?.at?.roomId));
    const a3 = await pt(G1.id), otherName = await page.$eval(`${T(`el-room-${S.other.room}`)} text`, (x) => x.textContent).catch(() => S.other.room);
    check('13. dragging into ANOTHER ROOM without delete + add: room, wall, distance and orientation follow; one history entry; still selected',
      a3.roomId === S.other.room && a3.wallId === S.other.wall && near(a3.heightAFFL, 0.3, 1e-6) && (await st()).past === pastD + 1 && (await sel())?.id === G1.id, `rooms on the way: ${rooms.join(' → ')}; ${a3.roomId} / ${a3.wallId}; badge "${tipRoom.replace(/\s+/g, ' ').slice(0, 80)}" (${otherName})`);
    await uiSet({ selection: null }); await sleep(250);
    await click(T('el-tb-undo'), 350);
    const u1 = await pt(G1.id);
    await click(T('el-tb-redo'), 350);
    check('14. "Undo" in the toolbar undoes the WHOLE drag (the device goes back to its room and wall), "Redo" restores it', u1.roomId === S.add.room && u1.wallId === S.corner.wall && (await pt(G1.id)).roomId === S.other.room, `${u1.roomId}/${u1.wallId} ↔ ${S.other.room}`);

    // ================================================================== 15–17. invalid spots, coordination warnings, delete
    from = await symAt(G1.id);
    const pastBad = (await st()).past;
    const bad = await dragPath([from, await P(S.outside)], async () => ({ s: await session(), lv: await page.$eval(T('el-place-overlay'), (g) => g.dataset.level).catch(() => null), tip: await text(T('el-tip-msg')) }));
    const a4 = await pt(G1.id);
    check('15. outside the building the preview is marked invalid; releasing there leaves the device where it was (no history entry, no error)',
      !!bad.s && !bad.s.live && (bad.lv === 'error' || bad.lv === null) && a4.roomId === a3.roomId && a4.wallId === a3.wallId && near(a4.positionAlongWall, a3.positionAlongWall, 1e-6) && (await st()).past === pastBad && consoleErrors.length === 0,
      `"${bad.tip}"; after release ${a4.roomId}/${a4.wallId} @ ${a4.positionAlongWall}`);
    await uiSet({ selection: null }); await sleep(250);
    await click(T('el-add')); await click(T('el-device-switch'));
    const dq = await P(S.door);
    await hover(dq);
    const doorS = await session(), doorMsg = await text(T('el-tip-msg')), nDoor = await count();
    await tap(dq);
    const stillPlacing = await session(), nDoor2 = await count();
    const wq = await P(S.window);
    await hover(wq);
    const winS = await session(), winMsg = await text(T('el-tip-msg')), beforeW = await ids();
    await shot('06_window_warning');
    await tap(wq);
    const W0 = await newest(beforeW);
    check('16. warnings do not block work — (light switch) door opening: red preview, nothing is placed there (placing goes on); window at switch height: amber preview with a note, the device can be placed',
      doorS?.level === 'error' && /door opening/i.test(doorMsg) && nDoor2 === nDoor && stillPlacing?.mode === 'new' && winS?.level === 'warn' && /window/i.test(winMsg) && (await count()) === nDoor + 1 && !!W0?.wallId,
      `door: ${doorS?.level} "${doorMsg}" | window: ${winS?.level} "${winMsg}" → ${W0?.id} @ ${W0?.wallId}`);
    await click(T('el-delete'), 350);
    const nDel = await count();
    await key('Control', 'KeyZ');
    const nDel2 = await count();
    await key('Control', 'KeyY');
    check('17. "Delete" on the card removes the device; Undo brings it back; Redo removes it again', nDel === nDoor && nDel2 === nDoor + 1 && (await count()) === nDoor && !(await pt(W0?.id ?? '-')), `${nDoor + 1} → ${nDel} → ${nDel2} → ${await count()}`);

    // ================================================================== 18. height
    await tap(await symAt(G1.id));
    const selH = await sel();
    check('17a. a tap on the device symbol selects it (card opens)', selH?.id === G1.id && (await exists(T('el-card'))), `selected ${JSON.stringify(selH)}`);
    if (selH?.id !== G1.id) { await uiSet({ selection: { kind: 'electrical', id: G1.id } }); await sleep(300); }
    const pastH = (await st()).past;
    await click(T('el-height-plus'), 250);
    const h1 = (await pt(G1.id)).heightAFFL;
    await click(T('el-height-minus'), 250); await click(T('el-height-minus'), 250);
    const h2 = (await pt(G1.id)).heightAFFL;
    const hv = await page.$(T('el-height-value')); await hv.click({ count: 3 }); await page.keyboard.type('112'); await page.keyboard.press('Enter'); await sleep(300);
    const h3 = (await pt(G1.id)).heightAFFL;
    const presets = await page.$$eval(`${T('el-height-presets')} button`, (b) => b.map((x) => x.textContent.trim()));
    await click(T('el-height-115'), 300);
    const h4 = (await pt(G1.id)).heightAFFL;
    check('18. height on the card — [+] / [−] by 5 cm, typing an exact value (112 cm), quick values 30 / 110 / 120 cm / above the worktop; every change = one history entry',
      near(h1, 0.35, 1e-6) && near(h2, 0.25, 1e-6) && near(h3, 1.12, 1e-6) && near(h4, 1.15, 1e-6) && presets.join('|') === '30 cm|110 cm|120 cm|above the worktop' && (await st()).past === pastH + 5,
      `30 → ${Math.round(h1 * 100)} → ${Math.round(h2 * 100)} → ${Math.round(h3 * 100)} → ${Math.round(h4 * 100)} cm; presets ${presets.join(' / ')}`);

    // ================================================================== 19. duplicate (copy)
    const nC = await count(), src = await pt(G1.id), beforeC = await ids();
    await click(T('el-duplicate'), 300);
    const cs = await session(), cname = await text(T('el-placebar-name'));
    const cq = await P(S.copyTo.q);
    await hover(cq); await tap(cq);
    const copy = await newest(beforeC);
    check('19. "Duplicate" gives a preview of the copy that goes straight onto any wall (another room); the copy has the original\'s type and height; the original is unchanged',
      cs?.mode === 'copy' && cname === 'Copy: Double socket' && (await count()) === nC + 1 && !!copy && copy.type === 'socket-2' && near(copy.heightAFFL, src.heightAFFL, 1e-6) && copy.roomId === S.copyTo.room && !!copy.wallId && JSON.stringify(await pt(G1.id)) === JSON.stringify(src) && (await sel())?.id === copy.id,
      copy ? `${copy.id} in ${copy.roomId} @ ${copy.wallId}, h ${Math.round(copy.heightAFFL * 100)} cm` : 'no copy');

    // ================================================================== 20. "Add multiple" series
    await uiSet({ selection: null }); await sleep(200);
    const nR = await count(), pastR = (await st()).past;
    await click(T('el-add')); await click(T('el-multi'), 250); await click(T('el-device-socket-1'));
    for (const q of [S.copyTo.q, S.along, S.add.q].map((q) => [q[0] + 0.0, q[1] + 0.35])) { const p = await P(q); await hover(p); await tap(p, 350); }
    const sR = await session(), barR = await text(T('el-placebar'));
    await shot('07_series');
    await click(T('el-placebar-done'), 300);
    check('20. "Add multiple": after picking a device further wall clicks add further devices (3) without the catalogue; nothing gets selected; "Done" ends the series',
      (await count()) === nR + 3 && sR?.multi && sR.placed === 3 && /added: 3/.test(barR) && /Done/.test(barR) && !(await session()) && !(await sel()) && (await st()).past === pastR + 3, barR.replace(/\s+/g, ' '));
    await click(T('el-add')); await click(T('el-multi'), 250); await click(T('el-panel-close'), 200);

    // ================================================================== 21. layers, labels, snapping
    const socketSyms = () => page.$$eval('[data-el-id]', (g) => g.filter((x) => /^socket/.test(x.dataset.type ?? '')).length);
    const symN = await symCount(), sockN = await socketSyms(), txt0 = await page.$$eval(`${T('el-plan-symbols')} text.halo`, (t) => t.length);
    await click(T('el-tb-layers'));
    await click(T('el-layer-sockets'), 350);
    const symN2 = await symCount(), sockN2 = await socketSyms();
    await click(T('el-layer-sockets'), 350);
    const symN3 = await symCount();
    await click(`${T('el-labels')} [data-value="id"]`, 400);
    const txt1 = await page.$$eval(`${T('el-plan-symbols')} text.halo`, (t) => t.map((x) => x.textContent));
    await click(`${T('el-labels')} [data-value="full"]`, 400);
    const txt2 = await page.$$eval(`${T('el-plan-symbols')} text.halo`, (t) => t.map((x) => x.textContent).join(' '));
    await shot('08_labels_full');
    await click(`${T('el-labels')} [data-value="none"]`, 300);
    await click(T('el-panel-close'), 200);
    check('21. layers: hiding "Sockets" hides the socket symbols only, showing it brings them back; labels on the plan: symbols only (default) → symbols + ID → full',
      sockN > 0 && sockN2 === 0 && symN2 === symN - sockN && symN3 === symN && txt0 === 0 && txt1.includes(G1.id) && txt2.length > txt1.join(' ').length,
      `symbols ${symN} → ${symN2} → ${symN3} (sockets ${sockN} → ${sockN2}); labels ${txt0} → ${txt1.length} ids → ${txt2.length} chars`);
    const snaps = [];
    for (let i = 0; i < 4; i++) { await click(T('el-tb-snap'), 150); snaps.push((await text(T('el-tb-snap-value'))).trim()); }
    check('22. snapping from the toolbar: 5 cm → 10 cm → off → 1 cm → 5 cm', snaps.join('|') === '10 cm|off|1 cm|5 cm', snaps.join(' → '));

    // ================================================================== 23. focus on a room, empty room
    // the room is made empty first (its points removed — one history entry each, undone afterwards)
    const pastE = (await st()).past;
    for (const p of (await plan()).points.filter((x) => x.roomId === S.emptyRoom)) await page.evaluate((id) => window.__home.electrical.remove(id), p.id);
    await uiSet({ selection: null }); await sleep(300);
    await tap(await P(await page.evaluate((id) => { const g = document.querySelector(`[data-testid="el-room-${id}"] polygon`); const b = g.getBBox(); return [b.x + b.width / 2, -(b.y + b.height / 2)]; }, S.emptyRoom)), 800);
    const stR = await st(), z1 = Number(await page.$eval(T('el-stage'), (s) => s.dataset.zoom)), empty = await text(T('el-empty'));
    await shot('09_room_focus');
    await click(T('el-empty-add'), 300);
    const sE = await session();
    await page.keyboard.press('Escape'); await sleep(250);
    await click(T('el-whole-house'), 500);
    for (let i = 0; i < 6 && (await st()).past > pastE; i++) await key('Control', 'KeyZ');
    check('23. tapping a room focuses it; a room without points: "No points in this room" + "Add the first socket" (placing starts at once); "Whole home" goes back',
      stR.roomId === S.emptyRoom && /No points in this room/i.test(empty) && sE?.mode === 'new' && sE.type === 'socket-2' && !(await st()).roomId, `room ${stR.roomId}, zoom ${z1}; "${empty.replace(/\s+/g, ' ').trim()}"`);

    // ================================================================== 24–26. 3D: points on the walls, placing and dragging in 3D, eye level
    await click(`${T('el-view')} [data-value="3d"]`, 600); await sleep(1500); await still();
    const v3 = await elUi(), e3 = await el3();
    check('24. Plan | 3D switch — 3D shows the same level, the devices as simple shapes on the walls', v3.el === '3d' && !(await exists(T('el-plan-svg'))) && !!e3?.on && e3.shown.includes(G1.id) && e3.instances >= S.sourceIds.length - 1, `shapes ${JSON.stringify(e3?.shapes)}; ${e3?.instances} instances`);
    const W = S.wall3d;
    await uiSet({ roomId: W.room, roomView: '3d', houseView: 'interior', selection: null, camera: { preset: 'room', n: Date.now() } }); await sleep(1200); await still();
    await uiSet({ camera: { preset: 'pose', n: Date.now(), pose: { position: W.camera, target: W.target, fov: 50 } } }); await sleep(800); await still();
    const n3 = await count(), past3 = (await st()).past, before3 = await ids();
    await click(T('el-add')); await click(T('el-device-switch'));
    const w3 = await s3('screenOfPoint', ...W.at);
    await hover(w3);
    const gh = await page.evaluate(() => { const g = window.__homeScene?.getObjectByName('ELECTRICAL_PREVIEW'); return g ? { wall: !!g.getObjectByName('ELECTRICAL_ACTIVE_WALL'), ghost: !!g.getObjectByName('ELECTRICAL_GHOST') } : null; });
    await shot('10_3d_ghost');
    await tap(w3);
    const S1 = await newest(before3);
    check('25. 3D: the preview follows the pointer on the walls (active wall highlighted); a click places a switch at its default height 110 cm; one history entry',
      !!gh?.ghost && !!S1 && (await count()) === n3 + 1 && S1.type === 'switch' && S1.roomId === W.room && S1.wallId === W.wall && near(S1.heightAFFL, 1.1, 1e-6) && (await st()).past === past3 + 1,
      S1 ? `${S1.id} @ ${S1.roomId}/${S1.wallId} ${S1.positionAlongWall} m, h ${S1.heightAFFL}; preview ${JSON.stringify(gh)}` : `nothing placed; preview ${JSON.stringify(gh)}`);
    if (S1) {
      const at3 = (await el3()).at[S1.id], d0 = await s3('screenOfPoint', at3.pos[0], at3.pos[1], at3.pos[2]), d1 = await s3('screenOfPoint', at3.pos[0] + W.dir[0] * 0.5, at3.pos[1] + W.dir[1] * 0.5, at3.pos[2]);
      const past4 = (await st()).past;
      await dragPath([d0, [d0[0] + Math.sign(d1[0] - d0[0]) * 14, d0[1]], d1]);
      const S2 = await pt(S1.id);
      check('26. 3D: dragging the device moves it along its wall (the camera stays — the drag takes precedence over orbiting); height kept; one history entry',
        S2.wallId === S1.wallId && near(Math.abs(S2.positionAlongWall - S1.positionAlongWall), 0.5, 0.08) && near(S2.heightAFFL, 1.1, 1e-6) && (await st()).past === past4 + 1, `${S1.positionAlongWall} → ${S2.positionAlongWall} m on ${S2.wallId}`);
    }
    await uiSet({ selection: null }); await sleep(200);
    await click(`${T('el-view')} [data-value="walk"]`, 600); await sleep(2200);
    const vw = await elUi(), stW = await st();
    await click(`${T('el-view')} [data-value="2d"]`, 800);
    const vb = await elUi(), stB = await st();
    check('27. eye-level view starts in the current room; back to the plan returns to that room', vw.el === 'walk' && stW.houseView === 'walk' && vb.el === '2d' && stB.houseView === 'interior' && stB.roomId === W.room && (await exists(T('el-plan-svg'))), `${vw.el} (${stW.houseView}) → ${vb.el}; room ${stB.roomId}`);
    await click(T('el-whole-house'), 400);

    // ================================================================== 28–29. "More" form; technical data only in Expert mode
    await tap(await symAt(G1.id));
    await click(T('el-more'), 300);
    const form = await text(T('el-form'));
    const setTxt = async (id, v) => { const el = await page.$(T(id)); await el.click({ count: 3 }); await page.keyboard.type(v); await page.keyboard.press('Enter'); await sleep(250); };
    await setTxt('el-label', 'by the desk'); await setTxt('el-circuit', 'C-04');
    const typed = await pt(G1.id);
    check('28. "More": type, label, Smart Home, circuit, notes, status — no technical fields; edits change the same device',
      /Type/.test(form) && /Label/.test(form) && /Smart Home/.test(form) && /Circuit/.test(form) && /Notes/.test(form) && !TECH.test(form) && typed.label === 'by the desk' && typed.circuitLabel === 'C-04' && typed.id === G1.id,
      `${JSON.stringify([typed.label, typed.circuitLabel])}; ${form.replace(/\s+/g, ' ').slice(0, 90)}`);
    await uiSet({ mode: 'expert' }); await sleep(300);
    const exJson = await page.evaluate(() => { const d = document.querySelector('[data-testid="expert-details"]'); if (d) d.open = true; return document.querySelector('[data-testid="el-json"]')?.textContent ?? ''; });
    await uiSet({ mode: 'home' }); await sleep(300);
    check('29. technical data (wallId, roomId, coordinates) only in Expert mode', /wallId/.test(exJson) && /lcs/.test(exJson) && !(await exists(T('el-json'))), exJson.replace(/\s+/g, ' ').slice(0, 80));
    await click(T('el-card-close'), 200);

    // ================================================================== 30. site plan (projects with a site only)
    let gardenId = null;
    if (S.site) {
      await click(`${T('el-level')} [data-value="SITE"]`, 800);
      const siteView = await page.$eval(T('el-plan-svg'), (s) => s.dataset.view).catch(() => null);
      const beforeX = await ids();
      await click(T('el-add')); await click(T('el-device-light'));
      const xq = await P(S.garden); await hover(xq); await tap(xq);
      const X1 = await newest(beforeX);
      gardenId = X1?.id ?? null;
      await shot('11_site');
      await uiSet({ selection: null }); await sleep(200);
      await click(`${T('el-level')} [data-value="${S.levels[0]}"]`, 800);
      check('30. site plan: its own view; a light clicked in the garden is a free point outside the building', siteView === 'SITE' && !!X1 && X1.type === 'light' && X1.roomId === 'EXT' && X1.orientation === 'free' && (await page.$eval(T('el-plan-svg'), (s) => s.dataset.view)) === S.levels[0],
        X1 ? `${X1.id} at (${X1.x}; ${X1.y}) in ${X1.roomId}` : 'no point placed on the site plan');
    } else check('30. no site plan: the level choice offers no "Site" and the plan never switches to it', !(await exists(`${T('el-level')} [data-value="SITE"]`)) && !(await st()).roomId, 'project without a site');

    // ================================================================== 31–34. PDF, CSV, JSON
    const all = await rows();
    const pdf = await pdfOf({ format: 'a4', groups: ['all'], furniture: false }, 'electrical_plan.pdf');
    let txt = '', fonts = '', info = '';
    try { txt = pdftool('pdftotext', ['-layout', pdf.file, '-']); fonts = pdftool('pdffonts', [pdf.file]); info = pdftool('pdfinfo', [pdf.file]); } catch (e) { txt = txt || `(${e.message})`; }
    const levelNames = await page.$$eval(`${T('el-level')} [data-value]`, (b) => b.map((x) => [x.dataset.value, x.textContent.trim()]));
    const titles = levelNames.map(([v, n]) => [v, (txt.match(new RegExp(`Electrical plan — ${n.replace(/[/]/g, '\\/')} — All`, 'g')) ?? []).length]);
    const tablePages = (txt.match(/Point table — all layers/g) ?? []).length;
    const hasSitePts = !!gardenId && !!(await pt(gardenId));                // points farther than 2.5 m from the facade print on the site page
    check('31. PDF from the test hook: a valid PDF (%PDF header), named electrical-plan-<date>.pdf, A4 landscape, fonts embedded',
      !!pdf && pdf.head === '%PDF-' && /^electrical-plan-\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.name) && pdf.size > 20000 && /DejaVu\S*\s.*\byes\b/.test(fonts) && /Page size:\s+841\.89 x 595\.2\d* pts/.test(info),
      `${pdf?.name}: ${pdf?.pages} pages, ${pdf?.size} B; fonts: ${fonts.split('\n').slice(2).map((l) => l.split(/\s+/)[0]).filter(Boolean).join(', ')}`);
    check(`32. PDF pages: one plan page per level${S.site ? ' (+ the site page when it has points)' : ''} and the point table; the page count reported by the hook matches`,
      titles.every(([v, n]) => (v === 'SITE' ? n === (hasSitePts ? 1 : 0) : n === 1)) && tablePages >= 1 && pdf.pages === S.levels.length + (S.site && hasSitePts ? 1 : 0) + tablePages && (info.match(/Pages:\s+(\d+)/)?.[1] ?? '') === String(pdf.pages),
      `${titles.map(([v, n]) => `${v}: ${n}`).join(', ')}; table pages ${tablePages}; total ${pdf.pages}`);
    const line = txt.split('\n').find((l) => new RegExp(`^\\s*${G1.id}\\s`).test(l) && /from the left corner/.test(l)) ?? '';  // table row (the plan also prints the id)
    check('33. PDF table in English: column headers, every point id, the moved device with its room, distance from the left corner, height and label',
      ['ID', 'Room', 'Type', 'Wall', 'Distance', 'Height', 'Description', 'Circuit'].every((c) => txt.includes(c)) && all.every((r) => new RegExp(`(^|\\s)${r.id}(\\s|$)`, 'm').test(txt)) && /cm from the left/.test(txt) && /115 cm/.test(line) && /by the desk/.test(line) && /C-04/.test(line) && !NOT_ENGLISH.test(txt),
      line.replace(/\s+/g, ' ').trim().slice(0, 200));
    const g1row = all.find((r) => r.id === G1.id);
    check('34. table rows (hook): English types, the moved device in its new room, height and distance in cm', !!g1row && g1row.roomId === S.other.room && g1row.height === 115 && g1row.type === 'Double 230 V socket' && typeof g1row.distance === 'number' && all.every((r) => !NOT_ENGLISH.test(JSON.stringify(r))),
      g1row ? `${g1row.id}: ${g1row.room} · ${g1row.type} · ${g1row.wall} · ${g1row.distance} cm · h ${g1row.height} cm` : 'missing');
    // exports from the UI: PDF button, CSV / JSON (blob contents captured)
    await page.evaluate(() => { window.__blobs = []; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return orig.call(URL, b); }; window.__homeExport = null; });
    await click(T('el-tb-export'));
    const groups = await page.$$eval(`${T('el-pdf-groups')} button`, (b) => b.map((x) => x.textContent.trim()));
    await click(T('el-export-pdf'), 0);
    await page.waitForFunction(() => window.__homeExport?.kind === 'pdf', { timeout: 30000 }).catch(() => {});
    const ex = await page.evaluate(() => window.__homeExport);
    await click(T('el-export-csv'), 500); const ec = await page.evaluate(() => window.__homeExport);
    const csv = await page.evaluate(async () => { const b = window.__blobs.filter((x) => /csv/.test(x.type)).at(-1); return b ? b.text() : ''; });
    await click(T('el-export-json'), 500); const ej = await page.evaluate(() => window.__homeExport);
    const json = await page.evaluate(async () => { const b = window.__blobs.filter((x) => /json/.test(x.type)).at(-1); return b ? b.text() : ''; });
    await click(T('el-panel-close'), 200);
    check('35. "Export" panel: PDF download (groups 230 V · Lighting · Data / LAN · Smart Home / sensors · All)', ex?.kind === 'pdf' && ex.pages === pdf.pages && groups.length === 5 && groups.at(-1) === 'All', `${JSON.stringify(ex)}; groups ${groups.join(' · ')}`);
    const csvLines = csv.replace(/^﻿/, '').trim().split('\r\n'), head = csvLines[0] ?? '', csvG1 = (csvLines.find((l) => l.startsWith(`${G1.id};`)) ?? '').split(';');
    check('36. CSV in English: header (ID;Room;Level;Type;…;X [m];Y [m];Z [m]), one line per point, English types, dot decimals',
      ec?.kind === 'csv' && ec.name === 'electrical-points.csv' && head.startsWith('ID;Room;Level;Type;Wall;Distance from left corner [cm]') && head.endsWith('X [m];Y [m];Z [m]') && csvLines.length === all.length + 1 && csvG1[3] === 'Double 230 V socket' && /^\d+\.\d+$|^\d+$/.test(csvG1[15] ?? '') && !NOT_ENGLISH.test(csv),
      `${csvLines.length - 1} lines; ${csvG1.slice(0, 5).join(';')} … ${csvG1.slice(15).join(';')}`);
    const jp = (() => { try { return JSON.parse(json); } catch { return null; } })();
    check('37. JSON export: schema, every point with room / wall / distances / LCS', ej?.kind === 'json' && jp?.schema === 'home-simulator/electrical-points' && jp.points.length === all.length && jp.points.every((p) => 'fromLeftCm' in p && 'lcs' in p), `${ej?.size} B, ${jp?.points?.length} points`);

    // ================================================================== 38–40. global plan vs the variant's own layout; save; reload
    await key('Control', 'KeyS');
    await page.waitForFunction(() => !window.__home.state().dirty, { timeout: 20000 }).catch(() => {});
    const DOC = join(userdata, PROJECT, 'document.json');
    const saved = existsSync(DOC) ? JSON.parse(readFileSync(DOC, 'utf8')) : null, total = await count();
    check('38. the plan is saved GLOBALLY in the project document (electrical field), no variant has its own layout', !!saved?.electrical && saved.electrical.points.length === total && saved.variants.every((v) => v.electrical === undefined) && saved.electrical.points.find((p) => p.id === G1.id)?.circuitLabel === 'C-04',
      `${saved?.electrical?.points.length} points in ${DOC.replace(userdata, '$HOME_SIM_USERDATA')}`);
    await click(T('el-tb-export')); await click(T('el-export-more'), 300);
    await click(`${T('el-scope-seg')} [data-value="variant"]`, 600);
    const scopeV = await page.evaluate(() => window.__home.electrical.scope());
    const vId = await page.evaluate((w) => window.__home.electrical.add('socket-1', { roomId: w.room, wallId: w.wall, positionAlongWall: 0.4, heightAFFL: 0.3, orientation: 'wall' }), S.wall3d);
    await sleep(300);
    const nV = await count();
    await key('Control', 'KeyS');
    await page.waitForFunction(() => !window.__home.state().dirty, { timeout: 20000 }).catch(() => {});
    const savedV = existsSync(DOC) ? JSON.parse(readFileSync(DOC, 'utf8')) : null, vv = savedV?.variants?.find((v) => v.electrical);
    await uiSet({ selection: null }); await sleep(200);
    await click(`${T('el-scope-seg')} [data-value="global"]`, 600);
    const scopeG = await page.evaluate(() => window.__home.electrical.scope());
    check('39. plan scope: "own layout of this variant" copies the plan into the variant (a new point lives only there, saved in the variant); back to "shared" restores the global plan',
      scopeV === 'variant' && !!vId && nV === total + 1 && vv?.electrical?.points?.length === total + 1 && savedV.electrical.points.length === total && scopeG === 'global' && (await count()) === total && !(await pt(vId)),
      `variant: ${nV} (saved ${vv?.electrical?.points?.length}); shared: ${await count()}`);
    await click(T('el-panel-close'), 200);
    await key('Control', 'KeyS');
    await page.waitForFunction(() => !window.__home.state().dirty, { timeout: 20000 }).catch(() => {});
    navigating = true; await page.reload({ waitUntil: 'load' }); navigating = false;
    await waitForApp(page); await sleep(1200);
    const back = await pt(G1.id);
    check('40. after a reload the plan comes from the project document (same devices, places and labels)', (await count()) === total && !!back && back.label === 'by the desk' && back.roomId === S.other.room && back.wallId === S.other.wall && near(back.heightAFFL, 1.15, 1e-6) && (await page.evaluate(() => window.__home.electrical.scope())) === 'global',
      `${await count()} devices; ${back?.id} ${back?.roomId}/${back?.wallId} h ${back?.heightAFFL}`);
  } catch (e) {
    check('scenario ran to the end', false, String(e?.stack ?? e).slice(0, 400));
    await shot('error').catch(() => {});
  } finally {
    check('no console / HTTP errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
    await ctx.close().catch(() => {});
  }
}

for (const p of PROJECTS) await runProject(p);
await browser.close();
server.stop();
rmSync(userdata, { recursive: true, force: true });
const pass = results.filter((r) => r.status === 'PASS').length, fail = results.length - pass;
writeFileSync(resolve(OUT, 'results.json'), JSON.stringify({ renderer, profile, results }, null, 2));
console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
