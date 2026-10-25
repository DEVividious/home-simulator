#!/usr/bin/env node
// Install, update and check the app on an Android phone over USB. The phone runs the same web app as an installed PWA
// served by `vite preview` on port 4170 of this computer, tunnelled with `adb reverse` — localhost is a secure context, so no
// certificates are needed. Saves made while the phone is connected also reach userdata/<id>/document.json on this computer.
//
//   node scripts/phone/phone.mjs doctor                    what is missing (adb, device, authorisation, Chrome, port, build)
//   node scripts/phone/phone.mjs setup-adb                 download Android platform-tools into .tools/ (no system install)
//   node scripts/phone/phone.mjs serve [--project <id>] [--no-build] [--dry-run]
//                                                          build, serve on 4170, tunnel, open Chrome on the phone; Ctrl+C stops
//   node scripts/phone/phone.mjs verify                    installed app state over Chrome DevTools (standalone, offline, build)
//   node scripts/phone/phone.mjs update                    while `serve` runs with a new build: check for an update and apply it
//   node scripts/phone/phone.mjs reset --confirm           open the app with ?pwa=off (drops the offline cache of the app)
// Exit codes: 0 ok · 2 a requirement is missing (the message says how to fix it) · 3 the app is not open on the phone.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PORT = 4170;           // part of the app's identity on the phone — the origin owns its offline data. Never change.
const DEVTOOLS = 9342, BASE = `http://localhost:${PORT}`;
const LOCAL_ADB = join(ROOT, '.tools', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const args = process.argv.slice(2), cmd = args[0] ?? 'doctor', flag = (f) => args.includes(f), opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg, code = 2) => { console.error(`\n✗ ${msg}`); process.exit(code); };

function findAdb() {
  if (process.env.ADB && existsSync(process.env.ADB)) return process.env.ADB;
  if (existsSync(LOCAL_ADB)) return LOCAL_ADB;
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', ['adb'], { stdio: 'pipe' }); return 'adb'; } catch { return null; }
}
const ADB = findAdb();
function adb(...a) {
  if (!ADB) fail('adb not found — run: node scripts/phone/phone.mjs setup-adb   (or install Android platform-tools and put adb on PATH, or set ADB=/path/to/adb)');
  for (let i = 0; ; i++) {
    try { return execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, ''); }
    catch (e) { if (i >= 2) throw e; try { execFileSync(ADB, ['wait-for-device'], { timeout: 10000 }); } catch { /* retry */ } }
  }
}
const sh = (c) => adb('shell', c).trim();
/** connected devices with their state: device | unauthorized | offline */
function deviceList() {
  return adb('devices', '-l').split('\n').slice(1).map((l) => l.trim()).filter(Boolean)
    .map((l) => ({ serial: l.split(/\s+/)[0], state: l.split(/\s+/)[1], model: (l.match(/model:(\S+)/) ?? [])[1] ?? '' }));
}
const portFree = (port) => new Promise((r) => { const s = createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(port, '127.0.0.1'); });
function newest(dir) { let t = 0; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else t = Math.max(t, statSync(p).mtimeMs); } }; if (existsSync(dir)) walk(dir); return t; }

const USB_HELP = `On the phone:
  1. Settings → About phone → tap "Build number" 7 times (developer options appear).
  2. Settings → Developer options → turn on "USB debugging".
  3. Connect the phone with a DATA cable; in the USB notification choose "File transfer" if nothing happens.
  4. Accept "Allow USB debugging?" on the phone (tick "Always allow from this computer").`;

