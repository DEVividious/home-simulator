// Project persistence in the browser (PWA / offline): the project lives in two places —
//   • the PROJECT FILE on the PC (the app server endpoint /__api/document, userdata/<id>/document.json), when connected,
//   • the DEVICE (IndexedDB — src/storage/project.ts): a working copy of every change; without a connection the only place to save.
// Rules: nothing is lost and nothing is overwritten silently. Changes made offline wait (pending) and reach the file on the first
// save after reconnecting — provided the file has not changed in the meantime; if it has, there is a CONFLICT: the Home app asks
// which version to keep (the other one goes to the backups), the expert tools adopt the file version.
// EVERY save carries the BASE VERSION — the hash of the file version the document was derived from — and the server refuses it
// when the file has a different one (another device, a tool in another tab, another Home tab); a tab "in sync with the file"
// never sends the document unconditionally. A file the app cannot read is not a "missing file": it is never replaced without
// the user's decision.
// API for the tools (Window Editor, Exterior, Room): loadDoc / saveDoc / writeLocal.
import { t } from '../i18n';
import { PROJECT_PARAM } from '../project/registry';
import { addBackup, decideLoad, hashText, readProject, sameAsBase, STORAGE_SCHEMA, writeJournal, writeProject, type LocalProject } from '../storage/project';
import { projectId } from '../project/active';
import { type ConfiguratorDoc, defaultDoc, parseDoc, serializeDoc } from './model';

export const API_PATH = '/__api/document';
/** URL of the active project's document — every project has its own file on the server */
const apiUrl = () => `${API_PATH}?${PROJECT_PARAM}=${encodeURIComponent(projectId())}`;

/** 'file' — the project file via the server; 'localStorage' — device only (historical name: IndexedDB today) */
export type StorageTarget = 'file' | 'localStorage';

export interface SyncStatus {
  /** the last contact with the project file failed (working on the device) */
  offline: boolean;
  /** changes on the device are waiting to be saved to the project file */
  pending: boolean;
  /** file and device changed independently — waiting for the user's choice */
  conflict: boolean;
  /** where the device copy is stored */
  device: 'indexeddb' | 'fallback' | null;
  /** the project file exists but this app cannot read it (reason) — it is not replaced without the user's decision */
  problem: string | null;
}
export interface Loaded {
  doc: ConfiguratorDoc;
  target: StorageTarget;
  source: string; // where it was loaded from (diagnostics)
  file?: string; // project file (when the endpoint is available)
  warning?: string;
  /** text of the version against which the "unsaved" state is computed (the project file or the loaded document) */
  savedText: string;
  sync: SyncStatus;
  /** the device record was moved from an older storage format (reserved; no older format exists yet) */
  migrated?: boolean;
}

// ------------------------------------------------------------------ sync state (one tab = one project)
let local: LocalProject | null = null;
let device: SyncStatus['device'] = null;
let offline = false, conflictServer: string | null = null, noEndpoint = false, inSync = false, unreadable: string | null = null;
let fileName: string | undefined;
let ready = false;
let listener: (s: SyncStatus) => void = () => {};
export const onSyncStatus = (fn: (s: SyncStatus) => void) => { listener = fn; };
export const syncStatus = (): SyncStatus => ({ offline, pending: !!local?.pending, conflict: conflictServer !== null, device, problem: unreadable });
const emit = () => listener(syncStatus());

async function persist(text: string, patch: { pending?: boolean; baseHash?: string | null; owed?: boolean } = {}): Promise<void> {
  const baseHash = patch.baseHash !== undefined ? patch.baseHash : local?.baseHash ?? null;
  const pending = patch.pending ?? (baseHash === null || hashText(text) !== baseHash);
  // a save request (owed) applies to specific content: it stays for the same content, disappears for different content (a further change without a save) and after delivery
  const owed = pending && (patch.owed ?? (local?.owed === true && local.text === text));
  const rec: LocalProject = { schema: STORAGE_SCHEMA, text, rev: (local?.rev ?? 0) + 1, savedAt: new Date().toISOString(), baseHash, pending, ...(owed ? { owed: true } : {}) };
  local = rec;
  device = await writeProject(rec);
}

