// Shared by the commands: options, the plan of a workspace compiled by the core, the solid kernel and display paths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePlan } from '@home-sim/core/authoring/compile';
import type { BuildingData } from '@home-sim/core/model/building';
import type { ProjectPackage } from '@home-sim/core/package/types';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import type { Workspace } from './workspace.ts';

export type Opts = Record<string, string | boolean | undefined>;

/** a mistake in the command line or the input: printed without a stack, exit code 2 */
export class UsageError extends Error {}

/** a path as the user should see it: relative to the current directory when inside it */
export function rel(p: string): string {
  const r = path.relative(process.cwd(), p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p;
}

/** the solid kernel; the plugin ships manifold.wasm next to house-forge.mjs, the repository finds it in node_modules */
export function geometry(): Promise<Geometry> {
  const wasm = path.join(path.dirname(fileURLToPath(import.meta.url)), 'manifold.wasm');
  return loadGeometry(fs.existsSync(wasm) ? { wasmBinary: fs.readFileSync(wasm) } : {});
}

export interface LoadedPlan { project: ProjectPackage; data: BuildingData; id: string; bytes: Buffer; warnings: number }

/** the workspace's plan compiled (furniture not checked: the plugin needs the building); issues printed; null on errors */
export function loadPlan(ws: Workspace, o: { quiet?: boolean } = {}): LoadedPlan | null {
  if (!fs.existsSync(ws.plan)) {
    console.error(`${rel(ws.plan)} not found — write the plan there first (house-forge paths --name ${ws.name})`);
    return null;
  }
  const bytes = fs.readFileSync(ws.plan);
  let json: unknown;
  try { json = JSON.parse(bytes.toString('utf8')); } catch (e) { console.error(`${rel(ws.plan)}: ${(e as Error).message}`); return null; }
  const r = compilePlan(json, { catalog: null });
  const errors = r.issues.filter((i) => i.level === 'error');
  if (!o.quiet || errors.length) {
    if (!o.quiet) for (const a of r.adjustments) console.log(`  adjusted  ${a}`);
    for (const i of r.issues) if (!o.quiet || i.level === 'error') console.log(`  ${i.level === 'error' ? 'ERROR  ' : 'warning'}  [${i.code}] ${i.message}`);
  }
  if (!r.project) { console.error(`${rel(ws.plan)}: ${errors.length} error(s) — fix them in plan.json`); return null; }
  return { project: r.project, data: r.project.building, id: r.project.manifest.projectId, bytes, warnings: r.issues.length - errors.length };
}
