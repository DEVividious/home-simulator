// Wall placement engine (model/elPlacement.ts), transient placement state (store/elPlace.ts) and the device catalog
// (model/devices.ts): moving to another wall, across a corner (hysteresis) and into another room in one drag, keeping the
// height, orientation from the wall normal, valid / invalid places, one drag = one history entry, copy, "Add many" series,
// lossless save and load (including the fields of a future Smart Home planner).
// Projects: the demo apartment (default — one level L1: living room R1, bedroom R2, bathroom R3, hallway R4), the
// placement-lab fixture (the demo apartment with a living-room wall made of two collinear segments, a lower bedroom ceiling
// and a sloped bathroom ceiling) and the sample house (facades and site: EXT).
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultDoc, docErrors, parseDoc, serializeDoc } from '../../document/model';
import { initHistory } from '../../history/history';
import { activateProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { fixtureDir } from '../../test/setup';
import { planNow } from '../actions';
import { DEVICE_CATEGORIES, DEVICES, devicesIn } from '../model/devices';
import { EL_TYPE_IDS, elRoom, elWall, EXT, measure, planErrors, snapAlong, wallRuns, type CoordContext, type ElPoint, type Placement } from '../model/electrical';
import {
  alignPlacement, checkPlacement, HYST_PLAN, HYST_RAY, placementInfo, placementOn, REACH, roomAtPlan, surfaceFromPlan, surfaceFromRay, wallFromPlan, wallRefOf, type Surface, type WallRef,
} from '../model/elPlacement';
import type { MountPointer } from '../model/mountDrag';
import type { Vec2, Vec3 } from '../model/types';
import { sceneApi } from '../scene/sceneApi';
import { design, redo, undo } from '../store/design';
import { beginCopy, beginHeight, beginMove, beginNew, cancelPlace, commitPlace, currentWall, dragTo, mountDragging, placeAt, placeNow, pointAt, setPlaceMulti } from '../store/elPlace';
import { ui } from '../store/ui';
import { boardGeometry, boardHeight, elShapeGeometry, shapeOf } from '../three/electricalGeometry';

const root = path.resolve(__dirname, '..', '..', '..');
const demo = () => readProjectDir(path.join(root, 'projects', 'demo-apartment'));
/** activates a project for the enclosing describe block and brings the demo apartment back afterwards */
const useProject = (load: () => ReturnType<typeof demo>) => { beforeAll(() => { activateProject(load()); }); afterAll(() => { activateProject(demo()); }); };
const LAB = () => readProjectDir(fixtureDir('placement-lab'));
const HOUSE = () => readProjectDir(path.join(root, 'projects', 'sample-house'));

const L = 'L1';                                                                         // the only level of the apartment
const wall = (s: Surface | null) => (s && s.kind === 'wall' ? s : null);
const past = () => design.get().history.past.length;
const reset = () => { cancelPlace(); design.set({ history: initHistory(defaultDoc()), draft: null }); ui.set({ elSnap: 0.05, elMulti: false, selection: null, elHeights: {}, elPanel: null }); };
/** pointer move in plan: place from the engine (with the current wall's hysteresis) → transient state */
const drag = (q: Vec2, view = L) => { const s = placeNow()!; placeAt(surfaceFromPlan(view, q, s.type, currentWall()), [0, 0]); };
const at = () => placeNow()!.at!;
const xOn = (s: Extract<Surface, { kind: 'wall' }>) => s.wall.a[0] + s.wall.dir[0] * s.t;

describe('device catalog: one definition = name, category, mounting, height, symbol', () => {
  it('every point type has a device; six catalog categories; sockets first', () => {
    for (const t of EL_TYPE_IDS) { const d = DEVICES[t]; expect(d.id).toBe(t); expect(d.name.length).toBeGreaterThan(3); expect(['WALL', 'CEILING', 'FLOOR', 'FREE']).toContain(d.mountType); expect(d.allowedSurfaces.length).toBeGreaterThan(0); }
    expect(DEVICE_CATEGORIES.map((c) => c.id)).toEqual(['sockets', 'lighting', 'control', 'smart', 'data', 'sensors']);
    expect(DEVICE_CATEGORIES.flatMap((c) => devicesIn(c.id)).length).toBe(EL_TYPE_IDS.length);
    expect(devicesIn('sockets')[1].name).toBe('Double socket');
  });
  it('heights: default from the type, quick values are suggestions (socket: 30 / 110 / 120 / above the worktop)', () => {
    expect(DEVICES['socket-2'].defaultHeight).toBe(0.3);
    expect(DEVICES['socket-2'].heightPresets.map((h) => h.label)).toEqual(['30 cm', '110 cm', '120 cm', 'above the worktop']);
    expect(DEVICES.switch.mountType).toBe('WALL'); expect(DEVICES.light.mountType).toBe('CEILING'); expect(DEVICES.light.heightPresets).toEqual([]);
  });
});

// demo apartment, living room R1 (x 2.52…8.7, y 0.3…3.9): R1-w1 south (window W1), R1-w2 east (window W2),
// R1-w3 north (door D3 to the bedroom), R1-w4 west (door D1 to the hallway)
describe('engine — PLAN: wall under the pointer, moving between walls and rooms', () => {
  it('pointer in a room → the nearest wall of THAT room (at any distance), position projected onto the wall', () => {
    const s = wall(wallFromPlan(L, [8.4, 2.0]))!;
    expect(s.room.id).toBe('R1'); expect(s.wall.id).toBe('R1-w2');
    expect(s.t).toBeCloseTo(2.0 - 0.3, 6);
    expect(wall(wallFromPlan(L, [5.6, 2.1]))!.room.id).toBe('R1');                         // middle of the room — still a wall of this room
  });
  it('moving along a wall, then ANOTHER WALL of the same room — no "change wall" step', () => {
    let cur: WallRef | null = null;
    const ids: string[] = [];
    for (const q of [[8.4, 1.0], [8.4, 2.5], [7.8, 3.6], [5.0, 3.6], [2.8, 2.5]] as Vec2[]) { const hit: Extract<Surface, { kind: 'wall' }> = wall(wallFromPlan(L, q, cur))!; cur = { roomId: hit.room.id, wallId: hit.wall.id }; ids.push(hit.wall.id); }
    expect(ids).toEqual(['R1-w2', 'R1-w2', 'R1-w3', 'R1-w3', 'R1-w4']);
  });
  it('CORNER: hysteresis — the wall changes only when the new one is clearly closer; pointer jitter does not switch', () => {
    const cur: WallRef = { roomId: 'R1', wallId: 'R1-w2' };                               // corner (8.7; 3.9) with the north wall w3
    // a point slightly closer to w3 than to w2 — without hysteresis it would switch
    const q: Vec2 = [8.7 - 0.30, 3.9 - 0.27];
    expect(wall(wallFromPlan(L, q))!.wall.id).toBe('R1-w3');
    expect(wall(wallFromPlan(L, q, cur))!.wall.id).toBe('R1-w2');
    // ±2 cm jitter around the corner diagonal: always the current wall
    for (const d of [-0.02, 0.02, -0.01, 0.015]) expect(wall(wallFromPlan(L, [8.7 - 0.3 + d, 3.9 - 0.3 - d], cur))!.wall.id).toBe('R1-w2');
    // clearly closer to the other wall (by more than the hysteresis) → switch
    expect(wall(wallFromPlan(L, [8.7 - 0.3, 3.9 - 0.3 + HYST_PLAN + 0.03], cur))!.wall.id).toBe('R1-w3');
  });
  it('a wall with a door opening is one wall: along the wall past the door the device follows the pointer on the same wall', () => {
    // R1-w4 (x = 2.52) with door D1 (y 1.0…1.9); pointer 30 cm in front of the wall
    let cur: WallRef = { roomId: 'R1', wallId: 'R1-w4' };
    for (let i = 0; i <= 120; i++) {
      const y = 0.6 + i * 0.02, s = wall(wallFromPlan(L, [2.82, y], cur))!;
      expect(s.wall.id, `pointer y = ${y.toFixed(2)}`).toBe('R1-w4');
      expect(Math.abs(s.wall.a[1] + s.wall.dir[1] * s.t - y)).toBeLessThanOrEqual(1e-6);
      cur = { roomId: s.room.id, wallId: s.wall.id };
    }
  });
  it('ANOTHER ROOM: the pointer crosses the wall into the neighbouring room → its wall (roomId, wallId, normal)', () => {
    let cur: WallRef | null = { roomId: 'R1', wallId: 'R1-w4' };
    const a = wall(wallFromPlan(L, [2.7, 2.2], cur))!;
    expect(a.room.id).toBe('R1');
    const b = wall(wallFromPlan(L, [2.2, 2.2], { roomId: a.room.id, wallId: a.wall.id }))!;   // hallway R4, by its east wall
    expect(b.room.id).toBe('R4'); expect(b.wall.id).toBe('R4-w2');
    const p = placementOn(b, 'socket-2', 0.3, 0.05)!;
    const m = measure({ ...p, type: 'socket-2' } as ElPoint)!;
    expect(m.normal).toEqual(elWall('R4', 'R4-w2')!.inward);                              // orientation from the new wall's normal
    cur = wallRefOf(p); expect(cur).toEqual({ roomId: 'R4', wallId: 'R4-w2' });
  });
  it('inside the wall between rooms: the nearest face; outside the apartment (no facades) — its own wall within reach, far away — no place', () => {
    expect(['R1', 'R4']).toContain(wall(wallFromPlan(L, [2.46, 2.2]))!.room.id);
    expect(elRoom(EXT)).toBeNull();
    const out = wall(wallFromPlan(L, [-0.3, 2.2]))!;                                     // 0.6 m outside the west wall of the hallway
    expect([out.room.id, out.wall.id]).toEqual(['R4', 'R4-w4']);
    expect(wallFromPlan(L, [0.3 - REACH - 0.5, 2.2])).toBeNull();
  });
  it('ceiling device: a point in the room (not a wall); a wall device does not accept the bare surface', () => {
    const s = surfaceFromPlan(L, [5.6, 2.1], 'light')!;
    expect(s.kind).toBe('area');
    const p = placementOn(s, 'light', 0, 0.05)!;
    expect(p.orientation).toBe('ceiling'); expect(p.roomId).toBe('R1'); expect(p.wallId).toBeNull();
    expect(placementOn(s, 'socket-1', 0.3)).toBeNull();
    expect(surfaceFromPlan(L, [-1, 2], 'light')).toBeNull();                              // no site outside the apartment
  });
});

// A straight wall may be split into segments in the data (outline vertices). Corner hysteresis must not act BETWEEN the
// segments of one wall: the device would stand still for tens of centimetres of pointer travel and then jump.
// placement-lab: south wall of R1 (y = 0.3) = R1-w1 [x 2.52…5.0] | R1-w2 [x 5.0…8.7], east wall R1-w3
describe('engine — wall made of collinear segments (placement-lab)', () => {
  useProject(LAB);
  it('fixture: one straight wall run of two segments', () => {
    expect(wallRuns('R1')[0].walls.map((w) => w.id)).toEqual(['R1-w1', 'R1-w2']);
  });
  it('along a straight wall across the segment joint (no corner) the device follows the pointer — one segment change, at the joint', () => {
    let cur: WallRef = { roomId: 'R1', wallId: 'R1-w1' };
    const changes: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const x = 4.4 + i * 0.02, s = wall(wallFromPlan(L, [x, 0.6], cur))!;
      expect(Math.abs(xOn(s) - x), `pointer x = ${x.toFixed(2)} → ${s.wall.id}`).toBeLessThanOrEqual(0.06);
      if (s.wall.id !== cur.wallId) changes.push(x);
      cur = { roomId: s.room.id, wallId: s.wall.id };
    }
    expect(changes.length).toBe(1);
    expect(Math.abs(changes[0] - 5.0)).toBeLessThanOrEqual(0.05);
  });
  it('the joint of a straight wall has no dead band — the 5 cm margin belongs to the CORNER, not to the joint', () => {
    // a margin from the end of every SEGMENT would leave 5 cm on both sides of the joint: without a grid the device would stop and
    // jump by 10 cm, with a 5 cm grid one position would be unreachable
    const xs: number[] = [];
    let cur: WallRef = { roomId: 'R1', wallId: 'R1-w1' };
    for (let i = 0; i <= 40; i++) {
      const x = 4.8 + i * 0.01, s = wall(wallFromPlan(L, [x, 0.6], cur))!, p = placementOn(s, 'socket-1', 0.3, 0)!;
      const w = elWall(p.roomId, p.wallId)!, px = w.a[0] + w.dir[0] * p.positionAlongWall;
      expect(Math.abs(px - x), `no grid: pointer x = ${x.toFixed(3)} → device x = ${px.toFixed(3)} (${p.wallId})`).toBeLessThanOrEqual(0.011);
      xs.push(px);
      cur = { roomId: s.room.id, wallId: s.wall.id };
    }
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1]), `step ${i}`).toBeLessThanOrEqual(0.021);
    // with a 5 cm grid (measured from the left corner of the run): consecutive positions every 5 cm, no 10 cm jump at the joint
    const grid = new Set<number>();
    cur = { roomId: 'R1', wallId: 'R1-w1' };
    for (let i = 0; i <= 80; i++) {
      const x = 4.8 + i * 0.005, s = wall(wallFromPlan(L, [x, 0.6], cur))!, p = placementOn(s, 'socket-1', 0.3, 0.05)!;
      const w = elWall(p.roomId, p.wallId)!;
      grid.add(Math.round((w.a[0] + w.dir[0] * p.positionAlongWall) * 1000));
      cur = { roomId: s.room.id, wallId: s.wall.id };
    }
    const g = [...grid].sort((a, b) => a - b);
    for (let i = 1; i < g.length; i++) expect(g[i] - g[i - 1], `grid positions ${g.join(', ')}`).toBeLessThanOrEqual(51);
    // the corner (end of the run) keeps the 5 cm margin
    const room = elRoom('R1')!;
    for (const r of wallRuns('R1')) {
      const a = r.walls[0], b = r.walls[r.walls.length - 1];
      expect(snapAlong(room, a, -1, 0), `run start ${a.id}`).toBeCloseTo(Math.min(0.05, a.length / 2), 6);
      expect(snapAlong(room, b, 99, 0), `run end ${b.id}`).toBeCloseTo(b.length - Math.min(0.05, b.length / 2), 6);
    }
  });
  it('hysteresis stays between DIFFERENT walls — also when the current wall consists of several segments', () => {
    // corner (8.7; 0.3) of the south wall (segment w2) and the east wall (w3); point 27 cm from the south wall, 25 cm from the east one
    const q: Vec2 = [8.7 - 0.25, 0.3 + 0.27];
    expect(wall(wallFromPlan(L, q))!.wall.id).toBe('R1-w3');
    for (const w of ['R1-w2', 'R1-w1']) expect(wall(wallFromPlan(L, q, { roomId: 'R1', wallId: w }))!.wall.id, `current segment ${w}`).toBe('R1-w2');
    expect(wall(wallFromPlan(L, [8.7 - 0.25, 0.3 + 0.27 + HYST_PLAN + 0.03], { roomId: 'R1', wallId: 'R1-w2' }))!.wall.id).toBe('R1-w3');
  });
  it('3D: corner hysteresis does not act at the joint of one wall — the face under the pointer 3 cm past the joint', () => {
    const o: Vec3 = [5.0, 3.0, 1.5], to: Vec3 = [5.0 + 0.03, 0.3, 0.3], d: Vec3 = [to[0] - o[0], to[1] - o[1], to[2] - o[2]], n = Math.hypot(...d);
    const s = wall(surfaceFromRay({ level: L, origin: o, dir: [d[0] / n, d[1] / n, d[2] / n] }, 'socket-1', { roomId: 'R1', wallId: 'R1-w1' }))!;
    expect(s.wall.id).toBe('R1-w2');
    expect(xOn(s)).toBeCloseTo(5.03, 3);
  });
});

