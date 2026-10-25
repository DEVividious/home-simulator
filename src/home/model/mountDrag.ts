// WALL OBJECT DRAGGING — one engine for everything that hangs on a wall: wall-mounted furniture and devices.
// Rules (docs/WALL_MOUNTED_OBJECT_PLACEMENT.md, docs/adr/0004):
//   1. WALL LOCK — during normal movement the object moves on the plane of ITS mounting surface; the pointer is
//      projected onto that plane, not onto "whatever happens to be under the pointer".
//   2. GRAB — the offset between the grab point and the object's reference point is constant: the object does not jump under the pointer.
//   3. LIMITED GAIN — the object's step does not exceed gainMax × the distance the same pointer movement covers on the plane
//      perpendicular to the view direction at the object's distance (with the camera looking along the wall a pixel does not turn
//      into metres); the excess is added to the grab.
//   4. TRANSFER — another surface becomes the host only when the pointer leaves the current one by a margin and points at
//      another surface at least that margin away (hysteresis both ways: no flicker at a corner).
//   5. SNAPPING HELPS — the raw position is stable; a snap candidate captures when close and releases farther away
//      (release); the grid is measured from the left corner of the wall.
// The drag state is a value (every move returns a new state) — nothing is written to the project. Pure TS.
import { t } from '../../i18n';
import { rotFacing } from './snapping';
import {
  distToSurface, mountWall, pickFromRay, pickOnSurface, planeHit, surfaceCoords, surfaceOfWall, surfacePoint, wallAt, wallFromPlan,
  type MountSurface, type PlanViewId,
} from './mount';
import type { LevelId, Vec2, Vec3, WallMount } from './types';
export type { WallMount } from './types';

/** shared metric values for dragging and snapping wall objects [m] */
export const MOUNT = {
  /** grid along the wall and vertically: normal and fine */
  gridFine: 0.01,
  /** alignment to other objects and openings: capture and release */
  alignCapture: 0.035, alignRelease: 0.055,
  /** largest object step relative to the pointer movement on the frontal plane at the object's distance */
  gainMax: 3,
  /** margin for transfer to another surface: min + a share of the object width, at most max */
  transferMin: 0.07, transferPerWidth: 0.1, transferMax: 0.25,
  /** gap between the object and the wall face (avoids z-fighting with the face) */
  wallGap: 0.005,
  /** button / key step: normal and fine */
  nudge: 0.05, nudgeFine: 0.01,
} as const;

/** object box on the wall: width along the wall, height, depth; anchor — what v refers to */
export interface MountBox {
  w: number; h: number; d: number;
  /** 'bottom' — v is the object's underside (furniture: mounting height), 'center' — v is the object's axis (devices) */
  anchor: 'bottom' | 'center';
  /** smallest distance of the object axis from the wall end (default: half the width) */
  edge?: number;
  /** smallest v and clearance below the ceiling (by default the object fits between floor and ceiling) */
  vMin?: number; topMargin?: number;
}
/** object rectangle on the surface (collisions, alignment) */
export interface MountRect { id: string; u0: number; u1: number; v0: number; v1: number; name?: string }
export const boxRect = (box: MountBox, u: number, v: number): Omit<MountRect, 'id'> => {
  const v0 = box.anchor === 'bottom' ? v : v - box.h / 2;
  return { u0: u - box.w / 2, u1: u + box.w / 2, v0, v1: v0 + box.h };
};

/** pointer: camera ray (3D, walk) or plan point (top view, 2D plan) */
export type MountPointer =
  | { kind: 'ray'; origin: Vec3; dir: Vec3; /** metres per pixel at 1 m from the camera (orthographic projection: constant metres per pixel, `ortho`) */ mPerPx: number; ortho?: boolean;
      screen: [number, number]; level: LevelId; visible?: (p: Vec3) => boolean; allLevels?: boolean }
  | { kind: 'plan'; q: Vec2; mPerPx: number; screen: [number, number]; view: PlanViewId };

