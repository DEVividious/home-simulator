// Mobile layout scenarios driven ONLY by touch (CDP touch events, no mouse; the keyboard only types a name — on a phone that is
// the on-screen keyboard). Shared by the phone emulation (verify_mobile.mjs); every scenario takes the project facts, so the
// same steps run on every example project.
// ctx: { page, cdp, base, check(name, ok, detail), shot(name), F (project facts: id, room, levels, hasSun, …) }
import { resetOrigin } from './app_data.mjs';
import { waitForApp } from './browser.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;

export function touchKit({ page, cdp }) {
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  const tapXY = async (x, y, wait = 500) => { await touch('touchStart', [[x, y]]); await sleep(60); await touch('touchEnd', []); await sleep(wait); };
  /** centre of an element after scrolling it into view + whether that point is really the element (not covered) */
  const locate = (sel, index = 0) => page.evaluate((sel, index) => {
    const el = document.querySelectorAll(sel)[index];
    if (!el) return null;
    const mine = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (el === t || el.contains(t) || t.contains(el)); };
    // the centre, else the upper / lower quarter (an element at the bottom of a scrolled sheet may be partly under the navigation);
    // nothing visible after centring — scrolled to the top edge of its container instead
    const spot = () => { const b = el.getBoundingClientRect(), x = b.left + b.width / 2; return { b, x, y: [0.5, 0.25, 0.75].map((k) => b.top + b.height * k).find((y) => mine(x, y)) }; };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    let q = spot();
    if (q.y === undefined) { el.scrollIntoView({ block: 'start', inline: 'center' }); q = spot(); }
    const b = q.b, lx = q.x, ly = q.y ?? b.top + b.height / 2, top = document.elementFromPoint(lx, ly);
    // CDP touch points are in VISUAL viewport coordinates (shifted when the on-screen keyboard is open)
    const vv = window.visualViewport, x = lx - (vv?.offsetLeft ?? 0), y = ly - (vv?.offsetTop ?? 0);
    return { x, y, w: b.width, h: b.height, hit: !!top && (el === top || el.contains(top) || top.contains(el)), inView: x >= 0 && y >= 0 && x <= (vv?.width ?? innerWidth) && y <= (vv?.height ?? innerHeight),
      top: top ? `${top.tagName}.${String(top.className?.baseVal ?? top.className).slice(0, 40)}` : null };
  }, sel, index);
  const tap = async (sel, { index = 0, wait = 600 } = {}) => {
    let p = await locate(sel, index);
    // position stable in two reads and the point really on the element (sheet opening / scrolling, thumbnails loading — slower
    // under load): a tap during a layout shift hits another element
    for (let i = 0; p && i < 30; i++) { await sleep(200); const q = await locate(sel, index); const same = q && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5; p = q; if (same && q.hit && q.inView) break; }
    if (!p) throw new Error(`no element ${sel}`);
    if (!p.hit || !p.inView) throw new Error(`element ${sel} covered or off screen (${JSON.stringify(p)})`);
    await tapXY(p.x, p.y, wait);
    return p;
  };
  const drag = async (a, b, { steps = 24, step = 16, hold = 120 } = {}) => {
    await touch('touchStart', [a]); await sleep(hold);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]]); await sleep(step); }
    await sleep(120); await touch('touchEnd', []); await sleep(600);
  };
  const st = () => page.evaluate(() => window.__home.state());
  const ui = () => page.evaluate(() => { const h = document.querySelector('.hm'); return { layout: h?.dataset.layout, orient: h?.dataset.orient, pointer: h?.dataset.pointer, sheet: document.querySelector('.hm-sheet')?.dataset.state ?? null }; });
  const s3 = (fn, ...a) => page.evaluate((fn, a) => window.__home3d[fn](...a), fn, a);
  const cameraStill = async () => { let p = null; for (let i = 0; i < 60; i++) { const c = await page.evaluate(() => JSON.stringify(window.__home3d?.camera?.() ?? null)); if (c === p) return; p = c; await sleep(150); } };
  const waitHome = async () => { await waitForApp(page, 120000); await page.waitForFunction(() => !!window.__home3d?.camera?.() && !!window.__homeScene, { timeout: 60000 }); };
  /** a canvas point not covered by overlays, nearest to (x, y) */
  const freeCanvasPoint = (x, y) => page.evaluate((x, y) => {
    const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0], r = c.getBoundingClientRect();
    let best = null;
    for (let px = Math.max(8, r.left + 8); px < Math.min(innerWidth, r.right) - 8; px += 10) for (let py = Math.max(8, r.top + 8); py < Math.min(innerHeight, r.bottom) - 8; py += 10) {
      if (document.elementFromPoint(px, py) !== c) continue;
      const d = Math.hypot(px - x, py - y);
      if (!best || d < best.d) best = { x: px, y: py, d };
    }
    return best && [best.x, best.y];
  }, x, y);
  const onCanvas = (p) => page.evaluate((p) => !!p && document.elementFromPoint(p[0], p[1])?.tagName === 'CANVAS', p);
  const openSheet = async (nav) => { await tap(T(nav)); if ((await ui()).sheet === 'collapsed') await tap(T(nav)); };
  return { touch, tapXY, tap, locate, drag, st, ui, s3, cameraStill, waitHome, freeCanvasPoint, onCanvas, openSheet };
}