async function doctor() {
  let ok = true;
  const line = (good, text, fix) => { console.log(`${good ? '✓' : '✗'} ${text}`); if (!good) { ok = false; if (fix) console.log(`    → ${fix}`); } };
  line(!!ADB, `adb: ${ADB ?? 'not found'}`, 'node scripts/phone/phone.mjs setup-adb');
  if (!ADB) return fail('install adb first');
  const devs = deviceList(), ready = devs.filter((d) => d.state === 'device');
  line(ready.length > 0, `phone: ${devs.length ? devs.map((d) => `${d.model || d.serial} (${d.state})`).join(', ') : 'none connected'}`,
    devs.some((d) => d.state === 'unauthorized') ? 'unlock the phone and accept "Allow USB debugging?"' : devs.some((d) => d.state === 'offline') ? 'reconnect the cable, then run doctor again' : USB_HELP.replace(/\n/g, '\n      '));
  if (ready.length > 1) console.log('    ! several phones connected — set ANDROID_SERIAL=<serial> to choose one');
  if (ready.length) {
    const chrome = sh('pm path com.android.chrome');
    const ver = (sh('dumpsys package com.android.chrome').match(/versionName=(\S+)/) ?? [])[1];
    line(!!chrome, `Chrome on the phone: ${chrome ? ver ?? 'installed' : 'missing'}`, 'install Google Chrome from the Play Store');
    console.log(`  Android ${sh('getprop ro.build.version.release')} · ${sh('getprop ro.product.model')}`);
  }
  line(await portFree(PORT), `port ${PORT} free on this computer`, `stop whatever listens on ${PORT} (the app must always use this port: it is the app's address on the phone)`);
  const fresh = existsSync(join(ROOT, 'dist', 'index.html')) && newest(join(ROOT, 'dist')) >= Math.max(newest(join(ROOT, 'src')), newest(join(ROOT, 'projects')));
  console.log(`${fresh ? '✓' : '•'} build: ${fresh ? 'dist/ is up to date' : 'will be built by serve'}`);
  if (!ok) fail('fix the items above, then run doctor again');
  console.log('\nReady: node scripts/phone/phone.mjs serve');
}

