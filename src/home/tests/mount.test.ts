// Mounting surfaces and dragging of wall objects (model/mount.ts, model/mountDrag.ts).
// Data: demo apartment (active in every unit test) — living room R1 (x 2.52…8.70, y 0.30…3.90, ceiling 2.60 m). The TV hangs on
// the north wall R1-w3 (y = 3.90, run from the north-east corner x = 8.70 towards x = 2.52, door D3 at x 3.20…4.10 into the
// bedroom R2); the east wall R1-w2 (x = 8.70, run from y = 0.30 to the corner y = 3.90) has window W2 (y 0.95…1.45, sill 1.05,
// head 2.35). Cross-level picking and the facade use sample-house; a wall made of two data segments and a partition end shorter
// than a TV use the fixture src/test/fixtures/mount-lab.
// The test camera is a pinhole model independent of the engine: expected values follow from the camera geometry, not from engine code.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXT, mountSpace, mountSurfaces, pickFromRay, planeHit, surfaceById, surfaceOfWall, surfacePoint, surfaceU, wallAt, type MountSurface } from '../model/mount';
import {
  beginMountDrag, boxRect, checkMount, clampMount, fromWallMount, gridU, MOUNT, moveMountDrag, nudgeMount, mountPose, reanchorMountDrag, surfaceOfPose, toWallMount, transferMargin,
  type MountBox, type MountDrag, type MountPointer,
} from '../model/mountDrag';
import type { LevelId, Vec3 } from '../model/types';
import { withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { fixtureDir } from '../../test/setup';

const house = readProjectDir(path.resolve(__dirname, '..', '..', '..', 'projects', 'sample-house'));
const lab = readProjectDir(fixtureDir('mount-lab'));
const inHouse = <T,>(fn: () => T): T => withProject(house, fn);
const inLab = <T,>(fn: () => T): T => withProject(lab, fn);

// ------------------------------------------------------------------ pinhole camera (LCS: z up)
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
function camera(pos: Vec3, target: Vec3, fov = 50, W = 900, H = 890, level: LevelId = 'L1') {
  const f = unit(sub(target, pos)), r = unit(cross(f, [0, 0, 1])), up = cross(r, f), tan = Math.tan((fov * Math.PI) / 360), asp = W / H;
  const project = (p: Vec3): [number, number] => { const v = sub(p, pos), z = dot(v, f); return [((dot(v, r) / (z * tan * asp) + 1) / 2) * W, ((1 - dot(v, up) / (z * tan)) / 2) * H]; };
  const pointer = (px: number, py: number): MountPointer => {
    const x = ((px / W) * 2 - 1) * tan * asp, y = (1 - (py / H) * 2) * tan;
    return { kind: 'ray', origin: pos, dir: unit([f[0] + r[0] * x + up[0] * y, f[1] + r[1] * x + up[1] * y, f[2] + r[2] * x + up[2] * y]), mPerPx: (2 * tan) / H, screen: [px, py], level };
  };
  return { project, pointer, at: (p: Vec3) => pointer(...project(p)) };
}
const near = (a: number[], b: number[], digits = 6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], digits));

// 65″ TV of the default arrangement: 1.45 × 0.84 × 0.05 m, underside 1.00 m above the floor (R1-tv in the project)
const TV: MountBox = { w: 1.45, h: 0.84, d: 0.05, anchor: 'bottom' };
const SOCKET: MountBox = { w: 0.085, h: 0.085, d: 0.02, anchor: 'center', edge: 0.05, vMin: 0.05, topMargin: 0.05 };
const wallTV = () => surfaceOfWall('R1', 'R1-w3')!;       // north wall y = 3.90 (u = 8.70 − x)
const wallE = () => surfaceOfWall('R1', 'R1-w2')!;        // east wall x = 8.70 (u = y − 0.30), the corner with the TV wall at u = 3.60
const U0 = 8.7 - 6.3, V0 = 1.0, ZC = V0 + TV.h / 2;       // TV position on the wall; height of its centre
/** pointer dragged through consecutive screen points (one event per point) */
const dragThrough = (d: MountDrag, cam: ReturnType<typeof camera>, pts: [number, number][], o = {}) => pts.reduce((s, q) => moveMountDrag(s, cam.pointer(q[0], q[1]), o), d);
const line = (a: [number, number], b: [number, number], n: number): [number, number][] => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n]);

describe('mounting surface = run of walls from corner to corner', () => {
  it('a room wall is one surface: segments, length, normal, openings in run coordinates', () => {
    const s = wallTV();
    expect(s.segments.map((g) => g.wallId)).toEqual(['R1-w3']);
    expect(s.length).toBeCloseTo(6.18, 6);                                  // 8.70 − 2.52
    expect(s.normal[0]).toBeCloseTo(0, 9); expect(s.normal[1]).toBe(-1);
    const door = s.holes.find((h) => h.id === 'D3')!;
    expect(door.kind).toBe('door');
    near([door.u0, door.u1, door.v0, door.v1], [4.6, 5.5, 0, 2.05]);       // x 4.10…3.20 measured from the corner x = 8.70
    expect(mountSurfaces('R1').length).toBe(4);
    expect(surfaceById(s.id)).toBe(s);
  });
  it('a wall made of several data segments (collinear outline vertices) is ONE surface; the door opening in run coordinates', () => inLab(() => {
    // fixture room LR: south wall y = 0.30 from x = 0.30 to 6.30 with an outline vertex at x = 3.50; exterior door D0 x 4.05…4.95
    const s = surfaceOfWall('LR', 'LR-w2')!;
    expect(s.segments.map((g) => g.wallId)).toEqual(['LR-w1', 'LR-w2']);
    expect(s.length).toBeCloseTo(6.0, 6);
    const door = s.holes.find((h) => h.id === 'D0')!;
    near([door.u0, door.u1], [3.75, 4.65]);
    expect(mountSurfaces('LR').length).toBeLessThan(9);                    // 9 outline edges → fewer surfaces
    // u on the surface ↔ data wall: the document record refers to the segment
    expect(wallAt(s, 4.2)).toEqual({ wallId: 'LR-w2', t: 1 });
    expect(surfaceU(s, 'LR-w2', 1)).toBeCloseTo(4.2, 9);
    near(surfacePoint(s, 4.2, 1.37), [4.5, 0.3, 1.37]);
  }));
  it('u on the surface ↔ wall in the data', () => {
    const s = wallTV();
    expect(wallAt(s, U0)).toEqual({ wallId: 'R1-w3', t: 2.4 });
    expect(surfaceU(s, 'R1-w3', 2.4)).toBeCloseTo(U0, 9);
    near(surfacePoint(s, U0, 1.37), [6.3, 3.9, 1.37]);
  });
  it('camera ray → (u, v) on the wall plane; a ray parallel to the wall or pointing away does not hit', () => {
    const s = wallTV(), o: Vec3 = [6.3, 0.5, 1.838], d = unit(sub([6.3, 3.9, ZC], o));
    const h = planeHit(s, o, d)!;
    expect(h.u).toBeCloseTo(U0, 6); expect(h.v).toBeCloseTo(ZC, 6);
    expect(planeHit(s, o, [1, 0, 0])).toBeNull();
    expect(planeHit(s, o, [0, -1, 0])).toBeNull();                          // plane behind the camera
  });
});

