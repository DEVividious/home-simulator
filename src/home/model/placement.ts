// Furniture placement: a free spot for a new item (click in the catalog) and furnishing proposals (presets OFFICE /
// GUEST ROOM / HYBRID). Wall-side heuristic: candidates with their back to the walls (5 cm step), collisions rejected (walls, furniture,
// door zones, windows for items taller than the sill, sloped ceilings), preferences (desk by the window, bed and wardrobe on solid walls).
// The room geometry is NOT changed — a preset only proposes furniture.
import { t } from '../../i18n';
import { itemById } from '../catalog/providers';
import { isWallMounted, resolveDims, type CatalogItem } from '../catalog/furniture';
import { furnitureWarnings, obbOf, type Neighbour } from './collision';
import { dist, obbPoint, pointInPolygon, round } from './geom2d';
import { newId } from './interiors';
import { mountSurfaces } from './mount';
import { checkMount } from './mountDrag';
import { furnitureBox, mountedDrop, mountedRects } from './mountedFurniture';
import type { HomeRoom, RoomWall } from './rooms';
import { rotFacing } from './snapping';
import type { Dims, FurniturePlacement, ScenarioPreset, Vec2 } from './types';

const GAP = 0.005;

function neighbour(p: FurniturePlacement): Neighbour | null {
  const item = itemById(p.catalogId);
  return item ? { id: p.id, name: item.name, item, placement: p, dims: resolveDims(item, p) } : null;
}
export const neighbours = (list: FurniturePlacement[]) => list.map(neighbour).filter((n): n is Neighbour => !!n);

/** whether the position is "clean" (no warn-level warnings) */
function clean(room: HomeRoom, item: CatalogItem, p: FurniturePlacement, dims: Dims, others: Neighbour[], ignore: string[] = []) {
  return !furnitureWarnings(room, item, p, dims, others).some((w) => w.level === 'warn' && !ignore.includes(w.kind));
}

/** wall-side positions: back to the wall, centre along the wall every `step` */
function wallCandidates(room: HomeRoom, dims: Dims, step = 0.05): { w: RoomWall; t: number; p: Pick<FurniturePlacement, 'x' | 'y' | 'rot'> }[] {
  const out: { w: RoomWall; t: number; p: Pick<FurniturePlacement, 'x' | 'y' | 'rot'> }[] = [];
  for (const w of room.walls) {
    if (w.length < dims.w + 0.01) continue;
    const rot = rotFacing(w.inward);
    for (let t = dims.w / 2; t <= w.length - dims.w / 2 + 1e-9; t += step) {
      const x = w.a[0] + w.dir[0] * t + w.inward[0] * (dims.d / 2 + GAP), y = w.a[1] + w.dir[1] * t + w.inward[1] * (dims.d / 2 + GAP);
      out.push({ w, t, p: { x: round(x, 4), y: round(y, 4), rot } });
    }
  }
  return out;
}

/** clearance of a wall object's free spot from openings, other wall objects and the wall end [m] */
const MOUNT_CLEARANCE = 0.05;
/**
 * Free spot for a WALL object: candidates along the room walls every 5 cm, at the default height
 * clamped to the wall, evaluated with the mounting rules on the object's RECTANGLE (`checkMount`): off windows, glazing and door
 * openings, not overlapping other wall objects, entirely on the wall. The freestanding-furniture rules treat floor-to-ceiling glazing
 * as information only — a mirror, shelf or wall cabinet would otherwise land on the glass of a patio door. Among such spots the priority
 * is: no collision with freestanding furniture and door zones, then a 5 cm clearance from openings / objects / the wall end (not
 * flush against the reveal); the one nearest the target point is chosen. null — no room.
 */