describe('engine — 3D: camera ray → wall face / floor', () => {
  const eye: Vec3 = [5.6, 1.0, 9.0];                                                      // camera above the living room
  const ray = (to: Vec3) => { const d: Vec3 = [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]], n = Math.hypot(...d); return { level: L, origin: eye, dir: [d[0] / n, d[1] / n, d[2] / n] as Vec3 }; };
  it('ray into a wall face turned towards the camera → that wall, with the hit position and height', () => {
    const s = wall(surfaceFromRay(ray([5.0, 3.9, 1.0]), 'socket-1'))!;
    expect(s.room.id).toBe('R1'); expect(s.wall.id).toBe('R1-w3'); expect(s.via).toBe('face');
    expect(s.z).toBeCloseTo(1.0, 3);
    expect(s.t).toBeCloseTo(8.7 - 5.0, 3);
  });
  it('ray into the room floor → the nearest wall of that room (as in plan)', () => {
    const s = wall(surfaceFromRay(ray([8.5, 2.0, 0]), 'socket-1'))!;
    expect(s.room.id).toBe('R1'); expect(s.wall.id).toBe('R1-w2'); expect(s.via).toBe('nearest');
  });
  it('corner in 3D: the pointer passes the corner by less than the hysteresis → the device stays on the current wall', () => {
    const cur: WallRef = { roomId: 'R1', wallId: 'R1-w3' };
    // hit on the east wall w2 right at the corner: the plane of w3 is hit about 2 cm PAST the corner (x > 8.7)
    const near = ray([8.7, 3.9 - 0.02, 1.0]);
    expect(wall(surfaceFromRay(near, 'socket-1'))!.wall.id).toBe('R1-w2');
    expect(wall(surfaceFromRay(near, 'socket-1', cur))!.wall.id).toBe('R1-w3');
    const far = ray([8.7, 3.9 - 0.6, 1.0]);                                               // clearly on the other wall
    expect(wall(surfaceFromRay(far, 'socket-1', cur))!.wall.id).toBe('R1-w2');
    expect(HYST_RAY).toBeGreaterThan(0.03);
  });
  it('an invisible wall (section / cut-away) is not hit; through a door opening the next room is visible', () => {
    expect(surfaceFromRay({ ...ray([5.0, 3.9, 1.0]), visible: () => false }, 'socket-1')).toBeNull();
    // from the hallway R4 through door D1 (R4-w2: x = 2.4, y 1.0…1.9) — the ray does not stop at the wall with the door
    const o: Vec3 = [1.5, 1.45, 1.6], d: Vec3 = [1, 0, -0.05], n = Math.hypot(...d);
    const s = wall(surfaceFromRay({ level: L, origin: o, dir: [d[0] / n, 0, d[2] / n] }, 'socket-1'))!;
    expect(s.room.id).toBe('R1'); expect(s.wall.id).toBe('R1-w2');
  });
  it('ceiling device from a ray: point above the floor hit', () => {
    const s = surfaceFromRay(ray([5.6, 2.5, 0]), 'light')!;
    expect(s.kind).toBe('area');
    expect(placementOn(s, 'light', 0)!.orientation).toBe('ceiling');
  });
});

