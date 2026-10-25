// Vite plugin: project packages are runtime data. Dev / preview: /projects/index.json is generated on every
// request from the projects/ directory and /projects/<id>/<file> is served from the repository (edit a project.json, reload
// the page). Build: every file under projects/ and the generated index.json are emitted into the bundle (generateBundle —
// before the PWA plugin computes the offline file list in closeBundle).
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildProjectIndex, PROJECTS_DIR } from '../../src/project/node';

const TYPES: Record<string, string> = { json: 'application/json; charset=utf-8', glb: 'model/gltf-binary', gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2', bin: 'application/octet-stream' };
const walk = (dir: string, base = dir): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')])) : []);
/** files of a project that the app may load (source material, previews and notes stay out of the build) */
const shipped = (rel: string) => !/(^|\/)(source|preview)\//.test(rel) && !/\.md$/i.test(rel) && TYPES[rel.split('.').pop()!.toLowerCase()] !== undefined;

export function projectsPlugin(): Plugin {
  let root = process.cwd();
  const serve = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const p = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (p === `/${PROJECTS_DIR}/index.json`) {
      res.setHeader('Content-Type', TYPES.json); res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(buildProjectIndex(root)));
      return;
    }
    if (!p.startsWith(`/${PROJECTS_DIR}/`)) return next();
    const rel = p.slice(PROJECTS_DIR.length + 2), file = path.resolve(root, PROJECTS_DIR, rel);
    if (rel.includes('..') || !file.startsWith(path.resolve(root, PROJECTS_DIR) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !shipped(rel)) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', TYPES[rel.split('.').pop()!.toLowerCase()]); res.setHeader('Cache-Control', 'no-cache');
    res.end(fs.readFileSync(file));
  };
  return {
    name: 'home-simulator-projects',
    configResolved(c) { root = c.root; },
    configureServer(server) { server.middlewares.use(serve); },
    configurePreviewServer(server) { server.middlewares.use(serve); },
    generateBundle() {
      const base = path.resolve(root, PROJECTS_DIR);
      for (const rel of walk(base).filter(shipped)) this.emitFile({ type: 'asset', fileName: `${PROJECTS_DIR}/${rel}`, source: fs.readFileSync(path.join(base, rel)) });
      this.emitFile({ type: 'asset', fileName: `${PROJECTS_DIR}/index.json`, source: JSON.stringify(buildProjectIndex(root), null, 1) });
    },
  };
}
