// Autosave (store/autosave.ts): a save refused by the server is not retried in a loop. Every end of a save (a state change)
// used to start the next one: a document the server does not accept (disk error, file too large) was sent every 1.8 s, each
// time with an error message.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSync } from '../../document/store';
import { closeDb, DB_NAME } from '../../storage/db';
import { hashText } from '../../storage/project';
import { AUTOSAVE, startAutosave } from '../store/autosave';
import { commit, design, isDirty, loadDesign, save, setNotifier, syncNow } from '../store/design';

const mem = new Map<string, string>();
const fakeLs = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 } as Storage;

/** project file server: `reject` — a save ends with a 500 error (file unchanged); EVERY save attempt is counted */
function server() {
  const s = { text: null as string | null, reject: false, attempts: 0, urls: [] as string[] };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith('/__api/document')) return json({}, 404);
    if (init?.method !== 'PUT') return json({ file: 'userdata/demo-apartment/document.json', doc: s.text === null ? null : JSON.parse(s.text) });
    s.attempts++; s.urls.push(String(url));
    if (s.reject) return json({ errors: ['no space left on the disk'] }, 500);
    const base = new Headers(init.headers).get('x-document-base');
    if (s.text !== null && base !== hashText(s.text)) return json({ conflict: true, errors: ['the project file has changed'] }, 409);
    s.text = String(init.body);
    return json({ ok: true, file: 'userdata/demo-apartment/document.json', bytes: s.text.length, base: hashText(s.text) });
  }));
  return s;
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** waiting for a condition (no guessing of times) */
async function until(cond: () => boolean, what: string, ms = 4000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`); await sleep(5); } }
const idle = () => !design.get().saving;
let n = 0;
const edit = () => commit('bookmark', (d) => ({ ...d, bookmarks: [{ id: `b${++n}`, name: `view ${n}`, position: [0, 0, 0], target: [1, 1, 1], fov: 40 }] }));
/** time in which a retry loop (15 ms delay) would make a dozen attempts */
const QUIET = 300;

let stop = () => {};
const errors: string[] = [];
beforeEach(async () => {
  vi.stubGlobal('localStorage', fakeLs);
  await closeDb(); await new Promise((ok) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => ok(null); }); mem.clear(); __resetSync();
  AUTOSAVE.delayMs = 15; errors.length = 0;
  setNotifier((text, level) => { if (level === 'error') errors.push(text); });
});
afterEach(async () => { stop(); stop = () => {}; await until(idle, 'end of the save'); setNotifier(() => {}); AUTOSAVE.delayMs = 1800; vi.unstubAllGlobals(); });

describe('autosave', () => {
  it('a change reaches the file after a moment — one attempt, the document saved', async () => {
    const s = server();
    await loadDesign(); stop = startAutosave();
    edit();
    await until(() => s.attempts === 1 && idle(), 'first save');
    await sleep(QUIET);
    expect(s.attempts).toBe(1);
    expect(isDirty(design.get())).toBe(false);
    expect(JSON.parse(s.text!).bookmarks).toHaveLength(1);
    expect(JSON.parse(s.text!).projectId).toBe('demo-apartment');
    expect(s.urls).toEqual(['/__api/document?project=demo-apartment']);   // the document of the active project
  });

  it('a save refused by the server: one attempt and one message — no retry loop', async () => {
    const s = server(); s.reject = true;
    await loadDesign(); stop = startAutosave();
    edit();
    await until(() => s.attempts >= 1 && idle(), 'first attempt');
    await sleep(QUIET);
    expect(s.attempts).toBe(1);
    expect(errors).toHaveLength(1);
    expect(isDirty(design.get())).toBe(true);                                  // the change is still marked as unsaved
    expect(design.get().sync.pending).toBe(true);                              // and waits on the device
  });

  it('after a refusal: the next change is saved right away', async () => {
    const s = server(); s.reject = true;
    await loadDesign(); stop = startAutosave();
    edit();
    await until(() => s.attempts >= 1 && idle(), 'first attempt');
    await sleep(QUIET);
    s.reject = false;
    edit();
    await until(() => s.text !== null && idle(), 'save after the next change');
    await sleep(QUIET);
    expect(s.attempts).toBe(2);
    expect(isDirty(design.get())).toBe(false);
    expect(JSON.parse(s.text!).bookmarks[0].id).toBe(`b${n}`);
  });

  it('after a refusal: a manual Save works and ends the unsaved state', async () => {
    const s = server(); s.reject = true;
    await loadDesign(); stop = startAutosave();
    edit();
    await until(() => s.attempts >= 1 && idle(), 'first attempt');
    s.reject = false;
    expect(await save()).toBe(true);
    await sleep(QUIET);
    expect(s.attempts).toBe(2);
    expect(isDirty(design.get())).toBe(false);
  });

  it('after a refusal: the silent sync (30 s loop) delivers the change and autosave settles the state', async () => {
    const s = server(); s.reject = true;
    await loadDesign(); stop = startAutosave();
    edit();
    await until(() => s.attempts >= 1 && idle(), 'first attempt');
    await sleep(QUIET);
    s.reject = false;
    await syncNow();                                                           // what the sync loop in HomeApp does
    expect(isDirty(design.get())).toBe(false);                                 // the delivered content is the saved version — right away
    await sleep(QUIET);
    expect(JSON.parse(s.text!).bookmarks).toHaveLength(1);
    expect(s.attempts).toBe(2);                                                // refused + sync (no extra save of the same content)
    expect(errors).toHaveLength(1);
  });
});

describe('"Save automatically" off', () => {
  // The sync loop (every 30 s and on returning to the app) used to send every working copy that differed from the file — a
  // change reached the project file within half a minute although the user had turned autosave off and never pressed Save.
  it('the change stays on the device: sync does not send it to the file, the unsaved state lasts until Save', async () => {
    const s = server();
    await loadDesign();                                                        // autosave not started
    await save();                                                              // the first save creates the project file
    const file = s.text, sent = s.attempts;
    edit();
    await until(() => design.get().sync.pending, 'working copy on the device');
    await syncNow(); await sleep(QUIET); await syncNow();
    expect(s.attempts).toBe(sent);
    expect(s.text).toBe(file);
    expect(isDirty(design.get())).toBe(true);
    expect(await save()).toBe(true);
    expect(JSON.parse(s.text!).bookmarks).toHaveLength(1);
    expect(isDirty(design.get())).toBe(false);
    expect(design.get().sync.pending).toBe(false);
  });
});