export type MountAxes = 'uv' | 'u' | 'v';
export interface MountDragOptions {
  /** which coordinates the drag changes (devices: 'u' — height is changed by a separate handle) */
  axes?: MountAxes;
  /** grid step [m]; 0 — no grid */
  step?: number;
  /** alignment to other objects and openings */
  align?: boolean;
  /** other objects on the surface (excluding the dragged one) */
  others?: (s: MountSurface) => MountRect[];
  /** whether the object may move to another surface */
  transfer?: boolean;
  /** which surfaces accept the object on transfer (wall-mounted furniture: only room walls, not the facade);
   *  by default any */
  accept?: (s: MountSurface) => boolean;
  /**
   * Moving into ANOTHER room with a ray pointer (3D, walk): 'passage' (default) — only through a passage in the object's
   * wall that the object fits through; 'any' — onto any picked surface (devices: the planner shows the whole
   * level and moves the device onto the wall under the pointer, also in a neighbouring room).
   */
  rooms?: 'passage' | 'any';
}
export interface MountGuide { kind: 'u' | 'v'; value: number; why: 'object' | 'opening' | 'center' | 'start'; withId?: string }
interface Hold { value: number; why: MountGuide['why']; withId?: string }

export interface MountDrag {
  surface: MountSurface;
  box: MountBox;
  /** raw position of the reference point (without snapping): u — object axis along the wall, v — height */
  u: number; v: number;
  /** position after snapping — this is the result to show and save */
  out: { u: number; v: number };
  /** grab (pointer hit − object position); null — to be set at the next valid hit */
  grab: { du: number; dv: number } | null;
  screen: [number, number];
  hold: { u: Hold | null; v: Hold | null };
  guides: MountGuide[];
  /** position at grab time (height alignment candidate, restore on cancel) */
  start: { surfaceId: string; u: number; v: number; /** pointer target at that moment WITHOUT clamping to the wall bounds (when different from the position) */ aim?: { u: number; v: number } };
  /** how many times the object changed surface */
  transfers: number;
  /** the pointer is off the current surface and points at another one, but still too close to transfer (hint in the scene) */
  candidate: string | null;
  /** rooms the object has been in during this drag (start and each one it moved into) — it may return to them */
  visited: string[];
  /**
   * The ray pointer left the current surface (by the transfer margin) and points neither at a surface the object can
   * move to nor into its own space (floor, ceiling): the object stays clamped to its wall bounds, but the pointer
   * no longer shows anything (lawn, sky, the inside of an inaccessible room). Only when the drag may transfer the object;
   * devices: releasing in this state does not change the position.
   */
  away: boolean;
}

export const transferMargin = (w: number) => Math.min(MOUNT.transferMax, MOUNT.transferMin + w * MOUNT.transferPerWidth);
const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** position bounds of the object on the surface: the object entirely on the wall (along it) and between floor and ceiling */
export function clampMount(s: MountSurface, box: MountBox, u: number, v: number): { u: number; v: number } {
  const e = Math.min(box.edge ?? box.w / 2, s.length / 2), cu = clamp(u, e, s.length - e);
  // ceiling / slope: the lowest ceiling point over the object width
  const top = Math.min(s.heightAt(clamp(cu - box.w / 2, 0, s.length)), s.heightAt(cu), s.heightAt(clamp(cu + box.w / 2, 0, s.length))) - (box.topMargin ?? 0);
  const lo = box.vMin ?? (box.anchor === 'bottom' ? 0 : box.h / 2), hi = box.anchor === 'bottom' ? top - box.h : top - (box.topMargin === undefined ? box.h / 2 : 0);
  return { u: cu, v: clamp(v, lo, Math.max(lo, hi)) };
}

