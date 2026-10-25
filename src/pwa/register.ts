// Service worker registration and CONTROLLED updates. A new version installs in the background and waits; the app shows
// "Update available", and switching happens only after the user's decision — after saving the project (beforeReload). The app
// never reloads by itself while the user is working.
// Enabled in the production build (vite build) in a secure context (https or localhost). Automated tests (a controlled browser)
// run without the service worker by default — ?pwa=on enables it; ?pwa=off disables it and clears the offline cache.
import { createStore, useStore } from '../home/store/createStore';
import { CACHE_PREFIX } from './routes';

export interface PwaState {
  /** the browser supports a service worker in this context */
  supported: boolean;
  enabled: boolean;
  /** the page is controlled by the service worker — the app works offline */
  ready: boolean;
  build: string | null;
  files: number;
  /** a new version has been downloaded and is waiting for approval */
  waiting: boolean;
  /** running as an installed app (a window without the browser bar) */
  standalone: boolean;
  canInstall: boolean;
  checking: boolean;
}
const LS = 'home-simulator.pwa';
const hasWindow = typeof window !== 'undefined' && typeof navigator !== 'undefined';
const standaloneNow = () => hasWindow && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
export const pwa = createStore<PwaState>({ supported: hasWindow && 'serviceWorker' in navigator && window.isSecureContext, enabled: false, ready: false, build: null, files: 0, waiting: false, standalone: !!standaloneNow(), canInstall: false, checking: false });
export const usePwa = <T,>(sel: (s: PwaState) => T) => useStore(pwa, sel);

function wanted(): boolean {
  if (!pwa.get().supported) return false;
  let pref: string | null = null;
  try {
    const q = new URLSearchParams(window.location.search).get('pwa');
    if (q === 'on' || q === 'off') window.localStorage.setItem(LS, q);
    pref = window.localStorage.getItem(LS);
  } catch { /* private window */ }
  if (pref === 'off') return false;
  if (pref === 'on') return true;
  return import.meta.env.PROD && !navigator.webdriver;
}

let reg: ServiceWorkerRegistration | null = null, reloading = false, updating = false, hadController = false, lastCheck = 0;
let beforeReload: () => Promise<unknown> | unknown = () => {};
/** action before switching versions (project save) */
export const setBeforeReload = (fn: () => Promise<unknown> | unknown) => { beforeReload = fn; };
let installEvent: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;

const askState = () => navigator.serviceWorker.controller?.postMessage({ type: 'HOME_SIM_STATE' });
function watch(r: ServiceWorkerRegistration) {
  const mark = () => pwa.set({ waiting: !!r.waiting && !!navigator.serviceWorker.controller });
  mark();
  r.addEventListener('updatefound', () => {
    const nw = r.installing;
    nw?.addEventListener('statechange', () => { if (nw.state === 'installed') mark(); if (nw.state === 'activated') { pwa.set({ ready: true }); askState(); } });
  });
}

export async function initPwa(): Promise<void> {
  if (!hasWindow) return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e as typeof installEvent; pwa.set({ canInstall: true }); });
  window.addEventListener('appinstalled', () => { installEvent = null; pwa.set({ canInstall: false, standalone: !!standaloneNow() }); });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => pwa.set({ standalone: !!standaloneNow() }));
  if (!wanted()) {
    // disabled (?pwa=off): removal of this app's service worker and offline cache
    try { if (hasWindow && 'serviceWorker' in navigator && window.localStorage.getItem(LS) === 'off') { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX)) await caches.delete(k); } } catch { /* no access */ }
    return;
  }
  pwa.set({ enabled: true });
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data as { type?: string; build?: string; files?: number } | null;
    if (m?.type === 'HOME_SIM_STATE' || m?.type === 'HOME_SIM_ACTIVE') pwa.set({ build: m.build ?? null, files: m.files ?? 0, ready: !!navigator.serviceWorker.controller });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // first installation: the page becomes controlled — no reload; update: reload after saving
    if (!hadController && !updating) { hadController = true; pwa.set({ ready: true }); askState(); return; }
    if (reloading) return;
    reloading = true;
    void Promise.resolve(updating ? undefined : beforeReload()).finally(() => window.location.reload());
  });
  try {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    watch(reg);
    if (navigator.serviceWorker.controller) { pwa.set({ ready: true }); askState(); }
    lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 15 * 60_000) void checkUpdate(); });
  } catch { pwa.set({ enabled: false }); }
}
/** checks whether the server has a newer version (downloaded in the background; switching — applyUpdate) */
export async function checkUpdate(): Promise<boolean> {
  if (!reg) return false;
  pwa.set({ checking: true });
  lastCheck = Date.now();
  try { await reg.update(); } catch { /* offline */ }
  pwa.set({ checking: false, waiting: !!reg.waiting && !!navigator.serviceWorker.controller });
  return !!reg.waiting;
}
/** switch to the new version: project save, activation of the new service worker, reload */
export async function applyUpdate(): Promise<void> {
  if (!reg?.waiting) return;
  updating = true;
  try { await beforeReload(); } catch { /* the save failed — the working copy is on the device anyway */ }
  reg.waiting.postMessage({ type: 'HOME_SIM_SKIP_WAITING' });
}
export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const c = await installEvent.userChoice.catch(() => ({ outcome: 'dismissed' }));
  installEvent = null; pwa.set({ canInstall: false });
  return c.outcome === 'accepted';
}
