// Room surface finishes (Room Mode, materials): thin 3 mm layers in front of wall faces / above the floor / below the ceiling
// of the building model — the building geometry is not changed. UV in metres: wall (t along the wall, z up), floor and ceiling (X, Y).
// Wall: vertical strips between break points (opening edges, glazing outline vertices, breaks of a sloped ceiling profile)
// → in each strip, trapezoids of solid wall between the openings. Sloped ceiling: height z(Y) = min(flat, slope).
import { shellSpec } from '../model/shell';
import { stairArrivesAt } from '../model/stairs';
import * as THREE from 'three';
import { area as polyArea } from '../model/geom2d';
import type { HomeRoom, RoomWall, WallHole } from '../model/rooms';
import type { Vec2 } from '../model/types';

export const SURFACE_OFFSET = 0.003;

const lcs = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

/** Y values where a sloped ceiling profile breaks (edges of the flat ceiling, ridge) */
function ceilingBreaksY(room: HomeRoom): number[] {
  const c = room.ceiling;
  if (c.kind !== 'attic') return [];
  const dy = (c.zAtRidge! - c.flatZ!) / c.slope!;
  return [c.ridgeY! - dy, c.ridgeY!, c.ridgeY! + dy];
}

/** ceiling height above the floor at wall position t */
const topAt = (room: HomeRoom, w: RoomWall, t: number) => room.ceiling.heightAt(w.a[0] + w.dir[0] * t, w.a[1] + w.dir[1] * t);

/** z range of an opening at position t (rectangular openings or a convex polygon in (t, z)) */
function holeAt(h: WallHole, t: number): [number, number] | null {
  if (!h.polygon) return t >= h.t0 - 1e-9 && t <= h.t1 + 1e-9 ? [h.z0, h.z1] : null;
  const zs: number[] = [];
  const P = h.polygon;
  for (let i = 0; i < P.length; i++) {
    const [ta, za] = P[i], [tb, zb] = P[(i + 1) % P.length];
    if ((t >= Math.min(ta, tb) - 1e-9) && (t <= Math.max(ta, tb) + 1e-9)) {
      if (Math.abs(tb - ta) < 1e-9) zs.push(za, zb); else zs.push(za + ((t - ta) / (tb - ta)) * (zb - za));
    }
  }
  return zs.length >= 2 ? [Math.min(...zs), Math.max(...zs)] : null;
}

/** solid wall intervals at position t: [0, top] minus the openings covering the strip */
function solidAt(top: number, holes: WallHole[], t: number): [number, number][] {
  let segs: [number, number][] = [[0, top]];
  for (const h of holes) {
    const z = holeAt(h, t);
    if (!z) continue;
    const [a, b] = [Math.max(0, z[0]), Math.min(top, z[1])];
    segs = segs.flatMap(([s0, s1]) => (b <= s0 || a >= s1 ? [[s0, s1]] : [[s0, a], [b, s1]].filter(([p, q]) => q - p > 1e-4)) as [number, number][]);
  }
  return segs;
}

