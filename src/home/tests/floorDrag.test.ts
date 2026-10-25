// Dragging FLOOR-STANDING furniture (model/floorDrag.ts): the item is moved on a horizontal plane through the GRAB POINT,
// not on the floor. Reported defect class ("small pointer motion → large displacement"): at eye level the ray through the
// item hit the floor far behind it — 40 px of pointer motion moved a tall cabinet by more than a metre.
// The test camera is a pinhole model independent of the engine: expected values follow from the camera geometry.
import { describe, expect, it } from 'vitest';
import { beginFloorDrag, FLOOR_DRAG, liftFloorDrag, moveFloorDrag, reanchorFloorDrag, type FloorDrag } from '../model/floorDrag';
import type { MountPointer } from '../model/mountDrag';
import type { Vec2, Vec3 } from '../model/types';

// ------------------------------------------------------------------ pinhole camera (LCS: z up)
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const W = 1200, H = 900, FOV = 70, TAN = Math.tan((FOV * Math.PI) / 360);
function camera(pos: Vec3, target: Vec3) {
  const f = unit(sub(target, pos)), r = unit(cross(f, [0, 0, 1])), up = cross(r, f), asp = W / H;
  const project = (p: Vec3): [number, number] => { const v = sub(p, pos), z = dot(v, f); return [((dot(v, r) / (z * TAN * asp) + 1) / 2) * W, ((1 - dot(v, up) / (z * TAN)) / 2) * H]; };
  const pointer = (px: number, py: number): MountPointer => {
    const x = ((px / W) * 2 - 1) * TAN * asp, y = (1 - (py / H) * 2) * TAN;
    return { kind: 'ray', origin: pos, dir: unit([f[0] + r[0] * x + up[0] * y, f[1] + r[1] * x + up[1] * y, f[2] + r[2] * x + up[2] * y]), mPerPx: (2 * TAN) / H, screen: [px, py], level: 'L1' };
  };
  return { project, pointer, at: (p: Vec3) => pointer(...project(p)) };
}
/** metres per pixel at 1 m from the camera: 2·tan(35°) / 900 */
const M_PX = (2 * TAN) / H;
const EYE = 1.68;
/** walk camera: eyes at 1.68 m, looking horizontally towards +Y (horizontal optical axis — a screen row = constant depth on a horizontal plane) */
const walkCam = () => camera([0, 0, EYE], [0, 10, EYE]);
const through = (d: FloorDrag, cam: ReturnType<typeof camera>, pts: [number, number][]) => pts.reduce((s, q) => moveFloorDrag(s, cam.pointer(q[0], q[1])), d);
const line = (a: [number, number], b: [number, number], n: number): [number, number][] => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n]);

