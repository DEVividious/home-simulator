// Outer outline of a level: the room outlines grown by the exterior wall thickness and merged — the footprint of the walls
// as the generated shell builds them. Orthogonal outlines: the grid of outline coordinates (exact for them); with slanted
// walls: every room grown with mitred corners, the sides that lie outside every other grown room chained into loops.
import { distToPolygonEdges, pointInPolygon, signedArea } from './geom2d.ts';
import type { Vec2 } from '../package/types.ts';

const bboxOf = (p: Vec2[]) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))] as [number, number, number, number];
const inPolygon = (c: Vec2, p: Vec2[]) => pointInPolygon(c, p, 0);

/**
 * Outer outline of orthogonal rooms grown by the exterior wall t — the cells of the outline grid within t of a room (as the
 * generated shell fills them), traced counter-clockwise; the largest loop when the rooms form several buildings.
 */
export function outerOutline(rooms: Vec2[][], t: number): Vec2[] {
  if (!rooms.every((p) => p.every((a, i) => { const b = p[(i + 1) % p.length]; return Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9; }))) return grownUnion(rooms, t);
  const uniq = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 1e5) / 1e5))].sort((a, b) => a - b);
  const xs = uniq(rooms.flatMap((p) => p.flatMap((q) => [q[0] - t, q[0], q[0] + t]))), ys = uniq(rooms.flatMap((p) => p.flatMap((q) => [q[1] - t, q[1], q[1] + t])));
  const nx = xs.length - 1, ny = ys.length - 1;
  const near = (c: Vec2) => rooms.some((p) => {
    const [x0, y0, x1, y1] = bboxOf(p);
    if (c[0] < x0 - t || c[0] > x1 + t || c[1] < y0 - t || c[1] > y1 + t) return false;
    if (inPolygon(c, p)) return true;
    // within t (Chebyshev) of an edge: orthogonal edges are their own bounding boxes
    return p.some((a, i) => { const b = p[(i + 1) % p.length]; return Math.max(a[0], b[0]) >= c[0] - t && Math.min(a[0], b[0]) <= c[0] + t && Math.max(a[1], b[1]) >= c[1] - t && Math.min(a[1], b[1]) <= c[1] + t; });
  });
  const full = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) full[i * ny + j] = near([(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2]) ? 1 : 0;
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && full[i * ny + j] === 1;
  // boundary edges with the filled cell on the left, keyed by their start grid point
  const next = new Map<string, [number, number][]>(), key = (i: number, j: number) => `${i},${j}`;
  const add = (a: [number, number], b: [number, number]) => { const k = key(...a); next.set(k, [...(next.get(k) ?? []), b]); };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (!on(i, j)) continue;
    if (!on(i, j - 1)) add([i, j], [i + 1, j]);
    if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!on(i - 1, j)) add([i, j + 1], [i, j]);
  }
  let best: Vec2[] = [], bestArea = 0;
  for (const k0 of [...next.keys()]) {
    while (next.get(k0)?.length) {
      const loop: Vec2[] = [];
      let k = k0;
      while (next.get(k)?.length) {
        const [i, j] = k.split(',').map(Number), b = next.get(k)!.pop()!;
        loop.push([xs[i], ys[j]]);
        k = key(...b);
      }
      const area = loop.reduce((s, a, i) => { const b = loop[(i + 1) % loop.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
      if (area > bestArea) { bestArea = area; best = loop; }
    }
  }
  // drop the vertices in the middle of straight runs
  return best.filter((p, i) => { const a = best[(i - 1 + best.length) % best.length], b = best[(i + 1) % best.length]; return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1])); });
}

/**
 * The union of the rooms grown by t (mitred corners — as the solid kernel offsets them): every side of every grown room is cut
 * where other sides cross it; the pieces outside every other grown room (on a shared line: kept once) are chained into loops; the
 * largest loop, counter-clockwise, with the vertices in the middle of straight runs dropped.
 */