function freeMount(room: HomeRoom, item: CatalogItem, p0: FurniturePlacement, others: FurniturePlacement[], nb: Neighbour[], target: Vec2, step = 0.05): FurniturePlacement | null {
  const dims = resolveDims(item, p0), box = furnitureBox(item, p0), wide = { ...box, w: box.w + 2 * MOUNT_CLEARANCE };
  let best: { p: FurniturePlacement; d: number; rank: number } | null = null;
  for (const s of mountSurfaces(room.id)) {
    if (s.length < dims.w + 0.01) continue;
    const rects = mountedRects(room.id, others, s);
    for (let u = dims.w / 2; u <= s.length - dims.w / 2 + 1e-9; u += step) {
      const drop = mountedDrop(s, item, p0, u, rects);
      if (drop.warnings.length) continue;
      const p = { ...p0, ...drop.patch }, d = dist([p.x, p.y], target);
      if (best && best.rank === 3 && d >= best.d) continue;                   // further than the best spot — skip collision checks
      const roomy = !checkMount(s, wide, u, drop.patch.mount!.height, rects).length;
      const rank = (clean(room, item, p, dims, nb) ? 2 : 0) + (roomy ? 1 : 0);
      if (!best || rank > best.rank || (rank === best.rank && d < best.d)) best = { p, d, rank };
    }
  }
  return best?.p ?? null;
}

/** free spot for a new item: first along the walls (wall-side furniture), then a grid from the room centre */
export function findFreeSpot(room: HomeRoom, item: CatalogItem, base: Partial<FurniturePlacement>, others: FurniturePlacement[], near?: Vec2): FurniturePlacement {
  const p0: FurniturePlacement = { id: base.id ?? newId('f'), catalogId: item.id, variant: base.variant ?? null, x: room.center[0], y: room.center[1], rot: base.rot ?? 0, dims: base.dims ?? null, materialId: base.materialId ?? null };
  const dims = resolveDims(item, p0), nb = neighbours(others);
  const target = near ?? room.center;
  if (isWallMounted(item)) { const hung = freeMount(room, item, p0, others, nb, target); if (hung) return hung; }
  if (item.placement === 'wall') {
    const c = wallCandidates(room, dims).map((q) => ({ ...q.p, d: dist([q.p.x, q.p.y], target) })).sort((a, b) => a.d - b.d);
    for (const q of c) { const p = { ...p0, x: q.x, y: q.y, rot: q.rot }; if (clean(room, item, p, dims, nb)) return p; }
  }
  const [x0, y0, x1, y1] = room.bbox, pts: Vec2[] = [];
  for (let x = x0 + 0.1; x <= x1 - 0.1; x += 0.1) for (let y = y0 + 0.1; y <= y1 - 0.1; y += 0.1) if (pointInPolygon([x, y], room.polygon, -1)) pts.push([round(x, 3), round(y, 3)]);
  pts.sort((a, b) => dist(a, target) - dist(b, target));
  for (const q of pts) { const p = { ...p0, x: q[0], y: q[1] }; if (clean(room, item, p, dims, nb)) return p; }
  return { ...p0, x: round(target[0], 4), y: round(target[1], 4) };
}

// ------------------------------------------------------------------ furnishing presets
export interface PresetItem { catalogId: string; variant?: string; dims?: Partial<Dims>; role?: 'desk' | 'bed' | 'storage' | 'seat' | 'chair' | 'nightstand' | 'rug' }
export interface ScenarioDef { id: ScenarioPreset; label: string; description: string; items: PresetItem[] }

/** scenario with `label` / `description` getters (translated in the current UI language) */
const scenario = (id: ScenarioPreset, items: PresetItem[]): ScenarioDef => ({
  id, items,
  get label(): string { return t(`placement.scenario.${id}`); },
  get description(): string { return t(`placement.scenario.${id}.description`); },
});
export const SCENARIOS: ScenarioDef[] = [
  scenario('office', [
    { catalogId: 'desk', role: 'desk' }, { catalogId: 'office-chair', role: 'chair' }, { catalogId: 'shelves', role: 'storage' }, { catalogId: 'cabinet', variant: 'tall', role: 'storage' }]),
  scenario('guest', [
    { catalogId: 'bed', variant: '140', role: 'bed' }, { catalogId: 'bedside-table', role: 'nightstand' }, { catalogId: 'wardrobe', variant: '2d', role: 'storage' }, { catalogId: 'rug', variant: '120x170', role: 'rug' }]),
  scenario('hybrid', [
    { catalogId: 'sofa-bed', role: 'seat' }, { catalogId: 'desk', dims: { w: 1.2 }, role: 'desk' }, { catalogId: 'office-chair', role: 'chair' }, { catalogId: 'wardrobe', variant: '2d', role: 'storage' }]),
];

