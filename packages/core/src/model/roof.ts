// The roof of a building (ADR 0027, 0028): parts ("wings") over rectangles of a level's walls, each bounded above by its planes;
// dormers (small wings standing on a plane of a part); chimneys. Pure plan-and-height geometry: the underside of the roof (the
// ceiling of the rooms below it), the top of the covering, and the planar pieces ("facets") of either over a region of the
// plan — what the room ceilings, the wall finishes, the plan previews, the compiler checks and the solids read. A union of wings
// is the highest of them at every point, so valleys and a lower ridge running into a higher roof need no special case.
// The roof is described in the package (building.roof) or, for a package written before the roof existed, derived from its
// attic ceilings (roofFromAttic) — the same planes, so those ceilings do not move.
import { area } from './geom2d.ts';
import type { CeilingJson, LevelId, Rect, RoofJson, RoofPlaneJson, Vec2 } from '../package/types.ts';

/** a plane over the plan: z = z0 + gx·x + gy·y */
export interface Plane { gx: number; gy: number; z0: number }
export const planeZ = (p: Plane, x: number, y: number): number => p.z0 + p.gx * x + p.gy * y;
export const planeOf = (j: RoofPlaneJson): Plane => ({ gx: -j.n[0] / j.n[2], gy: -j.n[1] / j.n[2], z0: j.d / j.n[2] });
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
/** the plane as {n, d} (unit normal pointing up) */
export function planeJson(p: Plane): RoofPlaneJson {
  const l = Math.hypot(p.gx, p.gy, 1);
  return { n: [r6(-p.gx / l), r6(-p.gy / l), r6(1 / l)], d: r6(p.z0 / l) };
}
/** the plane moved up across itself by h (a layer of thickness h on top of it) */
export const raise = (p: Plane, h: number): Plane => (h ? { ...p, z0: p.z0 + h * Math.hypot(p.gx, p.gy, 1) } : p);
export const FLAT = (z: number): Plane => ({ gx: 0, gy: 0, z0: z });
/** pitch of a plane [°] */
export const pitchOf = (p: Plane): number => (Math.atan(Math.hypot(p.gx, p.gy)) * 180) / Math.PI;

/** roof defaults [m]: covering and structure thickness, eaves (overhang at the eaves) and verge (overhang at a gable) */
export const ROOF_DEFAULTS = { covering: 0.05, buildup: 0.25, eaves: 0.5, verge: 0.3 } as const;

/** a region of the plan: an axis-aligned rectangle or an orthogonal polygon */
export type Region = Rect | Vec2[];
const isRect = (r: Region): r is Rect => typeof r[0] === 'number';
const TOL = 1e-6;
/** whether a point lies in the region (boundary included) */
export function inRegion(r: Region, x: number, y: number): boolean {
  if (isRect(r)) return x >= r[0] - TOL && x <= r[2] + TOL && y >= r[1] - TOL && y <= r[3] + TOL;
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    // on an edge: inside
    if (Math.abs((xj - xi) * (y - yi) - (yj - yi) * (x - xi)) < TOL * Math.hypot(xj - xi, yj - yi) && x >= Math.min(xi, xj) - TOL && x <= Math.max(xi, xj) + TOL && y >= Math.min(yi, yj) - TOL && y <= Math.max(yi, yj) + TOL) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const regionBox = (r: Region): Rect => (isRect(r) ? r : [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))]);
const regionXs = (r: Region) => (isRect(r) ? [r[0], r[2]] : r.map((p) => p[0]));
const regionYs = (r: Region) => (isRect(r) ? [r[1], r[3]] : r.map((p) => p[1]));
export const rectPolygon = ([x0, y0, x1, y1]: Rect): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const regionPolygon = (r: Region): Vec2[] => (isRect(r) ? rectPolygon(r) : r);

/** a piece of the roof: one extent rectangle of a part, or a dormer */
export interface RoofPiece {
  /** part or dormer id */
  id: string;
  kind: 'part' | 'dormer';
  level: LevelId;
  /** where its space reaches — the walls of the level rise to its planes there: a part's extent; a dormer's walls (rect) */
  region: Region;
  /** where its planes are the ceiling of the rooms below: a part's extent; the inside of a dormer */
  inner: Region;
  /** where its roof (structure and covering) lies: a part's extent; a dormer's roof extent */
  cover: Region;
  /** underside of the structure; the piece is below every plane */
  planes: Plane[];
}

