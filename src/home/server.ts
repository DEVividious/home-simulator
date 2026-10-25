// Vite server endpoint (dev and preview) for furniture import: POST /__api/furniture-import?kind=model|thumb&file=<name>
// stores a GLB / glTF file in <userdata>/imports/furniture/ or a PNG thumbnail in <userdata>/imports/thumbnails/ (safe names,
// signature and size checks); GET /user-assets/… serves those files. Model metadata goes into the document (importedAssets).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

export const IMPORT_API = '/__api/furniture-import';
const userData = () => process.env.HOME_SIM_USERDATA ?? 'userdata';
export const DIRS = { model: () => `${userData()}/imports/furniture`, thumb: () => `${userData()}/imports/thumbnails` } as const;
const URL_PREFIX = { model: '/user-assets/furniture/imported/', thumb: '/user-assets/thumbnails/imported/' } as const;
const LIMIT = { model: 50 << 20, thumb: 2 << 20 } as const;
const TYPES: Record<string, string> = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', png: 'image/png' };

export function safeName(kind: 'model' | 'thumb', name: string): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(name) || name.includes('..')) return null;
  const ext = name.split('.').pop()!.toLowerCase();
  return (kind === 'model' ? ext === 'glb' || ext === 'gltf' : ext === 'png') ? name : null;
}

/** file signature: GLB "glTF", glTF — JSON with "asset", PNG — PNG header */
export function validSignature(name: string, buf: Buffer): boolean {
  const ext = name.split('.').pop()!.toLowerCase();
  if (ext === 'glb') return buf.length > 20 && buf.toString('ascii', 0, 4) === 'glTF';
  if (ext === 'png') return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  try { return 'asset' in JSON.parse(buf.toString('utf8')); } catch { return false; }
}

export function saveImport(root: string, kind: 'model' | 'thumb', name: string, buf: Buffer): { status: number; body: Record<string, unknown> } {
  const file = safeName(kind, name);
  if (!file) return { status: 400, body: { errors: ['file name not allowed (letters, digits, - _ . ; extension .glb / .gltf / .png)'] } };
  if (buf.length > LIMIT[kind]) return { status: 413, body: { errors: [`file larger than ${LIMIT[kind] >> 20} MB`] } };
  if (!validSignature(file, buf)) return { status: 400, body: { errors: ['invalid file content (expected GLB / glTF / PNG)'] } };
  const dir = resolve(root, DIRS[kind]());
  mkdirSync(dir, { recursive: true });
  const out = resolve(dir, file);
  writeFileSync(out + '.tmp', buf);
  renameSync(out + '.tmp', out);
  return { status: 200, body: { ok: true, file, url: URL_PREFIX[kind] + file, bytes: buf.length } };
}

export function importApiMiddleware(root: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    for (const kind of ['model', 'thumb'] as const) {
      if (req.method === 'GET' && url.pathname.startsWith(URL_PREFIX[kind])) {
        const name = decodeURIComponent(url.pathname.slice(URL_PREFIX[kind].length));
        const file = safeName(kind, name), path = file && resolve(root, DIRS[kind](), file);
        if (!path || !existsSync(path)) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('Content-Type', TYPES[file!.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(path));
        return;
      }
    }
    if (url.pathname !== IMPORT_API) return next();
    const send = (r: { status: number; body: Record<string, unknown> }) => {
      res.statusCode = r.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(r.body));
    };
    if (req.method !== 'POST') return send({ status: 405, body: { errors: ['allowed: POST'] } });
    const kind = url.searchParams.get('kind') === 'thumb' ? 'thumb' : 'model';
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size <= LIMIT[kind]) chunks.push(c); });
    req.on('end', () => send(size > LIMIT[kind] ? { status: 413, body: { errors: [`file larger than ${LIMIT[kind] >> 20} MB`] } } : saveImport(root, kind, url.searchParams.get('file') ?? '', Buffer.concat(chunks))));
  };
}
