// Vite plugin: app manifest, icons and the service worker.
//  • build: manifest.webmanifest + icons/* go to the output directory; once all files are written, the version file list is
//    created (every file from dist, with a content hash), the version id = hash of the whole list, and src/pwa/sw.ts is built
//    (esbuild) into /sw.js with that list. A change to any file = a different sw.js = a new version.
//  • dev (vite): the manifest and icons are served, the service worker is not (no caching while working on the code).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export const MANIFEST = {
  name: 'Home Simulator',
  short_name: 'Home Sim',
  description: '3D model of your home or apartment: interiors, furniture, materials, doors, electrical plan, variants. Works offline.',
  lang: 'en',
  dir: 'ltr',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'any',
  background_color: '#f3f4f6',
  theme_color: '#ffffff',
  categories: ['productivity', 'utilities'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Electrical plan', short_name: 'Electrical', url: '/?section=electrical&mode=advanced', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
  ],
} as const;

const ICON_DIR = path.resolve('src/pwa/icons');
const iconFiles = () => fs.readdirSync(ICON_DIR).filter((f) => f.endsWith('.png'));
const walk = (dir: string, base = dir): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]));

/** version file list (URL paths) and the version id from the contents of the output directory */
export function precacheOf(outDir: string): { files: string[]; build: string } {
  const files = walk(outDir).filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f).update('\0').update(fs.readFileSync(path.join(outDir, f))).update('\0');
  return { files: files.map((f) => `/${f}`), build: h.digest('hex').slice(0, 12) };
}

export function pwaPlugin(): Plugin {
  let cfg: ResolvedConfig;
  return {
    name: 'home-simulator-pwa',
    configResolved(c) { cfg = c; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = (req.url ?? '').split('?')[0];
        if (p === '/manifest.webmanifest') { res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8'); res.end(JSON.stringify(MANIFEST)); return; }
        if (p.startsWith('/icons/') && iconFiles().includes(p.slice(7))) { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(ICON_DIR, p.slice(7)))); return; }
        next();
      });
    },
    configurePreviewServer(server) {
      // sw.js and the manifest always fresh (the browser compares sw.js byte by byte itself; it must not keep it in the HTTP cache)
      server.middlewares.use((req, res, next) => { const p = (req.url ?? '').split('?')[0]; if (p === '/sw.js' || p === '/manifest.webmanifest' || p === '/' || p === '/index.html') res.setHeader('Cache-Control', 'no-cache'); next(); });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(MANIFEST, null, 1) });
      for (const f of iconFiles()) this.emitFile({ type: 'asset', fileName: `icons/${f}`, source: fs.readFileSync(path.join(ICON_DIR, f)) });
    },
    async closeBundle() {
      if (cfg.command !== 'build' || cfg.build.ssr) return;
      const outDir = path.resolve(cfg.root, cfg.build.outDir);
      if (!fs.existsSync(path.join(outDir, 'index.html'))) return;
      const { files, build: content } = precacheOf(outDir);
      const esbuild = await import('esbuild');
      // the version id covers the app files AND the service worker code (a change to sw.ts alone is also a new version)
      const HOLD = '__HOME_SIM_BUILD_ID__';
      const out = await esbuild.build({
        entryPoints: [path.resolve('src/pwa/sw.ts')], bundle: true, format: 'iife', target: 'es2020', minify: false, legalComments: 'none', write: false,
        define: { __HOME_SIM_BUILD__: JSON.stringify(HOLD), __HOME_SIM_PRECACHE__: JSON.stringify(files) },
      });
      const code = out.outputFiles[0].text, build = createHash('sha256').update(content).update(code).digest('hex').slice(0, 12);
      fs.writeFileSync(path.join(outDir, 'sw.js'), `/* Home Simulator — service worker · build ${build} · ${files.length} files */\n${code.replaceAll(HOLD, build)}`);
      fs.writeFileSync(path.join(outDir, 'pwa-build.json'), JSON.stringify({ build, files: files.length, bytes: files.reduce((s, f) => s + fs.statSync(path.join(outDir, f.slice(1))).size, 0) }));
      cfg.logger.info(`\nPWA: sw.js · build ${build} · ${files.length} files in the offline cache`);
    },
  };
}