/** opens the app of a project on a clean device (optionally with the welcome screen) */
export async function openFresh(ctx, K, { onboarding = false, extra = '' } = {}) {
  ctx.resetDocument?.();                                                       // the project file of the previous scenario (autosave)
  await resetOrigin(ctx.page, ctx.base);
  await ctx.page.goto(`${ctx.base}/?project=${ctx.F.id}${onboarding ? '' : '&onboarding=off'}${extra}`, { waitUntil: 'load' });
  await K.waitHome(); await sleep(1200); await K.cameraStill();
}

/** layout checks: no page scrolling, full-width scene, touch targets, navigation on screen, touch help instead of mouse help */
export async function layoutChecks(ctx, K, label, EN) {
  const { page, check } = ctx;
  const m = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]?.getBoundingClientRect();
    const stage = document.querySelector('.hm-stage')?.getBoundingClientRect();
    const size = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
    return { inner: [innerWidth, innerHeight], doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], canvas: c && [c.left, c.top, c.width, c.height].map(Math.round),
      stage: stage && [stage.left, stage.top, stage.width, stage.height].map(Math.round), layout: document.querySelector('.hm')?.dataset.layout, orient: document.querySelector('.hm')?.dataset.orient,
      navOut: [...document.querySelectorAll('.hm-mnav button')].filter((e) => { const b = e.getBoundingClientRect(); return b.top < -0.5 || b.left < -0.5 || b.bottom > innerHeight + 0.5 || b.right > innerWidth + 0.5; }).map((e) => e.textContent.trim()),
      nav: size('.hm-mnav button'), top: size('.hm-top .hm-icon-btn'), pills: size('.hm-bottom .hm-pill'), grip: size('.hm-sheet-grip .hm-icon-btn'), legend: !!document.querySelector('[data-testid="mouse-legend"]'),
      hint: document.querySelector('[data-testid="hint"] span')?.textContent ?? '' };
  });
  const min = (a) => (a.length ? Math.min(...a.map((x) => Math.min(x[0], x[1]))) : null);
  const touchHints = Object.entries(EN).filter(([k]) => /^shell\.hint\.touch/.test(k)).map(([, v]) => v);
  check(`${label}: mobile layout (${m.orient})`, m.layout === 'mobile', JSON.stringify({ inner: m.inner }));
  check(`${label}: no page scrolling horizontally or vertically`, m.doc[0] <= m.inner[0] && m.doc[1] <= m.inner[1], `document ${m.doc} / window ${m.inner}`);
  check(`${label}: 3D scene over the full width of the stage`, !!m.canvas && !!m.stage && m.canvas[2] === m.stage[2] && m.canvas[0] >= 0 && m.canvas[0] + m.canvas[2] <= m.inner[0] + 1 && (m.orient === 'landscape' || m.canvas[2] === m.inner[0]), `canvas ${m.canvas}, stage ${m.stage}`);
  check(`${label}: touch targets ≥ 44 px (navigation, top bar, view pills, sheet toggle)`, [m.nav, m.top, m.pills, m.grip].every((a) => min(a) === null || min(a) >= 44), JSON.stringify({ nav: min(m.nav), top: min(m.top), pills: min(m.pills), grip: min(m.grip) }));
  check(`${label}: every section of the bottom navigation on screen`, m.navOut.length === 0 && m.nav.length >= 5, `${m.nav.length} sections, off screen: ${m.navOut.join(', ') || '—'}`);
  check(`${label}: touch help — no mouse legend, the hint is a touch hint`, !m.legend && (!m.hint || touchHints.includes(m.hint)), `"${m.hint}"`);
  return m;
}

