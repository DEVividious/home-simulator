// Openings of a level: the cutters of doors, passages and windows, and the window records the frames are built from. Pure 2D
// geometry — the wall thickness at an opening is found by a ray from the room face through the wall mass (the footprint minus
// the rooms), so it needs no kernel. Cutters stand PROUD beyond both faces of the wall (no coplanar faces reach the boolean);
// the same opening seen from the two rooms it joins becomes one cutter.
import { ccw, round } from '../model/geom2d.ts';
import type { HoleKind, Room, RoomWall, WallHole } from '../model/building.ts';
import type { Vec2 } from '../package/types.ts';

/** how far cutters stand beyond the faces they cut [m] */
export const PROUD = 0.005;
/** input coordinates are snapped to this grid [m] */
export const SNAP = 1e-4;
export const snap = (x: number): number => round(x, 4);

/** window in a generated wall: an opening cut through from the room face (frames and panes are built from it) */
export interface ShellWindow {
  id: string; roomId: string; wallId: string; kind: HoleKind;
  /** opening start on the room face, direction along the wall and outward normal */
  a: Vec2; dir: Vec2; out: Vec2;
  width: number;
  /** bottom and top of the opening (absolute) */
  z0: number; z1: number;
  /** wall thickness at the opening */
  depth: number;
  /** a glazing with a polygonal outline (a gable window under the roof): its corners (along the width from a, up from z0) */
  outline?: Vec2[];
}

/** an opening cutter: an outline in the wall plane pushed through the wall */
export interface OpeningCut {
  id: string; roomId: string; wallId: string; kind: HoleKind;
  /** wall frame: origin at the wall start on the room face, unit direction along the wall, outward unit normal */
  a: Vec2; dir: Vec2; out: Vec2;
  /** outline in (t along the wall from a, z absolute), counter-clockwise */
  outline: Vec2[];
  /** wall thickness at the opening (from the room face to the far side of the mass) */
  depth: number;
  /** plan rectangle of an axis-aligned rectangular cutter [x0, y0, x1, y1] (PROUD included) — built like the room voids */
  box: [number, number, number, number] | null;
  z0: number; z1: number;
}

