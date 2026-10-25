// WALK mode on a level: the walkable area = room interiors (kept away from walls by the body radius) + corridors
// in door and passage openings connecting two rooms of the same level (passing through the wall thickness). Walls block
// motion; motion along a wall "slides" (X and Y components separately). Exterior doors do not lead outside. Under sloped
// ceilings, places where the ceiling is lower than eye height + clearance are not walkable. Pure TS (tests without a browser).
import { derivedByKey } from '../../project/active';
import { distToPolygonEdges, pointInPolygon } from './geom2d';
import { roomsOfLevel, type HomeRoom } from './rooms';
import type { LevelId, Vec2 } from './types';

/** body radius [m] — distance of the eyes (camera) from walls */
export const BODY_R = 0.22;
const HEAD_CLEAR = 0.12;

interface Corridor { a: Vec2; dir: Vec2; inward: Vec2; t0: number; t1: number; out: number; inn: number; doorId: string | null; roomId: string }

// Door gate: a closed leaf blocks the corridor in the opening; set by the door state store (store/doors.ts),
// directly in tests. Passages without doors (doorId = null) are always open.
let doorGate: (doorId: string) => boolean = () => true;
export function setDoorGate(fn: ((doorId: string) => boolean) | null) { doorGate = fn ?? (() => true); }
const open = (c: Corridor) => c.doorId === null || doorGate(c.doorId);
/** whether the door with the given id lets you through (interior doors and exterior ones opened in walk mode) */
export const doorPasses = (doorId: string) => doorGate(doorId);

/** corridors in door / passage openings between rooms of a level (computed once per project level) */
export const doorCorridors = derivedByKey((level: LevelId): Corridor[] => {
  const rooms = roomsOfLevel(level), out: Corridor[] = [];
  for (const r of rooms) {
    for (const d of r.doors) {
      const w = r.walls.find((x) => x.id === d.wallId);
      if (!w) continue;
      // the other side of the opening must be a room of the same level (exterior doors — no way outside);
      // wall thickness at the opening — distance to the neighbouring room (up to 1.2 m)
      let thick = -1;
      for (let k = 0.05; k <= 1.2 && thick < 0; k += 0.05) {
        const q: Vec2 = [d.center[0] - w.inward[0] * k, d.center[1] - w.inward[1] * k];
        if (rooms.some((x) => x.id !== r.id && pointInPolygon(q, x.polygon, -1))) thick = k;
      }
      if (thick < 0) continue;
      // passage width: opening minus the body (min. 0.2 m — narrow doors remain passable)
      const half = Math.max(0.1, (d.t1 - d.t0) / 2 - BODY_R * 0.8), mid = (d.t0 + d.t1) / 2;
      out.push({ a: w.a, dir: w.dir, inward: w.inward, t0: mid - half, t1: mid + half, out: thick + BODY_R + 0.15, inn: BODY_R + 0.15, doorId: d.id, roomId: r.id });
    }
  }
  return out;
});

function inCorridor(c: Corridor, p: Vec2): boolean {
  const vx = p[0] - c.a[0], vy = p[1] - c.a[1];
  const t = vx * c.dir[0] + vy * c.dir[1], n = vx * c.inward[0] + vy * c.inward[1];
  return t >= c.t0 && t <= c.t1 && n >= -c.out && n <= c.inn;
}

/** room of the level containing the point (or null) */
export function walkRoomAt(level: LevelId, p: Vec2): HomeRoom | null {
  return roomsOfLevel(level).find((r) => pointInPolygon(p, r.polygon, -1)) ?? null;
}

/** room in whose door / passage opening point p stands (wall thickness between rooms — outside room outlines); null — outside openings */
export function walkDoorwayRoom(level: LevelId, p: Vec2): HomeRoom | null {
  const c = doorCorridors(level).find((x) => open(x) && inCorridor(x, p));
  return c ? roomsOfLevel(level).find((r) => r.id === c.roomId) ?? null : null;
}

