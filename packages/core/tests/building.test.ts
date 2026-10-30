// The core's derived building — pure, cached by the identity of the package's building block, no active project.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { building, ceilingAt, levelAtZ, roomAt, stairArrivesAt, SHELL_DEFAULTS, type BuildingData } from '@home-sim/core/model/building';
import { gridLevelShell, gridShellBounds, orthogonalPlan } from '@home-sim/core/model/gridShell';
import { planMass } from '@home-sim/core/model/planMass';
import type { ProjectPackage } from '@home-sim/core/package/types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const pkg = (id: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', id, 'project.json'), 'utf8')) as ProjectPackage;

describe('building()', () => {
  it('is computed once per building block and again for a different block', () => {
    const p = pkg('sample-house');
    const a = building(p.building), b = building(p.building), c = building(structuredClone(p.building));
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(c.rooms.map((r) => r.id)).toEqual(a.rooms.map((r) => r.id));
  });

  it('orders levels by floor height and indexes rooms by level', () => {
    const b = building(pkg('sample-house').building);
    expect(b.levels.map((l) => l.floorZ)).toEqual([...b.levels.map((l) => l.floorZ)].sort((x, y) => x - y));
    for (const l of b.levels) for (const r of b.roomsByLevel.get(l.id)!) expect(r.level).toBe(l.id);
    expect(b.rooms.length).toBe(pkg('sample-house').building.rooms.rooms.length);
    expect(b.shell).toEqual({ ...SHELL_DEFAULTS, ...pkg('sample-house').building.shell });
  });

  it('derives walls with ids <room>-w<n>, unit directions and inward normals into the room', () => {
    for (const r of building(pkg('demo-apartment').building).rooms) {
      r.walls.forEach((w, i) => {
        expect(w.id).toBe(`${r.id}-w${i + 1}`);
        expect(Math.hypot(...w.dir)).toBeCloseTo(1, 9);
        const mid: [number, number] = [(w.a[0] + w.b[0]) / 2 + w.inward[0] * 0.01, (w.a[1] + w.b[1]) / 2 + w.inward[1] * 0.01];
        expect(roomAt(building(pkg('demo-apartment').building), r.level, mid)?.id).toBe(r.id);
      });
      expect('label' in r.walls[0]).toBe(false); // translated wall labels are the app's
    }
  });

  it('answers level by height, stairs arrival and the flat ceiling height', () => {
    const b = building(pkg('sample-house').building);
    const [l0, l1] = b.levels;
    expect(levelAtZ(b, l0.floorZ + 0.1)).toBe(l0.id);
    expect(levelAtZ(b, l1.floorZ + 0.1)).toBe(l1.id);
    expect(stairArrivesAt(b, l1.id)).toBe(true);
    expect(stairArrivesAt(b, l0.id)).toBe(false);
    const r = b.rooms[0], c = pkg('sample-house').building.rooms.rooms[0].ceiling;
    expect(ceilingAt(r, ...r.center)).toBeCloseTo(c.z!, 9);
    expect(r.ceiling.kind).toBe('flat');
    expect(r.ceiling.breaksAlong(r.walls[0].a, r.walls[0].b)).toEqual([]);
  });

  it('a sloped ceiling: height falls from the ridge, capped by the flat top, with breaks at the flat edges and the ridge', () => {
    const data = structuredClone(pkg('demo-apartment').building) as BuildingData;
    const room = data.rooms.rooms[0];
    const [, y0, , y1] = room.bbox, ry = (y0 + y1) / 2;
    room.ceiling = { kind: 'attic', flat_z: room.floor_z + 2.5, ridge_y: ry, z_at_ridge: room.floor_z + 3, slope: 1 };
    const r = building(data).roomById.get(room.id)!;
    expect(ceilingAt(r, r.center[0], ry)).toBeCloseTo(room.floor_z + 2.5, 9);
    expect(ceilingAt(r, r.center[0], ry - 1)).toBeCloseTo(room.floor_z + 2, 9);
    expect(r.ceiling.kind).toBe('roof');
    // a wall across the slope bends at the edges of the flat top and at the ridge
    const across = r.walls.find((w) => Math.abs(w.dir[1]) > 0.5)!, y = (t: number) => across.a[1] + across.dir[1] * t;
    expect(across.length).toBeGreaterThan(1);
    expect(r.ceiling.breaksAlong(across.a, across.b).map(y).sort((p, q) => p - q).map((v) => +v.toFixed(9))).toEqual([ry - 0.5, ry, ry + 0.5].map((v) => +v.toFixed(9)));
    expect(r.ceiling.range()[1]).toBeCloseTo(2.5, 9);
  });
});

describe('grid shell', () => {
  it('is cached per building and level, and the plan mass is its wall strips', () => {
    const b = building(pkg('sample-house').building);
    for (const l of b.levels) {
      const s = gridLevelShell(b, l.id);
      expect(gridLevelShell(b, l.id)).toBe(s);
      expect(planMass(b, l.id)).toBe(s.mass);
      expect(s.walls.length).toBeGreaterThan(0);
    }
    expect(orthogonalPlan(b.rooms)).toBe(true);
    const bounds = gridShellBounds(b);
    expect(bounds.min[2]).toBeCloseTo(b.levels[0].floorZ - b.shell.slab, 9);
  });
});