describe('engine — facades and site (sample house)', () => {
  useProject(HOUSE);
  it('plan: outside the building — the facade (EXT); far from the house — no place; no site point inside the wall thickness', () => {
    const f = wall(wallFromPlan('L0', [5.0, 8.5]))!;                                     // 0.5 m north of the north facade (y = 8)
    expect(f.room.id).toBe(EXT);
    expect(wallFromPlan('L0', [5.0, 8 + REACH + 0.5])).toBeNull();
    expect(wallFromPlan('L1', [40, 40])).toBeNull();
    expect(surfaceFromPlan('L0', [3.36, 2.0], 'light')).toBeNull();                       // wall between hall and living room
    expect(surfaceFromPlan('L0', [13, 5], 'light')!.room.id).toBe(EXT);
    expect(surfaceFromPlan('L1', [13, 5], 'light')).toBeNull();                           // the site belongs to the exit level
  });
  it('3D: a ray into the ground OUTSIDE the building outline gives an outside place (site point)', () => {
    const ext = elRoom(EXT)!, g = ext.floorZ;
    expect(g).toBe(-0.15);
    // camera east of the house (east facade x = 10), looking down on the lawn: point (13; 5)
    const from: Vec3 = [13.0, 2.0, 8.0], down = (to: Vec3) => { const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], n = Math.hypot(...d); return { level: 'L0', origin: from, dir: [d[0] / n, d[1] / n, d[2] / n] as Vec3 }; };
    const s = surfaceFromRay(down([13.0, 5.0, g]), 'light')!;
    expect(s && [s.kind, s.room.id]).toEqual(['area', EXT]);
    expect(s.kind === 'area' && s.q[0]).toBeCloseTo(13.0, 6); expect(s.kind === 'area' && s.q[1]).toBeCloseTo(5.0, 6);
    const p = placementOn(s, 'light', 0)!;
    expect([p.roomId, p.orientation, p.wallId, p.x, p.y]).toEqual([EXT, 'free', null, 13, 5]);
    expect(surfaceFromRay(down([13.0, 5.0, g]), 'socket-1')).toBeNull();                 // a wall device does not accept the ground
    // invisible ground (section / cut-away) is not a place
    expect(surfaceFromRay({ ...down([13.0, 5.0, g]), visible: () => false }, 'light')).toBeNull();
    // a point inside the building outline (wall between hall and living room: x 3.3…3.42) is not "outside"
    const inWall = surfaceFromRay({ level: 'L0', origin: [3.36, 2.0, 9.0], dir: [0, 0, -1] }, 'light');
    expect(inWall === null || inWall.room.id !== EXT).toBe(true);
    // the room floor wins: a vertical ray into the living room → a ceiling point of the living room
    const inRoom = surfaceFromRay({ level: 'L0', origin: [6.0, 4.0, 9.0], dir: [0, 0, -1] }, 'light')!;
    expect([inRoom.kind, inRoom.room.id]).toEqual(['area', 'LK']);
  });
  it('user description of an outside place', () => {
    expect(placementInfo({ roomId: EXT, wallId: 'EXT-w1', positionAlongWall: 1, heightAFFL: 0.4, orientation: 'wall' }, 'socket-ext', () => '').place).toBe('Outside');
  });
});

