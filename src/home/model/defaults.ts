// PROJECT DEFAULT ARRANGEMENT: the room furnishings a project starts with before the user changes anything (it is written
// to the document only on the first change). The facts come from the project package (project().interiors):
//   • items — elements described in the project sources (e.g. architectural plans); ids "arch-<key>",
//   • extra — ready-made placements outside the sources (e.g. a sample vehicle).
// This is the DEFAULT arrangement, not building geometry: every element is an ordinary arrangement item (move, delete, change
// variant, save your own arrangement). The engine knows nothing about the rooms or layout of any specific project.
import { derivedByKey, project } from '../../project/active';
import { itemById } from '../catalog/providers';
import { round } from '@home-sim/core/model/geom2d';
import { setDefaultFurnitureProvider } from './interiors';
import { attachMounted } from './mountedFurniture';
import { roomById, type HomeRoom } from './rooms';
import type { FurniturePlacement } from './types';
import type { ArchitectItem } from '@home-sim/core/package/types';
export type { ArchitectItem } from '@home-sim/core/package/types';

export const architectItems = (): ArchitectItem[] => project().interiors.items;
export const architectNotIncluded = () => project().interiors.notIncluded;
/** id prefix of items from the architect's layout (distinguishes ARCHITECT DEFAULT / USER ARRANGEMENT) */
export const ARCH_PREFIX = 'arch';
export const isArchitectId = (id: string) => id.startsWith(`${ARCH_PREFIX}-`);
/** architect layout entry the item comes from (by the key in its id) — null: a user item */
export function architectItemOf(placementId: string): ArchitectItem | null {
  if (!isArchitectId(placementId)) return null;
  return architectItems().find((a) => placementId.endsWith(`-${a.key}`)) ?? null;
}

/** items from the architect's layout for a room; prefix — id prefix (default: the constant "arch-…") */
export function architectFurniture(roomId: string, prefix = ARCH_PREFIX, group?: string): FurniturePlacement[] {
  const room = roomById(roomId);
  if (!room) return [];
  return architectItems().filter((a) => a.room === roomId && (!group || a.group === group)).flatMap((a) => {
    if (!itemById(a.catalogId)) return [];
    // height of floor-to-ceiling units at the element's position (−2 cm, max. 2.80 m); hood — from 1.60 m up to the ceiling
    const H = round(Math.min(2.8, room.ceiling.heightAt(a.x, a.y) - 0.02), 3);
    const dims = a.fit === 'ceiling' ? { ...a.dims, h: H } : a.fit === 'hood' ? { ...a.dims, h: round(H - 1.6, 3) } : a.dims ?? null;
    const f: FurniturePlacement = { id: `${prefix}-${a.key}`, catalogId: a.catalogId, variant: a.variant ?? null, x: a.x, y: a.y, rot: a.rot };
    if (dims) f.dims = dims;
    if (a.elevation !== undefined) f.elevation = a.elevation;
    if (a.materialId) f.materialId = a.materialId;
    return [f];
  });
}
export const hasArchitectLayout = (roomId: string) => architectItems().some((a) => a.room === roomId);

/** kitchen units from the project default arrangement (group "kitchen") — to insert into the current arrangement */
export function kitchenBuiltIn(room: HomeRoom, prefix = ARCH_PREFIX): FurniturePlacement[] {
  return architectFurniture(room.id, prefix, 'kitchen');
}

// wall objects of the default arrangement get a mount record — their position follows the wall they were drawn against
const defaultsOf = derivedByKey((roomId: string, p): FurniturePlacement[] => (roomById(roomId) ? [...(p.interiors.extra?.[roomId] ?? []), ...architectFurniture(roomId)].map((f) => attachMounted(roomId, f)) : []));
/** default furniture of a room (stable ids) */
export function defaultFurniture(roomId: string): FurniturePlacement[] {
  return defaultsOf(roomId).map((x) => ({ ...x, dims: x.dims ? { ...x.dims } : x.dims }));
}
export const hasDefaultFurniture = (roomId: string) => defaultFurniture(roomId).length > 0;

setDefaultFurnitureProvider(defaultFurniture);
