// GRID SHELL — the generated shell of a package without a model file, computed on a rectangular grid (ADR 0010):
//   • wall mass = everything outside the rooms but no farther than the exterior wall thickness from one of them
//     (interior walls fill in by themselves — the gap between neighbouring rooms is smaller);
//   • openings (doors, passages, windows) are cut straight through from the room face over the opening's height range;
//   • a floor slab under every level (with the stair opening), a roof slab over the top one.
// The grid is spanned by the outline coordinates, so it applies to ORTHOGONAL plans (walls along the X / Y axes) — just like
// the room door and window data (along / plane_axis). Sloped ceilings are not represented. The manifold shell replaces it
// (ADR 0024); this one stays as a fallback for one release (ADR 0026).
import { stairArrivesAt, roomsOfLevel, type Building, type HoleKind, type Room, type RoomWall, type WallHole } from './building.ts';
import { pointInPolygon } from './geom2d.ts';
import type { LevelId, ShellSpec, Vec2, Vec3 } from '../package/types.ts';

/** shell surface quad; corners counter-clockwise as seen from outside the solid */
export interface ShellQuad { p: [Vec3, Vec3, Vec3, Vec3]; n: Vec3 }

/** window in a generated shell wall: an opening cut through from the room face */
export interface ShellWindow {
  id: string; roomId: string; wallId: string; kind: HoleKind;
  /** opening start on the room face, direction along the wall and outward normal */
  a: Vec2; dir: Vec2; out: Vec2;
  width: number;
  /** bottom and top of the opening (absolute) */
  z0: number; z1: number;
  /** wall thickness at the opening */
  depth: number;
}

export interface LevelShell {
  level: LevelId;
  /** floor and top of the walls (absolute) */
  z0: number; z1: number;
  walls: ShellQuad[];
  floor: ShellQuad[];
  /** roof slab — only over the top level */
  top: ShellQuad[];
  windows: ShellWindow[];
  /** wall mass in plan: rectangles [x0, y0, x1, y1] (without openings — the plan draws those) */
  mass: [number, number, number, number][];
  /** outer bounds of the level in plan [x0, y0, x1, y1] */
  bbox: [number, number, number, number];
}

const TOL = 1e-6;
const uniq = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 1e5) / 1e5))].sort((a, b) => a - b);
const axisAligned = (w: RoomWall) => Math.abs(w.dir[0]) < 1e-6 || Math.abs(w.dir[1]) < 1e-6;
/** whether the room plan is orthogonal (precondition of the grid shell) */
export const orthogonalPlan = (rooms: Room[]): boolean => rooms.every((r) => r.walls.every(axisAligned));

/** whether a square with centre c and half-side t intersects the polygon (point within the polygon grown by t — Chebyshev metric) */
function nearPolygon(c: Vec2, t: number, poly: Vec2[]): boolean {
  if (pointInPolygon(c, poly, 0)) return true;
  const x0 = c[0] - t, x1 = c[0] + t, y0 = c[1] - t, y1 = c[1] + t;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    // orthogonal outlines: the bounding rectangle of an edge is the edge itself
    if (Math.max(a[0], b[0]) >= x0 && Math.min(a[0], b[0]) <= x1 && Math.max(a[1], b[1]) >= y0 && Math.min(a[1], b[1]) <= y1) return true;
  }
  return false;
}

/** surface of the grid solids: faces between a solid and an empty cell (closed solid — required for capping the section with a stencil) */
function surface(xs: number[], ys: number[], zs: number[], solid: (i: number, j: number, k: number) => boolean): ShellQuad[] {
  const out: ShellQuad[] = [], nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
  const at = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && solid(i, j, k);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    if (!solid(i, j, k)) continue;
    const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1], z0 = zs[k], z1 = zs[k + 1];
    if (!at(i + 1, j, k)) out.push({ p: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], n: [1, 0, 0] });
    if (!at(i - 1, j, k)) out.push({ p: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], n: [-1, 0, 0] });
    if (!at(i, j + 1, k)) out.push({ p: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], n: [0, 1, 0] });
    if (!at(i, j - 1, k)) out.push({ p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], n: [0, -1, 0] });
    if (!at(i, j, k + 1)) out.push({ p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], n: [0, 0, 1] });
    if (!at(i, j, k - 1)) out.push({ p: [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], n: [0, 0, -1] });
  }
  return out;
}

