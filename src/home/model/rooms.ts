// Levels and rooms of the project — from the project package (project().building.rooms; format: docs/PROJECT_PACKAGE_SPEC.md).
// Here: room walls (outline edges) with openings (doors, passages, windows, irregular glazing), the ceiling profile
// (flat, or sloped with a flat top), point membership. The number of levels and rooms comes from the data only.
// The model is computed lazily, once per project package (project/active.ts → derived).
import { fmtM, t } from '../../i18n';
import { derived } from '../../project/active';
import { ccw, centroid, dist, norm, pointInPolygon, round, segDist, sub } from './geom2d';
import type { LevelId, Vec2 } from './types';

interface DoorJson { along: 'X' | 'Y'; from_: number; to: number; across: number[]; width: number; door_id: string | null; leaf: number | null; height: number | null }
interface OpeningJson { id: string; kind: string; plane_axis: 'X' | 'Y'; inner: number; from_: number; to: number; sill_z?: number; head_z?: number; polygon_YZ?: number[][] }
/** attic: the ridge runs along X at y = ridge_y, or along Y at x = ridge_x; the ceiling falls by `slope` per metre away from it */
interface CeilingJson { kind: 'flat' | 'attic'; z?: number; flat_z?: number; ridge_y?: number; ridge_x?: number; z_at_ridge?: number; slope?: number }
/** room kind: default finishes, icons, plan colours — from the project data (field `kind`), never from the name */
export type RoomKind = 'bath' | 'kitchen' | 'garage' | 'tech' | 'hall' | 'bed' | 'living' | 'office' | 'storage' | 'room';
/** room record in the package data */
export interface RoomJson {
  id: string; name: string; level: LevelId; floor_z: number; area: number; area_data: number; id_source: string; bbox: number[]; polygon: number[][];
  rectangular: boolean; ceiling: CeilingJson; stair_opening: number[] | null; doors: DoorJson[]; openings: OpeningJson[]; roof_windows: { id: string; plan_rect: number[] }[];
  /** display name (default: `name`) */
  label?: string;
  kind?: RoomKind;
  /** tags that drive engine behaviour (e.g. "garage" — vehicle fitting, "kitchen" — kitchen units) */
  tags?: string[];
}

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
  /** user-facing description: "Wall 2 · 3.63 m · window" */
  label: string;
}

export interface CeilingProfile {
  kind: 'flat' | 'attic';
  /** ceiling height above the room floor at LCS point (x, y) */
  heightAt: (x: number, y: number) => number;
  /** sloped-ceiling parameters (absolute z): flat top, ridge, slope; the ridge runs along X (ridgeY) or along Y (ridgeX) */
  flatZ?: number;
  ridgeY?: number;
  ridgeX?: number;
  zAtRidge?: number;
  slope?: number;
}

export interface HomeRoom {
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
export interface Level {
  id: LevelId; name: string; floorZ: number;
  /** section height above the floor [m] */
  cutHeight: number;
  /** room outline offset on the plan — wall mass [m] */
  planWallOffset: number;
}

function ceilingOf(c: CeilingJson, floorZ: number): CeilingProfile {
  if (c.kind === 'flat') { const z = c.z!; return { kind: 'flat', heightAt: () => z - floorZ }; }
  const flat = c.flat_z!, zr = c.z_at_ridge!, k = c.slope!;
  if (c.ridge_x !== undefined) { const rx = c.ridge_x; return { kind: 'attic', flatZ: flat, ridgeX: rx, zAtRidge: zr, slope: k, heightAt: (x) => Math.min(flat, zr - k * Math.abs(x - rx)) - floorZ }; }
  const ry = c.ridge_y!;
  return { kind: 'attic', flatZ: flat, ridgeY: ry, zAtRidge: zr, slope: k, heightAt: (_x, y) => Math.min(flat, zr - k * Math.abs(y - ry)) - floorZ };
}

/** whether edge (a → b) lies on the line X = c / Y = c */
const onLine = (a: Vec2, b: Vec2, axis: 'X' | 'Y', c: number, tol = 2e-3) => (axis === 'X' ? Math.abs(a[0] - c) < tol && Math.abs(b[0] - c) < tol : Math.abs(a[1] - c) < tol && Math.abs(b[1] - c) < tol);

function buildRoom(r: RoomJson): HomeRoom {
  const poly = ccw(r.polygon.map((p) => [p[0], p[1]] as Vec2));
  const ceiling = ceilingOf(r.ceiling, r.floor_z);
  const walls: RoomWall[] = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], d = norm(sub(b, a));
    return { id: `${r.id}-w${i + 1}`, index: i + 1, roomId: r.id, a, b, length: round(dist(a, b), 4), dir: d, inward: [-d[1], d[0]] as Vec2, holes: [], label: '' };
  });
  const tOn = (w: RoomWall, p: Vec2) => (p[0] - w.a[0]) * w.dir[0] + (p[1] - w.a[1]) * w.dir[1];
  const span = (w: RoomWall, axis: 'X' | 'Y', s0: number, s1: number): [number, number] | null => {
    const pa: Vec2 = axis === 'X' ? [s0, w.a[1]] : [w.a[0], s0], pb: Vec2 = axis === 'X' ? [s1, w.a[1]] : [w.a[0], s1];
    const t0 = Math.max(0, Math.min(tOn(w, pa), tOn(w, pb))), t1 = Math.min(w.length, Math.max(tOn(w, pa), tOn(w, pb)));
    return t1 - t0 > 0.02 ? [round(t0), round(t1)] : null;
  };
  const doors: HomeRoom['doors'] = [];
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
  const windows: HomeRoom['windows'] = [];
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
  for (const w of walls) {
    w.holes.sort((p, q) => p.t0 - q.t0);
    const tags = [...new Set(w.holes.map((h) => (h.kind === 'door' ? t('rooms.hole.door') : h.kind === 'passage' ? t('rooms.hole.passage') : t('rooms.hole.window'))))];
    w.label = `${t('rooms.wallLabel', { index: w.index, length: fmtM(w.length) })}${tags.length ? ' · ' + tags.join(', ') : ''}`;
  }
  const [x0, y0, x1, y1] = r.bbox;
  return {
    id: r.id, name: r.name, label: r.label ?? r.name, kind: r.kind ?? 'room', tags: r.tags ?? [], level: r.level, floorZ: r.floor_z, area: r.area, areaData: r.area_data, idSource: r.id_source,
    polygon: poly, bbox: [x0, y0, x1, y1], center: centroid(poly), rectangular: r.rectangular, ceiling, walls, doors, windows,
    stairOpening: r.stair_opening ? [r.stair_opening[0], r.stair_opening[1], r.stair_opening[2], r.stair_opening[3]] : null,
    roofWindows: r.roof_windows.map((w) => ({ id: w.id, rect: [w.plan_rect[0], w.plan_rect[1], w.plan_rect[2], w.plan_rect[3]] })),
  };
}

