// E2E — PWA / offline: manifest and installability, service worker with the complete offline cache (app files and the project
// files of BOTH examples: /projects/index.json, /projects/<id>/project.json), work with the server STOPPED (open the project,
// room, furniture, material, electrical point, save, restart and recover; the other example opens offline too), sync to the
// project file when the server is back, version conflicts (offline edit vs file changed on the PC; a second device saving while
// this tab is in sync), an unreadable project file, "Save automatically" off, controlled update (the new version waits, no
// reload during work, no mixing of versions, `pwa-update-apply` saves and switches), ?pwa=off.
// Server: vite preview on a COPY of dist/ (the test replaces files in it to simulate a new version), own user-data directory.
// Usage: node scripts/verify/verify_pwa.mjs [--no-build]. Output: reports/e2e/pwa/ (screenshots, pwa.json).
import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, ROOT, sleep } from './browser.mjs';
import { CACHE_PREFIX, resetOrigin } from './app_data.mjs';

const NAME = 'pwa', PORT = 4303, BASE = `http://localhost:${PORT}`;
const OUT = resolve(ROOT, 'reports/e2e', NAME);
const DIST = resolve(OUT, 'dist');
const UD = mkdtempSync(join(tmpdir(), 'home-sim-e2e-pwa-'));
const ID = 'demo-apartment', OTHER = 'sample-house', LEVEL = 'L1';
const FILE = join(UD, ID, 'document.json');
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(resolve(OUT, f), { recursive: true, force: true });
const EN = Object.assign({}, ...readdirSync(resolve(ROOT, 'src/i18n/en')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(ROOT, 'src/i18n/en', f), 'utf8'))));

if (!process.argv.includes('--no-build')) execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
cpSync(resolve(ROOT, 'dist'), DIST, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail) }); console.log(`  ${ok ? 'PASS' : 'FAIL'} | ${name} | ${String(detail).replace(/\s+/g, ' ').slice(0, 500)}`); };
let server = null;
const up = async () => { try { return (await fetch(`${BASE}/pwa-build.json`, { cache: 'no-store' })).ok; } catch { return false; } };
async function startServer() {
  server = spawn(resolve(ROOT, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, HOME_SIM_USERDATA: UD } });
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(250);
}
async function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill(); } catch { /* gone */ } }
  server = null;
  for (let i = 0; i < 60 && (await up()); i++) await sleep(150);
}

const { browser, renderer, profile } = await launch({ viewport: { width: 1400, height: 900 } });
console.log(`[browser] ${profile} — ${renderer}`);
const page = await browser.newPage();
const cdp = await page.createCDPSession();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));

const T = (id) => `[data-testid="${id}"]`;
const st = () => page.evaluate(() => window.__home.state());
const exists = async (s) => !!(await page.$(s));
const text = (s) => page.$eval(s, (e) => e.textContent.trim()).catch(() => '');
const shot = (n) => page.screenshot({ path: resolve(OUT, `${n}.png`) }).catch(() => {});
const click = async (s, wait = 400) => { const el = await page.$(s); if (!el) throw new Error(`no element ${s}`); await el.scrollIntoView(); await sleep(60); await el.click(); await sleep(wait); };
const pwa = () => page.evaluate(() => window.__home.pwa.state());
const sync = () => page.evaluate(() => window.__home.pwa.sync());
const points = () => page.evaluate(() => window.__home.electrical.plan().points.map((p) => p.id));
const addPoint = (q) => page.evaluate((lv, q) => window.__home.electrical.placePlan(lv, q, 'socket-1'), LEVEL, q);
const loaded = () => page.waitForFunction(() => !!window.__home?.state?.().loaded && !!window.__home3d?.camera?.(), { timeout: 120000 });
const reload = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await loaded(); await sleep(800); };
const fileText = () => (existsSync(FILE) ? readFileSync(FILE, 'utf8') : null);
const fileDoc = () => { try { return JSON.parse(fileText()); } catch { return null; } };
const inFile = (id) => (fileText() ?? '').includes(`"${id}"`);
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(200); } };
const saveLabel = () => text(T('save'));
const save = async () => { await click(T('save'), 300); await waitFor(async () => !(await page.evaluate(() => document.querySelector('[data-testid="save"]')?.textContent.includes('…'))), 15000); await sleep(400); };