describe('floor-standing item: the grab point stays under the pointer', () => {
  it('from eye level, grab at seat height (0.40 m), 40 px sideways → exactly the 40 px path at the grab distance (was: ×1.31)', () => {
    const cam = walkCam(), G: Vec3 = [0, 3, 0.4], g = cam.project(G);
    const d = through(beginFloorDrag([0, 3], G[2], cam.pointer(...g)), cam, line(g, [g[0] + 40, g[1]], 40));
    // same screen row ⇒ depth 3 m unchanged; sideways path = depth × pixels × metres per pixel at 1 m
    expect(M_PX).toBeCloseTo(0.0015560, 6);
    expect(d.x).toBeCloseTo(3 * 40 * M_PX, 4);                               // 0.1867 m (on the floor it would be 0.2451 m)
    expect(d.y).toBeCloseTo(3, 4);
  });
  it('tall cabinet grabbed at 1.50 m (18 cm below the eyes), 40 px sideways → 14 cm, not over a metre', () => {
    const cam = walkCam(), G: Vec3 = [0, 2.2, 1.5], g = cam.project(G);
    const d = through(beginFloorDrag([0, 2.5], G[2], cam.pointer(...g)), cam, line(g, [g[0] + 40, g[1]], 40));
    expect(d.x).toBeCloseTo(2.2 * 40 * M_PX, 4);                             // 0.1369 m (on the floor: 2.2 · 1.68 / 0.18 = 20.5 m depth → 1.28 m)
    expect(d.y).toBeCloseTo(2.5, 4);
  });
  it('grab ABOVE the eyes (2.00 m): the item still follows the pointer (on the floor the ray did not hit at all)', () => {
    const cam = walkCam(), G: Vec3 = [0.3, 2.4, 2.0], g = cam.project(G);
    const d = through(beginFloorDrag([0.3, 2.7], G[2], cam.pointer(...g)), cam, line(g, [g[0] - 30, g[1]], 30));
    expect(d.x).toBeCloseTo(0.3 - 2.4 * 30 * M_PX, 4);
    expect(d.y).toBeCloseTo(2.7, 4);
  });
  it('motion in depth: pointer on the image of the grab point moved 44 cm closer → item 44 cm closer', () => {
    const cam = walkCam(), G: Vec3 = [0, 3, 0.4], g = cam.project(G), to = cam.project([0, 2.56, 0.4]);
    const d = through(beginFloorDrag([0, 3.2], G[2], cam.pointer(...g)), cam, line(g, to, 60));
    expect(d.x).toBeCloseTo(0, 4);
    expect(d.y).toBeCloseTo(3.2 - 0.44, 3);
  });
  it('a grab at the item edge does not snap it under the pointer (constant grab offset)', () => {
    const cam = walkCam(), G: Vec3 = [0.5, 2.8, 0.4];
    const d0 = beginFloorDrag([0, 3], G[2], cam.at(G));
    expect([d0.x, d0.y]).toEqual([0, 3]);
    const d = through(d0, cam, line(cam.project(G), cam.project([0.7, 2.8, 0.4]), 30));
    expect(d.x).toBeCloseTo(0.2, 4);
    expect(d.y).toBeCloseTo(3, 4);
  });
  it('flat item on the floor (rug): grab plane = floor — as before', () => {
    const cam = camera([2, -4, 6], [2, 2, 0]), G: Vec3 = [2, 2, 0], to: Vec3 = [2.6, 1.5, 0];
    const d = through(beginFloorDrag([2, 2], 0, cam.at(G)), cam, line(cam.project(G), cam.project(to), 50));
    expect(d.x).toBeCloseTo(2.6, 4);
    expect(d.y).toBeCloseTo(1.5, 4);
  });
  it('oblique room view from above: an item grabbed at 0.8 m follows the pointer (was: faster than the pointer)', () => {
    const cam = camera([4, -3, 5.5], [4, 3, 0.4]), G: Vec3 = [4, 3, 0.8], to: Vec3 = [4.5, 3.4, 0.8];
    const d = through(beginFloorDrag([4, 3.1], G[2], cam.at(G)), cam, line(cam.project(G), cam.project(to), 80));
    expect(d.x).toBeCloseTo(4.5, 4);
    expect(d.y).toBeCloseTo(3.5, 4);
  });
});

describe('bounded gain when the grab plane is seen edge-on', () => {
  it('grab 8 cm below the eyes, pointer 5 px up: step ≤ 3 × frontal pixel at the grab distance (the unbounded target lies metres away)', () => {
    const cam = walkCam(), G: Vec3 = [0, 2, 1.6], g = cam.project(G);
    const d = through(beginFloorDrag([0, 2.3], G[2], cam.pointer(...g)), cam, line(g, [g[0], g[1] - 5], 5));
    const frontal = M_PX * Math.hypot(2, EYE - 1.6);                          // metres per pixel at the grab point distance (about 3.1 mm)
    const moved = Math.hypot(d.x - 0, d.y - 2.3);
    expect(moved).toBeGreaterThan(frontal * 5 * 0.9);                          // the item responds (moves away)
    expect(moved).toBeLessThanOrEqual(FLOOR_DRAG.gainMax * frontal * 5 * 1.02);
    expect(d.y).toBeGreaterThan(2.3);                                          // pointer up = farther
    expect(Math.abs(d.x)).toBeLessThan(1e-6);
  });
  it('after a bounded step, reversing the pointer reverses the item at once (the excess goes into the grab offset)', () => {
    const cam = walkCam(), G: Vec3 = [0, 2, 1.6], g = cam.project(G);
    const up = through(beginFloorDrag([0, 2.3], G[2], cam.pointer(...g)), cam, line(g, [g[0], g[1] - 5], 5));
    const back = moveFloorDrag(up, cam.pointer(g[0], g[1] - 4));
    expect(back.y).toBeLessThan(up.y);
  });
  it('pointer above the horizon of the grab plane (the ray misses): the item moves away in bounded steps; back below the horizon — a new grab without a jump', () => {
    const cam = walkCam(), G: Vec3 = [0, 2, 1.6], g = cam.project(G), horizon = H / 2;   // horizontal axis ⇒ horizon at half the screen height
    expect(g[1]).toBeGreaterThan(horizon);
    const d0 = beginFloorDrag([0, 2.3], G[2], cam.pointer(...g));
    const above = through(d0, cam, line(g, [g[0], horizon - 30], 12));
    expect(above.y).toBeGreaterThan(2.3);
    const moved = above.y - 2.3, travel = g[1] - (horizon - 30), frontalMax = M_PX * Math.hypot(above.y, 0.08);
    expect(moved).toBeLessThanOrEqual(FLOOR_DRAG.gainMax * frontalMax * travel);
    // pointer stays above the horizon — the item stays
    const still = moveFloorDrag(above, cam.pointer(g[0], horizon - 30));
    expect([still.x, still.y]).toEqual([above.x, above.y]);
    // back below the horizon: the first valid hit sets a new grab, the item does not jump
    const below = moveFloorDrag(still, cam.pointer(g[0], horizon + 40));
    expect([below.x, below.y]).toEqual([still.x, still.y]);
    const next = moveFloorDrag(below, cam.pointer(g[0] + 10, horizon + 40));
    expect(Math.hypot(next.x - below.x, next.y - below.y)).toBeLessThan(0.2);
    expect(next.x).toBeGreaterThan(below.x);
  });
});

