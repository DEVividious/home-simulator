// The derived building: levels, rooms with their walls and openings, stairs and shell parameters — computed from the
// package's `building` block by a pure function and cached by the identity of that block (ADR 0023). The app adapts it
// through derived() (src/home/model/building.ts); tools and the plugin call it directly. Translated text (wall labels) is
// added by the app, never here.
import { flatCeiling, roofCeiling, type CeilingProfile } from './ceiling.ts';
import { ccw, centroid, dist, norm, pointInPolygon, round, segDist, sub } from './geom2d.ts';
import { atticPlanes, roofFromAttic, roofModel, type RoofModel, type RoofPiece } from './roof.ts';
import type { DoorDef, LevelId, ProjectPackage, Rect, RoomJson, RoomKind, ShellSpec, StairDef, Vec2 } from '../package/types.ts';

export type BuildingData = ProjectPackage['building'];

export type HoleKind = 'door' | 'passage' | 'window' | 'glazing';

/** opening in a room wall in wall coordinates: t along the wall from a [m], z above the room floor [m] */
export interface WallHole {
  id: string;
  kind: HoleKind;
  t0: number;
  t1: number;
  z0: number;
  z1: number;
  /** non-rectangular outline (e.g. glazing under a sloped roof) in (t, z) */
  polygon?: Vec2[];
}

export interface RoomWall {
  id: string; // `${roomId}-w${index}`
  index: number;
  roomId: string;
  a: Vec2;
  b: Vec2;
  length: number;
  dir: Vec2; // a → b
  inward: Vec2; // normal pointing into the room
  holes: WallHole[];
}

export interface Room {
  id: string;
  /** name from the project sources (plan label) */
  name: string;
  /** name shown in the UI */
  label: string;
  kind: RoomKind;
  tags: string[];
  level: LevelId;
  floorZ: number;
  area: number;
  areaData: number;
  idSource: string;
  polygon: Vec2[]; // counter-clockwise
  bbox: [number, number, number, number];
  center: Vec2;
  rectangular: boolean;
  ceiling: CeilingProfile;
  walls: RoomWall[];
  doors: { id: string | null; wallId: string; t0: number; t1: number; leaf: number; passage: boolean; center: Vec2 }[];
  windows: { id: string; wallId: string; t0: number; t1: number; sill: number; head: number; kind: HoleKind }[];
  stairOpening: [number, number, number, number] | null;
  roofWindows: { id: string; rect: [number, number, number, number] }[];
}

/** door opening height when the data does not give one [m] */
export const DEFAULT_DOOR_HEIGHT = 2.05;
/** level section height above its floor when the data does not give one [m] */
export const DEFAULT_CUT_HEIGHT = 2.3;
/** room outline offset used to draw wall mass on the plan (half the wall thickness) when the data does not give one [m] */
export const DEFAULT_PLAN_WALL_OFFSET = 0.13;
/** generated shell parameters when the package does not give them [m] */
export const SHELL_DEFAULTS: ShellSpec = { exteriorWall: 0.3, slab: 0.25 };

export interface Level {
  id: LevelId; name: string; floorZ: number;
  /** section height above the floor [m] */
  cutHeight: number;
  /** room outline offset on the plan — wall mass [m] */
  planWallOffset: number;
}

export interface Building {
  /** levels from the lowest — the order follows floor heights, not a list */
  levels: Level[];
  levelById: Map<LevelId, Level>;
  rooms: Room[];
  roomById: Map<string, Room>;
  roomsByLevel: Map<LevelId, Room[]>;
  doors: DoorDef[];
  stairs: StairDef[];
  /** generated shell parameters (defaults + the package's `shell`) */
  shell: ShellSpec;
  /** the roof (building.roof, or derived from attic ceilings); null — no roof: the top level is closed by a flat slab */
  roof: RoofModel | null;
}

/** whether edge (a → b) lies on the line X = c / Y = c */
const onLine = (a: Vec2, b: Vec2, axis: 'X' | 'Y', c: number, tol = 2e-3) => (axis === 'X' ? Math.abs(a[0] - c) < tol && Math.abs(b[0] - c) < tol : Math.abs(a[1] - c) < tol && Math.abs(b[1] - c) < tol);