try {
  await startServer();
  await resetOrigin(page, BASE, { sw: null });
  await page.goto(`${BASE}/?pwa=on&onboarding=off&project=${ID}`, { waitUntil: 'domcontentloaded' });
  await loaded();

  // ================================================================== A. manifest, icons, installability
  const man = await cdp.send('Page.getAppManifest');
  const m = JSON.parse(man.data || '{}');
  const inst = await cdp.send('Page.getInstallabilityErrors');
  const icons = await Promise.all((m.icons ?? []).map(async (i) => { const r = await fetch(`${BASE}${i.src}`); const b = Buffer.from(await r.arrayBuffer()); return { src: i.src, ok: r.ok, w: b.readUInt32BE(16), h: b.readUInt32BE(20), purpose: i.purpose }; }));
  const head = await page.evaluate(() => ({ theme: document.querySelector('meta[name="theme-color"]')?.content, vp: document.querySelector('meta[name="viewport"]')?.content }));
  check('1. manifest.webmanifest: name "Home Simulator", start_url / scope "/", display standalone, icons 192 / 512 (any and maskable) with the declared sizes',
    man.errors.length === 0 && m.name === 'Home Simulator' && m.start_url === '/' && m.scope === '/' && m.display === 'standalone' && icons.length === 4 && icons.every((i) => i.ok && i.w === i.h && [192, 512].includes(i.w) && i.purpose) && icons.filter((i) => i.purpose === 'maskable').length === 2,
    `${m.name} (${m.short_name}) · ${m.display} · icons ${icons.map((i) => `${i.w}${i.purpose === 'maskable' ? 'm' : ''}`).join(', ')}`);
  check('2. installable (no Chrome installability errors); viewport and theme-color meta', inst.installabilityErrors.filter((e) => e.errorId !== 'in-incognito').length === 0 && !!head.vp && !!head.theme,
    JSON.stringify({ errors: inst.installabilityErrors.map((e) => e.errorId), ...head }));

  // ================================================================== B. service worker and offline cache
  const ready = await waitFor(async () => { const s = await pwa(); return s.ready && s.build ? s : null; }, 60000);
  const build = JSON.parse(readFileSync(resolve(DIST, 'pwa-build.json'), 'utf8'));
  const cache = await page.evaluate(async (pre) => { const keys = (await caches.keys()).filter((k) => k.startsWith(pre)); const c = keys[0] ? await caches.open(keys[0]) : null; return { keys, files: c ? (await c.keys()).map((r) => new URL(r.url).pathname) : [] }; }, CACHE_PREFIX);
  const need = ['/index.html', '/manifest.webmanifest', '/icons/icon-512.png', '/projects/index.json', `/projects/${ID}/project.json`, `/projects/${OTHER}/project.json`];
  check('3. service worker active and controlling the page; the offline cache holds EVERY file of this version, including the project files of both examples',
    !!ready && ready.build === build.build && cache.keys.join() === `${CACHE_PREFIX}${build.build}` && cache.files.length === build.files && need.every((f) => cache.files.includes(f)) && cache.files.some((f) => /^\/assets\/.*\.js$/.test(f)),
    `build ${ready?.build}, ${cache.files.length} files (${(build.bytes / 1048576).toFixed(1)} MB); missing: ${need.filter((f) => !cache.files.includes(f)).join(', ') || 'none'}`);

  // online reference: a change saved to the project file
  const p0 = await addPoint([5.5, 6.6]);
  await save();
  const s0 = await sync();
  check('4. online: the save goes to the project file; device copy in IndexedDB, nothing pending; button "Saved"', !!p0 && inFile(p0) && !s0.pending && !s0.offline && s0.device === 'indexeddb' && s0.target === 'file' && (await saveLabel()) === EN['shell.saved'], `${p0}; ${JSON.stringify(s0)}`);

  // ================================================================== OFFLINE — server stopped
  await stopServer();
  await reload();
  const sOff = await sync(), stOff = await st();
  check('5. server stopped → the app starts from the offline cache and opens the project from the device', stOff.loaded && sOff.offline && sOff.target === 'localStorage' && (await points()).includes(p0) && (await pwa()).ready, JSON.stringify(sOff));
  // room, furniture, material, electrical point, save
  const room = 'R1';
  await page.evaluate((r, lv) => window.__home.ui({ section: 'interiors', roomId: r, level: lv, roomView: '3d', houseView: 'interior', camera: { preset: 'room', n: Date.now() } }), room, LEVEL); await sleep(1500);
  const a0 = (await st()).arrangement, item = a0.furniture.find((f) => f.catalogId === 'coffee-table') ?? a0.furniture[0];
  await page.evaluate((r, id) => window.__home.ui({ selection: { kind: 'furniture', roomId: r, id } }), room, item.id); await sleep(300);
  await page.keyboard.press('KeyR'); await sleep(400);
  const rot1 = (await st()).arrangement.furniture.find((f) => f.id === item.id).rot;
  await page.evaluate(() => window.__home.ui({ selection: null }));
  await click(T('nav-materials'), 500); await click(T('surface-floor'), 500);
  const mat = await page.$$eval(`${T('materials')} button`, (b) => b.map((x) => ({ id: x.dataset.testid, on: x.classList.contains('on') })).find((x) => !x.on)?.id);
  await click(T(mat), 700);
  const floor1 = (await st()).arrangement.finishes.floor?.materialId;
  const p1 = await addPoint([7.5, 6.6]);
  await save();
  const sSaved = await sync(), label = await saveLabel();
  await shot('01_offline_saved');
  check(`6. offline: room, furniture rotated, floor material, new electrical point, SAVE → "${EN['shell.onDevice']}" (changes wait for the connection)`,
    rot1 !== item.rot && floor1 === mat?.slice(4) && !!p1 && sSaved.pending && sSaved.offline && !sSaved.dirty && label === EN['shell.onDevice'] && sSaved.device === 'indexeddb',
    `${item.catalogId}: ${item.rot}° → ${rot1}°, floor ${floor1}, point ${p1}; "${label}"`);
  await reload();
  await page.evaluate((r, lv) => window.__home.ui({ roomId: r, level: lv }), room, LEVEL); await sleep(600);
  const a1 = (await st()).arrangement;
  check('7. restart offline → the changes are recovered from the device (furniture, material, electrical point)', a1.furniture.find((f) => f.id === item.id)?.rot === rot1 && a1.finishes.floor?.materialId === floor1 && (await points()).includes(p1) && (await sync()).pending,
    `${a1.furniture.length} items, floor ${a1.finishes.floor?.materialId}, ${(await points()).length} points`);
  const pdf = await page.evaluate(() => window.__home.electrical.pdf({ format: 'a4', groups: ['all'], furniture: false }).then((r) => r && { pages: r.pages, size: r.size, head: atob(r.base64.slice(0, 8)).slice(0, 5) }).catch((e) => ({ error: String(e) })));
  check('8. offline: electrical plan PDF export works (generator and fonts from the offline cache)', pdf?.head === '%PDF-' && pdf.pages >= 1 && pdf.size > 10000, JSON.stringify(pdf));
  // the other example opens offline too (its project.json is in the offline cache)
  await page.goto(`${BASE}/?onboarding=off&project=${OTHER}`, { waitUntil: 'domcontentloaded' }); await loaded(); await sleep(600);
  const o = await page.evaluate(() => ({ id: window.__home.project().id, rooms: window.__home.rooms().length, offline: window.__home.pwa.sync().offline }));
  check(`9. offline: the other example (${OTHER}) opens from the offline cache`, o.id === OTHER && o.rooms > 0 && o.offline, JSON.stringify(o));
  await page.goto(`${BASE}/?onboarding=off&project=${ID}`, { waitUntil: 'domcontentloaded' }); await loaded(); await sleep(600);

  // ================================================================== sync after the connection returns
  await startServer();
  const before = inFile(p1);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const synced = await waitFor(async () => { const s = await sync(); return !s.pending && !s.offline ? s : null; }, 30000);
  check(`10. connection back → the device changes reach the project file by themselves; "${EN['shell.saved']}"`, !before && !!synced && inFile(p1) && fileDoc()?.variants?.[0]?.interiors?.[room] && (await saveLabel()) === EN['shell.saved'] && synced.target === 'file', `point in file: ${before} → ${inFile(p1)}`);

  // ================================================================== conflict: offline edit + file changed on the PC
  await stopServer();
  const p2 = await addPoint([4.0, 6.6]);
  await save();
  const disk = fileDoc(); disk.variants[0].name = 'Changed on the PC'; writeFileSync(FILE, JSON.stringify(disk, null, 1));
  await startServer();
  await page.evaluate(() => window.__home.pwa.syncNow());
  const conflict = await waitFor(async () => ((await sync()).conflict ? true : null), 20000);
  const dlg = await text(T('project-conflict'));
  await shot('02_conflict');
  const untouched = fileDoc()?.variants[0].name === 'Changed on the PC' && !inFile(p2);
  check(`11. file changed on the PC while the project was also changed offline → CONFLICT dialog "${EN['pwa.conflictTitle']}": nothing is overwritten`, !!conflict && dlg.includes(EN['pwa.conflictTitle']) && untouched && (await points()).includes(p2), dlg.slice(0, 140));
  await click(T('conflict-server'), 1500);
  const after = await st(), backups = await page.evaluate(() => window.__home.pwa.backups());
  check('12. choice "load the project file": the file version is opened; the device version is kept in the backups', after.variant === 'Changed on the PC' && !(await points()).includes(p2) && !(await sync()).conflict && !(await exists(T('project-conflict'))) && backups.some((b) => b.label === EN['sync.backupDeviceReplacedByFileChoice']), backups.map((b) => b.label).join(' | '));
  await click(T('settings'), 600);
  const appData = await text(T('app-data'));
  await shot('03_settings_app_data');
  await page.evaluate((label) => { const row = [...document.querySelectorAll('[data-testid="pwa-backups"] .hm-row')].find((r) => r.textContent.includes(label)); row?.querySelector('[data-testid="pwa-restore"]')?.click(); }, EN['sync.backupDeviceReplacedByFileChoice']);
  await sleep(800);
  const restored = (await points()).includes(p2);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control'); await sleep(400);
  check('13. Settings → App and data: offline ready, backups; "Restore" loads a backup as an ordinary change (Undo reverts it)', appData.includes(EN['pwa.backups']) && (await page.evaluate(() => document.querySelector('[data-testid="pwa-offline-state"]')?.dataset.ready)) !== '0' && restored && !(await points()).includes(p2), appData.slice(0, 160));
  if (await exists(T('settings-modal'))) await page.keyboard.press('Escape');

  // ================================================================== a second device saves while this tab is in sync with the file
  await save();
  await waitFor(async () => { const q = await sync(); return !q.pending && !q.dirty ? true : null; }, 10000);
  const other = fileDoc(); other.variants[0].name = 'From another device'; writeFileSync(FILE, JSON.stringify(other, null, 1));
  const p4 = await addPoint([6.0, 6.6]);
  await save();
  const conflict2 = await waitFor(async () => ((await sync()).conflict ? true : null), 15000);
  check('14. a second device saved the file while this tab was in sync: this save does NOT replace the file — conflict dialog, file unchanged', !!conflict2 && fileDoc()?.variants[0].name === 'From another device' && !inFile(p4) && (await exists(T('project-conflict'))), `file: "${fileDoc()?.variants[0].name}"`);
  await click(T('conflict-device'), 1500);
  const kept = await waitFor(async () => (inFile(p4) ? true : null), 15000), backups2 = await page.evaluate(() => window.__home.pwa.backups());
  check('15. choice "keep this device version": the file gets it, the other device version goes to the backups', !!kept && fileDoc()?.variants[0].name !== 'From another device' && backups2.some((b) => b.label === EN['sync.backupFileReplacedByDevice']) && !(await sync()).conflict, backups2.map((b) => b.label).join(' | ').slice(0, 240));

  // ================================================================== unreadable project file (truncated write)
  const good = fileText(), broken = good.slice(0, Math.floor(good.length / 2));
  writeFileSync(FILE, broken);
  await reload();
  const dlgU = await text(T('project-unreadable')), syncU = await sync();
  await shot('04_unreadable');
  await click(T('unreadable-keep'), 400);
  const p5 = await addPoint([8.0, 6.6]);
  await save();
  const stillBroken = fileText() === broken, syncK = await sync();
  check(`16. damaged project file: "${EN['pwa.unreadableTitle']}" with the reason; not treated as offline; a save does NOT replace the file`, dlgU.includes(EN['pwa.unreadableTitle']) && !syncU.offline && stillBroken && syncK.pending && (await points()).includes(p5), `${dlgU.slice(0, 80)}; file unchanged: ${stillBroken}`);
  await reload();
  await click(T('unreadable-replace'), 1500);
  const replaced = await waitFor(async () => (fileDoc() && inFile(p5) ? true : null), 15000);
  const aside = readdirSync(join(UD, ID)).filter((f) => f.startsWith('document.json.unreadable-'));
  check('17. "Replace the file with this device version": file replaced, the damaged one kept beside it; nothing pending', !!replaced && aside.length === 1 && readFileSync(join(UD, ID, aside[0]), 'utf8') === broken && !(await exists(T('project-unreadable'))) && !(await sync()).pending, aside.join(', '));

  // ================================================================== "Save automatically" off
  await page.evaluate(() => window.__home.ui({ autosave: false }));
  const before18 = fileText();
  const p6 = await addPoint([3.0, 6.6]);
  await sleep(800);
  const q1 = await sync();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
  await page.evaluate(() => window.__home.pwa.syncNow());
  await sleep(31500);                                                        // a full turn of the 30 s sync loop
  const q2 = await sync(), same = fileText() === before18;
  check(`18. "Save automatically" off: the change stays on the device unsaved — the file is unchanged after returning to the app and a full sync-loop turn; button "${EN['shell.save']}"`, !!p6 && q1.dirty && same && q2.dirty && (await saveLabel()) === EN['shell.save'], `file unchanged: ${same}; ${JSON.stringify(q2)}`);
  await save();
  check('19. …and "Save" writes it to the file', inFile(p6) && !(await sync()).dirty && !(await sync()).pending, `in file: ${inFile(p6)}`);
  await page.evaluate(() => window.__home.ui({ autosave: true }));

  // ================================================================== controlled update
  await page.evaluate(() => { window.__marker = 'old-page'; window.__home.ui({ autosave: false }); });
  const oldBuild = (await pwa()).build;
  writeFileSync(resolve(DIST, 'index.html'), readFileSync(resolve(DIST, 'index.html'), 'utf8').replace(/<head>/i, '<head>\n    <meta name="home-sim-e2e" content="v2" />'));
  writeFileSync(resolve(DIST, 'sw.js'), readFileSync(resolve(DIST, 'sw.js'), 'utf8').replaceAll(oldBuild, 'e2etestv2000'));
  const p3 = await addPoint([5.0, 4.5]);                                        // unsaved work
  await page.evaluate(() => window.__home.pwa.checkUpdate());
  const waiting = await waitFor(async () => ((await pwa()).waiting ? true : null), 60000);
  await sleep(1200);
  const banner = await text(T('pwa-update'));
  const mix = await page.evaluate(async (pre) => ({ marker: window.__marker, html: (await (await fetch('/index.html')).text()).includes('home-sim-e2e'), caches: (await caches.keys()).filter((k) => k.startsWith(pre)) }), CACHE_PREFIX);
  await shot('05_update_waiting');
  check(`20. new version downloads in the background and WAITS: no reload during work (unsaved change kept), the page still gets files of ITS version; banner "${EN['pwa.updateReady']}" / "${EN['pwa.saveAndUpdate']}"`,
    !!waiting && mix.marker === 'old-page' && !mix.html && mix.caches.length === 2 && (await pwa()).build === oldBuild && banner.includes(EN['pwa.updateReady']) && banner.includes(EN['pwa.saveAndUpdate']) && (await sync()).dirty && (await points()).includes(p3), `${banner} | ${JSON.stringify(mix)}`);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null), click(T('pwa-update-apply'), 0)]);
  await loaded(); await sleep(1500);
  const afterUp = await page.evaluate(async (pre) => ({ marker: window.__marker ?? null, meta: document.querySelector('meta[name="home-sim-e2e"]')?.content ?? null, caches: (await caches.keys()).filter((k) => k.startsWith(pre)) }), CACHE_PREFIX);
  const newBuild = await waitFor(async () => (await pwa()).build, 15000);
  check('21. "Save and update": the project is saved first, then the new version takes over after a reload; the old version cache is removed',
    afterUp.marker === null && afterUp.meta === 'v2' && newBuild === 'e2etestv2000' && afterUp.caches.join() === `${CACHE_PREFIX}e2etestv2000` && (await points()).includes(p3) && inFile(p3) && !(await sync()).dirty, `${oldBuild} → ${newBuild}; ${JSON.stringify(afterUp)}`);
  await page.evaluate(() => window.__home.ui({ autosave: true }));

  // ================================================================== ?pwa=off
  await page.goto(`${BASE}/?pwa=off&onboarding=off&project=${ID}`, { waitUntil: 'domcontentloaded' }); await loaded(); await sleep(800);
  await reload();
  const off = await page.evaluate(async (pre) => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).filter((k) => k.startsWith(pre)).length, enabled: window.__home.pwa.state().enabled, device: window.__home.pwa.debug().device }), CACHE_PREFIX);
  check('22. ?pwa=off unregisters the service worker and removes the offline cache (project data on the device stays)', off.regs === 0 && off.caches === 0 && !off.enabled && off.device === 'indexeddb', JSON.stringify(off));
  check('no page exceptions', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | ') || 'none');
} catch (e) {
  check('scenario completed', false, String(e?.stack ?? e).slice(0, 600));
  await shot('error');
} finally {
  await browser.close().catch(() => {});
  await stopServer();
  rmSync(UD, { recursive: true, force: true });
  rmSync(DIST, { recursive: true, force: true });
  const fail = results.filter((r) => r.status === 'FAIL').length;
  writeFileSync(resolve(OUT, `${NAME}.json`), JSON.stringify({ at: new Date().toISOString(), renderer, profile, pass: results.length - fail, fail, results, pageErrors }, null, 1));
  console.log(`\n${results.length - fail} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
