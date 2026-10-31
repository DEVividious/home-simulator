// The compiler without a furniture catalog (catalog: null) — what tools that need only the building (print export, plugin) use.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePlan, type CatalogItemInfo } from '@home-sim/core/authoring/compile';
import { COORD_LIMIT, outOfRange } from '@home-sim/core/package/range';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const catalog = (read('data/furnitureCatalog.json') as { items: CatalogItemInfo[] }).items;

describe('compilePlan with catalog: null', () => {
  for (const id of ['demo-apartment', 'sample-house']) {
    it(`${id}: the building is the same as with the catalog`, () => {
      const plan = read(`projects/${id}/source/plan.json`);
      const withCat = compilePlan(plan, { catalog }), without = compilePlan(plan, { catalog: null });
      expect(without.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(without.project!.building).toEqual(withCat.project!.building);
      expect(without.project!.interiors.items.map((i) => i.key)).toEqual(withCat.project!.interiors.items.map((i) => i.key));
    });
  }

  it('does not reject unknown catalog items or variants', () => {
    const plan = {
      schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test',
      project: { id: 'test-flat', name: 'Test flat', buildingType: 'apartment' },
      levels: [{ id: 'L1', name: 'Flat', floorZ: 0, ceiling: 2.6 }],
      rooms: [{ id: 'R1', name: 'Living', level: 'L1', kind: 'living', rect: [0.3, 0.3, 4.3, 3.3] }],
      furniture: [{ room: 'R1', catalogId: 'not-in-any-catalog', variant: 'x', at: [2, 2] }],
    };
    expect(compilePlan(plan, { catalog }).issues.map((i) => i.code)).toContain('furniture.catalog');
    const r = compilePlan(plan, { catalog: null });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.project!.interiors.items[0].catalogId).toBe('not-in-any-catalog');
  });
});

describe('a flat roof around a higher level, a passage through a wall with a flue', () => {
  const plan = (flatPolygon: number[][], wall = 0.12) => ({
    schema: 'home-simulator/plan', version: 1, project: { id: 'wing', name: 'Wing', buildingType: 'house' }, units: 'm', source: 'synthetic test plan',
    levels: [{ id: 'G', name: 'Ground', floorZ: 0, ceiling: 2.6 }, { id: 'U', name: 'Upper', floorZ: 2.85, ceiling: 2.5 }],
    rooms: [{ id: 'A', name: 'A', level: 'G', kind: 'living', rect: [0.3, 0.3, 4.3, 6.3] }, { id: 'B', name: 'B', level: 'G', kind: 'room', rect: [4.3 + wall, 0.3, 8.3, 6.3] },
      { id: 'C', name: 'C', level: 'U', kind: 'bed', rect: [0.3, 3.3, 4.3, 6.3] }],
    passages: [{ between: ['A', 'B'], at: [4.3 + wall / 2, 2.0], width: 1.0 }],
    roof: { parts: [{ id: 'main', level: 'U', type: 'gable', rect: [0, 3.0, 4.6, 6.6], ridge: 'X', pitch: 35 }, { id: 'flat', level: 'G', type: 'flat', polygon: flatPolygon }] },
  });
  it('an L-shaped flat part beside the upper level compiles (its bounding box reaching under the upper level is not an overlap)', () => {
    const r = compilePlan(plan([[0, 0], [8.6, 0], [8.6, 6.6], [4.6, 6.6], [4.6, 3.0], [0, 3.0]]), { catalog: null });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('a flat part reaching under the upper level is still an error', () => {
    const r = compilePlan(plan([[0, 0], [8.6, 0], [8.6, 6.6], [0, 6.6]]), { catalog: null });
    expect(r.issues.map((i) => i.code)).toContain('roof.levelAbove');
  });
  it('a passage through a 0.7 m wall (a flue in it) is found; through 0.9 m it is not', () => {
    expect(compilePlan(plan([[0, 0], [8.6, 0], [8.6, 6.6], [4.6, 6.6], [4.6, 3.0], [0, 3.0]], 0.7), { catalog: null }).issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(compilePlan(plan([[0, 0], [8.6, 0], [8.6, 6.6], [4.6, 6.6], [4.6, 3.0], [0, 3.0]], 0.9), { catalog: null }).issues.map((i) => i.code)).toContain('door.wall');
  });
});

describe('numbers out of range', () => {
  const flat = (rect: number[]) => ({
    schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test',
    project: { id: 'test-flat', name: 'Test flat', buildingType: 'apartment' },
    levels: [{ id: 'L1', name: 'Flat', floorZ: 0, ceiling: 2.6 }],
    rooms: [{ id: 'R1', name: 'Living', level: 'L1', kind: 'living', rect: [0.3, 0.3, 4.3, 3.3] }, { id: 'R2', name: 'Far', level: 'L1', kind: 'room', rect }],
  });

  it('a room 20 km from the origin is an error (plan.range) naming the room and the number; nothing is written', () => {
    const r = compilePlan(flat([2e4, 0.3, 2e4 + 4, 3.3]), { catalog: null });
    const e = r.issues.find((i) => i.code === 'plan.range')!;
    expect(r.project).toBeNull();
    expect(e.level).toBe('error');
    expect(e.message).toMatch(/within 10 km of the project origin/);
    expect(e.message).toContain('building.rooms.rooms[R2].bbox[0] = 20000');
  });

  it('the limit: a building up to 10 km from the origin compiles', () => {
    const r = compilePlan(flat([COORD_LIMIT - 5, 0.3, COORD_LIMIT - 1, 3.3]), { catalog: null });
    expect(r.issues.filter((i) => i.code === 'plan.range')).toEqual([]);
  });

  it('the shipped plans and the fixtures have nothing out of range; non-finite numbers are reported; at most ten', () => {
    for (const id of ['demo-apartment', 'sample-house']) expect(outOfRange(compilePlan(read(`projects/${id}/source/plan.json`), { catalog }).project!)).toEqual([]);
    for (const f of fs.readdirSync(path.join(ROOT, 'packages/core/tests/fixtures')).filter((x) => x.endsWith('.plan.json'))) {
      // a fixture of an error (roof-corner-missing) has no project
      const project = compilePlan(read(`packages/core/tests/fixtures/${f}`), { catalog: null }).project;
      if (project) expect(outOfRange(project), f).toEqual([]);
    }
    const b = read('projects/demo-apartment/project.json').building;
    b.rooms.rooms[0].floor_z = NaN; b.shell = { exteriorWall: Infinity };
    expect(outOfRange({ building: b })).toEqual([`building.rooms.rooms[${b.rooms.rooms[0].id}].floor_z = NaN`, 'building.shell.exteriorWall = Infinity']);
    b.rooms.rooms[0].polygon = Array.from({ length: 20 }, () => [2e4, 2e4]);
    expect(outOfRange({ building: b })).toHaveLength(10);
  });
});
