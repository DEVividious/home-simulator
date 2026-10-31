// Walking through the building and the site — pure TS (tests without a browser).
// The walkable surface consists of:
//   • the rooms of all levels with passages through doors (walk.ts: clearance from walls = body radius, headroom under slopes),
//   • stairs (stairs.ts: ramp over the treads, landing, divider between flights),
//   • corridors through passable exterior openings (entrance doors, lift-and-slide doors, terrace doors, other doors to the outside),
//   • the ground around the building (outside the building outline with a clearance; height from the designed terrain / paving model — a probe
//     passed in from outside: in the browser a downward raycast on site.glb, in tests an analytic function).
// Movement is allowed when the target point belongs to the surface AND the height changes by at most MAX_STEP per segment
// (threshold, step, terrace edge) — so from a lower level you cannot walk under the upper flight of stairs or onto the landing, and from
// an upper level you cannot fall into the stair opening (it acts as a balustrade). Walls and the building outline block; movement along an obstacle "slides".
// Levels, passable openings and the site-exit level come from the project package — a project without a site has no
// corridors to the outside and no walking on the ground.
import { t } from '../../i18n';
import { siteLevelId } from './electrical';
import { derived, project } from '../../project/active';
import { doorById } from './doors';
import { distToPolygonEdges, pointInPolygon, segDist } from '@home-sim/core/model/geom2d';
import { building } from './building';
import { levelAtZ, levelById, levelName, roomById, roomsOfLevel, type HomeRoom } from './rooms';
import { inStairBox, stairAllowed, stairZ } from './stairs';
import type { LevelId, Vec2 } from './types';
import { BODY_R, doorPasses, walkAllowed, walkDoorwayRoom, walkRoomAt } from './walk';

/** largest change of foot height per movement segment (8 cm) [m] — a 17.5 cm step on the ramp ≈ 5.5 cm / segment */
export const MAX_STEP = 0.3;
const SEG = 0.08;
/** level floor */
const floorOf = (level: LevelId) => levelById(level)?.floorZ ?? 0;
/** level from which one exits to the site (null — project without a site) */
const siteLevel = siteLevelId;

/** exterior openings one can walk through (from the project package: floor-level openings filled with passable joinery) */
const NO_OPENINGS: string[] = [];
export const passableOpenings = (): string[] => project().building.doorFacts?.passableOpenings ?? NO_OPENINGS;

interface ExtDoor { id: string; roomId: string; a: Vec2; dir: Vec2; inward: Vec2; t0: number; t1: number }

/**
 * Corridors through passable exterior openings of the site-exit level (from the room interior outwards through the wall thickness).
 * spans: passage range in the opening [point, point] in LCS — for joinery opened in walk mode the passage is only the clear width of the leaf
 * (entrance door: the leaf, not the side light; lift-and-slide door: the sliding panel, not the fixed one); no entry — the whole opening.
 */
export function exteriorDoors(spans?: Record<string, [Vec2, Vec2]>): ExtDoor[] {
  const out: ExtDoor[] = [], level = siteLevel(), passable = passableOpenings();
  if (level === null) return out;
  for (const r of roomsOfLevel(level)) for (const w of r.windows) {
    if (!passable.includes(w.id) || w.sill > 0.05) continue;
    const wall = r.walls.find((x) => x.id === w.wallId)!;
    const sp = spans?.[w.id], tOf = (q: Vec2) => (q[0] - wall.a[0]) * wall.dir[0] + (q[1] - wall.a[1]) * wall.dir[1];
    const lo = sp ? Math.max(w.t0, Math.min(tOf(sp[0]), tOf(sp[1]))) : w.t0, hi = sp ? Math.min(w.t1, Math.max(tOf(sp[0]), tOf(sp[1]))) : w.t1;
    const half = Math.max(0.1, (hi - lo) / 2 - BODY_R * 0.8), mid = (lo + hi) / 2;
    out.push({ id: w.id, roomId: r.id, a: wall.a, dir: wall.dir, inward: wall.inward, t0: mid - half, t1: mid + half });
  }
  // doors to the exterior (DoorDef.rooms contains 'exterior'): the corridor spans the door gap; the door state gates it
  for (const r of roomsOfLevel(level)) for (const d of r.doors) {
    const def = d.id ? doorById(d.id) : null;
    if (!def || !def.rooms.includes('exterior')) continue;
    const wall = r.walls.find((x) => x.id === d.wallId)!;
    const half = Math.max(0.1, (d.t1 - d.t0) / 2 - BODY_R * 0.8), mid = (d.t0 + d.t1) / 2;
    out.push({ id: def.id, roomId: r.id, a: wall.a, dir: wall.dir, inward: wall.inward, t0: mid - half, t1: mid + half });
  }
  return out;
}

const extDoors = derived(() => exteriorDoors());

/** walls that bound no room stand in the way on the site (wing walls, porch walls, garden walls) — their openings too */
const freeWalls = derived(() => building().walls.map((w) => ({ a: w.a, b: w.b, r: w.thickness / 2 + BODY_R })));
export const nearFreeWall = (p: Vec2): boolean => freeWalls().some((w) => segDist(p, w.a, w.b).d < w.r);
const DOOR_OUT = 1.0; // corridor reach outwards from the inner face (exterior wall up to 0.6 m + body)
const DOOR_IN = BODY_R + 0.15;
function inExtDoor(d: ExtDoor, p: Vec2) {
  const vx = p[0] - d.a[0], vy = p[1] - d.a[1];
  const t = vx * d.dir[0] + vy * d.dir[1], n = vx * d.inward[0] + vy * d.inward[1];
  return t >= d.t0 && t <= d.t1 && n >= -DOOR_OUT && n <= DOOR_IN;
}