/** centre of the object box in LCS (for the distance from the camera) */
const centreOf = (s: MountSurface, box: MountBox, u: number, v: number): Vec3 => surfacePoint(s, u, box.anchor === 'bottom' ? v + box.h / 2 : v, box.d / 2);
function metresPerPixel(p: MountPointer, at: Vec3): number {
  if (p.kind === 'plan' || p.ortho) return p.mPerPx;
  return p.mPerPx * Math.hypot(at[0] - p.origin[0], at[1] - p.origin[1], at[2] - p.origin[2]);
}
/** pointer hit: (u, v) on the surface; `dist` — distance along the ray (plan: none) */
interface Hit { u: number; v: number | null; dist?: number }
/**
 * What the ray points at: the first visible mounting surface under the pointer (pickFromRay) in surface coordinates.
 * `floor` — the picked floor point when the surface was chosen by the "wall nearest to the picked floor spot" rule.
 */
interface Aim { surface: MountSurface; u: number; v: number | null; via: 'face' | 'nearest'; floor: Vec2 | null }
/**
 * Ray aim; plan — null. No current-wall hysteresis on the picking side: the transfer margin (transferTarget)
 * applies both ways, and corner hysteresis (HYST_RAY) would hide the neighbouring wall for the first centimetres past the corner
 * — the height would then come from the extension of the current wall plane, not from the visible surface.
 */
function aimOf(p: MountPointer): Aim | null {
  if (p.kind !== 'ray') return null;
  const pick = pickFromRay({ level: p.level, origin: p.origin, dir: p.dir, visible: p.visible, allLevels: p.allLevels }, 'wall', null);
  const on = pick && pick.kind === 'wall' ? pickOnSurface(pick) : null;
  return on && pick && pick.kind === 'wall' ? { ...on, via: pick.via, floor: pick.via === 'nearest' ? pick.q ?? null : null } : null;
}
/** whether the ray points into the space: its floor, ceiling, a face of its wall or (facade) the ground at the building */
function pointsInto(spaceId: string, p: MountPointer): boolean {
  if (p.kind !== 'ray') return false;
  return pickFromRay({ level: p.level, origin: p.origin, dir: p.dir, visible: p.visible, allLevels: p.allLevels }, 'area', null)?.room.id === spaceId;
}
/** intersection of the ray with the surface plane (plan — none) */
const planeOf = (s: MountSurface, p: MountPointer): Hit | null => (p.kind === 'ray' ? planeHit(s, p.origin, p.dir) : null);
/**
 * Pointer hit in surface coordinates. Ray: a point on the wall plane; when the pointer shows the FLOOR (the ray
 * crosses the wall plane only below the floor or not at all) — the wall point nearest to the picked floor spot, as in plan:
 * the ray extended below the floor would run along the wall the farther, the farther from it the pointer is. Plan: only u
 * (height unchanged).
 */
function hitOn(s: MountSurface, p: MountPointer, aim: Aim | null): Hit | null {
  if (p.kind === 'plan') return { u: surfaceCoords(s, p.q).u, v: null };
  const h = planeHit(s, p.origin, p.dir);
  if (aim?.floor && aim.surface.level === s.level && (!h || h.v < 0)) return { u: surfaceCoords(s, aim.floor).u, v: h ? h.v : null, dist: h?.dist };
  return h;
}

/** drag start: object on surface `s` at (u, v), pointer at the grab point */
export function beginMountDrag(s: MountSurface, u: number, v: number, box: MountBox, p: MountPointer): MountDrag {
  const h = hitOn(s, p, aimOf(p));
  return {
    surface: s, box, u, v, out: { u, v }, grab: h ? { du: h.u - u, dv: h.v === null ? 0 : h.v - v } : null, screen: p.screen,
    hold: { u: null, v: null }, guides: [], start: { surfaceId: s.id, u, v }, transfers: 0, candidate: null, visited: [s.spaceId], away: false,
  };
}
/**
 * View change during a drag (scene resize, camera animation, phone rotation) without pointer movement: the grab is
 * recomputed for the current object position — the object stays put instead of jumping to the "old" screen coordinates.
 */