describe('position record: height kept, snapping from the left corner, ceiling / slope as the upper bound', () => {
  it('the device height does not change when moving between walls and rooms', () => {
    for (const q of [[8.4, 1.0], [7.8, 3.6], [2.2, 2.2], [5.6, 4.5]] as Vec2[]) expect(placementOn(wallFromPlan(L, q)!, 'socket-2', 1.15, 0.05)!.heightAFFL).toBe(1.15);
  });
  it('distance snapped to a grid measured from the left corner of the wall; without snapping — exactly under the pointer', () => {
    const s = wallFromPlan(L, [8.4, 1.437])!;
    const p = placementOn(s, 'socket-1', 0.3, 0.05)!, m = measure({ ...p, type: 'socket-1' } as ElPoint)!;
    expect(Math.round(m.fromLeft! * 100) % 5).toBe(0);
    expect(placementOn(s, 'socket-1', 0.3, 0)!.positionAlongWall).toBeCloseTo(1.437 - 0.3, 3);
  });
  it('the height is clamped below the ceiling', () => {
    expect(placementOn(wallFromPlan(L, [8.4, 1.0])!, 'switch', 2.9, 0)!.heightAFFL).toBeCloseTo(2.6 - 0.05, 6);
  });
  describe('sloped ceiling (placement-lab: bathroom R3 with a knee wall)', () => {
    useProject(LAB);
    it('knee wall — height clamped below the slope', () => {
      const r = elRoom('R3')!, low = r.walls.map((w) => ({ w, top: r.ceilingAt(w.a[0] + w.dir[0] * w.length / 2 + w.inward[0] * 0.05, w.a[1] + w.dir[1] * w.length / 2 + w.inward[1] * 0.05) })).sort((a, b) => a.top - b.top)[0];
      expect(low.w.id).toBe('R3-w3'); expect(low.top).toBeLessThan(1.5);
      const p = placementOn({ kind: 'wall', room: r, wall: low.w, t: low.w.length / 2, z: null, via: 'nearest' }, 'switch', 2.6, 0)!;
      expect(p.heightAFFL).toBeLessThan(low.top);
      expect(p.heightAFFL).toBeGreaterThan(0.05);
    });
  });
});

describe('place assessment (non-blocking warnings) and alignment', () => {
  const on = (wallId: string, t: number, h = 0.3, roomId = 'R1'): Placement => ({ roomId, wallId, positionAlongWall: t, heightAFFL: h, orientation: 'wall' });
  const empty = { version: 1 as const, points: [] as ElPoint[] };
  const pt = (id: string, p: Placement, type: ElPoint['type'] = 'socket-1'): ElPoint => ({ id, type, ...p, modules: 1, label: '', smartHome: 'none', source: 'user', status: 'planned' });
  it('solid wall — fine; door opening — invalid; window — warning; edge — warning', () => {
    expect(checkPlacement(empty, on('R1-w2', 2.5), 'socket-1', null).level).toBe('ok');
    const door = checkPlacement(empty, on('R1-w4', 2.45), 'socket-1', null);             // door D1: t 2.0…2.9
    expect(door.level).toBe('error'); expect(door.messages[0]).toBe('In a door opening — move it onto the wall.');
    const win = checkPlacement(empty, on('R1-w1', 3.5, 1.0), 'socket-1', null);          // window W1: t 2.58…4.98, sill 0.85
    expect(win.level).toBe('warn'); expect(win.messages.join(' ')).toMatch(/On a window/);
    expect(checkPlacement(empty, on('R1-w2', 0.02), 'socket-1', null).messages.join(' ')).toMatch(/close to the wall edge/);
  });
  it('another device at the same spot → warning (ignoring itself when moving)', () => {
    const plan = { version: 1 as const, points: [pt('S9', on('R1-w2', 2.5))] };
    expect(checkPlacement(plan, on('R1-w2', 2.53), 'socket-1', null).messages.join(' ')).toMatch(/Overlaps/);
    expect(checkPlacement(plan, on('R1-w2', 2.53), 'socket-1', null, 'S9').level).toBe('ok');
    expect(checkPlacement(plan, on('R1-w2', 2.53, 1.1), 'socket-1', null).level).toBe('ok');   // above the socket — a separate spot
  });
  it('door leaf and built-in furniture → warnings, not a block', () => {
    const ctx: CoordContext = { doorLeaves: [{ roomIds: ['R1'], a: [8.6, 2.0], b: [8.6, 2.9], name: 'D9' }], furniture: [{ roomId: 'R1', corners: [[6, 3.3], [7, 3.3], [7, 3.9], [6, 3.9]], z0: 0, z1: 2.4, name: 'Wardrobe', sanitary: false, builtIn: true }] };
    const d = checkPlacement(empty, on('R1-w2', 2.2), 'socket-1', ctx);
    expect(d.level).toBe('warn'); expect(d.messages).toContain('Possible clash with a door leaf.');
    const f = checkPlacement(empty, on('R1-w3', 2.2), 'socket-1', ctx);
    expect(f.level).toBe('warn'); expect(f.messages.join(' ')).toMatch(/Behind built-in furniture/);
  });
  it('alignment: the same height → a guide line; vertical axis above another device → pulled in', () => {
    const plan = { version: 1 as const, points: [pt('S9', on('R1-w3', 1.8, 0.3)), pt('SW9', on('R1-w3', 0.6, 1.1), 'switch')] };
    const a = alignPlacement(plan, on('R1-w3', 2.6, 0.3), 'socket-1', null);
    expect(a.guides).toEqual([{ kind: 'height', value: 0.3, withId: 'S9' }]);
    const b = alignPlacement(plan, on('R1-w3', 0.62, 0.3), 'socket-1', null, { along: true });
    expect(b.at.positionAlongWall).toBeCloseTo(0.6, 3);
    expect(b.guides.some((g) => g.kind === 'along' && g.withId === 'SW9')).toBe(true);
    const c = alignPlacement(plan, on('R1-w3', 2.6, 1.08), 'socket-1', null, { height: true });
    expect(c.at.heightAFFL).toBe(1.1);
  });
  it('user description: room, distance from the NEARER corner, height — no wall ids', () => {
    const i = placementInfo(on('R1-w2', 0.5), 'socket-1', () => 'Living room');
    expect(i.place).toBe('Living room'); expect(i.along).toBeCloseTo(0.5, 3); expect(i.height).toBe(0.3); expect(i.from).toMatch(/left|right/);
    expect(JSON.stringify([i.place, i.from])).not.toMatch(/w2|R1/);
  });
});