/** wall height of a level: the highest ceiling of its rooms above the level floor */
function wallTop(rooms: Room[], floorZ: number): number {
  let top = 0;
  for (const r of rooms) {
    for (const q of r.polygon) top = Math.max(top, r.floorZ + r.ceiling.heightAt(q[0], q[1]));
    // sloped ceiling: highest where the room comes closest to the ridge (the corners lie on the knee walls)
    const c = r.ceiling, [x0, y0, x1, y1] = r.bbox;
    if (c.kind === 'attic') top = Math.max(top, r.floorZ + c.heightAt(Math.min(x1, Math.max(x0, c.ridgeX ?? x0)), Math.min(y1, Math.max(y0, c.ridgeY ?? y0))));
  }
  return top > floorZ ? top : floorZ + 2.6;
}

function buildLevel(b: Building, level: LevelId, spec: ShellSpec): LevelShell {
  const rooms = roomsOfLevel(b, level), t = spec.exteriorWall, z0 = b.levelById.get(level)?.floorZ ?? 0, z1 = wallTop(rooms, z0);
  const empty: LevelShell = { level, z0, z1, walls: [], floor: [], top: [], windows: [], mass: [], bbox: [0, 0, 0, 0] };
  if (!rooms.length) return empty;
  // --- plan grid: outline coordinates, their offsets by the wall thickness, opening ends, stair openings
  const xv: number[] = [], yv: number[] = [], zv: number[] = [z0, z1];
  interface Cut { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number }
  const cuts: Cut[] = [];
  const holes: { room: Room; wall: RoomWall; hole: WallHole; p0: Vec2; p1: Vec2; out: Vec2 }[] = [];
  for (const r of rooms) {
    for (const q of r.polygon) { xv.push(q[0] - t, q[0], q[0] + t); yv.push(q[1] - t, q[1], q[1] + t); }
    if (r.stairOpening) { xv.push(r.stairOpening[0], r.stairOpening[2]); yv.push(r.stairOpening[1], r.stairOpening[3]); }
    for (const w of r.walls) {
      if (!axisAligned(w)) continue;
      const out: Vec2 = [-w.inward[0] || 0, -w.inward[1] || 0];   // no −0
      for (const h of w.holes) {
        const p0: Vec2 = [w.a[0] + w.dir[0] * h.t0, w.a[1] + w.dir[1] * h.t0], p1: Vec2 = [w.a[0] + w.dir[0] * h.t1, w.a[1] + w.dir[1] * h.t1];
        const q0: Vec2 = [p0[0] + out[0] * t, p0[1] + out[1] * t], q1: Vec2 = [p1[0] + out[0] * t, p1[1] + out[1] * t];
        const c: Cut = { x0: Math.min(p0[0], p1[0], q0[0], q1[0]), y0: Math.min(p0[1], p1[1], q0[1], q1[1]), x1: Math.max(p0[0], p1[0], q0[0], q1[0]), y1: Math.max(p0[1], p1[1], q0[1], q1[1]), z0: r.floorZ + h.z0, z1: Math.min(z1, r.floorZ + h.z1) };
        cuts.push(c); holes.push({ room: r, wall: w, hole: h, p0, p1, out });
        xv.push(c.x0, c.x1); yv.push(c.y0, c.y1); zv.push(c.z0, c.z1);
      }
    }
  }
  const xs = uniq(xv), ys = uniq(yv), zs = uniq(zv.filter((z) => z >= z0 - TOL && z <= z1 + TOL));
  const nx = xs.length - 1, ny = ys.length - 1;
  // --- plan cell classification: 1 — room, 2 — wall, 0 — outside the building
  const cls = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const c: Vec2 = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
    if (rooms.some((r) => pointInPolygon(c, r.polygon, 0))) cls[i * ny + j] = 1;
    else if (rooms.some((r) => nearPolygon(c, t - TOL, r.polygon))) cls[i * ny + j] = 2;
  }
  const inCut = (c: Cut, x: number, y: number, z: number) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1 && z > c.z0 && z < c.z1;
  const wallSolid = (i: number, j: number, k: number) => {
    if (cls[i * ny + j] !== 2) return false;
    const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2, z = (zs[k] + zs[k + 1]) / 2;
    return !cuts.some((c) => inCut(c, x, y, z));
  };
  const walls = surface(xs, ys, zs, wallSolid);
  // --- slabs: under the whole level (without stair openings), roof slab over the top level
  const stair = stairArrivesAt(b, level) ? rooms.map((r) => r.stairOpening).filter((s): s is [number, number, number, number] => !!s) : [];
  const built = (i: number, j: number) => cls[i * ny + j] !== 0;
  const inStair = (i: number, j: number) => { const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2; return stair.some((s) => x > s[0] && x < s[2] && y > s[1] && y < s[3]); };
  const floor = surface(xs, ys, [z0 - spec.slab, z0], (i, j) => built(i, j) && !inStair(i, j));
  const isTop = b.levels[b.levels.length - 1]?.id === level;
  const top = isTop ? surface(xs, ys, [z1, z1 + spec.slab], (i, j) => built(i, j)) : [];
  // --- windows: opening depth = wall mass from the room face outwards
  const cellOf = (v: number[], x: number) => { for (let i = 0; i < v.length - 1; i++) if (x > v[i] && x < v[i + 1]) return i; return -1; };
  const depthAt = (mid: Vec2, out: Vec2): number => {
    let d = 0;
    for (let n = 0; n < 64; n++) {
      const i = cellOf(xs, mid[0] + out[0] * (d + 1e-4)), j = cellOf(ys, mid[1] + out[1] * (d + 1e-4));
      if (i < 0 || j < 0 || cls[i * ny + j] !== 2) break;
      d = out[0] > 0.5 ? xs[i + 1] - mid[0] : out[0] < -0.5 ? mid[0] - xs[i] : out[1] > 0.5 ? ys[j + 1] - mid[1] : mid[1] - ys[j];
    }
    return d;
  };
  const windows: ShellWindow[] = [], seen = new Set<string>();
  for (const { room, wall, hole, p0, p1, out } of holes) {
    if ((hole.kind !== 'window' && hole.kind !== 'glazing') || seen.has(hole.id)) continue;
    const depth = depthAt([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], out);
    if (depth < 0.02) continue;
    seen.add(hole.id);
    windows.push({ id: hole.id, roomId: room.id, wallId: wall.id, kind: hole.kind, a: p0, dir: wall.dir, out, width: hole.t1 - hole.t0, z0: room.floorZ + hole.z0, z1: Math.min(z1, room.floorZ + hole.z1), depth });
  }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (built(i, j)) { bx0 = Math.min(bx0, xs[i]); bx1 = Math.max(bx1, xs[i + 1]); by0 = Math.min(by0, ys[j]); by1 = Math.max(by1, ys[j + 1]); }
  // wall mass in plan: wall cells merged into strips along X
  const mass: LevelShell['mass'] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (cls[i * ny + j] !== 2) continue;
    let k = i;
    while (k + 1 < nx && cls[(k + 1) * ny + j] === 2) k++;
    mass.push([xs[i], ys[j], xs[k + 1], ys[j + 1]]);
    i = k;
  }
  return { level, z0, z1, walls, floor, top, windows, mass, bbox: [bx0, by0, bx1, by1] };
}

const shells = new WeakMap<Building, Map<LevelId, LevelShell>>();
/** grid shell of a level (once per building and level) */
export function gridLevelShell(b: Building, level: LevelId): LevelShell {
  let m = shells.get(b);
  if (!m) { m = new Map(); shells.set(b, m); }
  let s = m.get(level);
  if (!s) { s = buildLevel(b, level, b.shell); m.set(level, s); }
  return s;
}

/** building bounds in space: from the grid shell (room plan + exterior walls, from the slab underside to the top of the roof slab) */
export function gridShellBounds(b: Building): { min: Vec3; max: Vec3 } {
  const spec = b.shell, all = b.levels.map((l) => gridLevelShell(b, l.id)).filter((s) => s.walls.length);
  if (!all.length) return { min: [0, 0, 0], max: [1, 1, 1] };
  return {
    min: [Math.min(...all.map((s) => s.bbox[0])), Math.min(...all.map((s) => s.bbox[1])), Math.min(...all.map((s) => s.z0)) - spec.slab],
    max: [Math.max(...all.map((s) => s.bbox[2])), Math.max(...all.map((s) => s.bbox[3])), Math.max(...all.map((s) => s.z1)) + spec.slab],
  };
}