/** `stored` — the document as stored in the file (before migration to the current version), with the same formatting as a save */
type Server = { ok: false } | { ok: true; file: string; text: string | null; stored?: string; error?: string; /** the file exists but cannot be read */ unreadable?: boolean };
/** the project file from the server: canonical text (after validation), null — the file does not exist yet; ok: false — server unavailable */
async function fetchServer(): Promise<Server> {
  if (noEndpoint) return { ok: false };
  let r: Response | null = null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
  try { r = await fetch(apiUrl(), { cache: 'no-store', signal: ctl?.signal }); } catch { r = null; } finally { if (tm) clearTimeout(tm); }
  if (!r) return { ok: false };
  if (!r.headers.get('content-type')?.includes('application/json') || r.status !== 200) { if (r.status === 404 || r.status === 200) noEndpoint = true; return { ok: false }; }   // hosting without the endpoint
  const body = await r.json() as { file: string; doc: unknown; unreadable?: string };
  fileName = body.file;
  // a file damaged on disk (the server gives the reason) or a document rejected by this app version: the file EXISTS
  if (body.doc === null) return body.unreadable ? { ok: true, file: body.file, text: null, error: body.unreadable, unreadable: true } : { ok: true, file: body.file, text: null };
  try { return { ok: true, file: body.file, text: serializeDoc(parseDoc(JSON.stringify(body.doc))), stored: `${JSON.stringify(body.doc, null, 1)}\n` }; } catch (e) { return { ok: true, file: body.file, text: null, error: t('sync.fileRejected', { file: body.file, message: (e as Error).message }), unreadable: true }; }
}

/** peek at the project file WITHOUT changing the sync state (refresh after returning to the tab); null — server unavailable */
export async function peekServer(): Promise<{ text: string | null; problem?: string } | null> {
  if (!ready) return null;
  const srv = await fetchServer();
  return srv.ok ? { text: srv.text, ...(srv.unreadable ? { problem: srv.error } : {}) } : null;
}
/**
 * Adopting the file version as current (a tab without its own changes): the device is in sync with the file. The in-memory state
 * changes synchronously — no user change fits between the "no own changes" check and the adoption; if the check itself moved
 * the base version, a change made in that time would overwrite another save without a conflict.
 */
export function adoptServer(text: string): Promise<void> {
  queued = null; if (timer) { clearTimeout(timer); timer = null; }
  conflictServer = null; unreadable = null; offline = false; inSync = true;
  return persist(text, { pending: false, baseHash: hashText(text) }).then(emit);
}

/**
 * Project load. `conflicts: 'ask'` (the Home app) — on a conflict the device version is opened and the choice is left to the
 * user (resolveConflict); by default (tools) — the file wins, the device version goes to the backups.
 */
export async function loadDoc(opts: { conflicts?: 'ask' | 'server' } = {}): Promise<Loaded> {
  ready = true;
  const [srv, rd] = await Promise.all([fetchServer(), readProject()]);
  let loc = rd.project;
  let localDoc: ConfiguratorDoc | null = null;
  if (loc) { try { localDoc = parseDoc(loc.text); } catch { await addBackup(t('sync.backupUnreadableDevice'), loc.text); loc = null; } }
  local = loc; device = rd.source === 'none' ? null : rd.source === 'fallback' ? 'fallback' : 'indexeddb';
  offline = !srv.ok; conflictServer = null; inSync = false;
  unreadable = srv.ok && srv.unreadable ? srv.error ?? t('sync.fileUnreadable') : null;
  let dec = decideLoad(srv.ok ? srv.text : undefined, loc, srv.ok ? srv.stored : null), replaced = false;
  if (dec.conflict && opts.conflicts !== 'ask' && loc) {
    await addBackup(t('sync.backupDeviceReplacedByFile'), loc.text);
    dec = { use: 'server', baseline: 'server', conflict: false }; replaced = true;
  }
  const serverText = srv.ok ? srv.text : null;
  const doc = dec.use === 'server' && serverText !== null ? parseDoc(serverText) : dec.use === 'local' && localDoc ? localDoc : defaultDoc();
  const text = serializeDoc(doc);
  if (dec.use === 'server' && serverText !== null) { await persist(text, { pending: false, baseHash: hashText(serverText) }); inSync = true; }
  else if (dec.conflict && serverText !== null) conflictServer = serverText;
  else if (dec.use === 'local' && serverText !== null) inSync = true;        // file unchanged since the last sync — saving is allowed
  else if (dec.use === 'default' && !loc) { /* first start: nothing to save until the user changes something */ }
  emit();
  return {
    doc, target: srv.ok ? 'file' : 'localStorage', file: srv.ok ? srv.file : undefined, savedText: dec.use === 'local' && serverText !== null ? serverText : text, sync: syncStatus(), migrated: rd.migrated,
    source: dec.use === 'server' ? (srv.ok ? srv.file : 'file') : dec.use === 'local' ? (srv.ok ? 'device (changes pending save to the file)' : 'device (offline)') : 'default',
    warning: srv.ok && srv.error ? srv.error : replaced ? t('sync.deviceReplacedByFile') : undefined,
  };
}

