// Shared browser setup for previews and E2E tests (puppeteer-core + Google Chrome / Chromium).
// Renderer profile: HOME_SIM_BROWSER = auto (default: GPU when Chrome reports a hardware renderer, else SwiftShader) | gpu |
// swiftshader. Chrome binary: CHROME=/path, else the usual install locations.
// Headless Chrome on a hybrid-graphics Linux laptop picks no usable EGL driver by itself. The GPU profile therefore tries, in
// order, the dedicated card first: each vendor's EGL library (glvnd, __EGL_VENDOR_LIBRARY_FILENAMES) with ANGLE on OpenGL ES,
// then each Vulkan driver (VK_ICD_FILENAMES) with ANGLE on Vulkan, then Chrome's defaults — and keeps the first that renders
// WebGL 2 in hardware. HOME_SIM_GPU=<name> (e.g. egl-nvidia, vulkan-intel) forces one; the chosen name is reported.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANDIDATES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
export const CHROME = process.env.CHROME || CANDIDATES.find((p) => existsSync(p));
const SWIFT = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const GPU_EGL = ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'];
const GPU_VULKAN = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const VENDORS = ['nvidia', 'radeon', 'amd', 'intel', 'mesa'];   // dedicated cards first
const rank = (f) => { const i = VENDORS.findIndex((v) => f.toLowerCase().includes(v)); return i < 0 ? VENDORS.length : i; };
const files = (dirs, ext) => dirs.flatMap((d) => { try { return readdirSync(d).filter((f) => f.endsWith(ext)).map((f) => join(d, f)); } catch { return []; } });
const vendorOf = (f) => VENDORS.find((v) => f.toLowerCase().includes(v)) ?? f.split('/').pop().replace(/\.json$/, '');
/** GPU launch candidates: [name, chrome args, environment] */
function gpuCandidates() {
  const egl = files(['/usr/share/glvnd/egl_vendor.d', '/etc/glvnd/egl_vendor.d'], '.json').sort((x, y) => rank(x) - rank(y));
  const vk = files(['/usr/share/vulkan/icd.d', '/etc/vulkan/icd.d'], '.json').filter((f) => /nvidia|radeon|intel_icd/.test(f)).sort((x, y) => rank(x) - rank(y));
  const all = [
    ...egl.map((f) => [`egl-${vendorOf(f)}`, GPU_EGL, { __EGL_VENDOR_LIBRARY_FILENAMES: f }]),
    ...vk.map((f) => [`vulkan-${vendorOf(f)}`, GPU_VULKAN, { VK_ICD_FILENAMES: f }]),
    ['vulkan', GPU_VULKAN, {}], ['egl', GPU_EGL, {}],
  ];
  const want = process.env.HOME_SIM_GPU;
  return want ? all.filter(([n]) => n === want) : all;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchWith(args, viewport, env = {}) {
  return puppeteer.launch({ executablePath: CHROME, headless: true, args: [...args, '--hide-scrollbars', '--mute-audio'], defaultViewport: viewport, protocolTimeout: 180000, env: { ...process.env, ...env } });
}
/** WebGL 2 renderer name, or 'none' when there is no context or it is lost after a draw (a driver that cannot keep it) */
async function rendererOf(browser) {
  const p = await browser.newPage();
  try {
    return await p.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
      const gl = c.getContext('webgl2'); if (!gl) return 'none';
      const e = gl.getExtension('WEBGL_debug_renderer_info'), name = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1024, 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.clear(gl.COLOR_BUFFER_BIT); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      return gl.isContextLost() || gl.getError() === gl.CONTEXT_LOST_WEBGL ? 'none' : name;
    });
  } catch { return 'none'; } finally { await p.close().catch(() => {}); }
}
const hardware = (r) => !/swiftshader|llvmpipe|lavapipe|software|none/i.test(r);

/** launches Chrome with the chosen renderer; returns { browser, renderer, profile } */
export async function launch({ viewport = { width: 1400, height: 900 } } = {}) {
  if (!CHROME) throw new Error('Chrome / Chromium not found — install it or set CHROME=/path/to/chrome');
  const want = process.env.HOME_SIM_BROWSER ?? 'auto';
  if (want !== 'swiftshader') {
    const seen = [];
    for (const [name, args, env] of gpuCandidates()) {
      let b = null;
      try {
        b = await launchWith(args, viewport, env);
        const r = await rendererOf(b);
        if (hardware(r)) return { browser: b, renderer: `${r} [${name}]`, profile: 'gpu' };
        seen.push(`${name}: ${r}`);
      } catch (e) { seen.push(`${name}: ${String(e).slice(0, 80)}`); }
      await b?.close().catch(() => {});
    }
    if (want === 'gpu' || process.env.HOME_SIM_GPU) throw new Error(`no hardware renderer (tried ${seen.join(' | ') || `nothing named ${process.env.HOME_SIM_GPU}`})`);
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

/** waits until the app has loaded its project and document, and the generated shell (built in a worker) is in the scene */
export async function waitForApp(page, timeout = 90000) {
  await page.waitForFunction(() => !!window.__home?.state?.().loaded, { timeout });
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__home3d?.shell?.().status), { timeout: 20000 }).catch(() => {});
}
