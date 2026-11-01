// Door leaves (model/doors.ts): a double door is two half leaves hinged at both jambs, a bifold two panels folding to the hinge
// jamb; the plan symbols, the floor they sweep and the compiler's swing check follow from the leaves. Fixture: doors.plan.json.
import { describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { doorLeaves, leafCount, leafSectors, leafWidthOf, liftLevel, liftReach, sectionCount, sectionPose, swingArcs, swingDepth } from '@home-sim/core/model/doors';
import type { DoorDef, Vec2 } from '@home-sim/core/package/types';
import { PACKAGES, planOf } from './packages';

const door = (id: string) => PACKAGES.doors().doors.find((d) => d.id === id)!;
const close = (a: Vec2, b: Vec2, d = 6) => { expect(a[0]).toBeCloseTo(b[0], d); expect(a[1]).toBeCloseTo(b[1], d); };
const len = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

describe('door types', () => {
  it('compiled: double doors without a hinge side, the bifold folds to its hinge side by 80°, all leaves together in leafWidth', () => {
    expect(door('D1')).toMatchObject({ type: 'hinged-double', hingeSide: null, openAngle: 90, leafWidth: 1.4, swingInto: 'L' });
    expect(door('D2')).toMatchObject({ type: 'folding', hingeSide: 'right', openAngle: 80, leafWidth: 1.1, swingInto: 'L' });
    expect([leafCount(door('D1')), leafCount(door('D2')), leafCount(door('D3'))]).toEqual([2, 2, 1]);
  });
  it('a double door: closed, the two half leaves meet in the middle of the opening; open, both stand square into the room', () => {
    const d = door('D1'), [a, b] = doorLeaves(d, 0), o = d.opening, mid = (o.from + o.to) / 2;
    close(a.b, b.b); expect(a.b[0]).toBeCloseTo(mid, 6); expect(len(a.a, a.b)).toBeCloseTo(leafWidthOf(d), 9);
    const [a1, b1] = doorLeaves(d, 1);
    close(a1.dir, d.openDir!); close(b1.dir, d.openDir!);
    expect(a1.a[0]).toBeCloseTo(o.from + 0.05, 6); expect(b1.a[0]).toBeCloseTo(o.to - 0.05, 6);
    expect(swingArcs(d)).toHaveLength(2); expect(swingDepth(d)).toBeCloseTo(leafWidthOf(d), 6);
    expect(leafSectors(d).map((s) => s.radius)).toEqual([0.7, 0.7]);
  });
  it('a bifold: closed, the panels fill the opening; part open, the far edge runs along the wall; open, a narrow V by the hinge', () => {
    const d = door('D2'), h = d.hinge!, w = leafWidthOf(d);
    const [p, q] = doorLeaves(d, 0);
    close(p.a, h); close(q.b, [h[0] - 2 * w, h[1]]); close(p.b, q.a);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const [p1, q1] = doorLeaves(d, t);
      expect(len(p1.a, p1.b)).toBeCloseTo(w, 9); expect(len(q1.a, q1.b)).toBeCloseTo(w, 9);
      expect(q1.b[1]).toBeCloseTo(h[1], 9);                                      // the far edge on the wall line
      expect((p1.b[1] - h[1]) * d.openDir![1]).toBeGreaterThan(0);               // the fold into the room it opens into
    }
    const [, q2] = doorLeaves(d, 1);
    expect(len(q2.b, h)).toBeCloseTo(2 * w * Math.cos((80 * Math.PI) / 180), 6);
    expect(swingDepth(d)).toBeCloseTo(w * Math.sin((80 * Math.PI) / 180), 6);
  });
  it('a sliding door has one leaf, moving along the wall, no arcs but its track', () => {
    const d = door('D3'), [s0] = doorLeaves(d, 0), [s1] = doorLeaves(d, 1);
    expect(len(s0.a, s1.a)).toBeCloseTo(d.slide!.travel, 9);
    expect(swingDepth(d)).toBe(0); expect(leafSectors(d)).toEqual([]); expect(swingArcs(d)[0]).toHaveLength(2);
  });
  it('the swing check: a double door and a single door opening into the same corner are warned; the fixture is clean', () => {
    expect(compilePlan(planOf('doors'), { catalog: null }).issues).toEqual([]);
    const p = planOf('doors');
    // a garden door in the west wall, hinged at its north end, sweeps the floor of D1's first leaf
    p.doors.push({ id: 'D4', between: ['L', 'exterior'], at: [0.15, 3.7], width: 1.2, swingInto: 'L', hinge: 'right' });
    const r = compilePlan(p, { catalog: null });
    expect(r.issues.map((i) => i.code)).toContain('door.swingOverlap');
  });
  it('a sectional door: one leaf at the face of the room it lifts into; its panels run up, round the bend and under the ceiling', () => {
    const p = planOf('doors');
    p.doors.push({ id: 'G1', between: ['L', 'exterior'], at: [0.15, 2.3], width: 2.4, type: 'sectional', height: 2.2, leafHeight: 2.15 });
    const r = compilePlan(p, { catalog: null }), d = r.project!.building.doors.find((x) => x.id === 'G1')!;
    expect(r.issues).toEqual([]);
    expect(d).toMatchObject({ type: 'sectional', hinge: null, slide: null, swingInto: 'L', leafWidth: 2.3, lift: { into: [1, 0], dir: [0, 1] } });
    expect(d.lift!.origin[0]).toBeCloseTo(0.3, 6);                              // the inner face of the west wall
    const [l] = doorLeaves(d, 0.5);
    expect(len(l.a, l.b)).toBeCloseTo(2.3, 9); expect(l.a[0]).toBeCloseTo(0.3, 6);
    expect(swingDepth(d)).toBe(0); expect(leafSectors(d)).toEqual([]);
    const n = sectionCount(d), h = d.height / n;
    expect(n).toBe(4);
    for (let k = 0; k < n; k++) {
      expect(sectionPose(d, 0, k)).toEqual({ depth: 0, z: (k + 0.5) * h, angle: 0 });        // closed: upright, stacked
      const o = sectionPose(d, 1, k);
      expect(o.angle).toBeCloseTo(Math.PI / 2, 9); expect(o.z).toBeCloseTo(liftLevel(d), 9);   // open: flat under the ceiling
      if (k) expect(o.depth - sectionPose(d, 1, k - 1).depth).toBeCloseTo(h, 9);             // still side by side
    }
    expect(sectionPose(d, 1, 0).depth - h / 2).toBeGreaterThan(0.3);            // the bottom panel past the bend: the opening is clear
    expect(liftReach(d)).toBeGreaterThan(d.height); expect(liftReach(d)).toBeLessThan(d.height + 0.8);
    const [track] = swingArcs(d);
    expect(track).toHaveLength(4); close(track[1], l.a); expect(track[0][0] - track[1][0]).toBeCloseTo(liftReach(d), 9);
    // a leaf that would lie above the ceiling when open is warned; a sectional door cannot lift into the exterior
    p.doors[p.doors.length - 1] = { ...p.doors[p.doors.length - 1], height: 2.58, leafHeight: 2.55 };
    expect(compilePlan(p, { catalog: null }).issues.map((i) => i.code)).toContain('door.lift');
    p.doors[p.doors.length - 1] = { ...p.doors[p.doors.length - 1], height: 2.2, leafHeight: 2.15, swingInto: 'exterior' };
    expect(compilePlan(p, { catalog: null }).issues.map((i) => i.code)).toContain('door.swing');
  });
  it('a plan without a type stays a single hinged door (older plans compile as before)', () => {
    const d: DoorDef = PACKAGES['two-storey-l']().doors[0];
    expect(d.type).toBe('hinged-single'); expect(doorLeaves(d, 1)).toHaveLength(1);
  });
});
