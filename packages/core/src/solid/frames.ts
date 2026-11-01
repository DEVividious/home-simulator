// Window frames and panes of the generated shell as plain triangle meshes (project coordinates, z up): a frame of four bars in
// the middle of the wall (or roof) thickness, a mullion in wide windows, one pane; a polygonal glazing (a gable window) has a
// bar along every side and its glazing bars — the vertical ones as drawn, or as the user divides it (GlazingBars). Boxes are built in the window's own frame
// (along the width, up the window, out through the wall), so the same generator serves walls at any angle and roof windows in a
// slope.
import type { FreeWallJson, Vec3 } from '../package/types.ts';
import type { ShellWindow } from './openings.ts';

/** indexed triangle mesh with flat normals */
export interface PlainMesh { positions: Float32Array; normals: Float32Array; index: Uint32Array }

/** a window in its own frame: corner o, unit vectors along the width (u), up the window (v) and out through the wall (n); a
 *  polygonal glazing has its corners (s along u, t along v; counter-clockwise or not) */
export interface WindowFrame { o: Vec3; u: Vec3; v: Vec3; n: Vec3; width: number; height: number; depth: number; outline?: [number, number][]; mullions?: number[] }

/** a horizontal glazing bar: `t` up from the bottom of the window; from frame to frame, or only between `s0` and `s1` (along its
 *  width — e.g. the vertical bars bounding one pane) */
export interface GlazingRow { t: number; s0?: number; s1?: number }
/** the bars dividing a polygonal glazing: vertical ones at `at` (along its width, frame to frame) and horizontal ones (`rows`) */
export interface GlazingBars { at: number[]; rows: GlazingRow[] }
/** visible width of the frame and of the glazing bars [m] */
export const GLAZING_BAR = 0.06;

const FRAME_W = GLAZING_BAR, FRAME_D = 0.07, GLASS_D = 0.024, MULLION_OVER = 1.6;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** a window in a wall: from the room face outwards, vertical */
export const wallFrame = (w: ShellWindow): WindowFrame => ({ o: [w.a[0], w.a[1], w.z0], u: [w.dir[0], w.dir[1], 0], v: [0, 0, 1], n: [w.out[0], w.out[1], 0], width: w.width, height: w.z1 - w.z0, depth: w.depth, ...(w.outline ? { outline: w.outline } : {}), ...(w.mullions ? { mullions: w.mullions } : {}) });

/** box o + s·ex + t·ey + u·ez (s, t, u ∈ [0, 1]) as 6 quads, counter-clockwise from outside whatever the handedness of the edges */
type Quad = { p: [Vec3, Vec3, Vec3, Vec3]; n: Vec3 };
function boxQuads(o: Vec3, ex: Vec3, ey: Vec3, ez: Vec3): Quad[] {
  const c = (s: number, t: number, u: number) => add(add(add(o, mul(ex, s)), mul(ey, t)), mul(ez, u));
  const centre = c(0.5, 0.5, 0.5);
  const faces: [Vec3, Vec3, Vec3, Vec3][] = [
    [c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)], [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], [c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)], [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
  ];
  return faces.map((p) => {
    const n = unit(cross([p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]));
    const mid = mul(add(add(p[0], p[1]), add(p[2], p[3])), 0.25), outward = [mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]] as Vec3;
    return dot(n, outward) >= 0 ? { p, n } : { p: [p[0], p[3], p[2], p[1]], n: mul(n, -1) };
  });
}

function toMesh(quads: Quad[]): PlainMesh {
  const positions = new Float32Array(quads.length * 12), normals = new Float32Array(quads.length * 12), index = new Uint32Array(quads.length * 6);
  quads.forEach((q, i) => {
    q.p.forEach((p, k) => { positions.set(p, i * 12 + k * 3); normals.set(q.n, i * 12 + k * 3); });
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  return { positions, normals, index };
}

/** bar of a window: s along the width, d out from the inner face, t up the window */
function bar(f: WindowFrame, s0: number, s1: number, d0: number, d1: number, t0: number, t1: number): Quad[] {
  const o = add(add(add(f.o, mul(f.u, s0)), mul(f.n, d0)), mul(f.v, t0));
  return boxQuads(o, mul(f.u, s1 - s0), mul(f.n, d1 - d0), mul(f.v, t1 - t0));
}

/** where a line crosses a polygon: the range of the other coordinate on the line `axis` = v (0: s, 1: t), or null */
function spanAt(poly: [number, number][], axis: 0 | 1, v: number): [number, number] | null {
  const o = 1 - axis, hits: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[axis] - v) * (b[axis] - v) > 0 || a[axis] === b[axis]) continue;
    hits.push(a[o] + ((v - a[axis]) / (b[axis] - a[axis])) * (b[o] - a[o]));
  }
  return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
}