/** whether a point inside the building stands in the threshold of a passable exterior opening (room walk → switch to building walk);
 *  `level` — the point's level: openings to the site exist only on the site-exit level */
export function nearExteriorDoor(p: Vec2, level: LevelId | null = siteLevel()): boolean {
  return level === siteLevel() && extDoors().some((d) => inExtDoor(d, p) && doorPasses(d.id));
}

export interface WalkWorldOptions {
  /** building outline in plan (LCS) — obstacle for walking on the site */
  footprint: Vec2[];
  /** walkable site extent [x0, y0, x1, y1] (terrain model area) */
  bounds: [number, number, number, number];
  /** ground / paving height at a point (null — no ground) */
  ground: (x: number, y: number) => number | null;
  /** round obstacles on the site (tree trunks): [x, y, r] */
  obstacles?: [number, number, number][];
  /** passage range in exterior openings opened in walk mode (according to the variant's current joinery) */
  doorSpans?: Record<string, [Vec2, Vec2]>;
}

export interface WalkPose { p: Vec2; z: number }

export type WalkPlace =
  | { kind: 'room'; level: LevelId; room: HomeRoom; label: string }
  | { kind: 'stairs'; label: string }
  | { kind: 'door'; id: string; label: string }
  | { kind: 'site'; label: string };

export class WalkWorld {
  readonly doors: ExtDoor[];
  constructor(readonly o: WalkWorldOptions) { this.doors = o.doorSpans ? exteriorDoors(o.doorSpans) : extDoors(); }

  private outsideHouse(p: Vec2) {
    return !pointInPolygon(p, this.o.footprint, 0) && distToPolygonEdges(p, this.o.footprint) >= BODY_R && !nearFreeWall(p);
  }

  /** foot height at point p given the current height zCur (selects the level), or null — point not accessible */
  heightAt(p: Vec2, zCur: number, eye: number): number | null {
    if (inStairBox(p)) return stairAllowed(p, BODY_R) ? stairZ(p) : null;
    const level: LevelId = levelAtZ(zCur);
    if (walkAllowed(level, p, eye)) return floorOf(level);
    // one exits only from the level at ground; a project without a site has no walking outside the rooms
    if (level !== siteLevel()) return null;
    for (const d of this.doors) {
      // closed entrance / sliding doors block (door gate — like interior doors)
      if (!inExtDoor(d, p) || !doorPasses(d.id)) continue;
      if (pointInPolygon(p, this.o.footprint, 0)) return floorOf(level); // threshold within the wall thickness
      return this.o.ground(p[0], p[1]) ?? floorOf(level);
    }
    const [x0, y0, x1, y1] = this.o.bounds;
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1 || !this.outsideHouse(p)) return null;
    if (this.o.obstacles?.some(([x, y, r]) => Math.hypot(p[0] - x, p[1] - y) < r + BODY_R)) return null;
    return this.o.ground(p[0], p[1]);
  }

  /** movement segment allowed: point accessible and height change ≤ MAX_STEP */
  private reach(from: WalkPose, q: Vec2, eye: number): WalkPose | null {
    const z = this.heightAt(q, from.z, eye);
    return z !== null && Math.abs(z - from.z) <= MAX_STEP ? { p: q, z } : null;
  }

  /** step from `from` by (dx, dy): full move, sliding along X / Y at an obstacle (a long step is split into 8 cm segments) */
  step(from: WalkPose, dx: number, dy: number, eye: number): WalkPose {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SEG));
    let cur = from;
    for (let i = 0; i < n; i++) {
      const sx = dx / n, sy = dy / n, p = cur.p;
      const cand: Vec2[] = [[p[0] + sx, p[1] + sy], [p[0] + sx, p[1]], [p[0], p[1] + sy]];
      let next: WalkPose | null = null;
      for (const q of cand) if ((q[0] !== p[0] || q[1] !== p[1]) && (next = this.reach(cur, q, eye))) break;
      if (!next) break;
      cur = next;
    }
    return cur;
  }

  /** valid start position closest to p (spiral up to 3 m), height matched to the ground / floor */
  settle(p: Vec2, zHint: number, eye: number): WalkPose | null {
    for (let r = 0; r <= 3; r += 0.1) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.1);
      for (let i = 0; i < n; i++) {
        const q: Vec2 = [p[0] + r * Math.cos((i / n) * 2 * Math.PI), p[1] + r * Math.sin((i / n) * 2 * Math.PI)];
        const z = this.heightAt(q, zHint, eye);
        if (z !== null && Math.abs(z - zHint) < 1.2) return { p: q, z };
      }
    }
    return null;
  }

  /** place (for display): room, stairs, exterior opening, site */
  placeAt(pose: WalkPose, eye: number, surface?: string | null): WalkPlace {
    if (inStairBox(pose.p)) return { kind: 'stairs', label: t('walk.stairs') };
    const level: LevelId = levelAtZ(pose.z);
    const room = walkRoomAt(level, pose.p);
    if (room && walkAllowed(level, pose.p, eye)) return { kind: 'room', level, room, label: t('walk.levelRoom', { level: levelName(level), room: room.label }) };
    // clear opening of an interior door / passage (wall thickness between rooms): still inside — the room the opening belongs to
    const via = room ? null : walkDoorwayRoom(level, pose.p);
    if (via) return { kind: 'room', level, room: via, label: t('walk.levelRoom', { level: levelName(level), room: via.label }) };
    const d = this.doors.find((x) => inExtDoor(x, pose.p));
    if (d) return { kind: 'door', id: d.id, label: t('walk.doorToSite', { room: roomById(d.roomId)?.label ?? '' }) };
    return { kind: 'site', label: surface ? t('walk.siteSurface', { surface }) : t('walk.site') };
  }
}
