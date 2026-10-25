// The project on the device (offline work). The project document (with variant thumbnails — hundreds of kB) lives in IndexedDB,
// not in localStorage. The record has a schema version and a migration from older records, backups (the last 8) and a fallback
// path when IndexedDB does not work.
//
// Sync model with the project file on the PC (endpoint /__api/document, userdata/<id>/document.json):
//   baseHash — hash of the file version this device was last in sync with;
//   pending  — the working copy on the device differs from that version (changes are waiting to be saved to the file);
//   owed     — saving this exact content was requested but has not reached the file (see LocalProject.owed).
// The load decision is made by decideLoad (pure function — tests).
// Every project has its own record, its own fallback keys and its own backups (scopedKey).
import { projectId } from '../project/active';
import { scopedKey } from '../project/registry';
import { idbAll, idbDelete, idbGet, idbPut, STORE } from './db';

/** schema version of the project record on the device */
export const STORAGE_SCHEMA = 1;
/** fallback path (without IndexedDB) and the journal of the last change (synchronous write when the app is hidden) */
export const FALLBACK_LS_KEY = 'home-simulator.project.v1';
export const JOURNAL_LS_KEY = 'home-simulator.project.journal.v1';
const PROJECT_KEY = 'current', MAX_BACKUPS = 8, JOURNAL_MAX = 1_500_000;

export interface LocalProject {
  schema: number;
  /** project document (serializeDoc) — this device's working copy */
  text: string;
  /** counter of writes on the device (increasing) */
  rev: number;
  savedAt: string;
  pending: boolean;
  baseHash: string | null;
  /**
   * Saving THIS content to the project file was requested ("Save", autosave) but did not arrive (offline, server refusal).
   * Only such content is delivered by the sync; a working copy without a save request (pending without owed) waits for "Save".
   */
  owed?: boolean;
}
export interface ProjectBackup { id: string; label: string; savedAt: string; bytes: number; text: string; /** project of the backup */ projectId: string }

/** text hash (FNV-1a, 2 × 32 bits) — for comparing versions, not cryptography */
export function hashText(t: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ t.length;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x85ebca6b) + 0x7f4a7c15; }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
const ls = (): Storage | null => { try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; } };
const lsGet = (k: string) => { try { return ls()?.getItem(k) ?? null; } catch { return null; } };
const lsSet = (k: string, v: string) => { try { ls()?.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k: string) => { try { ls()?.removeItem(k); } catch { /* no access */ } };

/** migration of a record from an older schema (today: filling in fields); null — the record cannot be read */
export function migrateRecord(raw: unknown): LocalProject | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LocalProject>;
  if (typeof r.text !== 'string' || !r.text) return null;
  return { schema: STORAGE_SCHEMA, text: r.text, rev: Number.isFinite(r.rev) ? Number(r.rev) : 1, savedAt: typeof r.savedAt === 'string' ? r.savedAt : new Date().toISOString(), pending: r.pending !== false, baseHash: typeof r.baseHash === 'string' ? r.baseHash : null, ...(r.owed === true && r.pending !== false ? { owed: true } : {}) };
}
const parseJson = (t: string | null): unknown => { if (!t) return null; try { return JSON.parse(t); } catch { return null; } };