/** the glazing bars inside the pane `inner` (frame to frame): a bar keeps within the pane at both its edges */
function barQuads(f: WindowFrame, inner: [number, number][], bars: GlazingBars, w: number, d0: number, d1: number): Quad[] {
  const out: Quad[] = [], e = Math.min(0.005, (d1 - d0) / 4);
  for (const s of bars.at) {
    const a = spanAt(inner, 0, s - w / 2), b = spanAt(inner, 0, s + w / 2);
    if (!a || !b) continue;
    const t0 = Math.max(a[0], b[0]), t1 = Math.min(a[1], b[1]);
    if (t1 - t0 > w) out.push(...bar(f, s - w / 2, s + w / 2, d0 + e, d1 - e, t0, t1));
  }
  for (const r of bars.rows) {
    const a = spanAt(inner, 1, r.t - w / 2), b = spanAt(inner, 1, r.t + w / 2);
    if (!a || !b) continue;
    const s0 = Math.max(a[0], b[0], r.s0 ?? -Infinity), s1 = Math.min(a[1], b[1], r.s1 ?? Infinity);
    if (s1 - s0 > w) out.push(...bar(f, s0, s1, d0 + e, d1 - e, r.t - w / 2, r.t + w / 2));
  }
  return out;
}

/** the frame and pane of a polygonal glazing: a bar along every side, the pane the outline shrunk by the bar width; its glazing
 *  bars (default: the vertical ones as drawn) */
function polygonParts(f: WindowFrame, poly: [number, number][], bars: GlazingBars = { at: f.mullions ?? [], rows: [] }): { frame: Quad[]; glass: Quad[] } {
  const area = poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  const P = area < 0 ? [...poly].reverse() : poly, n = P.length;
  const d0 = Math.max(0, (f.depth - FRAME_D) / 2), d1 = d0 + Math.min(FRAME_D, f.depth), w = Math.min(GLAZING_BAR, f.width / 4, f.height / 4);
  const at = (s: number, t: number, d: number): Vec3 => add(add(add(f.o, mul(f.u, s)), mul(f.v, t)), mul(f.n, d));
  const frame: Quad[] = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    // inward normal of a counter-clockwise side (left of a → b)
    const ins: [number, number] = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], e = at(b[0], b[1], 0), o = at(a[0], a[1], 0);
    frame.push(...boxQuads(at(a[0], a[1], d0), [e[0] - o[0], e[1] - o[1], e[2] - o[2]], add(mul(f.u, ins[0] * w), mul(f.v, ins[1] * w)), mul(f.n, d1 - d0)));
  }
  // the pane: every corner moved inwards along both sides' normals (a mitre), a fan of quads with a repeated corner
  const inner = P.map((p, i) => {
    const a = P[(i + n - 1) % n], c = P[(i + 1) % n], n1 = norm2([-(p[1] - a[1]), p[0] - a[0]]), n2 = norm2([-(c[1] - p[1]), c[0] - p[0]]), k = w / Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k] as [number, number];
  });
  frame.push(...barQuads(f, inner, bars, w, d0, d1));
  const g0 = (d0 + d1) / 2 - GLASS_D / 2, g1 = g0 + GLASS_D, glass: Quad[] = [];
  for (let i = 1; i + 1 < n; i++) for (const [d, flip] of [[g0, true], [g1, false]] as const) {
    const q: [Vec3, Vec3, Vec3, Vec3] = [at(inner[0][0], inner[0][1], d), at(inner[i][0], inner[i][1], d), at(inner[i + 1][0], inner[i + 1][1], d), at(inner[i + 1][0], inner[i + 1][1], d)];
    glass.push({ p: flip ? [q[0], q[3], q[2], q[1]] : q, n: flip ? mul(f.n, -1) : f.n });
  }
  return { frame, glass };
}
const norm2 = (a: [number, number]): [number, number] => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

