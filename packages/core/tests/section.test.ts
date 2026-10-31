// The wall mass in plan from the level solids (slice.ts wallSection — the plan views draw it): the sections just above the floor
// and at the cut height, united. On every package it is the footprint less the rooms, plus what stands there as mass (chimneys,
// dormer cheeks, walls that bound no room), less the openings open at both heights. Also: the pure bounds equal the solid bounds.
import { beforeAll, describe, expect, it } from 'vitest';
import { building, roomsOfLevel, type Building } from '@home-sim/core/model/building';
import type { Vec2 } from '@home-sim/core/package/types';
import { levelSolid, shellBounds, shellMeshes } from '@home-sim/core/solid/levels';
import { liveObjects, scoped, type Keep } from '@home-sim/core/solid/scope';
import { LOW_CUT, wallSection } from '@home-sim/core/solid/slice';
import { loadGeometry, type CrossSection, type Geometry } from '@home-sim/core/solid/wasm';
import { PACKAGES } from './packages';

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

const signedArea = (p: Vec2[]) => p.reduce((s, a, i) => { const q = p[(i + 1) % p.length]; return s + a[0] * q[1] - q[0] * a[1]; }, 0) / 2;
/** per level: the section, and the footprint less the rooms */
function compare(keep: Keep, b: Building, level: string): { section: CrossSection; loops: Vec2[][]; want: CrossSection; extra: CrossSection; missing: CrossSection } | null {
  const l = b.levelById.get(level)!, s = levelSolid(geo, keep, b, level);
  if (!s) return null;
  const loops = wallSection(keep, s.solid, s.frame.floor, l.floorZ + l.cutHeight), section = keep(new geo.CrossSection(loops));
  const want = keep(keep(new geo.CrossSection(s.plan.footprint)).subtract(keep(new geo.CrossSection(roomsOfLevel(b, level).map((r) => r.polygon)))));
  return { section, loops, want, extra: keep(section.subtract(want)), missing: keep(want.subtract(section)) };
}
const rect = (keep: Keep, [x0, y0, x1, y1]: number[]) => keep(new geo.CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]));