describe('dragging on the wall: a small pointer move = a small, predictable object move', () => {
  // camera facing the TV, 3.40 m from the wall face: 1 px = 2·tan(25°)·3.40 / 890 = 3.563 mm; the camera looks +Y, so screen left = −X = +u
  const cam = camera([6.3, 0.5, ZC + 0.418], [6.3, 3.9, ZC]);
  const MM_PX = (2 * Math.tan((25 * Math.PI) / 180) * 3.4) / 890;
  const c = cam.project([6.3, 3.9, ZC]);
  const begin = (at: [number, number] = c) => beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...at));
  it('10 px sideways → 3.6 cm along the wall, zero height change (was: a jump of several metres)', () => {
    expect(MM_PX).toBeCloseTo(0.003563, 5);
    const d = dragThrough(begin(), cam, line(c, [c[0] - 10, c[1]], 10));
    expect(d.out.u - U0).toBeCloseTo(10 * MM_PX, 3);
    expect(d.out.v).toBeCloseTo(V0, 6);
    expect(d.surface.id).toBe(wallTV().id);
  });
  it('1 cm one way, 1 cm back, then 5 cm: the object returns exactly to where it started', () => {
    const px = (m: number) => m / MM_PX;
    let d = dragThrough(begin(), cam, line(c, [c[0] - px(0.01), c[1]], 3));
    expect(d.out.u - U0).toBeCloseTo(0.01, 3);
    d = dragThrough(d, cam, line([c[0] - px(0.01), c[1]], c, 3));
    expect(d.out.u).toBeCloseTo(U0, 4);
    d = dragThrough(d, cam, line(c, [c[0] - px(0.05), c[1]], 6));
    expect(d.out.u - U0).toBeCloseTo(0.05, 3);
  });
  it('moving up changes the HEIGHT, not the position in plan', () => {
    const d = dragThrough(begin(), cam, line(c, [c[0], c[1] - 10], 10));
    expect(d.out.v - V0).toBeCloseTo(10 * MM_PX, 3);
    expect(d.out.u).toBeCloseTo(U0, 4);
  });
  it('GRAB near the edge: the object does not jump under the pointer; a 5 px move moves it by 5 px', () => {
    const edge = cam.project([6.3 - 0.6, 3.9, 1.55]);                       // 60 cm off the TV axis, 13 cm above its centre
    const d0 = begin(edge);
    expect(d0.out).toEqual({ u: U0, v: V0 });
    expect(d0.grab!.du).toBeCloseTo(0.6, 3); expect(d0.grab!.dv).toBeCloseTo(1.55 - V0, 3);
    const d = dragThrough(d0, cam, line(edge, [edge[0] - 5, edge[1]], 5));
    expect(d.out.u - U0).toBeCloseTo(5 * MM_PX, 3);
    expect(d.grab!.du).toBeCloseTo(0.6, 3);                                 // the grab is constant for the whole drag
  });
  it('pointer past the wall end and back: the object waits at the corner until the pointer returns to the grab point (the grab does not change)', () => {
    const s = wallTV(), end = s.length - TV.w / 2;
    // grab on the TV axis; the pointer runs along the wall 40 cm PAST the limit position of the axis, then back by 20 cm
    const at = (u: number) => cam.project(surfacePoint(s, u, ZC));
    let d = dragThrough(beginMountDrag(s, U0, V0, TV, cam.pointer(...at(U0))), cam, line(at(U0), at(end + 0.4), 60), { transfer: false });
    expect(d.out.u).toBeCloseTo(end, 6); expect(d.grab!.du).toBeCloseTo(0, 3);
    d = dragThrough(d, cam, line(at(end + 0.4), at(end + 0.2), 20), { transfer: false });
    expect(d.out.u).toBeCloseTo(end, 6);                                     // the pointer is still past the grab point — the object stays
    d = dragThrough(d, cam, line(at(end + 0.2), at(end - 0.1), 30), { transfer: false });
    expect(d.out.u).toBeCloseTo(end - 0.1, 3);                               // the pointer passed the grab point — the object is under it again
  });
  it('a view change during the drag (scene resize) does not move the object', () => {
    const d0 = dragThrough(begin(), cam, line(c, [c[0] - 8, c[1]], 4)), u1 = d0.out.u;
    // the side panel changes the scene width from 1250 to 900 px: the same screen pixel is now another ray
    const narrow = camera([6.3, 0.5, ZC + 0.418], [6.3, 3.9, ZC], 50, 1250, 890), p = narrow.pointer(c[0] - 8, c[1]);
    const d1 = moveMountDrag(reanchorMountDrag(d0, p), p);
    expect(d1.out.u).toBeCloseTo(u1, 6);
    expect(moveMountDrag(d1, narrow.pointer(c[0] - 9, c[1])).out.u - u1).toBeCloseTo(MM_PX, 3);
  });
});

describe('robust to the camera angle', () => {
  const around = (deg: number, dist = 3, h = 1.5): Vec3 => [6.3 - dist * Math.sin((deg * Math.PI) / 180), 3.9 - dist * Math.cos((deg * Math.PI) / 180), h];
  for (const deg of [0, 30, 60]) it(`${deg}°: the grabbed point stays under the pointer (exact tracking)`, () => {
    const cam = camera(around(deg), [6.3, 3.9, ZC]), grabAt: Vec3 = [6.0, 3.9, 1.25], c = cam.project(grabAt);
    const d0 = beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...c));
    const to: [number, number] = [c[0] - 14, c[1] - 6], d = dragThrough(d0, cam, line(c, to, 10));
    // the object point that was under the pointer is still under the pointer (within half a pixel)
    const now = cam.project(surfacePoint(wallTV(), d.u + d.grab!.du, d.v + d.grab!.dv));
    expect(Math.hypot(now[0] - to[0], now[1] - to[1])).toBeLessThan(0.5);
  });
  it('camera looking almost along the wall (88°): 1 px gives no more than gainMax × the pixel on the frontal plane', () => {
    const eye = around(88, 3.3, ZC), cam = camera(eye, [6.3, 3.9, ZC]), c = cam.project([6.3, 3.9, ZC]), s = wallTV();
    let d = beginMountDrag(s, U0, V0, TV, cam.pointer(...c)), moved = 0;
    for (let i = 1; i <= 20; i++) {
      // pixel on the frontal plane at the object distance (box centre) — a value from the camera geometry
      const centre = surfacePoint(s, d.u, d.v + TV.h / 2, TV.d / 2), frontal = cam.pointer(0, 0).mPerPx * Math.hypot(...sub(centre, eye));
      const n = moveMountDrag(d, cam.pointer(c[0] - i, c[1]), { transfer: false });
      expect(Math.abs(n.u - d.u)).toBeLessThanOrEqual(MOUNT.gainMax * frontal + 1e-9);
      moved += Math.abs(n.u - d.u); d = n;
    }
    expect(moved).toBeGreaterThan(0.1);                                     // the object moves (20 px ≈ 20 cm), it just does not jump
    // without the limit the projection onto the plane would give many times the frontal pixel for ONE pixel
    const ray = (px: number) => { const q = cam.pointer(px, c[1]); return q.kind === 'ray' ? planeHit(s, q.origin, q.dir)!.u : NaN; };
    const frontal = cam.pointer(0, 0).mPerPx * Math.hypot(...sub([6.3, 3.9, ZC], eye));
    expect(Math.abs(ray(c[0] - 1) - ray(c[0]))).toBeGreaterThan(5 * MOUNT.gainMax * frontal);   // about 9.6 cm per pixel here
  });
  it('after a limited step, reversing the pointer reverses the object at once (no "catching up")', () => {
    const cam = camera(around(88, 3.3, ZC), [6.3, 3.9, ZC]), c = cam.project([6.3, 3.9, ZC]);
    let d = beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...c));
    for (let i = 1; i <= 10; i++) d = moveMountDrag(d, cam.pointer(c[0] - i, c[1]));
    const fwd = d.u - U0, back = moveMountDrag(d, cam.pointer(c[0] - 9, c[1]));
    expect(Math.sign(back.u - d.u)).toBe(-Math.sign(fwd));
  });
  it('ray parallel to the wall: the object moves in the pointed direction, with a limited step', () => {
    const ray = (sx: number): MountPointer => ({ kind: 'ray', origin: [5.0, 2.5, ZC], dir: [1, 0, 0], mPerPx: 0.001, screen: [sx, 0], level: 'L1' });
    const d0 = beginMountDrag(wallTV(), U0, V0, TV, ray(0));
    expect(d0.grab).toBeNull();
    const d = moveMountDrag(d0, ray(4), { transfer: false });
    expect(d.u).toBeLessThan(U0); expect(U0 - d.u).toBeLessThan(0.05);    // +X is −u on this wall
    // with transfer: the ray points at another wall (x = 8.70) — the object moves onto it
    expect(moveMountDrag(d0, ray(4)).surface.id).toBe(wallE().id);
  });
});