/** candidate score (lower = better) */
function score(room: HomeRoom, role: PresetItem['role'], w: RoomWall, t: number, dims: Dims, p: Pick<FurniturePlacement, 'x' | 'y'>): number {
  const winOnWall = room.windows.filter((q) => q.wallId === w.id), doorOnWall = room.doors.filter((q) => q.wallId === w.id);
  const nearestWin = Math.min(...room.windows.map((q) => { const ww = room.walls.find((x) => x.id === q.wallId)!; const m = (q.t0 + q.t1) / 2; return dist([ww.a[0] + ww.dir[0] * m, ww.a[1] + ww.dir[1] * m], [p.x, p.y]); }), 99);
  const corner = Math.min(t - dims.w / 2, w.length - t - dims.w / 2);
  switch (role) {
    case 'desk': return nearestWin * 2 + (winOnWall.length ? 0.2 : 0);
    case 'bed': return (winOnWall.length ? 3 : 0) + (doorOnWall.length ? 2 : 0) + Math.abs(t - w.length / 2) * 0.3;
    case 'storage': return (winOnWall.length ? 2 : 0) + corner * 0.8;
    case 'seat': return (winOnWall.length ? 1.5 : 0) + Math.abs(t - w.length / 2) * 0.2;
    default: return corner;
  }
}

/** furnishing proposal: the main pieces first (bed / desk / sofa), then storage; "attached" pieces next to them */
export function arrangeScenario(room: HomeRoom, scenario: ScenarioPreset, existing: FurniturePlacement[] = []): { placed: FurniturePlacement[]; skipped: string[] } {
  const def = SCENARIOS.find((s) => s.id === scenario)!;
  const placed: FurniturePlacement[] = [];
  const skipped: string[] = [];
  const order = [...def.items].sort((a, b) => ['bed', 'seat', 'desk', 'storage', 'nightstand', 'chair', 'rug'].indexOf(a.role ?? 'storage') - ['bed', 'seat', 'desk', 'storage', 'nightstand', 'chair', 'rug'].indexOf(b.role ?? 'storage'));
  for (const pi of order) {
    const item = itemById(pi.catalogId);
    if (!item) { skipped.push(pi.catalogId); continue; }
    const base: FurniturePlacement = { id: newId('f'), catalogId: item.id, variant: pi.variant ?? null, dims: pi.dims ?? null, materialId: null, x: 0, y: 0, rot: 0 };
    const dims = resolveDims(item, base), nb = neighbours([...existing, ...placed]);
    let best: FurniturePlacement | null = null;
    if (pi.role === 'chair') {
      const desk = placed.find((p) => p.catalogId === 'desk');
      if (desk) {
        const dd = resolveDims(itemById('desk')!, desk), c = obbPoint(obbOf(desk, dd), 0, dd.d / 2 + dims.d / 2 - 0.12);
        best = { ...base, x: round(c[0], 4), y: round(c[1], 4), rot: (desk.rot + 180) % 360 };
      }
    } else if (pi.role === 'nightstand') {
      const bed = placed.find((p) => p.catalogId === 'bed' || p.catalogId === 'sofa-bed');
      if (bed) {
        const bd = resolveDims(itemById(bed.catalogId)!, bed);
        for (const side of [-1, 1]) {
          const c = obbPoint(obbOf(bed, bd), side * (bd.w / 2 + dims.w / 2 + 0.02), -bd.d / 2 + dims.d / 2);
          const p = { ...base, x: round(c[0], 4), y: round(c[1], 4), rot: bed.rot };
          if (clean(room, item, p, dims, nb)) { best = p; break; }
        }
      }
    } else if (pi.role === 'rug') {
      const anchor = placed.find((p) => p.catalogId === 'bed') ?? placed[0];
      if (anchor) {
        const ad = resolveDims(itemById(anchor.catalogId)!, anchor), c = obbPoint(obbOf(anchor, ad), 0, ad.d / 2 - 0.35);
        best = { ...base, x: round(c[0], 4), y: round(c[1], 4), rot: anchor.rot };
        if (!clean(room, item, best, dims, nb)) best = null;
      }
    } else {
      const cands = wallCandidates(room, dims).map((q) => ({ ...q, s: score(room, pi.role, q.w, q.t, dims, q.p) })).sort((a, b) => a.s - b.s);
      for (const q of cands) { const p = { ...base, ...q.p }; if (clean(room, item, p, dims, nb)) { best = p; break; } }
    }
    if (best) placed.push(best); else skipped.push(item.name);
  }
  return { placed, skipped };
}
