// MOUNTING SURFACES — a shared model of "what something hangs on" for all wall objects: wall-mounted furniture
// (TV, mirror, shelf, wall lamp, wall cabinet) and devices (socket, switch, thermostat, panel, sensor).
//   • mounting space (MountSpace) — a room seen as a set of walls, or the virtual "outside" (facades),
//   • wall (MountWall) — one outline segment, with its inward normal,
//   • wall run (WallRun) — collinear segments from corner to corner,
//   • mounting surface (MountSurface) — a wall run with local coordinates: u — along (from the run start),
//     v — above the finished floor; the wall openings in the same coordinates.
// Everything follows from the project room geometry (project().building.rooms) and its outline (project().site) — the module knows
// no specific wall. Pure TS: no React, three.js or stores (tests: src/home/tests/mount.test.ts).
// Description: docs/WALL_MOUNTED_OBJECT_PLACEMENT.md.
import { derived, derivedByKey } from '../../project/active';
import { t } from '../../i18n';
import { segDist } from '@home-sim/core/model/geom2d';
import { allLevels, roomById, roomsOfLevel, type HoleKind, type HomeRoom, type RoomWall, type WallHole } from './rooms';
import { inStairOpening } from './stairs';
import type { LevelId, Vec2, Vec3 } from './types';

/** virtual "outside" space: building facades and points on the site (only in a project with a site) */
export const EXT = 'EXT';

export interface MountWall { id: string; roomId: string; index: number; a: Vec2; b: Vec2; length: number; dir: Vec2; inward: Vec2; holes?: WallHole[] }
export interface MountSpace { id: string; name: string; level: LevelId; floorZ: number; walls: MountWall[]; polygon: Vec2[]; exterior: boolean; ceilingAt: (x: number, y: number) => number }

const exteriorSpace = derived((p): MountSpace | null => {
  const site = p.site;
  if (!site || site.footprint.length < 3) return null;
  // clockwise winding seen from above, so that "inward" (the object side) points OUT of the building
  const F = site.footprint, area2 = F.reduce((t, a, i) => { const b = F[(i + 1) % F.length]; return t + a[0] * b[1] - b[0] * a[1]; }, 0);
  const q = area2 > 0 ? [...F].reverse() : F;
  const walls: MountWall[] = q.map((a, i) => { const b = q[(i + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), dir: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; return { id: `${EXT}-w${i + 1}`, roomId: EXT, index: i + 1, a, b, length: L, dir, inward: [-dir[1], dir[0]] as Vec2 }; });
  // "floor" of exterior objects: ground / paving level at the building relative to the floor of the exit level
  return { id: EXT, name: t('mount.outside'), level: site.levelId, floorZ: site.groundLevel, walls, polygon: F, exterior: true, ceilingAt: () => 0 };
});
const toSpace = (r: HomeRoom): MountSpace => ({ id: r.id, name: r.name, level: r.level, floorZ: r.floorZ, walls: r.walls as RoomWall[], polygon: r.polygon, exterior: false, ceilingAt: (x, y) => r.ceiling.heightAt(x, y) });
const interiorSpace = derivedByKey((id: string): MountSpace | null => { const h = roomById(id); return h ? toSpace(h) : null; });

export function mountSpace(id: string | null | undefined): MountSpace | null {
  if (id === EXT) return exteriorSpace();
  return id ? interiorSpace(id) : null;
}
/** spaces of a level; on the level that exits to the site — also "outside" (if the project has a site) */
export function mountSpaces(level: LevelId): MountSpace[] {
  const ext = exteriorSpace();
  return [...roomsOfLevel(level).map((r) => mountSpace(r.id)!), ...(ext && ext.level === level ? [ext] : [])];
}
export const mountWall = (spaceId: string, wallId: string | null): MountWall | null => mountSpace(spaceId)?.walls.find((w) => w.id === wallId) ?? null;

// ------------------------------------------------------------------ wall runs
/** run of collinear walls (a wall split by door openings is several segments in the data): reference to the real corners */
export interface WallRun { index: number; walls: MountWall[]; a: Vec2; b: Vec2; length: number; dir: Vec2; inward: Vec2; side: string }
/** side in plan (X to the right, Y up) on which the wall lies relative to the room interior */
const sideOf = (inward: Vec2, ext: boolean) => {
  const n: Vec2 = ext ? inward : [-inward[0], -inward[1]];
  return Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? t('mount.side.right') : t('mount.side.left')) : n[1] > 0 ? t('mount.side.top') : t('mount.side.bottom');
};
const runsOf = derivedByKey((spaceId: string): WallRun[] => {
  const r = mountSpace(spaceId);
  if (!r) return [];
  const W = r.walls, n = W.length, same = (p: MountWall, q: MountWall) => Math.abs(p.dir[0] * q.dir[1] - p.dir[1] * q.dir[0]) < 1e-6 && p.dir[0] * q.dir[0] + p.dir[1] * q.dir[1] > 0 && Math.hypot(p.b[0] - q.a[0], p.b[1] - q.a[1]) < 1e-6;
  // run start: a wall whose predecessor is not collinear
  let start = 0;
  for (let i = 0; i < n; i++) if (!same(W[(i + n - 1) % n], W[i])) { start = i; break; }
  const runs: WallRun[] = [];
  for (let k = 0; k < n; k++) {
    const w = W[(start + k) % n], last = runs[runs.length - 1];
    if (last && same(last.walls[last.walls.length - 1], w)) { last.walls.push(w); last.b = w.b; last.length += w.length; }
    else runs.push({ index: runs.length + 1, walls: [w], a: w.a, b: w.b, length: w.length, dir: w.dir, inward: w.inward, side: sideOf(w.inward, r.exterior) });
  }
  return runs;
});
export const wallRuns = (spaceId: string): WallRun[] => runsOf(spaceId);