// ------------------------------------------------------------------ working copy (every change)
let queued: string | null = null, timer: ReturnType<typeof setTimeout> | null = null, writing: Promise<void> = Promise.resolve();
const flush = () => { if (timer) { clearTimeout(timer); timer = null; } if (queued === null) return writing; const q = queued; queued = null; writing = writing.then(() => persist(q)).then(emit); return writing; };
/** working copy on the device after every change (IndexedDB write with a short delay; when the app is hidden — the journal) */
export function writeLocal(doc: ConfiguratorDoc) {
  queued = serializeDoc(doc);
  if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, 250);
}
/** immediate working-copy write (tests, closing) */
export const flushLocal = () => flush();
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const hide = () => {
    // hiding / closing the app: synchronous journal (IndexedDB may not make it in time), then a regular write
    if (queued !== null) { const baseHash = local?.baseHash ?? null; writeJournal({ schema: STORAGE_SCHEMA, text: queued, rev: (local?.rev ?? 0) + 1, savedAt: new Date().toISOString(), baseHash, pending: baseHash === null || hashText(queued) !== baseHash }); }
    void flush();
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hide(); });
  window.addEventListener('pagehide', hide);
}

// ------------------------------------------------------------------ save
export interface SaveResult { ok: boolean; message: string; /** saved on the device only (offline / conflict / unreadable file) */ local?: boolean; /** copy of the replaced file (server) */ backup?: string }
/** file save timeout [ms] — a save without a server response ends like a missing connection (the changes are on the device) */
export const SAVE_TIMEOUT = { ms: 15000 };
type Put = { ok: true; body: { file: string; bytes: number; base?: string; backup?: string } } | { ok: false; network: boolean; conflict?: boolean; message: string };
/** sends the document with its base version: the hash of the file version it was derived from; 'none' — the device has not seen the file; 'force' — deliberate replacement */
async function put(text: string, base: string): Promise<Put> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), SAVE_TIMEOUT.ms) : null;
  try {
    const r = await fetch(apiUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Document-Base': base }, body: text, signal: ctl?.signal });
    const body = await r.json();
    if (!r.ok) return { ok: false, network: false, conflict: body.conflict === true, message: t('sync.saveError', { errors: (body.errors ?? [r.statusText]).join('; ') }) };
    return { ok: true, body };
  } catch (e) { return { ok: false, network: true, message: (e as Error).message }; } finally { if (tm) clearTimeout(tm); }
}
/**
 * After a successful save: the saved text becomes the base version. The working copy stays if a newer change appeared during
 * the save — writing the SAVED text to the device would roll back the newer working copy (the change would be lost on reload).
 */
