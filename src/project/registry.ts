// PROJECT BOUNDARY — discovering and loading project packages. Packages are runtime-loaded JSON directories
// (projects/<id>/project.json) listed in projects/index.json, which the Vite projects plugin generates from the
// projects/ directory (dev, preview and build). The engine knows no project ids.
import { activateProject, projectId } from './active';
import { ProjectIndexSchema, ProjectSchema, schemaErrors } from './schema';
import type { ProjectPackage } from './types';
import { validateProject } from './validate';
import catalog from '../../data/furnitureCatalog.json';
import materialCatalog from '../../data/materialCatalog.json';
import { parseProjectCatalogs, resolveCatalogUrls, setProjectCatalogs, type EngineCatalogIds, type ProjectCatalogs } from './catalogs';

export interface ProjectIndexEntry { id: string; name: string; description?: string; dir: string }
export interface ProjectIndex { schema: 'home-simulator/projects-index'; version: 1; default: string; projects: ProjectIndexEntry[] }

let index: ProjectIndex | null = null;
export function setProjectIndex(i: ProjectIndex) { index = i; }
export function projectIndex(): ProjectIndex {
  if (!index) throw new Error('No project index — the entry point must load projects/index.json (loadProjectIndex) first.');
  return index;
}
export const projectIds = (): string[] => projectIndex().projects.map((p) => p.id);
export const projectEntry = (id: string): ProjectIndexEntry | null => projectIndex().projects.find((p) => p.id === id) ?? null;

/**
 * Storage key owned by a project: every project gets keys suffixed with its id, so the state of one project never reaches
 * another.
 */
export const scopedKey = (base: string, id: string = projectId()): string => `${base}:${id}`;
/** user document of a project on the save server (relative to the user data directory) */
export const projectFile = (id: string): string => `${id}/document.json`;

export const PROJECT_PARAM = 'project';
const LAST_KEY = 'home-simulator.project';
const stored = (area: 'sessionStorage' | 'localStorage'): string | null => {
  try { const s = (globalThis as { sessionStorage?: Storage; localStorage?: Storage })[area]; return s ? s.getItem(LAST_KEY) : null; } catch { return null; }
};
/**
 * Id to load: URL parameter ?project=<id> → project of THIS TAB (sessionStorage — internal links without the parameter stay
 * in the tab's project) → last one chosen on the device → default of the index.
 */
export function resolveProjectId(search: string = typeof window !== 'undefined' ? window.location.search : ''): string {
  const ids = new Set(projectIds()), q = new URLSearchParams(search).get(PROJECT_PARAM);
  if (q && ids.has(q)) return q;
  const tab = stored('sessionStorage');
  if (tab && ids.has(tab)) return tab;
  const last = stored('localStorage');
  return last && ids.has(last) ? last : projectIndex().default;
}

/**
 * Switch to another project: remember the choice on the device and reload with ?project=<id>. One tab = one project (engine
 * modules keep models derived for the active project) — switching in place is not supported.
 */
export function switchProject(id: string) {
  if (!projectEntry(id)) throw new Error(`Unknown project "${id}"`);
  try { localStorage.setItem(LAST_KEY, id); } catch { /* no access */ }
  // the page being left gets its project in the URL: when the browser reloads it on "Back", a URL without the parameter
  // would mean "the tab's project", i.e. the one just switched to
  try { const here = new URL(window.location.href); here.searchParams.set(PROJECT_PARAM, projectId()); window.history.replaceState(window.history.state, '', here); } catch { /* no history */ }
  const u = new URL(window.location.href);
  u.pathname = '/'; u.search = ''; u.searchParams.set(PROJECT_PARAM, id);
  window.location.assign(u);
}

