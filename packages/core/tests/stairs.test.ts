// Stair kinds (model/stairs.ts): straight, L-shaped (l-turn) and U-turn stairs from plan.json — the compiled records, the pieces
// and sides in the canonical frame, the outline (the L of an l-turn leaves its corner to the room), the walking ramp and where a
// figure fits, the steps, the opening in the upper slab and the solid stairs of the print.
import { beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { building } from '@home-sim/core/model/building';
import { area, pointInPolygon } from '@home-sim/core/model/geom2d';
import { stairAllowed, stairAt, stairDrawing, stairOutline, stairPart, stairPieces, stairSides, stairSteps, stairZ } from '@home-sim/core/model/stairs';
import type { LTurnStairDef, StairDef, StraightStairDef } from '@home-sim/core/package/types';
import { printModel } from '@home-sim/core/print/model';
import { stairSolid } from '@home-sim/core/print/parts';
import { parseBed } from '@home-sim/core/print/printers';
import { profileOf } from '@home-sim/core/print/profiles';
import { levelSolid } from '@home-sim/core/solid/levels';
import { scoped } from '@home-sim/core/solid/scope';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { PACKAGES, planOf } from './packages';

const R = 0.22;
let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

const straight = () => PACKAGES['stairs-straight']().stairs![0] as StraightStairDef;
const lturn = () => PACKAGES['stairs-l']().stairs![0] as LTurnStairDef;
const compile = (patch: (p: ReturnType<typeof planOf>) => void, id = 'stairs-l') => { const p = planOf(id); patch(p); return compilePlan(p, { catalog: null }); };

describe('compiled stair records', () => {
  it('straight: all the risers in one flight, its run, turned towards +X', () => {
    expect(straight()).toEqual({ id: 'S1', kind: 'straight', fromLevel: 'G', toLevel: 'U', bbox: [2, 3.4, 6.2, 4.3], risers: 16, riser: 0.178, tread: 0.27, flightWidth: 0.9, topZ: 2.85, run: 4.05, confidence: 'probable', orient: { rotate: 90, mirror: false } });
  });
  it('l-turn: risers of each flight, the landing height in proportion, turned and mirrored (up north, turning left)', () => {
    expect(lturn()).toMatchObject({ kind: 'l-turn', risers: 8, upperRisers: 8, riser: 0.178, landingZ: 1.425, topZ: 2.85, run: 1.89, upperRun: 1.89, orient: { rotate: 180, mirror: true } });
  });
  it('a u-turn is the default kind (older plans)', () => {
    const r = compilePlan(planOf('two-storey-l'), { catalog: null });
    expect(r.project!.building.stairs![0].kind).toBe('u-turn');
  });
  it('errors and warnings: an l-turn without upperRisers, a box too short for the treads, a landing too small, an odd riser', () => {
    expect(compile((p) => { delete p.stairs[0].upperRisers; }).issues.map((i) => i.message).join()).toMatch(/upperRisers/);
    expect(compile((p) => { p.stairs[0].upperRisers = 9; p.stairs[0].kind = 'straight'; }).issues.some((i) => i.code === 'schema')).toBe(true);
    expect(compile((p) => { p.stairs[0].risers = 12; }).issues.find((i) => i.code === 'stairs.depth')?.level).toBe('error');
    expect(compile((p) => { p.stairs[0].box = [2.0, 3.4, 5.9, 4.3]; }, 'stairs-straight').issues.find((i) => i.code === 'stairs.depth')?.level).toBe('error');
    expect(compile((p) => { p.stairs[0].box = [1.5, 3.4, 6.2, 4.3]; }, 'stairs-straight').issues.find((i) => i.code === 'stairs.depth')?.level).toBe('warning');
    expect(compile((p) => { p.stairs[0].risers = 12; p.stairs[0].box = [1.0, 3.4, 6.2, 4.3]; }, 'stairs-straight').issues.find((i) => i.code === 'stairs.riser')?.level).toBe('warning');
  });
});

describe('pieces, sides and outline', () => {
  it('straight: one flight and a 15 cm top landing at the upper floor; both long sides open', () => {
    const s = straight(), ps = stairPieces(s);
    expect(ps.map((p) => p.id)).toEqual(['flight1', 'top']);
    const kinds = stairSides(s).map((e) => `${e.piece.id}:${e.kind}`);
    expect(kinds.filter((k) => k === 'flight1:open')).toHaveLength(2);
    expect(kinds).toContain('flight1:entry'); expect(kinds).toContain('flight1:joined');
    expect(stairOutline(s)).toHaveLength(4);
  });
  it('l-turn: lower flight, the landing in the corner, upper flight; walls outside, open sides inside the L', () => {
    const s = lturn(), ps = stairPieces(s), sides = stairSides(s);
    expect(ps.map((p) => p.id)).toEqual(['flight1', 'landing', 'flight2']);
    for (const e of sides.filter((x) => x.kind === 'wall')) expect(e.outer).toBe(true);
    expect(sides.filter((x) => x.kind === 'open').every((e) => !e.outer)).toBe(true);
    expect(sides.filter((x) => x.kind === 'entry')).toHaveLength(1); expect(sides.filter((x) => x.kind === 'exit')).toHaveLength(1);
    const o = stairOutline(s), [x0, y0, x1, y1] = s.bbox;
    expect(o).toHaveLength(6);
    expect(area(o)).toBeCloseTo((x1 - x0) * (y1 - y0) - s.run * s.upperRun, 6);
    // the corner the L leaves free (plan: south-west of the box, the stairs are up north along the east wall turning left)
    expect(pointInPolygon([x0 + 0.5, y0 + 0.5], o, 0)).toBe(false);
    expect(stairAt([s], [x0 + 0.5, y0 + 0.5])).toBeNull();
    expect(stairAt([s], [x1 - 0.4, y0 + 0.3])).toBe(s);
  });
});

/** a walk up the stairs in 5 cm steps along the walking line: the heights rise smoothly from 0 to the upper floor */
function climb(s: StairDef) {
  const d = stairDrawing(s), zs: number[] = [];
  for (let i = 1; i < d.path.length; i++) {
    const [a, b] = [d.path[i - 1], d.path[i]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05);
    for (let k = 0; k <= n; k++) { const p: [number, number] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]; expect(stairAllowed(p, R, s)).toBe(true); zs.push(stairZ(p, s)); }
  }
  return zs;
}

