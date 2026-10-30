// Building blocks the core tests run on: both examples, the app's test fixtures and the core's own plan fixtures (compiled).
import fs from 'node:fs';
import path from 'node:path';
import { compilePlan } from '@home-sim/core/authoring/compile';
import type { BuildingData } from '@home-sim/core/model/building';
import type { ProjectPackage } from '@home-sim/core/package/types';

export const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const compiled = (p: string): BuildingData => {
  const r = compilePlan(read(p), { catalog: null });
  if (!r.project) throw new Error(`${p}: ${JSON.stringify(r.issues)}`);
  return r.project.building;
};

/** a fresh copy of the building block on every call (the derived building is cached by its identity) */
export const PACKAGES: Record<string, () => BuildingData> = {
  'demo-apartment': () => (read('projects/demo-apartment/project.json') as ProjectPackage).building,
  'sample-house': () => (read('projects/sample-house/project.json') as ProjectPackage).building,
  ...Object.fromEntries(['sloped-ceiling', 'placement-lab', 'mount-lab', 'catalog-ext'].map((id) => [id, () => (read(`src/test/fixtures/${id}/project.json`) as ProjectPackage).building])),
  'two-storey-l': () => compiled('packages/core/tests/fixtures/two-storey-l.plan.json'),
};
