// Furniture snapping (plan, metres): to a wall (item back, with rotation alignment), to a corner (two perpendicular walls),
// edge / centre alignment with other items, optionally a grid. ALT in the UI → options.enabled = false (no snapping).
import { angleDiff, axes, dot, normDeg, obbAabb, round, supportAlong, type OBB } from '@home-sim/core/model/geom2d';
import type { HomeRoom, RoomWall } from './rooms';
import type { Vec2 } from './types';

export interface SnapOptions {
  enabled: boolean;
  wall: boolean;
  corner: boolean;
  align: boolean;
  /** grid step [m] (0 = no grid) */
  grid: number;
  /** wall snapping range [m] */
  threshold: number;
  /** alignment range with other items [m] */
  alignThreshold: number;
  /** gap at the wall [m] (avoids penetrating the wall face) */
  gap: number;
}

export const DEFAULT_SNAP: SnapOptions = { enabled: true, wall: true, corner: true, align: true, grid: 0, threshold: 0.15, alignThreshold: 0.05, gap: 0.005 };

export interface SnapGuide { a: Vec2; b: Vec2; kind: 'wall' | 'corner' | 'align' | 'grid' }
export interface SnapResult { x: number; y: number; rot: number; guides: SnapGuide[]; walls: string[]; aligned: string[] }

/** rotation at which the item front (local +y) faces direction n (back to the wall with inward normal n) */
export const rotFacing = (n: Vec2) => normDeg((Math.atan2(-n[0], n[1]) * 180) / Math.PI);

/** rounds the rotation to a step (walls are usually parallel to the LCS axes, so 15° / 45° / 90° steps match the walls) */
export const snapRotation = (rot: number, step = 15) => normDeg(Math.round(rot / step) * step);

/** item distance from the wall (nearest outline point; > 0 — inside the room) and whether the item's projection along the wall overlaps it */
function wallGap(o: OBB, w: RoomWall): { s: number; overlaps: boolean } {
  const s = dot([o.c[0] - w.a[0], o.c[1] - w.a[1]], w.inward) - supportAlong(o, w.inward);
  const t = dot([o.c[0] - w.a[0], o.c[1] - w.a[1]], w.dir), half = supportAlong(o, w.dir);
  return { s, overlaps: t + half > 0.02 && t - half < w.length - 0.02 };
}

export interface SnapItem { w: number; d: number; placement: 'wall' | 'free' | 'under' | 'floor' }