describe('corner: wall lock, a deliberate transfer, no flicker', () => {
  // camera in the depth of the living room looking at the corner (8.70; 3.90) — both walls are visible
  const cam = camera([5.9, 0.6, 1.6], [7.925, 3.325, 1.3]);
  const onA = (x: number): [number, number] => cam.project([x, 3.9, ZC]);            // point of the TV wall
  const onB = (y: number): [number, number] => cam.project([8.7, y, ZC]);            // point of the wall at the corner
  const M = transferMargin(TV.w);
  /** pointer guided ALONG THE WALLS at a constant height: along wall A to the corner, then along wall B */
  const alongA = (x0: number, x1: number, n: number) => Array.from({ length: n }, (_, i) => onA(x0 + ((x1 - x0) * (i + 1)) / n));
  const alongB = (y0: number, y1: number, n: number) => Array.from({ length: n }, (_, i) => onB(y0 + ((y1 - y0) * (i + 1)) / n));
  const start = () => beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...onA(6.3)));
  it('the transfer margin grows with the object width (TV 21.5 cm, socket 7.85 cm)', () => {
    expect(M).toBeCloseTo(0.215, 6); expect(transferMargin(SOCKET.w)).toBeCloseTo(0.0785, 6);
  });
  it('reaching the corner: the object stops with its edge in the corner and stays on its wall', () => {
    const d = dragThrough(start(), cam, [...alongA(6.3, 8.695, 30), ...alongB(3.895, 3.9 - 0.1, 6)]);
    expect(d.surface.id).toBe(wallTV().id);
    expect(d.out.u).toBeCloseTo(TV.w / 2, 3);                                // the corner is the start of the TV wall run
    expect(d.candidate).toBe(wallE().id);                                    // hint: where the object would go
    expect(d.transfers).toBe(0);
  });
  it('pointer clearly on the adjacent wall → transfer; height kept; the object entirely on the new wall', () => {
    const d = dragThrough(start(), cam, [...alongA(6.3, 8.695, 30), ...alongB(3.895, 3.9 - 0.5, 12)]);
    expect(d.surface.id).toBe(wallE().id);
    expect(d.transfers).toBe(1);
    expect(d.out.v).toBeCloseTo(V0, 6);
    expect(d.out.u).toBeLessThanOrEqual(wallE().length - TV.w / 2 + 1e-6);
  });
  it('transfer with alignment on: height kept although an opening edge on the new wall lies 2 cm away (the axis lock moves to the new wall)', () => {
    // the adjacent wall has window W2; aligning the TOP to its head gives the underside at head − 0.84 m. The object hangs 2 cm
    // lower — within the capture distance (3.5 cm). The pointer moves horizontally: the user does not change the height.
    const head = Math.max(...wallE().holes.filter((h) => h.kind === 'glazing' || h.kind === 'window').map((h) => h.v1));
    expect(head).toBeCloseTo(2.35, 6);
    const V = head - TV.h - 0.02, z = V + TV.h / 2;
    expect(V).toBeGreaterThan(0.5);                                         // test condition: the object fits under the head
    const a = (x: number): [number, number] => cam.project([x, 3.9, z]), b = (y: number): [number, number] => cam.project([8.7, y, z]);
    const path = [...Array.from({ length: 30 }, (_, i) => a(6.3 + (2.395 * (i + 1)) / 30)), ...Array.from({ length: 16 }, (_, i) => b(3.895 - (0.9 * (i + 1)) / 16))];
    const d = dragThrough(beginMountDrag(wallTV(), U0, V, TV, cam.pointer(...a(6.3))), cam, path, { align: true, step: 0.01 });
    expect(d.surface.id).toBe(wallE().id);
    expect(d.transfers).toBe(1);
    expect(d.out.v).toBeCloseTo(V, 6);
    // the hand does not move the pointer perfectly horizontally: 8 mm lower at the corner (the axis lock holds the VISIBLE height, and
    // after the transfer that is what counts — not the raw pointer position)
    const drift = [...Array.from({ length: 30 }, (_, i) => cam.project([6.3 + (2.395 * (i + 1)) / 30, 3.9, z - (0.008 * (i + 1)) / 30])), ...Array.from({ length: 16 }, (_, i) => cam.project([8.7, 3.895 - (0.9 * (i + 1)) / 16, z - 0.008]))] as [number, number][];
    const e = dragThrough(beginMountDrag(wallTV(), U0, V, TV, cam.pointer(...a(6.3))), cam, drift, { align: true, step: 0.01 });
    expect(e.surface.id).toBe(wallE().id);
    expect(e.out.v).toBeCloseTo(V, 6);
  });
  it('pointer jitter around the corner (±5 cm) does not switch walls — in either direction', () => {
    let d = dragThrough(start(), cam, alongA(6.3, 8.65, 30));
    for (let i = 0; i < 20; i++) d = moveMountDrag(d, cam.pointer(...(i % 2 ? onB(3.9 - 0.05) : onA(8.7 - 0.05))));
    expect([d.surface.id, d.transfers]).toEqual([wallTV().id, 0]);
    // after the transfer: the same jitter does not bring the object back
    d = dragThrough(d, cam, alongB(3.895, 3.9 - 0.6, 10));
    expect(d.surface.id).toBe(wallE().id);
    for (let i = 0; i < 20; i++) d = moveMountDrag(d, cam.pointer(...(i % 2 ? onB(3.9 - 0.05) : onA(8.7 - 0.05))));
    expect([d.surface.id, d.transfers]).toEqual([wallE().id, 1]);
  });
  it('going back: only when clearly on the first wall (the same margin both ways)', () => {
    let d = dragThrough(start(), cam, [...alongA(6.3, 8.695, 30), ...alongB(3.895, 3.9 - 0.6, 12)]);
    d = dragThrough(d, cam, [...alongB(3.9 - 0.6, 3.895, 12), ...alongA(8.695, 8.7 - 0.1, 4)]);
    expect(d.surface.id).toBe(wallE().id);
    d = dragThrough(d, cam, alongA(8.7 - 0.1, 8.7 - 0.6, 10));
    expect(d.surface.id).toBe(wallTV().id); expect(d.transfers).toBe(2);
  });
  it('transfer disabled (height handle): the object never changes walls', () => {
    const d = dragThrough(start(), cam, [...alongA(6.3, 8.695, 20), ...alongB(3.895, 3.9 - 0.8, 10)], { transfer: false });
    expect(d.surface.id).toBe(wallTV().id);
  });
});

describe('moving into another room through an opening', () => {
  // camera in the living room facing door D3 (x 3.20…4.10) into the bedroom R2: the bedroom is visible through the opening
  const cam = camera([3.65, 0.5, 1.5], [3.65, 3.9, 1.0]);
  const through = cam.project([3.65, 3.9, 0.3]);                            // middle of the door opening, 30 cm above the floor
  it('a small device: pointer in the door opening → a wall of the next room', () => {
    const s = wallTV(), from = surfacePoint(s, 4.0, 0.3), d0 = beginMountDrag(s, 4.0, 0.3, SOCKET, cam.at(from));
    const d = dragThrough(d0, cam, line(cam.project(from), through, 20), { axes: 'u' });
    expect(d.surface.spaceId).toBe('R2');
    expect(d.out.v).toBeCloseTo(0.3, 6);                                    // height kept between rooms
  });
  it('a TV does not fit through a 90 cm door: it stays on the wall (door warning) instead of "falling" into the next room', () => {
    const d = dragThrough(beginMountDrag(wallTV(), U0, V0, TV, cam.at([6.3, 3.9, ZC])), cam, line(cam.project([6.3, 3.9, ZC]), cam.project([3.65, 3.9, ZC]), 40));
    expect(d.surface.id).toBe(wallTV().id);
    expect(checkMount(d.surface, TV, d.out.u, d.out.v).map((w) => w.kind)).toContain('door');
  });
});

describe('snapping helps, does not get in the way', () => {
  const cam = camera([6.3, 0.5, ZC + 0.418], [6.3, 3.9, ZC]), c = cam.project([6.3, 3.9, ZC]);
  const MM_PX = (2 * Math.tan((25 * Math.PI) / 180) * 3.4) / 890;
  /** distance from the nearest grid node, in steps */
  const offGrid = (x: number, step: number) => Math.abs(x / step - Math.round(x / step));
  it('5 cm grid measured from the LEFT corner of the wall; fine grid 1 cm', () => {
    const s = wallTV();
    expect(gridU(s, 4.583, 0.05)).toBeCloseTo(s.length - 1.6, 9);          // from the left corner: 1.597 → 1.60
    const d = dragThrough(beginMountDrag(s, U0, V0, TV, cam.pointer(...c)), cam, line(c, [c[0] - 8, c[1]], 4), { step: 0.05 });
    expect(offGrid(s.length - d.out.u, 0.05)).toBeCloseTo(0, 6);
    const fine = dragThrough(beginMountDrag(s, U0, V0, TV, cam.pointer(...c)), cam, line(c, [c[0] - 8, c[1]], 4), { step: MOUNT.gridFine });
    expect(offGrid(s.length - fine.out.u, 0.01)).toBeCloseTo(0, 6);         // 8 px = 2.9 cm → nearest node of the 1 cm grid
    expect(Math.abs(fine.out.u - fine.u)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(d.out.u - d.u)).toBeLessThanOrEqual(0.025 + 1e-9);      // snapping never moves farther than half a step
  });
  it('alignment to another object: captures within 3.5 cm, releases only after 5.5 cm (no flicker at the boundary)', () => {
    const s = wallTV(), other = { id: 'mirror', u0: 3.4, u1: 4.0, v0: 1.25, v1: 2.05 };
    const o = { align: true, others: () => [other] };
    // height: the TV top level with the mirror top at v = 2.05 − 0.84 = 1.21
    const up = (v: number): [number, number] => [c[0], c[1] - (v - V0) / MM_PX];
    let d = dragThrough(beginMountDrag(s, U0, V0, TV, cam.pointer(...c)), cam, line(c, up(1.18), 12), o);
    expect(d.out.v).toBeCloseTo(1.21, 6); expect(d.guides.some((g) => g.kind === 'v' && g.withId === 'mirror')).toBe(true);
    d = moveMountDrag(d, cam.pointer(...up(1.165)), o);                     // 4.5 cm from the candidate: still held
    expect(d.out.v).toBeCloseTo(1.21, 6);
    d = moveMountDrag(d, cam.pointer(...up(1.15)), o);                      // 6 cm: released
    expect(d.out.v).toBeCloseTo(1.15, 2);
    expect(d.v).toBeCloseTo(1.15, 2);                                       // the raw position was never changed by snapping
  });
  it('axis lock by direction: moving mainly sideways holds the height, moving mainly vertically holds the sideways position', () => {
    const side = dragThrough(beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...c)), cam, line(c, [c[0] - 50, c[1] - 6], 20), { align: true });
    expect(side.out.v).toBe(V0); expect(side.out.u - U0).toBeGreaterThan(0.15);
    const up = dragThrough(beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...c)), cam, line(c, [c[0] - 3, c[1] - 30], 15), { align: true });
    expect(up.out.u).toBeCloseTo(U0, 9); expect(up.out.v - V0).toBeCloseTo(30 * MM_PX, 2);
  });
  it('a small height change is possible from the first centimetre (the lock does not hold movement along its own axis)', () => {
    const d = dragThrough(beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...c)), cam, line(c, [c[0], c[1] - 5], 5), { align: true, step: MOUNT.gridFine });
    expect(d.out.v - V0).toBeCloseTo(0.02, 6);                               // 5 px = 1.8 cm → 1 cm grid
    const s2 = dragThrough(beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...c)), cam, line(c, [c[0] - 5, c[1]], 5), { align: true, step: MOUNT.gridFine });
    expect(Math.abs(s2.out.u - U0)).toBeGreaterThan(0.014);
  });
});