// ------------------------------------------------------------------ mounting surface
/** wall opening in mounting-surface coordinates */
export interface MountHole { id: string; kind: HoleKind; u0: number; u1: number; v0: number; v1: number }
export interface MountSurface {
  /** `${spaceId}#${run number}` */
  id: string;
  spaceId: string;
  index: number;
  level: LevelId;
  exterior: boolean;
  /** run ends in plan (a → b), direction and normal into the space (the side the object hangs on) */
  a: Vec2; b: Vec2; dir: Vec2; normal: Vec2;
  length: number;
  /** finished floor level (LCS z) */
  floorZ: number;
  /** usable wall height at u [m above the floor] — ceiling / sloped ceiling */
  heightAt: (u: number) => number;
  holes: MountHole[];
  /** data wall segments making up the run: id and u range */
  segments: { wallId: string; u0: number; u1: number }[];
  /** side in plan (human-readable description) */
  side: string;
}
/** usable facade height (no ceiling) [m] — one value for mounting surfaces, picking and device limits */
export const EXTERIOR_HEIGHT = 6;
/** ray-picking margin above the usable facade height [m] */
const EXTERIOR_PICK_MARGIN = 1;

const surfacesOf = derivedByKey((spaceId: string): MountSurface[] => {
  const space = mountSpace(spaceId);
  if (!space) return [];
  return wallRuns(spaceId).map((run): MountSurface => {
    const segments: MountSurface['segments'] = [], holes: MountHole[] = [];
    let u = 0;
    for (const w of run.walls) {
      segments.push({ wallId: w.id, u0: u, u1: u + w.length });
      for (const h of w.holes ?? []) holes.push({ id: h.id, kind: h.kind, u0: u + h.t0, u1: u + h.t1, v0: h.z0, v1: h.z1 });
      u += w.length;
    }
    const heightAt = (at: number) => (space.exterior ? EXTERIOR_HEIGHT : space.ceilingAt(run.a[0] + run.dir[0] * at + run.inward[0] * 0.05, run.a[1] + run.dir[1] * at + run.inward[1] * 0.05));
    return { id: `${spaceId}#${run.index}`, spaceId, index: run.index, level: space.level, exterior: space.exterior, a: run.a, b: run.b, dir: run.dir, normal: run.inward, length: run.length, floorZ: space.floorZ, heightAt, holes, segments, side: run.side };
  });
});
/** mounting surfaces of a space (room or EXT) */
export const mountSurfaces = (spaceId: string): MountSurface[] => surfacesOf(spaceId);
export function surfaceById(id: string | null | undefined): MountSurface | null {
  if (!id) return null;
  const k = id.lastIndexOf('#');
  return k < 0 ? null : mountSurfaces(id.slice(0, k)).find((s) => s.id === id) ?? null;
}
/** mounting surface containing a wall (data segment) */
export const surfaceOfWall = (spaceId: string, wallId: string | null | undefined): MountSurface | null => (wallId ? mountSurfaces(spaceId).find((s) => s.segments.some((g) => g.wallId === wallId)) ?? null : null);
/** all mounting surfaces of a level */
export const surfacesOfLevel = (level: LevelId): MountSurface[] => mountSpaces(level).flatMap((s) => mountSurfaces(s.id));

