// Sloped ceilings authored in plan.json (level `slope`) — ridge along X or along Y — as the engine sees them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePlan, type CatalogItemInfo } from '../../authoring/compile';
import { withProject } from '../../project/active';
import { roomById } from '../model/rooms';
import { shellBounds } from '../model/shell';
import { ceilingGeometry, floorGeometry, wallGeometry } from '../three/surfaces';

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

describe('openings at the edge of a floor', () => {
  // the stair box drawn a few centimetres into the walls of the upper room (a stairwell along the wall, read off a drawing)
  const twoLevels = () => {
    const r = compilePlan({
      schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test',
      project: { id: 'stair-test', name: 'Stairs', buildingType: 'house' },
      levels: [{ id: 'L0', name: 'Ground', floorZ: 0, ceiling: 2.6 }, { id: 'L1', name: 'Upper', floorZ: 2.85, ceiling: 2.5 }],
      rooms: [{ id: 'G1', name: 'Hall', level: 'L0', kind: 'hall', rect: [0.3, 0.3, 4.3, 4.3] }, { id: 'U1', name: 'Landing', level: 'L1', kind: 'hall', rect: [0.3, 0.3, 4.3, 4.3] }],
      stairs: [{ id: 'S1', from: 'L0', to: 'L1', box: [1.0, 1.0, 2.95, 4.35], risers: 9, tread: 0.27, flightWidth: 0.95, gap: 0.05 }],
    }, { catalog });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    return r.project!;
  };
  const area = (g: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getZ: (i: number) => number } }) => {
    const p = g.getAttribute('position');
    let s = 0;
    for (let i = 0; i < p.count; i += 3) s += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) - (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i))) / 2;
    return s;
  };
  it('a stair opening reaching into the walls is still cut out of the upper floor', () => withProject(twoLevels(), () => {
    const hole = 1.95 * 3.3, room = 16;   // the opening ends at the wall face (4.30)
    expect(area(floorGeometry(roomById('U1')!))).toBeCloseTo(room - hole, 1);
  }));
});