const EVERYWHERE: Rect = [-1e6, -1e6, 1e6, 1e6];
/** the ceiling profile of a room: flat; under the roof of its level; or an attic ceiling (its own two planes — the single-ridge formula of packages written before the roof) */
function ceilingFor(r: RoomJson, poly: Vec2[], roof: RoofModel | null, roofWindows: Rect[]): CeilingProfile {
  const c = r.ceiling, under = roof?.byLevel(r.level) ?? [];
  if (c.kind === 'attic') {
    const own: RoofPiece = { id: `${r.id}-attic`, kind: 'part', level: r.level, region: EVERYWHERE, inner: EVERYWHERE, cover: EVERYWHERE, planes: atticPlanes(c) };
    return roofCeiling([own], c.flat_z!, r.floor_z, poly, roofWindows);
  }
  if (c.kind === 'roof') return roofCeiling(under, c.flat_z!, r.floor_z, poly, roofWindows);
  return under.length ? roofCeiling(under, c.z!, r.floor_z, poly, roofWindows) : flatCeiling(c.z!, r.floor_z, poly);
}

function buildRoom(r: RoomJson, roof: RoofModel | null): Room {
  const poly = ccw(r.polygon.map((p) => [p[0], p[1]] as Vec2));
  const ceiling = ceilingFor(r, poly, roof, r.roof_windows.map((w) => [w.plan_rect[0], w.plan_rect[1], w.plan_rect[2], w.plan_rect[3]]));
  const walls: RoomWall[] = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], d = norm(sub(b, a));
    return { id: `${r.id}-w${i + 1}`, index: i + 1, roomId: r.id, a, b, length: round(dist(a, b), 4), dir: d, inward: [-d[1], d[0]] as Vec2, holes: [] };
  });
  const tOn = (w: RoomWall, p: Vec2) => (p[0] - w.a[0]) * w.dir[0] + (p[1] - w.a[1]) * w.dir[1];
  const span = (w: RoomWall, axis: 'X' | 'Y', s0: number, s1: number): [number, number] | null => {
    const pa: Vec2 = axis === 'X' ? [s0, w.a[1]] : [w.a[0], s0], pb: Vec2 = axis === 'X' ? [s1, w.a[1]] : [w.a[0], s1];
    const t0 = Math.max(0, Math.min(tOn(w, pa), tOn(w, pb))), t1 = Math.min(w.length, Math.max(tOn(w, pa), tOn(w, pb)));
    return t1 - t0 > 0.02 ? [round(t0), round(t1)] : null;
  };
  const doors: Room['doors'] = [];
  for (const d of r.doors) {
    // the room edge crosses the door gap: a segment along axis `along` on one of the `across` lines
    for (const w of walls) {
      const along = d.along, other = along === 'X' ? 'Y' : 'X';
      const hit = d.across.find((c) => onLine(w.a, w.b, other, c));
      if (hit === undefined) continue;
      const s = span(w, along, d.from_, d.to);
      if (!s) continue;
      const passage = !d.door_id;
      // passage without a door: height from the data, otherwise up to the ceiling at the wall; door: height from the data or the typical 2.05 m
      const z1 = passage ? round(Math.min(d.height ?? Infinity, ceiling.heightAt(...w.a), ceiling.heightAt(...w.b))) : d.height ?? DEFAULT_DOOR_HEIGHT;
      w.holes.push({ id: d.door_id ?? `passage ${w.id}`, kind: passage ? 'passage' : 'door', t0: s[0], t1: s[1], z0: 0, z1 });
      const mid = (s[0] + s[1]) / 2;
      doors.push({ id: d.door_id, wallId: w.id, t0: s[0], t1: s[1], leaf: d.leaf ?? round(s[1] - s[0] - 0.1), passage, center: [w.a[0] + w.dir[0] * mid, w.a[1] + w.dir[1] * mid] });
    }
  }
  const windows: Room['windows'] = [];
  for (const o of r.openings) {
    for (const w of walls) {
      if (!onLine(w.a, w.b, o.plane_axis, o.inner)) continue;
      const along = o.plane_axis === 'X' ? 'Y' : 'X';
      const s = span(w, along, Math.min(o.from_, o.to), Math.max(o.from_, o.to));
      if (!s) continue;
      if (o.polygon_YZ) {
        // glazing with a polygonal outline: outline (Y, Z) → (t, z above the floor), clipped to the wall
        const pts = o.polygon_YZ.map((q) => [round(Math.min(w.length, Math.max(0, tOn(w, [w.a[0], q[0]])))), round(q[1] - r.floor_z)] as Vec2);
        const z0 = Math.min(...pts.map((p) => p[1])), z1 = Math.max(...pts.map((p) => p[1]));
        w.holes.push({ id: o.id, kind: 'glazing', t0: s[0], t1: s[1], z0, z1, polygon: pts });
        windows.push({ id: o.id, wallId: w.id, t0: s[0], t1: s[1], sill: z0, head: z1, kind: 'glazing' });
      } else {
        const sill = round((o.sill_z ?? 0) - r.floor_z), head = round((o.head_z ?? 2.4) - r.floor_z);
        const kind: HoleKind = sill < 0.05 ? 'glazing' : 'window';
        w.holes.push({ id: o.id, kind, t0: s[0], t1: s[1], z0: sill, z1: head });
        windows.push({ id: o.id, wallId: w.id, t0: s[0], t1: s[1], sill, head, kind });
      }
    }
  }
  for (const w of walls) w.holes.sort((p, q) => p.t0 - q.t0);
  const [x0, y0, x1, y1] = r.bbox;
  return {
    id: r.id, name: r.name, label: r.label ?? r.name, kind: r.kind ?? 'room', tags: r.tags ?? [], level: r.level, floorZ: r.floor_z, area: r.area, areaData: r.area_data, idSource: r.id_source,
    polygon: poly, bbox: [x0, y0, x1, y1], center: centroid(poly), rectangular: r.rectangular, ceiling, walls, doors, windows,
    stairOpening: r.stair_opening ? [r.stair_opening[0], r.stair_opening[1], r.stair_opening[2], r.stair_opening[3]] : null,
    roofWindows: r.roof_windows.map((w) => ({ id: w.id, rect: [w.plan_rect[0], w.plan_rect[1], w.plan_rect[2], w.plan_rect[3]] })),
  };
}