describe('walking surface', () => {
  for (const [name, get] of [['straight', straight], ['l-turn', lturn]] as const) {
    it(`${name}: along the walking line every point is walkable and the ramp rises without a jump to the upper floor`, () => {
      const s = get(), zs = climb(s);
      expect(zs[0]).toBeLessThan(0.15); expect(zs[zs.length - 1]).toBeGreaterThan(s.topZ - 0.15);
      for (let i = 1; i < zs.length; i++) { expect(zs[i]).toBeGreaterThanOrEqual(zs[i - 1] - 1e-9); expect(zs[i] - zs[i - 1]).toBeLessThan(0.05); }
    });
  }
  it('l-turn: the landing is level, the free corner and the walls keep a figure off', () => {
    const s = lturn(), [x0, y0, x1, y1] = s.bbox;
    expect(stairPart([x1 - 0.45, y1 - 0.45], s)).toBe('landing');
    expect(stairZ([x1 - 0.45, y1 - 0.45], s)).toBe(s.landingZ);
    expect(stairPart([x1 - 0.45, y0 + 0.5], s)).toBe('flight1'); expect(stairPart([x0 + 0.5, y1 - 0.45], s)).toBe('flight2');
    expect(stairAllowed([x0 + 0.5, y0 + 0.5], R, s)).toBe(false);                 // the free corner
    expect(stairAllowed([x1 - 0.1, y0 + 0.8], R, s)).toBe(false);                 // against the east wall
    expect(stairAllowed([x1 - 0.9 + 0.05, y0 + 0.8], R, s)).toBe(false);          // at the open inner side
    expect(stairAllowed([x1 - 0.45, y0 + 0.8], R, s)).toBe(true);
  });
  it('steps: one box per tread and the landing, all within the outline, from the floor towards the upper floor', () => {
    for (const s of [straight(), lturn()]) {
      const steps = stairSteps(s), o = stairOutline(s);
      expect(steps).toHaveLength(s.kind === 'straight' ? s.risers - 1 + 1 : s.risers - 1 + 1 + (s as LTurnStairDef).upperRisers - 1);
      for (const [a, b, c, d] of steps) expect(pointInPolygon([(a + c) / 2, (b + d) / 2], o, 0)).toBe(true);
      expect(Math.max(...steps.map((x) => x[4]))).toBeCloseTo(s.kind === 'straight' ? s.topZ : s.topZ - s.riser, 2);
    }
  });
  it('the plan drawing: a tread line per step edge inside the flights, the walking line from the foot to the top', () => {
    const s = lturn(), d = stairDrawing(s);
    expect(d.treads).toHaveLength(s.risers - 1 + s.upperRisers - 1);
    expect(d.path).toHaveLength(3);
    expect(stairZ(d.path[0], s)).toBeLessThan(0.2); expect(stairZ(d.path[2], s)).toBeGreaterThan(s.topZ - 0.2);
  });
});

