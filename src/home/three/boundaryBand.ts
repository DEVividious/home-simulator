// SELECTED SURFACE MARKER. A semi-transparent overlay over the whole selected wall / floor / ceiling would distort exactly the
// colour and material the user is choosing in the panel next to it. The marker must not change the colour being judged: a band
// is drawn along the EDGE of the surface (wall outline including openings, floor perimeter, ceiling perimeter including slopes)
// and the interior of the surface is left untouched.
// The band is built from the surface mesh alone, without any knowledge of rooms:
//   • a triangle edge is a boundary where no edge of another triangle lies against it — also when the neighbour is split
//     differently (T-junction seams between vertical wall strips next to an opening) or lies in another plane (ceiling break);
//   • for every boundary segment: a rectangle of band width, extended by that width at both ends, clipped to the surface
//     triangles in the same plane — a convex corner is trimmed, a concave one (opening corner) filled, and the band never
//     leaves the surface (narrow pier between openings, sloped ceiling).
// Pure TS + three types (no scene) — tests: tests/boundaryBand.test.ts.
import * as THREE from 'three';

/** position tolerance [m]: mesh coordinates are Float32 (≈ 2 µm at 20 m), surface finishes lie 3 mm in front of the wall */
const EPS = 1e-4;
interface Tri { p: THREE.Vector3[]; n: THREE.Vector3 }
interface Edge { t: number; a: THREE.Vector3; b: THREE.Vector3; u: THREE.Vector3; len: number; d: THREE.Vector3 }
/** surface boundary segment: endpoints, direction into the surface (in its plane), plane normal */
export interface BoundarySegment { a: THREE.Vector3; b: THREE.Vector3; inward: THREE.Vector3; normal: THREE.Vector3 }

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function triangles(geo: THREE.BufferGeometry): Tri[] {
  const pos = geo.getAttribute('position'), idx = geo.getIndex(), n = idx ? idx.count : pos?.count ?? 0, out: Tri[] = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const p = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k));
    const nn = new THREE.Vector3().subVectors(p[1], p[0]).cross(_v.subVectors(p[2], p[0]));
    if (nn.length() > 1e-9) out.push({ p, n: nn.normalize() });           // degenerate triangle — no edges and no band
  }
  return out;
}
function edges(tris: Tri[]): Edge[] {
  const out: Edge[] = [];
  tris.forEach((t, ti) => {
    for (let i = 0; i < 3; i++) {
      const a = t.p[i], b = t.p[(i + 1) % 3], u = new THREE.Vector3().subVectors(b, a), len = u.length();
      if (len < EPS) continue;
      u.divideScalar(len);
      const d = new THREE.Vector3().crossVectors(t.n, u);
      if (d.dot(_v.subVectors(t.p[(i + 2) % 3], a)) < 0) d.negate();          // into the triangle
      out.push({ t: ti, a, b, u, len, d });
    }
  });
  return out;
}
/** distance of a point from the line through an edge */
const offLine = (p: THREE.Vector3, e: Edge) => _w.subVectors(p, e.a).addScaledVector(e.u, -_w.dot(e.u)).length();
/** edges on one line: the endpoints of the SHORTER one lie on the line of the LONGER one (the short edge's direction is imprecise) */
const collinear = (e: Edge, f: Edge) => (e.len >= f.len ? offLine(f.a, e) < EPS && offLine(f.b, e) < EPS : offLine(e.a, f) < EPS && offLine(e.b, f) < EPS);

function segments(tris: Tri[]): BoundarySegment[] {
  const es = edges(tris), out: BoundarySegment[] = [];
  for (const e of es) {
    // intervals of the edge covered by an edge of another triangle (on the other side or in another plane)
    const cov: [number, number][] = [];
    for (const f of es) {
      if (f.t === e.t || !collinear(e, f)) continue;
      if (Math.abs(tris[f.t].n.dot(tris[e.t].n)) > 1 - 1e-6 && f.d.dot(e.d) > 0) continue;   // same side of the same plane: overlapping meshes, not a neighbour
      const s0 = _v.subVectors(f.a, e.a).dot(e.u), s1 = _v.subVectors(f.b, e.a).dot(e.u), lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(e.len, Math.max(s0, s1));
      if (hi - lo > EPS) cov.push([lo, hi]);
    }
    cov.sort((p, q) => p[0] - q[0]);
    const emit = (x0: number, x1: number) => { if (x1 - x0 > EPS) out.push({ a: e.a.clone().addScaledVector(e.u, x0), b: e.a.clone().addScaledVector(e.u, x1), inward: e.d, normal: tris[e.t].n }); };
    let s = 0;
    for (const [lo, hi] of cov) { emit(s, lo); s = Math.max(s, hi); }
    emit(s, e.len);
  }
  return out;
}
/** surface boundary: segments of triangle edges not covered by any other triangle */
export const boundarySegments = (geo: THREE.BufferGeometry): BoundarySegment[] => segments(triangles(geo));

type P2 = [number, number];
/** clips a convex polygon by the half-plane k · (p[axis] − c) ≥ 0 (Sutherland–Hodgman) */
function clip(poly: P2[], axis: 0 | 1, c: number, k: 1 | -1): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = k * (a[axis] - c), db = k * (b[axis] - c);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
  }
  return out;
}

/** band of `width` [m] along the surface boundary, lying ON the surface (same planes — drawn with a depth offset) */
export function boundaryBand(geo: THREE.BufferGeometry, width: number): THREE.BufferGeometry {
  const tris = triangles(geo), pos: number[] = [];
  for (const s of segments(tris)) {
    const u = new THREE.Vector3().subVectors(s.b, s.a), len = u.length();
    u.divideScalar(len);
    for (const q of tris) {
      if (Math.abs(q.n.dot(s.normal)) < 1 - 1e-6 || Math.abs(_v.subVectors(q.p[0], s.a).dot(s.normal)) > EPS) continue;   // another plane
      // triangle in the segment frame (x along the boundary from s.a, y into the surface) ∩ rectangle [−w, len + w] × [0, w]
      let poly: P2[] = q.p.map((v) => { _v.subVectors(v, s.a); return [_v.dot(u), _v.dot(s.inward)]; });
      poly = clip(clip(clip(clip(poly, 1, 0, 1), 1, width, -1), 0, -width, 1), 0, len + width, -1);
      for (let i = 1; i + 1 < poly.length; i++) {
        const [a, b, c] = [poly[0], poly[i], poly[i + 1]];
        if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-10) continue;
        for (const [x, y] of [a, b, c]) { _v.copy(s.a).addScaledVector(u, x).addScaledVector(s.inward, y); pos.push(_v.x, _v.y, _v.z); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