export function reanchorMountDrag(d: MountDrag, p: MountPointer): MountDrag {
  const h = hitOn(d.surface, p, aimOf(p));
  return { ...d, grab: h ? { du: h.u - d.u, dv: h.v === null ? 0 : h.v - d.v } : null, screen: p.screen };
}

/** whether the hit lies in the clear opening of a passage the object fits through (then the pointer "looks" into the next room) */
function inPassage(s: MountSurface, h: { u: number; v: number | null }, box: MountBox, m: number): boolean {
  // the ray RUNS through the clear opening: hit between the reveals, above the floor and below the head (a hit below the floor is
  // pointing at the floor in front of the wall, not at the passage)
  return s.holes.some((x) => (x.kind === 'door' || x.kind === 'passage') && x.u1 - x.u0 >= box.w && h.u > x.u0 + m && h.u < x.u1 - m && (h.v === null || (h.v >= 0 && h.v < x.v1)));
}
/** the ray misses the surface by more than `m`: it does not hit its plane, or hits beyond the wall end, below the floor or above the ceiling */
const beyondSurface = (s: MountSurface, plane: Hit | null, m: number) => !plane || plane.u < -m || plane.u > s.length + m || (plane.v !== null && (plane.v < -m || plane.v > s.heightAt(clamp(plane.u, 0, s.length)) + m));
/** surface the pointer wants to move the object to (null — stay); `ready: false` — candidate still below
 *  the transfer margin. `plane` — intersection of the ray with the current surface plane, `aim` — what the ray points at */
function transferTarget(d: MountDrag, p: MountPointer, o: MountDragOptions, plane: Hit | null, aim: Aim | null): { surface: MountSurface; u: number; v: number | null; ready: boolean } | null {
  const s = d.surface, M = transferMargin(d.box.w);
  // the surface accepts the object: allowed for it and not shorter than it (the object must be entirely on the wall)
  const takes = (x: MountSurface) => x.length >= d.box.w - 1e-9 && (!o.accept || o.accept(x));
  if (p.kind === 'plan') {
    const cur = wallAt(s, d.u), pick = wallFromPlan(p.view, p.q, { roomId: s.spaceId, wallId: cur.wallId }), on = pick ? pickOnSurface(pick) : null;
    if (!on || on.surface.id === s.id || !takes(on.surface)) return null;
    // in plan: the new wall must be closer to the pointer than the current one by the margin
    return { surface: on.surface, u: on.u, v: null, ready: distToSurface(s, p.q) - distToSurface(on.surface, p.q) >= M };
  }
  const on = aim;
  if (!on || on.surface.id === s.id || !takes(on.surface)) return null;
  const other = on.surface.spaceId !== s.spaceId, been = other && d.visited.includes(on.surface.spaceId);
  // the object moves into ANOTHER room only through a passage in its wall that it fits through: the floor or a face of
  // another room visible below the wall, above it or beyond its end is not a target (the object does not pass through a solid wall).
  // It may return to a room it has already been in during this drag.
  if (other && !been && o.rooms !== 'any' && !(plane && inPassage(s, plane, d.box, 0))) return null;
  // RETURN: a wall face of a room the object has already been in lies closer to the camera than the current surface plane — the ray
  // stops on it (solid wall next to the door the object passed through), so the pointer is no longer on the current surface
  const front = been && on.via === 'face' && (!plane || (planeHit(on.surface, p.origin, p.dir)?.dist ?? Infinity) < (plane.dist ?? Infinity) - 1e-6);
  const beyond = (m: number) => beyondSurface(s, plane, m);
  const through = !!plane && inPassage(s, plane, d.box, M);
  // a pointer ON the current surface (also seen from behind, through a cut-away wall) does not point at any other: whatever the ray
  // hits farther behind it is neither a target nor a hint
  if (!(front || beyond(0) || (plane && inPassage(s, plane, d.box, 0)))) return null;
  if (on.floor) {
    // pointer on the FLOOR: as in plan — the new wall must be closer to the picked spot than the current one by the margin (the same margin
    // on the way back: pointer jitter on the corner bisector does not switch walls)
    return { surface: on.surface, u: on.u, v: on.v, ready: (front || through || beyond(0)) && distToSurface(s, on.floor) - distToSurface(on.surface, on.floor) >= M - 1e-9 };
  }
  const pt = surfacePoint(on.surface, on.u, 0);
  // off the current surface AND the spot on the new surface at least the margin away from the current one (corner: distance along the new wall)
  return { surface: on.surface, u: on.u, v: on.v, ready: (front || through || beyond(M)) && distToSurface(s, [pt[0], pt[1]]) >= M - 1e-9 };
}

