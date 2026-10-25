// plan.json → project.json compiler (src/authoring/compile.ts, ADR 0014).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePlan, normalizePolygon, type CatalogItemInfo } from '../compile';
import { packageErrors } from '../../project/registry';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const catalog = (JSON.parse(fs.readFileSync(path.join(ROOT, 'data/furnitureCatalog.json'), 'utf8')) as { items: CatalogItemInfo[] }).items;
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const compile = (plan: unknown, lock?: Parameters<typeof compilePlan>[1]['lock']) => compilePlan(plan, { catalog, lock });
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const errors = (r: ReturnType<typeof compile>) => r.issues.filter((i) => i.level === 'error').map((i) => i.code);

/** minimal two-room plan in metres: R1 (0.3…4.3 × 0.3…3.3) | 0.12 wall | R2 (4.42…7.7 × 0.3…3.3) */
const base = () => ({
  schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test',
  project: { id: 'test-flat', name: 'Test flat', buildingType: 'apartment' },
  levels: [{ id: 'L1', name: 'Flat', floorZ: 0, ceiling: 2.6 }],
  rooms: [
    { id: 'R1', name: 'Living', level: 'L1', kind: 'living', rect: [0.3, 0.3, 4.3, 3.3] },
    { id: 'R2', name: 'Bedroom', level: 'L1', kind: 'bed', rect: [4.42, 0.3, 7.7, 3.3] },
  ],
  doors: [{ id: 'D1', between: ['R1', 'R2'], at: [4.36, 1.5], width: 0.9, swingInto: 'R2', hinge: 'left' }],
} as Record<string, unknown>);

describe('shipped examples are compiled from their plans', () => {
  for (const id of ['demo-apartment', 'sample-house']) {
    it(`${id}: project.json equals the compiled source/plan.json and passes validation`, () => {
      const r = compile(read(`projects/${id}/source/plan.json`));
      expect(errors(r)).toEqual([]);
      const { $schema: _s, ...shipped } = read(`projects/${id}/project.json`);
      void _s;
      expect(r.project).toEqual(shipped);
      expect(packageErrors(r.project, id, new Set(catalog.map((c) => c.id)))).toEqual([]);
    });
  }
});

describe('outlines', () => {
  it('counter-clockwise from the lowest-left corner, collinear points removed', () => {
    expect(normalizePolygon([[0, 3], [4, 3], [4, 0], [2, 0], [0, 0]])).toEqual([[0, 0], [4, 0], [4, 3], [0, 3]]);
  });
  it('area, bbox and rectangular are derived', () => {
    const r1 = compile(base()).project!.building.rooms.rooms[0];
    expect(r1.area).toBe(12);
    expect(r1.bbox).toEqual([0.3, 0.3, 4.3, 3.3]);
    expect(r1.rectangular).toBe(true);
    expect(r1.ceiling).toEqual({ kind: 'flat', z: 2.6 });
  });
  it('overlapping rooms are an error', () => {
    const p = base();
    (p.rooms as { rect: number[] }[])[1].rect = [4.0, 0.3, 7.7, 3.3];
    expect(errors(compile(p))).toContain('room.overlap');
  });
  it('a slanted edge is an error (generated shell needs orthogonal plans)', () => {
    const p = base();
    (p.rooms as Record<string, unknown>[])[1] = { id: 'R2', name: 'Bedroom', level: 'L1', kind: 'bed', polygon: [[4.42, 0.3], [7.7, 0.3], [7.7, 3.3], [5, 3.3]] };
    p.doors = [];
    expect(errors(compile(p))).toContain('room.orthogonal');
  });
});

describe('doors', () => {
  it('the gap is written into both rooms with the faces of the wall', () => {
    const rooms = compile(base()).project!.building.rooms.rooms;
    const gap = { along: 'Y', from_: 1.05, to: 1.95, across: [4.3, 4.42], width: 0.9, door_id: 'D1', leaf: 0.8, height: 2.05 };
    expect(rooms[0].doors).toEqual([gap]);
    expect(rooms[1].doors).toEqual([gap]);
  });
  it('hinge on the face of the room it opens into, 5 cm from the jamb; left / right as seen from that room', () => {
    const left = compile(base()).project!.building.doors[0];
    // R2 lies at larger x: the leaf opens towards +x; looking at the wall from R2 means looking towards −x, so "left" is −y
    expect(left).toMatchObject({ hinge: [4.42, 1.1], closedDir: [0, 1], openDir: [1, 0], hingeSide: 'left', swingInto: 'R2', leafWidth: 0.8 });
    const p = base();
    (p.doors as Record<string, unknown>[])[0].hinge = 'right';
    expect(compile(p).project!.building.doors[0]).toMatchObject({ hinge: [4.42, 1.9], closedDir: [0, -1], hingeSide: 'right' });
  });
  it('exterior door: the outer face is exteriorWall away; it opens inwards', () => {
    const p = base();
    p.doors = [{ id: 'D0', between: ['R1', 'exterior'], at: [0.15, 1.5], width: 1.0, hinge: 'right' }];
    const d = compile(p).project!.building.doors[0];
    expect(d.rooms).toEqual(['R1', 'exterior']);
    expect(d.opening.faces).toEqual([0, 0.3]);
    expect(d.swingInto).toBe('R1');
    expect(d.openDir).toEqual([1, 0]);
  });
  it('a door that is not on a shared wall is an error', () => {
    const p = base();
    (p.doors as Record<string, unknown>[])[0].at = [2, 1.5];
    expect(errors(compile(p))).toContain('door.wall');
  });
  it('sliding doors move along the wall centre line', () => {
    const p = base();
    p.doors = [{ id: 'D1', between: ['R1', 'R2'], at: [4.36, 1.5], width: 0.9, type: 'sliding', slideTo: 'start' }];
    const d = compile(p).project!.building.doors[0];
    expect(d).toMatchObject({ type: 'sliding', hinge: null, slide: { origin: [4.36, 1.95], dir: [0, -1], travel: 0.8 } });
  });
});

