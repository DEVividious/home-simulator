// Sloped ceilings authored in plan.json (level `slope`) — ridge along X or along Y — as the engine sees them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePlan, type CatalogItemInfo } from '../../authoring/compile';
import { withProject } from '../../project/active';
import { roomById } from '../model/rooms';
import { shellBounds } from '../model/shell';
import { ceilingGeometry, wallGeometry } from '../three/surfaces';

const catalog = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/furnitureCatalog.json'), 'utf8')) as { items: CatalogItemInfo[] }).items;
const attic = (ridge: 'X' | 'Y') => {
  const r = compilePlan({
    schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test',
    project: { id: 'attic-test', name: 'Attic', buildingType: 'house' },
    levels: [{ id: 'L1', name: 'Attic', floorZ: 0, ceiling: 2.5, slope: { ridge, lines: [{ at: 0.3, height: 1.4 }, { at: 1.3, height: 2.2 }] } }],
    rooms: [{ id: 'A1', name: 'Attic room', level: 'L1', kind: 'bed', rect: [0.3, 0.3, 8.3, 8.3] }],
  }, { catalog });
  expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
  return r.project!;
};
const zRange = (g: { getAttribute: (n: string) => { count: number; getY: (i: number) => number } }) => {
  const p = g.getAttribute('position'), ys = Array.from({ length: p.count }, (_, i) => p.getY(i));
  return [Math.min(...ys), Math.max(...ys)];
};

describe('sloped ceilings from plan.json', () => {
  for (const ridge of ['X', 'Y'] as const) {
    it(`ridge along ${ridge}: knee walls 1.40, flat top 2.50, geometry follows the slope`, () => withProject(attic(ridge), () => {
      const room = roomById('A1')!, at = (u: number, v: number) => (ridge === 'X' ? room.ceiling.heightAt(v, u) : room.ceiling.heightAt(u, v));
      expect(room.ceiling.kind).toBe('attic');
      expect(at(0.3, 4)).toBeCloseTo(1.4, 6);          // on the knee wall
      expect(at(1.3, 4)).toBeCloseTo(2.2, 6);          // on the 2.20 line
      expect(at(4.3, 4)).toBeCloseTo(2.5, 6);          // flat top in the middle
      expect(at(8.3, 4)).toBeCloseTo(1.4, 6);          // the other knee wall
      const [z0, z1] = zRange(ceilingGeometry(room));
      expect(z0).toBeCloseTo(1.4, 2);
      expect(z1).toBeCloseTo(2.5, 2);
      // a wall across the slope is a gable: it reaches the flat top; a knee wall stays at 1.40
      const tops = room.walls.map((w) => zRange(wallGeometry(room, w))[1]);
      expect(Math.max(...tops)).toBeCloseTo(2.5, 2);
      expect(Math.min(...tops)).toBeCloseTo(1.4, 2);
      // the generated shell rises to the flat top (not to the knee walls), so the gables stay inside it
      expect(shellBounds().max[2]).toBeGreaterThanOrEqual(2.5);
    }));
  }
});
