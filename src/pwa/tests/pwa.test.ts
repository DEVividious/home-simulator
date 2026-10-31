// PWA / offline: the project on the device (IndexedDB, schema version, record migration, fallback path, backups), the load
// decision (file ↔ device), offline saves and sync when the connection returns, version conflicts, user files offline,
// service worker rules, the version file list and the app manifest.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDoc, serializeDoc, type ConfiguratorDoc } from '../../document/model';
import { __resetSync, __syncDebug, adoptServer, flushLocal, loadDoc, peekServer, replaceUnreadable, resolveConflict, SAVE_TIMEOUT, saveDoc, syncPending, syncStatus, writeLocal } from '../../document/store';
import { getAsset, listAssets, syncAssets, uploadUserFile } from '../../storage/assets';
import { closeDb, DB_NAME, DB_VERSION, idbGet, openDb, STORE } from '../../storage/db';
import { addBackup, decideLoad, FALLBACK_LS_KEY, hashText, JOURNAL_LS_KEY, listBackups, migrateRecord, readProject, STORAGE_SCHEMA, writeJournal, writeProject, type LocalProject } from '../../storage/project';
import { MANIFEST, precacheOf } from '../build';
import { APP_PAGES, CACHE_PREFIX, cacheName, classify } from '../routes';

const named = (name: string): ConfiguratorDoc => { const d = defaultDoc(); return { ...d, variants: d.variants.map((v, i) => (i === 0 ? { ...v, name } : v)) }; };
const T = (name: string) => serializeDoc(named(name));
const rec = (text: string, patch: Partial<LocalProject> = {}): LocalProject => ({ schema: STORAGE_SCHEMA, text, rev: 1, savedAt: '2026-10-04T10:00:00.000Z', pending: false, baseHash: hashText(text), ...patch });
/** device storage keys are scoped to the project (src/project/registry.ts scopedKey) */
const FALLBACK = `${FALLBACK_LS_KEY}:demo-apartment`, JOURNAL = `${JOURNAL_LS_KEY}:demo-apartment`;

// localStorage in the test environment (node)
const mem = new Map<string, string>();
const fakeLs = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 } as Storage;

/**
 * Project file server (GET / PUT /__api/document?project=<id>) — or no connection. Saves as in src/document/server.ts:
 * accepted when the base version header matches the file hash (or there is no file, or `force`), otherwise 409.
 * `broken` — the file exists but the server cannot read it (a response with the reason); `gate` — a save waits for release
 * (a save in progress); `hang` — a save never gets a response.
 */
function server(initial: string | null) {
  const s = { text: initial, online: true, puts: 0, refused: 0, bases: [] as (string | null)[], urls: [] as string[], broken: null as string | null, gate: null as Promise<void> | null, hang: false, backups: [] as string[], /** status every save ends with (0 — saves work) */ fail: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!s.online) throw new TypeError('Failed to fetch');
    if (String(url).startsWith('/__api/document')) {
      s.urls.push(String(url));
      if (init?.method === 'PUT') {
        const base = new Headers(init.headers).get('x-document-base');
        s.bases.push(base);
        if (s.hang) await new Promise((_, no) => init.signal?.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError'))));
        if (s.gate) await s.gate;
        if (s.fail) return json({ errors: ['server error'] }, s.fail);
        const exists = s.text !== null || s.broken !== null;
        if (exists && base !== 'force' && (s.broken !== null || base !== hashText(s.text!))) { s.refused++; return json({ conflict: true, ...(s.broken !== null ? { unreadable: true } : {}), errors: ['the project file has changed'] }, 409); }
        if (base === 'force' && (s.broken ?? s.text) !== null) s.backups.push(s.broken ?? s.text!);
        s.text = String(init.body); s.broken = null; s.puts++;
        return json({ ok: true, file: 'userdata/demo-apartment/document.json', bytes: s.text.length, base: hashText(s.text) });
      }
      if (s.broken !== null) return json({ file: 'userdata/demo-apartment/document.json', doc: null, unreadable: s.broken });
      return json({ file: 'userdata/demo-apartment/document.json', doc: s.text === null ? null : JSON.parse(s.text) });
    }
    return json({}, 404);
  }));
  return s;
}
const wipe = async () => { await closeDb(); await new Promise((ok) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => ok(null); }); mem.clear(); __resetSync(); };

