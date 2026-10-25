// E2E — mobile layout on a phone emulation (384 × 693 portrait, 750 × 298 landscape, touch, DPR 2), BOTH example projects:
// touch-only acceptance scenario (scripts/verify/mobile_flow.mjs), layout checks, sheet states, select-then-drag, system
// "back" stack, walk joystick, pinch / orbit, sun panel (project with the sun module), A ↔ B comparison one side at a time,
// and a desktop window staying in the desktop layout.
// Usage: node scripts/verify/verify_mobile.mjs [--no-build] [--only portrait,landscape,back,extra,desktop]
// Output: reports/e2e/mobile/ (screenshots, mobile.json).
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, ROOT, startServer, waitForApp } from './browser.mjs';
import { backChecks, extraChecks, runAcceptance } from './mobile_flow.mjs';
import { resetOrigin } from './app_data.mjs';

const NAME = 'mobile', PORT = 4302;
const OUT = resolve(ROOT, 'reports/e2e', NAME);
const UD = mkdtempSync(join(tmpdir(), 'home-sim-e2e-mobile-'));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = (arg('only', '') ?? '').split(',').filter(Boolean);
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(resolve(OUT, f), { recursive: true, force: true });
const EN = Object.assign({}, ...readdirSync(resolve(ROOT, 'src/i18n/en')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(ROOT, 'src/i18n/en', f), 'utf8'))));

/** facts of a project read from its package: the largest room of the start level is the one entered */
function factsOf(id) {
  const p = JSON.parse(readFileSync(resolve(ROOT, 'projects', id, 'project.json'), 'utf8'));
  const rooms = p.building.rooms.rooms, lv0 = p.manifest.defaultView.levelId;
  const room = rooms.filter((r) => r.level === lv0).sort((a, b) => b.area - a.area)[0];
  return { id, room, levels: p.manifest.levels.map((l) => l.id), hasSun: p.manifest.modules.includes('sun') };
}
const DEMO = factsOf('demo-apartment'), HOUSE = factsOf('sample-house');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).replace(/\s+/g, ' ').slice(0, 400)}`); };

if (!process.argv.includes('--no-build')) execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
const server = await startServer({ port: PORT, mode: 'preview', userdata: UD });
const BASE = server.url;
const PHONE = { portrait: { width: 384, height: 693 }, landscape: { width: 750, height: 298 } };
const errors = [];
const { browser, renderer, profile } = await launch({ viewport: { width: 1280, height: 800 } });
console.log(`[browser] ${profile} — ${renderer}`);

async function session(viewport, name, F, fn) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await page.createCDPSession();
  page.on('pageerror', (e) => errors.push(`[${name}] ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`[${name}] ${m.text().slice(0, 300)}`); });
  const tag = `${F.id} ${name}`;
  const ctx = { page, cdp, base: BASE, F, resetDocument: () => rmSync(join(UD, F.id), { recursive: true, force: true }), check: (n, ok, d) => check(`[${tag}] ${n}`, ok, d), shot: (s) => page.screenshot({ path: resolve(OUT, `${F.id}_${name}_${s}.png`) }).catch(() => {}) };
  try { await fn(ctx, EN); } catch (e) { check(`[${tag}] scenario completed`, false, String(e?.stack ?? e).slice(0, 500)); await ctx.shot('error'); }
  await page.close();
}

try {
  const want = (k) => !ONLY.length || ONLY.includes(k);
  if (want('portrait')) for (const F of [DEMO, HOUSE]) await session(PHONE.portrait, 'portrait', F, runAcceptance);
  if (want('landscape')) await session(PHONE.landscape, 'landscape', DEMO, runAcceptance);
  if (want('back')) for (const F of [DEMO, HOUSE]) await session(PHONE.portrait, 'back', F, backChecks);
  if (want('extra')) for (const F of [HOUSE, DEMO]) await session(PHONE.portrait, 'extra', F, extraChecks);
  if (want('desktop')) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await resetOrigin(page, BASE);
    await page.goto(`${BASE}/?onboarding=off&project=${HOUSE.id}`, { waitUntil: 'load' });
    await waitForApp(page); await page.waitForFunction(() => !!window.__home3d?.camera?.(), { timeout: 60000 });
    const d = await page.evaluate(() => { const h = document.querySelector('[data-testid="home-app"]'); return { layout: h.dataset.layout, pointer: h.dataset.pointer, mnav: !!document.querySelector('[data-testid="mobile-nav"]'), sheet: !!document.querySelector('[data-testid="mobile-sheet"]'), side: !!document.querySelector('[data-testid="side"]'), nav: !!document.querySelector('.hm-nav button'), legend: !!document.querySelector('[data-testid="mouse-legend"]'), canvasW: Math.round(document.querySelector('[data-testid="canvas-frame"] canvas').getBoundingClientRect().width) }; });
    check('[desktop] a 1400 × 900 window stays in the desktop layout (side panel, top navigation, mouse legend, no sheet)', d.layout === 'desktop' && d.pointer === 'fine' && !d.mnav && !d.sheet && d.side && d.nav && d.legend && d.canvasW >= 900, JSON.stringify(d));
    await page.close();
  }
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
