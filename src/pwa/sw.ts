// SERVICE WORKER (built into /sw.js by src/pwa/build.ts; the file list and the version id are injected at build time). Rules:
//  • version = one complete cache (home-sim-app-<build>): all app files are fetched on install (or none — a failed install
//    keeps the previous version);
//  • a page always gets files from the cache of ITS version — old code is never mixed with new assets;
//  • a new version waits (waiting) until the user approves the update (HOME_SIM_SKIP_WAITING message) — the app never reloads
//    by itself while the user is working;
//  • /__api/… — always network; /user-assets/… — network with a copy stored on the device, and offline — from the device (IndexedDB).
import { idbGet, idbPut, STORE } from '../storage/db';
import { cacheName, CACHE_PREFIX, classify } from './routes';

declare const __HOME_SIM_BUILD__: string;
declare const __HOME_SIM_PRECACHE__: string[];

interface ExtEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEv extends ExtEvent { request: Request; respondWith(r: Promise<Response> | Response): void }
interface MsgEv extends ExtEvent { data: unknown; source: { postMessage(m: unknown): void } | null }
interface Scope {
  addEventListener(t: 'install' | 'activate', l: (e: ExtEvent) => void): void;
  addEventListener(t: 'fetch', l: (e: FetchEv) => void): void;
  addEventListener(t: 'message', l: (e: MsgEv) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(o?: { includeUncontrolled?: boolean }): Promise<{ postMessage(m: unknown): void }[]> };
  location: { origin: string };
}
const sw = self as unknown as Scope;
const BUILD = __HOME_SIM_BUILD__, FILES = __HOME_SIM_PRECACHE__, CACHE = cacheName(BUILD), PRECACHED = new Set(FILES);
const tell = async (m: unknown) => { for (const c of await sw.clients.matchAll({ includeUncontrolled: true })) c.postMessage(m); };

sw.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' — bypassing the browser HTTP cache (so as not to store an old file under the new version)
    await cache.addAll(FILES.map((u) => new Request(u, { cache: 'reload' })));
    await tell({ type: 'HOME_SIM_INSTALLED', build: BUILD, files: FILES.length });
  })());
});
sw.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && k !== CACHE) await caches.delete(k);
    await sw.clients.claim();
    await tell({ type: 'HOME_SIM_ACTIVE', build: BUILD, files: FILES.length });
  })());
});
sw.addEventListener('message', (e) => {
  const m = e.data as { type?: string } | null;
  if (m?.type === 'HOME_SIM_SKIP_WAITING') e.waitUntil(sw.skipWaiting());
  if (m?.type === 'HOME_SIM_STATE') e.source?.postMessage({ type: 'HOME_SIM_STATE', build: BUILD, files: FILES.length });
});

const fromCache = async (path: string) => (await caches.open(CACHE)).match(path, { ignoreSearch: true });
/** user file: network (storing a copy on the device), and when the server does not respond — the device copy */
async function userAsset(req: Request): Promise<Response> {
  const key = new URL(req.url).pathname;
  try {
    const r = await fetch(req);
    if (r.ok) {
      const copy = r.clone();
      void (async () => {
        const had = await idbGet<{ pending?: boolean }>(STORE.assets, key);
        if (had?.pending) return;                                             // a file added offline is waiting for upload — do not overwrite it
        const blob = await copy.blob();
        await idbPut(STORE.assets, { url: key, blob, type: r.headers.get('content-type') ?? blob.type, bytes: blob.size, savedAt: new Date().toISOString(), pending: false, api: null });
      })();
      return r;
    }
    if (r.status !== 404) return r;
  } catch { /* offline */ }
  const a = await idbGet<{ blob: Blob; type: string }>(STORE.assets, key);
  if (a) return new Response(a.blob, { headers: { 'Content-Type': a.type, 'X-Home-Sim-Source': 'device' } });
  return new Response('', { status: 504, statusText: 'offline - file not on the device' });
}

sw.addEventListener('fetch', (e) => {
  const route = classify(e.request, sw.location.origin, PRECACHED);
  if (route === 'bypass' || route === 'api') return;
  if (route === 'user') { e.respondWith(userAsset(e.request)); return; }
  if (route === 'navigate') { e.respondWith((async () => (await fromCache('/index.html')) ?? fetch(e.request))()); return; }
  if (route === 'asset') { e.respondWith((async () => (await fromCache(new URL(e.request.url).pathname)) ?? fetch(e.request))()); return; }
  // unknown file (e.g. a code chunk of an older version after a rebuild): network; offline — a clear error instead of hanging
  e.respondWith(fetch(e.request).catch(() => new Response('', { status: 504, statusText: 'offline' })));
});