/** frame bars and the pane of one window */
function windowParts(f: WindowFrame): { frame: Quad[]; glass: Quad[] } {
  if (f.outline && f.outline.length >= 3) return polygonParts(f, f.outline);
  const d0 = Math.max(0, (f.depth - FRAME_D) / 2), d1 = d0 + Math.min(FRAME_D, f.depth), w = Math.min(FRAME_W, f.width / 4, f.height / 4), W = f.width, H = f.height;
  const frame = [
    ...bar(f, 0, W, d0, d1, 0, w), ...bar(f, 0, W, d0, d1, H - w, H),
    ...bar(f, 0, w, d0, d1, w, H - w), ...bar(f, W - w, W, d0, d1, w, H - w),
  ];
  if (W > MULLION_OVER) frame.push(...bar(f, W / 2 - w / 2, W / 2 + w / 2, d0, d1, w, H - w));
  const g0 = (d0 + d1) / 2 - GLASS_D / 2;
  return { frame, glass: bar(f, w, W - w, g0, g0 + GLASS_D, w, H - w) };
}

/** the slats filling the openings of free-standing walls (vertical boxes, centred in the wall's thickness) */
export function slatMeshes(walls: readonly FreeWallJson[]): PlainMesh {
  const quads: Quad[] = [];
  for (const w of walls) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), u: Vec3 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L, 0], n: Vec3 = [-u[1], u[0], 0];
    for (const o of w.openings) {
      const f = o.infill;
      if (!f) continue;
      const span = o.t1 - o.t0, count = Math.max(1, Math.floor((span + f.gap) / (f.width + f.gap))), used = count * f.width + (count - 1) * f.gap, s0 = o.t0 + (span - used) / 2;
      const d = Math.min(f.depth, w.thickness);
      for (let i = 0; i < count; i++) {
        const s = s0 + i * (f.width + f.gap), o3: Vec3 = [w.a[0] + u[0] * s - n[0] * d / 2, w.a[1] + u[1] * s - n[1] * d / 2, o.z0];
        quads.push(...boxQuads(o3, mul(u, f.width), mul(n, d), [0, 0, o.z1 - o.z0]));
      }
    }
  }
  return toMesh(quads);
}

/** frames and panes of a list of windows (in walls, or in their own frames), each merged into one mesh; polygonFrames: false
 *  leaves out the frames of polygonal glazings (their panes stay) — the app draws them with the bars and colour the user chose */
export function windowMeshes(windows: (ShellWindow | WindowFrame)[], opts: { polygonFrames?: boolean } = {}): { frames: PlainMesh; glass: PlainMesh } {
  const parts = windows.map((w) => { const f = 'o' in w ? w : wallFrame(w), p = windowParts(f); return opts.polygonFrames === false && f.outline ? { frame: [], glass: p.glass } : p; });
  return { frames: toMesh(parts.flatMap((p) => p.frame)), glass: toMesh(parts.flatMap((p) => p.glass)) };
}

/** the frame and glazing bars of one polygonal glazing, as one mesh (the app colours it as the user chose) */
export function glazingFrameMesh(f: WindowFrame, bars: GlazingBars): PlainMesh {
  return f.outline && f.outline.length >= 3 ? toMesh(polygonParts(f, f.outline, bars).frame) : toMesh([]);
}

/** two meshes as one (the second's indices moved past the first's vertices) */
export function joinMeshes(a: PlainMesh, b: PlainMesh): PlainMesh {
  if (!b.index.length) return a;
  const nv = a.positions.length / 3, index = new Uint32Array(a.index.length + b.index.length);
  index.set(a.index); for (let i = 0; i < b.index.length; i++) index[a.index.length + i] = b.index[i] + nv;
  const positions = new Float32Array(a.positions.length + b.positions.length), normals = new Float32Array(positions.length);
  positions.set(a.positions); positions.set(b.positions, a.positions.length); normals.set(a.normals); normals.set(b.normals, a.normals.length);
  return { positions, normals, index };
}