beforeEach(async () => { vi.stubGlobal('localStorage', fakeLs); await wipe(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('project on the device: IndexedDB, schema version, migration, fallback path', () => {
  it('database: one schema version; project, backup, file and metadata stores', async () => {
    const db = (await openDb())!;
    expect(db.name).toBe(DB_NAME); expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([STORE.assets, STORE.backups, STORE.meta, STORE.project].sort());
  });
  it('the project is written to and read from IndexedDB (not localStorage); the schema version is stored', async () => {
    expect(await writeProject(rec(T('A')))).toBe('indexeddb');
    const r = await readProject();
    expect(r).toMatchObject({ source: 'indexeddb', migrated: false });
    expect(r.project!.text).toBe(T('A')); expect(r.project!.schema).toBe(STORAGE_SCHEMA);
    expect(mem.size).toBe(0);
    expect((await idbGet<{ schema: number }>(STORE.meta, 'schema'))!.schema).toBe(STORAGE_SCHEMA);
  });
  it('a device without any record: nothing to read, nothing migrated', async () => {
    expect(await readProject()).toEqual({ project: null, source: 'none', migrated: false });
  });
  it('a record from an older / incomplete schema is completed; a record without a document is rejected', () => {
    expect(migrateRecord({ text: T('A') })).toMatchObject({ schema: STORAGE_SCHEMA, rev: 1, pending: true, baseHash: null });
    expect(migrateRecord({ schema: 0, text: T('A'), rev: 7, pending: false, baseHash: 'abc' })).toMatchObject({ rev: 7, pending: false, baseHash: 'abc' });
    expect(migrateRecord({ text: T('A'), pending: true, owed: true })).toMatchObject({ owed: true });
    expect(migrateRecord({ text: T('A'), pending: false, owed: true })).not.toHaveProperty('owed');
    expect(migrateRecord({ rev: 3 })).toBeNull(); expect(migrateRecord(null)).toBeNull(); expect(migrateRecord('x')).toBeNull();
  });
  it('the journal (written when the app is hidden) newer than IndexedDB wins and is moved into the database', async () => {
    await writeProject(rec(T('A'), { rev: 4 }));
    expect(writeJournal(rec(T('B'), { rev: 5, pending: true }))).toBe(true);
    expect(mem.has(JOURNAL)).toBe(true);
    const r = await readProject();
    expect(r.source).toBe('journal'); expect(r.project!.text).toBe(T('B'));
    expect(mem.has(JOURNAL)).toBe(false);
    expect((await readProject()).source).toBe('indexeddb');
    writeJournal(rec(T('C'), { rev: 2 }));                                    // older journal — ignored
    expect((await readProject()).project!.text).toBe(T('B'));
  });
  it('FALLBACK: without IndexedDB the project goes to localStorage (and comes back from there)', async () => {
    await closeDb();
    vi.stubGlobal('indexedDB', undefined);
    expect(await writeProject(rec(T('A')))).toBe('fallback');
    expect(mem.has(FALLBACK)).toBe(true);
    const r = await readProject();
    expect(r.source).toBe('fallback'); expect(r.project!.text).toBe(T('A'));
    await closeDb();
  });
  it('backups: no repeats of the same version, at most 8 (the oldest go away)', async () => {
    for (let i = 0; i < 11; i++) { await addBackup(`backup ${i}`, T(`version ${i}`)); await new Promise((r) => setTimeout(r, 2)); }
    await addBackup('repeat', T('version 10'));
    const all = await listBackups();
    expect(all.length).toBe(8); expect(all[0].label).toBe('backup 10'); expect(all.at(-1)!.label).toBe('backup 3');
    expect(all.every((b) => b.projectId === 'demo-apartment')).toBe(true);
  });
});

describe('load decision: project file ↔ device', () => {
  const S = T('file'), L = T('device');
  it('offline: the project from the device (or the default on first start)', () => {
    expect(decideLoad(undefined, rec(L))).toMatchObject({ use: 'local', conflict: false });
    expect(decideLoad(undefined, null)).toMatchObject({ use: 'default', conflict: false });
  });
  it('online, the device without its own changes: the file wins', () => {
    expect(decideLoad(S, null)).toMatchObject({ use: 'server', baseline: 'server' });
    expect(decideLoad(S, rec(L, { pending: false }))).toMatchObject({ use: 'server', conflict: false });
    expect(decideLoad(S, rec(S, { pending: true }))).toMatchObject({ use: 'server', conflict: false });
  });
  it('online, changes made offline, the file unchanged since the last sync: the device version waits to be saved (no conflict)', () => {
    expect(decideLoad(S, rec(L, { pending: true, baseHash: hashText(S) }))).toEqual({ use: 'local', baseline: 'server', conflict: false });
  });
  it('online, both sides changed: CONFLICT — the device version opens, the choice is the user\'s', () => {
    expect(decideLoad(S, rec(L, { pending: true, baseHash: hashText(T('old file version')) }))).toEqual({ use: 'local', baseline: 'server', conflict: true });
    expect(decideLoad(S, rec(L, { pending: true, baseHash: null })).conflict).toBe(true);
  });
  it('the file text as stored on disk (other formatting) is the same version — the device changes wait without a conflict', () => {
    const stored = JSON.stringify(named('same file')), read = T('same file');
    expect(decideLoad(read, rec(L, { pending: true, baseHash: hashText(stored) }), stored)).toEqual({ use: 'local', baseline: 'server', conflict: false });
    // a file really changed in the meantime — a conflict as before
    expect(decideLoad(read, rec(L, { pending: true, baseHash: hashText(T('old file version')) }), stored).conflict).toBe(true);
  });
  it('the project file does not exist yet: the project from the device', () => { expect(decideLoad(null, rec(L)).use).toBe('local'); expect(decideLoad(null, null).use).toBe('default'); });
});

describe('offline saves and sync with the project file', () => {
  it('online: load from the file; save → file + a copy on the device (in sync, nothing pending); the URL names the project', async () => {
    const s = server(T('file'));
    const l = await loadDoc({ conflicts: 'ask' });
    expect(l.target).toBe('file'); expect(serializeDoc(l.doc)).toBe(T('file')); expect(l.sync).toMatchObject({ offline: false, pending: false, conflict: false, device: 'indexeddb' });
    const r = await saveDoc(named('change 1'));
    expect(r).toMatchObject({ ok: true }); expect(r.local).toBeUndefined(); expect(s.text).toBe(T('change 1')); expect(s.puts).toBe(1);
    expect(syncStatus().pending).toBe(false);
    expect((await readProject()).project).toMatchObject({ text: T('change 1'), pending: false, baseHash: hashText(T('change 1')) });
    expect(new Set(s.urls)).toEqual(new Set(['/__api/document?project=demo-apartment']));
  });
  it('OFFLINE: the save succeeds on the device ("waiting for a connection"); after a restart offline the data is recovered', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false;
    const r = await saveDoc(named('offline 1'));
    expect(r.ok).toBe(true); expect(r.local).toBe(true); expect(r.message).toMatch(/offline/);
    expect(syncStatus()).toMatchObject({ offline: true, pending: true });
    expect(s.text).toBe(T('file'));                                            // file untouched
    __resetSync();                                                              // "app restart"
    const l = await loadDoc({ conflicts: 'ask' });
    expect(l.target).toBe('localStorage'); expect(serializeDoc(l.doc)).toBe(T('offline 1')); expect(l.sync).toMatchObject({ offline: true, pending: true });
    expect(l.savedText).toBe(T('offline 1'));                                  // offline nothing is "unsaved" — it is on the device
  });
  it('connection back: device changes reach the file (the file unchanged in the meantime)', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('offline 1'));
    expect(await syncPending()).toBe('offline');
    s.online = true;
    expect(await syncPending()).toBe('synced');
    expect(s.text).toBe(T('offline 1')); expect(syncStatus()).toMatchObject({ offline: false, pending: false, conflict: false });
    expect(await syncPending()).toBe('idle');
  });
  it('restart ONLINE with changes made offline: the device version opens, "unsaved" against the file — a save sends it to the file', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('offline 1')); __resetSync(); s.online = true;
    const l = await loadDoc({ conflicts: 'ask' });
    expect(serializeDoc(l.doc)).toBe(T('offline 1')); expect(l.savedText).toBe(T('file')); expect(l.sync).toMatchObject({ pending: true, conflict: false, offline: false });
    expect((await saveDoc(l.doc)).ok).toBe(true);
    expect(s.text).toBe(T('offline 1'));
  });
  it('CONFLICT: file changed on the PC, project changed offline — nothing is overwritten; choosing "device" / "file" keeps the other version in the backups', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('offline 1'));
    s.text = T('pc'); s.online = true;
    expect(await syncPending()).toBe('conflict');
    expect(s.text).toBe(T('pc')); expect(s.puts).toBe(0);
    const blocked = await saveDoc(named('offline 2'));                          // a save during a conflict does not touch the file
    expect(blocked.local).toBe(true); expect(s.puts).toBe(0);
    // choice: the file version
    const doc = await resolveConflict('server');
    expect(serializeDoc(doc!)).toBe(T('pc')); expect(syncStatus()).toMatchObject({ conflict: false, pending: false });
    expect((await listBackups()).some((b) => b.text === T('offline 2') && /version from this device/.test(b.label))).toBe(true);
    // second time: choosing the device version
    s.online = false; await saveDoc(named('offline 3')); s.text = T('pc 2'); s.online = true;
    expect(await syncPending()).toBe('conflict');
    expect(await resolveConflict('device')).toBeNull();
    expect((await listBackups()).some((b) => b.text === T('pc 2') && /project file \(PC\)/.test(b.label))).toBe(true);
    expect((await saveDoc(named('offline 3'))).local).toBeUndefined();
    expect(s.text).toBe(T('offline 3'));
  });
  it('conflict on load: the Home app asks (opens the device version); expert tools adopt the file and the device version goes to the backups', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('offline 1')); s.text = T('pc'); s.online = true;
    __resetSync();
    const home = await loadDoc({ conflicts: 'ask' });
    expect(serializeDoc(home.doc)).toBe(T('offline 1')); expect(home.sync.conflict).toBe(true); expect(home.savedText).toBe(T('pc'));
    __resetSync();
    const tool = await loadDoc();
    expect(serializeDoc(tool.doc)).toBe(T('pc')); expect(tool.sync.conflict).toBe(false);
    expect((await listBackups()).some((b) => b.text === T('offline 1'))).toBe(true);
  });
  it('a working copy of every change goes to the device (debounced — one write per series); an unfinished server save loses nothing', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    const rev0 = __syncDebug().local!.rev;
    for (const n of ['a', 'b', 'c']) writeLocal(named(n));
    await flushLocal();
    expect((await readProject()).project!.text).toBe(T('c'));
    expect(__syncDebug().local!.rev).toBe(rev0 + 1);
    expect(syncStatus().pending).toBe(true); expect(s.text).toBe(T('file'));
  });
  it('hosting without the project endpoint (static): the project lives on the device only, no attempts to save to a file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const l = await loadDoc({ conflicts: 'ask' });
    expect(l.target).toBe('localStorage');
    const r = await saveDoc(named('local'));
    expect(r).toMatchObject({ ok: true, local: true }); expect(__syncDebug().noEndpoint).toBe(true);
    __resetSync();
    expect(serializeDoc((await loadDoc()).doc)).toBe(T('local'));
  });
  it('a device copy that cannot be read (another project, damaged) goes to the backups; the file opens', async () => {
    server(T('file'));
    await writeProject(rec('{ damaged', { pending: true }));
    const l = await loadDoc({ conflicts: 'ask' });
    expect(serializeDoc(l.doc)).toBe(T('file'));
    expect((await listBackups()).map((b) => [b.label, b.text])).toEqual([['device copy that could not be read', '{ damaged']]);
  });
});