async function settle(saved: string, base: string): Promise<void> {
  await writing;
  if (local && local.text !== saved) await persist(local.text, { baseHash: base });
  else await persist(saved, { pending: false, baseHash: base });
}
/** sends the text to the project file; the server refuses when the file is not the version the document was derived from */
async function push(text: string): Promise<'ok' | 'offline' | 'conflict' | 'problem' | { error: string; file?: undefined } | { ok: true; file: string; bytes: number }> {
  const r = await put(text, local?.baseHash ?? 'none');
  if (r.ok) { offline = false; inSync = true; await settle(text, r.body.base ?? hashText(text)); return { ok: true, file: r.body.file, bytes: r.body.bytes }; }
  if (r.network) { offline = true; inSync = false; return 'offline'; }
  if (!r.conflict) return { error: r.message };
  // refused: what is in the file?
  const srv = await fetchServer();
  if (!srv.ok) { offline = true; inSync = false; return 'offline'; }
  offline = false;
  if (srv.unreadable) { unreadable = srv.error ?? t('sync.fileUnreadable'); inSync = false; return 'problem'; }
  if (srv.text === text) { inSync = true; await settle(text, hashText(text)); return 'ok'; }       // the file already has this version (lost response of a previous save)
  if (srv.text === null) return { error: r.message };
  conflictServer = srv.text; inSync = false;
  return 'conflict';
}
const UNREADABLE = (why: string) => t('sync.fileNotReplacedUnreadable', { why });
/**
 * Project save: always on the device; to the project file — when connected, the file is the version the document was derived
 * from, and the app can read it. Saves run one after another (the second waits for the first — otherwise it would send a stale
 * base version).
 */
let saving: Promise<unknown> = Promise.resolve();
export function saveDoc(doc: ConfiguratorDoc, _target?: StorageTarget): Promise<SaveResult> {
  const run = saving.then(() => saveNow(doc));
  saving = run.catch(() => undefined);
  return run;
}
async function saveNow(doc: ConfiguratorDoc): Promise<SaveResult> {
  const text = serializeDoc(doc);
  queued = null; if (timer) { clearTimeout(timer); timer = null; }
  await writing;
  await persist(text, { owed: true });                                         // from now on this content is "owed" to the project file
  const onDevice = device ? t('sync.savedOnDevice') : t('sync.deviceSaveFailed');
  if (noEndpoint || !ready) { emit(); return { ok: !!device, local: true, message: t('sync.msgDevice', { device: onDevice }) }; }
  if (conflictServer !== null) { emit(); return { ok: !!device, local: true, message: t('sync.msgOtherVersion', { device: onDevice }) }; }
  if (unreadable !== null) { emit(); return { ok: !!device, local: true, message: t('sync.msgUnreadable', { device: onDevice, reason: UNREADABLE(unreadable) }) }; }
  if (!inSync) {
    // after a break: has the file changed since the base version?
    const srv = await fetchServer();
    if (!srv.ok) { offline = true; emit(); return { ok: !!device, local: true, message: t('sync.msgOffline', { device: onDevice }) }; }
    offline = false;
    if (srv.unreadable) { unreadable = srv.error ?? t('sync.fileUnreadable'); emit(); return { ok: !!device, local: true, message: t('sync.msgUnreadable', { device: onDevice, reason: UNREADABLE(unreadable) }) }; }
    if (srv.text !== null && srv.text !== text && !sameAsBase(local?.baseHash ?? null, srv.text, srv.stored)) { conflictServer = srv.text; emit(); return { ok: !!device, local: true, message: t('sync.msgChanged', { device: onDevice }) }; }
  }
  const r = await push(text);
  emit();
  if (r === 'ok') return { ok: true, message: t('sync.savedToFile') };
  if (r === 'offline') return { ok: !!device, local: true, message: t('sync.msgOffline', { device: onDevice }) };
  if (r === 'conflict') return { ok: !!device, local: true, message: t('sync.msgChangedElsewhere', { device: onDevice }) };
  if (r === 'problem') return { ok: !!device, local: true, message: t('sync.msgUnreadable', { device: onDevice, reason: UNREADABLE(unreadable ?? '') }) };
  if ('error' in r) return { ok: false, message: r.error };
  return { ok: true, message: t('sync.savedFile', { file: r.file, bytes: r.bytes }) };
}
/**
 * Deliberate replacement of a file the app cannot read with the device version (the user's decision). The server keeps the
 * previous file aside (`<file>.unreadable-<time>`) and reports where.
 */