/** wall finish geometry (three.js frame, offset by SURFACE_OFFSET into the room) */
export function wallGeometry(room: HomeRoom, w: RoomWall, offset = SURFACE_OFFSET): THREE.BufferGeometry {
  const ts = new Set<number>([0, w.length]);
  for (const h of w.holes) { ts.add(Math.max(0, h.t0)); ts.add(Math.min(w.length, h.t1)); h.polygon?.forEach((p) => ts.add(Math.min(w.length, Math.max(0, p[0])))); }
  if (Math.abs(w.dir[1]) > 0.5) for (const y of ceilingBreaksY(room)) { const t = (y - w.a[1]) / w.dir[1]; if (t > 0 && t < w.length) ts.add(t); }
  const T = [...ts].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1e-4);
  const pos: number[] = [], uv: number[] = [];
  const P = (t: number, z: number) => {
    const x = w.a[0] + w.dir[0] * t + w.inward[0] * offset, y = w.a[1] + w.dir[1] * t + w.inward[1] * offset;
    return lcs(x, y, room.floorZ + z);
  };
  for (let i = 0; i < T.length - 1; i++) {
    const ta = T[i], tb = T[i + 1], tm = (ta + tb) / 2;
    // openings covering the strip (by the strip centre) — both edges have the same topology
    const holes = w.holes.filter((h) => holeAt(h, tm));
    const A = solidAt(topAt(room, w, ta), holes, ta + 1e-6), B = solidAt(topAt(room, w, tb), holes, tb - 1e-6);
    const n = Math.min(A.length, B.length);
    for (let k = 0; k < n; k++) {
      const q = [P(ta, A[k][0]), P(tb, B[k][0]), P(tb, B[k][1]), P(ta, A[k][1])];
      const quv = [[ta, A[k][0]], [tb, B[k][0]], [tb, B[k][1]], [ta, A[k][1]]];
      // seen from inside the room t increases to the left — vertex order reversed (face towards the room)
      for (const j of [0, 2, 1, 0, 3, 2]) { pos.push(...q[j]); uv.push(...quv[j]); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** clips a polygon by the half-plane y ≥ y0 (sign 1) / y ≤ y0 (sign −1) — Sutherland–Hodgman */
function clipY(poly: Vec2[], y0: number, sign: 1 | -1): Vec2[] {
  const out: Vec2[] = [];
  const inside = (p: Vec2) => (p[1] - y0) * sign >= -1e-9;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) { const t = (y0 - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), y0]); }
  }
  return out;
}

