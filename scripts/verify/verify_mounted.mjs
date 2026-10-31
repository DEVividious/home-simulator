// E2E — WALL-MOUNTED OBJECTS: a TV on a wall dragged with the mouse (model/mountDrag.ts, scene/interaction.ts).
// Mandatory scenario: select → 1 cm right → 1 cm left → 5 cm → +3 cm height → grab near the edge (no jump) → corner (the wall
// stays put) → deliberate transfer to the neighbouring wall → Undo → Redo → transfer back → save → reload.
// Also: camera angles (straight on, 30°, 60°, steep 84°, near, far), no scene resize under the pressed pointer, one drag = one
// history entry, no scene rebuild, step buttons and arrow keys, the object stays in its room when dragged below the wall, a mirror
// dragged into a door opening passes to the room behind and returns when the pointer goes back onto its own wall.
// Measure: object travel against pointer travel computed from screen projections of wall points (px per metre) — independent
// of the engine code.
// Runs on both bundled projects (HOME_SIM_PROJECT=<id> — one). Needs dist/ (npx vite build). Output: reports/e2e/verify_mounted/
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, ROOT, sleep, startServer, waitForApp } from './browser.mjs';

const OUT = resolve(ROOT, 'reports/e2e/verify_mounted');
mkdirSync(OUT, { recursive: true });
const PORT = 4321;

/**
 * Scene of the test per project (data of the bundled packages — projects/<id>/project.json):
 * room, wall-mounted object, its wall (constant coordinate `at` on `axis`, normal into the room), the corner towards the
 * neighbouring wall and that wall (`dir` — direction along it away from the corner), camera side for oblique views,
 * corner camera, and a mirror next to a door (door range along the mirror's wall).
 */
const SCENES = {
  'demo-apartment': {
    room: 'R1', level: 'L1', floorZ: 0, id: 'arch-R1-tv',
    wall: { axis: 'y', at: 3.9, inward: [0, -1] },
    corner: [8.7, 3.9], next: { axis: 'x', at: 8.7, inward: [-1, 0], dir: -1 },
    // camera views [name, angle from the wall normal, distance from the object, height]
    straight: 3.2, views: [['straight on, 3.2 m', 0, 3.2, 1.5], ['30°', 30, 3.2, 1.5], ['60°', 60, 3.2, 1.5], ['near 1.6 m', 0, 1.6, 1.4], ['far 6 m (outside the room, cut-away walls)', 15, 6, 2.2]],
    viewSide: 1, cornerCam: { position: [5.6, 0.6, 1.7], target: [7.6, 3.6, 1.4], fov: 65 },
    mirror: { room: 'R2', id: 'arch-R2-mirror', wall: { axis: 'y', at: 4.02, inward: [0, 1] }, door: { from: 3.2, to: 4.1 } },
  },
  'sample-house': {
    room: 'LK', level: 'L0', floorZ: 0, id: 'arch-LK-tv-wall',
    wall: { axis: 'x', at: 3.42, inward: [1, 0] },
    corner: [3.42, 0.3], next: { axis: 'y', at: 0.3, inward: [0, 1], dir: 1 },
    straight: 4, views: [['straight on, 4 m', 0, 4, 1.5], ['30°', 30, 4, 1.5], ['60°', 60, 4, 1.5], ['near 1.6 m', 0, 1.6, 1.4], ['far 6.5 m (outside the room, cut-away walls)', 15, 6.5, 2.2]],
    viewSide: -1, cornerCam: { position: [7.2, 4.0, 1.7], target: [4.0, 0.8, 1.4], fov: 65 },
    mirror: { room: 'H0', id: 'arch-H0-mirror', wall: { axis: 'x', at: 3.3, inward: [-1, 0] }, door: { from: 3.8, to: 4.7 } },
  },
};
const PROJECTS = process.env.HOME_SIM_PROJECT ? [process.env.HOME_SIM_PROJECT] : Object.keys(SCENES);

