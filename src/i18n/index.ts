// i18n — English first (ADR 0019). UI strings live in flat dictionaries split by area: src/i18n/<lang>/<area>.json, keys
// "<area>.<name>"; all parts of a language are merged here. t(key, params) interpolates {name} placeholders and falls back
// to English, then to the key itself (a missing key is visible, never an empty string).
// Language: ?lang= → localStorage → project manifest language → browser language → English. Changing the language reloads
// the page (like switching projects): models derived per package may cache labels.
import { DICTS } from './dictionaries';

type Dict = Record<string, string>;

export const LANGUAGES: { id: string; name: string }[] = [{ id: 'en', name: 'English' }, { id: 'pl', name: 'Polski' }];
const LS_KEY = 'home-simulator.lang';
let current = 'en';

const supported = (l: string | null | undefined): string | null => {
  if (!l) return null;
  const base = l.toLowerCase().split(/[-_]/)[0];
  return DICTS[base] ? base : null;
};

/** chooses the UI language (call once at start-up, after the project manifest is known) */
export function initLang(manifestLanguage?: string): string {
  let q: string | null = null, ls: string | null = null, nav: string | null = null;
  try { q = new URLSearchParams(globalThis.location?.search ?? '').get('lang'); } catch { /* no location */ }
  try { ls = globalThis.localStorage?.getItem(LS_KEY) ?? null; } catch { /* no storage */ }
  try { nav = globalThis.navigator?.language ?? null; } catch { /* no navigator */ }
  current = supported(q) ?? supported(ls) ?? supported(manifestLanguage) ?? supported(nav) ?? 'en';
  try { if (globalThis.document) document.documentElement.lang = current; } catch { /* no DOM */ }
  return current;
}
export const lang = (): string => current;
export function setLang(l: string) { current = supported(l) ?? 'en'; }
/** remembers the language on the device and reloads the page */
export function switchLang(l: string) {
  try { localStorage.setItem(LS_KEY, l); } catch { /* no storage */ }
  const u = new URL(window.location.href);
  u.searchParams.delete('lang');
  window.location.assign(u);
}

const fill = (s: string, params?: Record<string, string | number>) => (params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m)) : s);

/** translated UI string */
export function t(key: string, params?: Record<string, string | number>): string {
  return fill(DICTS[current]?.[key] ?? DICTS.en?.[key] ?? key, params);
}
/** translated string when the dictionary has the key, otherwise the given fallback (catalog names, package texts) */
export function tOr(key: string, fallback: string, params?: Record<string, string | number>): string {
  return fill(DICTS[current]?.[key] ?? fallback, params);
}
export const hasKey = (key: string, l = current): boolean => DICTS[l]?.[key] !== undefined;

/** number formatting in the UI language */
const nf = new Map<string, Intl.NumberFormat>();
export function fmtNum(x: number, digits = 2): string {
  const k = `${current}:${digits}`;
  let f = nf.get(k);
  if (!f) { f = new Intl.NumberFormat(current, { minimumFractionDigits: digits, maximumFractionDigits: digits }); nf.set(k, f); }
  return f.format(x);
}
/** metres with unit, e.g. "2.40 m" / "2,40 m" */
export const fmtM = (x: number, digits = 2): string => `${fmtNum(x, digits)} m`;
/** centimetres with unit */
export const fmtCm = (x: number, digits = 0): string => `${fmtNum(x * 100, digits)} cm`;

/** test / tool hook: all keys of a language */
export const dictionary = (l: string): Readonly<Dict> => DICTS[l] ?? {};
