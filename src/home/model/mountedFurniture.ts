// WALL-MOUNTED FURNITURE as wall objects: catalog items with `mount: 'wall'` (TV, mirror, shelf, wall lamp, wall
// cabinet). The position of such an item is stored relative to the wall (FurniturePlacement.mount); x / y / rot / elevation are derived
// values — only this module writes them. Shared engine: model/mount.ts (surfaces) and model/mountDrag.ts (dragging).
import { elevationOf, isWallMounted, resolveDims, type CatalogItem } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { distToSurface, mountSurfaces, surfaceCoords, type MountSurface } from './mount';
import type { FurnitureWarning, WarningKind } from './collision';
import { boxRect, checkMount, clampMount, fromWallMount, mountPose, nudgeMount, surfaceOfPose, toWallMount, type MountBox, type MountIssue, type MountRect } from './mountDrag';
import type { Arrangement, FurniturePlacement, RoomInterior } from './types';
import { updateFurniture } from './interiors';

type Dimsish = Pick<FurniturePlacement, 'variant' | 'dims'> | null | undefined;
/** furniture box on the wall (v = underside height) */
export function furnitureBox(item: CatalogItem, p: Dimsish): MountBox {
  const d = resolveDims(item, p);
  return { w: d.w, h: d.h, d: d.d, anchor: 'bottom' };
}
export interface MountedAt { surface: MountSurface; u: number; v: number; box: MountBox }

/** where the item hangs: from the mount record; without one — from the world position (older documents); null — the item does not hang on a wall */
export function mountedAt(roomId: string, item: CatalogItem, p: FurniturePlacement): MountedAt | null {
  if (!isWallMounted(item)) return null;
  const box = furnitureBox(item, p);
  const m = p.mount ? fromWallMount(roomId, p.mount) : null;
  const at = m ?? surfaceOfPose(mountSurfaces(roomId), box, { x: p.x, y: p.y, rot: p.rot, elevation: elevationOf(item, p) });
  return at && { ...at, box };
}
/** nearest room surface — for a wall item moved away from the wall (the first move hangs it back) */
export function nearestMount(roomId: string, item: CatalogItem, p: FurniturePlacement): MountedAt | null {
  const box = furnitureBox(item, p), S = mountSurfaces(roomId);
  if (!S.length) return null;
  const s = S.reduce((a, b) => (distToSurface(b, [p.x, p.y]) < distToSurface(a, [p.x, p.y]) ? b : a));
  const c = clampMount(s, box, surfaceCoords(s, [p.x, p.y]).u, elevationOf(item, p));
  return { surface: s, ...c, box };
}
/** furniture record patch after placing on a surface: mount record + derived world position */
export function mountedPatch(s: MountSurface, box: MountBox, u: number, v: number): Pick<FurniturePlacement, 'x' | 'y' | 'rot' | 'elevation' | 'mount'> {
  return { ...mountPose(s, box, u, v), mount: toWallMount(s, u, v) };
}
/** the item with a mount record if it is a wall object hanging on a wall (added from the catalog, layout proposal, copy) */
export function attachMounted(roomId: string, p: FurniturePlacement): FurniturePlacement {
  const item = itemById(p.catalogId), at = item ? mountedAt(roomId, item, { ...p, mount: null }) : null;
  return at ? { ...p, ...mountedPatch(at.surface, at.box, at.u, at.v) } : p;
}
/**
 * New wall object from the catalog at `u` on the surface: the catalog default height CLAMPED to the wall (knee wall,
 * sloped ceiling) — the preview of the dragged card, the preview warnings and the record of the dropped object all get the same position.
 * Without the clamp the object would hang above the wall and the first move would drop it below the slope.
 */