describe('windows, furniture, stairs, site', () => {
  it('window: plane axis and face from the wall it sits on; floor-level glazing is passable', () => {
    const p = base();
    p.windows = [{ id: 'W1', room: 'R1', at: [2, 0.3], width: 1.2 }, { id: 'W2', room: 'R2', at: [7.7, 1.8], width: 2, passable: true }];
    const r = compile(p).project!;
    expect(r.building.rooms.rooms[0].openings[0]).toEqual({ id: 'W1', kind: 'window', plane_axis: 'Y', inner: 0.3, from_: 1.4, to: 2.6, sill_z: 0.85, head_z: 2.35 });
    expect(r.building.rooms.rooms[1].openings[0]).toMatchObject({ plane_axis: 'X', inner: 7.7, sill_z: 0, kind: 'window (floor-to-lintel)' });
    expect(r.building.doorFacts?.passableOpenings).toEqual(['W2']);
  });
  it('furniture against a wall: back 5 mm off the wall, front into the room', () => {
    const p = base();
    p.furniture = [{ room: 'R2', catalogId: 'wardrobe', wall: 'E', along: 1.8 }, { room: 'R1', catalogId: 'sofa', variant: '3', wall: 'S', along: 2.3 }];
    const items = compile(p).project!.interiors.items;
    expect(items[0]).toMatchObject({ key: 'R2-wardrobe', y: 1.8, rot: 90 });
    expect(items[0].x).toBeCloseTo(7.7 - 0.3 - 0.005, 6);                       // wardrobe depth 0.6
    expect(items[1]).toMatchObject({ key: 'R1-sofa', x: 2.3, rot: 0, variant: '3' });
    expect(items[1].y).toBeCloseTo(0.3 + 0.46 + 0.005, 6);                      // sofa depth 0.92
  });
  it('unknown catalog ids and variants are errors', () => {
    const p = base();
    p.furniture = [{ room: 'R1', catalogId: 'spaceship', at: [1, 1] }, { room: 'R1', catalogId: 'bed', variant: '999', at: [2, 2] }];
    expect(errors(compile(p))).toEqual(expect.arrayContaining(['furniture.catalog', 'furniture.variant']));
  });
  it('stairs: risers from the level heights, opening in the upper room', () => {
    const s = compile(read('projects/sample-house/source/plan.json')).project!;
    expect(s.building.stairs![0]).toMatchObject({ riser: 0.164, landingZ: 1.475, topZ: 2.95, run: 2.16, landingEdge: 1.3, split: 1.275 });
    expect(s.building.rooms.rooms.find((r) => r.id === 'H1')!.stair_opening).toEqual([0.3, 0.3, 2.25, 3.46]);
    expect(s.manifest.modules).toEqual(['site', 'sun', 'stairs']);
  });
  it('site: footprint = rooms + exterior wall, plot grown by the margin', () => {
    const p = base();
    p.site = { margin: 5 };
    const site = compile(p).project!.site!;
    expect(site.footprint).toEqual([[0, 0], [8, 0], [8, 3.6], [0, 3.6]]);
    expect(site.boundary).toEqual([[-5, -5], [13, -5], [13, 8.6], [-5, 8.6]]);
    expect(site.groundLevel).toBe(-0.15);
  });
  it('an unknown time zone is an error', () => {
    const p = base();
    p.sun = { lat: 50, lon: 8, timeZone: 'Mars/Olympus', northAzimuthX: 90 };
    expect(errors(compile(p))).toContain('sun.timeZone');
  });
});