// "No silent data loss": (1) a tab "in sync with the file" must not send the document without checking that the file did not
// change; (2) a file the app cannot read is not a missing file; (3) a damaged file is not "no connection" forever; (4) the
// device working copy must not roll back when a save ends; (5) a save has a time limit.
describe('a save never silently replaces someone else\'s work', () => {
  it('SECOND DEVICE: the file changed while the app is open and "in sync" — the save does not touch the file, there is a conflict; the choice keeps the other version in the backups', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.text = T('from the phone');                                              // a second device saved via the same server
    const r = await saveDoc(named('from the desktop'));
    expect(r.ok).toBe(true); expect(r.local).toBe(true); expect(r.message).toMatch(/has changed/);
    expect(s.text).toBe(T('from the phone')); expect(s.puts).toBe(0);
    expect(syncStatus()).toMatchObject({ conflict: true, pending: true });
    expect((await readProject()).project!.text).toBe(T('from the desktop'));   // the work from this device is safe
    expect(await resolveConflict('device')).toBeNull();
    expect((await saveDoc(named('from the desktop'))).local).toBeUndefined();
    expect(s.text).toBe(T('from the desktop'));
    expect((await listBackups()).some((b) => b.text === T('from the phone'))).toBe(true);
  });
  it('a tool in a second tab that loaded an older version does not roll back later changes — the save is refused with an explanation', async () => {
    const s = server(T('file'));
    await loadDoc();                                                            // a tool (no conflict question)
    s.text = T('newer from Home');
    const r = await saveDoc(named('from the tool'));
    expect(s.text).toBe(T('newer from Home')); expect(s.puts).toBe(0);
    expect(r.local).toBe(true); expect(r.message).toMatch(/has changed/);
  });
  it('a save sends the base version: the hash of the file version the document came from; after a save — the hash of the saved version', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    await saveDoc(named('a')); await saveDoc(named('b'));
    expect(s.bases).toEqual([hashText(T('file')), hashText(T('a'))]);
    expect(s.refused).toBe(0);
  });
  it('the first save when there is no file yet: base version "none"', async () => {
    const s = server(null);
    await loadDoc({ conflicts: 'ask' });
    expect((await saveDoc(named('first'))).local).toBeUndefined();
    expect(s.bases).toEqual(['none']); expect(s.text).toBe(T('first'));
  });
  it('the save response was lost but the file already has the sent version: the next save is not a conflict', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.text = T('sent');                                                        // the server saved, the response did not arrive
    const r = await saveDoc(named('sent'));
    expect(r.ok).toBe(true); expect(r.local).toBeUndefined();
    expect(syncStatus()).toMatchObject({ conflict: false, pending: false });
  });
  it('refresh after returning to the tab: merely checking the file does not move the base version (a change made meanwhile does not overwrite another save)', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.text = T('from another tab');
    expect(await peekServer()).toMatchObject({ text: T('from another tab') });
    expect(__syncDebug().local!.baseHash).toBe(hashText(T('file')));
    await saveDoc(named('my change'));                                          // the user changed something before the file was adopted
    expect(s.text).toBe(T('from another tab')); expect(syncStatus().conflict).toBe(true);
  });
  it('adopting the file version (a tab without its own changes): the device is in sync with the file, the next save goes through', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.text = T('from another tab');
    const peek = await peekServer();
    await adoptServer(peek!.text!);
    expect(__syncDebug().local).toMatchObject({ pending: false, baseHash: hashText(T('from another tab')) });
    expect((await saveDoc(named('next'))).local).toBeUndefined();
    expect(s.text).toBe(T('next'));
  });
});

