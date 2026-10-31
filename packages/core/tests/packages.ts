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

/** plan fixtures with roofs: gable along X and along Y (an attic with dormers, roof windows, a chimney), hip, shed, flat with a
 *  parapet, L-shaped gable, T-shaped hip */
export const ROOF_FIXTURES = ['roof-gable-x', 'roof-gable-y', 'roof-hip', 'roof-shed', 'roof-flat', 'roof-l-gable', 'roof-t-hip'];
/** plan fixtures with the other stair kinds: a straight flight (up east, with a short top landing), L-shaped stairs (up north,
 *  turning left — turned and mirrored) */
export const STAIR_FIXTURES = ['stairs-straight', 'stairs-l'];
/** plan fixtures with the other door types: double doors (an entrance and an inner one), a bifold, a sliding door */
export const DOOR_FIXTURES = ['doors'];
/** plan fixtures with walls at 45°: a chamfered corner with a window, a pantry behind a slanted partition with a door */
export const WALL_FIXTURES = ['walls-45'];
export const planOf = (id: string) => read(`packages/core/tests/fixtures/${id}.plan.json`);

/** a fresh copy of the building block on every call (the derived building is cached by its identity) */
export const PACKAGES: Record<string, () => BuildingData> = {
  'demo-apartment': () => (read('projects/demo-apartment/project.json') as ProjectPackage).building,
  'sample-house': () => (read('projects/sample-house/project.json') as ProjectPackage).building,
  ...Object.fromEntries(['sloped-ceiling', 'placement-lab', 'mount-lab', 'catalog-ext'].map((id) => [id, () => (read(`src/test/fixtures/${id}/project.json`) as ProjectPackage).building])),
  'two-storey-l': () => compiled('packages/core/tests/fixtures/two-storey-l.plan.json'),
  ...Object.fromEntries([...ROOF_FIXTURES, ...STAIR_FIXTURES, ...DOOR_FIXTURES, ...WALL_FIXTURES].map((id) => [id, () => compiled(`packages/core/tests/fixtures/${id}.plan.json`)])),
};
