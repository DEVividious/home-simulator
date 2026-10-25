// Full reset of the app data of one origin before a test scenario. The app keeps a working copy of every project on the device
// (IndexedDB 'home-simulator'), preferences in localStorage ('home-simulator.*', project state scoped ':<projectId>'), the tab's
// project in sessionStorage and — with the PWA on — a service worker with its offline cache ('home-sim-app-<build>'). Clearing
// only localStorage is not enough: the device copy of the previous scenario would open instead of the project file (or raise
// the "Two versions of the project" dialog).
// Call it on a page of the origin that does not run the app (e.g. /manifest.webmanifest or /projects/index.json) — the
// database is not open there, so deleting it is not blocked.
// Tests run without the service worker by default (preference 'off' — the current build is always used); sw: null leaves the
// preference unset (PWA tests: the service worker registers again with ?pwa=on).
export const DB_NAME = 'home-simulator';
export const LS_PREFIX = 'home-simulator.';
export const CACHE_PREFIX = 'home-sim-app-';

/** clears the app data of the page's origin; returns what was removed */
export const clearAppData = (page, { sw = 'off' } = {}) => page.evaluate(async ({ sw, DB_NAME, CACHE_PREFIX }) => {
  const removed = { localStorage: localStorage.length, caches: 0, workers: 0, db: false };
  localStorage.clear();
  sessionStorage.clear();
  if (sw) localStorage.setItem('home-simulator.pwa', sw);
  try { if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) { await r.unregister(); removed.workers++; } } catch { /* context without a service worker */ }
  try { if (window.caches) for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX)) { await caches.delete(k); removed.caches++; } } catch { /* no cache storage */ }
  removed.db = await new Promise((done) => { const q = indexedDB.deleteDatabase(DB_NAME); q.onsuccess = () => done(true); q.onerror = q.onblocked = () => done(false); });
  return removed;
}, { sw, DB_NAME, CACHE_PREFIX });

/** keys of the app in localStorage of the page's origin */
export const appKeys = (page) => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)).sort(), LS_PREFIX);

/** opens a page of the origin that does not run the app and clears the app data there */
export async function resetOrigin(page, base, opts) {
  await page.goto(`${base}/manifest.webmanifest`, { waitUntil: 'load' }).catch(() => {});
  return clearAppData(page, opts);
}