describe('bounds, step nudges, warnings', () => {
  it('the object does not leave the wall, go below the floor or above the ceiling', () => {
    const s = wallTV();
    expect(clampMount(s, TV, -3, -1)).toEqual({ u: TV.w / 2, v: 0 });
    const top = clampMount(s, TV, 99, 99);
    expect(top.u).toBeCloseTo(s.length - TV.w / 2, 9); expect(top.v).toBeCloseTo(2.6 - 0.84, 6);   // apartment ceiling 2.60
    expect(clampMount(s, SOCKET, 0, 0)).toEqual({ u: 0.05, v: 0.05 });
  });
  it('1 cm / 5 cm step by key or button', () => {
    const s = wallTV();
    expect(nudgeMount(s, TV, U0, V0, MOUNT.nudgeFine, 0)).toEqual({ u: 2.41, v: 1 });
    expect(nudgeMount(s, TV, U0, V0, 0, -MOUNT.nudge)).toEqual({ u: 2.4, v: 0.95 });
  });
  it('warnings: door opening, window, another object — none of them blocks', () => {
    const s = wallTV();
    expect(checkMount(s, TV, U0, V0)).toEqual([]);
    expect(checkMount(s, TV, 5.05, V0).map((w) => w.kind)).toEqual(['door']);
    expect(checkMount(s, TV, U0, V0, [{ id: 'm', name: 'Mirror', ...boxRect({ w: 0.6, h: 0.8, d: 0.03, anchor: 'bottom' }, U0 + 0.8, 1.2) }])[0]).toMatchObject({ kind: 'overlap', text: 'Overlaps: Mirror' });
    expect(checkMount(wallE(), TV, 0.9, 1.0).map((w) => w.kind)).toEqual(['window']);    // window W2 at u 0.65…1.15, from 1.05 m
  });
});

describe('mount record ↔ world position', () => {
  it('position on the surface → document record (data wall) → back', () => {
    const s = wallTV(), m = toWallMount(s, U0, V0);
    expect(m).toEqual({ wallId: 'R1-w3', u: 2.4, height: 1 });
    const back = fromWallMount('R1', m)!;
    expect(back.surface).toBe(s); expect(back.u).toBeCloseTo(U0, 9); expect(back.v).toBe(1);
    expect(fromWallMount('R1', { wallId: 'no-such-wall', u: 0, height: 1 })).toBeNull();
  });
  it('the world position follows from the record: footprint centre at the face (5 mm gap), back to the wall, underside height', () => {
    expect(mountPose(wallTV(), TV, U0, V0)).toEqual({ x: 6.3, y: 3.87, rot: 180, elevation: 1 });
    expect(mountPose(wallE(), TV, 2, 1.1)).toEqual({ x: 8.67, y: 2.3, rot: 90, elevation: 1.1 });
  });
  it('an item from an older record (x, y, rot): the surface it hangs on; moved away from the wall — none', () => {
    const S = mountSurfaces('R1');
    const at = surfaceOfPose(S, TV, { x: 6.3, y: 3.865, rot: 180, elevation: 1 })!;
    expect(at.surface.id).toBe(wallTV().id); expect(at.u).toBeCloseTo(U0, 6); expect(at.v).toBe(1);
    expect(surfaceOfPose(S, TV, { x: 6.3, y: 2.0, rot: 180, elevation: 1 })).toBeNull();
    expect(surfaceOfPose(S, TV, { x: 6.3, y: 3.865, rot: 0, elevation: 1 })).toBeNull();          // facing the wall
  });
});

describe('top view (plan): the same engine, the pointer as a plan point', () => {
  const plan = (x: number, y: number, px: [number, number], view: LevelId = 'L1'): MountPointer => ({ kind: 'plan', q: [x, y], mPerPx: 0.01, screen: px, view });
  it('moving along the wall keeps the grab; height unchanged', () => {
    const s: MountSurface = wallTV();
    let d = beginMountDrag(s, U0, V0, TV, plan(5.9, 3.6, [0, 0]));
    expect(d.grab!.du).toBeCloseTo(0.4, 9);
    d = moveMountDrag(d, plan(5.87, 3.55, [3, 0]));
    expect(d.out.u - U0).toBeCloseTo(0.03, 6); expect(d.out.v).toBe(V0);
  });
  it('wall furniture does not leave the building: a pointer outside the house outline does not move it onto the facade (devices may go there)', () => inHouse(() => {
    // sample-house: the living-room wall LK-w1 (y = 0.30) is an exterior wall; 0.30 m farther lies the facade face (y = 0) — the mounting
    // surface of outdoor devices. The plan pointer moves 20 cm past the facade.
    const s = surfaceOfWall('LK', 'LK-w1')!;
    const drag = (o: Parameters<typeof moveMountDrag>[2]) => [[8.42, 0.4], [8.42, 0.2], [8.42, 0.0], [8.42, -0.2]].reduce((d, q, i) => moveMountDrag(d, plan(q[0], q[1], [0, 20 * (i + 1)], 'L0'), o), beginMountDrag(s, 5.0, 0.95, TV, plan(8.42, 0.5, [0, 0], 'L0')));
    expect(drag({}).surface.exterior).toBe(true);                            // the engine itself allows the facade (outdoor socket)
    const d = drag({ accept: (x) => !x.exterior });
    expect(d.surface.id).toBe(s.id);
    expect(d.transfers).toBe(0);
    expect(d.candidate).toBeNull();
    expect(d.out.u).toBeCloseTo(5.0, 6); expect(d.out.v).toBe(0.95);
  }));
  it('corner in plan: another wall only when it is closer to the pointer by the margin', () => {
    const s = wallTV();
    let d = beginMountDrag(s, U0, V0, TV, plan(6.3, 3.8, [0, 0]));
    d = moveMountDrag(d, plan(8.43, 3.68, [213, 12]));                      // 22 cm from the TV wall, 27 cm from the side wall
    expect(d.surface.id).toBe(s.id);
    d = moveMountDrag(d, plan(8.58, 3.23, [228, 57]));                      // 67 cm from the TV wall, 12 cm from the side wall
    expect(d.surface.id).toBe(wallE().id);
  });
});

// Walking through the house points at walls of all levels (the stairs connect levels), but the slab between levels occludes:
// a ray from the ground floor aimed above the ceiling must not "see" walls of the room upstairs. Reported effect: a TV dragged
// in walk mode towards the ceiling moved onto a wall of the bedroom upstairs. Data: sample-house — the living room LK (L0, ceiling
// 2.70) lies under BR2 / B1 / BR1 (L1, floor +2.95); the stair opening of S1 is x 0.30…2.25 × y 0.30…3.46.
describe('walk: the slab hides walls of another level; the stair opening does not', () => {
  const ray = (o: Vec3, to: Vec3, level: LevelId = 'L0') => ({ level, origin: o, dir: unit(sub(to, o)), allLevels: true });
  const EYE_LK: Vec3 = [6.5, 5.0, 1.68];                                    // living room (ground floor), the main bedroom BR1 above it
  it('a ray from the living room above its ceiling does not pick walls of the bedroom upstairs', () => inHouse(() => {
    for (const to of [[3.43, 5.5, 3.9], [9.69, 5.5, 3.9], [6.5, 3.93, 3.6], [5.0, 7.69, 4.2]] as Vec3[]) {
      const pick = pickFromRay(ray(EYE_LK, to), 'wall', null);
      expect(pick === null || pick.room.level === 'L0', `target ${JSON.stringify(to)} → ${pick && pick.room.id}`).toBe(true);
    }
  }));
  it('a ray from the living room below the ceiling still picks a living-room wall (control: the slab hides nothing on its own level)', () => inHouse(() => {
    const pick = pickFromRay(ray(EYE_LK, [9.0, 0.3, 2.0]), 'wall', null)!;
    expect(pick.kind).toBe('wall');
    expect(pick.room.id).toBe('LK');
    expect(pick.kind === 'wall' && pick.wall.id).toBe('LK-w1');
  }));
  it('through the stair opening the landing wall upstairs is visible', () => inHouse(() => {
    // standing in the hall in front of the stairs looking up: the ray crosses the first-floor level (+2.95) at (1.35; 2.43) — in the opening
    const pick = pickFromRay(ray([1.5, 4.6, 1.68], [1.2, 0.3, 4.2]), 'wall', null);
    expect(pick && pick.kind === 'wall' && pick.room.level).toBe('L1');
  }));
  it('from upstairs down: the floor hides the ground-floor walls (a ray outside the stair opening picks an upstairs room)', () => inHouse(() => {
    const o: Vec3 = [6.5, 5.5, 2.95 + 1.68];
    const pick = pickFromRay({ level: 'L1', origin: o, dir: unit(sub([6.5, 3.95, 1.0], o)), allLevels: true }, 'wall', null);
    expect(pick && pick.room.level).toBe('L1');
  }));
  it('a TV dragged in walk mode towards a point above the ceiling stays on the living-room walls (was: transfer to the bedroom upstairs)', () => inHouse(() => {
    // TV on the living-room west wall LK-w4 (x = 3.42, u = 7.70 − y), centre at y = 2.00, 1.37 m
    const s = surfaceOfWall('LK', 'LK-w4')!, o: Vec3 = [7.0, 3.0, 1.68];
    const ptr = (t: Vec3, i: number): MountPointer => ({ kind: 'ray', origin: o, dir: unit(sub(t, o)), mPerPx: 0.0016, screen: [600 + i * 2.4, 700 - i * 2.1], level: 'L0', allLevels: true });
    let d = beginMountDrag(s, 5.7, 0.95, TV, ptr([3.42, 2.0, 1.37], 0));
    const seen = new Set<string>();
    for (let i = 1; i <= 160; i++) {
      const k = i / 160, t: Vec3 = [3.42 + 0.6 * k, 2.0 + 2.6 * k, 1.37 + (3.86 - 1.37) * k];
      d = moveMountDrag(d, ptr(t, i), { step: 0.01, align: true, accept: (x) => !x.exterior });
      seen.add(d.surface.spaceId);
      if (d.candidate) seen.add(surfaceById(d.candidate)!.spaceId);
    }
    expect([...seen]).toEqual(['LK']);                                       // neither a transfer nor a "move onto this wall" hint upstairs
    expect(d.transfers).toBe(0);
  }));
});

