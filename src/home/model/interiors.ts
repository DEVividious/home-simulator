// Interiors in the project (USER DESIGN STATE): Variant.interiors[roomId] = { active arrangement, arrangements }.
// Pure functions (immutable structures): furniture, finishes, arrangements (save / copy / rename / delete / load),
// document validation. Every UI change = one function = one history entry (undo / redo).
import { t } from '../../i18n';
import { BUILTIN_ITEMS, resolveDims, type CatalogItem } from '../catalog/furniture';
import { materialById } from '../catalog/materials';
import type { Arrangement, CameraBookmark, FinishRef, FurniturePlacement, ImportedAsset, RoomFinishes, RoomInterior, Vec2 } from './types';

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const emptyFinishes = (): RoomFinishes => ({ walls: {}, floor: null, ceiling: null });
export const newArrangement = (name: string, id = newId('arr')): Arrangement => ({ id, name, furniture: [], finishes: emptyFinishes(), scenario: null, saved: false });
// default furniture of rooms (e.g. kitchen units); provided by model/defaults.ts
let defaultFurnitureOf: (roomId: string) => FurniturePlacement[] = () => [];
export function setDefaultFurnitureProvider(fn: (roomId: string) => FurniturePlacement[]) { defaultFurnitureOf = fn; }

export const defaultInterior = (roomId: string): RoomInterior => {
  const a = { ...newArrangement(t('interiors.arrangementN', { n: 1 }), `arr-${roomId}-1`), furniture: defaultFurnitureOf(roomId) };
  return { activeArrangementId: a.id, arrangements: [a] };
};

/** room interior in the variant (the default when nothing is stored yet; the variant is not modified) */
export function interiorOf(interiors: Record<string, RoomInterior> | undefined, roomId: string): RoomInterior {
  return interiors?.[roomId] ?? defaultInterior(roomId);
}
export const activeArrangement = (ri: RoomInterior): Arrangement => ri.arrangements.find((a) => a.id === ri.activeArrangementId) ?? ri.arrangements[0];

/** changes a room interior (creates the entry when the room had none yet); same reference when fn changes nothing */
export function withInterior(interiors: Record<string, RoomInterior>, roomId: string, fn: (ri: RoomInterior) => RoomInterior): Record<string, RoomInterior> {
  const cur = interiorOf(interiors, roomId), next = fn(cur);
  return next === cur ? interiors : { ...interiors, [roomId]: next };
}
export function withActive(ri: RoomInterior, fn: (a: Arrangement) => Arrangement): RoomInterior {
  const a = activeArrangement(ri), n = fn(a);
  return n === a ? ri : { ...ri, arrangements: ri.arrangements.map((x) => (x.id === a.id ? n : x)) };
}

// ------------------------------------------------------------------ furniture
export const furnitureById = (a: Arrangement, id: string) => a.furniture.find((f) => f.id === id) ?? null;
export const addFurniture = (a: Arrangement, p: FurniturePlacement): Arrangement => ({ ...a, furniture: [...a.furniture, p] });
export function updateFurniture(a: Arrangement, id: string, patch: Partial<FurniturePlacement>): Arrangement {
  const f = furnitureById(a, id);
  if (!f) return a;
  const n = { ...f, ...patch };
  // wall object: the mount record stays consistent with the position — a height change updates the record, while moving the item
  // with a "floor" tool (x / y / rotation without a mount record) detaches it from the wall
  if (f.mount && !('mount' in patch)) {
    if ('x' in patch || 'y' in patch || 'rot' in patch) delete n.mount;
    else if (patch.elevation != null) n.mount = { ...f.mount, height: patch.elevation };
  }
  if (JSON.stringify(n) === JSON.stringify(f)) return a;
  return { ...a, furniture: a.furniture.map((x) => (x.id === id ? n : x)) };
}
export const removeFurniture = (a: Arrangement, id: string): Arrangement => (furnitureById(a, id) ? { ...a, furniture: a.furniture.filter((f) => f.id !== id) } : a);
export function duplicateFurniture(a: Arrangement, id: string, offset: Vec2, nid = newId('f')): { arrangement: Arrangement; id: string | null } {
  const f = furnitureById(a, id);
  if (!f) return { arrangement: a, id: null };
  const c: FurniturePlacement = { ...clone(f), id: nid, x: f.x + offset[0], y: f.y + offset[1] };
  return { arrangement: addFurniture(a, c), id: nid };
}

