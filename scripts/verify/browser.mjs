// Shared browser setup for previews and E2E tests (puppeteer-core + Google Chrome / Chromium).
// Renderer profile: HOME_SIM_BROWSER = auto (default: GPU when Chrome reports a hardware renderer, else SwiftShader) | gpu |
// swiftshader. Chrome binary: CHROME=/path, else the usual install locations.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const puppeteer = createRequire(join(ROOT, 'package.json'))('puppeteer-core');
const CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
export const CHROME = process.env.CHROME || CANDIDATES.find((p) => existsSync(p));
const SWIFT = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const GPU = ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchWith(args, viewport) {
  return puppeteer.launch({ executablePath: CHROME, headless: true, args: [...args, '--hide-scrollbars', '--mute-audio'], defaultViewport: viewport, protocolTimeout: 180000 });
}
async function rendererOf(browser) {
  const p = await browser.newPage();
  try {
    return await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'none'; });
  } finally { await p.close(); }
}

/** launches Chrome with the chosen renderer; returns { browser, renderer, profile } */
export async function launch({ viewport = { width: 1400, height: 900 } } = {}) {
  if (!CHROME) throw new Error('Chrome / Chromium not found — install it or set CHROME=/path/to/chrome');
  const want = process.env.HOME_SIM_BROWSER ?? 'auto';
  if (want !== 'swiftshader') {
    try {
      const b = await launchWith(GPU, viewport), r = await rendererOf(b);
      if (!/swiftshader|llvmpipe|software|none/i.test(r)) return { browser: b, renderer: r, profile: 'gpu' };
      await b.close();
      if (want === 'gpu') throw new Error(`no hardware renderer (got ${r})`);
    } catch (e) { if (want === 'gpu') throw e; }
  }
  const b = await launchWith(SWIFT, viewport);
  return { browser: b, renderer: await rendererOf(b), profile: 'swiftshader' };
}

/** starts the app server (vite dev by default, `preview` for the built app) on a port; HOME_SIM_USERDATA isolates documents */
export async function startServer({ port, mode = 'dev', userdata, env = {} }) {
  const bin = join(ROOT, 'node_modules', '.bin', 'vite');
  const args = mode === 'preview' ? ['preview', '--port', String(port), '--strictPort'] : ['--port', String(port), '--strictPort'];
  const proc = spawn(bin, args, { cwd: ROOT, detached: process.platform !== 'win32', stdio: 'ignore', env: { ...process.env, ...(userdata ? { HOME_SIM_USERDATA: userdata } : {}), ...env } });
  for (let i = 0; i < 160; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch { /* starting */ } await sleep(250); }
  const stop = () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill(); } catch { /* gone */ } } };
  return { url: `http://localhost:${port}`, stop };
}

/** waits until the app has loaded its project and document */
export async function waitForApp(page, timeout = 90000) {
  await page.waitForFunction(() => !!window.__home?.state?.().loaded, { timeout });
}
