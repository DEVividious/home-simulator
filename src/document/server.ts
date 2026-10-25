// Vite server endpoint (dev and preview) of the project document: GET / PUT /__api/document?project=<id>.
// Every project has ITS OWN document file (userdata/<id>/document.json) — atomic write (temporary file + rename) after a full
// validation of the document ON THE DATA OF THAT PROJECT. A document carrying another project id than the one in the URL is
// rejected: the state of one project never reaches another (ADR 0002).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { projectId, withProject } from '../project/active';
import { PROJECT_PARAM, projectFile } from '../project/registry';
import { buildProjectIndex, readProjectDir } from '../project/node';
import type { ProjectPackage } from '../project/types';
import { hashText } from '../storage/project';
import { parseDoc, serializeDoc } from './model';

export const API_PATH = '/__api/document';
/**
 * Save header with the BASE VERSION: the hash of the file version the sent document was derived from; `none` — the device has
 * not seen the file; `force` — deliberate replacement of the file (the user's choice: "keep the device version").
 */
export const BASE_HEADER = 'x-document-base';
const MAX_BYTES = 8 << 20; // the document also holds interiors (arrangements)

/** directory of user documents (relative to the app root); HOME_SIM_USERDATA overrides it (E2E tests use their own) */
export const userDataDir = (): string => process.env.HOME_SIM_USERDATA ?? 'userdata';
/** document file of a project (relative to the app root) */
export function configFile(id: string = projectId()): string {
  return `${userDataDir().replace(/\/+$/, '')}/${projectFile(id)}`;
}

export type SaveResult = { status: number; body: Record<string, unknown> };

/**
 * Validation and save of the active project's document (pure logic — tested without a server). Protection of the existing file:
 *  • a document of an OLDER schema version does not replace a file saved in a newer one (409): an older app version on another
 *    device cannot read the newer file, takes it for a missing file and would send its own state in its place;
 *  • BASE VERSION: a save is accepted only when the document was derived from the version that is in the file. A file changed
 *    in the meantime (another device, a tool in another tab), a file the device has not seen or could not read, and a save
 *    without a base version (an older app) end with a 409 refusal — nothing is replaced silently;
 *  • replacing the file is always a deliberate choice (`force`), and the replaced version is kept aside
 *    (`<file>.replaced-<time>`; a file that cannot be read — `<file>.unreadable-<time>`).
 */
export function saveConfig(root: string, text: string, base?: string | null): SaveResult {
  if (Buffer.byteLength(text) > MAX_BYTES) return { status: 413, body: { errors: ['document larger than 8 MB'] } };
  let doc;
  try { doc = parseDoc(text); } catch (e) { return { status: 400, body: { errors: [(e as Error).message] } }; }
  const out = serializeDoc(doc), rel = configFile();
  const file = resolve(root, rel);
  let backup: string | undefined;
  if (existsSync(file)) {
    const prev = readFileSync(file, 'utf8');
    // the file version in the forms the device may have seen: as read (with migration), as stored, and verbatim
    let canonical: string | null = null, stored: string | null = null;
    try { stored = `${JSON.stringify(JSON.parse(prev), null, 1)}\n`; } catch { /* not JSON */ }
    try { canonical = serializeDoc(parseDoc(prev)); } catch { /* the app cannot read it */ }
    const readable = canonical !== null;
    if (base !== 'force') {
      const known = typeof base === 'string' && base !== 'none' && (base === hashText(prev) || (canonical !== null && base === hashText(canonical)) || (stored !== null && base === hashText(stored)));
      if (!known) {
        if (base === undefined || base === null) return { status: 409, body: { errors: ['the app on this device is older than the project server — update the app; the file was not changed, the changes stay on the device'] } };
        return { status: 409, body: { conflict: true, ...(readable ? {} : { unreadable: true }), errors: [readable ? 'the project file has changed since the version this device works on — it was not changed' : 'the project file cannot be read — it was not replaced'] } };
      }
    } else if (prev !== out) {
      backup = `${rel}.${readable ? 'replaced' : 'unreadable'}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      writeFileSync(resolve(root, backup), prev);
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', out);
  renameSync(file + '.tmp', file);
  return { status: 200, body: { ok: true, file: rel, projectId: projectId(), bytes: Buffer.byteLength(out), sha256: createHash('sha256').update(out).digest('hex'), base: hashText(out), ...(backup ? { backup } : {}) } };
}

export function loadConfig(root: string): SaveResult {
  const rel = configFile(), file = resolve(root, rel);
  if (!existsSync(file)) return { status: 200, body: { file: rel, projectId: projectId(), doc: null } }; // file not saved yet
  // a damaged file (truncated write, empty file): a response with the reason — the client must take it neither for a missing
  // connection (it would work "offline" forever) nor for a missing file (it would replace it)
  const text = readFileSync(file, 'utf8');
  try {
    if (!text.trim()) throw new Error('empty');
    return { status: 200, body: { file: rel, projectId: projectId(), doc: JSON.parse(text) } };
  } catch (e) {
    return { status: 200, body: { file: rel, projectId: projectId(), doc: null, unreadable: text.trim() ? `file ${rel} is damaged (${(e as Error).message})` : `file ${rel} is empty` } };
  }
}

const packages = new Map<string, Promise<ProjectPackage>>();
/** package of the project named in the URL (?project=<id>; absent — the default of the project index); null — unknown project */
async function packageOf(root: string, url: string): Promise<ProjectPackage | null> {
  const index = buildProjectIndex(root);
  const id = new URLSearchParams(url.split('?')[1] ?? '').get(PROJECT_PARAM) ?? index.default;
  if (!index.projects.some((p) => p.id === id)) return null;
  if (!packages.has(id)) packages.set(id, Promise.resolve().then(() => readProjectDir(resolve(root, 'projects', id))));
  const p = packages.get(id)!;
  p.catch(() => packages.delete(id)); // an invalid package is read again on the next request (the author may have fixed it)
  return p;
}

export function configApiMiddleware(root: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || req.url.split('?')[0] !== API_PATH) return next();
    const send = (r: SaveResult) => {
      res.statusCode = r.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(r.body));
    };
    // an error loading the package OR in the handler itself (e.g. a damaged file on read) ends with a 500 response — never
    // with a hanging request
    const run = (fn: () => SaveResult) => void packageOf(root, req.url!)
      .then((pkg) => send(pkg ? withProject(pkg, fn) : { status: 400, body: { errors: ['unknown project'] } }))
      .catch((e: unknown) => send({ status: 500, body: { errors: [String((e as Error)?.message ?? e)] } }));
    if (req.method === 'GET') return run(() => loadConfig(root));
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
      const h = req.headers?.[BASE_HEADER], base = typeof h === 'string' ? h : undefined;
      req.on('end', () => (size > MAX_BYTES ? send({ status: 413, body: { errors: ['document larger than 8 MB'] } }) : run(() => saveConfig(root, Buffer.concat(chunks).toString('utf8'), base))));
      return;
    }
    send({ status: 405, body: { errors: ['allowed: GET, PUT'] } });
  };
}