describe('view change and plan view', () => {
  it('view change during the drag (a panel narrowed the scene, the camera moved): the grab is recomputed, the item stays; further motion from the new grab', () => {
    const cam = walkCam(), G: Vec3 = [0, 3, 0.4];
    const d = through(beginFloorDrag([0, 3], G[2], cam.at(G)), cam, line(cam.project(G), cam.project([0.3, 3, 0.4]), 30));
    const cam2 = camera([0.8, -0.5, EYE], [0.8, 10, EYE]);                   // camera moved
    const g2 = cam2.project([d.x, d.y, 0.4]);
    const re = reanchorFloorDrag(d, cam2.pointer(g2[0] + 55, g2[1] + 20));  // pointer "elsewhere" relative to the item after the view change
    expect([re.x, re.y]).toEqual([d.x, d.y]);
    const p0 = cam2.pointer(g2[0] + 55, g2[1] + 20), p1 = cam2.pointer(g2[0] + 75, g2[1] + 20);
    const m = moveFloorDrag(moveFloorDrag(re, p0), p1);
    // 20 px sideways in a row hitting the grab plane at some depth: path = depth × 20 px × metres per pixel
    const ray = p0 as Extract<MountPointer, { kind: 'ray' }>, depth = ((EYE - 0.4) / -ray.dir[2]) * ray.dir[1];
    expect(m.x - d.x).toBeCloseTo(depth * 20 * M_PX, 3);
  });
  it('plan view (pointer = plan point): position = point − grab offset, the grab height does not matter', () => {
    const plan = (q: Vec2): MountPointer => ({ kind: 'plan', q, mPerPx: 0.01, screen: [q[0] * 100, -q[1] * 100], view: 'L1' });
    const d0 = beginFloorDrag([5, 5], 1.2, plan([5.3, 4.9]));
    const d = moveFloorDrag(moveFloorDrag(d0, plan([5.6, 4.9])), plan([6.3, 5.4]));
    expect(d.x).toBeCloseTo(6, 9);
    expect(d.y).toBeCloseTo(5.5, 9);
  });
});

describe('grab plane height change (ceiling device under a ceiling of another height)', () => {
  // oblique view from above: a lamp under a 2.82 m ceiling grabbed 4 cm off its axis; the next room has a 2.77 m ceiling
  const cam = camera([6, 3, 9], [6, 9.8, 2.8]);
  it('the grab offset stays and the grabbed point is under the pointer at the NEW height (same ray, lower plane → point farther from the camera)', () => {
    const d0 = beginFloorDrag([6, 9.8], 2.82, cam.at([6.04, 9.8, 2.82]));
    const p = cam.at([9.54, 9.8, 2.82]), d1 = moveFloorDrag(d0, p);
    expect(d1.x).toBeCloseTo(9.5, 6); expect(d1.y).toBeCloseTo(9.8, 6);
    const d2 = liftFloorDrag(d1, 2.77, p);
    // point of the 2.77 plane under the same pointer (from the camera geometry) minus the 4 cm grab offset
    const k = (2.77 - 9) / (2.82 - 9), hit: Vec2 = [6 + (9.54 - 6) * k, 3 + (9.8 - 3) * k];
    expect(d2.z).toBe(2.77);
    expect(d2.x).toBeCloseTo(hit[0] - 0.04, 6); expect(d2.y).toBeCloseTo(hit[1], 6);
    expect(d2.grab).toEqual(d1.grab);
    // further motion on the new plane: the grabbed point under the pointer
    const d3 = moveFloorDrag(d2, cam.at([10.04, 10.2, 2.77]));
    expect(d3.x).toBeCloseTo(10.0, 6); expect(d3.y).toBeCloseTo(10.2, 6);
  });
  it('a ray that misses the new plane changes only the height (position unchanged)', () => {
    const walk = camera([0, 0, 1.68], [0, 10, 1.68]);
    const d0 = beginFloorDrag([0, 4], 2.6, walk.at([0, 4, 2.6]));
    const d1 = liftFloorDrag(d0, 1.0, walk.at([0, 4, 2.6]));               // an upward ray does not cross a plane below the eyes
    expect([d1.x, d1.y, d1.z]).toEqual([0, 4, 1.0]);
  });
});
