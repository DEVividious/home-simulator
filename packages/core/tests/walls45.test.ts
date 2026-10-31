// Walls at 45° (fixture walls-45.plan.json: a chamfered corner with a window, a triangular pantry behind a slanted partition with
// a door): the compiler accepts 45° and rejects other angles, writes the slanted door gap into both rooms and the slanted window
// with the wall's direction; the derived building puts the holes on the slanted walls; the solid is closed, one cutter per
// opening, its section matches the footprint minus the rooms and the gaps; the site footprint follows the chamfer; the print
// thickens the slanted partition at a small scale and keeps its door.
import { beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { building } from '@home-sim/core/model/building';
import { area } from '@home-sim/core/model/geom2d';
import { outerOutline } from '@home-sim/core/model/outline';
import { gapFrame, lineC, lineT, windowFrame } from '@home-sim/core/model/wallLine';
import type { Vec2 } from '@home-sim/core/package/types';
import { adjustForPrint } from '@home-sim/core/print/adjust';
import { profileOf } from '@home-sim/core/print/profiles';
import { levelSolid } from '@home-sim/core/solid/levels';
import { scoped } from '@home-sim/core/solid/scope';
import { sectionAt } from '@home-sim/core/solid/slice';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { PACKAGES, planOf } from './packages';

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });
const data = () => PACKAGES['walls-45']();
const S2 = Math.SQRT1_2;

describe('compiler', () => {
  it('45° edges compile; another angle is room.angle; a triangle is a room', () => {
    expect(compilePlan(planOf('walls-45'), { catalog: null }).issues).toEqual([]);
    const p = planOf('walls-45');
    p.rooms[1].polygon = [[7.3, 3.37], [7.3, 6.3], [5.0, 6.3]];
    expect(compilePlan(p, { catalog: null }).issues.map((i) => i.code)).toContain('room.angle');
  });
  it('the slanted door: one gap of the same wall line in both rooms, the hinge on the pantry face, the leaf into the pantry', () => {
    const b = data(), [L, K] = b.rooms.rooms, gL = L.doors.find((d) => d.door_id === 'D1')!, gK = K.doors.find((d) => d.door_id === 'D1')!;
    expect(gL).toEqual(gK);
    expect(gL.along).toBe('D'); expect(gL.dir).toEqual([0.707107, -0.707107]);
    const f = gapFrame(gL);
    expect(gL.across[0]).toBeCloseTo(10.5 * S2, 3); expect(gL.across[1]).toBeCloseTo(10.67 * S2, 3);   // the faces x + y = 10.5 / 10.67
    expect(gL.to - gL.from_).toBeCloseTo(0.8, 6);
    const d = b.doors.find((x) => x.id === 'D1')!;
    expect(d.opening).toMatchObject({ along: 'D', dir: [0.707107, -0.707107] });
    expect(lineC(f, d.hinge!)).toBeCloseTo(gL.across[1], 3);
    expect(d.openDir![0]).toBeCloseTo(S2, 6); expect(d.openDir![1]).toBeCloseTo(S2, 6);
    expect(Math.abs(d.closedDir![0] * f.dir[1] - d.closedDir![1] * f.dir[0])).toBeLessThan(1e-9);    // the closed leaf along the wall
  });
  it('the window in the chamfer: plane_axis D with the wall direction, on its inner face', () => {
    const w = data().rooms.rooms[0].openings.find((o) => o.id === 'W2')!, f = windowFrame(w);
    expect(w).toMatchObject({ plane_axis: 'D', dir: [0.707107, 0.707107] });
    expect(lineC(f, [5.3, 0.3])).toBeCloseTo(w.inner, 5); expect(lineC(f, [7.3, 2.3])).toBeCloseTo(w.inner, 5);
    expect((w.from_ + w.to) / 2).toBeCloseTo(lineT(f, [6.3, 1.3]), 3);
  });
  it('the site footprint follows the chamfer (the rooms grown by the exterior wall, mitred)', () => {
    expect(compilePlan(planOf('walls-45'), { catalog: null }).project!.site!.footprint).toEqual([[0, 0], [5.424, 0], [7.6, 2.176], [7.6, 6.6], [0, 6.6]]);
  });
});

describe('derived building and solid', () => {
  it('the holes sit on the slanted walls of both rooms, as wide as the openings', () => {
    const b = building(data()), L = b.roomById.get('L')!, K = b.roomById.get('K')!;
    const on = (r: typeof L, id: string) => r.walls.find((w) => w.holes.some((h) => h.id === id))!;
    const wl = on(L, 'D1'), wk = on(K, 'D1'), w2 = on(L, 'W2');
    for (const w of [wl, wk, w2]) expect(Math.abs(Math.abs(w.dir[0]) - S2)).toBeLessThan(1e-9);
    for (const [w, id, width] of [[wl, 'D1', 0.8], [wk, 'D1', 0.8], [w2, 'W2', 1.2]] as const) { const h = w.holes.find((x) => x.id === id)!; expect(h.t1 - h.t0).toBeCloseTo(width, 3); }
    expect(L.doors.map((d) => d.id).sort()).toEqual(['D0', 'D1']); expect(K.windows.map((w) => w.id)).toEqual(['W3']);
  });
  it('the level solid: closed, one cutter per opening, its section at 0.5 m = footprint − rooms − the door gaps', () => {
    const b = building(data()), polys = b.rooms.map((r) => r.polygon);
    scoped((keep) => {
      const s = levelSolid(geo, keep, b, 'G')!;
      expect(s.solid.status()).toBe('NoError'); expect(s.solid.decompose().length).toBe(1);
      expect(s.cuts.filter((c) => c.id === 'D1')).toHaveLength(1);
      expect(s.windows.find((w) => w.id === 'W2')!.depth).toBeCloseTo(0.3, 3);
      const fp = outerOutline(polys, 0.3), gaps = 1.0 * 0.3 + 0.8 * 0.17 * S2;
      expect(sectionAt(keep, s.solid, 0.5).area).toBeCloseTo(area(fp) - polys.reduce((a, p) => a + area(p as Vec2[]), 0) - gaps, 3);
      expect(s.plan.footprint).toHaveLength(1);
      expect(area(s.plan.footprint[0])).toBeCloseTo(area(fp), 4);
    });
  });
  it('print at 1:300: the slanted partition is thickened and keeps its door in both rooms', () => {
    const adj = adjustForPrint(data(), 300, profileOf('0.4'));
    expect(adj.changes.some((c) => c.code === 'wall.interior' && c.element === 'wall K | L')).toBe(true);
    const b = building(adj.data);
    for (const id of ['L', 'K']) expect(b.roomById.get(id)!.walls.some((w) => w.holes.some((h) => h.id === 'D1')), id).toBe(true);
    expect(b.roomById.get('L')!.walls.some((w) => w.holes.some((h) => h.id === 'W2'))).toBe(true);
  });
});
