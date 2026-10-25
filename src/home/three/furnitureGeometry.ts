// Parametric furniture meshes: generator parts (src/home/catalog/generators.ts) → one merged BufferGeometry per part
// material (few draw calls). UV in metres (wood / fabric textures at true scale).
// three.js frame: X = x (width), Y = z (height), Z = −y (item front towards local −Z; the group rotates about Y).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateParts, loftRing, partMotion, type LoftStation, type Part, type PartMotion } from '../catalog/generators';
import type { Dims } from '../model/types';

/** box (non-indexed) with UV in metres on every face */
export function meterBox(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const face = (n: [number, number, number], corners: [number, number, number][], uvs: [number, number][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...corners[i]); nor.push(...n); uv.push(...uvs[i]); }
  };
  face([0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [[0, 0], [sx, 0], [sx, sy], [0, sy]]);
  face([0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], [[0, 0], [sx, 0], [sx, sy], [0, sy]]);
  face([1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], [[0, 0], [sz, 0], [sz, sy], [0, sy]]);
  face([-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], [[0, 0], [sz, 0], [sz, sy], [0, sy]]);
  face([0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], [[0, 0], [sx, 0], [sx, sz], [0, sz]]);
  face([0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], [[0, 0], [sx, 0], [sx, sz], [0, sz]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function scaleUv(g: THREE.BufferGeometry, ku: number, kv: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  return g;
}

/** solid from a (y, z) cross-section extruded along x — in the item's three.js frame (X = x, Y = z, Z = −y); UV in metres.
 *  Every triangle is oriented with its face outwards (checked against the expected normal) — regardless of the outline winding. */
export function prismGeometry(profile: [number, number][], x0: number, x1: number): THREE.BufferGeometry {
  let P = profile;
  const area = P.reduce((s, q, i) => { const r = P[(i + 1) % P.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0);
  if (area < 0) P = [...P].reverse(); // outline counter-clockwise in (y, z)
  const pos: number[] = [], uv: number[] = [];
  const V = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], ua: number[], ub: number[], uc: number[], n: [number, number, number]) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ok = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0;
    const vs = ok ? [a, b, c] : [a, c, b], us = ok ? [ua, ub, uc] : [ua, uc, ub];
    vs.forEach((v) => pos.push(...v)); us.forEach((u) => uv.push(...u));
  };
  const tris = THREE.ShapeUtils.triangulateShape(P.map((q) => new THREE.Vector2(q[0], q[1])), []);
  for (const t of tris) {
    const [a, b, c] = t.map((i) => P[i]);
    tri(V(x1, a[0], a[1]), V(x1, b[0], b[1]), V(x1, c[0], c[1]), a, b, c, [1, 0, 0]);
    tri(V(x0, a[0], a[1]), V(x0, b[0], b[1]), V(x0, c[0], c[1]), a, b, c, [-1, 0, 0]);
  }
  let acc = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], ey = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ey, ez);
    if (L < 1e-9) continue;
    const n = V(0, ez / L, -ey / L); // outward normal of a CCW outline: (ez, −ey) in (y, z)
    const q0 = V(x0, a[0], a[1]), q1 = V(x1, a[0], a[1]), q2 = V(x1, b[0], b[1]), q3 = V(x0, b[0], b[1]);
    const u0 = [0, acc], u1 = [x1 - x0, acc], u2 = [x1 - x0, acc + L], u3 = [0, acc + L];
    tri(q0, q1, q2, u0, u1, u2, n); tri(q0, q2, q3, u0, u2, u3, n);
    acc += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** smooth solid from cross-sections (car body): superellipse rings joined by strips, closed ends; smoothed normals */
export function loftGeometry(stations: LoftStation[], cx: number, n = 28): THREE.BufferGeometry {
  const rings = stations.map((q) => loftRing(q, n, cx).map(([x, z]) => new THREE.Vector3(x, z, -q.y)));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let acc = 0;
  rings.forEach((r, k) => {
    if (k) acc += Math.abs(stations[k].y - stations[k - 1].y);
    let per = 0;
    r.forEach((v, i) => { if (i) per += v.distanceTo(r[i - 1]); pos.push(v.x, v.y, v.z); uv.push(per, acc); });
  });
  const at = (k: number, i: number) => k * n + (i % n);
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
    const a = at(k, i), b = at(k, i + 1), c = at(k + 1, i + 1), d = at(k + 1, i);
    idx.push(a, d, c, a, c, b);
  }
  // ends (fan from the section centre)
  for (const [k, flip] of [[0, true], [rings.length - 1, false]] as [number, boolean][]) {
    const q = stations[k], ci = pos.length / 3;
    pos.push(cx, (q.z0 + q.z1) / 2, -q.y); uv.push(0, 0);
    for (let i = 0; i < n; i++) { const a = at(k, i), b = at(k, i + 1); if (flip) idx.push(ci, a, b); else idx.push(ci, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // face outwards: orientation check (the normal at the highest point must point up)
  const ny = g.getAttribute('normal') as THREE.BufferAttribute;
  let top = 0; for (let i = 0; i < rings.length * n; i++) if (pos[i * 3 + 1] > pos[top * 3 + 1]) top = i;
  if (ny.getY(top) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  // non-indexed (like the other parts — common merging); smooth normals preserved
  return g.toNonIndexed();
}

/** part → geometry in the item's three.js frame */
export function partGeometry(p: Part): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (p.shape === 'prism' && p.profile) return prismGeometry(p.profile, p.c[0] - p.s[0] / 2, p.c[0] + p.s[0] / 2);
  if (p.shape === 'loft' && p.stations) return loftGeometry(p.stations, p.c[0]);
  if (p.shape === 'wheel') {
    g = scaleUv(new THREE.CylinderGeometry(p.s[1] / 2, p.s[1] / 2, p.s[0], 24, 1).toNonIndexed(), Math.PI * p.s[1], p.s[0]);
    g.rotateZ(Math.PI / 2); // cylinder axis along x
    if (p.rotZ) g.rotateY((p.rotZ * Math.PI) / 180);
    g.translate(p.c[0], p.c[2], -p.c[1]);
    return g;
  }
  if (p.shape === 'box') g = meterBox(p.s[0], p.s[2], p.s[1]);
  else if (p.shape === 'cyl') g = scaleUv(new THREE.CylinderGeometry(p.s[0] / 2, p.s[0] / 2, p.s[2], 20, 1).toNonIndexed(), Math.PI * p.s[0], p.s[2]);
  else g = scaleUv(new THREE.SphereGeometry(0.5, 16, 12).toNonIndexed().scale(p.s[0], p.s[2], p.s[1]), Math.PI * p.s[0], Math.PI * p.s[2] / 2);
  if (p.rotZ) g.rotateY((p.rotZ * Math.PI) / 180);
  g.translate(p.c[0], p.c[2], -p.c[1]);
  return g;
}

const cache = new Map<string, Map<string, THREE.BufferGeometry>>();
const merged = (parts: Part[], shift?: [number, number, number]) => {
  const bySlot = new Map<string, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const list = bySlot.get(p.slot) ?? [];
    list.push(partGeometry(p));
    bySlot.set(p.slot, list);
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [slot, list] of bySlot) { const g = mergeGeometries(list, false); if (shift) g.translate(...shift); g.computeBoundingBox(); g.computeBoundingSphere(); out.set(slot, g); list.forEach((x) => x.dispose()); }
  return out;
};

/** item geometries per part material (shared between items with the same dimensions); without moving parts (Part.move) */
export function furnitureGeometries(generator: string, dims: Dims, options: Record<string, unknown> = {}): Map<string, THREE.BufferGeometry> {
  const key = `${generator}|${dims.w.toFixed(4)}|${dims.d.toFixed(4)}|${dims.h.toFixed(4)}|${JSON.stringify(options)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = merged(generateParts(generator, dims, options).filter((p) => !p.move));
  cache.set(key, out);
  return out;
}

/** moving parts of an item (built-in cabinet door leaf) in the pivot frame: origin on the hinge axis — group rotation = opening */
export function furnitureMovingGeometries(generator: string, dims: Dims, options: Record<string, unknown> = {}): { motion: PartMotion; geoms: Map<string, THREE.BufferGeometry> } | null {
  const motion = partMotion(generator, dims, options);
  if (!motion) return null;
  const key = `move|${generator}|${dims.w.toFixed(4)}|${dims.d.toFixed(4)}|${dims.h.toFixed(4)}|${JSON.stringify(options)}`;
  let geoms = cache.get(key);
  if (!geoms) { geoms = merged(generateParts(generator, dims, options).filter((p) => p.move), [-motion.pivot[0], 0, motion.pivot[1]]); cache.set(key, geoms); }
  return { motion, geoms };
}

export const geometryCacheStats = () => ({ furnitureGeometries: cache.size });