describe('a project file the app cannot read is not a "missing file"', () => {
  const REJECTED = JSON.stringify({ ...JSON.parse(T('user file')), variants: 'unreadable' });
  it('a document rejected by the app: a change does NOT replace the file; a "problem" state with the reason; nothing is sent', async () => {
    const s = server(REJECTED);
    const l = await loadDoc({ conflicts: 'ask' });
    expect(l.warning).toMatch(/rejected/);
    expect(l.sync.problem).toMatch(/rejected/);
    const r = await saveDoc(named('first change'));
    expect(s.text).toBe(REJECTED); expect(s.puts).toBe(0); expect(s.bases).toEqual([]);
    expect(r.ok).toBe(true); expect(r.local).toBe(true); expect(r.message).toMatch(/was not replaced/);
    expect(await syncPending()).toBe('idle'); expect(s.puts).toBe(0);
  });
  it('a document of another project in the file is rejected the same way — never adopted', async () => {
    const foreign = JSON.stringify({ ...JSON.parse(T('other')), projectId: 'sample-house' });
    const s = server(foreign);
    const l = await loadDoc({ conflicts: 'ask' });
    expect(l.sync.problem).toMatch(/belongs to project "sample-house"/);
    expect(l.doc.projectId).toBe('demo-apartment');
    await saveDoc(named('mine'));
    expect(s.puts).toBe(0);
  });
  it('deliberately replacing the unreadable file with the device version: a forced save, the server keeps a copy, the problem is gone', async () => {
    const s = server(REJECTED);
    await loadDoc({ conflicts: 'ask' });
    await saveDoc(named('my version'));
    const r = await replaceUnreadable();
    expect(r.ok).toBe(true);
    expect(s.bases).toEqual(['force']); expect(s.text).toBe(T('my version')); expect(s.backups).toEqual([REJECTED]);
    expect(syncStatus()).toMatchObject({ problem: null, pending: false, conflict: false });
    expect((await saveDoc(named('next'))).local).toBeUndefined();
  });
  it('a file damaged on disk (the server gives the reason): the app is not "offline", shows the problem and sends no changes', async () => {
    const s = server(T('file')); s.broken = 'file userdata/demo-apartment/document.json is damaged (Unexpected end of JSON input)';
    const l = await loadDoc({ conflicts: 'ask' });
    expect(l.target).toBe('file');
    expect(l.sync).toMatchObject({ offline: false }); expect(l.sync.problem).toMatch(/damaged/);
    await saveDoc(named('change'));
    expect(s.puts).toBe(0); expect(syncStatus().offline).toBe(false);
  });
  it('device in sync, then the file is damaged: after a restart a change waits on the device (pending), nothing is sent', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    await saveDoc(named('in sync'));
    expect(syncStatus().pending).toBe(false);
    s.broken = 'file userdata/demo-apartment/document.json is damaged';
    __resetSync();                                                              // "app restart"
    const l = await loadDoc({ conflicts: 'ask' });
    expect(serializeDoc(l.doc)).toBe(T('in sync'));                            // the project from the device
    expect(l.sync).toMatchObject({ pending: false, offline: false }); expect(l.sync.problem).toMatch(/damaged/);
    writeLocal(named('change')); await flushLocal();
    expect(syncStatus().pending).toBe(true);
    const r = await saveDoc(named('change'));
    expect(r.local).toBe(true);
    expect(syncStatus()).toMatchObject({ pending: true, offline: false });
    expect(s.puts).toBe(1);                                                    // only the first save ("in sync")
  });
  it('the file became unreadable during work (the server refuses the save): a problem instead of an error loop', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.broken = 'file userdata/demo-apartment/document.json is damaged';
    const r = await saveDoc(named('change'));
    expect(r.local).toBe(true); expect(syncStatus().problem).toMatch(/damaged/); expect(s.puts).toBe(0);
  });
});

