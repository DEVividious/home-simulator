// Stair geometry from the finish configuration (model/stairsConfig.ts): concrete structure (steps and landing from the building
// data — model/stairs.ts), tread cladding with nosing, risers, handrail, balustrade. Meshes merged by material
// (≤ 6 draw calls). three.js frame: (x, height, −y LCS). The walking surface in walk mode remains the ramp from model/stairs.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { flightAlong, flightLength, flightSlice, stairPieces, stairSides, type StairFlight, type StairPiece, type StairSide } from '@home-sim/core/model/stairs';
import { stairFrame, stairs, type StairDef } from '../model/stairs';
import type { StairsConfig } from '../model/stairsConfig';

export type StairPart = 'concrete' | 'tread' | 'riser' | 'rail' | 'balustrade' | 'glass';
export type StairGeometries = Partial<Record<StairPart, THREE.BufferGeometry>>;

/** box in LCS [x0, x1] × [y0, y1] × [z0, z1] */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0), Math.abs(y1 - y0));
  g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
  return g;
}
/** a vertical panel along A → B (canonical plan points) of thickness th: its bottom at za → zb, its top H higher (balustrades
 *  following the slope of a flight) */
function panel(A: [number, number], B: [number, number], za: number, zb: number, H: number, th: number): THREE.BufferGeometry {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), u: [number, number] = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n: [number, number] = [u[1], -u[0]];
  const g = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, za), new THREE.Vector2(L, zb), new THREE.Vector2(L, zb + H), new THREE.Vector2(0, za + H)]), { depth: th, bevelEnabled: false, curveSegments: 1 });
  // shape (s, z), extrusion e → LCS A + u·s + n·(e − th/2), height z → three (x, z, −y); n to the right of u keeps the basis
  // right-handed (the faces outwards)
  const o: [number, number] = [A[0] - (n[0] * th) / 2, A[1] - (n[1] * th) / 2];
  g.applyMatrix4(new THREE.Matrix4().set(u[0], 0, n[0], o[0], 0, 1, 0, 0, -u[1], 0, -n[1], -o[1], 0, 0, 0, 1));
  return g;
}
const L3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
/** bar (handrail) between LCS points: round ⌀ 4.4 cm or rectangular 4 × 5 cm */
function bar(a: [number, number, number], b: [number, number, number], profile: 'round' | 'rect', size = 1): THREE.BufferGeometry {
  const pa = L3(...a), pb = L3(...b), len = pa.distanceTo(pb);
  const g = profile === 'round' ? new THREE.CylinderGeometry(0.022 * size, 0.022 * size, len, 10, 1).rotateX(Math.PI / 2) : new THREE.BoxGeometry(0.04 * size, 0.05 * size, len);
  const m = new THREE.Matrix4().lookAt(pa, pb, new THREE.Vector3(0, 1, 0)).setPosition(pa.clone().add(pb).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/** the nosing line of a flight: height above the lower floor of the step edges at a distance d from its start */
export const noseZ = (f: StairFlight, R: number, T: number, d: number) => f.z0 + R + (d * R) / T;
/** the walking surface under a side point of a piece (flights: the nosing line) */
const surfaceAt = (def: StairDef, p: StairPiece, q: [number, number]) => (p.kind === 'landing' ? p.z : noseZ(p, def.riser, def.tread, flightAlong(p, q)));

export function buildStairs(c: StairsConfig, def: StairDef = stairs()[0]): StairGeometries {
  const pieces = stairPieces(def), sides = stairSides(def), T = def.tread, R = def.riser, top = def.topZ;
  const t = c.treadThickness, n = t > 0 ? c.nosing : 0, clad = t > 0, rt = 0.015;
  const parts: Record<StairPart, THREE.BufferGeometry[]> = { concrete: [], tread: [], riser: [], rail: [], balustrade: [], glass: [] };
  const slab = (z: number) => Math.min(z, 0.325);                       // step + 15 cm flight slab
  const rbox = ([x0, y0, x1, y1]: number[], z0: number, z1: number) => box(x0, x1, y0, y1, z0, z1);
  pieces.forEach((p, i) => {
    if (p.kind === 'landing') {
      parts.concrete.push(rbox(p.rect, p.z - 0.2, p.z - t));
      if (clad) parts.tread.push(rbox(p.rect, p.z - t, p.z));
      return;
    }
    // each step has its face (riser) towards the start of the flight; the nosing overhangs it
    for (let k = 0; k < p.risers - 1; k++) {
      const z = p.z0 + R * (k + 1);
      parts.concrete.push(rbox(flightSlice(p, k * T, (k + 1) * T), z - slab(z), z - t));
      if (clad) parts.tread.push(rbox(flightSlice(p, k * T - n, (k + 1) * T), z - t, z));
      if (c.riser !== 'none') parts.riser.push(rbox(flightSlice(p, k * T - rt, k * T), z - R, z - t));
    }
    // the last riser: onto the next piece (the landing's nosing over it) or up to the upper floor
    const len = flightLength(p), next = pieces[i + 1], zn = next?.kind === 'landing' ? next.z : top;
    if (c.riser !== 'none') parts.riser.push(rbox(flightSlice(p, len - rt, len), zn - R, next ? zn - t : zn));
    if (clad && next && n > 0) parts.tread.push(rbox(flightSlice(p, len - n, len), zn - t, zn));
  });

  // ---- handrail: above the nosing line at the given height, along the outer sides of the stairs and / or the inner ones
  //      (U-turn: by the partition; L: the open inner side; straight: the outer rail on one side, the inner on the other)
  const h = c.handrail.height, prof = c.handrail.profile, off = 0.07;
  const railSide = (e: StairSide) => (e.kind === 'wall' || e.kind === 'open' || e.kind === 'partition') && (def.kind === 'straight' ? (e.out[0] > 0 ? 'outer' : 'inner') : e.outer ? 'outer' : 'inner');
  const place = c.handrail.place;
  if (place !== 'none') for (const e of sides) {
    const r = railSide(e);
    if (!r || (place !== 'both' && place !== r)) continue;
    const a: [number, number] = [e.a[0] - e.out[0] * off, e.a[1] - e.out[1] * off], b: [number, number] = [e.b[0] - e.out[0] * off, e.b[1] - e.out[1] * off];
    if (e.piece.kind === 'landing') { parts.rail.push(bar([...a, e.piece.z + h], [...b, e.piece.z + h], prof)); continue; }
    // up the flight, then 25 cm level onto the next piece (or the upper floor)
    const f = e.piece, [lo, hi] = flightAlong(f, a) < flightAlong(f, b) ? [a, b] : [b, a], d = f.dir;
    parts.rail.push(bar([...lo, surfaceAt(def, f, lo) + h], [...hi, f.z1 + h], prof), bar([...hi, f.z1 + h], [hi[0] + d[0] * 0.25, hi[1] + d[1] * 0.25, f.z1 + h], prof));
  }

  // ---- balustrade: along the open sides and the U-turn partition (following the slope of each flight), and a guard rail at
  //      the opening on the upper floor: over the foot of the stairs, and (straight, L) along the open sides below it
  const bl = c.balustrade;
  if (bl.type !== 'none') {
    const H = bl.height, target = bl.type === 'glass' ? parts.glass : parts.balustrade, th = bl.type === 'solid' ? 0.08 : bl.type === 'glass' ? 0.012 : 0.014;
    const put = (A: [number, number], B: [number, number], za: number, zb: number) => {
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 0.02) return;
      if (bl.type === 'bars') {
        const k = Math.max(2, Math.round(L / 0.11));
        for (let i = 0; i <= k; i++) { const x = A[0] + ((B[0] - A[0]) * i) / k, y = A[1] + ((B[1] - A[1]) * i) / k, z = za + ((zb - za) * i) / k; parts.balustrade.push(box(x - th / 2, x + th / 2, y - th / 2, y + th / 2, z + 0.03, z + H)); }
        parts.balustrade.push(bar([...A, za + H], [...B, zb + H], 'rect', 0.8), bar([...A, za + 0.06], [...B, zb + 0.06], 'rect', 0.5));
      } else {
        const z0 = bl.type === 'glass' ? 0.05 : 0;
        target.push(panel(A, B, za + z0, zb + z0, H - z0, th));
        if (bl.type === 'glass') parts.balustrade.push(bar([...A, za + H], [...B, zb + H], 'rect', 0.7));
      }
    };
    /** the bottom of a panel at a side point: the flight's walking ramp (one riser below the nosing line), or the landing */
    const bottom = (p: StairPiece, q: [number, number]) => (p.kind === 'landing' ? p.z : surfaceAt(def, p, q) - R);
    for (const e of sides) {
      if (e.kind !== 'open' && e.kind !== 'partition') continue;
      // open sides: 3 cm inside the stairs; the partition: just outside the flight, in the gap
      const k = e.kind === 'open' ? -0.03 : 0.012;
      const A: [number, number] = [e.a[0] + e.out[0] * k, e.a[1] + e.out[1] * k], B: [number, number] = [e.b[0] + e.out[0] * k, e.b[1] + e.out[1] * k];
      put(A, B, bottom(e.piece, e.a), bottom(e.piece, e.b));
    }
    for (const e of sides) {
      const guard = e.kind === 'entry' || (def.kind !== 'u-turn' && e.kind === 'open');
      if (!guard) continue;
      // the part of the side where the stairs are more than a metre below the upper floor
      let A: [number, number] = [e.a[0] - e.out[0] * 0.03, e.a[1] - e.out[1] * 0.03], B: [number, number] = [e.b[0] - e.out[0] * 0.03, e.b[1] - e.out[1] * 0.03];
      const p = e.piece;
      if (e.kind !== 'entry') {
        if (p.kind === 'landing') { if (p.z > top - 1) continue; }
        else {
          const dMax = ((top - 1 - p.z0) / Math.max(1e-9, p.z1 - p.z0)) * flightLength(p);
          if (dMax <= 0) continue;
          const da = flightAlong(p, A), db = flightAlong(p, B), cut = (P: [number, number], Q: [number, number], dp: number, dq: number): [number, number] => { const s = (dMax - dp) / (dq - dp); return [P[0] + (Q[0] - P[0]) * s, P[1] + (Q[1] - P[1]) * s]; };
          if (da > dMax && db > dMax) continue;
          if (da > dMax) A = cut(B, A, db, da); else if (db > dMax) B = cut(A, B, da, db);
        }
      }
      put(A, B, top, top);
    }
  }

  // canonical frame → plan (turn / mirror): the affine map of model/stairs.ts in the three.js frame (x, height, −y)
  const f = stairFrame(def), [x0, y0] = f.box, o = f.toWorld([x0, y0]), ex = f.toWorld([x0 + 1, y0]), ey = f.toWorld([x0, y0 + 1]);
  const a00 = ex[0] - o[0], a10 = ex[1] - o[1], a01 = ey[0] - o[0], a11 = ey[1] - o[1];
  const bx = o[0] - a00 * x0 - a01 * y0, by = o[1] - a10 * x0 - a11 * y0;
  const turned = a00 !== 1 || a11 !== 1 || a01 !== 0 || a10 !== 0;
  const M = new THREE.Matrix4().set(a00, 0, -a01, bx, 0, 1, 0, 0, -a10, 0, a11, -by, 0, 0, 0, 1), mirrored = a00 * a11 - a01 * a10 < 0;

  const out: StairGeometries = {};
  for (const k of Object.keys(parts) as StairPart[]) {
    if (!parts[k].length) continue;
    // merging: a common attribute set (ExtrudeGeometry and BoxGeometry have the same: position, normal, uv); non-indexed
    const merged = mergeGeometries(parts[k].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    parts[k].forEach((g) => g.dispose());
    if (!merged) continue;
    if (turned) {
      merged.applyMatrix4(M);
      // a mirror turns the triangles inside out: swap two corners of each triangle back
      if (mirrored) for (const name of Object.keys(merged.attributes)) {
        const at = merged.getAttribute(name), n = at.itemSize, arr = at.array as Float32Array;
        for (let t = 0; t < at.count; t += 3) for (let c = 0; c < n; c++) { const i = (t + 1) * n + c, j = (t + 2) * n + c, v = arr[i]; arr[i] = arr[j]; arr[j] = v; }
      }
    }
    out[k] = merged;
  }
  return out;
}