export function mountedDrop(s: MountSurface, item: CatalogItem, p: Dimsish, u: number, others: MountRect[] = []): { patch: ReturnType<typeof mountedPatch>; warnings: FurnitureWarning[] } {
  const box = furnitureBox(item, p), c = nudgeMount(s, box, u, item.defaultElevation ?? 1, 0, 0);
  return { patch: mountedPatch(s, box, c.u, c.v), warnings: mountWarnings(s, box, c.u, c.v, others) };
}
/** copy of a wall object: gap from the original and search step along the wall [m] */
const DUPLICATE = { gap: 0.1, step: 0.05 };
/**
 * Spot for a copy of a wall object: the same wall and height, closest to the original (first towards the right corner),
 * entirely on the wall and WITHOUT overlapping another wall object — `others` are all objects on the surface, including the original.
 * First spots without any warning (the copy does not cover a door or window if that can be avoided), then any without
 * overlap. null — no room on the wall. (Considering all objects, not only the original, keeps successive copies from stacking.)
 */
export function duplicateSpot(s: MountSurface, box: MountBox, u: number, v: number, others: MountRect[]): { u: number; v: number } | null {
  const fits = (cu: number, clean: boolean) => {
    const c = clampMount(s, box, cu, v);
    if (Math.abs(c.u - cu) > 1e-6 || Math.abs(c.v - v) > 1e-6) return false;      // beyond the wall or under a lower slope: the copy does not change height
    const w = checkMount(s, box, cu, v, others);
    return clean ? !w.length : !w.some((x) => x.kind === 'overlap' || x.kind === 'beyond');
  };
  for (const clean of [true, false]) {
    for (let k = 0, d = box.w + DUPLICATE.gap; d <= s.length; d = box.w + DUPLICATE.gap + ++k * DUPLICATE.step) {
      for (const cu of [u - d, u + d].map((x) => Math.round(x * 1e4) / 1e4)) if (fits(cu, clean)) return { u: cu, v };
    }
  }
  return null;
}
/** other wall objects of the room on the same surface (alignment, warnings) */
export function mountedRects(roomId: string, furniture: FurniturePlacement[], s: MountSurface, exceptId: string | null = null): MountRect[] {
  const out: MountRect[] = [];
  for (const f of furniture) {
    if (f.id === exceptId) continue;
    const item = itemById(f.catalogId), at = item ? mountedAt(roomId, item, f) : null;
    if (item && at && at.surface.id === s.id) out.push({ id: f.id, name: item.name, ...boxRect(at.box, at.u, at.v) });
  }
  return out;
}
/**
 * Loaded document: world position recomputed from the mount record (the record is the source of truth). The same array when nothing
 * changes.
 * The record gives the object's AXIS, and the wall bounds depend on its box — an object that with its current box does not fit
 * entirely on the wall or below the ceiling (a larger variant near a corner, a typed dimension, an off-wall record in the file) is
 * pushed to the bound by the same rules as when dragging (`clampMount`), and the mount record is corrected.
 * A record pointing at a wall that does not exist in the project (changed project data, document from another package version): the object is
 * first re-hung BY POSITION — like an item without a record (`mountedAt`) — and gets a repaired record; only when there is
 * no wall at its position is the record removed and the item stays where it was. A free-standing item with a record — the record is removed.
 */
export function normalizeMounted(roomId: string, furniture: FurniturePlacement[]): FurniturePlacement[] {
  let changed = false;
  const out = furniture.map((f) => {
    if (!f.mount) return f;
    const item = itemById(f.catalogId), hung = !!item && isWallMounted(item), rec = hung ? fromWallMount(roomId, f.mount) : null;
    const at = rec ?? (hung ? mountedAt(roomId, item, { ...f, mount: null }) : null);
    if (!item || !at) { changed = true; const { mount: _m, ...rest } = f; void _m; return rest; }
    const box = furnitureBox(item, f), c = nudgeMount(at.surface, box, at.u, at.v, 0, 0);
    // 1 µm tolerance: an object pushed right to the bound is not "corrected" by a rounding error (the document would be changed)
    if (!rec || Math.abs(c.u - at.u) > 1e-6 || Math.abs(c.v - at.v) > 1e-6) { changed = true; return { ...f, ...mountedPatch(at.surface, box, c.u, c.v) }; }
    const pose = mountPose(at.surface, box, at.u, at.v);
    if (pose.x === f.x && pose.y === f.y && pose.rot === f.rot && pose.elevation === f.elevation) return f;
    changed = true;
    return { ...f, ...pose };
  });
  return changed ? out : furniture;
}