describe('transient state: new device, dragging, copy, series — one operation = one history entry', () => {
  beforeEach(reset);
  it('+ Add → pick a wall → device in the plan, selected; the project does not change during the motion', () => {
    beginNew('socket-2');
    const before = planNow().points.length, h0 = past();
    for (const q of [[8.4, 1.0], [8.4, 1.4], [8.4, 1.8]] as Vec2[]) drag(q);
    expect(planNow().points.length).toBe(before); expect(past()).toBe(h0);                 // transient state only
    expect(placeNow()!.info!.place).toBe('Living room with kitchenette');
    const id = commitPlace()!;
    const p = planNow().points.find((x) => x.id === id)!;
    expect(p.type).toBe('socket-2'); expect(p.roomId).toBe('R1'); expect(p.wallId).toBe('R1-w2'); expect(p.heightAFFL).toBe(0.3);
    expect(past()).toBe(h0 + 1); expect(placeNow()).toBeNull();
    expect(ui.get().selection).toEqual({ kind: 'electrical', id });
  });
  it('DRAG across a corner and into another room: one history entry; roomId / wallId / orientation computed; height kept', () => {
    beginNew('socket-2'); drag([8.4, 1.0]); const id = commitPlace()!;
    ui.set({ elHeights: {} });
    const h0 = past();
    beginMove(id, { dragging: true });
    const seen: string[] = [];
    for (const q of [[8.4, 2.0], [8.6, 3.5], [7.9, 3.65], [5.5, 3.65], [2.75, 2.5], [2.2, 2.4], [5.6, 4.4]] as Vec2[]) { drag(q); seen.push(`${at().roomId}:${at().wallId}`); expect(past()).toBe(h0); }
    expect(seen[0]).toBe('R1:R1-w2'); expect(seen[2]).toBe('R1:R1-w3'); expect(seen[4]).toBe('R1:R1-w4');
    expect(seen[5].startsWith('R1:')).toBe(false);                                        // the hallway west of the living room
    expect(seen[6]).toBe('R2:R2-w1');
    commitPlace();
    const p = planNow().points.find((x) => x.id === id)!;
    expect([p.roomId, p.wallId, p.orientation, p.heightAFFL]).toEqual(['R2', 'R2-w1', 'wall', 0.3]);
    expect(measure(p)!.normal).toEqual(elWall('R2', 'R2-w1')!.inward);
    expect(past()).toBe(h0 + 1);
    undo(); expect(planNow().points.find((x) => x.id === id)!.wallId).toBe('R1-w2');        // one Undo = the whole drag
    redo(); expect(planNow().points.find((x) => x.id === id)!.roomId).toBe('R2');
  });
  it('DRAGGING IN 3D (shared mounting engine): wall locked, constant grip, corner without flicker, transfer past a margin — one history entry', () => {
    beginNew('socket-2'); drag([8.4, 1.0]); const id = commitPlace()!;
    const p0 = planNow().points.find((x) => x.id === id)!, m = measure(p0)!, w = elWall(p0.roomId, p0.wallId)!, h0 = past();
    // camera in the room 2 m from the wall at device height; pointer = ray into a wall point (s — along the wall from the device position)
    const eye: Vec3 = [m.pos[0] + m.normal[0] * 2, m.pos[1] + m.normal[1] * 2, 1.2];
    const ray = (to: Vec3, px: number): MountPointer => { const d = [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]], n = Math.hypot(...d); return { kind: 'ray', origin: eye, dir: [d[0] / n, d[1] / n, d[2] / n], mPerPx: 0.002, screen: [px, 0], level: L }; };
    const onWall = (s: number): Vec3 => [m.pos[0] + w.dir[0] * s, m.pos[1] + w.dir[1] * s, 0.3];
    // grip 3 cm beside the device axis: the device does not jump under the pointer
    beginMove(id, { dragging: true, pointer: ray(onWall(0.03), 0) });
    dragTo(ray(onWall(0.03), 0), null, true);
    expect(at().positionAlongWall).toBeCloseTo(p0.positionAlongWall, 6);
    dragTo(ray(onWall(0.13), 25), null, true);                                            // 10 cm of pointer = 10 cm of device (Alt: no grid)
    expect(at().positionAlongWall - p0.positionAlongWall).toBeCloseTo(0.1, 3);
    expect([at().wallId, at().heightAFFL]).toEqual([p0.wallId, p0.heightAFFL]);
    // to the end of the wall and 5 cm past the corner on the neighbouring wall: the device stays on its own (transfer margin about 8 cm)
    const end = w.length - p0.positionAlongWall, corner: Vec3 = [w.b[0], w.b[1], 0.3], next = elRoom(p0.roomId)!.walls[(w.index) % elRoom(p0.roomId)!.walls.length];
    const onNext = (s: number): Vec3 => [corner[0] + next.dir[0] * s, corner[1] + next.dir[1] * s, 0.3];
    let px = 25;
    for (let s = 0.2; s < end; s += 0.1) dragTo(ray(onWall(s), px += 25), null, true);
    for (let k = 0; k < 6; k++) { dragTo(ray(k % 2 ? onWall(end - 0.04) : onNext(0.05), px += 20), null, true); expect(at().wallId).toBe(p0.wallId); }
    // clearly on the neighbouring wall → transfer; height kept
    for (let s = 0.1; s <= 0.6; s += 0.1) dragTo(ray(onNext(s), px += 25), null, true);
    expect(at().wallId).toBe(next.id); expect(at().heightAFFL).toBe(p0.heightAFFL);
    expect(past()).toBe(h0);
    commitPlace();
    expect(past()).toBe(h0 + 1);
    expect(planNow().points.find((x) => x.id === id)!.wallId).toBe(next.id);
    undo(); expect(planNow().points.find((x) => x.id === id)!.wallId).toBe(p0.wallId);
  });
  // 3D level view (camera high above the apartment, south-west of it): the planner shows the whole level — the device moves onto
  // a wall picked in a NEIGHBOURING room
  const LEVEL_EYE: Vec3 = [-1.35, -5.3, 20.8];
  const levelRay = (to: Vec3, px: number): MountPointer => { const d = [to[0] - LEVEL_EYE[0], to[1] - LEVEL_EYE[1], to[2] - LEVEL_EYE[2]], n = Math.hypot(...d); return { kind: 'ray', origin: LEVEL_EYE, dir: [d[0] / n, d[1] / n, d[2] / n], mPerPx: 0.001, screen: [px, 0], level: L }; };
  /** socket on the east wall of the living room (R1-w2, x = 8.7), 2.5 m from its start, gripped on its axis in the level view */
  const grabInLiving = () => {
    beginNew('socket-1'); placeAt({ kind: 'wall', room: elRoom('R1')!, wall: elWall('R1', 'R1-w2')!, t: 2.5, z: null, via: 'nearest' }, null); const id = commitPlace()!;
    const p0 = planNow().points.find((x) => x.id === id)!, m = measure(p0)!;
    beginMove(id, { dragging: true, pointer: levelRay(m.pos, 0) });
    dragTo(levelRay(m.pos, 0), [600, 500], true);
    return { id, p0, m };
  };
  /** a point on the north wall of the bedroom (R2-w3: y = 6.7, from x = 8.7 towards −X), 3 m from its start */
  const bedroomNorth = (): Vec3 => { const n = elWall('R2', 'R2-w3')!; return [n.a[0] + n.dir[0] * 3.0, n.a[1] + n.dir[1] * 3.0, 0.3]; };
  it('3D level view: a device dragged over the floor and onto a wall of the neighbouring room moves to that wall (one history entry)', () => {
    const { id: g, p0 } = grabInLiving(), h0 = past();
    expect(p0.wallId).toBe('R1-w2');
    dragTo(levelRay([5.6, 6.0, 0], 300), null, true);                                     // bedroom floor (R2), beyond the top of its south wall
    expect(at().roomId).toBe('R2');
    dragTo(levelRay(bedroomNorth(), 400), null, true);
    expect([at().roomId, at().wallId, at().heightAFFL]).toEqual(['R2', 'R2-w3', 0.3]);
    // a device gripped on its axis lies UNDER the pointer
    expect(at().positionAlongWall).toBeCloseTo(3.0, 2);
    expect(placeNow()!.live).toBe(true);
    commitPlace();
    expect(past()).toBe(h0 + 1);
    expect(planNow().points.find((x) => x.id === g)!.roomId).toBe('R2');
  });
  it('3D: pointer outside every wall (next to the apartment) → invalid preview; releasing leaves the device in place, no history entry', () => {
    const { id, p0, m } = grabInLiving(), h0 = past();
    dragTo(levelRay([m.pos[0], m.pos[1] + 0.5, 0.3], 60), [660, 500], true);              // first a plain move along the wall: +50 cm, valid
    expect(placeNow()!.live).toBe(true);
    expect(at().positionAlongWall).toBeCloseTo(p0.positionAlongWall + 0.5, 2);
    // the point (−5; 9) lies west of the apartment: the ray hits no wall and no floor
    dragTo(levelRay([-5, 9, 0], 500), [200, 300], true);
    expect(placeNow()!.live).toBe(false);
    expect(placeNow()!.check).toEqual({ level: 'error', messages: ['Drag onto a wall.'] });
    commitPlace();
    expect(planNow().points.find((x) => x.id === id)).toEqual(p0);
    expect(past()).toBe(h0);
    expect(placeNow()).toBeNull();
  });
  it('3D: when the pointer returns to the wall the place is valid again and is saved (one history entry)', () => {
    const { id, p0, m } = grabInLiving(), h0 = past();
    dragTo(levelRay([-5, 9, 0], 500), [200, 300], true);
    expect(placeNow()!.live).toBe(false);
    dragTo(levelRay([m.pos[0], m.pos[1] - 0.4, 0.3], 80), [640, 500], true);
    expect(placeNow()!.live).toBe(true);
    commitPlace();
    expect(planNow().points.find((x) => x.id === id)!.positionAlongWall).toBeCloseTo(p0.positionAlongWall - 0.4, 2);
    expect(past()).toBe(h0 + 1);
  });
  it('3D: a pointer outside the scene rectangle (over the side panel) moves nothing — a ray outside the scene is only an extrapolation', () => {
    const at2 = (screen: [number, number]): MountPointer => ({ ...levelRay(bedroomNorth(), 0), screen });
    sceneApi.dom = { getBoundingClientRect: () => ({ left: 350, top: 60, right: 1250, bottom: 950, width: 900, height: 890 }) } as unknown as HTMLCanvasElement;
    try {
      const a = grabInLiving(), h0 = past();
      dragTo(at2([150, 700]), [150, 700], true);                                          // 200 px left of the scene
      expect(at().roomId).toBe('R1');
      expect(placeNow()!.live).toBe(false);
      commitPlace();
      expect(planNow().points.find((x) => x.id === a.id)).toEqual(a.p0);
      expect(past()).toBe(h0);
      // control: the same ray with the pointer INSIDE the scene — the device moves to the bedroom wall
      const b = grabInLiving();
      dragTo(at2([600, 500]), [600, 500], true);
      expect([at().roomId, placeNow()!.live]).toEqual(['R2', true]);
      cancelPlace();
      expect(planNow().points.find((x) => x.id === b.id)!.roomId).toBe('R1');
    } finally { sceneApi.dom = null; }
  });
  it('release outside a valid surface → the device returns to its place (no history entry); a door opening does not accept the device', () => {
    beginNew('socket-1'); drag([8.4, 1.0]); const id = commitPlace()!;
    const t0 = planNow().points.find((x) => x.id === id)!.positionAlongWall, h0 = past();
    beginMove(id, { dragging: true });
    drag([8.4, 2.4]);
    placeAt(null, null);                                                                  // pointer outside the building
    expect(placeNow()!.live).toBe(false);
    commitPlace();
    expect(planNow().points.find((x) => x.id === id)!.positionAlongWall).toBe(t0);
    beginMove(id, { dragging: true });
    drag([2.6, 1.45]);                                                                    // in the opening of door D1
    expect(placeNow()!.check.level).toBe('error');
    commitPlace();
    const p = planNow().points.find((x) => x.id === id)!;
    expect([p.wallId, p.positionAlongWall]).toEqual(['R1-w2', t0]);
    expect(past()).toBe(h0); expect(placeNow()).toBeNull();
  });
  it('a new device released off a wall is not created; cancelling leaves no trace in the history', () => {
    const n = planNow().points.length, h0 = past();
    beginNew('socket-1'); placeAt(null, null);
    expect(commitPlace()).toBeNull();
    expect(placeNow()).not.toBeNull();                                                    // placing continues — a wall can still be picked
    cancelPlace();
    expect(planNow().points.length).toBe(n); expect(past()).toBe(h0);
  });
  it('DUPLICATE: a copy with the same properties (type, height, label) on any wall; the original unchanged', () => {
    beginNew('socket-3'); drag([8.4, 1.0]); const id = commitPlace()!;
    const src0 = { ...planNow().points.find((x) => x.id === id)! };
    beginCopy(id);
    expect(placeNow()!.mode).toBe('copy');
    drag([2.2, 2.2]);
    const c = commitPlace()!;
    const copy = planNow().points.find((x) => x.id === c)!;
    expect(c).not.toBe(id); expect(copy.type).toBe('socket-3'); expect(copy.modules).toBe(src0.modules); expect(copy.heightAFFL).toBe(src0.heightAFFL); expect(copy.roomId).toBe('R4');
    expect(planNow().points.find((x) => x.id === id)).toEqual(src0);
  });
  it('ADD MANY: successive picks add successive devices without opening the catalog; ✓ Done ends; a type change ends the series', () => {
    const n = planNow().points.length, h0 = past();
    beginNew('socket-2', true);
    for (const q of [[8.4, 0.8], [8.4, 2.6], [6.0, 3.6], [2.8, 2.7], [4.0, 0.6]] as Vec2[]) { drag(q); commitPlace(); expect(placeNow()!.mode).toBe('new'); }
    expect(placeNow()!.placed).toBe(5);
    expect(planNow().points.length).toBe(n + 5); expect(past()).toBe(h0 + 5);
    expect(ui.get().selection).toBeNull();                                                // nothing is selected in a series (the card does not open)
    beginNew('switch', true);                                                             // another type = a new series
    expect(placeNow()!.placed).toBe(0); expect(placeNow()!.type).toBe('switch');
    cancelPlace(); expect(placeNow()).toBeNull();
    setPlaceMulti(false);
  });
  it('the same spot a second time = the existing device (no duplicate)', () => {
    beginNew('socket-1'); drag([8.4, 1.0]); const id = commitPlace()!;
    const n = planNow().points.length;
    beginNew('socket-1'); drag([8.4, 1.02]);
    expect(pointAt(at())!.id).toBe(id);
    expect(commitPlace()).toBe(id);
    expect(planNow().points.length).toBe(n);
  });
  it('height: the ↕ handle (one history entry) and the remembered height per type — the next device starts at the same height', () => {
    beginNew('socket-1'); drag([8.4, 2.6]); const id = commitPlace()!;
    const h0 = past();
    // the ↕ handle is 17 cm above the device axis: the pointer grips the handle and the device keeps that offset (grip) all the way
    const p0 = planNow().points.find((x) => x.id === id)!, m = measure(p0)!;
    const aimAt = (z: number, px: number): MountPointer => ({ kind: 'ray', origin: [m.pos[0] + m.normal[0] * 2, m.pos[1] + m.normal[1] * 2, z], dir: [-m.normal[0], -m.normal[1], 0], mPerPx: 0.004, screen: [0, px], level: L });
    beginHeight(id, false, aimAt(0.3 + 0.17, 0));
    expect(mountDragging()).toBe(true);
    for (const z of [0.5, 0.8, 1.13]) { dragTo(aimAt(z + 0.17, z * 1000), null); expect(placeNow()!.at!.positionAlongWall).toBe(p0.positionAlongWall); }
    commitPlace();
    expect(mountDragging()).toBe(false);
    expect(planNow().points.find((x) => x.id === id)!.heightAFFL).toBeCloseTo(1.15, 2);
    expect(past()).toBe(h0 + 1);
    beginNew('socket-1'); expect(placeNow()!.height).toBeCloseTo(1.15, 2); cancelPlace();
    beginNew('switch'); expect(placeNow()!.height).toBe(1.1); cancelPlace();
  });
});