describe('solids', () => {
  it('l-turn: the opening in the upper slab is the L — the slab stays over the free corner', () => {
    const b = building(PACKAGES['stairs-l']()), s = b.stairs[0], [x0, y0, x1, y1] = s.bbox;
    expect(b.roomById.get('F')!.stairOutline).toHaveLength(6);
    scoped((keep) => {
      const U = levelSolid(geo, keep, b, 'U')!.solid, slab = (x: number, y: number) => keep(geo.Manifold.cube([0.1, 0.1, 0.1], true).translate([x, y, 2.85 - 0.125])), v = (x: number, y: number) => keep(U.intersect(slab(x, y))).volume();
      expect(v(x0 + 0.5, y0 + 0.5)).toBeCloseTo(0.001, 6);          // slab over the free corner
      expect(v(x1 - 0.45, y1 - 0.45)).toBe(0);                      // the opening over the landing
      expect(v(x1 - 0.45, y0 + 0.5)).toBe(0);                       // and over the lower flight
    });
  });
  it('print: solid flights and landing of both kinds, closed, within the outline (5 mm into the walls), up to the upper floor', () => {
    for (const s of [straight(), lturn()]) scoped((keep) => {
      const m = stairSolid(geo, keep, s, 0, [-Infinity, Infinity], false)!;
      expect(m.status()).toBe('NoError'); expect(m.decompose().length).toBe(1);
      const bb = m.boundingBox();
      expect(bb.min[0]).toBeGreaterThan(s.bbox[0] - 0.006); expect(bb.max[0]).toBeLessThan(s.bbox[2] + 0.006);
      expect(bb.min[1]).toBeGreaterThan(s.bbox[1] - 0.006); expect(bb.max[1]).toBeLessThan(s.bbox[3] + 0.006);
      expect(bb.max[2]).toBeCloseTo(s.kind === 'straight' ? s.topZ : s.topZ - s.riser, 2);
      // the free corner of the L stays empty
      if (s.kind === 'l-turn') expect(keep(m.intersect(keep(geo.Manifold.cube([0.3, 0.3, 3], false).translate([s.bbox[0] + 0.3, s.bbox[1] + 0.3, -0.5])))).volume()).toBe(0);
    });
  });
});

describe('stairs against the walls (a plan-reading case: the flight runs along a wall and ends with a few centimetres of top landing)', () => {
  it('every part prints closed, whatever is left of the box beyond the flight', () => {
    const bed = parseBed('K1C');
    for (const extra of [0, 0.004, 0.03, 0.08]) {
      const p = planOf('stairs-straight');
      // up south along the west wall of the living room (which holds the front door) to its south wall; the upper hall over the
      // whole floor
      p.stairs[0] = { ...p.stairs[0], up: 'S', box: [0.3, 0.3, 1.2, 0.3 + 4.05 + extra] };
      p.rooms = p.rooms.filter((x: { id: string }) => x.id !== 'D').map((x: { id: string; rect?: number[] }) => (x.id === 'C' ? { ...x, rect: [0.3, 0.3, 7.3, 4.3] } : x));
      p.doors = p.doors.filter((d: { id: string }) => d.id !== 'D2');
      p.windows = p.windows.filter((w: { id: string }) => w.id !== 'W3');
      const r = compilePlan(p, { catalog: null }), m = printModel(r.project!.building, geo, { bed, profile: profileOf('0.4'), scale: 75, name: 'wall' });
      expect(m.parts.map((x) => `${x.id}:${x.ok}`), `${extra}`).toEqual(m.parts.map((x) => `${x.id}:true`));
    }
  });
});