// ====================================================================================================================
// Adversarial sweep: defects reproduced in the app, here as engine tests. The cameras and the wall cut-away are the test's model
// (pinhole camera, cut-away boxes computed from the wall data) — not engine code.
// ====================================================================================================================
/**
 * Visibility of a point in the room view (cut-away model of three/cutaway.ts): the level section at height `cut`; the walls of the
 * room the camera stands behind disappear above an 8 cm plinth together with a 3 m band behind them (0.6 m margin past the wall ends).
 */
const cutaway = (roomId: string, eye: Vec3, cut = 2.3) => {
  const nearWalls = mountSpace(roomId)!.walls.filter((w) => (eye[0] - w.a[0]) * w.inward[0] + (eye[1] - w.a[1]) * w.inward[1] < -0.05);
  return (p: Vec3) => p[2] <= cut && !nearWalls.some((w) => {
    const t = (p[0] - w.a[0]) * w.dir[0] + (p[1] - w.a[1]) * w.dir[1], out = -((p[0] - w.a[0]) * w.inward[0] + (p[1] - w.a[1]) * w.inward[1]);
    return p[2] > 0.08 && p[2] < 4.5 && t > -0.6 && t < w.length + 0.6 && out > -0.01 && out < 3;
  });
};
/** camera pointer with a visibility function (room view with cut-away walls) */
const seeing = (cam: ReturnType<typeof camera>, visible: (p: Vec3) => boolean) => (px: number, py: number): MountPointer => ({ ...cam.pointer(px, py), visible } as MountPointer);
/** drag along a screen segment, one event per `step` px; returns the state after every event */
function trace(d: MountDrag, ptr: (px: number, py: number) => MountPointer, from: [number, number], to: [number, number], o: Parameters<typeof moveMountDrag>[2] = {}, step = 1): MountDrag[] {
  const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step)), out: MountDrag[] = [];
  for (let i = 1; i <= n; i++) { d = moveMountDrag(d, ptr(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n), o); out.push(d); }
  return out;
}
const FURNITURE = { step: 0.01, align: true, accept: (x: MountSurface) => !x.exterior };
/** default room view: camera high up behind the TV wall (north of the apartment), looking down into the room through the cut-away wall */
const DEFAULT_EYE: Vec3 = [0.43, 6.69, 14.04], DEFAULT_DIR: Vec3 = [0.2951, -0.4249, -0.8558];

describe('a wall object does not pass through a solid wall into another room', () => {
  // the TV is seen from behind. The pointer moves down the screen: the ray hits the wall plane BELOW the floor, and before that it
  // crosses the floor of the bedroom R2 (behind the wall). A 1.45 m TV does not fit through the 0.90 m door — it cannot end up there.
  const eye = DEFAULT_EYE, cam = camera(eye, [eye[0] + DEFAULT_DIR[0] * 15, eye[1] + DEFAULT_DIR[1] * 15, eye[2] + DEFAULT_DIR[2] * 15]);
  const ptr = seeing(cam, cutaway('R1', eye)), g = cam.project([6.3, 3.9, ZC]);
  const start = () => beginMountDrag(wallTV(), U0, V0, TV, ptr(...g));
  it('default view, 150 px down the screen: the TV stays on the living-room wall (no transfer to the bedroom behind it)', () => {
    const tr = trace(start(), ptr, g, [g[0], g[1] + 150], FURNITURE);
    expect([...new Set(tr.map((d) => d.surface.spaceId))]).toEqual(['R1']);
    expect(tr[tr.length - 1].transfers).toBe(0);
    expect(tr.every((d) => !d.candidate || surfaceById(d.candidate)!.spaceId === 'R1')).toBe(true);   // not even a "move" hint into the next room
    expect(tr[tr.length - 1].out.v).toBe(0);                                 // slid down to the floor and stays
  });
  it('default view, 520 px sideways (both ways): the TV does not end up in the bathroom, hallway or bedroom', () => {
    for (const dx of [520, -520]) {
      const tr = trace(start(), ptr, g, [g[0] + dx, g[1]], FURNITURE);
      expect([...new Set(tr.map((d) => d.surface.spaceId))], `dx ${dx}`).toEqual(['R1']);
    }
  });
});

describe('return from the room behind the door — pointer on the solid wall of the first room', () => {
  // camera in the living room facing the wall with door D3 (u 4.60…5.50). A 0.80 m mirror fits through the 0.90 m door: the pointer
  // in the door opening moves it onto the wall of R2 visible through the opening (as intended). The pointer returns to the solid
  // living-room wall: that wall is visible, the other one no longer is — the mirror must come back under the pointer.
  const MIRROR: MountBox = { w: 0.8, h: 0.9, d: 0.03, anchor: 'bottom' };
  const cam = camera([3.55, 0.5, 2.3], [3.55, 3.9, 1.3]);
  const onA = (u: number): [number, number] => cam.project(surfacePoint(wallTV(), u, 1.55));
  /** u of the living-room wall point (plane y = 3.90, u = 8.70 − x) under the pointer — from the ray geometry */
  const uUnder = (px: [number, number]) => { const p = cam.pointer(...px); return p.kind === 'ray' ? 8.7 - (p.origin[0] + (p.dir[0] * (3.9 - p.origin[1])) / p.dir[1]) : NaN; };
  const O = { accept: (x: MountSurface) => !x.exterior };
  const start = () => beginMountDrag(wallTV(), 4.13, 1.1, MIRROR, cam.pointer(...onA(4.13)));       // grab on the mirror axis (underside 1.10 m)
  it('the mirror returns to the living-room wall as soon as the pointer is on it past the reveal; mirror axis under the pointer, height kept', () => {
    const into = trace(start(), cam.pointer, onA(4.13), onA(5.05), O);
    expect(into[into.length - 1].surface.spaceId).toBe('R2');               // through the door — a passage the object fits through
    expect(into[into.length - 1].out.v).toBeCloseTo(1.1, 6);
    const n = 70, back = trace(into[into.length - 1], cam.pointer, onA(5.05), onA(4.33), O, Math.hypot(onA(4.33)[0] - onA(5.05)[0], onA(4.33)[1] - onA(5.05)[1]) / n);
    const d = back[back.length - 1];
    expect(d.surface.id).toBe(wallTV().id);                                  // was: still the wall of R2 (return only 0.4–0.5 m past the reveal)
    expect(d.out.u).toBeCloseTo(4.33, 3);
    expect(d.out.v).toBeCloseTo(1.1, 6);
    // the first event after which the mirror is back in the living room: the pointer at most 5 cm past the reveal (u = 4.60)
    const i = back.findIndex((x) => x.surface.spaceId === 'R1'), a = onA(5.05), b = onA(4.33);
    const at = uUnder([a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n]);
    expect(at).toBeLessThan(4.6 + 1e-6); expect(at).toBeGreaterThan(4.55);  // the reveal u = 4.60 already belongs to the solid wall
    expect(d.transfers).toBe(2);
  });
  it('pointer jitter at the reveal (±3 cm around u = 4.60) after the return does not toss the mirror between rooms', () => {
    let d = trace(start(), cam.pointer, onA(4.13), onA(5.05), O).pop()!;
    d = trace(d, cam.pointer, onA(5.05), onA(4.53), O).pop()!;
    expect(d.surface.spaceId).toBe('R1');
    const before = d.transfers;
    for (let i = 0; i < 20; i++) d = moveMountDrag(d, cam.pointer(...onA(i % 2 ? 4.57 : 4.63)), O);
    expect([d.surface.spaceId, d.transfers]).toEqual(['R1', before]);
  });
});