export interface RoofModel {
  json: RoofJson;
  covering: number;
  buildup: number;
  /** covering + buildup: the roof's thickness across its planes */
  thickness: number;
  pieces: RoofPiece[];
  /** levels that have roof parts */
  levels: LevelId[];
  byLevel: (level: LevelId) => RoofPiece[];
  /** derived from attic ceilings (a package written before the roof) */
  fromAttic: boolean;
}

export function roofModel(json: RoofJson, fromAttic = false): RoofModel {
  const pieces: RoofPiece[] = [], levelOf = new Map(json.parts.map((p) => [p.id, p.level]));
  for (const p of json.parts) {
    const planes = p.planes.map(planeOf);
    const regions: Region[] = p.extentPolygon ? [p.extentPolygon] : p.extent;
    for (const r of regions) pieces.push({ id: p.id, kind: 'part', level: p.level, region: r, inner: r, cover: r, planes });
  }
  for (const d of json.dormers ?? []) pieces.push({ id: d.id, kind: 'dormer', level: levelOf.get(d.part) ?? '', region: d.rect, inner: d.inner, cover: d.extent, planes: d.planes.map(planeOf) });
  const levels = [...new Set(json.parts.map((p) => p.level))];
  const by = new Map(levels.map((l) => [l, pieces.filter((p) => p.level === l)]));
  return { json, covering: json.covering, buildup: json.buildup, thickness: json.covering + json.buildup, pieces, levels, byLevel: (l) => by.get(l) ?? [], fromAttic };
}

// ------------------------------------------------------------------ surfaces over the plan
/** one of the roof's surfaces: the highest of the pieces (by `which` region), each the lowest of its planes raised by `lift`,
 *  capped by `cap` (a flat ceiling) where given */
export interface Surface { pieces: RoofPiece[]; which: 'region' | 'inner' | 'cover'; lift?: number; cap?: number }

/** the surface at a point and the plane it comes from; null where no piece covers the point and there is no cap */
export function surfaceAt(s: Surface, x: number, y: number): { z: number; plane: Plane } | null {
  let best: { z: number; plane: Plane } | null = null;
  for (const p of s.pieces) {
    if (!inRegion(p[s.which], x, y)) continue;
    let low: { z: number; plane: Plane } | null = null;
    for (const q of p.planes) { const pl = raise(q, s.lift ?? 0), z = planeZ(pl, x, y); if (!low || z < low.z) low = { z, plane: pl }; }
    if (low && (!best || low.z > best.z)) best = low;
  }
  if (s.cap !== undefined && (!best || s.cap < best.z)) return { z: s.cap, plane: FLAT(s.cap) };
  return best;
}

/** a planar piece of a surface over the plan */
export interface Facet { polygon: Vec2[]; plane: Plane }

/** the part of a convex polygon where a·x + b·y + c ≥ 0 (sign 1) or ≤ 0 (sign −1) */
function clipLine(poly: Vec2[], a: number, b: number, c: number, sign: 1 | -1): Vec2[] {
  const out: Vec2[] = [], f = (p: Vec2) => sign * (a * p[0] + b * p[1] + c);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    if (fp >= -1e-12) out.push(p);
    if ((fp >= -1e-12) !== (fq >= -1e-12)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
const centroidOf = (p: Vec2[]): Vec2 => { let sx = 0, sy = 0; for (const q of p) { sx += q[0]; sy += q[1]; } return [sx / p.length, sy / p.length]; };
const uniqSorted = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 1e7) / 1e7))].sort((a, b) => a - b);

/**
 * The facets of a surface over an orthogonal polygon (minus rectangular holes): the polygon is cut into the cells of the grid of
 * its own and the pieces' coordinates (inside a cell the same pieces apply), every cell is split along the lines where two of
 * its candidate planes are equal, and every resulting convex piece takes the plane the surface has at its centre.
 */