const NO_STAIRS: StairDef[] = [];
const cache = new WeakMap<BuildingData, Building>();

/** the derived building of a package's `building` block — computed once per block (by identity) */
export function building(data: BuildingData): Building {
  const hit = cache.get(data);
  if (hit) return hit;
  const src = data.rooms, shell = { ...SHELL_DEFAULTS, ...data.shell };
  const attic = data.roof ? null : roofFromAttic(src.rooms, shell.exteriorWall);
  const roof = data.roof ? roofModel(data.roof) : attic ? roofModel(attic, true) : null;
  const levels: Level[] = Object.entries(src.levels).map(([id, l]) => ({ id, name: l.name, floorZ: l.floor_z, cutHeight: l.cut_height ?? DEFAULT_CUT_HEIGHT, planWallOffset: l.plan_wall_offset ?? DEFAULT_PLAN_WALL_OFFSET })).sort((a, b) => a.floorZ - b.floorZ);
  const rooms = src.rooms.map((r) => buildRoom(r, roof));
  const roomsByLevel = new Map<LevelId, Room[]>(levels.map((l) => [l.id, rooms.filter((r) => r.level === l.id)]));
  const b: Building = {
    levels, levelById: new Map(levels.map((l) => [l.id, l])), rooms, roomById: new Map(rooms.map((r) => [r.id, r])), roomsByLevel,
    doors: data.doors, stairs: data.stairs ?? NO_STAIRS, shell, roof,
  };
  cache.set(data, b);
  return b;
}

export const roomsOfLevel = (b: Building, level: LevelId): Room[] => b.roomsByLevel.get(level) ?? [];

/** room containing point (x, y) on the given level */
export function roomAt(b: Building, level: LevelId, p: Vec2): Room | null {
  return roomsOfLevel(b, level).find((r) => pointInPolygon(p, r.polygon, 1e-6)) ?? null;
}

/** level from height z: the highest one whose floor lies below the midpoint to the next level */
export function levelAtZ(b: Building, z: number): LevelId {
  const L = b.levels;
  let cur = L[0];
  for (let i = 1; i < L.length; i++) if (z > (L[i - 1].floorZ + L[i].floorZ) / 2) cur = L[i];
  return cur.id;
}

/** nearest wall of a room and the point's distance from it */
export function nearestWall(room: Room, p: Vec2): { wall: RoomWall; d: number; t: number } {
  let best = { wall: room.walls[0], d: Infinity, t: 0 };
  for (const w of room.walls) { const s = segDist(p, w.a, w.b); if (s.d < best.d) best = { wall: w, d: s.d, t: s.t * w.length }; }
  return best;
}

/** absolute ceiling height of a room at plan point (x, y) */
export const ceilingAt = (room: Room, x: number, y: number): number => room.floorZ + room.ceiling.heightAt(x, y);

/** whether stairs arrive at the level from a lower one (opening in the floor / slab) */
export const stairArrivesAt = (b: Building, level: LevelId): boolean => b.stairs.some((s) => s.toLevel === level);