/** alignment candidates on the surface for the object box */
function alignCandidates(s: MountSurface, box: MountBox, others: MountRect[], start: MountDrag['start'], want: { u: number; v: number }): { u: Hold[]; v: Hold[] } {
  const u: Hold[] = [{ value: s.length / 2, why: 'center' }], v: Hold[] = [];
  const bottom = box.anchor === 'bottom', toV = (edge: number, top: boolean) => (bottom ? (top ? edge - box.h : edge) : top ? edge - box.h / 2 : edge + box.h / 2);
  // axis lock by movement direction: moving mainly sideways holds the start height, changing mainly the height holds the sideways
  // position — small pointer jitter across the movement does not spoil the other coordinate, and movement along the axis is free from the first cm.
  // Reference point: the drag start, and after a transfer to another wall — the spot where the object landed on it
  // (height from before the transfer). At the reference point itself the height is held: the edge of an opening or another object
  // right next to it cannot capture it before the pointer shows the movement direction.
  // The direction is computed from POINTER movement (the target without clamping to the wall bounds), not from object movement: an object
  // standing at the wall end — also right after a transfer, while it waits for the pointer — still "moves sideways" and holds its height.
  if (start.surfaceId === s.id) {
    const from = start.aim ?? start, du = Math.abs(want.u - from.u), dv = Math.abs(want.v - from.v), still = du < 1e-6 && dv < 1e-6;
    if (still || du > 2 * dv) v.push({ value: start.v, why: 'start' });
    if (!still && dv > 2 * du) u.push({ value: start.u, why: 'start' });
  }
  for (const o of others) {
    const c = (o.u0 + o.u1) / 2;
    u.push({ value: c, why: 'object', withId: o.id }, { value: o.u1 + box.w / 2, why: 'object', withId: o.id }, { value: o.u0 - box.w / 2, why: 'object', withId: o.id },
      { value: o.u0 + box.w / 2, why: 'object', withId: o.id }, { value: o.u1 - box.w / 2, why: 'object', withId: o.id });
    v.push({ value: toV(o.v0, false), why: 'object', withId: o.id }, { value: toV(o.v1, true), why: 'object', withId: o.id }, { value: bottom ? (o.v0 + o.v1) / 2 - box.h / 2 : (o.v0 + o.v1) / 2, why: 'object', withId: o.id });
  }
  for (const h of s.holes) {
    u.push({ value: (h.u0 + h.u1) / 2, why: 'opening', withId: h.id });
    if (h.kind === 'window' || h.kind === 'glazing') v.push({ value: toV(h.v1, true), why: 'opening', withId: h.id }, { value: toV(h.v0, false), why: 'opening', withId: h.id });
  }
  return { u, v };
}
function snapAxis(raw: number, cands: Hold[], held: Hold | null): Hold | null {
  // capture when close, release farther away: the held candidate stays until the raw position moves away by alignRelease
  if (held && Math.abs(raw - held.value) <= MOUNT.alignRelease && cands.some((c) => c.why === held.why && c.withId === held.withId && Math.abs(c.value - held.value) < 1e-6)) return held;
  let best: Hold | null = null;
  for (const c of cands) if (Math.abs(raw - c.value) <= MOUNT.alignCapture && (!best || Math.abs(raw - c.value) < Math.abs(raw - best.value))) best = c;
  return best;
}
/** grid along the wall measured from the LEFT corner (end b of the run), vertically — from the floor */
export const gridU = (s: MountSurface, u: number, step: number) => (step > 0 ? s.length - Math.round((s.length - u) / step) * step : u);
export const gridV = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