describe('pointer on the FLOOR — hysteresis and landing spot as in plan', () => {
  // camera in the living room looking at the corner of walls A (TV, y = 3.90) and B (x = 8.70). Floor point: dA from wall A, dB from wall B.
  const cam = camera([5.7, 0.6, 2.5], [8.025, 3.225, 1.2]);
  const floor = (dA: number, dB: number): Vec3 => [8.7 - dB, 3.9 - dA, 0];
  const start = () => beginMountDrag(wallTV(), U0, V0, TV, cam.at([6.3, 3.9, ZC]));     // grab on the TV axis
  const O = { accept: (x: MountSurface) => !x.exterior };
  it('corner bisector: pointer jitter of ±2 px does not switch walls (was: 39 switches in 40 passes, a 1 m jump)', () => {
    const q0 = cam.project(floor(1.3, 1.3)), qa = cam.project(floor(1.2, 1.3)), qb = cam.project(floor(1.3, 1.2));
    const L = Math.hypot(qb[0] - qa[0], qb[1] - qa[1]), dir = [(qb[0] - qa[0]) / L, (qb[1] - qa[1]) / L];
    expect(L).toBeGreaterThan(25);                                           // 10 cm of floor across the bisector is over 25 px: ±2 px = a few millimetres
    let d = trace(start(), cam.pointer, cam.project([6.3, 3.9, ZC]), q0, FURNITURE, 2).pop()!, changes = 0;
    for (let i = 0; i < 40; i++) {
      const n = moveMountDrag(d, cam.pointer(q0[0] + dir[0] * (i % 2 ? 2 : -2), q0[1] + dir[1] * (i % 2 ? 2 : -2)), FURNITURE);
      if (n.surface.id !== d.surface.id) changes++;
      d = n;
    }
    expect(changes).toBe(0);
  });
  it('transfer only when the picked floor spot is closer to the new wall by the margin (21.5 cm) — both ways', () => {
    const A = wallTV().id, B = wallE().id;
    let d = moveMountDrag(start(), cam.at(floor(1.3, 1.3)), O);
    expect(d.surface.id).toBe(A);
    d = moveMountDrag(d, cam.at(floor(1.3, 1.15)), O);                       // B closer by 15 cm (less than the margin): stays, with a hint
    expect([d.surface.id, d.candidate]).toEqual([A, B]);
    d = moveMountDrag(d, cam.at(floor(1.3, 1.05)), O);                       // B closer by 25 cm: transfer
    expect(d.surface.id).toBe(B);
    d = moveMountDrag(d, cam.at(floor(1.2, 1.3)), O);                        // A closer by 10 cm: stays on B
    expect(d.surface.id).toBe(B);
    d = moveMountDrag(d, cam.at(floor(1.05, 1.3)), O);                       // A closer by 25 cm: back
    expect([d.surface.id, d.transfers]).toEqual([A, 2]);
  });
  it('after a transfer chosen from the floor the object lands at the wall point NEAREST the picked spot (not where the ray crosses the wall plane below the floor)', () => {
    // floor spot (7.65; 1.90): 2.00 m from wall A, 1.05 m from wall B → the opposite point of wall B: u = 1.90 − 0.30 = 1.60
    let d = moveMountDrag(start(), cam.at(floor(2.0, 1.05)), O);
    expect(d.surface.id).toBe(wallE().id);
    expect(d.out.u).toBeCloseTo(1.6, 3);
    expect(d.out.v).toBeCloseTo(V0, 6);
    d = moveMountDrag(d, cam.at(floor(2.4, 0.8)), O);                        // farther on the floor: 40 cm along wall B and 25 cm closer to it
    expect(d.out.u).toBeCloseTo(1.2, 3);
    d = moveMountDrag(d, cam.at([8.7, 3.9 - 2.4, 0.3]), O);                  // the pointer moves onto the wall face above that spot: the object axis stays under it
    expect(d.out.u).toBeCloseTo(1.2, 3);
    expect(d.surface.id).toBe(wallE().id);
  });
  it('pointer moved away from the wall PERPENDICULARLY above the floor: the object stays opposite the pointer (was: it slid along the wall with the ray extended below the floor)', () => {
    // camera at an angle to the TV wall; pointer: TV axis on the wall → floor 0.25 / 0.5 / 1.0 m in front of the wall on the same axis (x = 6.30)
    const side = camera([3.5, 0.6, 2.4], [6.3, 3.9, 1.0]);
    let d = beginMountDrag(wallTV(), U0, V0, TV, side.at([6.3, 3.9, ZC]));
    for (const dist of [0.25, 0.5, 1.0]) {
      d = moveMountDrag(d, side.at([6.3, 3.9 - dist, 0]), { ...O, transfer: false });
      expect(d.out.u, `pointer ${dist} m from the wall`).toBeCloseTo(U0, 3);
    }
  });
});

describe('an object does not move onto a wall shorter than itself', () => {
  // fixture room LR: a partition enters the room from the north wall; its end face LR-w6 (y = 3.00, x 2.885…3.00) is 11.5 cm long.
  // The floor spot (2.9425; 2.69) is nearest to exactly that face (31 cm) — a 1.45 m TV used to hang on it, sticking out 66.75 cm on each side.
  // The TV starts on the north wall LR-w4 (y = 4.30, x 6.30 → 3.00, u = 6.30 − x) at u = 1.50.
  const stub = () => surfaceOfWall('LR', 'LR-w6')!;
  const tvWall = () => surfaceOfWall('LR', 'LR-w4')!;
  const eye: Vec3 = [4.8 - 5.87, 4.3 + 2.79, 14.04], cam = camera(eye, [eye[0] + DEFAULT_DIR[0] * 15, eye[1] + DEFAULT_DIR[1] * 15, eye[2] + DEFAULT_DIR[2] * 15], 50, 900, 890, 'L0');
  it('3D (default view): pointing at the floor at the partition end — the TV stays on a wall it fits on entirely', () => inLab(() => {
    expect(stub().length).toBeCloseTo(0.115, 6);
    const ptr = seeing(cam, cutaway('LR', eye)), g = cam.project([4.8, 4.3, 1.37]), q = cam.project([2.9425, 2.69, 0]);
    const tr = trace(beginMountDrag(tvWall(), 1.5, 0.95, TV, ptr(...g)), ptr, g, q, FURNITURE, 3);
    for (const d of tr) expect(d.surface.length, d.surface.id).toBeGreaterThanOrEqual(TV.w);
    for (const d of tr) expect(d.candidate === null || surfaceById(d.candidate)!.length >= TV.w, `hint ${d.candidate}`).toBe(true);
    const end = tr[tr.length - 1], r = boxRect(TV, end.out.u, end.out.v);
    expect(r.u0).toBeGreaterThanOrEqual(-1e-9); expect(r.u1).toBeLessThanOrEqual(end.surface.length + 1e-9);   // entirely on the wall
  }));
  it('top view: the same spot in plan — the TV does not move onto the 11.5 cm face; a socket (8.5 cm) may', () => inLab(() => {
    const plan = (x: number, y: number, px: [number, number]): MountPointer => ({ kind: 'plan', q: [x, y], mPerPx: 0.01, screen: px, view: 'L0' });
    const tv = moveMountDrag(beginMountDrag(tvWall(), 1.5, 0.95, TV, plan(4.8, 4.1, [0, 0])), plan(2.9425, 2.69, [186, 141]));
    expect(tv.surface.length).toBeGreaterThanOrEqual(TV.w);
    const socket = moveMountDrag(beginMountDrag(tvWall(), 1.5, 0.3, SOCKET, plan(4.8, 4.1, [0, 0])), plan(2.9425, 2.69, [186, 141]));
    expect(socket.surface.id).toBe(stub().id);
  }));
});

describe('the grab along the wall survives a transfer — the same part of the object under the pointer', () => {
  const cam = camera([5.7, 0.6, 2.5], [8.025, 3.225, 1.2]);
  const onA = (fromCorner: number): [number, number] => cam.project([8.7 - fromCorner, 3.9, ZC]);
  const onB = (fromCorner: number): [number, number] => cam.project([8.7, 3.9 - fromCorner, ZC]);
  const O = { accept: (x: MountSurface) => !x.exterior };
  it('TV grabbed on its axis, carried over the corner: when the pointer reaches 1.50 m from the corner the axis is under it (was: 0.50 m off)', () => {
    let d = beginMountDrag(wallTV(), U0, V0, TV, cam.pointer(...onA(U0)));
    expect(d.grab!.du).toBeCloseTo(0, 6);
    const along = trace(d, cam.pointer, onA(U0), onA(0), O);
    const turn = trace(along[along.length - 1], cam.pointer, onB(0), onB(0.3), O);
    d = turn[turn.length - 1];
    // right after the transfer: the TV does not fit closer to the corner than half its width — it stands at the corner and WAITS for the pointer
    expect(d.surface.id).toBe(wallE().id);
    expect(d.out.u).toBeCloseTo(wallE().length - TV.w / 2, 6);
    expect(d.grab!.du).toBeCloseTo(0, 6);                                    // grab unchanged (was: −0.5 m — a "new grab" from the clamped position)
    d = trace(d, cam.pointer, onB(0.3), onB(1.5), O).pop()!;
    expect(d.out.u).toBeCloseTo(wallE().length - 1.5, 3);
    // …and back onto wall A, 1.50 m from the corner
    d = trace(d, cam.pointer, onB(1.5), onB(0), O).pop()!;
    d = trace(d, cam.pointer, onA(0), onA(1.5), O).pop()!;
    expect(d.surface.id).toBe(wallTV().id);
    expect(d.out.u).toBeCloseTo(1.5, 3);
  });
  it('grab 40 cm off the axis: after the transfer the object axis is still 40 cm from the pointer (the grab offset along the wall is kept)', () => {
    // u of the TV wall decreases towards the corner of walls A and B: the grab du = −0.4 is the point 40 cm towards that corner
    let d = beginMountDrag(wallTV(), U0, V0, TV, cam.at([6.7, 3.9, ZC]));
    expect(d.grab!.du).toBeCloseTo(-0.4, 6);
    d = trace(d, cam.pointer, cam.project([6.7, 3.9, ZC]), onA(0), O).pop()!;
    d = trace(d, cam.pointer, onB(0), onB(2.0), O).pop()!;
    expect(d.surface.id).toBe(wallE().id);
    expect(d.grab!.du).toBeCloseTo(-0.4, 6);
    expect(d.out.u).toBeCloseTo(wallE().length - 2.0 + 0.4, 3);
  });
});