// ------------------------------------------------------------------ finishes
export type FinishTarget = { kind: 'floor' } | { kind: 'ceiling' } | { kind: 'wall'; wallId: string } | { kind: 'walls'; wallIds: string[] };

export function setFinish(a: Arrangement, target: FinishTarget, ref: FinishRef | null): Arrangement {
  const f = a.finishes;
  let n: RoomFinishes;
  if (target.kind === 'floor') n = { ...f, floor: ref };
  else if (target.kind === 'ceiling') n = { ...f, ceiling: ref };
  else {
    const ids = target.kind === 'wall' ? [target.wallId] : target.wallIds;
    const walls = { ...f.walls };
    for (const id of ids) { if (ref) walls[id] = clone(ref); else delete walls[id]; }
    n = { ...f, walls };
  }
  return JSON.stringify(n) === JSON.stringify(f) ? a : { ...a, finishes: n };
}

// ------------------------------------------------------------------ arrangements
export function uniqueName(name: string, existing: string[]): string {
  const base = name.trim() || t('interiors.arrangement');
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}
const names = (ri: RoomInterior, except?: string) => ri.arrangements.filter((a) => a.id !== except).map((a) => a.name);

/** saving an arrangement: names the active arrangement (saving the project is separate, in the document store) */
export const saveArrangement = (ri: RoomInterior, name: string): RoomInterior =>
  withActive(ri, (a) => ({ ...a, name: uniqueName(name, names(ri, a.id)), saved: true }));

/** copy of the active arrangement under a new name — the copy becomes active */
export function duplicateArrangement(ri: RoomInterior, name: string, id = newId('arr')): RoomInterior {
  const src = activeArrangement(ri);
  const c: Arrangement = { ...clone(src), id, name: uniqueName(name || t('interiors.copyName', { name: src.name }), names(ri)), saved: true };
  c.furniture = c.furniture.map((f) => ({ ...f, id: newId('f') }));
  return { activeArrangementId: id, arrangements: [...ri.arrangements, c] };
}
export const renameArrangement = (ri: RoomInterior, id: string, name: string): RoomInterior =>
  ({ ...ri, arrangements: ri.arrangements.map((a) => (a.id === id ? { ...a, name: uniqueName(name, names(ri, id)), saved: true } : a)) });
export function deleteArrangement(ri: RoomInterior, id: string): RoomInterior {
  if (ri.arrangements.length <= 1 || !ri.arrangements.some((a) => a.id === id)) return ri;
  const rest = ri.arrangements.filter((a) => a.id !== id);
  return { activeArrangementId: ri.activeArrangementId === id ? rest[0].id : ri.activeArrangementId, arrangements: rest };
}
export const loadArrangement = (ri: RoomInterior, id: string): RoomInterior => (ri.arrangements.some((a) => a.id === id) && ri.activeArrangementId !== id ? { ...ri, activeArrangementId: id } : ri);
export const newEmptyArrangement = (ri: RoomInterior, name: string, id = newId('arr')): RoomInterior =>
  ({ activeArrangementId: id, arrangements: [...ri.arrangements, { ...newArrangement(uniqueName(name, names(ri)), id), saved: true }] });

