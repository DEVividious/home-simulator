// WALL-SURFACE PLACEMENT ENGINE (WallMountedDevicePlacement): the single source of truth about WHERE a device under the pointer
// lands — in plan (2D point) and in 3D (camera ray). The device is not "tied" to a wall:
// on every pointer move the engine picks the best valid wall (any room of the level, the facade), projects the position
// onto it and returns a ready point record (roomId, wallId, positionAlongWall, heightAFFL, orientation). Going around a corner
// or into another room is simply a different result of the next call — no "change wall" step.
// HYSTERESIS: the current wall is kept until a new candidate is clearly better (plan: closer by HYST_PLAN,
// 3D: the pointer passed the corner by HYST_RAY) — the device does not flicker between two walls at a corner.
// The module is generic: it works for every catalog device (model/devices.ts) with WALL or CEILING mounting; it knows no React,
// three.js or stores — tests without a browser (src/home/tests/elPlacement.test.ts).
import { t } from '../../i18n';
import { DEVICES } from './devices';
import {
  EL_TYPES, elRoom, EXT, measure, placeFree, pointWarnings, snapAlong, snapHeight, wallRuns,
  type CoordContext, type ElectricalPlan, type ElPoint, type ElRoom, type ElType, type ElWall, type Placement,
} from './electrical';
import { pointInPolygon } from './geom2d';
import { doorHoleAt, EXTERIOR_HEIGHT, pickFromRay, spaceAtPlan, wallFromPlan, type PlanViewId, type RayPointer, type Surface, type WallRef } from './mount';
import type { RoomWall } from './rooms';
import type { LevelId, Vec2 } from './types';

// picking the place under the pointer (plan and camera ray) — shared mounting-surface engine (model/mount.ts)
export { HYST_PLAN, HYST_RAY, REACH, wallFromPlan, wallRefOf, type PlanViewId, type RayPointer, type Surface, type WallRef } from './mount';
/** room (not exterior) containing the plan point */
export const roomAtPlan = (view: PlanViewId, q: Vec2): ElRoom | null => spaceAtPlan(view, q);
const mountOf = (type: ElType): 'wall' | 'area' => (DEVICES[type].mountType === 'WALL' ? 'wall' : 'area');
/** place under the pointer in plan for a device of the given mounting: a wall or a point in a room (ceiling) / on the site */
export function surfaceFromPlan(view: PlanViewId, q: Vec2, type: ElType, cur: WallRef | null = null): Surface | null {
  if (mountOf(type) === 'wall') return wallFromPlan(view, q, cur);
  const room = roomAtPlan(view, q);
  if (room) return { kind: 'area', room, q };
  // outside the rooms: a site point — only in the site plan and on the site-exit level (project with a site) and only OUTSIDE
  // the building outline. Inside the wall thickness there is neither ceiling nor ground: otherwise a lamp dropped inside a wall would become
  // an "Outside" point in the middle of the building
  const ext = elRoom(EXT);
  return ext && (view === 'SITE' || view === ext.level) && !pointInPolygon(q, ext.polygon) ? { kind: 'area', room: ext, q } : null;
}
/**
 * Aim point of a DRAGGED device in plan. The pointer holds the SYMBOL, and the symbol is drawn `offset` metres into the room from
 * the mounting point — so the pointer itself lies closer to the neighbouring wall than the device (near a corner 8 px of movement would move
 * a socket to the other wall). The aim point is the pointer moved towards the device's CURRENT wall by the symbol offset — at most up to the
 * wall itself (1 cm in front of it), never beyond: while the pointer is on the room side, the device does not pass through the wall (a partition
 * is about 11.5 cm — a few pixels of drift), and once the pointer itself crosses the wall, its position decides. Movement along the wall
 * carries over to the device 1 : 1, equally in both directions.
 */
export function dragAim(q: Vec2, cur: WallRef | null, offset: number): Vec2 {
  const wall = cur && offset > 0 ? elRoom(cur.roomId)?.walls.find((w) => w.id === cur.wallId) : null;
  if (!wall) return q;
  const d = (q[0] - wall.a[0]) * wall.inward[0] + (q[1] - wall.a[1]) * wall.inward[1], s = Math.max(0, Math.min(offset, d - 0.01));
  return [q[0] - wall.inward[0] * s, q[1] - wall.inward[1] * s];
}
/**
 * Place of a dragged device in plan: `q` — the pointer holding the symbol, `offset` — symbol offset from the mounting point
 * (0 — ceiling device / site point). After moving to another wall the offset is measured from that wall — the position along
 * the new wall falls under the pointer, and the new wall is the "current" one (no flicker at a corner).
 */
