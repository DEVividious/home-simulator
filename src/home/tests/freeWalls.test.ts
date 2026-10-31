// Walls that bound no room in the app (the core plan fixture roof-wing-flat: a wing wall beside the garage, a garden screen wall
// with slats): the package passes the app validation and the walk on the site goes round them, not through them.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { activateProject, project } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { validateProject } from '../../project/validate';
import { nearFreeWall, WalkWorld, type WalkPose } from '../model/walkWorld';

const root = path.resolve(__dirname, '..', '..', '..');
beforeAll(() => {
  const r = compilePlan(JSON.parse(fs.readFileSync(path.join(root, 'packages/core/tests/fixtures/roof-wing-flat.plan.json'), 'utf8')), { catalog: null });
  activateProject(r.project!);
});
afterAll(() => { activateProject(readProjectDir(path.join(root, 'projects', 'demo-apartment'))); });

describe('walls that bound no room', () => {
  it('the package passes the app validation', () => { expect(validateProject(project())).toEqual([]); });
  it('walk on the site: the screen wall stops the walk (its slatted opening too); beside it one passes', () => {
    const site = project().site!, xs = site.boundary.map((q) => q[0]), ys = site.boundary.map((q) => q[1]);
    const w = new WalkWorld({ footprint: site.footprint, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ground: () => site.groundLevel });
    const go = (x: number) => { let p: WalkPose = { p: [x, -3.0], z: -0.15 }; for (let i = 0; i < 25; i++) p = w.step(p, 0, 0.1, 1.68); return p; };
    expect(nearFreeWall([2.0, -1.2])).toBe(true); expect(nearFreeWall([2.0, -2.0])).toBe(false);
    expect(go(2.0).p[1]).toBeLessThan(-1.2 - 0.12);                         // through the slats: no
    expect(go(1.0).p[1]).toBeLessThan(-1.2);                                // through the wall: no
    expect(go(4.2).p[1]).toBeGreaterThan(-0.6);                              // beside it: on up to the house
  });
});
