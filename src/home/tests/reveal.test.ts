// Reveals and sill of polygonal glazing (e.g. a gable window under a sloped roof): a band from the inner wall face to the frame,
// so the opening shows no hole to the outside and the window sits against the building; a sill at floor level when the
// glazing starts at or below the floor. Data: fixture "sloped-ceiling" (A1 — glazing from the slab on the west wall,
// A2 — glazing above a 0.90 m sill on the east wall); a project without polygonal glazing — the demo apartment.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateProject, project, withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { fixtureDir } from '../../test/setup';
import { allRooms, roomById } from '../model/rooms';
import { revealDepth, revealGeometry, SURFACE_OFFSET } from '../three/surfaces';

const tris = (g: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } }) => {
  const p = g.getAttribute('position'), out: number[][][] = [];
  for (let i = 0; i < p.count; i += 3) out.push([0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]));
  return out;
};
const normal = (t: number[][]) => { const a = t[0], b = t[1], c = t[2], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };

describe('reveals of polygonal glazing: band from the wall face to the frame, sill at floor level', () => {
  let demo: ReturnType<typeof project>;
  beforeAll(() => { demo = project(); activateProject(readProjectDir(fixtureDir('sloped-ceiling'))); });
  afterAll(() => { activateProject(demo); });

  // sign: direction of the outer wall face along X (west wall −1, east wall +1)
  for (const [roomId, sign, sill] of [['A1', -1, true], ['A2', 1, false]] as const) {
    it(`room ${roomId}: opening sides and top (wall material)${sill ? ' + sill (floor material)' : ''}, faces towards the opening centre`, () => {
      const room = roomById(roomId)!, w = room.walls.find((x) => x.holes.some((h) => h.polygon))!;
      const h = w.holes.find((x) => x.polygon)!, r = revealGeometry(room, w);
      // A1: opening from the slab (below the floor) — sill; A2: 0.90 m above the floor — the bottom edge belongs to the reveals
      expect(r.jambs).toBeTruthy(); expect(!!r.sill).toBe(sill);
      // centre of the opening (above the floor) in three.js coordinates
      const tc = (h.t0 + h.t1) / 2, zc = Math.max(0, h.z0) + 1.0;
      const c = [w.a[0] + w.dir[0] * tc - w.inward[0] * revealDepth() / 2, room.floorZ + zc, -(w.a[1] + w.dir[1] * tc - w.inward[1] * revealDepth() / 2)];
      for (const t of tris(r.jambs!)) {
        const n = normal(t), m = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
        expect(n[0] * (c[0] - m[0]) + n[1] * (c[1] - m[1]) + n[2] * (c[2] - m[2])).toBeGreaterThan(0);   // face visible from inside the opening
      }
      for (const t of r.sill ? tris(r.sill) : []) { expect(normal(t)[1]).toBeGreaterThan(0); for (const v of t) expect(v[1]).toBeCloseTo(room.floorZ + SURFACE_OFFSET, 6); }
      // depth into the wall: from the inner face (with an overlap) to the frame at the outer face
      const xs = [...tris(r.jambs!), ...(r.sill ? tris(r.sill) : [])].flat().map((v) => v[0]), inner = w.a[0];
      expect(Math.min(...xs.map((x) => (x - inner) * sign))).toBeCloseTo(-SURFACE_OFFSET, 6);
      expect(Math.max(...xs.map((x) => (x - inner) * sign))).toBeCloseTo(revealDepth(), 6);
      // sill across the full opening width (glazing 2.00–3.60 m along the wall)
      if (r.sill) { const ys = tris(r.sill).flat().map((v) => -v[2]); expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.abs(h.t1 - h.t0) - 0.02); expect(h.t1 - h.t0).toBeCloseTo(1.6, 6); }
    });
  }
  it('walls without polygonal glazing — no band (rectangular windows and doors of a whole project)', () => {
    withProject(demo, () => {
      let walls = 0;
      for (const room of allRooms()) for (const w of room.walls) { const r = revealGeometry(room, w); expect(r.jambs, w.id).toBeNull(); expect(r.sill, w.id).toBeNull(); walls++; }
      expect(walls).toBe(16);
    });
    // the other walls of the fixture rooms too
    for (const room of allRooms()) for (const w of room.walls.filter((x) => !x.holes.some((h) => h.polygon))) expect(revealGeometry(room, w).jambs).toBeNull();
  });
});
