// Straight and L-shaped stairs in the app (the core plan fixtures stairs-straight and stairs-l, compiled): the package passes the
// app's validation, the walk goes up and down between the levels, from the lower level one cannot walk under the flights and from
// the upper one not into the opening, the room walk hands over at the stairs, the 3D stairs (every finish preset) stay in the
// outline, the stairs card text and the furniture warning over the L opening.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { pointInPolygon } from '@home-sim/core/model/geom2d';
import { stairOutline } from '@home-sim/core/model/stairs';
import type { LTurnStairDef, ProjectPackage, StairDef } from '@home-sim/core/package/types';
import { activateProject, project } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { validateProject } from '../../project/validate';
import { resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { furnitureWarnings } from '../model/collision';
import { roomById } from '../model/rooms';
import { inStairBox, stairArrivesAt, stairFacts, stairs } from '../model/stairs';
import { DEFAULT_STAIRS, STAIRS_PRESETS } from '../model/stairsConfig';
import { WalkWorld, type WalkPose } from '../model/walkWorld';
import { buildStairs } from '../three/stairGeometry';

const root = path.resolve(__dirname, '..', '..', '..');
const fixture = (id: string): ProjectPackage => {
  const r = compilePlan(JSON.parse(fs.readFileSync(path.join(root, 'packages/core/tests/fixtures', `${id}.plan.json`), 'utf8')), { catalog: null });
  if (!r.project) throw new Error(JSON.stringify(r.issues));
  return r.project;
};
const EYE = 1.68;
function worldOf(): WalkWorld {
  const site = project().site!, xs = site.boundary.map((q) => q[0]), ys = site.boundary.map((q) => q[1]);
  return new WalkWorld({ footprint: site.footprint, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ground: () => site.groundLevel });
}
/** march along a polyline in 5 cm steps; the pose after each leg */
function walkPath(w: WalkWorld, from: WalkPose, pts: [number, number][]): WalkPose[] {
  const out: WalkPose[] = [];
  let p = from;
  for (const q of pts) {
    for (let i = 0; i < 200 && Math.hypot(q[0] - p.p[0], q[1] - p.p[1]) > 0.03; i++) {
      const dx = q[0] - p.p[0], dy = q[1] - p.p[1], l = Math.hypot(dx, dy), s = Math.min(0.05, l);
      const next = w.step(p, (dx / l) * s, (dy / l) * s, EYE);
      if (next.p[0] === p.p[0] && next.p[1] === p.p[1]) break;
      p = next;
    }
    out.push(p);
  }
  return out;
}
const bb = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return [b.min.x, -b.max.z, b.max.x, -b.min.z, b.min.y, b.max.y]; };

afterAll(() => { activateProject(readProjectDir(path.join(root, 'projects', 'demo-apartment'))); });

describe('straight stairs (up east along the north wall of the living room)', () => {
  it('the compiled package passes the app validation; the stairs arrive at the upper level', () => {
    const p = activateProject(fixture('stairs-straight'));
    expect(validateProject(p)).toEqual([]);
    expect(stairs()[0].kind).toBe('straight'); expect(stairArrivesAt('U')).toBe(true);
  });
  it('walk: living room → up the flight → upper hall (+2.85), and back down', () => {
    const w = worldOf(), [x0, y0, x1, y1] = stairs()[0].bbox, yc = (y0 + y1) / 2;
    const [foot, top, hall] = walkPath(w, { p: [x0 - 0.8, yc], z: 0 }, [[x0 - 0.3, yc], [x1 - 0.2, yc], [x1 + 0.6, yc]]);
    expect(foot.z).toBe(0); expect(top.z).toBeGreaterThan(2.7); expect(hall.z).toBe(2.85);
    expect(w.placeAt(hall, EYE)).toMatchObject({ kind: 'room', room: { id: 'C' } });
    const [down] = walkPath(w, hall, [[x0 - 0.6, yc]]);
    expect(down.z).toBe(0); expect(w.placeAt(down, EYE)).toMatchObject({ kind: 'room', room: { id: 'A' } });
  });
  it('from the living room one cannot walk onto the flight from its side; from the hall not into the opening', () => {
    const w = worldOf(), [x0, y0] = stairs()[0].bbox;
    const [side] = walkPath(w, { p: [x0 + 2.5, y0 - 0.6], z: 0 }, [[x0 + 2.5, y0 + 0.45]]);
    expect(side.p[1]).toBeLessThan(y0 + 0.05); expect(side.z).toBe(0);
    const [edge] = walkPath(w, { p: [x0 + 2.5, y0 - 0.3], z: 2.85 }, [[x0 + 2.5, y0 + 0.45]]);
    expect(edge.z).toBe(2.85); expect(edge.p[1]).toBeLessThan(y0 + 0.05);
  });
  it('3D stairs: one flight within the outline, up to the upper floor; every preset stays in it, at most 6 meshes', () => {
    const s = stairs()[0], g = buildStairs(DEFAULT_STAIRS, s), b = bb(g.concrete!);
    for (let i = 0; i < 4; i++) expect(b[i]).toBeCloseTo(s.bbox[i], 6);
    expect(b[5]).toBeCloseTo(s.topZ, 6);
    for (const p of STAIRS_PRESETS) {
      const gs = buildStairs(p.config, s);
      expect(Object.keys(gs).length).toBeLessThanOrEqual(6);
      for (const m of Object.values(gs)) { const q = bb(m!); expect(q[0]).toBeGreaterThan(s.bbox[0] - 0.3); expect(q[2]).toBeLessThan(s.bbox[2] + 0.3); expect(Array.from(m!.getAttribute('position').array as Float32Array).every(Number.isFinite)).toBe(true); }
    }
  });
  it('the stairs card: one flight', () => {
    expect(stairFacts(stairs()[0])).toBe('Reinforced concrete structure: 1 flight × 16 steps (17.8 × 27 cm) — this is building data');
  });
});

