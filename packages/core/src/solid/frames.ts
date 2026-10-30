// Window frames and panes of the generated shell as plain triangle meshes (project coordinates, z up): a frame of four bars in
// the middle of the wall thickness, a mullion in wide windows, one pane. Boxes are built in the window's own frame (along the
// wall, through the wall, up), so the same generator serves walls at any angle and, later, roof windows in a slope.
import type { Vec3 } from '../package/types.ts';
import type { ShellWindow } from './openings.ts';

/** indexed triangle mesh with flat normals */
export interface PlainMesh { positions: Float32Array; normals: Float32Array; index: Uint32Array }

const FRAME_W = 0.06, FRAME_D = 0.07, GLASS_D = 0.024, MULLION_OVER = 1.6;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

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

/** bar of a window: u along the wall, d into the wall from the room face, z absolute */
function bar(w: ShellWindow, u0: number, u1: number, d0: number, d1: number, z0: number, z1: number): Quad[] {
  const o: Vec3 = [w.a[0] + w.dir[0] * u0 + w.out[0] * d0, w.a[1] + w.dir[1] * u0 + w.out[1] * d0, z0];
  return boxQuads(o, [w.dir[0] * (u1 - u0), w.dir[1] * (u1 - u0), 0], [w.out[0] * (d1 - d0), w.out[1] * (d1 - d0), 0], [0, 0, z1 - z0]);
}

/** frame bars and the pane of one window */
function windowParts(w: ShellWindow): { frame: Quad[]; glass: Quad[] } {
  const d0 = Math.max(0, (w.depth - FRAME_D) / 2), d1 = d0 + Math.min(FRAME_D, w.depth), f = Math.min(FRAME_W, w.width / 4, (w.z1 - w.z0) / 4);
  const frame = [
    ...bar(w, 0, w.width, d0, d1, w.z0, w.z0 + f), ...bar(w, 0, w.width, d0, d1, w.z1 - f, w.z1),
    ...bar(w, 0, f, d0, d1, w.z0 + f, w.z1 - f), ...bar(w, w.width - f, w.width, d0, d1, w.z0 + f, w.z1 - f),
  ];
  if (w.width > MULLION_OVER) frame.push(...bar(w, w.width / 2 - f / 2, w.width / 2 + f / 2, d0, d1, w.z0 + f, w.z1 - f));
  const g0 = (d0 + d1) / 2 - GLASS_D / 2;
  return { frame, glass: bar(w, f, w.width - f, g0, g0 + GLASS_D, w.z0 + f, w.z1 - f) };
}

/** frames and panes of a list of windows, each merged into one mesh */
export function windowMeshes(windows: ShellWindow[]): { frames: PlainMesh; glass: PlainMesh } {
  const parts = windows.map(windowParts);
  return { frames: toMesh(parts.flatMap((p) => p.frame)), glass: toMesh(parts.flatMap((p) => p.glass)) };
}
