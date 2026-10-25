// The app's IndexedDB (large data on the device): the project, project backups, user files (imported models, thumbnails,
// photos). One schema description for the page and for the service worker (the same file goes into sw.js) — both open the
// database with the same version and the same upgrade function. Small preferences (UI, doors, view) stay in localStorage.
// No IndexedDB (private mode, an old environment, tests without a browser) → the functions return null / false — the layers
// above then have a fallback path (localStorage).
export const DB_NAME = 'home-simulator';
/** database schema version; an increase = a new branch in upgradeDb (existing stores and data stay) */
export const DB_VERSION = 1;
export const STORE = { project: 'project', backups: 'backups', assets: 'assets', meta: 'meta' } as const;
export type StoreName = (typeof STORE)[keyof typeof STORE];

/** schema upgrade: only adds missing stores (data stays) */
export function upgradeDb(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(STORE.project)) db.createObjectStore(STORE.project);
    if (!db.objectStoreNames.contains(STORE.backups)) db.createObjectStore(STORE.backups, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(STORE.assets)) db.createObjectStore(STORE.assets, { keyPath: 'url' });
    if (!db.objectStoreNames.contains(STORE.meta)) db.createObjectStore(STORE.meta);
  }
}

let opening: Promise<IDBDatabase | null> | null = null;
export function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = (e) => upgradeDb(req.result, e.oldVersion);
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return opening;
}
/** closes and forgets the connection (tests; version change) */
export async function closeDb() { const db = opening ? await opening : null; db?.close(); opening = null; }

const done = <T,>(req: IDBRequest<T>) => new Promise<T>((ok, bad) => { req.onsuccess = () => ok(req.result); req.onerror = () => bad(req.error); });
const txDone = (tx: IDBTransaction) => new Promise<void>((ok, bad) => { tx.oncomplete = () => ok(); tx.onerror = () => bad(tx.error); tx.onabort = () => bad(tx.error); });

export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try { return await done(db.transaction(store, 'readonly').objectStore(store).get(key)) as T | undefined; } catch { return undefined; }
}
/** write; `key` only for stores without a keyPath. false — not written (no database / out of space) */
export async function idbPut(store: StoreName, value: unknown, key?: IDBValidKey): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); await txDone(tx); return true; } catch { return false; }
}
export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); await txDone(tx); return true; } catch { return false; }
}
export async function idbAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  if (!db) return [];
  try { return await done(db.transaction(store, 'readonly').objectStore(store).getAll()) as T[]; } catch { return []; }
}