function snapped(d: Pick<MountDrag, 'surface' | 'box' | 'u' | 'v' | 'hold' | 'start'>, o: MountDragOptions, axes: MountAxes, want: { u: number; v: number } = d): Pick<MountDrag, 'out' | 'hold' | 'guides'> {
  const s = d.surface, step = o.step ?? 0, guides: MountGuide[] = [];
  let hu: Hold | null = null, hv: Hold | null = null, u = d.u, v = d.v;
  if (o.align) {
    const c = alignCandidates(s, d.box, o.others?.(s) ?? [], d.start, want);
    if (axes !== 'v') hu = snapAxis(d.u, c.u, d.hold.u);
    if (axes !== 'u') hv = snapAxis(d.v, c.v, d.hold.v);
  }
  if (hu) { u = hu.value; guides.push({ kind: 'u', value: u, why: hu.why, withId: hu.withId }); } else if (axes !== 'v') u = gridU(s, d.u, step);
  if (hv) { v = hv.value; guides.push({ kind: 'v', value: v, why: hv.why, withId: hv.withId }); } else if (axes !== 'u') v = gridV(d.v, step);
  const c = clampMount(s, d.box, u, v);
  return { out: { u: round(c.u), v: round(c.v) }, hold: { u: hu, v: hv }, guides };
}

