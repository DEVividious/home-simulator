// Stair geometry from the finish configuration (model/stairsConfig.ts): concrete structure (steps and landing from the building
// data — model/stairs.ts), tread cladding with nosing, risers, handrail, balustrade. Meshes merged by material
// (≤ 6 draw calls). three.js frame: (x, height, −y LCS). The walking surface in walk mode remains the ramp from model/stairs.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stairs, type StairDef } from '../model/stairs';
import type { StairsConfig } from '../model/stairsConfig';

export type StairPart = 'concrete' | 'tread' | 'riser' | 'rail' | 'balustrade' | 'glass';
export type StairGeometries = Partial<Record<StairPart, THREE.BufferGeometry>>;

/** box in LCS [x0, x1] × [y0, y1] × [z0, z1] */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0), Math.abs(y1 - y0));
  g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
  return g;
}
/** prism: a (y, z) polygon in LCS extruded along x ∈ [xa, xb] (balustrade panels running along the slope) */
function prismYZ(poly: [number, number][], xa: number, xb: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map(([y, z]) => new THREE.Vector2(y, z))), { depth: xb - xa, bevelEnabled: false, curveSegments: 1 });
  // (shape x = LCS y, shape y = LCS z, extrusion = LCS x) → three (x, z, −y)
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, xa, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
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

/** flight layout in LCS — shared by the geometry and the tests */
export function stairLayout(def: StairDef = stairs()[0]) {
  const { bbox: [x0, y0, x1, y1], tread: T, riser: R, risers: N, landingZ, topZ, split, gap, landingEdge: le } = def;
  return {
    x0, y0, x1, y1, T, R, N, landingZ, topZ, le,
    /** lower flight (at +X): up towards −Y; upper flight (at −X): up towards +Y */
    f1: [split + gap / 2, x1] as [number, number], f2: [x0, split - gap / 2] as [number, number],
    /** line of the step edges (nosings): height above the lower floor at position y */
    nose1: (y: number) => R + ((y1 - y) * R) / T,
    nose2: (y: number) => landingZ + R + ((y - le) * R) / T,
  };
}