export function surfaceFacets(s: Surface, polygon: Vec2[], holes: Rect[] = []): Facet[] {
  const [bx0, by0, bx1, by1] = regionBox(polygon);
  const pieces = s.pieces.filter((p) => { const r = regionBox(p[s.which]); return r[0] < bx1 + TOL && r[2] > bx0 - TOL && r[1] < by1 + TOL && r[3] > by0 - TOL; });
  const within = (v: number, lo: number, hi: number) => v > lo + TOL && v < hi - TOL;
  const xs = uniqSorted([...polygon.map((p) => p[0]), ...pieces.flatMap((p) => regionXs(p[s.which])).filter((v) => within(v, bx0, bx1)), ...holes.flatMap((h) => [h[0], h[2]]).filter((v) => within(v, bx0, bx1))]);
  const ys = uniqSorted([...polygon.map((p) => p[1]), ...pieces.flatMap((p) => regionYs(p[s.which])).filter((v) => within(v, by0, by1)), ...holes.flatMap((h) => [h[1], h[3]]).filter((v) => within(v, by0, by1))]);
  const inside = (c: Vec2) => inRegion(polygon, c[0], c[1]) && !holes.some((h) => c[0] > h[0] && c[0] < h[2] && c[1] > h[1] && c[1] < h[3]);
  const out: Facet[] = [];
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const c: Vec2 = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
    if (xs[i + 1] - xs[i] < 1e-6 || ys[j + 1] - ys[j] < 1e-6 || !inside(c)) continue;
    const cand: Plane[] = s.cap !== undefined ? [FLAT(s.cap)] : [];
    for (const p of pieces) if (inRegion(p[s.which], c[0], c[1])) for (const q of p.planes) cand.push(raise(q, s.lift ?? 0));
    let parts: Vec2[][] = [rectPolygon([xs[i], ys[j], xs[i + 1], ys[j + 1]])];
    for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) {
      const A = cand[a], B = cand[b], la = A.gx - B.gx, lb = A.gy - B.gy, lc = A.z0 - B.z0;
      if (Math.abs(la) < 1e-12 && Math.abs(lb) < 1e-12) continue;
      parts = parts.flatMap((p) => [clipLine(p, la, lb, lc, 1), clipLine(p, la, lb, lc, -1)].filter((q) => q.length >= 3 && area(q) > 1e-9));
    }
    for (const p of parts) {
      const m = centroidOf(p), at = surfaceAt(s, m[0], m[1]);
      if (at) out.push({ polygon: p, plane: at.plane });
    }
  }
  return out;
}

/** highest and lowest point of a surface over a polygon (null where nothing covers it) */
export function surfaceRange(s: Surface, polygon: Vec2[]): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (const f of surfaceFacets(s, polygon)) for (const q of f.polygon) { const z = planeZ(f.plane, q[0], q[1]); lo = Math.min(lo, z); hi = Math.max(hi, z); }
  return lo <= hi ? [lo, hi] : null;
}

/** positions t along the segment a → b (0 < t < its length) where a surface bends or steps */
export function surfaceBreaks(s: Surface, a: Vec2, b: Vec2): number[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-9) return [];
  const d: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], ts: number[] = [];
  const pieces = s.pieces.filter((p) => { const r = regionBox(p[s.which]); return Math.max(a[0], b[0]) >= r[0] - TOL && Math.min(a[0], b[0]) <= r[2] + TOL && Math.max(a[1], b[1]) >= r[1] - TOL && Math.min(a[1], b[1]) <= r[3] + TOL; });
  // region edges crossing the segment
  for (const p of pieces) {
    const poly = regionPolygon(p[s.which]);
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i], e = poly[(i + 1) % poly.length], ex = e[0] - c[0], ey = e[1] - c[1], den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = c[0] - a[0], wy = c[1] - a[1], t = (wx * ey - wy * ex) / den, u = (wx * d[1] - wy * d[0]) / den;
      if (u >= -TOL && u <= 1 + TOL) ts.push(t);
    }
  }
  // lines where two candidate planes are equal
  const cand: Plane[] = [...(s.cap !== undefined ? [FLAT(s.cap)] : []), ...pieces.flatMap((p) => p.planes.map((q) => raise(q, s.lift ?? 0)))];
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const A = cand[i], B = cand[j], k = (A.gx - B.gx) * d[0] + (A.gy - B.gy) * d[1];
    if (Math.abs(k) < 1e-12) continue;
    ts.push(-(planeZ(A, a[0], a[1]) - planeZ(B, a[0], a[1])) / k);
  }
  return uniqSorted(ts.filter((t) => t > 1e-6 && t < L - 1e-6));
}

