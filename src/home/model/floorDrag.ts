// DRAGGING A FREESTANDING ITEM. The item moves on the floor, but the pointer is projected onto a horizontal plane
// through the GRAB POINT — the point of the item the user actually grabbed — not onto the floor. Same rules as for wall
// objects (model/mountDrag.ts, docs/WALL_MOUNTED_OBJECT_PLACEMENT.md):
//   1. GRAB — the offset between the pointer hit and the item position is constant: the grabbed point stays under the pointer.
//   2. GRAB PLANE — a ray passing through the item hits the floor further away, behind the item, so steering on the floor
//      multiplies the motion by (camera height / (camera height − grab height)): about 1.2 in the room top view, 1.3 at eye
//      level when grabbing a seat, over ten when grabbing a tall cabinet, and above eye level the ray does not hit at all.
//   3. LIMITED GAIN — when the grab plane is seen edge-on (grab close to eye height), one vertical pixel corresponds to
//      metres in depth; the item step does not exceed gainMax × the pointer travel on the frontal plane at the grab distance,
//      the excess goes into the grab. When the ray does not hit the plane at all (pointer above its horizon), the item moves
//      away towards the pointer with the same limit.
// The drag state is a value (RAW position — snapping and room bounds are applied by the scene on every move). Pure TS.
import type { MountPointer } from './mountDrag';
import type { Vec2, Vec3 } from './types';

export const FLOOR_DRAG = {
  /** largest item step relative to the pointer motion on the frontal plane at the grab point distance (like MOUNT.gainMax) */
  gainMax: 3,
} as const;

export interface FloorDrag {
  /** raw item position (outline centre, LCS) — without snapping */
  x: number; y: number;
  /** grab plane height (LCS Z) */
  z: number;
  /** grab (pointer hit on the grab plane − item position); null — to be set at the next valid hit */
  grab: Vec2 | null;
  /** grabbed point of the item relative to its position — constant for the whole drag; the camera distance is measured from it
   *  (gain limit). After a limited step the grab points to the spot under the pointer, which may lie metres behind the item. */
  anchor: Vec2;
  screen: [number, number];
}

/** grab plane point under the pointer (null — ray parallel to the plane or the plane behind the ray origin) */
function hitOn(p: MountPointer, z: number): Vec2 | null {
  if (p.kind === 'plan') return p.q;
  if (Math.abs(p.dir[2]) < 1e-9) return null;
  const t = (z - p.origin[2]) / p.dir[2];
  return t > 1e-6 ? [p.origin[0] + p.dir[0] * t, p.origin[1] + p.dir[1] * t] : null;
}
function metresPerPixel(p: MountPointer, at: Vec3): number {
  if (p.kind === 'plan' || p.ortho) return p.mPerPx;
  return p.mPerPx * Math.hypot(at[0] - p.origin[0], at[1] - p.origin[1], at[2] - p.origin[2]);
}

/** drag start: item at `pos`, grab at height `z` (the item point under the pointer), pointer at the grab point */
export function beginFloorDrag(pos: Vec2, z: number, p: MountPointer): FloorDrag {
  const h = hitOn(p, z);
  const grab: Vec2 | null = h ? [h[0] - pos[0], h[1] - pos[1]] : null;
  return { x: pos[0], y: pos[1], z, grab, anchor: grab ?? [0, 0], screen: p.screen };
}
/** view change without pointer motion (a panel narrowed the scene, the camera moved): re-grab at the current position — the item stays */
export function reanchorFloorDrag(d: FloorDrag, p: MountPointer): FloorDrag {
  const h = hitOn(p, d.z);
  return { ...d, grab: h ? [h[0] - d.x, h[1] - d.y] : null, screen: p.screen };
}

/**
 * Grab plane height change during a drag (a ceiling device moves under a ceiling of a different height): the grab
 * stays, position = point of the NEW plane under the pointer − grab — the grabbed point is still under the pointer. Without a hit
 * on the new plane only its height changes.
 */
export function liftFloorDrag(d: FloorDrag, z: number, p: MountPointer): FloorDrag {
  const h = hitOn(p, z);
  return h && d.grab ? { ...d, z, x: h[0] - d.grab[0], y: h[1] - d.grab[1] } : { ...d, z };
}

/** pointer move: new raw item position */
export function moveFloorDrag(d: FloorDrag, p: MountPointer): FloorDrag {
  const h = hitOn(p, d.z);
  const travel = Math.hypot(p.screen[0] - d.screen[0], p.screen[1] - d.screen[1]);
  const limit = FLOOR_DRAG.gainMax * metresPerPixel(p, [d.x + d.anchor[0], d.y + d.anchor[1], d.z]) * travel;
  let dx = 0, dy = 0, grab = d.grab, limited = false;
  if (h && grab) {
    dx = h[0] - grab[0] - d.x; dy = h[1] - grab[1] - d.y;
    const len = Math.hypot(dx, dy);
    if (len > limit + 1e-9) { const k = limit / len; dx *= k; dy *= k; limited = true; }
  } else if (h && !grab) {
    grab = [h[0] - d.x, h[1] - d.y];                                          // first valid hit after a gap: new grab, no motion
  } else if (p.kind === 'ray') {
    // the ray misses the grab plane (pointer above its horizon): the item moves away towards the pointer
    const n = Math.hypot(p.dir[0], p.dir[1]);
    if (n > 1e-9) { dx = (p.dir[0] / n) * limit; dy = (p.dir[1] / n) * limit; }
    limited = true;
  }
  const x = d.x + dx, y = d.y + dy;
  // limited step: the excess goes into the grab — a change of pointer direction immediately changes the item's direction
  if (limited) grab = h ? [h[0] - x, h[1] - y] : null;
  return { ...d, x, y, grab, screen: p.screen };
}
