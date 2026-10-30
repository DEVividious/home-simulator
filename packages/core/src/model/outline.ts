// Outer outline of a level: the room outlines grown by the exterior wall thickness and merged — the footprint of the walls
// as the generated shell builds them. Orthogonal outlines only (the grid of outline coordinates is exact for them).
import { pointInPolygon } from './geom2d.ts';
import type { Vec2 } from '../package/types.ts';

const bboxOf = (p: Vec2[]) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))] as [number, number, number, number];
const inPolygon = (c: Vec2, p: Vec2[]) => pointInPolygon(c, p, 0);

/**
 * Outer outline of orthogonal rooms grown by the exterior wall t — the cells of the outline grid within t of a room (as the
 * generated shell fills them), traced counter-clockwise; the largest loop when the rooms form several buildings.
 */
export function outerOutline(rooms: Vec2[][], t: number): Vec2[] {
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