describe('a save in progress does not lose newer changes', () => {
  const gated = (s: ReturnType<typeof server>) => { let open!: () => void; s.gate = new Promise<void>((ok) => { open = ok; }); return () => { s.gate = null; open(); }; };
  it('a change made DURING a save stays on the device after it ends (the working copy does not roll back) and waits for the next save', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    const release = gated(s);
    const saving = saveDoc(named('A'));
    await new Promise((ok) => setTimeout(ok, 20));
    writeLocal(named('B')); await flushLocal();
    expect((await readProject()).project!.text).toBe(T('B'));
    release();
    expect((await saving).ok).toBe(true);
    expect(s.text).toBe(T('A'));
    expect((await readProject()).project).toMatchObject({ text: T('B'), pending: true, baseHash: hashText(T('A')) });
    expect((await saveDoc(named('B'))).local).toBeUndefined();
    expect(s.text).toBe(T('B')); expect(s.refused).toBe(0);
  });
  it('two saves in a row run one after another: the file gets the last version, no false conflict', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    const release = gated(s);
    const first = saveDoc(named('A')), second = saveDoc(named('B'));
    await new Promise((ok) => setTimeout(ok, 20));
    release();
    expect((await first).ok).toBe(true); expect((await second).ok).toBe(true);
    expect(s.text).toBe(T('B')); expect(s.refused).toBe(0); expect(syncStatus().conflict).toBe(false);
  });
  it('a save without a server response ends after a timeout like a missing connection (changes on the device, a later retry)', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.hang = true; SAVE_TIMEOUT.ms = 60;
    try {
      const r = await saveDoc(named('A'));
      expect(r.ok).toBe(true); expect(r.local).toBe(true); expect(r.message).toMatch(/offline/);
      expect(syncStatus()).toMatchObject({ offline: true, pending: true });
    } finally { SAVE_TIMEOUT.ms = 15000; s.hang = false; }
    expect(await syncPending()).toBe('synced');
    expect(s.text).toBe(T('A'));
  });
  it('tools: the device version replaced with the file on load — with a warning saying where the copy is', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('offline')); s.text = T('pc'); s.online = true;
    __resetSync();
    const tool = await loadDoc();
    expect(serializeDoc(tool.doc)).toBe(T('pc'));
    expect(tool.warning).toMatch(/copy: Settings → App and data → Backups/);
  });
});