const BASE = (): string => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
/** URL of a file of the active project (path relative to the project directory; absolute paths are kept) */
export function assetUrl(rel: string, id: string = projectId()): string {
  if (/^([a-z]+:)?\/\//i.test(rel) || rel.startsWith('/')) return rel;
  const dir = projectEntry(id)?.dir ?? `projects/${id}/`;
  return `${BASE()}${dir}${rel}`;
}

/** furniture catalog ids of the engine */
export const engineCatalogIds = (): Set<string> => new Set((catalog as { items: { id: string }[] }).items.map((i) => i.id));
/** ids of the engine catalogs (furniture, materials and their categories) — what a project catalog extension may refer to */
export function engineCatalogs(): EngineCatalogIds {
  const f = catalog as { categories: { id: string }[]; items: { id: string }[] }, m = materialCatalog as { categories: { id: string }[]; materials: { id: string }[] };
  return { furniture: engineCatalogIds(), furnitureCategories: new Set(f.categories.map((c) => c.id)), materials: new Set(m.materials.map((x) => x.id)), materialCategories: new Set(m.categories.map((c) => c.id)) };
}
/** furniture ids a package may place: the engine catalog plus the project's own extension */
export const catalogIdsWith = (c: ProjectCatalogs): Set<string> => new Set([...engineCatalogIds(), ...c.furniture.items.map((i) => i.id)]);

/** errors of a package: structure (schema) + id match with the index + semantic validation */
export function packageErrors(data: unknown, id: string, catalogIds: ReadonlySet<string> = engineCatalogIds()): string[] {
  const structural = schemaErrors(ProjectSchema, data);
  if (structural.length) return structural;
  const p = data as ProjectPackage;
  const idError = p.manifest.projectId !== id ? [`manifest.projectId "${p.manifest.projectId}" ≠ id in the project index "${id}"`] : [];
  return [...idError, ...validateProject(p, catalogIds)];
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** loads projects/index.json (once) */
export async function loadProjectIndex(): Promise<ProjectIndex> {
  if (index) return index;
  const data = await fetchJson(`${BASE()}projects/index.json`);
  const errs = schemaErrors(ProjectIndexSchema, data);
  if (errs.length) throw new Error(`projects/index.json is invalid: ${errs.join('; ')}`);
  index = data as ProjectIndex;
  if (!index.projects.length) throw new Error('No projects installed — add a directory with project.json under projects/.');
  return index;
}

/** loads a project package, validates it, activates it and remembers it as the project of this tab */
export async function loadProject(id?: string): Promise<ProjectPackage> {
  await loadProjectIndex();
  const pid = id ?? resolveProjectId();
  const entry = projectEntry(pid);
  if (!entry) throw new Error(`Unknown project "${pid}" (available: ${projectIds().join(', ')})`);
  const data = await fetchJson(`${BASE()}${entry.dir}project.json`);
  // the package's own catalog files — needed before validation: default furniture may use their ids
  const files = (data as Partial<ProjectPackage> | null)?.catalog ?? {};
  const raw = {
    furniture: files.furniture ? await fetchJson(assetUrl(files.furniture, pid)) : undefined,
    materials: files.materials ? await fetchJson(assetUrl(files.materials, pid)) : undefined,
  };
  const ext = parseProjectCatalogs(pid, raw, engineCatalogs());
  const errs = [...ext.errors, ...packageErrors(data, pid, catalogIdsWith(ext.catalogs))];
  if (errs.length) throw new Error(`Project package "${pid}" is invalid: ${errs.join('; ')}`);
  const rememberTab = () => { try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(LAST_KEY, pid); } catch { /* no access */ } };
  rememberTab();
  // "Back" after switching projects: the browser shows this page from bfcache without reloading it, while the tab already
  // remembers the project of the page it came back from — the page being shown becomes the tab's project again
  if (typeof window !== 'undefined') window.addEventListener('pageshow', rememberTab);
  setProjectCatalogs(resolveCatalogUrls(ext.catalogs, (rel) => assetUrl(rel, pid)));
  return activateProject(data as ProjectPackage);
}