export function buildStairs(c: StairsConfig, def: StairDef = stairs()[0]): StairGeometries {
  const S = stairLayout(def), { x0, y0, x1, y1, T, R, N, landingZ, le } = S;
  const t = c.treadThickness, n = t > 0 ? c.nosing : 0, clad = t > 0, rt = 0.015;
  const parts: Record<StairPart, THREE.BufferGeometry[]> = { concrete: [], tread: [], riser: [], rail: [], balustrade: [], glass: [] };
  const slab = (z: number) => Math.min(z, 0.325);                       // step + 15 cm flight slab
  // ---- lower flight: each step has its face (riser) on the +Y side
  for (let i = 0; i < N - 1; i++) {
    const ya = y1 - (i + 1) * T, yb = y1 - i * T, z = R * (i + 1);
    parts.concrete.push(box(S.f1[0], S.f1[1], ya, yb, z - slab(z), z - t));
    if (clad) parts.tread.push(box(S.f1[0], S.f1[1], ya, yb + n, z - t, z));
    if (c.riser !== 'none') parts.riser.push(box(S.f1[0], S.f1[1], yb, yb + rt, z - R, z - t));
  }
  // ---- landing (riser of the last step of the lower flight at the landing edge)
  parts.concrete.push(box(x0, x1, y0, le, landingZ - 0.2, landingZ - t));
  if (clad) { parts.tread.push(box(x0, x1, y0, le, landingZ - t, landingZ)); if (n > 0) parts.tread.push(box(S.f1[0], S.f1[1], le, le + n, landingZ - t, landingZ)); }
  if (c.riser !== 'none') parts.riser.push(box(S.f1[0], S.f1[1], le, le + rt, landingZ - R, landingZ - t));
  // ---- upper flight: step face on the −Y side; the last riser at the upper floor
  for (let i = 0; i < N - 1; i++) {
    const ya = le + i * T, yb = le + (i + 1) * T, z = landingZ + R * (i + 1);
    parts.concrete.push(box(S.f2[0], S.f2[1], ya, yb, z - slab(z), z - t));
    if (clad) parts.tread.push(box(S.f2[0], S.f2[1], ya - n, yb, z - t, z));
    if (c.riser !== 'none') parts.riser.push(box(S.f2[0], S.f2[1], ya - rt, ya, z - R, z - t));
  }
  if (c.riser !== 'none') parts.riser.push(box(S.f2[0], S.f2[1], y1 - rt, y1, S.topZ - R, S.topZ));

  // ---- handrail: above the nosing line, on the outer side of the flights and / or at the partition
  const h = c.handrail.height, p = c.handrail.profile, off = 0.07;
  const rail = (x: number, flight: 1 | 2) => {
    if (flight === 1) parts.rail.push(bar([x, y1, S.nose1(y1) + h], [x, le, S.nose1(le) + h], p), bar([x, le, landingZ + h], [x, le - 0.25, landingZ + h], p));
    else parts.rail.push(bar([x, le, S.nose2(le) + h], [x, y1, S.nose2(y1) + h], p), bar([x, y1, S.topZ + h], [x, y1 + 0.25, S.topZ + h], p));
  };
  if (c.handrail.place === 'outer' || c.handrail.place === 'both') {
    rail(x1 - off, 1); rail(x0 + off, 2);
    // landing: wall handrail (y = y0) connecting both flights
    parts.rail.push(bar([x0 + off, y0 + off, landingZ + h], [x1 - off, y0 + off, landingZ + h], p), bar([x0 + off, y0 + off, landingZ + h], [x0 + off, le, landingZ + h], p), bar([x1 - off, y0 + off, landingZ + h], [x1 - off, le, landingZ + h], p));
  }
  if (c.handrail.place === 'inner' || c.handrail.place === 'both') { rail(S.f1[0] + off, 1); rail(S.f2[1] - off, 2); }

  // ---- balustrade: partition between the flights (along the slope of each flight), open side of the lower flight and the
  //      landing, guard rail at the stair opening on the upper floor (above the lower flight)
  const b = c.balustrade;
  if (b.type !== 'none') {
    const H = b.height, target = b.type === 'glass' ? parts.glass : parts.balustrade, th = b.type === 'solid' ? 0.08 : b.type === 'glass' ? 0.012 : 0.014;
    /** panel from (ya, za) to (yb, zb) — bottom along the step line, top H higher; x — panel axis */
    const panel = (x: number, ya: number, za: number, yb: number, zb: number) => {
      if (b.type === 'bars') {
        const len = Math.abs(yb - ya), k = Math.max(2, Math.round(len / 0.11));
        for (let i = 0; i <= k; i++) { const y = ya + ((yb - ya) * i) / k, z = za + ((zb - za) * i) / k; parts.balustrade.push(box(x - th / 2, x + th / 2, y - th / 2, y + th / 2, z + 0.03, z + H)); }
        parts.balustrade.push(bar([x, ya, za + H], [x, yb, zb + H], 'rect', 0.8), bar([x, ya, za + 0.06], [x, yb, zb + 0.06], 'rect', 0.5));
      } else {
        const z0 = b.type === 'glass' ? 0.05 : 0;
        target.push(prismYZ([[ya, za + z0], [yb, zb + z0], [yb, zb + H], [ya, za + H]], x - th / 2, x + th / 2));
        if (b.type === 'glass') parts.balustrade.push(bar([x, ya, za + H], [x, yb, zb + H], 'rect', 0.7));
      }
    };
    const inner1 = S.f1[0] - 0.012, inner2 = S.f2[1] + 0.012, east = x1 - 0.03;
    panel(inner1, y1, S.nose1(y1) - R, le, landingZ);                       // partition — lower flight side
    panel(inner2, le, landingZ, y1, S.topZ);                                 // partition — upper flight side
    panel(east, y1, S.nose1(y1) - R, le, landingZ);                          // lower flight, open side
    panel(east, le, landingZ, y0 + 0.03, landingZ);                          // landing, open side
    // guard rail on the upper floor: edge of the opening above the lower flight
    if (b.type === 'bars') {
      const k = Math.max(2, Math.round((x1 - S.f1[0]) / 0.11));
      for (let i = 0; i <= k; i++) { const x = S.f1[0] + ((x1 - S.f1[0]) * i) / k; parts.balustrade.push(box(x - th / 2, x + th / 2, y1 - 0.03 - th / 2, y1 - 0.03 + th / 2, S.topZ + 0.03, S.topZ + H)); }
      parts.balustrade.push(bar([S.f1[0], y1 - 0.03, S.topZ + H], [x1, y1 - 0.03, S.topZ + H], 'rect', 0.8));
    } else {
      target.push(box(S.f1[0], x1, y1 - 0.03 - th / 2, y1 - 0.03 + th / 2, S.topZ + (b.type === 'glass' ? 0.05 : 0), S.topZ + H));
      if (b.type === 'glass') parts.balustrade.push(bar([S.f1[0], y1 - 0.03, S.topZ + H], [x1, y1 - 0.03, S.topZ + H], 'rect', 0.7));
    }
  }

  const out: StairGeometries = {};
  for (const k of Object.keys(parts) as StairPart[]) {
    if (!parts[k].length) continue;
    // merging: a common attribute set (ExtrudeGeometry and BoxGeometry have the same: position, normal, uv); non-indexed
    const merged = mergeGeometries(parts[k].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    parts[k].forEach((g) => g.dispose());
    if (merged) out[k] = merged;
  }
  return out;
}