/** acceptance scenario on a phone: welcome → room → plan view → add / select-then-drag / rotate furniture → floor → arrangement → walk */
export async function runAcceptance(ctx, EN) {
  const { page, check, shot, F } = ctx;
  const K = touchKit(ctx);
  const { tap, tapXY, drag, st, ui, s3, cameraStill } = K;
  const step = (n, name, ok, detail = '') => check(`${n}. ${name}`, ok, detail);
  const ADD = 'armchair';
  const furn = (s, id) => s.arrangement?.furniture.find((f) => f.id === id);

  // ---- 1. first start: welcome screen for touch
  await openFresh(ctx, K, { onboarding: true });
  const welcome = await page.evaluate(() => document.querySelector('[data-testid="onboarding"]')?.textContent ?? '');
  await tap(T('onboarding-start'));
  let u = await ui();
  step(1, 'first start: welcome screen with touch instructions; mobile layout, sheet collapsed', u.layout === 'mobile' && u.pointer === 'coarse' && u.sheet === 'collapsed' && welcome.includes(EN['shell.welcome.lookTouch']) && !welcome.includes(EN['shell.welcome.lookMouse']) && !(await page.$(T('onboarding'))), JSON.stringify(u));
  await layoutChecks(ctx, K, 'start', EN);
  await shot('01_start');

  // ---- 2. enter a room from the list in the sheet
  await tap(T('mnav-interiors'), { wait: 1200 });
  u = await ui();
  const sheetOpen = u.sheet === 'medium';
  await tap(T(`room-${F.room.id}`), { wait: 1800 });
  await cameraStill();
  let s = await st(); u = await ui();
  step(2, `"${F.room.name}" entered from the list in the sheet (the sheet collapses, the room is visible)`, sheetOpen && s.roomId === F.room.id && u.sheet === 'collapsed', `room ${s.roomId}, sheet ${u.sheet}`);

  // ---- 3. plan view (large 3D / Plan / Walk modes)
  const modes = await page.evaluate(() => [...document.querySelectorAll('[data-testid="bottom-view"] button')].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.value, Math.round(r.width), Math.round(r.height)]; }));
  await tap(`${T('bottom-view')} button[data-value="top"]`, { wait: 1500 });
  await cameraStill();
  s = await st();
  step(3, 'plan view from the bottom bar (3D / Plan / Walk buttons ≥ 44 px)', s.roomView === 'top' && modes.map((m) => m[0]).join() === '3d,top,walk' && modes.every((m) => m[2] >= 44), JSON.stringify(modes));

  // ---- 4. add furniture by tapping a catalogue card
  await K.openSheet('mnav-furniture');
  const n0 = s.arrangement.furniture.length, had = new Set(s.arrangement.furniture.map((f) => f.id));
  await tap(T(`cat-add-${ADD}`), { wait: 1500 });
  s = await st(); u = await ui();
  const added = s.arrangement.furniture.find((f) => f.catalogId === ADD && !had.has(f.id));
  step(4, `tap on the "${ADD}" card adds it to the room — selected, sheet collapsed, quick actions bar`, s.arrangement.furniture.length === n0 + 1 && !!added && s.selection?.id === added.id && u.sheet === 'collapsed' && !!(await page.$(T('furniture-quick'))), `furniture ${n0} → ${s.arrangement.furniture.length}; ${added && [added.x, added.y]}`);
  if (!added) throw new Error('furniture not added');
  await cameraStill();

  // ---- 5. select-then-drag: the selected item moves with the finger; dragging an UNselected item moves the view, not the item
  const bring = async (id) => {
    for (let i = 0; i < 4; i++) {
      const p = await s3('screenOfFurniture', id, 0.5);
      if (await K.onCanvas(p)) return p;
      const c = await page.evaluate(() => { const r = document.querySelector('.hm-stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      const from = await K.freeCanvasPoint(c[0], c[1]);
      if (!p || !from) break;
      await drag(from, [from[0] + (c[0] - p[0]), from[1] + (c[1] - p[1])]); await cameraStill();
    }
    return s3('screenOfFurniture', id, 0.5);
  };
  const a = await bring(added.id);
  const roomC = await s3('screenOfRoom', F.room.id);
  const b = [a[0] + (roomC[0] > a[0] ? 50 : -50), a[1] + (roomC[1] > a[1] ? 40 : -40)];
  const aOk = await K.onCanvas(a);
  await drag(a, b);
  const d1 = furn(await st(), added.id), moved = Math.hypot(d1.x - added.x, d1.y - added.y);
  await tap(T('q-done'));
  await cameraStill();
  const a2 = await bring(added.id), cam0 = JSON.stringify((await s3('camera')).position);
  await drag(a2, [a2[0] + 50, a2[1] + 30]);
  const d2 = furn(await st(), added.id), cam1 = JSON.stringify((await s3('camera')).position);
  step(5, 'select-then-drag: the selected item follows the finger; a drag over an unselected item pans the view and leaves the item', aOk && moved > 0.2 && d2.x === d1.x && d2.y === d1.y && cam0 !== cam1 && (await st()).selection === null,
    `moved ${moved.toFixed(2)} m; unselected: item ${d2.x === d1.x && d2.y === d1.y ? 'unchanged' : 'MOVED'}, camera ${cam0 !== cam1 ? 'moved' : 'unchanged'}`);
  await cameraStill();
  await shot('05_drag');

  // ---- 6. rotate: tap selects, quick bar −90° / +15°
  const a3 = await bring(added.id);
  await tapXY(a3[0], a3[1], 800);
  const selAfterTap = (await st()).selection?.id === added.id;
  const r0 = furn(await st(), added.id).rot;
  await tap(T('q-rot-r90')); const r1 = furn(await st(), added.id).rot;
  await tap(T('q-rot-l15')); const r2 = furn(await st(), added.id).rot;
  const norm = (x) => ((x % 360) + 360) % 360;
  step(6, 'rotate: a tap selects the item, quick bar −90° then +15°', selAfterTap && norm(r1 - r0) === 270 && norm(r2 - r1) === 15, `${r0}° → ${r1}° → ${r2}°`);
  await tap(T('q-done'));

  // ---- 7. floor material (a tap on the material card applies it)
  await K.openSheet('mnav-materials');
  await tap(T('surface-floor'));
  const f0 = JSON.stringify((await st()).arrangement.finishes.floor ?? null);
  const mats = await page.$$eval(`${T('materials')} [data-testid^="mat-"]`, (els) => els.map((e) => ({ id: e.dataset.testid, on: e.classList.contains('on') })));
  const pick = mats.find((m) => !m.on) ?? mats[0];
  await tap(T(pick.id), { wait: 900 });
  const f1 = JSON.stringify((await st()).arrangement.finishes.floor ?? null);
  step(7, 'floor material: a tap on a material card applies it', mats.length > 2 && f1 !== f0 && f1.includes(pick.id.slice(4)), `${mats.length} materials; ${f0} → ${f1}`);
  await shot('07_floor');

  // ---- 8. save the arrangement under a name (on-screen keyboard)
  await page.evaluate(() => window.__home.ui({ selection: null })); await sleep(300);
  await K.openSheet('mnav-interiors');
  await tap(T('arr-save'));
  if (!(await page.evaluate(() => document.activeElement?.dataset?.testid === 'arr-save-name'))) await tap(T('arr-save-name'));
  await page.keyboard.type('Phone layout');
  await tap(T('arr-save-name-ok'), { wait: 900 });
  s = await st();
  step(8, 'arrangement saved under a name', s.arrangement.name === 'Phone layout' && s.arrangement.saved === true, `${s.arrangement.name} / saved: ${s.arrangement.saved}`);

  // ---- 9. leave the room, back to the building
  if ((await ui()).sheet !== 'collapsed') await tap(T('sheet-toggle'));
  await tap(T('bottom-exit'), { wait: 1200 });
  const afterExit = (await st()).roomId;
  await tap(T('mnav-building'), { wait: 1500 });
  s = await st();
  step(9, 'leaving the room (‹ level) and the building section', afterExit === null && s.roomId === null && s.houseView === 'exterior' && s.section === 'building', `view ${s.houseView}, section ${s.section}`);

  // ---- 10. walk: joystick (left thumb) + looking around with a second finger
  await runWalkPad(ctx, K, 10);
}

/** walk with the virtual joystick: forward with the left thumb, look around with a second finger */
export async function runWalkPad(ctx, K, n) {
  const { page, check, shot } = ctx;
  if ((await K.ui()).sheet === 'collapsed') await K.tap(T('mnav-building'));
  await K.tap(T('walk-start'), { wait: 2500 });
  await page.waitForFunction(() => window.__home3d.walk().on && !!window.__home3d.walk().place, { timeout: 20000 }).catch(() => {});
  const s = await K.st(), u = await K.ui();
  const pad = await K.locate(T('walk-pad'));
  const pos = () => page.evaluate(() => window.__home3d.walk());
  const p0 = await pos();
  const look = await K.freeCanvasPoint(pad.x + 180, pad.y - 120);
  await K.touch('touchStart', [[pad.x, pad.y]]); await sleep(80);
  await K.touch('touchMove', [[pad.x, pad.y - 40]]); await sleep(1200);
  await K.touch('touchStart', [[pad.x, pad.y - 40], look]); await sleep(60);
  for (let i = 1; i <= 20; i++) { await K.touch('touchMove', [[pad.x, pad.y - 40], [look[0] + i * 4, look[1]]]); await sleep(30); }
  await K.touch('touchEnd', []); await sleep(600);
  const p1 = await pos();
  const dist = Math.hypot(p1.p[0] - p0.p[0], p1.p[1] - p0.p[1]);
  await shot(`${String(n).padStart(2, '0')}_walk`);
  const geo = await page.evaluate(() => ({ hud: document.querySelector('[data-testid="walk-hud"]')?.textContent ?? '', inner: innerWidth }));
  check(`${n}. walk: touch joystick walks (left part of the screen), a second finger looks around; no key instructions`, s.houseView === 'walk' && u.sheet === 'collapsed' && !!pad && pad.hit && dist > 0.4 && Math.abs(p1.yaw - p0.yaw) > 0.05 && pad.x < geo.inner * 0.42 && !/WASD|Esc|Shift/.test(geo.hud),
    `walked ${dist.toFixed(2)} m (${p0.place} → ${p1.place}); yaw ${p0.yaw.toFixed(2)} → ${p1.yaw.toFixed(2)}; joystick ${Math.round(pad.w)} px at (${Math.round(pad.x)}, ${Math.round(pad.y)})`);
  await K.tap(T('bottom-walk-exit'), { wait: 1200 });
  check(`${n}a. walk exit button returns to the building view`, (await K.st()).houseView === 'exterior' && !(await page.evaluate(() => window.__home3d.walk().on)), (await K.st()).houseView);
}

/** system "back": dialog → selection → sheet → room → section, before the app is left */
export async function backChecks(ctx) {
  const { page, check, F } = ctx;
  const K = touchKit(ctx);
  await openFresh(ctx, K);
  const back = async () => { await page.evaluate(() => history.back()); await sleep(700); };
  await K.tap(T('settings'));
  const open1 = !!(await page.$(T('settings-modal')));
  await back();
  const open2 = !!(await page.$(T('settings-modal')));
  await K.tap(T('mnav-interiors'), { wait: 1000 }); await K.tap(T(`room-${F.room.id}`), { wait: 1500 });
  await K.openSheet('mnav-materials'); await K.tap(T('surface-floor'));
  const seq = [];
  const snap = async () => { const s = await K.st(), u = await K.ui(); return `${u.sheet}/${s.selection ? s.selection.kind : '-'}/${s.roomId ?? '-'}/${s.houseView}`; };
  seq.push(await snap());
  for (let i = 0; i < 6 && seq[seq.length - 1] !== 'collapsed/-/-/exterior'; i++) { await back(); seq.push(await snap()); }
  const here = await page.evaluate(() => location.pathname + (window.__home ? ' (app)' : ''));
  check('back: closes the settings dialog, then the selection, the sheet, the room and the section — without leaving the app',
    open1 && !open2 && seq[0] === `medium/floor/${F.room.id}/interior` && seq.join() === [`medium/floor/${F.room.id}/interior`, `medium/-/${F.room.id}/interior`, `collapsed/-/${F.room.id}/interior`, 'collapsed/-/-/interior', 'collapsed/-/-/exterior'].join() && /app/.test(here),
    seq.join(' → '));
}

/** sheet states, pinch / orbit, sun panel (projects with the sun module), A ↔ B comparison one side at a time */
export async function extraChecks(ctx) {
  const { page, check, F } = ctx;
  const K = touchKit(ctx);
  await openFresh(ctx, K, { extra: '&date=2026-06-21&time=15:00' });
  // sheet: three states (grip — tap and drag)
  const h = () => page.evaluate(() => { const s = document.querySelector('.hm-sheet'), c = document.querySelector('canvas').getBoundingClientRect(); return { state: s.dataset.state, sheetH: Math.round(s.getBoundingClientRect().height), canvasH: Math.round(c.height), bodyH: Math.round(document.querySelector('.hm-body').getBoundingClientRect().height) }; });
  // the sheet animates between states: the grip is located once it stands still, the sizes are read after the transition
  const grip = async () => { let p = await K.locate(T('sheet-grip')); for (let i = 0; i < 20; i++) { await sleep(150); const q = await K.locate(T('sheet-grip')); if (Math.abs(q.y - p.y) < 0.5) return q; p = q; } return p; };
  const settled = async () => { await sleep(500); await grip(); return h(); };
  const s0 = await settled();
  const g = await grip();
  await K.tapXY(g.x - 60, g.y); const s1 = await settled();
  const g1 = await grip();
  await K.drag([g1.x - 60, g1.y], [g1.x - 60, g1.y - 180], { steps: 12 }); const s2 = await settled();
  const g2 = await grip();
  await K.drag([g2.x - 60, g2.y], [g2.x - 60, g2.y + 420], { steps: 12 }); const s3 = await settled();
  check('sheet: collapsed → medium (tap on the grip) → expanded (drag up) → collapsed (drag down); the medium sheet does not cover the scene',
    s0.state === 'collapsed' && s1.state === 'medium' && s2.state === 'expanded' && s3.state === 'collapsed' && s1.canvasH + s1.sheetH <= s1.bodyH + 2 && s2.sheetH > s1.sheetH && s0.canvasH > s1.canvasH, JSON.stringify([s0, s1, s2, s3]));
  // two-finger pinch zooms the CAMERA, the page is not zoomed; one finger orbits
  await K.cameraStill();
  const st0 = await page.evaluate(() => { const r = document.querySelector('.hm-stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const c0 = await K.freeCanvasPoint(st0[0], st0[1]);
  const dist = () => page.evaluate(() => Math.hypot(...window.__home3d.camera().position.map((v, i) => v - [0, 0, 0][i])));
  const d0 = await dist();
  await K.touch('touchStart', [[c0[0] - 30, c0[1]], [c0[0] + 30, c0[1]]]); await sleep(80);
  for (let i = 1; i <= 20; i++) { await K.touch('touchMove', [[c0[0] - 30 - i * 5, c0[1]], [c0[0] + 30 + i * 5, c0[1]]]); await sleep(20); }
  await K.touch('touchEnd', []); await sleep(800); await K.cameraStill();
  const d1 = await dist(), vv = await page.evaluate(() => [visualViewport.scale, innerWidth, document.documentElement.scrollWidth]);
  check('pinch with two fingers moves the camera closer; the page itself is not zoomed', d1 < d0 * 0.9 && vv[0] === 1 && vv[2] <= vv[1], `camera distance ${d0.toFixed(1)} → ${d1.toFixed(1)} m; page scale ${vv[0]}`);
  const p0 = JSON.stringify((await K.s3('camera')).position);
  await K.drag(c0, [c0[0] + 90, c0[1] + 10], { steps: 14 });
  check('one finger orbits the view', p0 !== JSON.stringify((await K.s3('camera')).position), '');
  // sun panel: only a project with the sun module has it — on a phone a low bar with the day slider, fully on screen
  if (F.hasSun) {
    await K.tap(T('sun-toggle'));
    const sun = await page.evaluate(() => { const r = (q) => { const b = document.querySelector(q)?.getBoundingClientRect(); return b ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null; }; return { panel: r('[data-testid="sun-panel"]'), rail: r('[data-testid="sun-track-rail"]'), dial: !!document.querySelector('[data-testid="sun-dial"]'), inner: [innerWidth, innerHeight] }; });
    check('sun panel on a phone: a low bar with the day slider, fully on screen (no dial covering the scene)', !!sun.panel && !!sun.rail && !sun.dial && sun.panel[0] >= 0 && sun.panel[2] <= sun.inner[0] && sun.panel[3] <= sun.inner[1] && sun.panel[3] - sun.panel[1] <= Math.max(150, sun.inner[1] * 0.24), JSON.stringify(sun));
    if (sun.rail) {
      const y = (sun.rail[1] + sun.rail[3]) / 2, w = sun.rail[2] - sun.rail[0];
      await K.drag([sun.rail[0] + w * 0.3, y], [sun.rail[0] + w * 0.75, y], { steps: 10 });
      const after = Number(await page.$eval(T('sun-track'), (e) => e.dataset.minutes));
      check('day slider: dragging with a finger sets the time (75 % of the rail ≈ 18:00)', Math.abs(after - 1080) <= 20, `minutes ${after}`);
    }
    await ctx.shot('sun');
    await page.evaluate(() => window.__home.ui({ sunPanel: false })); await sleep(400);
  } else check('project without the sun module: no sun panel on the phone', !(await page.$(T('sun'))) && !(await page.$(T('sun-toggle'))), '');
  // A ↔ B comparison on a phone: one side at a time over the full frame, a switch, the same camera
  await K.openSheet('mnav-variants');
  await K.tap(T('variant-duplicate'), { wait: 1200 });
  const ids = await page.evaluate(() => window.__home.variants().list.map((x) => x.id));
  if (ids.length >= 2) {
    await page.evaluate((ids) => window.__home.ui({ compare: { kind: 'variants', a: ids[0], b: ids[1] }, sheet: 'collapsed' }), ids); await sleep(2500);
    const a = await page.evaluate(() => ({ side: document.querySelector('[data-testid="compare"]')?.dataset.side, single: !!document.querySelector('.hm-compare.single'), cam: JSON.stringify(window.__home3d.camera().position) }));
    await K.tap(T('compare-show-B'), { wait: 900 });
    const b = await page.evaluate(() => ({ side: document.querySelector('[data-testid="compare"]')?.dataset.side, cam: JSON.stringify(window.__home3d.camera().position) }));
    await ctx.shot('compare_B');
    check('A ↔ B comparison on a phone: one side over the whole frame, A / B switch, the same camera (no split screen)', a.side === 'A' && a.single && b.side === 'B' && a.cam === b.cam, `A ${JSON.stringify(a)} / B ${JSON.stringify(b)}`);
    await K.tap(T('compare-exit'));
    check('comparison exit', (await page.evaluate(() => window.__home.variants().compare)) === null, '');
  } else check('A ↔ B comparison (needs two variants)', false, `variants: ${ids.length}`);
}
