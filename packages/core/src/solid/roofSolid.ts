// The roof as a manifold solid (ADR 0027, 0028): per level with roof parts one closed solid — the union of the wings (each the
// prism over its extent below the top of its covering), the dormer roofs (slabs), the parapets and the chimneys, minus the space
// under the roof (every wing and dormer below its underside planes) and the roof window openings. Valleys, hips meeting valleys
// and a lower ridge running into a higher roof come out of the union. The roof is a separate solid from the level below it, so
// the scene can hide it in the level's section (the rooms under the slopes stay visible from above); the walls of that level
// rise to the roof's underside (levels.ts). Pure helpers (bounds, roof windows) need no kernel.
import { roomsOfLevel, type Building } from '../model/building.ts';
import { inRegion, planeZ, raise, regionBox, regionPolygon, surfaceAt, surfaceRange, type Plane, type RoofPiece } from '../model/roof.ts';
import type { ChimneyJson, LevelId, Vec2, Vec3 } from '../package/types.ts';
import type { WindowFrame } from './frames.ts';
import { PROUD } from './openings.ts';
import { belowPlanes, prism, rectSection, regionSection, roofSpace } from './prism.ts';
import type { Keep } from './scope.ts';
import { TagTable } from './tags.ts';
import type { Geometry, Manifold } from './wasm.ts';

/** a roof window: the opening through the roof perpendicular to its plane, and its frame in the plane */
export interface RoofWindow {
  id: string; roomId: string;
  plane: Plane;
  /** corners of the opening's prism: the plan rectangle on the underside −PROUD, then on the covering +PROUD */
  corners: Vec3[];
  frame: WindowFrame;
}

/** roof windows of the rooms of a level: each in the roof plane over its centre (none where the ceiling there is flat) */
export function roofWindowsOf(b: Building, level: LevelId): RoofWindow[] {
  const pieces = b.roof?.byLevel(level) ?? [], th = b.roof?.thickness ?? 0, out: RoofWindow[] = [];
  for (const room of roomsOfLevel(b, level)) for (const w of room.roofWindows) {
    const [x0, y0, x1, y1] = w.rect, at = surfaceAt({ pieces, which: 'inner' }, (x0 + x1) / 2, (y0 + y1) / 2);
    if (!at) continue;
    const P = at.plane, g = Math.hypot(P.gx, P.gy), l = Math.hypot(g, 1);
    if (g < 1e-9) continue;
    const n: Vec3 = [-P.gx / l, -P.gy / l, 1 / l], s: Vec2 = [P.gx / g, P.gy / g], h: Vec2 = [-s[1], s[0]];
    const plan: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], on = (q: Vec2): Vec3 => [q[0], q[1], planeZ(P, q[0], q[1])];
    const along = (k: number): Vec3[] => plan.map((q) => { const p = on(q); return [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k]; });
    const hs = plan.map((q) => q[0] * h[0] + q[1] * h[1]), ss = plan.map((q) => q[0] * s[0] + q[1] * s[1]);
    const h0 = Math.min(...hs), s0 = Math.min(...ss), o = on([h[0] * h0 + s[0] * s0, h[1] * h0 + s[1] * s0]);
    const frame: WindowFrame = { o, u: [h[0], h[1], 0], v: [s[0] / l, s[1] / l, g / l], n, width: Math.max(...hs) - h0, height: (Math.max(...ss) - s0) * l, depth: th };
    out.push({ id: w.id, roomId: room.id, plane: P, corners: [...along(-PROUD), ...along(th + PROUD)], frame });
  }
  return out;
}

/** the roof level a chimney belongs to: the highest level whose roof pieces reach over its centre */
export function chimneyLevel(b: Building, c: ChimneyJson): LevelId | null {
  const x = (c.rect[0] + c.rect[2]) / 2, y = (c.rect[1] + c.rect[3]) / 2;
  const levels = b.levels.filter((l) => b.roof?.byLevel(l.id).some((p) => inRegion(p.region, x, y)));
  return levels.length ? levels[levels.length - 1].id : null;
}

/** top of the parapet of a flat part: the highest point of its covering plus the parapet height */
const parapetTop = (b: Building, planes: Plane[], poly: Vec2[], parapet: number) => Math.max(...poly.flatMap((q) => planes.map((p) => planeZ(raise(p, b.roof!.thickness), q[0], q[1])))) + parapet;

