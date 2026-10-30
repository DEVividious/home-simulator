// Checks of a print part after the boolean (ADR 0030, 0031). Blocking — a part that fails is not written: the kernel's status,
// every component standing on the bed (one is expected; separate buildings of one level are separate pieces on the bed, a piece
// above the bed would fall; crumbs of zero volume from the boolean are dropped and counted), a positive volume, the STL read back
// closed (stl.ts). Reported: thin spots in horizontal sections (what a morphological opening by the smallest wall removes) and
// overhangs in the print orientation — faces steeper than the profile's overhang angle away from the bed, as moderate (up to 15°
// more), bridges (held on two opposite sides, no longer than the profile's bridge) or places that need supports.
import type { Vec2, Vec3 } from '../package/types.ts';
import type { Keep } from '../solid/scope.ts';
import type { CrossSection, Geometry, Manifold } from '../solid/wasm.ts';
import type { PrintProfile } from './profiles.ts';

/** a component smaller than this is a crumb of the boolean, not part of the model [m³] */
const CRUMB = 1e-9;

/** the part's components without the crumbs of the boolean, and the bounds of each (building coordinates) */
export function components(geo: Geometry, keep: Keep, m: Manifold): { solid: Manifold; pieces: { min: Vec3; max: Vec3 }[]; crumbs: number } {
  const comps = m.decompose().map((c) => keep(c)), big = comps.filter((c) => c.volume() > CRUMB);
  const pieces = big.map((c) => { const bb = c.boundingBox(); return { min: [...bb.min] as Vec3, max: [...bb.max] as Vec3 }; });
  if (big.length === comps.length) return { solid: m, pieces, crumbs: 0 };
  return { solid: big.length === 1 ? big[0] : keep(geo.Manifold.compose(big)), pieces, crumbs: comps.length - big.length };
}

export interface ThinSpot {
  /** section height in the building [m] */
  z: number;
  /** area of the thin material on the print [mm²] */
  areaMm2: number;
  /** where (plan, building coordinates [m]) */
  at: Vec2;
}

/** material thinner than the profile's wall in horizontal sections of a part (in the plan mask, when given) */
export function thinSpots(geo: Geometry, keep: Keep, m: Manifold, heights: number[], mask: Vec2[][] | null, profile: PrintProfile, k: number): ThinSpot[] {
  const t = (profile.wall - 0.02) / k, out: ThinSpot[] = [], maskCs = mask ? keep(new geo.CrossSection(mask)) : null;
  for (const z of heights) {
    let cs: CrossSection = keep(m.slice(z));
    if (maskCs) cs = keep(cs.intersect(maskCs));
    if (cs.isEmpty()) continue;
    const opened = keep(keep(cs.offset(-t / 2, 'Miter', 2)).offset(t / 2, 'Miter', 2));
    // what the opening removed; hairlines of float noise along the faces have no area
    for (const piece of keep(cs.subtract(opened)).decompose().map((p) => keep(p))) {
      const a = piece.area() * k * k;
      if (a < 0.05) continue;
      const bb = piece.bounds();
      out.push({ z, areaMm2: Math.round(a * 100) / 100, at: [Math.round(((bb.min[0] + bb.max[0]) / 2) * 1000) / 1000, Math.round(((bb.min[1] + bb.max[1]) / 2) * 1000) / 1000] });
    }
  }
  return out;
}

export interface Overhang {
  kind: 'bridge' | 'support';
  /** area on the print [mm²] */
  areaMm2: number;
  /** extent on the bed [mm] */
  sizeMm: [number, number];
  /** the bridge length, when held on two opposite sides [mm] */
  spanMm: number | null;
  /** height above the bed [mm] */
  heightMm: number;
  /** centre: in the coordinates of the mesh analysed [mm]; in the report, in the building [m] */
  at: Vec3;
  /** what it is, when the building says so: "lintel of W1", "ceiling of R2" */
  what?: string;
}

export interface Overhangs {
  /** faces up to 15° steeper than the profile's overhang angle: they print, a little rougher [mm²] */
  moderateMm2: number;
  bridges: Overhang[];
  supports: Overhang[];
}

const r2 = (x: number) => Math.round(x * 100) / 100 + 0;