const inLoops = (p: Vec2, loops: Vec2[][]): boolean => {
  let inside = false;
  for (const poly of loops) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** distance along the ray p + s·d to the nearest edge of the loops (s > tol), Infinity when none */
function rayHit(p: Vec2, d: Vec2, loops: Vec2[][], tol = 1e-6): number {
  let best = Infinity;
  for (const poly of loops) for (let i = 0; i < poly.length; i++) {
    const c = poly[i], e = poly[(i + 1) % poly.length], ex = e[0] - c[0], ey = e[1] - c[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;                                 // parallel
    const wx = c[0] - p[0], wy = c[1] - p[1];
    const s = (wx * ey - wy * ex) / den, u = (wx * d[1] - wy * d[0]) / den;
    if (s > tol && u >= -1e-9 && u <= 1 + 1e-9 && s < best) best = s;
  }
  return best;
}

/** the wall mass of a level in plan: inside the footprint and outside every room */
export interface PlanMass { footprint: Vec2[][]; rooms: Vec2[][] }

/** wall thickness at plan point p on a room face, going in direction out (0 when no mass lies behind the face) */
export function wallDepth(mass: PlanMass, p: Vec2, out: Vec2): number {
  const q: Vec2 = [p[0] + out[0] * 1e-4, p[1] + out[1] * 1e-4];
  if (!inLoops(q, mass.footprint) || mass.rooms.some((r) => inLoops(q, [r]))) return 0;
  const s = Math.min(rayHit(p, out, mass.footprint), rayHit(p, out, mass.rooms));
  return Number.isFinite(s) ? snap(s) : 0;
}

const axisAligned = (w: RoomWall) => Math.abs(w.dir[0]) < 1e-9 || Math.abs(w.dir[1]) < 1e-9;
const outOf = (w: RoomWall): Vec2 => [-w.inward[0] || 0, -w.inward[1] || 0];   // no −0

function holeOutline(room: Room, h: WallHole, wallTop: number): Vec2[] {
  const z = (v: number) => snap(Math.min(wallTop, room.floorZ + v));
  if (h.polygon) return ccw(h.polygon.map(([t, v]) => [snap(t), z(v)] as Vec2));
  return [[snap(h.t0), z(h.z0)], [snap(h.t1), z(h.z0)], [snap(h.t1), z(h.z1)], [snap(h.t0), z(h.z1)]];
}

/**
 * Cutters and window records of the rooms of one level. `wallTop` caps every opening (the top of the level's walls); a hole
 * with no mass behind it (rooms touching) cuts nothing.
 */
export function levelOpenings(rooms: Room[], mass: PlanMass, wallTop: number): { cuts: OpeningCut[]; windows: ShellWindow[] } {
  const cuts: OpeningCut[] = [], windows: ShellWindow[] = [], seenCut = new Set<string>(), seenWindow = new Set<string>();
  for (const room of rooms) for (const w of room.walls) {
    const out = outOf(w);
    for (const h of w.holes) {
      const mid = (h.t0 + h.t1) / 2, p: Vec2 = [w.a[0] + w.dir[0] * mid, w.a[1] + w.dir[1] * mid];
      const depth = wallDepth(mass, p, out);
      if (depth < 1e-3) continue;
      const outline = holeOutline(room, h, wallTop), zs = outline.map((q) => q[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
      if (z1 - z0 < 1e-3) continue;
      let box: OpeningCut['box'] = null;
      if (!h.polygon && axisAligned(w)) {
        const at = (t: number, d: number): Vec2 => [snap(w.a[0] + w.dir[0] * t + out[0] * d), snap(w.a[1] + w.dir[1] * t + out[1] * d)];
        const c = [at(h.t0, -PROUD), at(h.t1, -PROUD), at(h.t0, depth + PROUD), at(h.t1, depth + PROUD)];
        box = [Math.min(...c.map((q) => q[0])), Math.min(...c.map((q) => q[1])), Math.max(...c.map((q) => q[0])), Math.max(...c.map((q) => q[1]))];
      }
      // the same opening registered by both rooms it joins: one cutter (a slanted one: by the corners of its plan quadrilateral)
      const corners = () => { const at = (t: number, d: number) => `${Math.round((w.a[0] + w.dir[0] * t + out[0] * d) * 1e3)},${Math.round((w.a[1] + w.dir[1] * t + out[1] * d) * 1e3)}`; return [at(h.t0, 0), at(h.t1, 0), at(h.t0, depth), at(h.t1, depth)].sort().join(';'); };
      const key = box ? `${box.join(',')}|${z0},${z1}` : !h.polygon && h.kind !== 'window' && h.kind !== 'glazing' ? `${corners()}|${z0},${z1}` : `${room.id}|${h.id}`;
      if (!seenCut.has(key)) {
        seenCut.add(key);
        cuts.push({ id: h.id, roomId: room.id, wallId: w.id, kind: h.kind, a: [snap(w.a[0]), snap(w.a[1])], dir: w.dir, out, outline, depth, box, z0, z1 });
      }
      if ((h.kind === 'window' || h.kind === 'glazing') && depth >= 0.02 && !seenWindow.has(h.id)) {
        seenWindow.add(h.id);
        const t0 = h.t0, t1 = h.t1;
        const z0w = room.floorZ + h.z0;
        windows.push({ id: h.id, roomId: room.id, wallId: w.id, kind: h.kind, a: [w.a[0] + w.dir[0] * t0, w.a[1] + w.dir[1] * t0], dir: w.dir, out, width: t1 - t0, z0: z0w, z1: Math.min(wallTop, room.floorZ + h.z1), depth,
          ...(h.polygon ? { outline: outline.map(([t, z]) => [snap(t - t0), snap(z - z0w)] as Vec2) } : {}) });
      }
    }
  }
  return { cuts, windows };
}
