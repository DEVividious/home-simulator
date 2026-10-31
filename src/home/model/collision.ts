// Furniture collisions — warnings (not blocking): item ↔ wall (sticks out of the room), item ↔ item, item ↔ door /
// passage (swing zone), item ↔ window (taller than the sill right in front of the window), stairs, sloped ceiling.
import { fmtCm, t } from '../../i18n';
import { stairArrivesAt, stairOpeningRects } from './stairs';
import { mayOverlap, type CatalogItem } from '../catalog/furniture';
import { convexInsidePolygon, convexOverlap, obbCorners, obbOverlap, type OBB } from '@home-sim/core/model/geom2d';
import { doorById, doorLeaves, swingDepth } from './doors';
import type { HomeRoom } from './rooms';
import type { Dims, FurniturePlacement, Vec2 } from './types';

export type WarningKind = 'outside' | 'overlap' | 'door' | 'window' | 'stairs' | 'slope';
export interface FurnitureWarning { kind: WarningKind; level: 'warn' | 'info'; text: string; others?: string[] }

export const obbOf = (p: Pick<FurniturePlacement, 'x' | 'y' | 'rot'>, d: Pick<Dims, 'w' | 'd'>): OBB => ({ c: [p.x, p.y], hw: d.w / 2, hd: d.d / 2, rot: p.rot });

/** rectangle at a room wall: [t0, t1] along the wall × depth into the room */
export function wallZone(room: HomeRoom, wallId: string, t0: number, t1: number, depth: number): Vec2[] {
  const w = room.walls.find((q) => q.id === wallId)!;
  const P = (t: number, k: number): Vec2 => [w.a[0] + w.dir[0] * t + w.inward[0] * k, w.a[1] + w.dir[1] * t + w.inward[1] * k];
  return [P(t0, 0), P(t1, 0), P(t1, depth), P(t0, depth)];
}

export interface Neighbour { id: string; name: string; item: CatalogItem; placement: FurniturePlacement; dims: Dims }

const cm = (x: number) => fmtCm(x);

export function furnitureWarnings(room: HomeRoom, item: CatalogItem, p: FurniturePlacement, dims: Dims, others: Neighbour[]): FurnitureWarning[] {
  const out: FurnitureWarning[] = [];
  const o = obbOf(p, dims), corners = obbCorners(o), flat = !!item.flat;
  const bottom = p.elevation ?? item.defaultElevation ?? 0, top = bottom + dims.h;
  // items at different heights (wall cabinet above a base unit, hood above the hob) do not collide
  const zApart = (n: Neighbour) => { const b = n.placement.elevation ?? n.item.defaultElevation ?? 0; return b >= top - 0.005 || b + n.dims.h <= bottom + 0.005; };
  if (!convexInsidePolygon(corners, room.polygon, 0.003)) out.push({ kind: 'outside', level: 'warn', text: t('collision.outside') });
  const hits = others.filter((n) => n.id !== p.id && !mayOverlap(item, n.item) && !zApart(n) && obbOverlap(o, obbOf(n.placement, n.dims), 0.01));
  if (hits.length) out.push({ kind: 'overlap', level: 'warn', text: t('collision.overlap', { names: hits.map((h) => h.name).join(', ') }), others: hits.map((h) => h.id) });
  if (!flat) {
    for (const d of room.doors) {
      if (item.inDoorway || bottom >= 2.05) break; // door flush in the opening; element above the door
      const wall = room.walls.find((w) => w.id === d.wallId), wl = wall?.length ?? Infinity;
      // doors from the door model (hinge and direction from the plan) — the swing zone only on the side the leaf
      // opens into (leaf width); on the other side and for sliding doors a clear passage width is enough
      const def = doorById(d.id), leaves = def && wall ? doorLeaves(def, 0) : [];
      if (def && leaves.length && wall) {
        const tAt = (q: Vec2) => (q[0] - wall.a[0]) * wall.dir[0] + (q[1] - wall.a[1]) * wall.dir[1], ts = leaves.flatMap((l) => [tAt(l.a), tAt(l.b)]);
        const t0 = Math.max(0, Math.min(...ts)), t1 = Math.min(wl, Math.max(...ts)), into = def.swingInto === room.id;
        // side without the leaf: 3 cm tolerance at the reveals (an item next to the door does not "block" the passage); the side it
        // opens into: as deep as the leaves reach (a double door's half leaves, a bifold's folded panels)
        const m = into ? 0 : 0.03;
        if (convexOverlap(corners, wallZone(room, d.wallId, t0 + m, t1 - m, into ? swingDepth(def) : 0.6), 0.01)) { out.push({ kind: 'door', level: 'warn', text: into ? t('collision.doorSwing') : t('collision.doorBlocked') }); break; }
        continue;
      }
      const zone = wallZone(room, d.wallId, Math.max(0, d.t0 - 0.05), Math.min(wl, d.t1 + 0.05), d.passage ? 0.6 : Math.max(0.7, d.leaf));
      if (convexOverlap(corners, zone, 0.01)) { out.push({ kind: 'door', level: 'warn', text: d.passage ? t('collision.passageBlocked') : t('collision.doorSwing') }); break; }
    }
    for (const w of room.windows) {
      const zone = wallZone(room, w.wallId, w.t0, w.t1, 0.35);
      if (!convexOverlap(corners, zone, 0.01) || bottom >= w.head - 0.02) continue;
      const block = bottom + Math.min(dims.h, item.obstructHeight ?? dims.h);
      if (w.sill > 0.05 && block > w.sill + 0.02) { out.push({ kind: 'window', level: 'warn', text: t('collision.window', { height: cm(block), sill: cm(w.sill) }) }); break; }
      if (w.sill <= 0.05 && top > 1.2) { out.push({ kind: 'window', level: 'info', text: t('collision.glazing') }); break; }
    }
    if (stairOpeningRects(room).some(([x0, y0, x1, y1]) => convexOverlap(corners, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0.01))) {
      out.push({ kind: 'stairs', level: 'warn', text: stairArrivesAt(room.level) ? t('collision.stairOpening') : t('collision.stairFlight') });
    }
    if (room.ceiling.kind !== 'flat') {
      const avail = Math.min(...[...corners, o.c].map((q) => room.ceiling.heightAt(q[0], q[1])));
      if (top > avail + 0.005) out.push({ kind: 'slope', level: 'warn', text: t('collision.slope', { height: cm(top), available: cm(Math.max(0, avail)) }) });
    }
  }
  return out;
}

/** highest warning level (for the outline colour) */
export const warningLevel = (w: FurnitureWarning[]) => (w.some((x) => x.level === 'warn') ? 'warn' : w.length ? 'info' : null);
