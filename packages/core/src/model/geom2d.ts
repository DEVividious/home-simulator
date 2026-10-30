// Plan geometry (project coordinates, metres): polygons, rotated rectangles (furniture outline), segments. Pure TS.
import type { Vec2 } from '../package/types.ts';

export const EPS = 1e-9;
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
/** angle in the range [0, 360) */
export const normDeg = (a: number) => ((a % 360) + 360) % 360;
/** shortest angle difference a − b in (−180, 180] */
export const angleDiff = (a: number, b: number) => { const d = normDeg(a - b); return d > 180 ? d - 360 : d; };
export const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d + 0;

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a: Vec2): Vec2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/** signed area (> 0: counter-clockwise) */
export function signedArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
export const area = (p: Vec2[]) => Math.abs(signedArea(p));
export const ccw = (p: Vec2[]): Vec2[] => (signedArea(p) < 0 ? [...p].reverse() : p);

export function centroid(p: Vec2[]): Vec2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  return Math.abs(a) < EPS ? p[0] : [cx / (3 * a), cy / (3 * a)];
}

/** point in polygon (even-odd rule); points on an edge — by tol (positive tol = edge counts as "inside") */
export function pointInPolygon(q: Vec2, p: Vec2[], tol = 1e-7): boolean {
  if (tol > 0 && distToPolygonEdges(q, p) <= tol) return true;
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** distance from a point to a segment and parameter t ∈ [0, 1] of the nearest point */
export function segDist(q: Vec2, a: Vec2, b: Vec2): { d: number; t: number; p: Vec2 } {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(q, a), ab) / L2));
  const p: Vec2 = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { d: dist(q, p), t, p };
}

export function distToPolygonEdges(q: Vec2, p: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < p.length; i++) d = Math.min(d, segDist(q, p[i], p[(i + 1) % p.length]).d);
  return d;
}

/** segment intersection (touching endpoints within tol does not count) */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 1e-9): boolean {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < EPS) return false;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t > tol && t < 1 - tol && u > tol && u < 1 - tol;
}

// ------------------------------------------------------------------ rotated rectangle (furniture outline in plan)
export interface OBB {
  c: Vec2; // centre
  hw: number; // half width (local x)
  hd: number; // half depth (local y)
  rot: number; // [°]
}

/** local axes: ux — width, uy — item front */
export function axes(rot: number): { ux: Vec2; uy: Vec2 } {
  const a = rad(rot), c = Math.cos(a), s = Math.sin(a);
  return { ux: [c, s], uy: [-s, c] };
}

/** corners: back-left, back-right, front-right, front-left (counter-clockwise) */
export function obbCorners(o: OBB): Vec2[] {
  const { ux, uy } = axes(o.rot);
  const p = (sx: number, sy: number): Vec2 => [o.c[0] + ux[0] * sx * o.hw + uy[0] * sy * o.hd, o.c[1] + ux[1] * sx * o.hw + uy[1] * sy * o.hd];
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
}

/** local item point (u along the width from the centre, v from the centre towards the front) → LCS */
export function obbPoint(o: OBB, u: number, v: number): Vec2 {
  const { ux, uy } = axes(o.rot);
  return [o.c[0] + ux[0] * u + uy[0] * v, o.c[1] + ux[1] * u + uy[1] * v];
}

/** axis-aligned rectangle enclosing the outline */
export function obbAabb(o: OBB): [number, number, number, number] {
  const c = obbCorners(o);
  return [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
}

/** half extent of the outline along the (unit) direction n */
export function supportAlong(o: OBB, n: Vec2): number {
  const { ux, uy } = axes(o.rot);
  return Math.abs(dot(ux, n)) * o.hw + Math.abs(dot(uy, n)) * o.hd;
}

function project(poly: Vec2[], n: Vec2): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const p of poly) { const v = dot(p, n); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return [lo, hi];
}

/** overlap of two convex polygons (SAT): depth > tol */
export function convexOverlap(a: Vec2[], b: Vec2[], tol = 1e-4): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const n = norm([-e[1], e[0]]);
      const [a0, a1] = project(a, n), [b0, b1] = project(b, n);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
    }
  }
  return true;
}

export const obbOverlap = (a: OBB, b: OBB, tol = 1e-4) => convexOverlap(obbCorners(a), obbCorners(b), tol);

/** whether a convex polygon lies entirely inside an (arbitrary) polygon: vertices inside and no edge intersections */
export function convexInsidePolygon(c: Vec2[], room: Vec2[], tol = 1e-4): boolean {
  if (!c.every((p) => pointInPolygon(p, room, tol))) return false;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    for (let j = 0; j < room.length; j++) if (segmentsIntersect(a, b, room[j], room[(j + 1) % room.length], 1e-6)) return false;
  }
  // concave room: a room vertex inside the item outline also means leaving the room
  return !room.some((q) => pointInPolygon(q, c, -1) && distToPolygonEdges(q, c) > tol);
}

/** approximate overlap area of two rotated rectangles (12 × 12 sampling) — for warnings */
export function obbOverlapArea(a: OBB, b: OBB, n = 12): number {
  const cb = obbCorners(b);
  let hit = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = obbPoint(a, (-1 + (2 * i + 1) / n) * a.hw, (-1 + (2 * j + 1) / n) * a.hd);
    if (pointInPolygon(p, cb, -1)) hit++;
  }
  return (hit / (n * n)) * 4 * a.hw * a.hd;
}

/** nearest interior point of the polygon (when q lies outside — projection onto the nearest edge, moved inwards by inset) */
export function clampToPolygon(q: Vec2, poly: Vec2[], inset = 0): Vec2 {
  if (pointInPolygon(q, poly, 0) && distToPolygonEdges(q, poly) >= inset) return q;
  let best: { d: number; p: Vec2; i: number } = { d: Infinity, p: q, i: 0 };
  for (let i = 0; i < poly.length; i++) {
    const s = segDist(q, poly[i], poly[(i + 1) % poly.length]);
    if (s.d < best.d) best = { d: s.d, p: s.p, i };
  }
  const a = poly[best.i], b = poly[(best.i + 1) % poly.length];
  const e = norm(sub(b, a)), inward: Vec2 = signedArea(poly) >= 0 ? [-e[1], e[0]] : [e[1], -e[0]];
  return add(best.p, mul(inward, Math.max(inset, 1e-4)));
}

/** polygon offset outwards by d (inwards for d < 0); corners mitred, very sharp corners clamped */
export function offsetPolygon(p: Vec2[], d: number): Vec2[] {
  const n = p.length, area2 = p.reduce((s, a, i) => { const b = p[(i + 1) % n]; return s + a[0] * b[1] - b[0] * a[1]; }, 0), sgn = area2 >= 0 ? 1 : -1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
    const e1: Vec2 = [b[0] - a[0], b[1] - a[1]], e2: Vec2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1, l2 = Math.hypot(e2[0], e2[1]) || 1;
    // outward normals (counter-clockwise order: the right side of an edge)
    const n1: Vec2 = [(sgn * e1[1]) / l1, (-sgn * e1[0]) / l1], n2: Vec2 = [(sgn * e2[1]) / l2, (-sgn * e2[0]) / l2];
    const den = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const k = den < 0.05 ? d : d / den;
    out.push([b[0] + (n1[0] + n2[0]) * k, b[1] + (n1[1] + n2[1]) * k]);
  }
  return out;
}