/** (wall, distance from the wall start) → u on the surface */
export function surfaceU(s: MountSurface, wallId: string, t: number): number {
  const g = s.segments.find((x) => x.wallId === wallId);
  return g ? g.u0 + t : t;
}
/** u on the surface → data wall and distance from its start (the document record refers to data walls) */
export function wallAt(s: MountSurface, u: number): { wallId: string; t: number } {
  const c = Math.max(0, Math.min(s.length, u));
  const g = s.segments.find((x) => c <= x.u1 + 1e-9) ?? s.segments[s.segments.length - 1];
  return { wallId: g.wallId, t: Math.round(Math.max(0, Math.min(g.u1 - g.u0, c - g.u0)) * 1e4) / 1e4 };
}
/** LCS point for (u, v) on the surface; off — offset from the face towards the interior */
export const surfacePoint = (s: MountSurface, u: number, v: number, off = 0): Vec3 => [s.a[0] + s.dir[0] * u + s.normal[0] * off, s.a[1] + s.dir[1] * u + s.normal[1] * off, s.floorZ + v];
/** projection of an LCS point onto the surface: u along, v above the floor, n — distance from the face (positive inwards) */
export function surfaceCoords(s: MountSurface, p: Vec3 | Vec2): { u: number; v: number; n: number } {
  const dx = p[0] - s.a[0], dy = p[1] - s.a[1];
  return { u: dx * s.dir[0] + dy * s.dir[1], v: (p.length > 2 ? (p as Vec3)[2] : s.floorZ) - s.floorZ, n: dx * s.normal[0] + dy * s.normal[1] };
}
/**
 * Intersection of a ray with the surface PLANE (unbounded): (u, v) and the distance along the ray. null — ray parallel
 * to the plane or the plane behind the ray origin. The face may point away from the camera (view through a cut-away wall).
 */
export function planeHit(s: MountSurface, origin: Vec3, dir: Vec3): { u: number; v: number; dist: number } | null {
  const dn = dir[0] * s.normal[0] + dir[1] * s.normal[1];
  if (Math.abs(dn) < 1e-9) return null;
  const t = ((s.a[0] - origin[0]) * s.normal[0] + (s.a[1] - origin[1]) * s.normal[1]) / dn;
  if (!(t > 1e-6)) return null;
  const x = origin[0] + dir[0] * t, y = origin[1] + dir[1] * t, z = origin[2] + dir[2] * t;
  return { u: (x - s.a[0]) * s.dir[0] + (y - s.a[1]) * s.dir[1], v: z - s.floorZ, dist: t };
}
/** distance of a plan point from the surface segment (in plan) */
export const distToSurface = (s: MountSurface, q: Vec2): number => segDist(q, s.a, s.b).d;

// ------------------------------------------------------------------ picking: what is under the pointer
/** plan view: a level or the site */
export type PlanViewId = LevelId | 'SITE';
export interface WallRef { roomId: string; wallId: string }
/**
 * Place picked by the pointer: a wall (with the position along it and — in 3D — the hit height) or the horizontal surface of a space.
 * `q` on a wall chosen by the "nearest to the picked spot" rule (`via: 'nearest'`) is the picked plan / floor point.
 */
export type Surface =
  | { kind: 'wall'; room: MountSpace; wall: MountWall; t: number; z: number | null; via: 'face' | 'nearest'; q?: Vec2 }
  | { kind: 'area'; room: MountSpace; q: Vec2 };
export type WallPick = Extract<Surface, { kind: 'wall' }>;

