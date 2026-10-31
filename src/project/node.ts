// PROJECT BOUNDARY (Node only) — reading project directories from disk: the save server, unit tests and the project CLI
// (npm run project:validate). Never imported by browser code.
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectIndex } from './registry';
import { catalogIdsWith, engineCatalogs, packageErrors } from './registry';
import { parseProjectCatalogs, type ProjectCatalogs } from './catalogs';
import type { ProjectPackage } from './types';

export const PROJECTS_DIR = 'projects';

/** project.json of a project directory, parsed (no validation) */
export function readProjectJson(dir: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
}

/** catalog extension files of a package, parsed and checked; `data` — its project.json */
export function readProjectCatalogs(dir: string, data: unknown): { catalogs: ProjectCatalogs; errors: string[] } {
  const files = (data as Partial<ProjectPackage> | null)?.catalog ?? {}, errors: string[] = [];
  const read = (key: 'furniture' | 'materials'): unknown => {
    const rel = files[key];
    if (!rel) return undefined;
    try { return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch (e) { errors.push(`catalog.${key}: ${rel}: ${(e as Error).message}`); return undefined; }
  };
  const r = parseProjectCatalogs(path.basename(path.resolve(dir)), { furniture: read('furniture'), materials: read('materials') }, engineCatalogs());
  return { catalogs: r.catalogs, errors: [...errors, ...r.errors] };
}

/** all errors of a project directory: catalog extension files + package (structure, ids, semantics) */
export function projectDirErrors(dir: string, data: unknown = readProjectJson(dir)): string[] {
  const ext = readProjectCatalogs(dir, data);
  // the directory name is the project id (projects/<id>/project.json)
  return [...ext.errors, ...packageErrors(data, path.basename(path.resolve(dir)), catalogIdsWith(ext.catalogs))];
}

/** project package from a directory; throws with the list of errors when the package is invalid */
export function readProjectDir(dir: string): ProjectPackage {
  const data = readProjectJson(dir) as ProjectPackage;
  const errs = projectDirErrors(dir, data);
  if (errs.length) throw new Error(`Project package "${dir}" is invalid:\n  ${errs.join('\n  ')}`);
  return data;
}

/** directories under root/projects that contain a project.json */
export function projectDirs(root: string): string[] {
  const base = path.join(root, PROJECTS_DIR);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, 'project.json')))
    .map((e) => e.name).sort();
}

/** the example packages shipped with the engine — a user's own project opens before them */
const EXAMPLES = ['sample-house', 'demo-apartment'];
/**
 * projects/index.json built from the project directories. Default project: HOME_SIM_DEFAULT_PROJECT, then the first
 * project that is not a shipped example, then the examples in the order of EXAMPLES.
 */
export function buildProjectIndex(root: string): ProjectIndex {
  const projects = projectDirs(root).map((d) => {
    let name = d, names: Record<string, string> | undefined, description: string | undefined;
    try { const m = (readProjectJson(path.join(root, PROJECTS_DIR, d)) as ProjectPackage).manifest; name = m.name; names = m.names; description = m.description; } catch { /* reported at load time */ }
    return { id: d, name, ...(names ? { names } : {}), ...(description ? { description } : {}), dir: `${PROJECTS_DIR}/${d}/` };
  });
  const env = process.env.HOME_SIM_DEFAULT_PROJECT;
  const def = (env && projects.some((p) => p.id === env) ? env : undefined) ?? projects.find((p) => !EXAMPLES.includes(p.id))?.id ?? EXAMPLES.find((e) => projects.some((p) => p.id === e)) ?? projects[0]?.id ?? 'demo-apartment';
  return { schema: 'home-simulator/projects-index', version: 1, default: def, projects };
}