export function surfaceFromDrag(view: PlanViewId, q: Vec2, type: ElType, cur: WallRef | null, offset: number): Surface | null {
  const s = surfaceFromPlan(view, dragAim(q, cur, offset), type, cur);
  if (!s || s.kind !== 'wall' || (cur && s.room.id === cur.roomId && s.wall.id === cur.wallId)) return s;
  const next: WallRef = { roomId: s.room.id, wallId: s.wall.id };
  return surfaceFromPlan(view, dragAim(q, next, offset), type, next) ?? s;
}
/** place picked by the camera ray for a device of the given mounting (wall face / floor / ceiling) */
export const surfaceFromRay = (p: RayPointer, type: ElType, cur: WallRef | null = null): Surface | null => pickFromRay(p, mountOf(type), cur);

// ------------------------------------------------------------------ position record
/** largest device axis height at a given spot on the wall (below the ceiling / slope) */
export const maxHeightAt = (room: ElRoom, wall: ElWall, t: number) => (room.exterior ? EXTERIOR_HEIGHT : Math.max(0.1, room.ceilingAt(wall.a[0] + wall.dir[0] * t + wall.inward[0] * 0.05, wall.a[1] + wall.dir[1] * t + wall.inward[1] * 0.05) - 0.05));
/**
 * Point record for the picked place: wall device — distance along the wall snapped to the `step` grid (measured from the
 * left corner), height KEPT (`height`) and clamped to the ceiling; ceiling device — the plan point. null — the place does not match
 * the mounting type.
 */
export function placementOn(s: Surface, type: ElType, height: number, step = 0): Placement | null {
  if (DEVICES[type].mountType === 'WALL') {
    if (s.kind !== 'wall') return null;
    const t = snapAlong(s.room, s.wall, s.t, step);
    return { roomId: s.room.id, wallId: s.wall.id, positionAlongWall: t, heightAFFL: snapHeight(Math.max(0.05, Math.min(maxHeightAt(s.room, s.wall, t), height)), 0), orientation: 'wall' };
  }
  if (s.kind !== 'area') return null;
  return placeFree(s.room, s.q, type, step);
}
/**
 * Device axis height range AT ITS SPOT [m]: 5 cm above the floor … 5 cm below the ceiling / slope (facade and site — usable facade
 * height). Dragging, the ↕ handle and the device card (typed number, [−] / [+], quick values) share the same bounds.
 */
export function heightRange(p: Pick<ElPoint, 'roomId' | 'wallId' | 'positionAlongWall' | 'x' | 'y'>): [number, number] {
  const room = elRoom(p.roomId), wall = room?.walls.find((w) => w.id === p.wallId);
  if (!room || room.exterior) return [0.05, EXTERIOR_HEIGHT];
  return [0.05, wall ? maxHeightAt(room, wall, p.positionAlongWall) : Math.max(0.1, room.ceilingAt(p.x ?? 0, p.y ?? 0) - 0.05)];
}
/** whether the position belongs to the 3D view's level (null — walk: every level is visible); facade and site — the site-exit level */
export const placementOnLevel = (at: Pick<Placement, 'roomId'>, level: LevelId | null): boolean => level === null || elRoom(at.roomId)?.level === level;
/** height from a ray hit on the wall (↕ handle in 3D) */
export const heightFromHit = (room: ElRoom, wall: ElWall, t: number, z: number, step = 0) => snapHeight(Math.max(0.05, Math.min(maxHeightAt(room, wall, t), z - room.floorZ)), step);

// ------------------------------------------------------------------ eye-level view: start
/** vertical field of view of the eye-level view [°] — as in walk mode */
export const EYE_LEVEL_FOV = 70;
/**
 * Initial pitch of the eye-level view [rad, negative — down]: the socket mounting line (`line` = 30 cm above the floor) on a wall
 * `dist` away must be in frame, about 60% of half the frame height below the centre (above the phone's bottom toolbar). From far away
 * the view is almost level (−0.05); from close up lower, at most −0.6. A constant −0.05 at 1.35 m from the wall would leave the socket and its
 * preview below the bottom edge of the screen.
 */
