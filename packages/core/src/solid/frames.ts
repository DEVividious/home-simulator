// Window frames and panes of the generated shell as plain triangle meshes (project coordinates, z up): a frame of four bars in
// the middle of the wall (or roof) thickness, a mullion in wide windows, one pane. Boxes are built in the window's own frame
// (along the width, up the window, out through the wall), so the same generator serves walls at any angle and roof windows in a
// slope.
import type { Vec3 } from '../package/types.ts';
import type { ShellWindow } from './openings.ts';

/** indexed triangle mesh with flat normals */
export interface PlainMesh { positions: Float32Array; normals: Float32Array; index: Uint32Array }

/** a window in its own frame: corner o, unit vectors along the width (u), up the window (v) and out through the wall (n); a
 *  polygonal glazing has its corners (s along u, t along v; counter-clockwise or not) */
export interface WindowFrame { o: Vec3; u: Vec3; v: Vec3; n: Vec3; width: number; height: number; depth: number; outline?: [number, number][] }

const FRAME_W = 0.06, FRAME_D = 0.07, GLASS_D = 0.024, MULLION_OVER = 1.6;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** a window in a wall: from the room face outwards, vertical */
export const wallFrame = (w: ShellWindow): WindowFrame => ({ o: [w.a[0], w.a[1], w.z0], u: [w.dir[0], w.dir[1], 0], v: [0, 0, 1], n: [w.out[0], w.out[1], 0], width: w.width, height: w.z1 - w.z0, depth: w.depth, ...(w.outline ? { outline: w.outline } : {}) });

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

/** the frame and pane of a polygonal glazing: a bar along every side, the pane the outline shrunk by the bar width */
function polygonParts(f: WindowFrame, poly: [number, number][]): { frame: Quad[]; glass: Quad[] } {
  const area = poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  const P = area < 0 ? [...poly].reverse() : poly, n = P.length;
  const d0 = Math.max(0, (f.depth - FRAME_D) / 2), d1 = d0 + Math.min(FRAME_D, f.depth), w = Math.min(FRAME_W, f.width / 4, f.height / 4);
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

/** frames and panes of a list of windows (in walls, or in their own frames), each merged into one mesh */
export function windowMeshes(windows: (ShellWindow | WindowFrame)[]): { frames: PlainMesh; glass: PlainMesh } {
  const parts = windows.map((w) => windowParts('o' in w ? w : wallFrame(w)));
  return { frames: toMesh(parts.flatMap((p) => p.frame)), glass: toMesh(parts.flatMap((p) => p.glass)) };
}