/** where the surface over a polygon (orthogonal) is below the plane z = h: its area (facets clipped by the contour) */
export function areaBelow(facets: Facet[], h: number): number {
  let s = 0;
  for (const f of facets) {
    const p = f.plane, below = clipLine(f.polygon, -p.gx, -p.gy, h - p.z0, 1);   // h − z ≥ 0
    if (below.length >= 3) s += area(below);
  }
  return s;
}

/** the line where a facet's plane is at height h, clipped to the facet (null when it does not cross it) */
export function contourOf(f: Facet, h: number): [Vec2, Vec2] | null {
  const p = f.plane, val = (q: Vec2) => planeZ(p, q[0], q[1]) - h, pts: Vec2[] = [];
  if (Math.abs(p.gx) < 1e-12 && Math.abs(p.gy) < 1e-12) return null;
  for (let i = 0; i < f.polygon.length; i++) {
    const a = f.polygon[i], b = f.polygon[(i + 1) % f.polygon.length], va = val(a), vb = val(b);
    if ((va < 0) !== (vb < 0)) { const t = va / (va - vb); pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return pts.length >= 2 ? [pts[0], pts[1]] : null;
}

// ------------------------------------------------------------------ attic ceilings → a gable roof
/** the two planes of an attic ceiling (the single-ridge formula z = z_at_ridge − slope·|d − ridge| of packages written before the roof) */
export function atticPlanes(c: CeilingJson): Plane[] {
  const zr = c.z_at_ridge!, k = c.slope!;
  if (c.ridge_x !== undefined) { const r = c.ridge_x; return [{ gx: -k, gy: 0, z0: zr + k * r }, { gx: k, gy: 0, z0: zr - k * r }]; }
  const r = c.ridge_y!;
  return [{ gx: 0, gy: -k, z0: zr + k * r }, { gx: 0, gy: k, z0: zr - k * r }];
}

/** grows a rectangle: eaves on the sides parallel to the ridge (the slopes run down to them), verge on the gable ends */
export function gableExtent([x0, y0, x1, y1]: Rect, ridge: 'X' | 'Y', eaves: number, verge: number): Rect {
  return ridge === 'X' ? [x0 - verge, y0 - eaves, x1 + verge, y1 + eaves] : [x0 - eaves, y0 - verge, x1 + eaves, y1 + verge];
}

/**
 * A package written before the roof: a level whose rooms all have the same attic ceiling (one ridge) gets a gable roof with the
 * same planes over its rooms grown by the exterior wall, with the default thicknesses and overhangs. A level that mixes attic and
 * flat ceilings, or several ridges, gets no roof (its attic rooms keep their own planes). Null when no level qualifies.
 */
export function roofFromAttic(rooms: { level: LevelId; polygon: number[][]; ceiling: CeilingJson }[], exteriorWall: number): RoofJson | null {
  const byLevel = new Map<LevelId, typeof rooms>();
  for (const r of rooms) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
  const key = (c: CeilingJson) => `${c.ridge_x ?? ''}|${c.ridge_y ?? ''}|${c.z_at_ridge}|${c.slope}`;
  const t = exteriorWall, D = ROOF_DEFAULTS, parts: RoofJson['parts'] = [];
  for (const [level, rs] of byLevel) {
    const c = rs[0].ceiling;
    if (rs.some((r) => r.ceiling.kind !== 'attic' || key(r.ceiling) !== key(c))) continue;
    const xs = rs.flatMap((r) => r.polygon.map((p) => p[0])), ys = rs.flatMap((r) => r.polygon.map((p) => p[1]));
    const rect: Rect = [Math.min(...xs) - t, Math.min(...ys) - t, Math.max(...xs) + t, Math.max(...ys) + t].map(r6) as Rect;
    const ridge = c.ridge_x !== undefined ? 'Y' as const : 'X' as const, planes = atticPlanes(c);
    parts.push({ id: `attic-${level}`, level, type: 'gable', rect, extent: [gableExtent(rect, ridge, D.eaves, D.verge).map(r6) as Rect], planes: planes.map(planeJson), ridge, pitch: Math.round(pitchOf(planes[0]) * 10) / 10 });
  }
  return parts.length ? { covering: D.covering, buildup: D.buildup, parts } : null;
}