describe('transient state on the site (sample house)', () => {
  useProject(HOUSE);
  beforeEach(reset);
  it('3D: a site lamp dragged over the ground by (+1.0; −1.5) m — a new place on the site, one history entry', () => {
    const ext = elRoom(EXT)!;
    beginNew('light'); placeAt({ kind: 'area', room: ext, q: [11, 4] }, null); const id = commitPlace()!;
    const p0 = planNow().points.find((x) => x.id === id)!, h0 = past();
    expect([p0.roomId, p0.orientation, p0.x, p0.y]).toEqual([EXT, 'free', 11, 4]);
    const from: Vec3 = [14, -3, 9], to: Vec3 = [12, 2.5, ext.floorZ], d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], n = Math.hypot(...d);
    beginMove(id, { dragging: true });
    expect(mountDragging()).toBe(false);                                                  // a point without a wall is picked, not dragged over a surface
    placeAt(surfaceFromRay({ level: 'L0', origin: from, dir: [d[0] / n, d[1] / n, d[2] / n] }, 'light', currentWall()), [0, 0], true);
    expect(placeNow()!.live).toBe(true);
    commitPlace();
    const p = planNow().points.find((x) => x.id === id)!;
    expect([p.roomId, p.orientation]).toEqual([EXT, 'free']);
    expect(p.x).toBeCloseTo(12, 2); expect(p.y).toBeCloseTo(2.5, 2);
    expect(past()).toBe(h0 + 1);
  });
});