/** whether the walk camera may stand at point p (eyes at height `eye` above the floor) */
export function walkAllowed(level: LevelId, p: Vec2, eye: number): boolean {
  const room = walkRoomAt(level, p);
  if (room && room.ceiling.heightAt(p[0], p[1]) < eye + HEAD_CLEAR) return false;
  if (room && distToPolygonEdges(p, room.polygon) >= BODY_R) return true;
  return doorCorridors(level).some((c) => open(c) && inCorridor(c, p));
}

/** door funnelling: when brushing against the frame, motion is steered towards the opening axis (as in 3D walkthroughs / games) */
function funnel(level: LevelId, p: Vec2, sx: number, sy: number): Vec2[] {
  const out: Vec2[] = [], step = Math.hypot(sx, sy);
  for (const c of doorCorridors(level)) {
    if (!open(c)) continue;
    const vx = p[0] - c.a[0], vy = p[1] - c.a[1];
    const t = vx * c.dir[0] + vy * c.dir[1], n = vx * c.inward[0] + vy * c.inward[1];
    const toward = -(sx * c.inward[0] + sy * c.inward[1]); // motion towards the opening (from either side of the wall)
    if (t < c.t0 - 0.3 || t > c.t1 + 0.3 || n < -c.out - 0.35 || n > c.inn + 0.35 || Math.abs(toward) < step * 0.3) continue;
    const mid = (c.t0 + c.t1) / 2, k = Math.max(-step, Math.min(step, mid - t));
    out.push([p[0] + sx + c.dir[0] * k, p[1] + sy + c.dir[1] * k], [p[0] + c.dir[0] * k, p[1] + c.dir[1] * k]);
  }
  return out;
}

/** walk step from `from` by (dx, dy): full motion, or when blocked — a slide along X or Y; otherwise no motion */
export function walkStep(level: LevelId, from: Vec2, dx: number, dy: number, eye: number): Vec2 {
  // a long step (mouse wheel) is split into segments so it cannot jump through a wall
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.08));
  let p = from;
  for (let i = 0; i < n; i++) {
    const sx = dx / n, sy = dy / n;
    const cand: Vec2[] = [[p[0] + sx, p[1] + sy], ...funnel(level, p, sx, sy), [p[0] + sx, p[1]], [p[0], p[1] + sy]];
    const ok = cand.find((q) => (q[0] !== p[0] || q[1] !== p[1]) && walkAllowed(level, q, eye));
    if (!ok) break;
    p = ok;
  }
  return p;
}

/** nearest walkable point in the room (walk start, eye height change) */
export function walkNearestAllowed(level: LevelId, room: HomeRoom, p: Vec2, eye: number): Vec2 {
  if (walkAllowed(level, p, eye)) return p;
  let best: Vec2 = [room.center[0], room.center[1]], bd = Infinity;
  const [x0, y0, x1, y1] = room.bbox;
  for (let x = x0 + 0.1; x <= x1; x += 0.1) for (let y = y0 + 0.1; y <= y1; y += 0.1) {
    const q: Vec2 = [x, y], d = Math.hypot(x - p[0], y - p[1]);
    if (d < bd && pointInPolygon(q, room.polygon, -1) && walkAllowed(level, q, eye)) { best = q; bd = d; }
  }
  return best;
}

/**
 * Walk motion input: f — forward (+) / backward (−), s — right (+) / left (−); sum of keys (±1) and joystick (−1…1).
 * The vector is clamped to the unit circle rather than per component: diagonally (W + D) the components (1, 1) would give a step
 * √2 times longer than straight ahead. Values inside the circle (joystick slightly tilted) stay unchanged.
 */
export function walkInputVector(f: number, s: number): [number, number] {
  const l = Math.hypot(f, s);
  if (!Number.isFinite(l)) return [0, 0];
  return l > 1 ? [f / l, s / l] : [f, s];
}
