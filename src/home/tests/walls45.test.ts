// Walls at 45° in the app (the core plan fixture walls-45.plan.json, compiled): the package passes the app validation, the door in
// the slanted partition has its centre, doorway, frame and leaf along the wall, the walk goes through it into the pantry when it
// is open, the walk starts inside the entrance, wall finishes are built on the slanted walls with their window and door holes,
// and furniture in front of the slanted door is warned.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { pointInPolygon } from '@home-sim/core/model/geom2d';
import { activateProject, project } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { validateProject } from '../../project/validate';
import { resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { furnitureWarnings } from '../model/collision';
import { defaultDoorState, doorById, doorCenter, doorLeaves, doorPassable, inDoorway, setDoorOpen } from '../model/doors';
import { roomById } from '../model/rooms';
import { entranceStart } from '../model/viewpoints';
import { setDoorGate } from '../model/walk';
import { WalkWorld, type WalkPose } from '../model/walkWorld';
import { frameGeometry } from '../three/doorGeometry';
import { wallGeometry } from '../three/surfaces';

const root = path.resolve(__dirname, '..', '..', '..');
const EYE = 1.68, S2 = Math.SQRT1_2;

beforeAll(() => {
  const r = compilePlan(JSON.parse(fs.readFileSync(path.join(root, 'packages/core/tests/fixtures/walls-45.plan.json'), 'utf8')), { catalog: null });
  activateProject(r.project!);
});
afterEach(() => setDoorGate(null));
afterAll(() => { activateProject(readProjectDir(path.join(root, 'projects', 'demo-apartment'))); });

describe('walls at 45°', () => {
  it('the package passes the app validation', () => {
    expect(validateProject(project())).toEqual([]);
  });
  it('the slanted door: its centre on the partition, a doorway across it, a frame turned along it', () => {
    const d = doorById('D1')!, c = doorCenter(d);
    expect(c[0] + c[1]).toBeCloseTo((10.5 + 10.67) / 2, 3);
    expect(inDoorway(d, c)).toBe(true);
    expect(inDoorway(d, [c[0] - 0.7, c[1] - 0.7])).toBe(false);          // 1 m into the living room
    const g = frameGeometry(d)!; g.computeBoundingBox();
    // a box 0.8 m along the wall and 0.12 + 2 × 0.01 m across it, turned by 45°: its plan extent is (0.8 + 0.14) / √2 both ways
    const b = g.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(0.94 * S2, 3); expect(b.max.z - b.min.z).toBeCloseTo(0.94 * S2, 3);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(c[0], 3); expect(-(b.min.z + b.max.z) / 2).toBeCloseTo(c[1], 3);
    const [leaf] = doorLeaves(d, 0);
    expect(Math.abs(Math.abs(leaf.dir[0]) - S2)).toBeLessThan(1e-9);
  });
  it('walk: through the open slanted door into the pantry; closed, it blocks', () => {
    const site = project().site!, xs = site.boundary.map((q) => q[0]), ys = site.boundary.map((q) => q[1]);
    const w = new WalkWorld({ footprint: site.footprint, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ground: () => site.groundLevel });
    const go = (s = defaultDoorState()) => { setDoorGate((id) => doorPassable(s, id)); let p: WalkPose = { p: [4.9, 3.9], z: 0 }; for (let i = 0; i < 30; i++) p = w.step(p, 0.1 * S2, 0.1 * S2, EYE); return p; };
    expect(w.placeAt(go(), EYE)).toMatchObject({ room: { id: 'L' } });
    expect(w.placeAt(go(setDoorOpen(defaultDoorState(), 'D1', 1)), EYE)).toMatchObject({ kind: 'room', room: { id: 'K' } });
  });
  it('the walk starts just inside the entrance, facing into the room', () => {
    const s = entranceStart()!;
    expect(s.p[0]).toBeCloseTo(0.3 + 0.9, 6); expect(s.p[1]).toBeCloseTo(3.0, 6);
    expect(-Math.sin(s.yaw)).toBeCloseTo(1, 6);
  });
  it('wall finishes on the slanted walls: on the wall, with the holes of the window and the door cut out', () => {
    const L = roomById('L')!, chamfer = L.walls.find((x) => x.holes.some((h) => h.id === 'W2'))!, part = L.walls.find((x) => x.holes.some((h) => h.id === 'D1'))!;
    for (const wall of [chamfer, part]) {
      const g = wallGeometry(L, wall), pos = g.getAttribute('position');
      let area = 0;
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i), v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
      for (let i = 0; i < idx.length; i += 3) area += new THREE.Vector3().subVectors(v(idx[i + 1]), v(idx[i])).cross(new THREE.Vector3().subVectors(v(idx[i + 2]), v(idx[i]))).length() / 2;
      const hole = wall.holes.reduce((a, h) => a + (h.t1 - h.t0) * (h.z1 - h.z0), 0);
      expect(area).toBeCloseTo(wall.length * 2.6 - hole, 1);
      for (let i = 0; i < pos.count; i++) { const p = v(i); expect(Math.abs((p.x - wall.a[0]) * wall.inward[0] + (-p.z - wall.a[1]) * wall.inward[1])).toBeLessThan(0.02); }
    }
  });
  it('furniture in front of the slanted door is warned, further into the room not', () => {
    const K = roomById('K')!, it0 = itemById('armchair')!, dims = resolveDims(it0), c = doorCenter(doorById('D1')!);
    const kinds = (x: number, y: number) => furnitureWarnings(K, it0, { id: 'x', catalogId: it0.id, x, y, rot: 45 }, dims, []).map((q) => q.kind);
    expect(pointInPolygon([c[0] + 0.5 * S2, c[1] + 0.5 * S2], K.polygon)).toBe(true);
    expect(kinds(c[0] + 0.5 * S2, c[1] + 0.5 * S2)).toContain('door');
  });
});