/** bounds of the roof (its extent, the top of the covering, parapets, chimneys); null without a roof */
export function roofBounds(b: Building): { min: Vec3; max: Vec3 } | null {
  const roof = b.roof;
  if (!roof?.pieces.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of roof.pieces) {
    const [x0, y0, x1, y1] = regionBox(p.cover), r = surfaceRange({ pieces: roof.byLevel(p.level), which: 'cover', lift: roof.thickness }, regionPolygon(p.cover));
    min[0] = Math.min(min[0], x0); min[1] = Math.min(min[1], y0); max[0] = Math.max(max[0], x1); max[1] = Math.max(max[1], y1);
    if (r) max[2] = Math.max(max[2], r[1]);
  }
  for (const part of roof.json.parts) if (part.parapet) max[2] = Math.max(max[2], parapetTop(b, roof.byLevel(part.level).filter((p) => p.id === part.id)[0].planes, part.polygon ?? regionPolygon(part.rect!), part.parapet));
  for (const c of roof.json.chimneys ?? []) {
    if (!chimneyLevel(b, c)) continue;
    min[0] = Math.min(min[0], c.rect[0]); min[1] = Math.min(min[1], c.rect[1]); max[0] = Math.max(max[0], c.rect[2]); max[1] = Math.max(max[1], c.rect[3]); max[2] = Math.max(max[2], c.top);
  }
  return { min, max };
}

export interface RoofSolid {
  level: LevelId;
  /** the closed solid of the roof over the level (owned by the caller's scope) */
  solid: Manifold;
  tags: TagTable;
  windows: RoofWindow[];
}

/**
 * The roof solid over one level, built in the caller's scope between the heights z0 (below everything) and z1 (above
 * everything); null for a level without roof parts.
 */
export function roofSolid(geo: Geometry, keep: Keep, b: Building, level: LevelId, z0: number, z1: number): RoofSolid | null {
  const roof = b.roof, pieces = roof?.byLevel(level) ?? [];
  if (!roof || !pieces.length) return null;
  const tags = new TagTable(), th = roof.thickness, t = b.shell.exteriorWall, solids: Manifold[] = [];
  const flat = new Set(roof.json.parts.filter((p) => p.type === 'flat').map((p) => p.id));
  for (const p of pieces) {
    let m = belowPlanes(keep, prism(keep, regionSection(geo, keep, p.cover), z0, z1), p.planes, th);
    // a dormer's roof is a slab: its overhang must not fill the space between the main roof and the dormer roof
    if (p.kind === 'dormer') m = keep(m.subtract(belowPlanes(keep, prism(keep, keep(regionSection(geo, keep, p.cover).offset(PROUD, 'Miter', 2)), z0 - 1, z1), p.planes)));
    solids.push(keep(tags.original(m, { kind: 'roof', level, wingId: p.id, ...(flat.has(p.id) ? { flat: true } : {}) })));
  }
  for (const part of roof.json.parts) {
    if (part.level !== level || !part.parapet) continue;
    const planes = pieces.find((p) => p.id === part.id)!.planes, outline = part.polygon ?? regionPolygon(part.rect!), cs = regionSection(geo, keep, outline);
    const ring = keep(cs.subtract(keep(cs.offset(-t, 'Miter', 2)))), bottom = Math.min(...outline.flatMap((q) => planes.map((p) => planeZ(p, q[0], q[1]))));
    solids.push(keep(tags.original(prism(keep, ring, bottom + th / 2, parapetTop(b, planes, outline, part.parapet)), { kind: 'parapet', level, wingId: part.id })));
  }
  for (const c of roof.json.chimneys ?? []) if (chimneyLevel(b, c) === level) solids.push(keep(tags.original(prism(keep, rectSection(geo, keep, c.rect), z0, c.top), { kind: 'chimney', level, chimneyId: c.id })));
  const voids: Manifold[] = [keep(tags.original(roofSpace(geo, keep, pieces, 'region', 0, z0 - 1, z1 + 1), { kind: 'roof-space', level }))];
  const windows = roofWindowsOf(b, level);
  for (const w of windows) voids.push(keep(tags.original(keep(geo.Manifold.hull(w.corners)), { kind: 'roof-window', level, roomId: w.roomId, holeId: w.id })));
  const solid = keep(keep(geo.Manifold.union(solids)).subtract(keep(geo.Manifold.union(voids))));
  const status = solid.status();
  if (status !== 'NoError') throw new Error(`roof of level ${level}: ${status}`);
  return { level, solid, tags, windows };
}

/** pieces of the roof over a level (re-exported for the level solids) */
export const roofPieces = (b: Building, level: LevelId): RoofPiece[] => b.roof?.byLevel(level) ?? [];