/** wall-change hysteresis when picking [m]: plan — how much closer the new wall must be; 3D — how far past the corner the pointer must go */
export const HYST_PLAN = 0.1, HYST_RAY = 0.07;
/** farthest distance from a wall (outside rooms) at which the pointer still "catches" the wall [m] */
export const REACH = 1.2;

const inPoly = (q: Vec2, c: Vec2[]) => { let s = false; for (let i = 0, j = c.length - 1; i < c.length; j = i++) if ((c[i][1] > q[1]) !== (c[j][1] > q[1]) && q[0] < ((c[j][0] - c[i][0]) * (q[1] - c[i][1])) / (c[j][1] - c[i][1]) + c[i][0]) s = !s; return s; };
const spacesOfView = (view: PlanViewId): MountSpace[] => (view === 'SITE' ? [mountSpace(EXT)].filter((r): r is MountSpace => !!r) : mountSpaces(view));
const along = (w: MountWall, q: Vec2) => (q[0] - w.a[0]) * w.dir[0] + (q[1] - w.a[1]) * w.dir[1];
/** segments of the wall run (one straight wall from corner to corner) that the referenced wall belongs to */
const runIds = (ref: WallRef | null): Set<string> | null => {
  const run = ref ? wallRuns(ref.roomId).find((r) => r.walls.some((w) => w.id === ref.wallId)) : null;
  return run ? new Set(run.walls.map((w) => w.id)) : null;
};
const clampT = (w: MountWall, t: number) => Math.max(0, Math.min(w.length, t));
/** door opening / passage in the wall at t (clear opening) */
export const doorHoleAt = (w: MountWall, t: number, h: number | null) => w.holes?.find((x) => (x.kind === 'door' || x.kind === 'passage') && t > x.t0 && t < x.t1 && (h === null || h < x.z1)) ?? null;
/** room (not exterior) containing the plan point */
export const spaceAtPlan = (view: PlanViewId, q: Vec2): MountSpace | null => spacesOfView(view).find((r) => !r.exterior && inPoly(q, r.polygon)) ?? null;

/**
 * Wall under the pointer in plan. Pointer inside a room → the nearest wall of THAT room (at any distance — the object "sticks"
 * to the wall); pointer inside the wall thickness or outside → the nearest wall of any room / facade within
 * REACH. `cur` — the wall the object is on now (hysteresis).
 */
export function wallFromPlan(view: PlanViewId, q: Vec2, cur: WallRef | null = null): WallPick | null {
  const rooms = spacesOfView(view), inside = rooms.find((r) => !r.exterior && inPoly(q, r.polygon)) ?? null;
  const pool = inside ? [inside] : rooms, own = runIds(cur);
  let best: { room: MountSpace; wall: MountWall; d: number } | null = null, kept: { room: MountSpace; wall: MountWall; d: number } | null = null;
  for (const room of pool) for (const wall of room.walls) {
    const d = segDist(q, wall.a, wall.b).d;
    if (!best || d < best.d) best = { room, wall, d };
    // the current wall is the whole RUN of collinear segments: the nearest of them counts
    if (own && room.id === cur!.roomId && own.has(wall.id) && (!kept || d < kept.d)) kept = { room, wall, d };
  }
  if (!best) return null;
  // hysteresis: the current wall stays unless ANOTHER wall is closer by HYST_PLAN (only within the same candidate pool).
  // Between segments of one straight wall (split at door reveals and outline vertices) there is no hysteresis — the position
  // along the wall is continuous, the device follows the pointer.
  const pick = kept && !own!.has(best.wall.id) && kept.d <= best.d + HYST_PLAN ? kept : best;
  if (!inside && pick.d > REACH) return null;
  return { kind: 'wall', room: pick.room, wall: pick.wall, t: clampT(pick.wall, along(pick.wall, q)), z: null, via: 'nearest', q };
}