/** pointer move: new drag state (raw position, result after snapping, possible transfer) */
export function moveMountDrag(d: MountDrag, p: MountPointer, o: MountDragOptions = {}): MountDrag {
  const axes = p.kind === 'plan' && (o.axes ?? 'uv') === 'uv' ? 'u' : o.axes ?? 'uv';
  let s = d.surface, grab = d.grab, transfers = d.transfers, candidate: string | null = null, away = false;
  const aim = aimOf(p);
  let h = hitOn(s, p, aim);
  // ---- transfer to another surface
  if (o.transfer !== false && axes !== 'v') {
    const plane = planeOf(s, p), t = transferTarget(d, p, o, plane, aim);
    // pointer off the current surface and without a target: it points neither at it (the floor in front of it), nor at any surface the object can
    // move to, nor into the object's space (the room ceiling in eye-level view: the object follows the pointer horizontally)
    away = p.kind === 'ray' && !t && aim?.surface.id !== s.id && beyondSurface(s, plane, transferMargin(d.box.w)) && !pointsInto(s.spaceId, p);
    if (t && t.ready) {
      s = t.surface;
      h = hitOn(s, p, aim) ?? { u: t.u, v: null };
      // height — the one the object HAS on screen (result after axis lock and snapping), not the raw pointer position, which
      // drifts by millimetres when moving sideways
      // the grab along the wall carries over to the new wall within the object BOX: a pointer that was next to the object when grabbing
      // (drag threshold with fast movement, hit area of a small device) did not hold any part of it — the object lands
      // under the pointer with its nearest edge instead of staying that gap away from it
      const along = clamp(grab?.du ?? 0, -d.box.w / 2, d.box.w / 2), c = clampMount(s, d.box, h.u - along, d.out.v);
      // the axis lock carries over to the new wall: further movement along it holds the height from before the transfer
      d = { ...d, surface: s, u: c.u, v: c.v, hold: { u: null, v: null }, start: { surfaceId: s.id, u: c.u, v: c.v, aim: { u: h.u - along, v: c.v } }, visited: d.visited.includes(s.spaceId) ? d.visited : [...d.visited, s.spaceId] };
      // the grab ALONG the wall stays (the same part of the object under the pointer): the object clamped to the new wall waits at its end
      // until the pointer reaches the grab point — as at a wall end without a transfer. The vertical grab is recomputed (height kept).
      grab = { du: along, dv: h.v === null ? grab?.dv ?? 0 : h.v - c.v };
      transfers++;
    } else if (t) {
      candidate = t.surface.id;
      // the pointer passed the wall end and lies on another surface (still before the transfer margin): the height comes from the point
      // on THAT surface — extending the current wall plane past the corner would give a different height than the visible one
      if (h && t.v !== null && (h.u < 0 || h.u > s.length)) h = { u: h.u, v: t.v + (t.surface.floorZ - s.floorZ) };
    }
  }
  // ---- movement on the current surface
  const travel = Math.hypot(p.screen[0] - d.screen[0], p.screen[1] - d.screen[1]);
  const limit = MOUNT.gainMax * metresPerPixel(p, centreOf(s, d.box, d.u, d.v)) * travel;
  let du = 0, dv = 0, limited = false, target: { u: number; v: number } | null = null, want: { u: number; v: number } | null = null;
  if (h && grab) {
    // target = hit − grab, CLAMPED to the wall bounds: an object stopped at the wall end waits until the pointer returns to the grab
    // point (the grab does not change); the step limit applies only to the distance the object can actually travel
    want = { u: axes === 'v' ? d.u : h.u - grab.du, v: axes === 'u' || h.v === null ? d.v : h.v - grab.dv };
    const t = target = clampMount(s, d.box, want.u, want.v);
    du = t.u - d.u; dv = t.v - d.v;
    const len = Math.hypot(du, dv);
    if (transfers === d.transfers && len > limit + 1e-9) { const k = limit / len; du *= k; dv *= k; limited = true; }
  } else if (h && !grab) {
    grab = { du: h.u - d.u, dv: h.v === null ? 0 : h.v - d.v };          // first valid reading after a gap: new grab, no movement
  } else if (p.kind === 'ray' && !away) {
    // the ray misses the plane (looks along the wall / away from it): move in the direction it points, with the step limit.
    // When the pointer points at nothing (`away`), the object stays and keeps the grab — when the pointer returns to the wall it is under it again.
    const a = p.dir[0] * s.dir[0] + p.dir[1] * s.dir[1], b = p.dir[2], n = Math.hypot(axes === 'v' ? 0 : a, axes === 'u' ? 0 : b) || 1;
    du = axes === 'v' ? 0 : (a / n) * limit; dv = axes === 'u' ? 0 : (b / n) * limit; limited = true;
  }
  const c = clampMount(s, d.box, d.u + du, d.v + dv);
  // limited step: the excess goes into the grab — a change of pointer direction immediately changes the object's direction.
  // Only on the axis where the step was shortened: an object standing at the wall end (target clamped, no movement along it) still
  // waits for the pointer to return to the grab point, even if the vertical movement was limited at the same time.
  if (limited) {
    const short = (a: 'u' | 'v') => !target || Math.abs(target[a] - c[a]) > 1e-9;
    grab = !h ? null : { du: !grab || short('u') ? h.u - c.u : grab.du, dv: h.v === null ? grab?.dv ?? 0 : !grab || short('v') ? h.v - c.v : grab.dv };
  }
  const next = { ...d, surface: s, u: c.u, v: c.v, grab, screen: p.screen, transfers, candidate, away };
  return { ...next, ...snapped(next, o, axes, want ?? next) };
}

/** nudge by a step (arrow keys, ± buttons): without a pointer, within the surface bounds; the step is applied to the current result */
export function nudgeMount(s: MountSurface, box: MountBox, u: number, v: number, du: number, dv: number): { u: number; v: number } {
  const c = clampMount(s, box, u + du, v + dv);
  return { u: round(c.u), v: round(c.v) };
}