// A CEILING device gripped by its marker in 3D. The marker hangs under the ceiling, while picking (a new device) hits the floor —
// a ray through the marker lands on the floor a ceiling-height parallax further away. Dragging therefore moves the lamp over the
// horizontal plane through the grip point (like standing furniture — model/floorDrag.ts).
// placement-lab: living room ceiling 2.60, bedroom ceiling 2.40.
describe('ceiling lamp dragged in 3D by its marker (placement-lab)', () => {
  useProject(LAB);
  beforeEach(reset);
  const EYE: Vec3 = [5.6, -1.0, 9.0];                                                     // view from above, from the south
  const ray = (to: Vec3, px: number): MountPointer => { const d = [to[0] - EYE[0], to[1] - EYE[1], to[2] - EYE[2]], n = Math.hypot(...d); return { kind: 'ray', origin: EYE, dir: [d[0] / n, d[1] / n, d[2] / n], mPerPx: 0.001, screen: [px, 0], level: L }; };
  /** pointer move as in the scene (scene/electricalInput.ts): a drag session or a pick */
  const aim3d = (p: MountPointer) => { if (!mountDragging() || !dragTo(p, [0, 0], true)) placeAt(surfaceFromRay(p as Extract<MountPointer, { kind: 'ray' }>, placeNow()!.type, currentWall()), [0, 0], true); };
  const lamp = (q: Vec2) => { const room = elRoom('R1')!; beginNew('light'); placeAt({ kind: 'area', room, q }, null, true); const id = commitPlace()!; return { id, room, z: room.floorZ + planNow().points.find((x) => x.id === id)!.heightAFFL }; };

  it('the first move does not shift the lamp by the ceiling parallax — the lamp follows the pointer at its own height', () => {
    const { id, z } = lamp([5.6, 2.1]);
    beginMove(id, { dragging: true, pointer: ray([5.6, 2.1, z], 0) });
    aim3d(ray([5.62, 2.1, z], 20));                                                       // 2 cm sideways at lamp height
    expect(placeNow()!.live).toBe(true);
    expect(placeNow()!.at!.x).toBeCloseTo(5.62, 2); expect(placeNow()!.at!.y).toBeCloseTo(2.1, 2);
    aim3d(ray([6.0, 2.6, z], 500));                                                       // further: the ceiling point under the pointer
    expect(placeNow()!.at!.x).toBeCloseTo(6.0, 2); expect(placeNow()!.at!.y).toBeCloseTo(2.6, 2);
    const h0 = past();
    commitPlace();
    const p = planNow().points.find((x) => x.id === id)!;
    expect([p.roomId, p.orientation]).toEqual(['R1', 'ceiling']);
    expect(p.x).toBeCloseTo(6.0, 2); expect(p.y).toBeCloseTo(2.6, 2);
    expect(past()).toBe(h0 + 1);
  });
  it('a grip beside the marker centre stays: the lamp moves by the pointer travel, it does not jump under the pointer', () => {
    const { id, z } = lamp([5.6, 2.1]);
    beginMove(id, { dragging: true, pointer: ray([5.65, 2.13, z], 0) });                  // gripped 5 cm and 3 cm off the axis
    aim3d(ray([5.95, 2.13, z], 300));
    expect(placeNow()!.at!.x).toBeCloseTo(5.9, 2); expect(placeNow()!.at!.y).toBeCloseTo(2.1, 2);
  });
  it('a lamp dragged over the neighbouring room moves into it (that room\'s ceiling, another height) and keeps following the pointer', () => {
    const { id, z } = lamp([5.6, 2.1]);
    beginMove(id, { dragging: true, pointer: ray([5.6, 2.1, z], 0) });
    aim3d(ray([5.6, 5.3, z], 900));                                                       // bedroom (R2), ceiling 2.40
    expect(placeNow()!.live).toBe(true);
    expect(placeNow()!.at!.roomId).toBe('R2');
    const zR2 = elRoom('R2')!.floorZ + placeNow()!.at!.heightAFFL, y0 = placeNow()!.at!.y!;
    expect(zR2).not.toBeCloseTo(z, 2);
    // the BEDROOM ceiling point under the pointer: the same ray crosses the lower ceiling further from the camera
    const k = (zR2 - EYE[2]) / (z - EYE[2]);
    expect(placeNow()!.at!.x).toBeCloseTo(EYE[0] + (5.6 - EYE[0]) * k, 2); expect(y0).toBeCloseTo(EYE[1] + (5.3 - EYE[1]) * k, 2);
    aim3d(ray([6.2, 5.6, zR2], 1000));                                                    // further over the bedroom ceiling: marker under the pointer
    expect(placeNow()!.at!.x).toBeCloseTo(6.2, 2); expect(placeNow()!.at!.y).toBeCloseTo(5.6, 2);
    const h0 = past();
    commitPlace();
    expect(planNow().points.find((x) => x.id === id)!.roomId).toBe('R2');
    expect(past()).toBe(h0 + 1);
  });
  it('a lamp released over a wall (neither room nor site): invalid preview, the lamp returns to its place, no history entry', () => {
    const { id, z } = lamp([5.6, 2.1]);
    beginMove(id, { dragging: true, pointer: ray([5.6, 2.1, z], 0) });
    expect(roomAtPlan(L, [2.46, 2.0])).toBeNull();                                        // 12 cm wall between hallway and living room
    aim3d(ray([2.46, 2.0, z], 950));
    expect(placeNow()!.live).toBe(false);
    const h0 = past();
    commitPlace();
    const p = planNow().points.find((x) => x.id === id)!;
    expect([p.roomId, p.x, p.y]).toEqual(['R1', 5.6, 2.1]);
    expect(past()).toBe(h0);
  });
  it('pointer outside the scene (side panel) moves nothing; without a pointer ("Move" button) the lamp is still picked', () => {
    const { id, z } = lamp([5.6, 2.1]);
    sceneApi.dom = { getBoundingClientRect: () => ({ left: 350, top: 60, right: 1250, bottom: 950 }) } as unknown as HTMLCanvasElement;
    try {
      beginMove(id, { dragging: true, pointer: { ...ray([5.6, 2.1, z], 0), screen: [800, 500] } });
      expect(mountDragging()).toBe(true);
      dragTo({ ...ray([6.2, 2.1, z], 0), screen: [1400, 500] }, [1400, 500], true);
      expect(placeNow()!.live).toBe(false);
      expect(placeNow()!.at!.x).toBeCloseTo(5.6, 2);
      cancelPlace();
    } finally { sceneApi.dom = null; }
    beginMove(id, { dragging: false });
    expect(mountDragging()).toBe(false);
    cancelPlace();
  });
});