function grownUnion(rooms: Vec2[][], t: number): Vec2[] {
  const polys = rooms.map((p) => grown(signedArea(p) < 0 ? [...p].reverse() : p, t));
  const E = 1e-7, key = (p: Vec2) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const segs: [Vec2, Vec2][] = [];
  polys.forEach((P, i) => P.forEach((a, k) => {
    const b = P[(k + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], ts = [0, 1];
    // where the other grown rooms' sides cross or touch this side
    polys.forEach((Q, j) => { if (j !== i) Q.forEach((c, m) => {
      const e = Q[(m + 1) % Q.length], ex = e[0] - c[0], ey = e[1] - c[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) { for (const q of [c, e]) { const u = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy); if (u > E && u < 1 - E && Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) < 1e-9) ts.push(u); } return; }
      const u = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den, v = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (u > E && u < 1 - E && v > -E && v < 1 + E) ts.push(u);
    }); });
    ts.sort((p, q) => p - q);
    for (let s = 0; s + 1 < ts.length; s++) {
      if (ts[s + 1] - ts[s] < E) continue;
      const p: Vec2 = [a[0] + dx * ts[s], a[1] + dy * ts[s]], q: Vec2 = [a[0] + dx * ts[s + 1], a[1] + dy * ts[s + 1]], m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      // outside every other grown room; on another room's side (a shared line): only the first room keeps it
      const keep = polys.every((Q, j) => j === i || (distToPolygonEdges(m, Q) < 1e-7 ? j > i : !pointInPolygon(m, Q, 0)));
      if (keep) segs.push([p, q]);
    }
  }));
  // chain the pieces: from each end to the piece starting there
  const from = new Map<string, number[]>();
  segs.forEach(([p], i) => from.set(key(p), [...(from.get(key(p)) ?? []), i]));
  const used = new Set<number>();
  let best: Vec2[] = [], bestArea = 0;
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used.has(s0)) continue;
    const loop: Vec2[] = [];
    for (let s: number | undefined = s0; s !== undefined; s = (from.get(key(segs[s][1])) ?? []).find((x) => !used.has(x))) { used.add(s); loop.push(segs[s][0]); }
    const a = signedArea(loop);
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = a < 0 ? [...loop].reverse() : loop; }
  }
  const clean = (l: Vec2[]) => l.filter((p, i) => { const a = l[(i - 1 + l.length) % l.length], b = l[(i + 1) % l.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9; });
  return clean(best);
}

/** a counter-clockwise outline grown by t with mitred corners, a mitre longer than `limit` · t squared off there — as the solid
 *  kernel's offset (CrossSection.offset(t, 'Miter', 2)) */
function grown(p: Vec2[], t: number, limit = 2): Vec2[] {
  const out: Vec2[] = [], n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
    const nrm = (u: Vec2, v: Vec2): Vec2 => { const dx = v[0] - u[0], dy = v[1] - u[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
    const n1 = nrm(a, b), n2 = nrm(b, c), sx = n1[0] + n2[0], sy = n1[1] + n2[1], sl = Math.hypot(sx, sy);
    if (sl < 1e-9) { out.push([b[0] + n1[0] * t, b[1] + n1[1] * t]); continue; }
    const u: Vec2 = [sx / sl, sy / sl], m = t / (sl / 2);
    if (m <= limit * t + 1e-12) { out.push([b[0] + u[0] * m, b[1] + u[1] * m]); continue; }
    // squared off at limit · t along the bisector: where that line meets the two grown sides
    const L = limit * t, w: Vec2 = [-u[1], u[0]];
    for (const q of [n1, n2]) { const s = (t - L * (u[0] * q[0] + u[1] * q[1])) / (w[0] * q[0] + w[1] * q[1]); out.push([b[0] + u[0] * L + w[0] * s, b[1] + u[1] * L + w[1] * s]); }
  }
  return out;
}