async function setupAdb() {
  const plat = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  const url = `https://dl.google.com/android/repository/platform-tools-latest-${plat}.zip`;
  mkdirSync(join(ROOT, '.tools'), { recursive: true });
  const zip = join(ROOT, '.tools', 'platform-tools.zip');
  console.log(`downloading ${url}`);
  const r = await fetch(url);
  if (!r.ok) fail(`download failed: HTTP ${r.status}`);
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  try { execFileSync('unzip', ['-oq', zip, '-d', join(ROOT, '.tools')]); }
  catch { execFileSync('python3', ['-c', `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, zip, join(ROOT, '.tools')]); }
  if (process.platform !== 'win32') execFileSync('chmod', ['+x', LOCAL_ADB]);
  console.log(`✓ adb: ${LOCAL_ADB}`);
}

async function serve() {
  const project = opt('--project'), url = `${BASE}/${project ? `?project=${encodeURIComponent(project)}` : ''}`;
  const steps = [
    !flag('--no-build') && 'npm run build',
    `vite preview --port ${PORT} --strictPort   (save server: userdata/<id>/document.json)`,
    `adb reverse tcp:${PORT} tcp:${PORT}`,
    `adb shell am start -a android.intent.action.VIEW -d '${url}' com.android.chrome`,
  ].filter(Boolean);
  if (flag('--dry-run')) { console.log('would run:\n  ' + steps.join('\n  ')); console.log(`port ${PORT}: ${(await portFree(PORT)) ? 'free' : 'IN USE'}`); return; }
  if (!deviceList().some((d) => d.state === 'device')) fail(`no authorised phone — run: node scripts/phone/phone.mjs doctor\n\n${USB_HELP}`);
  if (!(await portFree(PORT))) fail(`port ${PORT} is in use — stop the other server (the phone app lives at this exact address)`);
  if (!flag('--no-build')) { console.log('building…'); execFileSync('npm', ['run', '-s', 'build'], { cwd: ROOT, stdio: 'inherit' }); }
  const server = spawn(join(ROOT, 'node_modules', '.bin', 'vite'), ['preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: process.platform !== 'win32' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* starting */ } await sleep(250); }
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  sh('input keyevent KEYCODE_WAKEUP');
  sh(`am start -a android.intent.action.VIEW -d '${url}' com.android.chrome`);
  console.log(`\n✓ the app is open on the phone: ${url}
Install it (first time):
  • wait until the app shows "Offline mode: ready" (Settings → App & data), then
  • Chrome menu ⋮ → "Install app" (or "Add to home screen" → Install).
The installed app works without the cable; while the phone is connected and this command runs, saves also go to
userdata/<id>/document.json on this computer. Keep this running while you use the phone; Ctrl+C stops it.`);
  const stop = () => { try { adb('reverse', '--remove', `tcp:${PORT}`); } catch { /* disconnected */ } try { process.kill(-server.pid); } catch { server.kill(); } process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  await new Promise(() => {});
}

async function attach() {
  const { default: puppeteer } = await import('puppeteer-core');   // only needed with a phone attached
  adb('forward', `tcp:${DEVTOOLS}`, 'localabstract:chrome_devtools_remote');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEVTOOLS}`, defaultViewport: null, protocolTimeout: 60000 });
  let page = null;
  for (const p of await browser.pages()) if (p.url().startsWith(BASE) && await p.evaluate(() => document.visibilityState === 'visible').catch(() => false)) page = p;
  const done = async () => { await browser.disconnect().catch(() => {}); try { adb('forward', '--remove', `tcp:${DEVTOOLS}`); } catch { /* disconnected */ } };
  return { page, done };
}
const appState = (page) => page.evaluate(() => ({
  url: location.href, standalone: matchMedia('(display-mode: standalone)').matches, loaded: !!window.__home?.state?.().loaded,
  pwa: window.__home?.pwa?.state?.() ?? null, sync: window.__home?.pwa?.sync?.() ?? null,
})).catch((e) => ({ error: String(e).slice(0, 120) }));

async function verify() {
  const { page, done } = await attach();
  try {
    if (!page) fail(`the app is not open on the phone (${BASE}) — run serve, or open the installed app`, 3);
    const s = await appState(page);
    console.log(JSON.stringify(s, null, 1));
    console.log(`\n${s.standalone ? '✓ installed (standalone window)' : '• running in a browser tab (not installed yet)'} · ${s.pwa?.ready ? '✓ offline ready' : '• offline cache not ready yet'} · build ${s.pwa?.build ?? '?'}`);
  } finally { await done(); }
}

async function update() {
  const { page, done } = await attach();
  try {
    if (!page) fail(`the app is not open on the phone (${BASE}) — open it, with serve running on the new build`, 3);
    const before = await appState(page);
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update(); });
    let waiting = false;
    for (let i = 0; i < 60 && !waiting; i++) { waiting = !!(await appState(page)).pwa?.waiting; if (!waiting) await sleep(1000); }
    if (!waiting) { console.log(`no new version — the phone already runs build ${before.pwa?.build ?? '?'} (is serve running with a fresh build?)`); return; }
    await page.evaluate(() => { const b = document.querySelector('[data-testid="pwa-update-apply"]') ?? document.querySelector('[data-testid="pwa-apply"]'); b?.click(); });
    await sleep(8000);
    let after = await appState(page);
    for (let i = 0; i < 40 && !(after.loaded && after.pwa?.ready && !after.pwa?.waiting); i++) { await sleep(1000); after = await appState(page); }
    console.log(`✓ updated: build ${before.pwa?.build ?? '?'} → ${after.pwa?.build ?? '?'}`);
  } finally { await done(); }
}

async function reset() {
  if (!flag('--confirm')) fail('this drops the offline copy of the app on the phone (projects saved on the phone stay in its storage until you clear site data in Chrome) — add --confirm');
  sh(`am start -a android.intent.action.VIEW -d '${BASE}/?pwa=off' com.android.chrome`);
  console.log(`opened ${BASE}/?pwa=off — the service worker is removed. To delete all data of the app on the phone: Chrome → Settings → Site settings → All sites → localhost:${PORT} → Clear & reset.`);
}

const COMMANDS = { doctor, 'setup-adb': setupAdb, serve, verify, update, reset };
if (!COMMANDS[cmd]) fail(`unknown command "${cmd}" — one of: ${Object.keys(COMMANDS).join(', ')}`);
await COMMANDS[cmd]();
