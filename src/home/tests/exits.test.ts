// Exits in the walk (usability issue B8): the sample house's front door and its floor-level glazed door to the terrace are the
// ways out — on the inner face of their walls, pointing out — and a click on a sign opens a closed door and walks out in two
// legs (up to the opening, then through it). The demo apartment (no site) has none.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { walkOutside } from '../actions';
import { doorById, openOf } from '../model/doors';
import { EXIT_WALK_OUT, exits } from '../model/exits';
import { roomById } from '../model/rooms';
import { walkInput } from '../scene/walkInput';
import { doors, openDoor } from '../store/doors';

const root = path.resolve(__dirname, '..', '..', '..');
const readProject = (id: string) => readProjectDir(path.join(root, 'projects', id));

describe('exits', () => {
  it('a project without a site has no exits', () => { expect(exits()).toEqual([]); });
  describe('sample house', () => {
    beforeAll(() => { activateProject(readProject('sample-house')); });
    afterAll(() => { walkInput.to = null; activateProject(readProject('demo-apartment')); });
    it('the front door and the glazed door to the terrace, on their walls, pointing out of the building', () => {
      const list = exits(), pass = readProject('sample-house').building.doorFacts?.passableOpenings ?? [];
      expect(list.map((e) => e.kind).sort()).toEqual(['door', ...pass.map(() => 'glazing')].sort());
      for (const e of list) {
        const r = roomById(e.roomId)!, inside = [e.at[0] - e.out[0] * 0.3, e.at[1] - e.out[1] * 0.3] as [number, number];
        expect(r.walls.some((w) => Math.abs((e.at[0] - w.a[0]) * w.inward[0] + (e.at[1] - w.a[1]) * w.inward[1]) < 1e-6)).toBe(true);
        expect(Math.hypot(...e.out)).toBeCloseTo(1, 9);
        expect(inside[0] > r.bbox[0] && inside[0] < r.bbox[2] && inside[1] > r.bbox[1] && inside[1] < r.bbox[3]).toBe(true);
        expect(e.head).toBeGreaterThan(1.9); expect(e.width).toBeGreaterThan(0.7);
      }
    });
    it('a sign clicked: the closed front door opens, the walk goes up to the opening and then out through it', () => {
      const d = exits().find((e) => e.kind === 'door')!;
      openDoor(d.id, 0);
      expect(walkOutside(d.id)).toBe(true);
      expect(openOf(doors.get(), d.id)).toBe(1);
      const first = walkInput.to!;
      expect(Math.hypot(first.p[0] - (d.at[0] - d.out[0] * 0.6), first.p[1] - (d.at[1] - d.out[1] * 0.6))).toBeLessThan(1e-9);
      first.done();
      const out = walkInput.to!;
      expect(Math.hypot(out.p[0] - (d.at[0] + d.out[0] * EXIT_WALK_OUT), out.p[1] - (d.at[1] + d.out[1] * EXIT_WALK_OUT))).toBeLessThan(1e-9);
      expect(doorById(d.id)!.rooms).toContain('exterior');
      expect(walkOutside('nothing')).toBe(false);
    });
  });
});