describe('heights and pass-through blocks', () => {
  const twoLevels = () => ({
    ...base(),
    levels: [{ id: 'L0', name: 'Ground', floorZ: 0, ceiling: 2.6 }, { id: 'L1', name: 'Upper', floorZ: 2.9, ceiling: 2.5 }],
    rooms: [
      { id: 'R1', name: 'Living', level: 'L0', kind: 'living', rect: [0.3, 0.3, 4.3, 3.3] },
      { id: 'R2', name: 'Bedroom', level: 'L1', kind: 'bed', rect: [0.3, 0.3, 4.3, 3.3] },
    ],
    doors: [],
    windows: [{ id: 'W1', room: 'R1', at: [2.3, 0.3], width: 1.2 }, { id: 'W2', room: 'R2', at: [2.3, 0.3], width: 1.2, sill: 0.9, head: 2.3 }],
  });
  it('window sill / head are written as absolute heights (floor of the level + height above it)', () => {
    const r = compile(twoLevels());
    expect(errors(r)).toEqual([]);
    const w = (room: string) => r.project!.building.rooms.rooms.find((x) => x.id === room)!.openings[0];
    expect([w('R1').sill_z, w('R1').head_z]).toEqual([0.85, 2.35]);
    expect([w('R2').sill_z, w('R2').head_z]).toEqual([3.8, 5.2]);
  });
  it('section height: above the highest window head of the level, at least 2.30, below the ceiling', () => {
    const r = compile(twoLevels());
    const L = r.project!.building.rooms.levels;
    expect(L.L0.cut_height).toBe(2.45);                                    // head 2.35 + 0.1
    expect(L.L1.cut_height).toBe(2.4);                                     // head 2.30 + 0.1
    const low = compile({ ...twoLevels(), levels: [{ id: 'L0', name: 'Ground', floorZ: 0, ceiling: 2.4 }, { id: 'L1', name: 'Upper', floorZ: 2.9, ceiling: 2.5, cutHeight: 1.5 }] });
    expect(low.project!.building.rooms.levels.L0.cut_height).toBe(2.35);   // ceiling 2.40 − 0.05
    expect(low.project!.building.rooms.levels.L1.cut_height).toBe(1.5);    // given in the plan
  });
  it('assets, views, catalog and capabilities are copied; an environment model enables its module', () => {
    const views = { presets: [{ id: 'front', label: 'Front', icon: 'home', hint: 'from the street', pose: { position: [5, -10, 4], target: [2, 2, 1], fov: 50 } }] };
    const r = compile({ ...base(), assets: { model: 'model/building.glb', environment: 'model/env.glb' }, views, catalog: { furniture: 'catalog/furniture.json' }, capabilities: ['interiors', 'walk'] });
    expect(errors(r)).toEqual([]);
    const p = r.project!;
    expect(p.assets).toEqual({ model: 'model/building.glb', environment: 'model/env.glb' });
    expect(p.views).toEqual(views);
    expect(p.catalog).toEqual({ furniture: 'catalog/furniture.json' });
    expect(p.manifest.capabilities).toEqual(['interiors', 'walk']);
    expect(p.manifest.modules).toContain('environment');
    expect(errors(compile({ ...base(), assets: { site: 'site.glb' } }))).toContain('assets.site');
  });
});