/** overhangs of a mesh in print coordinates (mm, z up, the bed at its lowest point) */
export function overhangs(P: ArrayLike<number>, I: Uint32Array, profile: PrintProfile): Overhangs {
  const n = I.length / 3, steepSin = Math.sin(((profile.overhang + 15) * Math.PI) / 180), limit = Math.sin((profile.overhang * Math.PI) / 180);
  let bed = Infinity;
  for (let i = 2; i < P.length; i += 3) bed = Math.min(bed, P[i]);
  const nz = new Float64Array(n), area = new Float64Array(n), onBed = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz);
    area[t] = l / 2; nz[t] = l ? cz / l : 0;
    onBed[t] = P[a + 2] < bed + 1e-3 && P[b + 2] < bed + 1e-3 && P[c + 2] < bed + 1e-3 ? 1 : 0;
  }
  // edges → the triangles on them
  const V = P.length / 3, edgeTri = new Map<number, number[]>();
  const ek = (p: number, q: number) => Math.min(p, q) * V + Math.max(p, q);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) { const e = ek(I[t * 3 + k], I[t * 3 + (k + 1) % 3]); const l = edgeTri.get(e); if (l) l.push(t); else edgeTri.set(e, [t]); }
  let moderate = 0;
  const steep = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    if (onBed[t] || nz[t] >= -limit) continue;
    if (-nz[t] <= steepSin) moderate += area[t];
    else steep[t] = 1;
  }
  // connected regions of steep faces
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const tris of edgeTri.values()) for (let i = 0; i + 1 < tris.length; i++) if (steep[tris[i]] && steep[tris[i + 1]]) { const a = find(tris[i]), b = find(tris[i + 1]); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
  const regions = new Map<number, number[]>();
  for (let t = 0; t < n; t++) if (steep[t]) { const r = find(t); const l = regions.get(r); if (l) l.push(t); else regions.set(r, [t]); }
  const bridges: Overhang[] = [], supports: Overhang[] = [];
  for (const tris of regions.values()) {
    const inRegion = new Set(tris);
    let A = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, cx = 0, cy = 0, cz = 0;
    for (const t of tris) {
      A += area[t];
      for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; x0 = Math.min(x0, P[v]); x1 = Math.max(x1, P[v]); y0 = Math.min(y0, P[v + 1]); y1 = Math.max(y1, P[v + 1]); z0 = Math.min(z0, P[v + 2]); cx += (P[v] * area[t]) / 3; cy += (P[v + 1] * area[t]) / 3; cz += (P[v + 2] * area[t]) / 3; }
    }
    if (A < 0.5) continue;
    // held edges: the neighbouring face goes down from the edge
    const tol = Math.max(0.05, 0.02 * Math.max(x1 - x0, y1 - y0)), held = { x0: false, x1: false, y0: false, y1: false };
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const p = I[t * 3 + k], q = I[t * 3 + (k + 1) % 3];
      const nb = (edgeTri.get(ek(p, q)) ?? []).find((s) => s !== t && !inRegion.has(s));
      if (nb === undefined) continue;
      const third = [0, 1, 2].map((j) => I[nb * 3 + j]).find((v) => v !== p && v !== q)!;
      if (P[third * 3 + 2] >= Math.max(P[p * 3 + 2], P[q * 3 + 2]) - 1e-4) continue;
      const px = P[p * 3], py = P[p * 3 + 1], qx = P[q * 3], qy = P[q * 3 + 1];
      if (Math.abs(px - x0) < tol && Math.abs(qx - x0) < tol) held.x0 = true;
      if (Math.abs(px - x1) < tol && Math.abs(qx - x1) < tol) held.x1 = true;
      if (Math.abs(py - y0) < tol && Math.abs(qy - y0) < tol) held.y0 = true;
      if (Math.abs(py - y1) < tol && Math.abs(qy - y1) < tol) held.y1 = true;
    }
    const spans = [held.x0 && held.x1 ? x1 - x0 : Infinity, held.y0 && held.y1 ? y1 - y0 : Infinity], span = Math.min(...spans);
    const o: Overhang = { kind: 'bridge', areaMm2: r2(A), sizeMm: [r2(x1 - x0), r2(y1 - y0)], spanMm: Number.isFinite(span) ? r2(span) : null, heightMm: r2(z0 - bed), at: [r2(cx / A), r2(cy / A), r2(cz / A)] };
    // a cantilever up to 1.5 mm prints without help
    const reach = Math.min(x1 - x0, y1 - y0);
    if (span <= profile.bridge + 1e-6) bridges.push(o);
    else if (!Number.isFinite(span) && reach <= 1.5 && (held.x0 || held.x1 || held.y0 || held.y1)) bridges.push(o);
    else supports.push({ ...o, kind: 'support' });
  }
  const byArea = (a: Overhang, b: Overhang) => b.areaMm2 - a.areaMm2;
  return { moderateMm2: r2(moderate), bridges: bridges.sort(byArea), supports: supports.sort(byArea) };
}

/** the area of the faces lying on the bed (the lowest height of the mesh) [mm²] */
export function bedContact(P: ArrayLike<number>, I: Uint32Array): number {
  let bed = Infinity, s = 0;
  for (let i = 2; i < P.length; i += 3) bed = Math.min(bed, P[i]);
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    if (!(P[a + 2] < bed + 1e-3 && P[b + 2] < bed + 1e-3 && P[c + 2] < bed + 1e-3)) continue;
    s += Math.abs((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (P[b + 1] - P[a + 1])) / 2;
  }
  return s;
}