export function snapPlacement(room: HomeRoom, item: SnapItem, pos: { x: number; y: number; rot: number }, others: { id: string; obb: OBB }[], opt: SnapOptions = DEFAULT_SNAP): SnapResult {
  let c: Vec2 = [pos.x, pos.y], rot = normDeg(pos.rot);
  const res: SnapResult = { x: c[0], y: c[1], rot, guides: [], walls: [], aligned: [] };
  if (!opt.enabled) return res;
  const obb = (): OBB => ({ c, hw: item.w / 2, hd: item.d / 2, rot });
  const constrained: Vec2[] = [];
  if (opt.wall) {
    // nearest wall (within range); wall-side items turn their back to the wall, others align parallel to it
    const cand = room.walls.map((w) => ({ w, ...wallGap(obb(), w) })).filter((q) => q.overlaps && q.s > -opt.threshold && q.s < opt.threshold).sort((p, q) => Math.abs(p.s) - Math.abs(q.s));
    const first = cand[0];
    if (first) {
      const face = rotFacing(first.w.inward);
      if (item.placement === 'wall' && Math.abs(angleDiff(rot, face)) <= 25) rot = face;
      else { const k = Math.round(angleDiff(rot, face) / 90) * 90; if (Math.abs(angleDiff(rot, face + k)) <= 8) rot = normDeg(face + k); }
      const g = wallGap(obb(), first.w);
      c = [c[0] + first.w.inward[0] * (opt.gap - g.s), c[1] + first.w.inward[1] * (opt.gap - g.s)];
      constrained.push(first.w.inward);
      res.walls.push(first.w.id);
      res.guides.push({ a: first.w.a, b: first.w.b, kind: 'wall' });
      if (opt.corner) {
        const second = room.walls.map((w) => ({ w, ...wallGap(obb(), w) }))
          .filter((q) => q.w.id !== first.w.id && Math.abs(dot(q.w.inward, first.w.inward)) < 0.1 && q.overlaps && Math.abs(q.s) < opt.threshold)
          .sort((p, q) => Math.abs(p.s) - Math.abs(q.s))[0];
        if (second) {
          c = [c[0] + second.w.inward[0] * (opt.gap - second.s), c[1] + second.w.inward[1] * (opt.gap - second.s)];
          constrained.push(second.w.inward);
          res.walls.push(second.w.id);
          res.guides.push({ a: second.w.a, b: second.w.b, kind: 'corner' });
        }
      }
    }
  }
  const free = (axis: Vec2) => !constrained.some((n) => Math.abs(dot(n, axis)) > 0.9);
  const axisAligned = (r: number) => Math.abs(angleDiff(r, Math.round(r / 90) * 90)) < 0.5;
  let snappedX = false, snappedY = false;
  if (opt.align && axisAligned(rot)) {
    const me = obbAabb(obb());
    for (const [k, axis] of [[0, [1, 0]], [1, [0, 1]]] as [0 | 1, Vec2][]) {
      if (!free(axis)) continue;
      let best: { d: number; id: string; at: number; other: [number, number, number, number] } | null = null;
      const mine = k === 0 ? [me[0], (me[0] + me[2]) / 2, me[2]] : [me[1], (me[1] + me[3]) / 2, me[3]];
      for (const o of others) {
        if (!axisAligned(o.obb.rot)) continue;
        const ob = obbAabb(o.obb);
        const theirs = k === 0 ? [ob[0], (ob[0] + ob[2]) / 2, ob[2]] : [ob[1], (ob[1] + ob[3]) / 2, ob[3]];
        for (const m of mine) for (const t of theirs) {
          const d = t - m;
          if (Math.abs(d) <= opt.alignThreshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, id: o.id, at: t, other: ob };
        }
      }
      if (best) {
        c = k === 0 ? [c[0] + best.d, c[1]] : [c[0], c[1] + best.d];
        const nb = obbAabb(obb()), lo = Math.min(nb[1 - k], best.other[1 - k]), hi = Math.max(nb[3 - k], best.other[3 - k]);
        res.guides.push({ a: k === 0 ? [best.at, lo] : [lo, best.at], b: k === 0 ? [best.at, hi] : [hi, best.at], kind: 'align' });
        if (!res.aligned.includes(best.id)) res.aligned.push(best.id);
        if (k === 0) snappedX = true; else snappedY = true;
      }
    }
  }
  if (opt.grid > 0) {
    if (free([1, 0]) && !snappedX) c = [Math.round(c[0] / opt.grid) * opt.grid, c[1]];
    if (free([0, 1]) && !snappedY) c = [c[0], Math.round(c[1] / opt.grid) * opt.grid];
  }
  res.x = round(c[0], 5); res.y = round(c[1], 5); res.rot = round(rot, 4);
  return res;
}

/**
 * Wall collision while dragging: an item entering a wall is pushed back inside (gap) — applies to walls
 * along which the item's projection overlaps the wall and the item centre is on the inner side of the face. When the item does not fit
 * in the room (pushed from opposite walls), the position stays and the panel shows a warning (no blocking).
 */
export function keepInside(room: HomeRoom, item: Pick<SnapItem, 'w' | 'd'>, pos: { x: number; y: number; rot: number }, gap = DEFAULT_SNAP.gap): { x: number; y: number; pushed: string[] } {
  let c: Vec2 = [pos.x, pos.y];
  const pushed: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const w of room.walls) {
      const o: OBB = { c, hw: item.w / 2, hd: item.d / 2, rot: pos.rot };
      const g = wallGap(o, w), centre = dot([c[0] - w.a[0], c[1] - w.a[1]], w.inward);
      if (!g.overlaps || centre <= 0 || g.s >= -1e-6) continue;
      const k = gap - g.s;
      c = [c[0] + w.inward[0] * k, c[1] + w.inward[1] * k];
      if (!pushed.includes(w.id)) pushed.push(w.id);
      moved = true;
    }
    if (!moved) break;
  }
  // item larger than the room — the pushes cancel out: position unchanged (warning in the panel)
  const o: OBB = { c, hw: item.w / 2, hd: item.d / 2, rot: pos.rot };
  if (room.walls.some((w) => { const g = wallGap(o, w); return g.overlaps && g.s < -0.01 && dot([c[0] - w.a[0], c[1] - w.a[1]], w.inward) > 0; })) return { x: pos.x, y: pos.y, pushed: [] };
  return { x: round(c[0], 5), y: round(c[1], 5), pushed };
}

/** local item axes (for tests and UI) */
export const furnitureAxes = axes;