describe('sync delivers only what was SAVED (with autosave off nothing reaches the file)', () => {
  // The working copy is written on every change and differs from the file (pending) — but it is not a save request. The sync
  // loop (every 30 s, on returning to the app) must not send every such copy.
  it('a working copy without a save request is not sent to the file', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    writeLocal(named('change without save')); await flushLocal();
    expect(syncStatus()).toMatchObject({ pending: true, offline: false });       // the device differs from the file
    expect(await syncPending()).toBe('idle');
    expect(s.puts).toBe(0); expect(s.text).toBe(T('file'));
    expect((await readProject()).project).toMatchObject({ text: T('change without save'), pending: true });
  });
  it('an offline save, then a change without a save: the unsaved change does not reach the file', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('saved offline')); s.online = true;
    writeLocal(named('later without save')); await flushLocal();
    expect(await syncPending()).toBe('idle');
    expect(s.puts).toBe(0); expect(s.text).toBe(T('file'));
    // "Save" delivers everything
    expect((await saveDoc(named('later without save'))).local).toBeUndefined();
    expect(s.text).toBe(T('later without save'));
  });
  it('an offline save survives a restart: sync delivers it to the file without another "Save"', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('saved offline')); __resetSync(); s.online = true;
    await loadDoc({ conflicts: 'ask' });
    expect(await syncPending()).toBe('synced');
    expect(s.text).toBe(T('saved offline')); expect(syncStatus()).toMatchObject({ pending: false, offline: false });
  });
  it('a working copy from before a restart (without a save) is not sent after the restart', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    writeLocal(named('change without save')); await flushLocal(); __resetSync();
    const l = await loadDoc({ conflicts: 'ask' });
    expect(serializeDoc(l.doc)).toBe(T('change without save')); expect(l.savedText).toBe(T('file'));   // opens as "unsaved"
    expect(await syncPending()).toBe('idle');
    expect(s.puts).toBe(0); expect(s.text).toBe(T('file'));
  });
  it('a save refused by the server stays owed: sync retries it once the server accepts again', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.fail = 500;
    const r = await saveDoc(named('refused'));
    expect(r.ok).toBe(false); expect(r.message).toMatch(/save error: server error/); expect(s.text).toBe(T('file'));
    expect(await syncPending()).toBe('idle');                                  // still refused — silently
    s.fail = 0;
    expect(await syncPending()).toBe('synced');
    expect(s.text).toBe(T('refused'));
  });
  it('no connection and no save request: sync only checks the connection (the offline state goes away) and sends nothing', async () => {
    const s = server(T('file'));
    await loadDoc({ conflicts: 'ask' });
    s.online = false; await saveDoc(named('A')); s.online = true;
    expect(await syncPending()).toBe('synced');                                // A delivered
    s.online = false; expect((await saveDoc(named('B'))).local).toBe(true); s.online = true;
    writeLocal(named('C without save')); await flushLocal();
    expect(await syncPending()).toBe('idle');
    expect(syncStatus()).toMatchObject({ offline: false, pending: true });
    expect(s.text).toBe(T('A'));
  });
});