export interface RayPointer {
  level: LevelId;
  /** ray origin and direction in LCS (x, y, z — z up) */
  origin: Vec3; dir: Vec3;
  /** whether a point is visible (level section, cut-away of occluding walls) — invisible walls are not hit */
  visible?: (p: Vec3) => boolean;
  /** candidates also outside the ray's level: all project rooms (walking on the stairs); by default only `level` */
  allLevels?: boolean;
}
interface RayHit { s: number; surf: Surface }
/**
 * Whether the ray reaches the point at height `hz` in room `room` without passing through a slab. The ray may cross the slab between
 * levels (floor level of the upper level) only in a stair opening; otherwise the slab occludes — walking on a lower level does not
 * "see" the walls of the room above, and from an upper level the walls below are not visible through the floor. Project without
 * stairs: each level sees only itself.
 */
function slabsClear(o: Vec3, d: Vec3, room: MountSpace, hz: number): boolean {
  const zHit = Math.max(hz, room.floorZ), lo = Math.min(o[2], zHit), hi = Math.max(o[2], zHit);
  for (const l of allLevels()) {
    if (!(l.floorZ > lo + 1e-6 && l.floorZ <= hi + 1e-6)) continue;          // slab outside the ray segment
    if (Math.abs(d[2]) < 1e-9) return false;
    const s = (l.floorZ - o[2]) / d[2], x = o[0] + d[0] * s, y = o[1] + d[1] * s;
    if (!inStairOpening(l.id, [x, y])) return false;
  }
  return true;
}
/**
 * Place picked by a ray: the nearest VISIBLE wall face turned towards the camera (skipping door openings — the ray continues
 * into the next room) or the room floor. For wall objects (`mount` = 'wall') a floor hit yields the nearest wall of that
 * room (as in plan); for ceiling objects ('area') — the point above the hit, and outside the building outline
 * (project with a site) — a ground point.
 */