describe('saving: compatibility with existing documents, fields of a future Smart Home planner', () => {
  beforeEach(reset);
  it('the plan after dragging passes validation and comes back from the file without loss', () => {
    beginNew('socket-2'); drag([8.4, 1.0]); const id = commitPlace()!;
    beginMove(id, { dragging: true }); drag([2.2, 2.2]); commitPlace();
    const doc = design.get().history.present;
    expect(docErrors(doc)).toEqual([]);
    const back = parseDoc(serializeDoc(doc));
    expect(back.electrical).toEqual(doc.electrical);
  });
  it('a point without the new fields (older record) is valid; smart home links (controls, automationGroup…) are stored and checked', () => {
    const base: ElPoint = { id: 'S9', type: 'socket-1', roomId: 'R1', wallId: 'R1-w2', positionAlongWall: 1, heightAFFL: 0.3, orientation: 'wall', modules: 1, label: '', smartHome: 'none', source: 'user', status: 'planned' };
    expect(planErrors({ version: 1, points: [base] })).toEqual([]);
    expect(planErrors({ version: 1, points: [{ ...base, smart: { controlledBy: ['SW1'], automationGroup: 'living', bus: 'KNX-1' } }] })).toEqual([]);
    expect(planErrors({ version: 1, points: [{ ...base, smart: { controls: 'SW1' } as never }] }).join(' ')).toMatch(/smart\.controls/);
    expect(planErrors({ version: 1, points: [{ ...base, smart: { foo: 1 } as never }] }).join(' ')).toMatch(/unknown field/);
  });
});

describe('device look in 3D (solids)', () => {
  it('every type has a solid; the distribution board has a visible interior', () => {
    for (const t of EL_TYPE_IDS) for (const o of ['wall', 'ceiling', 'free'] as const) expect(shapeOf(t, o)).toBeTruthy();
    const g = elShapeGeometry('socket');
    expect(g.getAttribute('position').count).toBeGreaterThan(100); expect(g.getAttribute('color')).toBeTruthy();
    const b = boardGeometry(0.73), tri = (b.index ? b.index.count : b.getAttribute('position').count) / 3;
    expect(tri).toBeGreaterThan(1500); expect(boardHeight(0.73)).toBeCloseTo(1.314, 3);
  });
});