export function eyeLevelPitch(dist: number, eye: number, fovDeg: number, line = 0.3): number {
  const down = Math.atan2(eye - line, Math.max(0.2, dist)), half = (fovDeg * Math.PI) / 360;
  return -Math.min(0.6, Math.max(0.05, down - Math.atan(0.6 * Math.tan(half))));
}

// ------------------------------------------------------------------ validation (non-blocking warnings)
export type CheckLevel = 'ok' | 'warn' | 'error';
export interface PlacementCheck { level: CheckLevel; messages: string[] }
const worst = (a: CheckLevel, b: CheckLevel): CheckLevel => (a === 'error' || b === 'error' ? 'error' : a === 'warn' || b === 'warn' ? 'warn' : 'ok');
/** distance of the device from the wall run ends and from opening edges [m] */
function edgeClearance(at: Placement): number {
  const m = measure({ ...at, type: 'socket-1' } as ElPoint);
  if (!m || !m.wall || m.fromLeft === null) return Infinity;
  let c = Math.min(m.fromLeft, m.fromRight!);
  for (const h of (m.wall as RoomWall).holes ?? []) if (at.heightAFFL > h.z0 - 0.05 && at.heightAFFL < h.z1 + 0.05) c = Math.min(c, Math.abs(at.positionAlongWall - h.t0), Math.abs(at.positionAlongWall - h.t1));
  return c;
}
/**
 * Place assessment: 'error' — the device cannot sensibly be placed here (door opening), 'warn' — worth reconsidering (window, edge,
 * another device, door leaf, built-in furniture). Nothing is moved or blocked automatically except in a door opening.
 */
export function checkPlacement(plan: ElectricalPlan, at: Placement, type: ElType, ctx: CoordContext | null, ignoreId: string | null = null): PlacementCheck {
  const out: PlacementCheck = { level: 'ok', messages: [] };
  const add = (level: CheckLevel, text: string) => { out.level = worst(out.level, level); if (!out.messages.includes(text)) out.messages.push(text); };
  if (at.orientation !== 'wall' || !at.wallId) return out;
  const room = elRoom(at.roomId), wall = room?.walls.find((w) => w.id === at.wallId);
  if (!room || !wall) { add('error', t('elPlacement.dragOntoWall')); return out; }
  const dev = DEVICES[type], half = dev.footprint / 2;
  if (doorHoleAt(wall, at.positionAlongWall, at.heightAFFL)) add('error', t('elPlacement.inDoorway'));
  const hole = (wall as RoomWall).holes?.find((h) => h.kind !== 'door' && h.kind !== 'passage' && at.positionAlongWall > h.t0 && at.positionAlongWall < h.t1 && at.heightAFFL > h.z0 && at.heightAFFL < h.z1);
  if (hole) add('warn', t('elPlacement.onWindow'));
  if (out.level !== 'error' && edgeClearance(at) < Math.max(0.05, half)) add('warn', t('elPlacement.nearEdge'));
  // another device at the same spot on the wall (the same wall run of the room)
  const me = measure({ ...at, type } as ElPoint);
  if (me?.run) for (const p of plan.points) {
    if (p.id === ignoreId || p.roomId !== at.roomId || p.orientation !== 'wall') continue;
    const m = measure(p);
    if (!m?.run || m.run.index !== me.run.index) continue;
    const gap = (dev.footprint + DEVICES[p.type].footprint * (p.type === 'board' ? (p.width ?? 0.6) / 0.6 : 1)) / 2;
    if (Math.abs(m.fromLeft! - me.fromLeft!) < gap && Math.abs(p.heightAFFL - at.heightAFFL) < 0.09) { add('warn', t('elPlacement.overlapsDevice', { device: DEVICES[p.type].short.toLowerCase() })); break; }
  }
  if (ctx) for (const w of pointWarnings({ ...at, id: '', type, modules: EL_TYPES[type].modules, label: '', smartHome: 'none', source: 'user', status: 'planned' } as ElPoint, ctx)) {
    if (w.kind === 'door') add('warn', t('elPlacement.doorLeaf'));
    else if (w.kind === 'furniture') add('warn', t('elPlacement.behindBuiltIn', { detail: w.text.includes('(') ? ` ${w.text.slice(w.text.lastIndexOf('('))}` : '' }));
    else if (w.kind === 'sanitary') add('warn', t('elPlacement.sanitary'));
  }
  return out;
}