const rectPoly = (r: [number, number, number, number]): Vec2[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

/** flat polygon (+ holes) at height z(x, y); UV = (X, Y) */
function flatGeometry(poly: Vec2[], holes: Vec2[][], zOf: (x: number, y: number) => number, flip: boolean): { pos: number[]; uv: number[] } {
  const pos: number[] = [], uv: number[] = [];
  if (polyArea(poly) < 1e-6) return { pos, uv };
  const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  const hs = holes.filter((h) => polyArea(h) > 1e-6).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  const pts = [...contour, ...hs.flat()];
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  for (const t of tris) {
    const idx = flip ? [t[0], t[2], t[1]] : t;
    // triangulation output has arbitrary winding — normal up for the floor, down for the ceiling
    const [a, b, c] = idx.map((i) => pts[i]);
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const ord = (cr > 0) !== flip ? idx : [idx[0], idx[2], idx[1]];
    for (const i of ord) { const p = pts[i]; pos.push(...lcs(p.x, p.y, zOf(p.x, p.y))); uv.push(p.x, p.y); }
  }
  return { pos, uv };
}

function toGeometry(parts: { pos: number[]; uv: number[] }[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap((p) => p.pos), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(parts.flatMap((p) => p.uv), 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Reveals of polygonal glazing set in the wall.
 * The frame of such a window sits in the OUTER face of the exterior wall, while the room's wall and floor finishes end at the
 * inner face — between them the wall section of the model and the slab below the floor were visible. Band from
 * the wall face to the frame: sides and top of the opening (wall material) and a sill at floor level (floor material).
 */
/** band depth: the exterior wall thickness of the project minus 2 mm — the frame (in the outer face) enters the band, so no
 *  bare wall section is left beside it */
export const revealDepth = () => shellSpec().exteriorWall - 0.002;
export function revealGeometry(room: HomeRoom, w: RoomWall, depth = revealDepth(), offset = SURFACE_OFFSET): { jambs: THREE.BufferGeometry | null; sill: THREE.BufferGeometry | null } {
  const jp: number[] = [], ju: number[] = [], sp: number[] = [], su: number[] = [];
  const P = (t: number, z: number, d: number): [number, number, number] => lcs(w.a[0] + w.dir[0] * t - w.inward[0] * d, w.a[1] + w.dir[1] * t - w.inward[1] * d, room.floorZ + z);
  for (const h of w.holes) {
    if (!h.polygon) continue;
    const poly = clipY(h.polygon, 0, 1);                                       // part of the opening above the room floor
    if (poly.length < 3) continue;
    const ct = poly.reduce((n, q) => n + q[0], 0) / poly.length, cz = poly.reduce((n, q) => n + q[1], 0) / poly.length;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-4) continue;
      // edge normal in the wall plane, towards the opening centre; band offset by `offset` from the model's reveal surface
      let n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      if ((ct - a[0]) * n[0] + (cz - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
      const floor = Math.abs(a[1]) < 1e-6 && Math.abs(b[1]) < 1e-6;
      const A: Vec2 = [a[0] + n[0] * offset, a[1] + n[1] * offset], B: Vec2 = [b[0] + n[0] * offset, b[1] + n[1] * offset];
      const q = [P(A[0], A[1], -offset), P(B[0], B[1], -offset), P(B[0], B[1], depth), P(A[0], A[1], depth)];
      // band face towards the opening centre: orientation from the cross product
      const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const c3 = P(ct, cz, depth / 2), toC = [c3[0] - q[0][0], c3[1] - q[0][1], c3[2] - q[0][2]];
      const order = nx * toC[0] + ny * toC[1] + nz * toC[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      const wx = (t: number, d: number) => [w.a[0] + w.dir[0] * t - w.inward[0] * d, w.a[1] + w.dir[1] * t - w.inward[1] * d];
      const uvs = floor ? [wx(A[0], -offset), wx(B[0], -offset), wx(B[0], depth), wx(A[0], depth)] : [[A[0], A[1]], [B[0], B[1]], [B[0] + depth, B[1]], [A[0] + depth, A[1]]];
      for (const j of order) { (floor ? sp : jp).push(...q[j]); (floor ? su : ju).push(...uvs[j]); }
    }
  }
  const make = (pos: number[], uv: number[]) => { if (!pos.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g; };
  return { jambs: make(jp, ju), sill: make(sp, su) };
}

/** floor (with a stair opening on the level the stairs arrive at from below) */
export function floorGeometry(room: HomeRoom, offset = SURFACE_OFFSET): THREE.BufferGeometry {
  const holes = room.stairOpening && stairArrivesAt(room.level) ? [rectPoly(room.stairOpening)] : [];
  return toGeometry([flatGeometry(room.polygon, holes, () => room.floorZ + offset, false)]);
}

/** ceiling: flat — with the stair opening; sloped — strips by profile breaks, with roof window openings */
export function ceilingGeometry(room: HomeRoom, offset = SURFACE_OFFSET): THREE.BufferGeometry {
  const zOf = (x: number, y: number) => room.floorZ + room.ceiling.heightAt(x, y) - offset;
  if (room.ceiling.kind === 'flat') {
    const holes = room.stairOpening ? [rectPoly(room.stairOpening)] : [];
    return toGeometry([flatGeometry(room.polygon, holes, zOf, true)]);
  }
  const ys = [-Infinity, ...ceilingBreaksY(room), Infinity];
  const parts = [];
  for (let i = 0; i < ys.length - 1; i++) {
    let piece = room.polygon;
    if (Number.isFinite(ys[i])) piece = clipY(piece, ys[i], 1);
    if (Number.isFinite(ys[i + 1])) piece = clipY(piece, ys[i + 1], -1);
    if (piece.length < 3) continue;
    const holes = room.roofWindows.map((w) => w.rect).filter((r) => r[1] >= ys[i] - 1e-6 && r[3] <= ys[i + 1] + 1e-6).map(rectPoly);
    parts.push(flatGeometry(piece, holes, zOf, true));
  }
  return toGeometry(parts);
}

/** wall finish area (check: length × height − openings) */
export function wallArea(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('uv') as THREE.BufferAttribute;
  let s = 0;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), bx = p.getX(i + 1), by = p.getY(i + 1), cx = p.getX(i + 2), cy = p.getY(i + 2);
    s += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  }
  return s;
}

/** room outline band on the floor (highlight of the current room): width inwards, mitred corners */
export function outlineBand(room: HomeRoom, width = 0.05, lift = 0.004): THREE.BufferGeometry {
  const P = room.polygon, n = P.length, pos: number[] = [];
  const inward = (a: Vec2, b: Vec2): Vec2 => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  const inner: Vec2[] = P.map((p, i) => {
    const n1 = inward(P[(i - 1 + n) % n], p), n2 = inward(p, P[(i + 1) % n]), k = width / Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
  const z = room.floorZ + lift;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = lcs(P[i][0], P[i][1], z), b = lcs(P[j][0], P[j][1], z), c = lcs(inner[j][0], inner[j][1], z), d = lcs(inner[i][0], inner[i][1], z);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