describe('L-shaped stairs (up north along the east wall, turning left onto the upper flight)', () => {
  let s: LTurnStairDef;
  it('the compiled package passes the app validation', () => {
    const p = activateProject(fixture('stairs-l'));
    expect(validateProject(p)).toEqual([]);
    s = stairs()[0] as LTurnStairDef;
    expect(s.kind).toBe('l-turn');
  });
  it('walk: up the lower flight, across the landing, up the upper flight onto the hall; and back down', () => {
    const w = worldOf(), [x0, y0, x1, y1] = s.bbox, xe = x1 - 0.45, yn = y1 - 0.45;
    const [foot, landing, top, hall] = walkPath(w, { p: [xe, y0 - 0.8], z: 0 }, [[xe, y0 - 0.2], [xe, yn], [x0 + 0.2, yn], [x0 - 0.6, yn]]);
    expect(foot.z).toBe(0); expect(landing.z).toBe(s.landingZ); expect(top.z).toBeGreaterThan(2.6); expect(hall.z).toBe(2.85);
    expect(w.placeAt(landing, EYE).kind).toBe('stairs'); expect(w.placeAt(hall, EYE)).toMatchObject({ kind: 'room', room: { id: 'F' } });
    const [, , back] = walkPath(w, hall, [[xe, yn], [xe, y0 + 0.2], [xe, y0 - 0.6]]);
    expect(back.z).toBe(0);
  });
  it('the free corner of the L is the room below and the hall above: walkable at the floor heights, not stairs', () => {
    const w = worldOf(), [x0, y0] = s.bbox, c: [number, number] = [x0 + 0.6, y0 + 0.6];
    expect(inStairBox(c)).toBe(false);
    expect(w.heightAt(c, 0, EYE)).toBe(0); expect(w.heightAt(c, 2.85, EYE)).toBe(2.85);
    // from the corner on the upper floor one cannot step into the opening over the lower flight
    const [edge] = walkPath(w, { p: c, z: 2.85 }, [[s.bbox[2] - 0.45, c[1]]]);
    expect(edge.z).toBe(2.85); expect(edge.p[0]).toBeLessThan(s.bbox[2] - 0.9 + 0.05);
  });
  it('3D stairs: the concrete in the L, nothing in the free corner; with a balustrade a guard rail along the opening on the hall', () => {
    const g = buildStairs(DEFAULT_STAIRS, s).concrete!.toNonIndexed(), pos = g.getAttribute('position'), o = stairOutline(s);
    for (let i = 0; i < pos.count; i++) expect(pointInPolygon([pos.getX(i), -pos.getZ(i)], o, 1e-6)).toBe(true);
    const b = bb(buildStairs({ ...DEFAULT_STAIRS, balustrade: { type: 'glass', height: 1.0, finish: 'steel' } }, s).glass!);
    expect(b[5]).toBeCloseTo(s.topZ + 1.0, 6);
  });
  it('the stairs card: two flights at a right angle; furniture in the free corner is fine, over the opening it is warned', () => {
    expect(stairFacts(s)).toBe('Reinforced concrete structure: 2 flights at a right angle (8 + 8 steps, 17.8 × 27 cm), landing +1.425 — this is building data');
    const F = roomById('F')!, [x0, y0, x1] = s.bbox;
    const it = itemById('armchair')!, at = (x: number, y: number) => furnitureWarnings(F, it, { id: 'x', catalogId: it.id, x, y, rot: 0 }, resolveDims(it), []).map((q) => q.kind);
    expect(at(x0 + 0.6, y0 + 0.6)).not.toContain('stairs');
    expect(at(x1 - 0.45, y0 + 0.6)).toContain('stairs');
  });
});

describe('every stair kind', () => {
  it('U-turn stairs of the sample house keep their geometry', () => {
    const p = activateProject(readProjectDir(path.join(root, 'projects', 'sample-house')));
    const S: StairDef = p.building.stairs![0];
    expect(S.kind).toBe('u-turn');
    expect(stairFacts(S)).toMatch(/2 flights × 9 steps/);
  });
});