describe('user files (models, thumbnails, photos) on the device', () => {
  const blob = (n: number, type = 'model/gltf-binary') => new Blob([new Uint8Array(n)], { type });
  it('online: the file goes to the server + a copy on the device (available offline later)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, file: 'm1.glb', url: '/user-assets/furniture/imported/m1.glb' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const r = await uploadUserFile('/__api/furniture-import?kind=model&file=m1.glb', '/user-assets/furniture/imported/m1.glb', blob(2048));
    expect(r).toMatchObject({ ok: true, file: 'm1.glb' }); expect(r.offline).toBeUndefined();
    const a = (await getAsset('/user-assets/furniture/imported/m1.glb'))!;
    expect(a.bytes).toBe(2048); expect(a.pending).toBe(false); expect(a.type).toBe('model/gltf-binary');
  });
  it('offline: the file is stored on the device, marked for upload; uploaded when the connection returns', async () => {
    let online = false; const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (!online) throw new TypeError('Failed to fetch'); sent.push(String(url)); return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); }));
    const r = await uploadUserFile('/__api/photo-upload?file=terrace.jpg', '/user-assets/photos/terrace.jpg', blob(5000, 'image/jpeg'));
    expect(r).toMatchObject({ ok: true, offline: true, url: '/user-assets/photos/terrace.jpg', file: 'terrace.jpg' });
    expect((await listAssets()).filter((a) => a.pending).length).toBe(1);
    expect(await syncAssets()).toBe(0);
    online = true;
    expect(await syncAssets()).toBe(1);
    expect(sent).toEqual(['/__api/photo-upload?file=terrace.jpg']);
    expect((await getAsset('/user-assets/photos/terrace.jpg'))!.pending).toBe(false);
  });
  it('a file refused by the server (bad content) is not stored on the device', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: ['invalid file content'] }), { status: 400, headers: { 'content-type': 'application/json' } })));
    const r = await uploadUserFile('/__api/furniture-import?kind=model&file=x.glb', '/user-assets/furniture/imported/x.glb', blob(10));
    expect(r.ok).toBe(false); expect(r.error).toMatch(/invalid/); expect(await listAssets()).toEqual([]);
  });
});