interface RoomsModel { levels: Level[]; levelById: Map<LevelId, Level>; rooms: HomeRoom[]; byId: Map<string, HomeRoom>; byLevel: Map<LevelId, HomeRoom[]> }
const model = derived((p): RoomsModel => {
  const data = p.building.rooms;
  // levels from the lowest — the order follows floor heights, not a list in code
  const levels: Level[] = Object.entries(data.levels).map(([id, l]) => ({ id, name: l.name, floorZ: l.floor_z, cutHeight: l.cut_height ?? DEFAULT_CUT_HEIGHT, planWallOffset: l.plan_wall_offset ?? DEFAULT_PLAN_WALL_OFFSET })).sort((a, b) => a.floorZ - b.floorZ);
  const rooms = data.rooms.map(buildRoom);
  const byLevel = new Map<LevelId, HomeRoom[]>(levels.map((l) => [l.id, rooms.filter((r) => r.level === l.id)]));
  return { levels, levelById: new Map(levels.map((l) => [l.id, l])), rooms, byId: new Map(rooms.map((r) => [r.id, r])), byLevel };
});

/** project levels from the lowest */
export const allLevels = (): Level[] => model().levels;
export const levelById = (id: LevelId | null | undefined): Level | null => (id ? model().levelById.get(id) ?? null : null);
export const levelName = (id: LevelId): string => model().levelById.get(id)?.name ?? id;
/** lowest level (navigation start, ground level) */
export const baseLevel = (): Level => model().levels[0];
/** level index in order from the lowest (−1: unknown) */
export const levelIndex = (id: LevelId): number => model().levels.findIndex((l) => l.id === id);
/** all rooms of the project */
export const allRooms = (): HomeRoom[] => model().rooms;
export const roomById = (id: string | null | undefined): HomeRoom | null => (id ? model().byId.get(id) ?? null : null);
export const roomsOfLevel = (level: LevelId): HomeRoom[] => model().byLevel.get(level) ?? [];
export const wallById = (room: HomeRoom, wallId: string) => room.walls.find((w) => w.id === wallId) ?? null;
/** rooms with a tag (e.g. "garage") */
export const roomsWithTag = (tag: string): HomeRoom[] => model().rooms.filter((r) => r.tags.includes(tag));

/** room containing point (x, y) on the given level */
export function roomAt(level: LevelId, p: Vec2): HomeRoom | null {
  return roomsOfLevel(level).find((r) => pointInPolygon(p, r.polygon, 1e-6)) ?? null;
}

/** level from height z (LCS): the highest one whose floor lies below the midpoint to the next level */
export function levelAtZ(z: number): LevelId {
  const L = model().levels;
  let cur = L[0];
  for (let i = 1; i < L.length; i++) if (z > (L[i - 1].floorZ + L[i].floorZ) / 2) cur = L[i];
  return cur.id;
}

/** nearest wall and the point's distance from it */
export function nearestWall(room: HomeRoom, p: Vec2): { wall: RoomWall; d: number; t: number } {
  let best = { wall: room.walls[0], d: Infinity, t: 0 };
  for (const w of room.walls) { const s = segDist(p, w.a, w.b); if (s.d < best.d) best = { wall: w, d: s.d, t: s.t * w.length }; }
  return best;
}