describe('a grab OUTSIDE the object box (fast first mouse move, device hit area) does not carry over to the new wall', () => {
  // The drag starts after a threshold, and the grab comes from the pointer position at THAT moment: with a fast mouse move the first
  // event lands a dozen pixels from the device (in the level view 15 px = 23 cm) — the pointer is then next to the socket (8.5 cm),
  // not on it. On the same wall the offset stays (no jump at the grab); after a transfer there is no "same part of the object" to keep
  // under the pointer — the object lands under the pointer with its nearest edge.
  const cam = camera([5.9, 0.6, 1.6], [7.925, 3.325, 1.3]);
  const onA = (fromCorner: number): [number, number] => cam.project([8.7 - fromCorner, 3.9, 0.3]);
  const onB = (fromCorner: number): [number, number] => cam.project([8.7, 3.9 - fromCorner, 0.3]);
  it('socket grabbed 23.5 cm off its axis: on its wall the offset stays, after a transfer over the corner the socket is under the pointer (± half its width)', () => {
    const s = wallTV(), u0 = 1.5;
    let d = beginMountDrag(s, u0, 0.3, SOCKET, cam.pointer(...onA(1.5 - 0.235)));   // pointer 23.5 cm closer to the corner than the socket axis
    expect(d.grab!.du).toBeCloseTo(-0.235, 6);
    d = trace(d, cam.pointer, onA(1.5 - 0.235), onA(0.6), { axes: 'u' }).pop()!;
    expect(d.out.u).toBeCloseTo(0.6 + 0.235, 4);                              // the same wall: no jump under the pointer
    d = trace(d, cam.pointer, onA(0.6), onA(0), { axes: 'u' }).pop()!;
    d = trace(d, cam.pointer, onB(0), onB(1.0), { axes: 'u' }).pop()!;
    expect(d.surface.id).toBe(wallE().id);
    expect(Math.abs(d.out.u - (wallE().length - 1.0))).toBeLessThanOrEqual(SOCKET.w / 2 + 1e-6);   // was: 23.5 cm from the pointer
    expect(Math.abs(d.grab!.du)).toBeLessThanOrEqual(SOCKET.w / 2 + 1e-9);
  });
});

describe('the step limit does not lose the grab along the wall when the object stands at its end', () => {
  // camera steeply from above (about 80° to the horizontal), 1 m in front of the wall: a vertical screen pixel covers several times more
  // on the wall than on the frontal plane — vertical motion is limited (gainMax), motion along the wall is not.
  const cam = camera([8.35, 2.925, 7.0], [8.35, 3.9, ZC]);
  const at = (u: number, v: number): [number, number] => cam.project(surfacePoint(wallTV(), u, v));
  it('an object clamped to the wall end waits for the pointer to return to the grab point also after a vertically limited step', () => {
    const s = wallTV(), end = TV.w / 2;                                      // the corner end of the run (u = 0)
    let d = beginMountDrag(s, 0.95, V0, TV, cam.pointer(...at(0.95, ZC)));
    d = trace(d, cam.pointer, at(0.95, ZC), at(0.35, ZC), { transfer: false }).pop()!;   // the pointer 37.5 cm past the limit position of the axis
    expect(d.out.u).toBeCloseTo(end, 6); expect(d.grab!.du).toBeCloseTo(0, 6);
    const frontal = cam.pointer(0, 0).mPerPx * Math.hypot(0, 3.9 - 2.925, 7.0 - ZC);   // metres per pixel on the frontal plane
    const up = trace(d, cam.pointer, at(0.35, ZC), at(0.35, 1.95), { transfer: false });
    const p0 = at(0.35, ZC), vAt = (py: number) => planeHit(s, [8.35, 2.925, 7.0], (cam.pointer(p0[0], py) as { dir: Vec3 }).dir)!.v;
    expect(Math.abs(vAt(p0[1]) - vAt(p0[1] - 1))).toBeGreaterThan(3 * frontal);   // test condition: 1 px vertically > the limit
    d = up[up.length - 1];
    expect(d.grab!.du).toBeCloseTo(0, 6);                                    // was: 0.375 — a "new grab" including the pointer path past the wall end
    d = trace(d, cam.pointer, at(0.35, 1.95), at(0.55, 1.95), { transfer: false }).pop()!;   // the pointer returns, but is still past the grab point
    expect(d.out.u).toBeCloseTo(end, 6);
  });
});

describe('the "drag further to move" hint only when the pointer is off the current surface', () => {
  // camera BEHIND the TV wall at eye height, in the bedroom (the wall is cut away — the TV is seen from behind): the ray through the
  // TV goes on and hits the face of the opposite wall. The pointer is on the TV — the user points at no other wall.
  const eye: Vec3 = [6.3, 6.5, 1.6], cam = camera(eye, [6.3, 3.9, ZC]), ptr = seeing(cam, cutaway('R1', eye));
  it('pointer on an object seen from behind: no candidate (was: constantly the opposite wall)', () => {
    const g = cam.project([6.3, 3.9, ZC]);
    const pick = pickFromRay({ level: 'L1', origin: eye, dir: (ptr(...g) as { dir: Vec3 }).dir, visible: cutaway('R1', eye) }, 'wall', null)!;
    expect(pick.kind === 'wall' && [pick.wall.id, pick.via]).toEqual(['R1-w1', 'face']);      // test condition: the south wall is visible behind the TV
    const tr = trace(beginMountDrag(wallTV(), U0, V0, TV, ptr(...g)), ptr, g, [g[0] + 30, g[1] - 12], FURNITURE);
    expect(tr.map((d) => d.candidate).filter(Boolean)).toEqual([]);
    expect(tr[tr.length - 1].surface.id).toBe(wallTV().id);
    expect(Math.abs(tr[tr.length - 1].out.u - U0)).toBeGreaterThan(0.05);     // the object follows the pointer on its own wall
  });
});