export async function replaceUnreadable(doc?: ConfiguratorDoc): Promise<SaveResult> {
  await saving;
  if (doc) { queued = null; if (timer) { clearTimeout(timer); timer = null; } await writing; await persist(serializeDoc(doc)); } else await flush();
  if (unreadable === null || !local) return { ok: false, message: t('sync.noReplaceNeeded') };
  const text = local.text, r = await put(text, 'force');
  if (!r.ok) { if (r.network) offline = true; emit(); return { ok: false, local: r.network, message: r.network ? t('sync.noConnectionFileUnchanged') : r.message }; }
  unreadable = null; offline = false; inSync = true;
  await settle(text, r.body.base ?? hashText(text));
  emit();
  return { ok: true, message: t('sync.savedFile', { file: r.body.file, bytes: r.body.bytes }), backup: r.body.backup };
}

/**
 * Attempt to send pending changes (after the connection returns). 'synced' — file updated; 'conflict' — file changed
 * independently (the user's choice); 'offline' — still no connection; 'idle' — nothing to send.
 */
export async function syncPending(): Promise<'synced' | 'conflict' | 'offline' | 'idle'> {
  await flush();
  if (!local || noEndpoint || !ready) return 'idle';
  if (conflictServer !== null) return 'conflict';
  if (unreadable !== null) return 'idle';                                      // unreadable file: nothing is sent without the user's decision
  // Only content whose save was requested ("Save", autosave) and did not arrive (pending + owed) goes to the file. The working
  // copy by itself is not a save request — the sync loop (every 30 s, on returning to the app) must not send every change,
  // in particular with "Save automatically" off. Without a save request it only checks whether the connection is back.
  if (!(local.pending && local.owed) && !offline) return 'idle';
  await saving;
  const srv = await fetchServer();
  if (!srv.ok) { if (!offline) { offline = true; emit(); } return 'offline'; }
  offline = false;
  if (srv.unreadable) { unreadable = srv.error ?? t('sync.fileUnreadable'); emit(); return 'idle'; }
  if (!local.pending) { inSync = srv.text === local.text; emit(); return 'idle'; }
  if (!local.owed) { emit(); return 'idle'; }
  if (srv.text !== null && srv.text !== local.text && !sameAsBase(local.baseHash, srv.text, srv.stored)) { conflictServer = srv.text; emit(); return 'conflict'; }
  const r = await push(local.text);
  emit();
  return r === 'offline' ? 'offline' : r === 'conflict' ? 'conflict' : r === 'ok' || (typeof r === 'object' && 'ok' in r) ? 'synced' : 'idle';
}

/**
 * Conflict resolution. 'device' — the device version stays (file version → backup; the next save overwrites the file);
 * 'server' — the file version stays (device version → backup); returns the document to open.
 */
export async function resolveConflict(choice: 'device' | 'server'): Promise<ConfiguratorDoc | null> {
  const server = conflictServer;
  if (server === null || !ready) return null;
  await flush();
  conflictServer = null;
  if (choice === 'device') {
    await addBackup(t('sync.backupFileReplacedByDevice'), server);
    if (local) await persist(local.text, { pending: true, baseHash: hashText(server) });
    inSync = true; emit();
    return null;
  }
  if (local) await addBackup(t('sync.backupDeviceReplacedByFileChoice'), local.text);
  await persist(server, { pending: false, baseHash: hashText(server) });
  inSync = true; emit();
  return parseDoc(server);
}
export const conflictFile = () => fileName;
/** hash of the project file version the device is in sync with (null — the device has not seen the file) */
export const fileBaseHash = () => local?.baseHash ?? null;
/** tests / diagnostics: internal state */
export const __syncDebug = () => ({ local: local && { rev: local.rev, pending: local.pending, baseHash: local.baseHash, bytes: local.text.length }, offline, inSync, conflict: conflictServer !== null, noEndpoint, device });
export function __resetSync() { ready = false; local = null; device = null; offline = false; conflictServer = null; noEndpoint = false; inSync = false; unreadable = null; queued = null; if (timer) { clearTimeout(timer); timer = null; } writing = Promise.resolve(); saving = Promise.resolve(); }