export function pickFromRay(p: RayPointer, mount: 'wall' | 'area', cur: WallRef | null = null): Surface | null {
  const wallDevice = mount === 'wall', o = p.origin, d = p.dir, vis = p.visible ?? (() => true);
  const rooms = p.allLevels ? allLevels().flatMap((l) => mountSpaces(l.id)) : mountSpaces(p.level);
  let best: RayHit | null = null, kept: RayHit | null = null;
  const take = (h: RayHit) => { if (h.s > 0.05 && (!best || h.s < best.s)) best = h; };
  // Project WITHOUT an exterior space (no site — e.g. an apartment): there is no facade that, in a project with a site, stops
  // a ray coming from outside. Camera outside the rooms: a VISIBLE wall hit from its back side occludes everything behind it —
  // clicking an exterior wall from outside does not "fly through" to a wall deeper inside the apartment. A cut-away wall / one above
  // the section (`visible`) and door openings do not occlude.
  const shield = !exteriorSpace() && !rooms.some((r) => inPoly([o[0], o[1]], r.polygon) && o[2] >= r.floorZ && o[2] <= r.floorZ + r.ceilingAt(o[0], o[1]));
  let blocked = Infinity;
  for (const room of rooms) {
    for (const w of room.walls) {
      const dn = d[0] * w.inward[0] + d[1] * w.inward[1];
      if (dn >= -1e-6 && !(shield && dn > 1e-6)) continue;                    // face turned away from the camera
      const s = ((w.a[0] - o[0]) * w.inward[0] + (w.a[1] - o[1]) * w.inward[1]) / dn;
      if (s <= 0.05) continue;
      const hx = o[0] + d[0] * s, hy = o[1] + d[1] * s, hz = o[2] + d[2] * s, t = along(w, [hx, hy]);
      const top = room.exterior ? EXTERIOR_HEIGHT + EXTERIOR_PICK_MARGIN : room.ceilingAt(hx + w.inward[0] * 0.05, hy + w.inward[1] * 0.05) + 0.02;
      if (hz < room.floorZ - 0.02 || hz > room.floorZ + top) continue;
      if (dn > 0) {                                                          // wall seen from behind (only `shield`): occluder, not a mounting place
        if (s < blocked && t >= 0 && t <= w.length && !doorHoleAt(w, t, hz - room.floorZ) && vis([hx, hy, hz])) blocked = s;
        continue;
      }
      const isCur = !!cur && cur.roomId === room.id && cur.wallId === w.id, m = isCur ? HYST_RAY : 0;
      if (t < -m || t > w.length + m) continue;
      if (doorHoleAt(w, t, hz - room.floorZ)) continue;                       // the next room is visible through an open passage
      if (!vis([hx, hy, hz])) continue;
      if (p.allLevels && !slabsClear(o, d, room, hz)) continue;               // a slab hides walls of another level
      const hit: RayHit = { s, surf: { kind: 'wall', room, wall: w, t: clampT(w, t), z: hz, via: 'face' } };
      if (isCur) kept = hit;
      if (t >= 0 && t <= w.length) take(hit);
    }
    if (room.exterior) {
      // ground around the building — place for site points (garden lamp): the ground plane at the building, only OUTSIDE the
      // building outline (a point "under the building", e.g. inside the wall thickness, is not an outside place)
      if (!wallDevice && d[2] < -1e-6) {
        const z = room.floorZ, s = (z - o[2]) / d[2], q: Vec2 = [o[0] + d[0] * s, o[1] + d[1] * s];
        if (s > 0.05 && !inPoly(q, room.polygon) && vis([q[0], q[1], z + 0.01]) && !(p.allLevels && !slabsClear(o, d, room, z))) take({ s, surf: { kind: 'area', room, q } });
      }
      continue;
    }
    // floor (looking down) or ceiling (looking up — walk mode)
    if (Math.abs(d[2]) < 1e-6) continue;
    const down = d[2] < 0;
    let z = room.floorZ + (down ? 0 : room.ceilingAt(o[0], o[1])), s = (z - o[2]) / d[2], q: Vec2 = [o[0] + d[0] * s, o[1] + d[1] * s];
    if (!down) { z = room.floorZ + room.ceilingAt(q[0], q[1]); s = (z - o[2]) / d[2]; q = [o[0] + d[0] * s, o[1] + d[1] * s]; }   // sloped ceiling: second iteration
    if (s <= 0.05 || !inPoly(q, room.polygon) || (down && !vis([q[0], q[1], z + 0.01]))) continue;
    if (p.allLevels && !slabsClear(o, d, room, z)) continue;
    if (!wallDevice) take({ s, surf: { kind: 'area', room, q } });
    else if (down) { const w = wallFromPlan(room.level, q, cur && cur.roomId === room.id ? cur : null); if (w && w.room === room) take({ s, surf: w }); }
  }
  // hits behind a visible wall hit from behind are occluded
  if (best && blocked < (best as RayHit).s) best = null;
  if (kept && blocked < (kept as RayHit).s) kept = null;
  if (!best) return kept ? (kept as RayHit).surf : null;
  const b = best as RayHit, k = kept as RayHit | null;
  // corner hysteresis: the pointer passed the corner of the current wall by less than HYST_RAY and hits the neighbouring one — stay.
  // A joint between segments of one straight wall is not a corner: there the face under the pointer wins.
  if (k && b.surf.kind === 'wall' && b.surf.via === 'face' && k.surf.kind === 'wall' && b.surf.wall !== k.surf.wall && k.s <= b.s + 0.5
    && !(b.surf.room === k.surf.room && runIds(cur)?.has(b.surf.wall.id))) {
    const kt = along(k.surf.wall, [o[0] + d[0] * k.s, o[1] + d[1] * k.s]);
    if (kt < 0 || kt > k.surf.wall.length) return k.surf;
  }
  if (!wallDevice && b.surf.kind === 'wall') { const w = b.surf; return { kind: 'area', room: w.room, q: [w.wall.a[0] + w.wall.dir[0] * w.t + w.wall.inward[0] * 0.5, w.wall.a[1] + w.wall.dir[1] * w.t + w.wall.inward[1] * 0.5] }; }
  return b.surf;
}
export const wallRefOf = (at: { roomId: string; wallId: string | null } | null): WallRef | null => (at && at.wallId ? { roomId: at.roomId, wallId: at.wallId } : null);

/** picked wall → (mounting surface, u, v): from a wall segment to the run */
export function pickOnSurface(w: WallPick): { surface: MountSurface; u: number; v: number | null } | null {
  const s = surfaceOfWall(w.room.id, w.wall.id);
  return s ? { surface: s, u: surfaceU(s, w.wall.id, w.t), v: w.z === null ? null : w.z - s.floorZ } : null;
}