describe('the drag state tells when the pointer has left all surfaces (`away`)', () => {
  // camera in the living room facing the TV wall; a socket 30 cm above the floor on the axis x = 6.30
  const eye: Vec3 = [6.3, 0.5, 1.5], cam = camera(eye, [6.3, 3.9, 1.0]);
  // a pointer that points at nothing: camera above the apartment, the ray down to a point south of the apartment outline (6.30; −1.50);
  // it crosses the south wall plane 4.7 m above the floor and never meets the TV wall plane
  const ABOVE: Vec3 = [6.3, 3.0, 12];
  const sky: MountPointer = { kind: 'ray', origin: ABOVE, dir: unit(sub([6.3, -1.5, -0.12], ABOVE)), mPerPx: 0.0011, screen: [450, 900], level: 'L1' };
  const O = { axes: 'u' as const, rooms: 'any' as const };
  const start = () => beginMountDrag(wallTV(), U0, 0.3, SOCKET, cam.at([6.3, 3.9, 0.3]));
  it('on the wall, past the corner (there is an adjacent wall) and on the floor in front of the wall the pointer points at something; outside the apartment — at nothing', () => {
    expect(start().away).toBe(false);
    let d = moveMountDrag(start(), cam.at([5.8, 3.9, 0.3]), O);
    expect(d.away).toBe(false); expect(d.out.u).toBeCloseTo(U0 + 0.5, 4);
    d = moveMountDrag(d, cam.at([5.8, 3.9 - 0.6, 0]), O);                    // floor 60 cm in front of the wall: the nearest is the same wall
    expect([d.away, d.surface.id]).toEqual([false, wallTV().id]);
    d = moveMountDrag(d, cam.at([8.7, 3.9 - 0.04, 0.3]), O);                 // 4 cm past the corner: a candidate (adjacent wall), no transfer yet
    expect([d.away, d.surface.id, d.candidate]).toEqual([false, wallTV().id, wallE().id]);
    expect(pickFromRay({ level: 'L1', origin: ABOVE, dir: unit(sub([6.3, -1.5, -0.12], ABOVE)) }, 'wall', null)).toBeNull();
    d = moveMountDrag(d, sky, O);
    expect(d.away).toBe(true);
    expect(d.surface.id).toBe(wallTV().id);                                  // the object stays on its wall (clamped to its bounds)
    expect(moveMountDrag(d, cam.at([6.1, 3.9, 0.3]), O).away).toBe(false);   // the pointer is back on the wall
  });
  it('walk: a pointer on the CEILING of the room the object hangs in is not "away" — the device keeps its height and follows the pointer horizontally', () => {
    // socket on the wall y = 3.90 (x = 7.90; 1.30 m); the user stands at (7.40; 0.80), eyes at 1.68 m, and moves the pointer towards
    // (5.00; 3.40; 3.40) — above the living-room ceiling (2.60 m). The ray hits the ceiling at (6.12; 2.19) and crosses the wall plane
    // at x = 4.538 (u = 4.162), 1.13 m above the ceiling. A single-level project — there is no other wall up there.
    const eye: Vec3 = [7.4, 0.8, 1.68], ptr = (to: Vec3, px: number): MountPointer => ({ kind: 'ray', origin: eye, dir: unit(sub(to, eye)), mPerPx: 0.0016, screen: [px, 0], level: 'L1', allLevels: true });
    let d = beginMountDrag(wallTV(), 0.8, 1.3, SOCKET, ptr([7.9, 3.9, 1.3], 0));
    d = moveMountDrag(d, ptr([5.0, 3.4, 3.4], 900), O);
    expect(d.away).toBe(false);
    expect(d.surface.id).toBe(wallTV().id);
    expect(d.out.u).toBeCloseTo(8.7 - (7.4 - 2.4 * (3.1 / 2.6)), 2);
    // control: the same direction from the room-view camera (from above, the ray down to a point outside the apartment) points at nothing
    const above: Vec3 = [7.4, 1.8, 12];
    const lawn: MountPointer = { kind: 'ray', origin: above, dir: unit(sub([7.4, -1.5, -0.12], above)), mPerPx: 0.0016, screen: [900, 0], level: 'L1' };
    expect(moveMountDrag(beginMountDrag(wallTV(), 0.8, 1.3, SOCKET, { ...lawn, dir: unit(sub([7.9, 3.9, 1.3], above)), screen: [0, 0] } as MountPointer), lawn, O).away).toBe(true);
  });
  it('the height handle and a drag without transfer do not report "away" (the object just stands at the bound)', () => {
    expect(moveMountDrag(start(), sky, { axes: 'v', transfer: false }).away).toBe(false);
    expect(moveMountDrag(start(), sky, { transfer: false }).away).toBe(false);
  });
});

// A project WITHOUT a site (the demo apartment): there is no facade that, in a house, stops a ray coming from outside.
// Plan: living room R1 (x 2.52…8.70; y 0.30…3.90), the bedroom R2 north of it (y 4.02…6.70), door D3 between them (x 3.20…4.10).
describe('a project without an outside space — an exterior wall seen from outside occludes the interior', () => {
  const ray = (o: Vec3, to: Vec3, visible?: (p: Vec3) => boolean) => ({ level: 'L1', origin: o, dir: unit(sub(to, o)), visible });
  const section = (p: Vec3) => p[2] <= 2.3;                                   // level view: section at 2.30 m, no cut-away
  const OUTSIDE: Vec3 = [8.0, -6, 1.5];                                       // camera 6.3 m south of the living-room exterior wall (y = 0.30)
  it('a ray into a solid exterior wall from outside points at nothing (was: the wall 3.6 m behind it; through the door — 6.4 m behind it)', () => {
    expect(mountSpace(EXT)).toBeNull();                                      // test condition: a project without a site
    expect(pickFromRay(ray(OUTSIDE, [8.0, 0.3, 1.2], section), 'wall', null)).toBeNull();          // was: R1-w3 (living-room north wall)
    expect(pickFromRay(ray([3.65, -6, 1.5], [3.65, 0.3, 1.2], section), 'wall', null)).toBeNull();  // was: R2-w3 (through door D3, bedroom wall)
    expect(pickFromRay(ray(OUTSIDE, [8.0, 0.3, 1.2], section), 'area', null)).toBeNull();          // a ceiling device — the same
    expect(pickFromRay(ray(OUTSIDE, [8.0, 0.3, 0.02], section), 'wall', null)).toBeNull();         // bottom of the wall: the floor behind it is hidden too
  });
  it('room view: a CUT-AWAY (invisible) wall does not occlude — a ray through it points at the opposite wall, as before', () => {
    const eye: Vec3 = [5.6, -5, 1.6], vis = cutaway('R1', eye);
    expect(vis([6.0, 0.3, 1.36])).toBe(false);                               // test condition: the living-room south wall is cut away
    const far = pickFromRay(ray(eye, [6.0, 3.9, 1.2], vis), 'wall', null)!;
    expect(far.kind === 'wall' && [far.wall.id, far.via]).toEqual(['R1-w3', 'face']);
    const floor = pickFromRay(ray(eye, [6.0, 2.0, 0], vis), 'wall', null)!;  // the living-room floor seen through the cut-away wall
    expect(floor.kind === 'wall' && [floor.room.id, floor.via]).toEqual(['R1', 'nearest']);
    // the plinth of the cut-away wall (up to 8 cm above the floor) stays in the scene — it occludes like a wall
    expect(pickFromRay(ray(eye, [6.0, 0.3, 0.05], vis), 'wall', null)).toBeNull();
  });
  it('level view from above: a ray above the wall section hits the floor and room faces as before', () => {
    const high: Vec3 = [-2, -7, 14];
    const f = pickFromRay(ray(high, [6.0, 2.0, 0], section), 'wall', null)!;
    expect(f.kind === 'wall' && [f.room.id, f.via]).toEqual(['R1', 'nearest']);
    const n = pickFromRay(ray(high, [6.0, 3.9, 1.0], section), 'wall', null)!;
    expect(n.kind === 'wall' && [n.wall.id, n.via]).toEqual(['R1-w3', 'face']);
  });
  it('camera IN a room (walk): the wall of the next room is still visible through a door opening', () => {
    const p = pickFromRay(ray([3.65, 2.0, 1.6], [3.65, 6.7, 1.2]), 'wall', null)!;                  // from the living room through door D3 onto the bedroom north wall
    expect(p.kind === 'wall' && [p.room.id, p.wall.id]).toEqual(['R2', 'R2-w3']);
  });
  it('a project with a site (house): unchanged — a ray from outside is stopped by the facade', () => inHouse(() => {
    const p = pickFromRay({ level: 'L0', origin: [6, -4, 1.5], dir: unit(sub([6, 0.3, 1.2], [6, -4, 1.5])) }, 'wall', null)!;
    expect(p.kind === 'wall' && p.room.id).toBe(EXT);
  }));
});

describe('the axis lock: an object waiting at a corner does not lose its height', () => {
  // the pointer moves along a STRAIGHT SCREEN LINE from a point of wall A before the corner to a point of wall B — such a line is not
  // horizontal on wall B (the height under the pointer drifts by centimetres). After the transfer the object stands at the corner and waits
  // for the pointer; the pointer motion is SIDEWAYS, so the height must be held (the head of window W2 lies 2 cm away).
  const cam = camera([5.9, 0.6, 1.6], [7.925, 3.325, 1.3]);
  it('height kept although the object stands still for a while (clamped to the end of the new wall) and an opening edge is within capture', () => {
    const head = Math.max(...wallE().holes.filter((h) => h.kind === 'glazing' || h.kind === 'window').map((h) => h.v1));
    const V = head - TV.h - 0.02, z = V + TV.h / 2;
    const a = cam.project([6.3, 3.9, z]), b = cam.project([8.7 - 0.05, 3.9, z]), far = cam.project([8.7, 3.9 - 1.2, z]);
    let d = trace(beginMountDrag(wallTV(), U0, V, TV, cam.pointer(...a)), cam.pointer, a, b, { align: true, step: 0.01 }).pop()!;
    const tr = trace(d, cam.pointer, b, far, { align: true, step: 0.01 });
    d = tr[tr.length - 1];
    const E = wallE();
    expect(d.surface.id).toBe(E.id);
    expect(tr.filter((x) => x.surface.id === E.id && Math.abs(x.u - (E.length - TV.w / 2)) < 1e-9).length).toBeGreaterThan(20);   // test condition: the object waited at the corner
    expect(new Set(tr.filter((x) => x.surface.id === E.id).map((x) => x.out.v))).toEqual(new Set([Math.round(V * 1e4) / 1e4]));
    expect(d.out.u).toBeCloseTo(E.length - 1.2, 2);                          // grab on the axis: the axis under the pointer
  });
});

describe('openings on an upper level', () => {
  // regression: window sill_z / head_z are absolute heights — the compiler once wrote them relative to the level floor
  it('a first-floor window is at its sill / head above that floor (sample-house BR2, W7: sill 0.85, head 2.35)', () => inHouse(() => {
    const w7 = surfaceOfWall('BR2', 'BR2-w1')!.holes.find((h) => h.id === 'W7')!;
    expect(w7.kind).toBe('window');
    near([w7.v0, w7.v1], [0.85, 2.35]);
  }));
});