describe('the wall mass in plan: the section of the level solid', () => {
  const plain = ['demo-apartment', 'sample-house', 'placement-lab', 'mount-lab', 'catalog-ext', 'two-storey-l', 'roof-gable-x', 'roof-hip', 'roof-shed', 'roof-flat', 'roof-l-gable', 'roof-t-hip', 'stairs-straight', 'stairs-l', 'doors', 'walls-45'];
  for (const id of plain) it(`${id}: the footprint less the rooms — the doors and windows closed, the walls at 45° included`, () => {
    const b = building(PACKAGES[id]());
    for (const l of b.levels) scoped((keep) => {
      const c = compare(keep, b, l.id);
      if (!c) return;
      expect(c.section.area(), l.id).toBeGreaterThan(1);
      expect(c.extra.area() + c.missing.area(), l.id).toBeLessThan(1e-6);
    });
  });

  it('demo-apartment: 9 × 7 m less the four rooms', () => scoped((keep) => {
    expect(compare(keep, building(PACKAGES['demo-apartment']()), 'L1')!.section.area()).toBeCloseTo(63 - (22.248 + 16.5624 + 7.728 + 5.46), 6);
  }));

  it('outer loops counter-clockwise, holes clockwise; the rooms are holes in the mass', () => scoped((keep) => {
    const c = compare(keep, building(PACKAGES['demo-apartment']()), 'L1')!;
    const outer = c.loops.filter((p) => signedArea(p) > 0), holes = c.loops.filter((p) => signedArea(p) < 0);
    expect(outer.length).toBe(1);
    expect(holes.length).toBe(4);
    expect(outer.reduce((s, p) => s + signedArea(p), 0) + holes.reduce((s, p) => s + signedArea(p), 0)).toBeCloseTo(c.section.area(), 6);
  }));

  it('a chimney and the cheeks of the dormers are mass; nothing of the rooms is lost', () => {
    const b = building(PACKAGES['roof-gable-y']()), ch = b.roof!.json.chimneys![0];
    for (const l of b.levels) scoped((keep) => {
      const c = compare(keep, b, l.id)!;
      expect(c.missing.area(), l.id).toBeLessThan(1e-6);
      expect(keep(rect(keep, ch.rect).subtract(c.section)).area(), `${l.id}: the chimney`).toBeLessThan(1e-6);
    });
    scoped((keep) => {
      const c = compare(keep, b, 'A')!, chimney = rect(keep, ch.rect).area();
      expect(c.extra.area() - chimney).toBeGreaterThan(0.5);   // the dormer cheeks outside the footprint of the attic rooms
    });
  });

  it('walls that bound no room are mass', () => {
    const b = building(PACKAGES['roof-wing-flat']()), free = b.walls.filter((w) => w.level === 'G');
    expect(free.length).toBeGreaterThan(0);
    scoped((keep) => {
      const c = compare(keep, b, 'G')!;
      expect(c.missing.area()).toBeLessThan(1e-6);
      // every free wall lies in the section along its length, at its axis (its openings included only above and below)
      for (const w of free) for (const s of [0.1, 0.5, 0.9]) {
        const p: Vec2 = [w.a[0] + (w.b[0] - w.a[0]) * s, w.a[1] + (w.b[1] - w.a[1]) * s];
        const open = w.openings.some((o) => { const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); return o.t0 <= s * L && s * L <= o.t1 && o.z0 <= LOW_CUT && o.z1 >= 2; });
        if (!open) expect(keep(rect(keep, [p[0] - 0.01, p[1] - 0.01, p[0] + 0.01, p[1] + 0.01]).subtract(c.section)).area(), `${w.id} at ${s}`).toBeLessThan(1e-8);
      }
    });
  });

  it('an opening open at both heights stays open (a glazing up to the slope, a door under a slope lower than the cut); every other part of the walls is mass', () => {
    const b = building(PACKAGES['sloped-ceiling']()), l = b.levels[0], t = b.shell.exteriorWall;
    scoped((keep) => {
      const c = compare(keep, b, l.id)!;
      expect(c.extra.area()).toBeLessThan(1e-6);
      expect(c.missing.area()).toBeGreaterThan(0.05);
      // the missing parts lie in the wall strips of openings open at the low cut (the upper cut passes above them, or the wall
      // under the slope ends below it)
      const tall = roomsOfLevel(b, l.id).flatMap((r) => r.walls.flatMap((w) => w.holes.filter((h) => r.floorZ + h.z0 <= l.floorZ + LOW_CUT).map((h) => {
        const out: Vec2 = [-w.inward[0], -w.inward[1]], at = (s: number, d: number): Vec2 => [w.a[0] + w.dir[0] * s + out[0] * d, w.a[1] + w.dir[1] * s + out[1] * d];
        return keep(new geo.CrossSection([[at(h.t0, -0.01), at(h.t1, -0.01), at(h.t1, t + 0.01), at(h.t0, t + 0.01)]], 'NonZero'));
      })));
      expect(tall.length).toBeGreaterThan(0);
      expect(keep(c.missing.subtract(keep(geo.CrossSection.union(tall)))).area()).toBeLessThan(1e-6);
    });
  });

  it('shellMeshes carries the section of every level; every WASM object is freed', () => {
    const before = liveObjects(), b = building(PACKAGES['sample-house']()), m = shellMeshes(geo, b);
    for (const l of m.levels) scoped((keep) => {
      const c = compare(keep, b, l.level)!;
      expect(keep(new geo.CrossSection(l.section)).area()).toBeCloseTo(c.section.area(), 9);
    });
    expect(liveObjects()).toBe(before);
  });
});

describe('bounds', () => {
  for (const [id, data] of Object.entries(PACKAGES)) it(`${id}: the pure bounds equal the bounds of the solids within 1 mm`, () => {
    const b = building(data()), c = shellBounds(b), m = shellMeshes(geo, b), parts = [...m.levels, ...m.roofs];
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(Math.min(...parts.map((l) => l.bounds.min[k])) - c.min[k])).toBeLessThan(1e-3);
      expect(Math.abs(Math.max(...parts.map((l) => l.bounds.max[k])) - c.max[k])).toBeLessThan(1e-3);
    }
  });
});