// ------------------------------------------------------------------ alignment helpers
export interface AlignGuide { kind: 'height' | 'along'; /** height [m] or distance from the left corner [m] */ value: number; withId: string }
/**
 * Alignment to other devices on the same wall (wall run): a common height (horizontal "align at 30 cm" line) and a common
 * vertical axis (device above / below another). `snap` — which dimensions may be pulled in (when moving along the wall the height
 * does not change, so only the vertical axis is pulled; the ↕ handle pulls the height).
 */
export function alignPlacement(plan: ElectricalPlan, at: Placement, type: ElType, ignoreId: string | null, snap: { height?: boolean; along?: boolean } = {}, tol = 0.035): { at: Placement; guides: AlignGuide[] } {
  if (at.orientation !== 'wall' || !at.wallId) return { at, guides: [] };
  const me = measure({ ...at, type } as ElPoint);
  if (!me?.run || !me.wall) return { at, guides: [] };
  let out = at, bestH = tol, bestA = tol, gh: AlignGuide | null = null, ga: AlignGuide | null = null;
  for (const p of plan.points) {
    if (p.id === ignoreId || p.roomId !== at.roomId || p.orientation !== 'wall') continue;
    const m = measure(p);
    if (!m?.run || m.run.index !== me.run.index) continue;
    const dh = Math.abs(p.heightAFFL - at.heightAFFL), da = Math.abs(m.fromLeft! - me.fromLeft!);
    // common height: without permission to snap, the line appears only when the heights are already equal
    if (da > 0.02 && dh <= bestH + 1e-9 && (dh <= 1e-6 || snap.height)) { bestH = dh; out = { ...out, heightAFFL: p.heightAFFL }; gh = { kind: 'height', value: p.heightAFFL, withId: p.id }; }
    // common vertical axis: the same distance from the left corner of the run
    if (snap.along && dh > 0.05 && da <= bestA + 1e-9) {
      let r = me.run.length - m.fromLeft!, tw: ElWall | null = null;
      for (const w of me.run.walls) { if (r <= w.length + 1e-9) { tw = w; break; } r -= w.length; }
      if (!tw) continue;
      bestA = da; out = { ...out, wallId: tw.id, positionAlongWall: Math.round(Math.max(0, Math.min(tw.length, r)) * 1000) / 1000 }; ga = { kind: 'along', value: m.fromLeft!, withId: p.id };
    }
  }
  return { at: out, guides: [gh, ga].filter((g): g is AlignGuide => !!g) };
}

// ------------------------------------------------------------------ user-facing description (no technical data)
export interface PlacementInfo {
  /** room name ("Living room") or "Outside" */
  place: string;
  /** distance from the nearer wall corner [m] and which corner it is looking from the room; null — ceiling / free point */
  along: number | null; from: 'left' | 'right' | null;
  /** height above the finished floor [m]; null — ceiling */
  height: number | null;
  /** dimension segment in plan: from the corner to the device (LCS) */
  dim: [Vec2, Vec2] | null;
  /** current wall (the whole collinear run) — for highlighting */
  run: [Vec2, Vec2] | null;
}
export function placementInfo(at: Placement, type: ElType, roomName: (id: string) => string): PlacementInfo {
  const m = measure({ ...at, type } as ElPoint), room = elRoom(at.roomId);
  const place = !room ? '' : room.exterior ? t('mount.outside') : roomName(room.id);
  if (!m || m.fromLeft === null || !m.run) return { place, along: null, from: null, height: at.orientation === 'ceiling' ? null : at.heightAFFL, dim: null, run: null };
  const left = m.fromLeft <= m.fromRight!, corner = left ? m.run.b : m.run.a;
  return { place, along: Math.min(m.fromLeft, m.fromRight!), from: left ? 'left' : 'right', height: at.heightAFFL, dim: [corner, [m.pos[0], m.pos[1]]], run: [m.run.a, m.run.b] };
}
/** wall run the position lies on (for highlighting in 3D): ends and the normal into the room */
export function runOf(at: Pick<Placement, 'roomId' | 'wallId'>): { a: Vec2; b: Vec2; inward: Vec2; room: ElRoom } | null {
  const room = elRoom(at.roomId), run = room && at.wallId ? wallRuns(room.id).find((r) => r.walls.some((w) => w.id === at.wallId)) : null;
  return room && run ? { a: run.a, b: run.b, inward: run.inward, room } : null;
}