const results = [];
let prefix = '';
const check = (name, ok, detail = '') => { results.push({ name: `${prefix}${name}`, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${prefix}${name} | ${String(detail).slice(0, 320)}`); };
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEAD = 4;                                                                 // pointer travel after which a press becomes a drag [px]

const userdata = mkdtempSync(join(tmpdir(), 'hs-mounted-'));
const server = await startServer({ port: PORT, mode: 'preview', userdata });
const { browser, renderer, profile } = await launch({ viewport: { width: 1600, height: 950 } });
console.log(`renderer: ${profile} (${renderer})`);

async function runProject(PROJECT) {
  const SCENE = SCENES[PROJECT];
  if (!SCENE) { check('scene defined for the project', false, `no test scene for "${PROJECT}"`); return; }
  prefix = `[${PROJECT}] `;
  console.log(`\n=== ${PROJECT}`);
  let ctx = await browser.createBrowserContext();                             // own storage (IndexedDB / localStorage) per project
  let page = await ctx.newPage();
  const consoleErrors = [];
  let navigating = false;
  const listen = (pg) => {
    pg.on('pageerror', (e) => consoleErrors.push(String(e)));
    pg.on('error', (e) => consoleErrors.push(`page crashed: ${e}`));
    // a reload the test did not ask for (app update after dist/ was rebuilt during the run) invalidates the scenario
    pg.on('framenavigated', (f) => { if (f === pg.mainFrame() && !navigating) consoleErrors.push(`unexpected page reload: ${f.url()} (was dist/ rebuilt during the run?)`); });
    pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  };
  listen(page);

  const { room: ROOM, id: TV } = SCENE;
  const URL = `${server.url}/?project=${PROJECT}&onboarding=off&lang=en&env=off&platform=desktop`;
  const T = (id) => `[data-testid="${id}"]`;
  const st = () => page.evaluate(() => window.__home.state());
  const s3 = (fn, ...a) => page.evaluate((fn, a) => window.__home3d[fn](...a), fn, a);
  const tv = () => page.evaluate((r, id) => window.__home.furniture(r, id), ROOM, TV);
  const drag = () => page.evaluate(() => window.__home.drag());
  const rect = () => page.evaluate(() => { const r = document.querySelector('.hm-viewport canvas, canvas').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  const shot = (n) => page.screenshot({ path: resolve(OUT, `${PROJECT}_${n}.png`) });
  const along = (f) => (SCENE.wall.axis === 'y' ? f.x : f.y), across = (f) => (SCENE.wall.axis === 'y' ? f.y : f.x);
  /** point of the object's wall: s — coordinate along the wall, z — LCS height */
  const onWall = (s, z) => (SCENE.wall.axis === 'y' ? [s, SCENE.wall.at, z] : [SCENE.wall.at, s, z]);
  const onNext = (s, z) => (SCENE.next.axis === 'x' ? [SCENE.next.at, s, z] : [s, SCENE.next.at, z]);
  /** LCS point → screen; a point outside the visible canvas is an error of the test setup (camera), not of the product */
  const scr = async (p) => {
    const q = await s3('screenOfPoint', ...p), r = await rect();
    if (!q || q[0] < r[0] || q[0] > r[0] + r[2] || q[1] < r[1] || q[1] > r[1] + r[3]) throw new Error(`point ${p.map((v) => v.toFixed(2)).join(', ')} is outside the canvas (${q?.map(Math.round)}) — camera setup`);
    return q;
  };
  const frames = (n = 2) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  /** the camera has settled: the same pose in consecutive readings and the camera aspect matches the canvas */
  const still = async () => {
    let prev = null;
    for (let i = 0; i < 60; i++) { const c = await s3('camera'); const k = JSON.stringify(c); if (k === prev && c && Math.abs(c.aspect - c.canvasAspect) < 1e-3) break; prev = k; await sleep(150); }
    await frames(2);
  };
  const setCamera = async (position, target, fov = 50) => { await page.evaluate((pose) => window.__home.ui({ camera: { preset: 'pose', n: Date.now(), pose } }), { position, target, fov }); await sleep(600); await still(); };
  const enter = async (room = ROOM) => { await page.evaluate((r, l) => window.__home.ui({ roomId: r, level: l, section: 'arrange', arrangeTab: 'furniture', houseView: 'interior', roomView: '3d', selection: null, camera: { preset: 'room', n: Date.now() } }), room, SCENE.level); await sleep(1500); await still(); };
  const open = async () => { navigating = true; await page.goto(URL, { waitUntil: 'load' }); navigating = false; await waitForApp(page); await page.waitForFunction(() => !!window.__home3d, { timeout: 60000 }); await enter(); };
  const keys = async (...ks) => { for (const k of ks.slice(0, -1)) await page.keyboard.down(k); await page.keyboard.press(ks.at(-1)); for (const k of ks.slice(0, -1).reverse()) await page.keyboard.up(k); await sleep(450); };

  /** drag: press at `from`, move through screen points, release (or not) */
  async function press(from) { await page.mouse.move(from[0], from[1]); await sleep(120); await page.mouse.down(); await sleep(60); }
  async function moveTo(from, to) {
    // one event per pixel for short (precision) moves; longer moves — one event per 3 px (the step limit is per pointer travel)
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.max(2, Math.ceil(len <= 40 ? len : len / 3));
    for (let i = 1; i <= n; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n);
    await frames(2);
  }
  // the next press comes later than the double-click interval (a double click re-centres the orbit)
  const release = async () => { await page.mouse.up(); await sleep(650); };

  try {
    await open();
    const f0 = await tv();
    if (!f0) throw new Error(`no object ${TV} in room ${ROOM}`);
    const dims = (await st()).arrangement.furniture.find((f) => f.id === TV).dims;
    const elev0 = f0.elevation ?? 0;
    const zc = SCENE.floorZ + elev0 + dims.h / 2, s0 = along(f0);
    const inw = SCENE.wall.inward, eye = (deg, dist, h) => {
      // camera: rotated about the vertical axis by `deg` from the wall normal, `dist` from the object centre
      const a = (deg * Math.PI) / 180, t = [-inw[1], inw[0]];
      const c = SCENE.wall.axis === 'y' ? [s0, SCENE.wall.at] : [SCENE.wall.at, s0];
      return [c[0] + (inw[0] * Math.cos(a) - t[0] * Math.sin(a)) * dist, c[1] + (inw[1] * Math.cos(a) - t[1] * Math.sin(a)) * dist, h];
    };
    await setCamera(eye(0, SCENE.straight, 1.5), onWall(s0, zc));
    /** px per metre along the wall and vertically at the object + their screen directions */
    const metric = async (s = null, z = null) => {
      const now = s === null ? await tv() : null, sa = s ?? along(now), za = z ?? SCENE.floorZ + (now.elevation ?? elev0) + dims.h / 2;
      const c = await scr(onWall(sa, za)), cu = await scr(onWall(sa + 0.1, za)), cv = await scr(onWall(sa, za + 0.1));
      const pu = Math.hypot(cu[0] - c[0], cu[1] - c[1]) / 0.1, pv = Math.hypot(cv[0] - c[0], cv[1] - c[1]) / 0.1;
      return { c, pu, pv, du: [(cu[0] - c[0]) / (pu * 0.1), (cu[1] - c[1]) / (pu * 0.1)], dv: [(cv[0] - c[0]) / (pv * 0.1), (cv[1] - c[1]) / (pv * 0.1)] };
    };
    let M = await metric();
    /** drags the object by a distance in metres (ds along the wall, dz vertically) from the grab point `grab` (default: its centre) */
    async function dragBy(ds, dz, grab = null) {
      M = await metric();
      const g = grab ?? M.c;
      const len = Math.hypot(ds * M.pu, dz * M.pv), dir = [(M.du[0] * ds * M.pu + M.dv[0] * dz * M.pv) / len, (M.du[1] * ds * M.pu + M.dv[1] * dz * M.pv) / len];
      await press(g);
      const a = [g[0] + dir[0] * DEAD, g[1] + dir[1] * DEAD];
      await moveTo(g, a);                                                        // dead zone: the object does not move yet
      const at0 = await drag();
      await moveTo(a, [a[0] + dir[0] * len, a[1] + dir[1] * len]);
      const at1 = await drag();
      await release();
      return { at0, at1, after: await tv() };
    }

    // ================================================================== 0. start, scene size under the pressed pointer
    const before = await st();
    check('0. wall-mounted object in the room; nothing selected', !before.selection && !!f0, `${TV}: along the wall ${r3(s0)}, bottom ${r3(elev0)} m, ${dims.w} × ${dims.h} m`);
    const r0 = await rect();
    await press(M.c); await moveTo(M.c, [M.c[0] + M.du[0] * 14, M.c[1] + M.du[1] * 14]);
    const rDrag = await rect(), dJump = await drag();
    await page.keyboard.press('Escape'); await release();
    const expect14 = (14 - DEAD) / M.pu;
    check('0a. grabbing an UNSELECTED object: the scene keeps its size under the pressed pointer; 14 px of pointer = the same distance on the wall',
      JSON.stringify(r0) === JSON.stringify(rDrag) && !!dJump.item && Math.abs(Math.abs(along(dJump.item) - s0) - expect14) < 0.012,
      `scene ${r0[2]} → ${rDrag[2]} px; 14 px → ${r3(Math.abs(along(dJump.item ?? f0) - s0))} m (expected ${r3(expect14)} m)`);
    const s0b = await st();
    check('0b. Escape during a drag cancels only the drag (room open, object unchanged, no history entry)',
      s0b.roomId === ROOM && along(await tv()) === s0 && s0b.past === before.past, `room ${s0b.roomId}, history ${before.past} → ${s0b.past}`);

    // ================================================================== 1. selection
    await page.mouse.click(M.c[0], M.c[1]); await sleep(700); await still();
    const sel = (await st()).selection;
    check('1. a click selects the object; the card shows its position on the wall, the object bar has the four nudges (no turning)', sel?.kind === 'furniture' && sel.id === TV && !!(await page.$(T('mount'))) && !!(await page.$(T('obj-up'))) && !(await page.$(T('obj-rotate-left'))),
      `${JSON.stringify(sel)}; ${await page.$eval(T('mount-along'), (e) => e.textContent).catch(() => '—')} from the corner, ${await page.$eval(T('mount-height'), (e) => e.textContent).catch(() => '—')}`);
    M = await metric();                                                          // inspector open — the scene has a new size
    const past0 = (await st()).past;

    // ================================================================== 2–4. 1 cm right, 1 cm left, 5 cm
    const sR = Math.sign((await scr(onWall(s0 + 0.1, zc)))[0] - M.c[0]);         // which wall direction is "right" on screen
    const a2 = await dragBy(sR * 0.01, 0);
    check('2. drag about 1 cm right: the object moves 1 cm; height and distance from the wall unchanged',
      Math.abs((along(a2.after) - s0) * sR - 0.01) < 0.0051 && Math.abs(across(a2.after) - across(f0)) < 0.011 && (a2.after.elevation ?? elev0) === elev0,
      `Δ along the wall ${r3((along(a2.after) - s0) * sR)} m; across ${r3(across(a2.after) - across(f0))} m`);
    check('2a. dead zone without a jump: after the drag threshold the object stays put', !!a2.at0.item && Math.abs(along(a2.at0.item) - s0) < 0.0051, `Δ ${r3(along(a2.at0.item ?? f0) - s0)} m`);
    const s2 = along(a2.after);
    const a3 = await dragBy(-sR * 0.01, 0);
    check('3. drag about 1 cm left: the object comes back', Math.abs(along(a3.after) - (s2 - sR * 0.01)) < 0.0051, `Δ ${r3((along(a3.after) - s2) * sR)} m`);
    const s3v = along(a3.after);
    const a4 = await dragBy(sR * 0.05, 0);
    check('4. drag about 5 cm', Math.abs((along(a4.after) - s3v) * sR - 0.05) < 0.0051, `Δ ${r3((along(a4.after) - s3v) * sR)} m`);

    // ================================================================== 5. height
    const a5 = await dragBy(0, 0.03);
    check('5. small height change: +3 cm, no sideways movement', Math.abs((a5.after.elevation ?? elev0) - elev0 - 0.03) < 0.0051 && Math.abs(along(a5.after) - along(a4.after)) < 0.0051,
      `bottom ${r3(elev0)} → ${r3(a5.after.elevation ?? elev0)} m; sideways ${r3(along(a5.after) - along(a4.after))} m`);
    check('5a. every drag = one history entry (4 moves → 4 entries)', (await st()).past === past0 + 4, `${past0} → ${(await st()).past}`);

    // ================================================================== 6–7. grab near the edge — no jump
    const cur = await tv(), zNow = SCENE.floorZ + (cur.elevation ?? elev0) + dims.h / 2;
    const edge = await scr(onWall(along(cur) + sR * dims.w * 0.42, zNow + dims.h * 0.3));
    const a6 = await dragBy(sR * 0.02, 0, edge);
    check('6–7. grab near the edge (84% of the width from the axis): the reference point does NOT jump under the pointer; 2 cm of pointer = 2 cm of object',
      !!a6.at0.item && Math.abs(along(a6.at0.item) - along(cur)) < 0.0051 && Math.abs((along(a6.after) - along(cur)) * sR - 0.02) < 0.0051,
      `after the grab Δ ${r3(along(a6.at0.item ?? cur) - along(cur))} m; after the move Δ ${r3((along(a6.after) - along(cur)) * sR)} m`);
    await shot('01_fine');

    // ================================================================== 8–9. corner: the wall stays put
    const cornerS = SCENE.wall.axis === 'y' ? SCENE.corner[0] : SCENE.corner[1], sign = Math.sign(cornerS - s0);
    const nextSign = SCENE.next.dir;                                             // direction along the neighbouring wall away from the corner
    const cornerOnNext = SCENE.next.axis === 'x' ? SCENE.corner[1] : SCENE.corner[0];
    await setCamera(SCENE.cornerCam.position, SCENE.cornerCam.target, SCENE.cornerCam.fov);
    const c8 = await tv(), z8 = SCENE.floorZ + (c8.elevation ?? elev0) + dims.h / 2;
    const g8 = await scr(onWall(along(c8), z8));
    await shot('02_corner_view');
    const past8 = (await st()).past;
    await press(g8);
    // the pointer runs ALONG THE WALL to the corner, then 8 cm past it on the neighbouring wall and back — 6 times
    const nearCorner = await scr(onWall(cornerS - sign * 0.03, z8));
    await moveTo(g8, nearCorner);
    const surf0 = (await drag()).mount?.surfaceId;
    const seen = new Set();
    let prev = nearCorner;
    for (let i = 0; i < 6; i++) {
      const p = await scr(i % 2 ? onWall(cornerS - sign * 0.05, z8) : onNext(cornerOnNext + nextSign * 0.08, z8));
      await moveTo(prev, p); prev = p;
      seen.add((await drag()).mount?.surfaceId);
    }
    const d9 = await drag();
    check('8a. the grab in front of the corner hits the wall-mounted object (it is dragged on its mounting surface)', !!surf0 && d9.item?.id === TV, `surface ${surf0}; dragged ${d9.item?.id}`);
    check('8. dragging into the corner: the object reaches the corner with its edge and stays on its wall',
      d9.mount?.surfaceId === surf0 && Math.abs(Math.abs(cornerS - along(d9.item)) - dims.w / 2) < 0.011, `surface ${d9.mount?.surfaceId}; axis ${r3(Math.abs(cornerS - along(d9.item ?? c8)))} m from the corner (half width ${dims.w / 2})`);
    check('9. pointer jitter around the corner (±8 cm, 6 passes) does not switch the wall', seen.size === 1 && [...seen][0] === surf0, [...seen].join(' / '));

    // ================================================================== 10. deliberate transfer to the neighbouring wall
    const far = await scr(onNext(cornerOnNext + nextSign * 1.2, z8));
    await moveTo(prev, far);
    const d10 = await drag();
    await shot('03_transfer');
    await release();
    const t10 = await tv(), pastT = (await st()).past, m10 = await page.evaluate((r, id) => window.__home.mounted(r, id), ROOM, TV);
    const onNextWall = t10 && Math.abs((SCENE.next.axis === 'x' ? t10.x : t10.y) - (SCENE.next.at + (SCENE.next.axis === 'x' ? SCENE.next.inward[0] : SCENE.next.inward[1]) * (dims.d / 2 + 0.005))) < 0.02;
    check('10. dragging clearly onto the neighbouring wall moves the object there: new surface, back to the new wall, height kept, mount record in the document',
      !!d10.mount && d10.mount.surfaceId !== surf0 && onNextWall && !!t10.mount && m10?.surfaceId === d10.mount.surfaceId && Math.abs((t10.elevation ?? elev0) - (c8.elevation ?? elev0)) < 0.0051,
      `${surf0} → ${d10.mount?.surfaceId}; x ${r3(t10.x)} y ${r3(t10.y)} rot ${t10.rot}; mount ${JSON.stringify(t10.mount)}`);
    check('10a. the whole drag including the transfer = one history entry', pastT === past8 + 1, `${past8} → ${pastT}`);
    // the grab along the wall carries over: an object grabbed at its axis has the axis UNDER the pointer on the new wall
    // (the drag threshold: the grab forms after 4 px of travel towards the corner, so the axis lags the pointer by that much)
    const Mn = await (async () => { const a = await scr(onNext(cornerOnNext + nextSign * 1.2, z8)), b = await scr(onNext(cornerOnNext + nextSign * 1.3, z8)); return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1; })();
    const fromCorner10 = t10 ? ((SCENE.next.axis === 'x' ? t10.y : t10.x) - cornerOnNext) * nextSign : NaN, want10 = 1.2;
    check('10b. after the transfer the object axis is under the pointer: pointer 1.20 m from the corner on the new wall → object axis there (± 2.5 cm + drag threshold)', Math.abs(fromCorner10 - want10) < 0.025 + DEAD / Mn, `axis ${r3(fromCorner10)} m from the corner (expected ${want10} m)`);

    // ================================================================== 11–12. Undo / Redo
    await keys('Control', 'KeyZ');
    const u11 = await tv();
    check('11. Undo: the object returns to the first wall at the same spot', Math.abs(along(u11) - along(c8)) < 1e-6 && Math.abs(across(u11) - across(c8)) < 1e-6 && u11.rot === c8.rot, `x ${u11.x} y ${u11.y} rot ${u11.rot}`);
    await keys('Control', 'Shift', 'KeyZ');
    const u12 = await tv();
    check('12. Redo: the object is on the neighbouring wall again', JSON.stringify(u12) === JSON.stringify(t10), `x ${u12.x} y ${u12.y} rot ${u12.rot}`);

    // ================================================================== 12a. transfer back to the first wall
    {
      const pastB = (await st()).past, m = await page.evaluate((r, id) => window.__home.mounted(r, id), ROOM, TV);
      const zB = SCENE.floorZ + (u12.elevation ?? elev0) + dims.h / 2, sB = (SCENE.next.axis === 'x' ? u12.y : u12.x);
      const gB = await scr(onNext(sB, zB)), tgt = cornerS - sign * 1.5;
      await press(gB);
      await moveTo(gB, await scr(onNext(cornerOnNext + nextSign * 0.3, zB)));
      await moveTo(await scr(onNext(cornerOnNext + nextSign * 0.3, zB)), await scr(onWall(tgt, zB)));
      const dB = await drag();
      await release();
      const back = await tv(), mB = await page.evaluate((r, id) => window.__home.mounted(r, id), ROOM, TV);
      check('12a. transfer BACK: dragged from the neighbouring wall onto the first one, the object hangs on its first surface again under the pointer; one history entry',
        m?.surfaceId !== surf0 && mB?.surfaceId === surf0 && dB.mount?.surfaceId === surf0 && Math.abs(along(back) - tgt) < 0.06 && Math.abs(across(back) - across(c8)) < 1e-3 && (await st()).past === pastB + 1,
        `${m?.surfaceId} → ${mB?.surfaceId}; axis ${r3(along(back))} (pointer ${r3(tgt)}); history +${(await st()).past - pastB}`);
      await keys('Control', 'KeyZ');                                             // back on the neighbouring wall for the save
    }

    // ================================================================== 13–14. save and reload
    const saved0 = await tv();
    await keys('Control', 'KeyS');
    await page.waitForFunction(() => !window.__home.state().dirty, { timeout: 20000 }).catch(() => {});
    const DOC = join(userdata, PROJECT, 'document.json');
    const file = existsSync(DOC) ? JSON.parse(readFileSync(DOC, 'utf8')) : null;
    const savedRec = (() => { for (const v of file?.variants ?? []) for (const a of v.interiors?.[ROOM]?.arrangements ?? []) { const f = a.furniture?.find((x) => x.id === TV); if (f) return f; } return null; })();
    check('13. save: the project document file holds the mount record (wall, distance, height) and the computed position', !!savedRec?.mount && savedRec.mount.wallId === saved0.mount?.wallId && Math.abs(savedRec.mount.u - saved0.mount.u) < 1e-6 && savedRec.x === saved0.x && savedRec.y === saved0.y,
      `${DOC.replace(userdata, '$HOME_SIM_USERDATA')}: ${JSON.stringify(savedRec?.mount ?? null)}`);
    navigating = true; await page.reload({ waitUntil: 'load' }); navigating = false;
    await waitForApp(page); await enter();
    const r14 = await tv(), m14 = await page.evaluate((r, id) => window.__home.mounted(r, id), ROOM, TV);
    check('14. after a reload the object is where it was saved (same mount record and surface)', JSON.stringify(r14) === JSON.stringify(saved0) && m14?.surfaceId === m10?.surfaceId, `x ${r14?.x} y ${r14?.y} rot ${r14?.rot} mount ${JSON.stringify(r14?.mount)}`);

    // ================================================================== A–D on the project defaults: fresh device storage, no saved document
    await ctx.close();
    rmSync(DOC, { force: true });
    ctx = await browser.createBrowserContext();
    page = await ctx.newPage(); listen(page);
    await open();
    const base = await tv();
    check('A0. fresh start (no saved document, new device storage): the object is back at its project position', Math.abs(along(base) - s0) < 1e-6 && Math.abs(across(base) - across(f0)) < 1e-6, `along ${r3(along(base))} (project ${r3(s0)})`);
    const sB = along(base), zB = SCENE.floorZ + (base.elevation ?? elev0) + dims.h / 2;

    // ================================================================== A. camera angles
    const side = SCENE.viewSide;
    for (const [name, deg, dist, h] of SCENE.views) {
      await setCamera(eye(deg * side, dist, h), onWall(sB, zB));
      const orNull = (q) => scr(q).catch(() => null);
      const c = await orNull(onWall(sB, zB)), cu = await orNull(onWall(sB + 0.1, zB)), cv = await orNull(onWall(sB, zB + 0.1));
      if (!c || !cu || !cv) { check(`A. camera ${name}`, false, 'object out of frame (camera setup)'); continue; }
      const pu = Math.hypot(cu[0] - c[0], cu[1] - c[1]) / 0.1, du = [(cu[0] - c[0]) / (pu * 0.1), (cu[1] - c[1]) / (pu * 0.1)];
      await press(c);
      const a = [c[0] + du[0] * DEAD, c[1] + du[1] * DEAD], b = [a[0] + du[0] * 12, a[1] + du[1] * 12];
      await moveTo(c, a); await moveTo(a, b);
      const d = await drag();
      await shot(`04_view_${deg}_${dist}`);
      await page.keyboard.press('Escape'); await release();
      const moved = d.item ? along(d.item) - sB : NaN, want = 12 / pu;
      check(`A. camera ${name}: 12 px of pointer = ${r3(want)} m on the wall (${Math.round(pu)} px/m) — the object follows the pointer, no jump, no movement across`,
        // accuracy: 1 cm grid + one pixel (an event used to recompute the grab while the camera settles)
        d.item?.id === TV && Math.abs(moved - want) < 0.006 + 1.5 / pu && Math.abs(across(d.item) - across(base)) < 1e-6 && d.mount?.surfaceId === surf0, `dragged ${d.item?.id}: ${r3(moved)} m`);
    }
    // steep angle: the camera looks almost along the wall — the object step per pixel is limited
    await setCamera(eye(84 * side, 3.2, zB), onWall(sB, zB));
    {
      const c = await scr(onWall(sB, zB)), cu = await scr(onWall(sB + 0.1, zB));
      const pu = Math.hypot(cu[0] - c[0], cu[1] - c[1]) / 0.1, du = [(cu[0] - c[0]) / (pu * 0.1), (cu[1] - c[1]) / (pu * 0.1)];
      const cam = await s3('camera'), at = onWall(sB, zB), dist = Math.hypot(cam.position[0] - at[0], cam.position[1] - at[1], cam.position[2] - at[2]);
      const frontal = (2 * Math.tan((cam.fov * Math.PI) / 360) * dist) / (await rect())[3];    // metres per pixel on the frontal plane
      await press(c); await moveTo(c, [c[0] + du[0] * DEAD, c[1] + du[1] * DEAD]);
      let last = along((await drag()).item ?? base), worst = 0, total = 0, item = null;
      for (let i = 1; i <= 15; i++) {
        await page.mouse.move(c[0] + du[0] * (DEAD + i), c[1] + du[1] * (DEAD + i)); await frames(1);
        item = (await drag()).item; const now = item ? along(item) : last; worst = Math.max(worst, Math.abs(now - last)); total += now - last; last = now;
      }
      await shot('05_steep');
      await page.keyboard.press('Escape'); await release();
      check(`A. steep camera (84°, ${Math.round(pu)} px/m along the wall): one pixel moves the object at most 3 × the frontal pixel (+ 1 cm grid) — no jumps`,
        item?.id === TV && worst <= 3 * frontal + 0.0101 && Math.abs(total) > 0.02, `largest step ${r3(worst)} m per pixel (frontal pixel ${r3(frontal)} m; unlimited projection ${r3(1 / pu)} m / px); 15 px → ${r3(total)} m`);
    }

    // ================================================================== B. no scene rebuild, transient state
    await setCamera(eye(0, SCENE.straight, 1.5), onWall(sB, zB));
    const info0 = await s3('renderInfo'), pastB = (await st()).past;
    const cB = await scr(onWall(sB, zB));
    await press(cB); await moveTo(cB, [cB[0] + 60, cB[1] - 10]);
    const mid = await st(), midTv = await tv(), midDrag = await drag();
    await moveTo([cB[0] + 60, cB[1] - 10], cB);
    await page.keyboard.press('Escape'); await release();
    const info1 = await s3('renderInfo');
    check('B. during a drag the project does not change (transient state), after cancelling — no trace in the history', !!midDrag.item && mid.past === pastB && along(midTv) === sB && (await st()).past === pastB && along(await tv()) === sB, `history ${pastB} / during ${mid.past} / after ${(await st()).past}`);
    check('B. dragging does not rebuild the scene: geometries, textures and programs unchanged', info0.memory.geometries === info1.memory.geometries && info0.memory.textures === info1.memory.textures && info0.memory.programs === info1.memory.programs,
      `geometries ${info0.memory.geometries} → ${info1.memory.geometries}, textures ${info0.memory.textures} → ${info1.memory.textures}, programs ${info0.memory.programs} → ${info1.memory.programs}`);

    // ================================================================== C. step buttons and arrows (precision without aiming)
    await page.mouse.click(cB[0], cB[1]); await sleep(700); await still();
    const n0 = await tv(), pastC = (await st()).past;
    await page.click(T('obj-up')); await sleep(250);
    for (let i = 0; i < 5; i++) { await page.click(T('obj-left')); await sleep(200); }
    const n1 = await tv(), cB2 = await scr(onWall(along(n1), zB + 0.01)), sR2 = Math.sign((await scr(onWall(along(n1) + 0.1, zB + 0.01)))[0] - cB2[0]);
    check('C. nudges in the object bar: ▲ +1 cm height, ◀ five times 5 cm along the wall (to the left on screen), one history entry each',
      Math.abs((n1.elevation ?? 0) - (n0.elevation ?? elev0) - 0.01) < 1e-6 && Math.abs((along(n1) - along(n0)) * sR2 + 0.05) < 1e-6 && (await st()).past === pastC + 6,
      `bottom ${r3(n0.elevation ?? elev0)} → ${r3(n1.elevation)}; along the wall ${r3(along(n0))} → ${r3(along(n1))} (right on screen = ${sR2 > 0 ? '+' : '−'}); history +${(await st()).past - pastC}`);
    await page.mouse.move(cB[0], cB[1] - 200);
    await page.keyboard.press('ArrowRight'); await sleep(300);
    const n2 = await tv();
    await page.keyboard.press('ArrowUp'); await sleep(300);
    const n3 = await tv();
    check('C. arrow keys: → 1 cm towards the side seen on screen as "right", ↑ 1 cm up', Math.abs((along(n2) - along(n1)) * sR2 - 0.01) < 1e-6 && Math.abs((n3.elevation ?? 0) - (n2.elevation ?? 0) - 0.01) < 1e-6 && along(n3) === along(n2),
      `→ Δ ${r3((along(n2) - along(n1)) * sR2)} m; ↑ Δ ${r3((n3.elevation ?? 0) - (n2.elevation ?? 0))} m`);
    await shot('06_controls');
    const undoTo = async (n) => { for (let i = 0; i < 8 && (await st()).past > n; i++) await keys('Control', 'KeyZ'); };
    await undoTo(pastC);

    // ================================================================== D1. default room view: dragged below the wall the object stays in its room
    await enter();
    {
      const f = await tv(), g = await scr([f.x, f.y, SCENE.floorZ + (f.elevation ?? elev0) + dims.h / 2]), pastD = (await st()).past;
      await press(g); await moveTo(g, [g[0], g[1] + 150]);
      const d = await drag();
      await shot('07_default_down');
      await release();
      const here = await tv(), sD = await st();
      check('D1. default room view: the object dragged 150 px down the screen stays in its room (it does not pass through a solid wall into the next room)',
        d.item?.id === TV && d.item.roomId === ROOM && !!here && sD.past <= pastD + 1,
        `dragged ${d.item?.id ?? 'nothing'}; during: room ${d.item?.roomId}, surface ${d.mount?.surfaceId}; after release in ${ROOM}: ${here ? 'present' : 'MISSING'}; history +${sD.past - pastD}`);
      await undoTo(pastD);
    }

    // ================================================================== D2. a mirror next to a door: into the door opening and back
    {
      const MR = SCENE.mirror, mAlong = (f) => (MR.wall.axis === 'y' ? f.x : f.y);
      const onW = (s, z) => (MR.wall.axis === 'y' ? [s, MR.wall.at, z] : [MR.wall.at, s, z]);
      await enter(MR.room);
      const m0 = await page.evaluate((r, id) => ({ f: window.__home.furniture(r, id), m: window.__home.mounted(r, id), dims: window.__home.state().arrangement?.furniture.find((x) => x.id === id)?.dims }), MR.room, MR.id);
      if (!m0?.f || !m0.m) check('D2. mirror next to a door: into the door opening and back onto its wall', false, `no wall-mounted ${MR.id} in ${MR.room}`);
      else {
        const dc = (MR.door.from + MR.door.to) / 2, sideD = Math.sign(mAlong(m0.f) - dc) || 1, jamb = sideD > 0 ? MR.door.to : MR.door.from;
        const n = MR.wall.inward, camAt = MR.wall.axis === 'y' ? [dc + sideD * 0.6, MR.wall.at + n[1] * 4.5, 2.3] : [MR.wall.at + n[0] * 4.5, dc + sideD * 0.6, 2.3];
        await setCamera(camAt, onW(dc + sideD * 0.6, 1.3));
        const pastM = (await st()).past, zm = SCENE.floorZ + m0.f.elevation + m0.dims.h / 2, gm = await scr([m0.f.x, m0.f.y, zm]);
        await press(gm);
        const pIn = await scr(onW(dc, zm)), back = jamb + sideD * 0.27, pBack = await scr(onW(back, zm));
        await moveTo(gm, pIn);
        const dIn = await drag();
        await shot('08_door_in');
        await moveTo(pIn, pBack);
        const dBack = await drag();
        await shot('09_door_back');
        await release();
        const hereM = await page.evaluate((r, id) => window.__home.furniture(r, id), MR.room, MR.id);
        check(`D2. a mirror (${m0.dims.w} m — fits the door) dragged into the door opening moves to the wall behind the door; when the pointer returns onto the solid wall 27 cm past the jamb it comes back onto its own wall, under the pointer`,
          dIn.item?.id === MR.id && dIn.item.roomId !== MR.room && dBack.item?.roomId === MR.room && dBack.mount?.surfaceId === m0.m.surfaceId && Math.abs(mAlong(dBack.item) - back) < 0.035 && !!hereM,
          `in the door: room ${dIn.item?.roomId} (${dIn.mount?.surfaceId}); pointer back: ${dBack.item?.roomId} (${dBack.mount?.surfaceId}), axis ${r3(dBack.item ? mAlong(dBack.item) : NaN)} for pointer ${r3(back)}; after release in ${MR.room}: ${hereM ? 'present' : 'MISSING'}`);
        await undoTo(pastM);
      }
    }
  } catch (e) {
    check('scenario ran to the end', false, String(e?.stack ?? e).slice(0, 400));
    await shot('error').catch(() => {});
  } finally {
    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
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