export interface ReadResult { project: LocalProject | null; source: 'indexeddb' | 'journal' | 'fallback' | 'none'; migrated: boolean }
/** reads the project from the device: IndexedDB → (newer) journal → fallback record */
export async function readProject(): Promise<ReadResult> {
  let project = migrateRecord(await idbGet<unknown>(STORE.project, scopedKey(PROJECT_KEY))), source: ReadResult['source'] = project ? 'indexeddb' : 'none';
  const j = migrateRecord(parseJson(lsGet(scopedKey(JOURNAL_LS_KEY))));
  if (j && (!project || j.rev > project.rev)) { project = j; source = 'journal'; }
  if (!project) { const f = migrateRecord(parseJson(lsGet(scopedKey(FALLBACK_LS_KEY)))); if (f) { project = f; source = 'fallback'; } }
  if (project && source !== 'indexeddb') await writeProject(project);
  return { project, source, migrated: false };
}
/** writes the project on the device; returns where it was stored or null (out of space) */
export async function writeProject(p: LocalProject): Promise<'indexeddb' | 'fallback' | null> {
  const rec = { ...p, schema: STORAGE_SCHEMA };
  if (await idbPut(STORE.project, rec, scopedKey(PROJECT_KEY))) { lsDel(scopedKey(FALLBACK_LS_KEY)); lsDel(scopedKey(JOURNAL_LS_KEY)); await idbPut(STORE.meta, { schema: STORAGE_SCHEMA, at: rec.savedAt }, 'schema'); return 'indexeddb'; }
  return lsSet(scopedKey(FALLBACK_LS_KEY), JSON.stringify(rec)) ? 'fallback' : null;
}
/** journal: synchronous write of the last state when the app is hidden (the IndexedDB write may not have finished yet) */
export function writeJournal(p: LocalProject): boolean {
  if (p.text.length > JOURNAL_MAX) return false;
  return lsSet(scopedKey(JOURNAL_LS_KEY), JSON.stringify({ ...p, schema: STORAGE_SCHEMA }));
}

// ------------------------------------------------------------------ backups
/** backups of the active project */
const mine = (b: ProjectBackup) => b.projectId === projectId();
export async function addBackup(label: string, text: string): Promise<boolean> {
  const all = (await idbAll<ProjectBackup>(STORE.backups)).filter(mine).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  if (all.some((b) => b.text === text)) return true;                         // this version is already there
  const at = new Date().toISOString(), ok = await idbPut(STORE.backups, { id: `${at}-${hashText(text).slice(0, 6)}`, label, savedAt: at, bytes: text.length, text, projectId: projectId() } satisfies ProjectBackup);
  for (const old of all.slice(0, Math.max(0, all.length + 1 - MAX_BACKUPS))) await idbDelete(STORE.backups, old.id);
  return ok;
}
export const listBackups = async (): Promise<ProjectBackup[]> => (await idbAll<ProjectBackup>(STORE.backups)).filter(mine).sort((a, b) => b.savedAt.localeCompare(a.savedAt));

// ------------------------------------------------------------------ load decision
export interface LoadDecision {
  /** which document to open */
  use: 'server' | 'local' | 'default';
  /** the project file version against which the "unsaved" state is computed (null — file unavailable / does not exist yet) */
  baseline: 'server' | 'local' | null;
  /** both sides changed since the last sync — the choice is the user's; nothing is overwritten automatically */
  conflict: boolean;
}
/** whether the project file is the same file the device was last in sync with: hash of the text as read or — after an app
 *  update — hash of the text as stored on disk (`stored`: a document migration changes the text, not the content) */
export const sameAsBase = (baseHash: string | null, server: string, stored?: string | null): boolean =>
  baseHash !== null && (baseHash === hashText(server) || (!!stored && baseHash === hashText(stored)));
/**
 * server: project file text (null — file not saved yet), `undefined` — server unavailable (offline).
 * local: the device record. stored: the file text as stored on disk (before the document migration), if known.
 */
export function decideLoad(server: string | null | undefined, local: LocalProject | null, stored?: string | null): LoadDecision {
  if (server === undefined) return { use: local ? 'local' : 'default', baseline: local && !local.pending ? 'local' : null, conflict: false };
  if (server === null) return { use: local ? 'local' : 'default', baseline: null, conflict: false };
  if (!local || local.text === server) return { use: 'server', baseline: 'server', conflict: false };
  if (!local.pending) return { use: 'server', baseline: 'server', conflict: false };                 // device without its own changes — the file wins
  if (sameAsBase(local.baseHash, server, stored)) return { use: 'local', baseline: 'server', conflict: false };   // file unchanged since the last sync — the device changes wait to be saved
  return { use: 'local', baseline: 'server', conflict: true };
}