// ------------------------------------------------------------------ validation (project document)
const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const finishErrors = (f: FinishRef | null | undefined, where: string): string[] => {
  if (f === null || f === undefined) return [];
  const e: string[] = [];
  if (!f || typeof f.materialId !== 'string' || !materialById(f.materialId)) e.push(`${where}: unknown material ${String(f?.materialId)}`);
  if (f?.color != null && !/^#[0-9a-f]{6}$/i.test(f.color)) e.push(`${where}: colour #rrggbb`);
  return e;
};

export function interiorsErrors(interiors: unknown, importedAssets: ImportedAsset[] = [], items: CatalogItem[] = BUILTIN_ITEMS): string[] {
  const e: string[] = [];
  if (interiors === undefined) return e;
  if (!interiors || typeof interiors !== 'object') return ['interiors: object expected'];
  const known = new Set([...items.map((i) => i.id), ...importedAssets.map((a) => `imported:${a.id}`)]);
  for (const [rid, ri] of Object.entries(interiors as Record<string, RoomInterior>)) {
    if (!ri || !Array.isArray(ri.arrangements) || !ri.arrangements.length) { e.push(`room ${rid}: no arrangements`); continue; }
    if (!ri.arrangements.some((a) => a.id === ri.activeArrangementId)) e.push(`room ${rid}: active arrangement does not exist`);
    const aids = new Set<string>();
    for (const a of ri.arrangements) {
      if (!a || typeof a.id !== 'string' || aids.has(a.id)) { e.push(`room ${rid}: arrangement without id / duplicate id`); continue; }
      aids.add(a.id);
      if (typeof a.name !== 'string' || !a.name.trim()) e.push(`room ${rid} / ${a.id}: missing name`);
      if (!Array.isArray(a.furniture)) { e.push(`room ${rid} / ${a.name}: furniture — array`); continue; }
      const fids = new Set<string>();
      for (const f of a.furniture) {
        if (!f || typeof f.id !== 'string' || fids.has(f.id)) { e.push(`room ${rid} / ${a.name}: furniture item without id / duplicate id`); continue; }
        fids.add(f.id);
        if (!known.has(f.catalogId)) e.push(`room ${rid} / ${a.name}: unknown furniture ${f.catalogId}`);
        if (!finite(f.x) || !finite(f.y) || !finite(f.rot)) e.push(`room ${rid} / ${a.name} / ${f.id}: position x, y, rot — numbers`);
        if (f.dims && Object.values(f.dims).some((v) => v !== undefined && !(finite(v) && (v as number) > 0))) e.push(`room ${rid} / ${a.name} / ${f.id}: dimensions > 0`);
        if (f.materialId != null && !materialById(f.materialId)) e.push(`room ${rid} / ${a.name} / ${f.id}: unknown material ${f.materialId}`);
        if (f.slots && (typeof f.slots !== 'object' || Object.values(f.slots).some((m) => !materialById(m)))) e.push(`room ${rid} / ${a.name} / ${f.id}: unknown part material`);
        if (f.elevation != null && !(finite(f.elevation) && f.elevation >= 0 && f.elevation < 4)) e.push(`room ${rid} / ${a.name} / ${f.id}: mounting height 0–4 m`);
        if (f.mount != null && !(typeof f.mount === 'object' && typeof f.mount.wallId === 'string' && finite(f.mount.u) && finite(f.mount.height) && f.mount.height >= 0 && f.mount.height < 8)) e.push(`room ${rid} / ${a.name} / ${f.id}: mount record { wallId, u, height }`);
      }
      const fin = a.finishes;
      if (!fin || typeof fin !== 'object' || !fin.walls || typeof fin.walls !== 'object') { e.push(`room ${rid} / ${a.name}: finishes`); continue; }
      for (const [wid, f] of Object.entries(fin.walls)) e.push(...finishErrors(f, `room ${rid} / ${a.name} / wall ${wid}`));
      e.push(...finishErrors(fin.floor, `room ${rid} / ${a.name} / floor`), ...finishErrors(fin.ceiling, `room ${rid} / ${a.name} / ceiling`));
    }
  }
  return e;
}

export function bookmarksErrors(b: unknown): string[] {
  if (b === undefined) return [];
  if (!Array.isArray(b)) return ['bookmarks: array'];
  const v3 = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every(finite);
  return (b as CameraBookmark[]).flatMap((k, i) => (!k || typeof k.id !== 'string' || typeof k.name !== 'string' || !v3(k.position) || !v3(k.target) || !finite(k.fov) ? [`bookmark ${i + 1}: id, name, position, target, fov`] : []));
}

export function importedErrors(a: unknown): string[] {
  if (a === undefined) return [];
  if (!Array.isArray(a)) return ['importedAssets: array'];
  return (a as ImportedAsset[]).flatMap((x, i) => (!x || typeof x.id !== 'string' || typeof x.file !== 'string' || !x.dims || !finite(x.dims.w) || !finite(x.scale) ? [`model ${i + 1}: id, file, dims, scale`] : []));
}

/** catalog item dimensions (helper for validation / UI) */
export const placementDims = (item: CatalogItem, p: FurniturePlacement) => resolveDims(item, p);
