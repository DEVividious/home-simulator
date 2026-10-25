// PROJECT BOUNDARY — active project and derived data. The engine asks for building facts only here:
//   project()        — package of the active project,
//   derived(build)   — a value computed from the package and cached PER PACKAGE (not per module): one process can serve
//                      several projects (tests, the save server); in the browser one tab = one project.
// The entry point (src/main.tsx → loadProject) activates the project before the UI mounts.
import type { ProjectCapability, ProjectModule, ProjectPackage } from './types';

let current: ProjectPackage | null = null;

/** sets the active project and returns it */
export function activateProject(p: ProjectPackage): ProjectPackage {
  current = p;
  return p;
}

export function project(): ProjectPackage {
  if (!current) throw new Error('No active project — call loadProject() or activateProject() before reading building data.');
  return current;
}
export const hasActiveProject = (): boolean => current !== null;
export const projectId = (): string => project().manifest.projectId;
export const hasModule = (m: ProjectModule): boolean => project().manifest.modules.includes(m);
export const hasCapability = (c: ProjectCapability): boolean => project().manifest.capabilities.includes(c);
/** project title on documents (PDF, exports) */
export const projectTitle = (): string => project().manifest.documentTitle ?? project().manifest.name;

/** value derived from the package — computed on first use, once per package */
export function derived<T>(build: (p: ProjectPackage) => T): () => T {
  const cache = new WeakMap<ProjectPackage, { value: T }>();
  return () => {
    const p = project();
    let hit = cache.get(p);
    if (!hit) { hit = { value: build(p) }; cache.set(p, hit); }
    return hit.value;
  };
}

/** keyed cache (e.g. by room id) — separate for every package */
export function derivedByKey<K, T>(build: (key: K, p: ProjectPackage) => T): (key: K) => T {
  const maps = derived(() => new Map<K, T>());
  return (key: K) => {
    const m = maps();
    if (m.has(key)) return m.get(key) as T;
    const v = build(key, project());
    m.set(key, v);
    return v;
  };
}

/** run a synchronous function on another package (server: validating a save of a given project) */
export function withProject<T>(p: ProjectPackage, fn: () => T): T {
  const prev = current;
  current = p;
  try { return fn(); } finally { current = prev; }
}