describe('service worker: rules and version', () => {
  const O = 'http://localhost:4170', pre = new Set(['/index.html', '/assets/HomeApp-abc.js', '/projects/index.json', '/projects/demo-apartment/project.json', '/manifest.webmanifest']);
  const c = (url: string, mode = 'cors', method = 'GET') => classify({ url: url.startsWith('http') ? url : O + url, method, mode }, O, pre);
  it('project saves and file uploads: always network; other origins and methods — outside the service worker', () => {
    expect(c('/__api/document?project=demo-apartment')).toBe('api'); expect(c('/__api/document', 'cors', 'PUT')).toBe('bypass');
    expect(c('https://fonts.example/x.woff2')).toBe('bypass');
    expect(c('not a url')).toBe('bypass');
  });
  it('version files (code, project packages) — from this version\'s cache; also with query parameters', () => {
    expect(c('/assets/HomeApp-abc.js')).toBe('asset'); expect(c('/projects/demo-apartment/project.json')).toBe('asset');
    expect(c('/projects/index.json?x=1')).toBe('asset'); expect(c('/index.html')).toBe('asset');
  });
  it('navigation to app pages (/, deep links, extension-less paths) — this version\'s index.html', () => {
    expect(APP_PAGES).toEqual(['/']);
    for (const p of APP_PAGES) expect(c(p, 'navigate')).toBe('navigate');
    expect(c('/?section=electrical&project=sample-house', 'navigate')).toBe('navigate'); expect(c('/some/page/', 'navigate')).toBe('navigate');
    expect(c('/projects/index.json', 'navigate')).toBe('asset');
    expect(c('/report.pdf', 'navigate')).toBe('network');
  });
  it('user files — network with a copy on the device; unknown files — network', () => {
    expect(c('/user-assets/photos/terrace.jpg')).toBe('user'); expect(c('/assets/Old-chunk-123.js')).toBe('network');
  });
  it('version file list: every file of the output directory (without sw.js and maps); the id changes with any file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-sim-pwa-'));
    try {
      fs.mkdirSync(path.join(dir, 'assets')); fs.writeFileSync(path.join(dir, 'index.html'), '<html>1</html>'); fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'a'); fs.writeFileSync(path.join(dir, 'assets', 'a.js.map'), '{}'); fs.writeFileSync(path.join(dir, 'sw.js'), 'old');
      const p1 = precacheOf(dir);
      expect(p1.files).toEqual(['/assets/a.js', '/index.html']);
      fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'b');
      const p2 = precacheOf(dir);
      expect(p2.build).not.toBe(p1.build); expect(p2.build).toMatch(/^[0-9a-f]{12}$/);
      expect(cacheName(p2.build)).toBe(`home-sim-app-${p2.build}`);
      expect(cacheName(p2.build).startsWith(CACHE_PREFIX)).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('page ↔ service worker messages: every HOME_SIM_* type the page sends or listens for is handled or sent by the worker', () => {
    const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const types = (s: string) => new Set([...s.matchAll(/'(HOME_SIM_[A-Z_]+)'/g)].map((m) => m[1]));
    const page = types(src('register.ts')), worker = types(src('sw.ts'));
    expect([...page].sort()).toEqual(['HOME_SIM_ACTIVE', 'HOME_SIM_SKIP_WAITING', 'HOME_SIM_STATE']);
    for (const t of page) expect(worker.has(t), t).toBe(true);
  });
  it('manifest: installable app in its own window, regular and maskable icons, shortcuts', () => {
    expect(MANIFEST.name).toBe('Home Simulator');
    expect(MANIFEST.display).toBe('standalone'); expect(MANIFEST.start_url).toBe('/'); expect(MANIFEST.scope).toBe('/');
    expect(MANIFEST.icons.filter((i) => i.purpose === 'maskable').map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    expect(MANIFEST.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    for (const i of MANIFEST.icons) expect(fs.existsSync(path.join(__dirname, '..', i.src.replace('/icons/', 'icons/'))), i.src).toBe(true);
    expect(MANIFEST.shortcuts.map((s) => s.url)).toEqual(['/?section=electrical&mode=advanced']);
  });
});
