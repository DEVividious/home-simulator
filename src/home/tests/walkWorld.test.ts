// Building and site walk: stairs between levels, exits through exterior doors (gated by the door state) and passable
// floor-level openings, collisions with walls and the building outline, the site. Sample house: L0 / L1, U-turn stairs S1,
// entrance door D0 (west wall of the hall), floor-level window W2 to the terrace (east wall of the living room).
// The demo apartment has no site — no walking outside the rooms.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateProject, project } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { shellFootprint } from '../model/shell';
import { stairPart, stairs, stairSteps, stairZ, type StairDef } from '../model/stairs';
import type { Vec2 } from '../model/types';
import { setDoorGate } from '../model/walk';
import { exteriorDoors, nearExteriorDoor, passableOpenings, WalkWorld, type WalkPose } from '../model/walkWorld';

const root = path.resolve(__dirname, '..', '..', '..');
const readProject = (id: string) => readProjectDir(path.join(root, 'projects', id));
const EYE = 1.68;
const GROUND = -0.15;

/** walk world of the active project, built like the walk layer does (site outline and plot boundary from the package) */
function worldOf(extra: { obstacles?: [number, number, number][] } = {}): WalkWorld {
  const site = project().site;
  if (!site) return new WalkWorld({ footprint: shellFootprint(), bounds: [0, 0, 0, 0], ground: () => null, ...extra });
  const xs = site.boundary.map((q) => q[0]), ys = site.boundary.map((q) => q[1]);
  return new WalkWorld({ footprint: site.footprint, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ground: () => site.groundLevel, ...extra });
}

/** march: n steps of 0.1 m in direction (dx, dy) */
function walk(world: WalkWorld, from: WalkPose, dx: number, dy: number, metres: number): WalkPose {
  let p = from;
  const n = Math.round(metres / 0.1), l = Math.hypot(dx, dy);
  for (let i = 0; i < n; i++) p = world.step(p, (dx / l) * 0.1, (dy / l) * 0.1, EYE);
  return p;
}

