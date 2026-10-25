// Service worker rules (pure function — tests): what to do with a request.
//   bypass   — not applicable (another origin, a method other than GET): the browser handles it;
//   api      — /__api/… (project file, file uploads): always network, never the cache;
//   user     — /user-assets/… (user models and photos): network, and without it — device storage (IndexedDB);
//   asset    — a file from this app version's list: always from the cache of THIS version (no mixing of versions);
//   navigate — navigation to an app page (APP_PAGES or an extension-less path): index.html of this version;
//   network  — everything else (unknown files): network.
export type Route = 'bypass' | 'api' | 'user' | 'asset' | 'navigate' | 'network';
export const API_PREFIX = '/__api/', USER_PREFIX = '/user-assets/';
/** app pages served by index.html (path routing in src/main.tsx) */
export const APP_PAGES = ['/'];

export function classify(req: { url: string; method: string; mode?: string }, origin: string, precached: ReadonlySet<string>): Route {
  let u: URL;
  try { u = new URL(req.url); } catch { return 'bypass'; }
  if (u.origin !== origin || req.method !== 'GET') return 'bypass';
  const p = u.pathname;
  if (p.startsWith(API_PREFIX)) return 'api';
  if (p.startsWith(USER_PREFIX)) return 'user';
  if (precached.has(p)) return 'asset';
  const page = p.replace(/\/+$/, '') || '/';
  if (req.mode === 'navigate' && (APP_PAGES.includes(page) || !/\.[a-z0-9]+$/i.test(p))) return 'navigate';
  return 'network';
}
/** cache name of an app version */
export const cacheName = (build: string) => `home-sim-app-${build}`;
export const CACHE_PREFIX = 'home-sim-app-';