// ------------------------------------------------------------------ placement assessment (warnings do not block)
export type MountIssue = 'beyond' | 'door' | 'window' | 'overlap' | 'ceiling';
export interface MountWarning { kind: MountIssue; level: 'warn' | 'info'; text: string; withId?: string }
const overlap = (a: Omit<MountRect, 'id'>, b: Omit<MountRect, 'id'>, eps = 0.005) => a.u0 < b.u1 - eps && a.u1 > b.u0 + eps && a.v0 < b.v1 - eps && a.v1 > b.v0 + eps;
/** warnings for the object box at (u, v): beyond the wall, openings, other objects, ceiling */
export function checkMount(s: MountSurface, box: MountBox, u: number, v: number, others: MountRect[] = []): MountWarning[] {
  const r = boxRect(box, u, v), out: MountWarning[] = [];
  if (r.u0 < -0.005 || r.u1 > s.length + 0.005) out.push({ kind: 'beyond', level: 'warn', text: t('mount.warn.beyond') });
  for (const h of s.holes) {
    if (!overlap(r, h)) continue;
    if (h.kind === 'door' || h.kind === 'passage') out.push({ kind: 'door', level: 'warn', text: t('mount.warn.door'), withId: h.id });
    else out.push({ kind: 'window', level: 'warn', text: t('mount.warn.window'), withId: h.id });
  }
  for (const o of others) if (overlap(r, o)) out.push({ kind: 'overlap', level: 'warn', text: t('mount.warn.overlap', { name: o.name ?? t('mount.otherObject') }), withId: o.id });
  if (r.v1 > Math.min(s.heightAt(clamp(r.u0, 0, s.length)), s.heightAt(clamp(r.u1, 0, s.length))) + 0.005) out.push({ kind: 'ceiling', level: 'warn', text: t('mount.warn.ceiling') });
  return out;
}

// ------------------------------------------------------------------ mount record ↔ world position
/** position on the surface → mount record */
export function toWallMount(s: MountSurface, u: number, v: number): WallMount {
  const w = wallAt(s, u);
  return { wallId: w.wallId, u: w.t, height: round(v) };
}
/** mount record → surface and position on it (null — the wall does not exist in the project) */
export function fromWallMount(spaceId: string, m: WallMount): { surface: MountSurface; u: number; v: number } | null {
  const s = surfaceOfWall(spaceId, m.wallId), w = mountWall(spaceId, m.wallId);
  if (!s || !w) return null;
  return { surface: s, u: (s.segments.find((g) => g.wallId === m.wallId)?.u0 ?? 0) + Math.max(0, Math.min(w.length, m.u)), v: m.height };
}
/** world position of furniture for a surface position: footprint centre, rotation (back to the wall), underside height */
export function mountPose(s: MountSurface, box: MountBox, u: number, v: number): { x: number; y: number; rot: number; elevation: number } {
  const p = surfacePoint(s, u, 0, MOUNT.wallGap + box.d / 2);
  return { x: round(p[0]), y: round(p[1]), rot: round(rotFacing(s.normal), 3), elevation: round(box.anchor === 'bottom' ? v : v - box.h / 2) };
}
/**
 * Surface that furniture at a given world position hangs on: the back of the item at the wall face (within `tol`), the front facing
 * the interior. null — the item does not hang on any room wall (old record, item moved away from the wall).
 */
export function surfaceOfPose(surfaces: MountSurface[], box: MountBox, f: { x: number; y: number; rot: number; elevation: number }, tol = 0.12): { surface: MountSurface; u: number; v: number } | null {
  const th = (f.rot * Math.PI) / 180, front: Vec2 = [-Math.sin(th), Math.cos(th)];
  let best: { surface: MountSurface; u: number; v: number; gap: number } | null = null;
  for (const s of surfaces) {
    if (front[0] * s.normal[0] + front[1] * s.normal[1] < 0.985) continue;      // front aligned with the wall normal (within about 10°)
    const c = surfaceCoords(s, [f.x, f.y]), gap = Math.abs(c.n - box.d / 2 - MOUNT.wallGap);
    if (gap > tol || c.u < -1e-3 || c.u > s.length + 1e-3) continue;
    if (!best || gap < best.gap) best = { surface: s, u: c.u, v: box.anchor === 'bottom' ? f.elevation : f.elevation + box.h / 2, gap };
  }
  return best && { surface: best.surface, u: best.u, v: best.v };
}