describe('sample house', () => {
  let world: WalkWorld, S: StairDef;
  beforeAll(() => { activateProject(readProject('sample-house')); world = worldOf(); S = stairs()[0]; });
  afterAll(() => { setDoorGate(null); activateProject(readProject('demo-apartment')); });

  describe('stairs S1 (2 × 9 risers, landing at mid height, L0 → L1)', () => {
    it('ramp: L0 floor 0 → landing → L1 floor 2.95; schematic steps match the stair data', () => {
      expect(S).toMatchObject({ fromLevel: 'L0', toLevel: 'L1', risers: 9, topZ: 2.95 });
      expect(stairZ([1.8, 3.45])).toBeCloseTo(0, 1);          // entry of the lower flight (larger-X side, from the hall)
      expect(stairZ([1.8, 1.0])).toBe(S.landingZ);
      expect(S.landingZ).toBeCloseTo(1.475, 2);
      expect(stairZ([0.8, 3.45])).toBeCloseTo(2.95, 1);       // top of the upper flight
      expect(stairPart([1.8, 2.5])).toBe('flight1');
      expect(stairPart([0.8, 2.5])).toBe('flight2');
      expect(stairPart([1.0, 1.0])).toBe('landing');
      const steps = stairSteps(S);
      expect(steps.length).toBe(2 * (S.risers - 1) + 1);
      expect(Math.max(...steps.map((s) => s[4]))).toBeCloseTo(S.topZ - S.riser, 2);
      expect(S.run).toBeCloseTo(S.bbox[3] - S.landingEdge, 6);
    });
    it('hall → lower flight → landing → upper flight → first-floor landing (+2.95), and back down', () => {
      let p: WalkPose = { p: [1.8, 4.2], z: 0 };
      p = walk(world, p, 0, -1, 3.2);
      expect(p.z).toBeCloseTo(S.landingZ, 3);
      p = walk(world, p, -1, 0, 1.0);
      expect(p.p[0]).toBeLessThan(S.split);
      p = walk(world, p, 0, 1, 3.2);
      expect(p.z).toBeCloseTo(2.95, 3);
      expect(p.p[1]).toBeGreaterThan(S.bbox[3]);
      expect(world.placeAt(p, EYE).label).toBe('First floor — Landing');
      p = walk(world, p, 0, -1, 3.0);
      expect(p.z).toBeCloseTo(S.landingZ, 3);
      p = walk(world, p, 1, 0, 1.0);
      p = walk(world, p, 0, 1, 3.4);
      expect(p.z).toBe(0);
      expect(world.placeAt(p, EYE).label).toBe('Ground floor — Hall');
    });
    it('from L0 one cannot walk under the upper flight; from L1 one cannot fall into the stair opening (balustrade)', () => {
      const gf = walk(world, { p: [0.8, 4.2], z: 0 }, 0, -1, 2);
      expect(gf.p[1]).toBeGreaterThan(S.bbox[3] - 0.1); expect(gf.z).toBe(0);
      const up = walk(world, { p: [1.8, 4.2], z: 2.95 }, 0, -1, 2);
      expect(up.p[1]).toBeGreaterThan(S.bbox[3] - 0.1); expect(up.z).toBe(2.95);
    });
    it('place on the stairs', () => {
      expect(world.placeAt({ p: [1.8, 2.5], z: 0.6 }, EYE)).toMatchObject({ kind: 'stairs', label: 'Stairs' });
    });
  });

  describe('house ↔ site', () => {
    it('passable openings come from the package; exterior doors are corridors as well', () => {
      expect(passableOpenings()).toEqual(['W2']);
      expect(exteriorDoors().map((d) => d.id).sort()).toEqual(['D0', 'W2']);
      expect(exteriorDoors().find((d) => d.id === 'D0')!.roomId).toBe('H0');
      expect(exteriorDoors().find((d) => d.id === 'W2')!.roomId).toBe('LK');
    });
    it('hall → open entrance door D0 → site in front of the house, and back inside', () => {
      setDoorGate(() => true);
      let p: WalkPose = { p: [1.0, 4.2], z: 0 };
      p = walk(world, p, -1, 0, 3);
      expect(p.p[0]).toBeLessThan(-1.5);
      expect(p.z).toBeCloseTo(GROUND, 6);
      expect(world.placeAt(p, EYE).kind).toBe('site');
      // in the door opening (wall thickness): the passage to the site
      expect(world.placeAt({ p: [0.15, 4.2], z: 0 }, EYE)).toMatchObject({ kind: 'door', id: 'D0', label: 'Doorway: Hall ↔ outside' });
      p = walk(world, p, 1, 0, 3);
      expect(p.z).toBe(0);
      expect(world.placeAt(p, EYE).label).toBe('Ground floor — Hall');
    });
    it('closed entrance door D0 blocks the way out (and the way in)', () => {
      setDoorGate((id) => id !== 'D0');
      const p = walk(world, { p: [1.0, 4.2], z: 0 }, -1, 0, 3);
      expect(p.p[0]).toBeGreaterThan(0.3);
      expect(p.z).toBe(0);
      const q = walk(world, { p: [-1.5, 4.2], z: GROUND }, 1, 0, 3);
      expect(q.p[0]).toBeLessThan(0);
      expect(q.z).toBe(GROUND);
      setDoorGate(null);
    });
    it('living room → floor-level window W2 → terrace', () => {
      const p = walk(world, { p: [8.5, 3.5], z: 0 }, 1, 0, 2.5);
      expect(p.p[0]).toBeGreaterThan(10.3);
      expect(world.placeAt(p, EYE).kind).toBe('site');
      // a window with a sill is not a way out (W1, living room, south wall)
      const q = walk(world, { p: [6, 1.5], z: 0 }, 0, -1, 2.5);
      expect(q.p[1]).toBeGreaterThan(0.3);
    });
    it('the threshold of an exterior opening is detected only when the door lets one through and only on the site level', () => {
      const atDoor: Vec2 = [0.5, 4.2];                       // hall, just inside the entrance door
      setDoorGate(() => true); expect(nearExteriorDoor(atDoor)).toBe(true);
      expect(nearExteriorDoor(atDoor, 'L1')).toBe(false);
      setDoorGate((id) => id !== 'D0'); expect(nearExteriorDoor(atDoor)).toBe(false);
      setDoorGate(null);
      expect(nearExteriorDoor([1.8, 4.2])).toBe(false);      // middle of the hall
      expect(nearExteriorDoor([9.5, 3.5])).toBe(true);       // living room at W2
    });
    it('exterior walls stop; the building outline is kept at the body radius', () => {
      const p = walk(world, { p: [-1.5, 2], z: GROUND }, 1, 0, 4);
      expect(p.p[0]).toBeLessThan(-0.2 + 1e-6);
      expect(p.p[0]).toBeGreaterThan(-0.4);
    });
    it('interior walls stop, doors lead (interior like the room walk)', () => {
      const p = walk(world, { p: [2.5, 4.25], z: 0 }, 1, 0, 3);
      expect(world.placeAt(p, EYE).label).toBe('Ground floor — Living room with kitchen');
      const q = walk(world, { p: [2.8, 1.0], z: 0 }, 1, 0, 2);
      expect(q.p[0]).toBeLessThan(3.3);
    });
    it('end of the plot stops; tree trunks block', () => {
      const p = walk(world, { p: [-6, 4], z: GROUND }, -1, 0, 10);
      expect(p.p[0]).toBeGreaterThanOrEqual(-8);
      const w2 = worldOf({ obstacles: [[14, 4, 0.3]] });
      let t: WalkPose = { p: [12, 4], z: GROUND };
      for (let i = 0; i < 40; i++) t = w2.step(t, 0.1, 0, EYE);
      expect(t.p[0]).toBeLessThan(14 - 0.3 - 0.2 + 1e-6);
    });
    it('settle: a start inside a wall moves to the nearest accessible spot', () => {
      const s = world.settle([3.36, 2.0], 0, EYE)!;
      expect(s).not.toBeNull();
      expect(world.heightAt(s.p, s.z, EYE)).not.toBeNull();
    });
  });

  // in the clear opening of an INTERIOR door (wall thickness between rooms) the walk must report the room, not the site
  describe('place in the opening of an interior door', () => {
    const w = () => new WalkWorld({ footprint: [], bounds: [0, 0, 0, 0], ground: () => null });
    it('in the wall between hall and living room (door D1) the user is in a room, not on the site', () => {
      const place = w().placeAt({ p: [3.36, 4.25], z: 0 }, EYE);
      expect(place.kind).toBe('room');
      expect(place.label).toMatch(/^Ground floor — (Hall|Living room with kitchen)$/);
    });
    it('the same on the first floor (landing ↔ main bedroom, door D3)', () => {
      const place = w().placeAt({ p: [3.36, 4.46], z: 2.95 }, EYE);
      expect(place.kind).toBe('room');
      expect(place.label).toMatch(/^First floor — (Landing|Main bedroom)$/);
    });
    it('a point inside a wall outside any opening is not a room', () => {
      expect(w().placeAt({ p: [3.36, 2.0], z: 0 }, EYE).kind).toBe('site');
    });
  });
});

describe('demo apartment: no site, no walking outside', () => {
  const world = worldOf();
  it('no passable openings; the exterior door is not a corridor', () => {
    expect(project().site ?? null).toBeNull();
    expect(passableOpenings()).toEqual([]);
    expect(exteriorDoors()).toEqual([]);
    expect(nearExteriorDoor([0.5, 1.8])).toBe(false);
  });
  it('walking at the open exterior door D0 stops at the wall', () => {
    setDoorGate(() => true);
    const p = walk(world, { p: [1.0, 1.8], z: 0 }, -1, 0, 2);
    expect(p.p[0]).toBeGreaterThan(0.3);
    expect(world.heightAt([-0.5, 1.8], 0, EYE)).toBeNull();
    setDoorGate(null);
  });
  it('interior doors lead: hallway → living room through D1; the opening reports a room', () => {
    const p = walk(world, { p: [1.5, 1.45], z: 0 }, 1, 0, 2);
    expect(world.placeAt(p, EYE).label).toBe('Apartment — Living room with kitchenette');
    expect(world.placeAt({ p: [2.46, 1.45], z: 0 }, EYE).kind).toBe('room');
  });
});