describe('sloped ceilings (attic levels)', () => {
  // one 8 m deep attic room: knee wall 1.40 at y = 0.3, the 2.20 line 1 m further in, ridge in the middle (y = 4.3)
  const attic = (slope: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...base(), doors: [],
    levels: [{ id: 'L1', name: 'Attic', floorZ: 3, ceiling: 2.5, slope }],
    rooms: [{ id: 'A1', name: 'Attic room', level: 'L1', kind: 'bed', rect: [0.3, 0.3, 6.3, 8.3] }],
    ...extra,
  });
  const ceilingOf = (r: ReturnType<typeof compile>) => r.project!.building.rooms.rooms[0].ceiling;
  it('two height lines give the slope; the ridge defaults to the middle of the level', () => {
    const r = compile(attic({ ridge: 'X', lines: [{ at: 0.3, height: 1.4 }, { at: 1.3, height: 2.2 }] }));
    expect(errors(r)).toEqual([]);
    expect(ceilingOf(r)).toEqual({ kind: 'attic', flat_z: 5.5, ridge_y: 4.3, z_at_ridge: r3(3 + 1.4 + 0.8 * 4), slope: 0.8 });
    expect(packageErrors(r.project, 'test-flat', new Set(catalog.map((c) => c.id)))).toEqual([]);
  });
  it('a ridge along Y uses x; one line and the pitch work too', () => {
    const r = compile(attic({ ridge: 'Y', ridgeAt: 3.3, lines: [{ at: 0.3, height: 1.2 }], pitch: 45 }));
    expect(errors(r)).toEqual([]);
    expect(ceilingOf(r)).toMatchObject({ kind: 'attic', ridge_x: 3.3, z_at_ridge: 7.2, slope: 1 });
    expect(ceilingOf(r)).not.toHaveProperty('ridge_y');
  });
  it('lines on both sides of the ridge, or one line without the pitch, are errors', () => {
    expect(errors(compile(attic({ ridge: 'X', lines: [{ at: 0.3, height: 1.4 }, { at: 8.3, height: 1.4 }] })))).toContain('level.slope');
    expect(errors(compile(attic({ ridge: 'X', lines: [{ at: 0.3, height: 1.4 }] })))).toContain('schema');
  });
  it('a room with its own ceiling stays flat; roof windows are cut into the sloped ceiling', () => {
    const r = compile(attic({ ridge: 'X', lines: [{ at: 0.3, height: 1.4 }, { at: 1.3, height: 2.2 }] }, {
      rooms: [
        { id: 'A1', name: 'Attic room', level: 'L1', kind: 'bed', rect: [0.3, 0.3, 4.3, 8.3] },
        { id: 'A2', name: 'Store', level: 'L1', kind: 'storage', rect: [4.42, 0.3, 6.3, 8.3], ceiling: 2.2 },
      ],
      roofWindows: [{ id: 'RW1', room: 'A1', rect: [1.5, 1.0, 2.28, 2.4] }],
    }));
    expect(errors(r)).toEqual([]);
    const [a1, a2] = r.project!.building.rooms.rooms;
    expect(a1.ceiling.kind).toBe('attic');
    expect(a2.ceiling).toEqual({ kind: 'flat', z: 5.2 });
    expect(a1.roof_windows).toEqual([{ id: 'RW1', plan_rect: [1.5, 1, 2.28, 2.4] }]);
  });
});

describe('raster plans (units px)', () => {
  // 100 px per metre, origin pixel (50, 450): x_m = (x − 50) / 100, y_m = (450 − y) / 100
  const px = () => ({
    ...base(), units: 'px', calibration: { pxPerM: 100, originPx: [50, 450], methods: [{ method: 'area', pxPerM: 100 }, { method: 'points', pxPerM: 101 }] },
    rooms: [
      { id: 'R1', name: 'Living', level: 'L1', kind: 'living', rect: [80, 120, 481, 420] },          // 0.30…4.31 × 0.30…3.30
      { id: 'R2', name: 'Bedroom', level: 'L1', kind: 'bed', rect: [490, 121, 820, 419] },           // 4.40…7.70 (wall 9 cm)
    ],
    doors: [{ id: 'D1', between: ['R1', 'R2'], at: [486, 300], width: 0.9, swingInto: 'R2', hinge: 'left' }],
  });
  it('y is flipped, points are scaled, faces aligned and the shared wall set to the interior thickness', () => {
    const r = compile(px());
    expect(errors(r)).toEqual([]);
    const [r1, r2] = r.project!.building.rooms.rooms;
    // 0.30 / 0.31 and 3.30 / 3.29 lie on one line each → averaged and snapped to 5 mm; x scaled from pixels
    expect(r1.bbox[0]).toBe(0.3);
    expect(r1.bbox[1]).toBe(r2.bbox[1]);
    expect(r1.bbox[3]).toBe(r2.bbox[3]);
    expect(r2.bbox[2]).toBe(7.7);
    expect(r2.bbox[0] - r1.bbox[2]).toBeCloseTo(0.12, 6);
    expect(r.adjustments.some((a) => a.includes('R1 | R2'))).toBe(true);
  });
  it('a px plan without calibration is an error; a single scale estimate is a warning', () => {
    const p = px();
    delete (p as Record<string, unknown>).calibration;
    expect(errors(compile(p))).toContain('calibration');
    const q = px();
    (q.calibration as { methods: unknown[] }).methods = [{ method: 'symbol:door', pxPerM: 100 }];
    expect(compile(q).issues.some((i) => i.code === 'calibration.methods')).toBe(true);
  });
});

describe('released ids', () => {
  it('a locked room may not change its vertex count or first corner', () => {
    const lock = { rooms: { R1: { vertices: 4, first: [0.3, 0.3] as [number, number] }, R2: { vertices: 4, first: [4.42, 0.3] as [number, number] } } };
    expect(errors(compile(base(), lock))).toEqual([]);
    const p = base();
    (p.rooms as Record<string, unknown>[])[0] = { id: 'R1', name: 'Living', level: 'L1', kind: 'living', polygon: [[0.3, 0.3], [4.3, 0.3], [4.3, 3.3], [2, 3.3], [2, 2], [0.3, 2]] };
    expect(errors(compile(p, lock))).toContain('ids.lock');
    const q = base();
    q.rooms = [(q.rooms as unknown[])[0]];
    q.doors = [];
    expect(errors(compile(q, lock))).toContain('ids.lock');
  });
});