/**
 * Furniture change preserving the wall-object invariant: the world position follows from the mount record. A dimension or
 * variant changes the box depth and therefore the footprint centre — the back must stay at the wall, so the position is recomputed
 * immediately (not only on the next document load).
 */
export function patchPlacement(roomId: string, a: Arrangement, id: string, patch: Partial<FurniturePlacement>): Arrangement {
  const next = updateFurniture(a, id, patch);
  if (!('dims' in patch) && !('variant' in patch)) return next;
  const furniture = normalizeMounted(roomId, next.furniture);
  return furniture === next.furniture ? next : { ...next, furniture };
}

/** document (variants → rooms → arrangements): all mount records recomputed into positions; the same object when unchanged */
export function normalizeDocMounted<D extends { variants: { interiors?: Record<string, RoomInterior> }[] }>(doc: D): D {
  let changed = false;
  const variants = doc.variants.map((v) => {
    if (!v.interiors) return v;
    let touched = false;
    const interiors: Record<string, RoomInterior> = {};
    for (const [roomId, ri] of Object.entries(v.interiors)) {
      const arrangements = ri.arrangements.map((a) => { const f = normalizeMounted(roomId, a.furniture); return f === a.furniture ? a : { ...a, furniture: f }; });
      const same = arrangements.every((a, i) => a === ri.arrangements[i]);
      interiors[roomId] = same ? ri : { ...ri, arrangements };
      if (!same) touched = true;
    }
    if (!touched) return v;
    changed = true;
    return { ...v, interiors };
  });
  return changed ? { ...doc, variants } : doc;
}

const KIND: Record<MountIssue, WarningKind> = { beyond: 'outside', door: 'door', window: 'window', overlap: 'overlap', ceiling: 'slope' };
/** warnings of a wall object at (u, v) on the surface — as furniture warnings (panel, outline in the scene) */
export function mountWarnings(s: MountSurface, box: MountBox, u: number, v: number, others: MountRect[]): FurnitureWarning[] {
  return checkMount(s, box, u, v, others).map((w) => ({ kind: KIND[w.kind], level: w.level, text: w.text, ...(w.withId ? { others: [w.withId] } : {}) }));
}
/**
 * Warnings of a wall object STORED in the arrangement (panel, outline in the scene): the same mounting rules as while
 * dragging. The free-standing furniture rules assess the same spot differently — floor-to-ceiling glazing only as information, and an object
 * above the ceiling or wider than the wall without a warning — so the warning would vanish after releasing the pointer.
 * null — the item is not a wall object on a wall (free-standing furniture rules assess it).
 */
export function storedMountWarnings(roomId: string, item: CatalogItem, p: FurniturePlacement, furniture: FurniturePlacement[]): FurnitureWarning[] | null {
  const at = mountedAt(roomId, item, p);
  return at && mountWarnings(at.surface, at.box, at.u, at.v, mountedRects(roomId, furniture, at.surface, p.id));
}
/** position readout for the user: distance from the nearer wall corner (looking from the room) and underside height */
export function mountReadout(s: MountSurface, u: number, v: number): { along: number; from: 'left' | 'right'; height: number } {
  // the run start (u = 0) is the RIGHT corner looking from the room, the end — the left one
  const left = s.length - u;
  return left <= u ? { along: left, from: 'left', height: v } : { along: u, from: 'right', height: v };
}
