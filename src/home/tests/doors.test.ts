// Doors: model from the project package (hinge, direction, type), pivot at the hinge, opening angle, stored state,
// "Show doors", walk collisions (closed doors block, open and hidden ones let through), exterior doors in the building walk.
// Sample house: D0 entrance (hall ↔ exterior), D1–D5 hinged, D6 sliding (main bedroom ↔ first-floor bathroom).
// Demo apartment: D0 entrance (hallway ↔ exterior), D1–D3 hinged.
import path from 'node:path';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { activateProject, project } from '../../project/active';
import { readProjectDir } from '../../project/node';
import {
  allDoors, defaultDoorState, doorById, doorCenter, doorPassable, doorsOfLevel, doorsOfRoom, inDoorway, interactiveDoors, isInteractive, isOperable,
  LEAF_T, leafAngle, leafSegment, openOf, parseDoorState, PASS_OPEN, serializeDoorState, setAllDoors, setDoorOpen, swingArc, toggleDoor,
  type DoorState,
} from '../model/doors';
import { pointInPolygon } from '@home-sim/core/model/geom2d';
import { roomById } from '../model/rooms';
import type { LevelId, Vec2 } from '../model/types';
import { setDoorGate, walkAllowed, walkRoomAt, walkStep } from '../model/walk';
import { WalkWorld, type WalkPose } from '../model/walkWorld';
import { frameGeometry, leafGeometries, leafMatrix } from '../three/doorGeometry';

const root = path.resolve(__dirname, '..', '..', '..');
const readProject = (id: string) => readProjectDir(path.join(root, 'projects', id));
const EYE = 1.68;
const D = (id: string) => doorById(id)!;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const gate = (s: DoorState) => setDoorGate((id) => doorPassable(s, id));
/** room walk on a level: steps of 10 cm */
const march = (level: LevelId, from: Vec2, dx: number, dy: number, m: number) => { let p = from; for (let i = 0; i < Math.round(m / 0.1); i++) p = walkStep(level, p, dx * 0.1, dy * 0.1, EYE); return p; };
afterEach(() => setDoorGate(null));

/** checks that hold for the doors of every project */
function doorDataInvariants() {
  it('every door: rooms on both sides exist, opening width matches the range, source and confidence given', () => {
    for (const d of allDoors()) {
      expect(d.rooms).toHaveLength(2);
      expect(roomById(d.rooms[0]), d.id).toBeTruthy();
      expect(d.rooms[1] === 'exterior' || !!roomById(d.rooms[1]), d.id).toBe(true);
      expect(roomById(d.rooms[0])!.level, d.id).toBe(d.level);
      expect(d.opening.to - d.opening.from).toBeCloseTo(d.opening.width, 2);
      expect(d.leafWidth).toBeGreaterThan(0.5); expect(d.leafWidth).toBeLessThanOrEqual(d.opening.width);
      expect(d.height).toBeGreaterThanOrEqual(2.0);
      expect(d.source.length).toBeGreaterThan(0); expect(['confirmed', 'probable']).toContain(d.confidence);
      expect(doorsOfLevel(d.level)).toContain(d);
      expect(doorsOfRoom(d.rooms[0])).toContain(d);
      if (d.type === 'hinged-single') {
        expect(d.hinge, d.id).not.toBeNull(); expect(['left', 'right']).toContain(d.hingeSide); expect(d.openAngle).toBe(90);
        expect(d.rooms).toContain(d.swingInto);
      }
    }
  });
  it('closed: leaf along the wall within the opening; open 90°: perpendicular, inside the room it opens into', () => {
    for (const d of allDoors().filter((x) => x.hinge)) {
      const ax = d.opening.along === 'X' ? 0 : 1, c = leafSegment(d, 0)!, o = leafSegment(d, 1)!;
      expect(dist(c.a, c.b)).toBeCloseTo(d.leafWidth, 3);
      expect(Math.abs(c.b[1 - ax] - c.a[1 - ax])).toBeLessThan(0.01); // along the wall
      expect(Math.min(c.a[ax], c.b[ax])).toBeGreaterThan(d.opening.from - 0.06); expect(Math.max(c.a[ax], c.b[ax])).toBeLessThan(d.opening.to + 0.06);
      expect(Math.abs(o.b[ax] - o.a[ax])).toBeLessThan(0.01); // perpendicular to the wall
      const room = roomById(d.swingInto!)!, tip: Vec2 = [o.a[0] + o.dir[0] * d.leafWidth * 0.9, o.a[1] + o.dir[1] * d.leafWidth * 0.9];
      expect(pointInPolygon(tip, room.polygon, 0.03), d.id).toBe(true);
    }
  });
  it('leaf matrix in the scene: local origin on the hinge axis, leaf X axis = leaf direction, no scale or shear', () => {
    for (const d of interactiveDoors()) for (const t of [0, 0.5, 1]) {
      const M = leafMatrix(d, t), s = leafSegment(d, t)!;
      const o = new THREE.Vector3(0, 0, 0).applyMatrix4(M), tip = new THREE.Vector3(d.leafWidth, 0, 0).applyMatrix4(M), up = new THREE.Vector3(0, 1, 0).applyMatrix4(M);
      const k = d.hinge ? LEAF_T / 2 : 0; // leaf face in the wall face: axis set back by half the thickness
      expect(o.x).toBeCloseTo(s.a[0] - (d.openDir?.[0] ?? 0) * k, 6); expect(-o.z).toBeCloseTo(s.a[1] - (d.openDir?.[1] ?? 0) * k, 6); expect(o.y).toBeCloseTo(d.floorZ, 6);
      expect(tip.x - o.x).toBeCloseTo(s.dir[0] * d.leafWidth, 6); expect(-(tip.z - o.z)).toBeCloseTo(s.dir[1] * d.leafWidth, 6);
      expect(up.y - o.y).toBeCloseTo(1, 6);
      expect(Math.abs(M.determinant())).toBeCloseTo(1, 6);
    }
  });
  it('every interior door has a corridor in the walk model (closing it really cuts the room off)', () => {
    const interior = interactiveDoors().filter((d) => d.rooms[1] !== 'exterior');
    expect(interior.length).toBeGreaterThan(0);
    for (const d of interior) {
      const p = doorCenter(d);
      gate(defaultDoorState()); expect(walkAllowed(d.level, p, 1.0), `${d.id} closed`).toBe(false);
      gate(setDoorOpen(defaultDoorState(), d.id, 1)); expect(walkAllowed(d.level, p, 1.0), `${d.id} open`).toBe(true);
    }
  });
}

describe('demo apartment doors', () => {
  it('entrance door + 3 interior doors, all hinged and interactive', () => {
    expect(allDoors().map((d) => d.id).sort()).toEqual(['D0', 'D1', 'D2', 'D3']);
    expect(interactiveDoors()).toHaveLength(4);
    expect(new Set(allDoors().map((d) => d.type))).toEqual(new Set(['hinged-single']));
    expect(D('D0').rooms).toEqual(['R4', 'exterior']);
    expect(Object.fromEntries(allDoors().map((d) => [d.id, d.swingInto]))).toEqual({ D0: 'R4', D1: 'R1', D2: 'R3', D3: 'R2' });
  });
  doorDataInvariants();
  it('room walk: hallway → bathroom only through the open door D2', () => {
    const start: Vec2 = [1.3, 2.4];
    expect(walkRoomAt('L1', start)!.id).toBe('R4');
    gate(defaultDoorState());
    expect(walkRoomAt('L1', march('L1', start, 0, 1, 2))!.id).toBe('R4');
    gate(setDoorOpen(defaultDoorState(), 'D2', 1));
    expect(walkRoomAt('L1', march('L1', start, 0, 1, 2))!.id).toBe('R3');
  });
});

describe('sample house doors', () => {
  beforeAll(() => { activateProject(readProject('sample-house')); });
  afterAll(() => { setDoorGate(null); activateProject(readProject('demo-apartment')); });

  describe('door model from the project package', () => {
    it('entrance door + 6 interior doors on two levels; every door is interactive', () => {
      expect(allDoors().map((d) => d.id).sort()).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
      expect(doorsOfLevel('L0').map((d) => d.id).sort()).toEqual(['D0', 'D1', 'D2']);
      expect(doorsOfLevel('L1').map((d) => d.id).sort()).toEqual(['D3', 'D4', 'D5', 'D6']);
      expect(interactiveDoors()).toHaveLength(7);
      expect(isInteractive(D('D0'))).toBe(true); // the entrance door is drawn and opened by the engine as well
      expect(D('D0').rooms).toEqual(['H0', 'exterior']);
    });
    it('the type is taken from the data: D6 is a sliding leaf (no hinge, no swing)', () => {
      const d = D('D6');
      expect(d.type).toBe('sliding'); expect(d.hinge).toBeNull(); expect(d.swingInto).toBeNull(); expect(d.openAngle).toBeNull();
      expect(d.slide!.dir).toEqual([1, 0]);
      expect([...new Set(allDoors().map((x) => x.type))].sort()).toEqual(['hinged-single', 'sliding']);
    });
    it('opening directions follow the data: rooms open inwards, the entrance door into the hall', () => {
      expect(Object.fromEntries(allDoors().map((d) => [d.id, d.swingInto]))).toEqual({ D0: 'H0', D1: 'LK', D2: 'B0', D3: 'BR1', D4: 'BR2', D5: 'O1', D6: null });
    });
    doorDataInvariants();
  });

  describe('pivot at the hinge and opening angle', () => {
    it('rotation axis = hinge: the hinge point stays for every angle, the handle edge sweeps an arc of the leaf radius', () => {
      const d = D('D2');
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const s = leafSegment(d, t)!;
        expect(s.a).toEqual(d.hinge);
        expect(dist(s.a, s.b)).toBeCloseTo(d.leafWidth, 6);
        expect(leafAngle(d, t)).toBeCloseTo(90 * t, 6);
        // angle between the leaf and its closed position
        const cos = s.dir[0] * d.closedDir![0] + s.dir[1] * d.closedDir![1];
        expect((Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI).toBeCloseTo(90 * t, 4);
      }
      // the leaf centre is NOT fixed (a rotation about the centre would keep it)
      const m = (t: number) => { const s = leafSegment(d, t)!; return [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2] as Vec2; };
      expect(dist(m(0), m(1))).toBeGreaterThan(0.4);
      const arc = swingArc(d, 8);
      expect(arc).toHaveLength(9);
      for (const p of arc) expect(dist(p, d.hinge!)).toBeCloseTo(d.leafWidth, 6);
      // the same hinge point for closed and open leaves in the scene (pivot)
      const e = D('D3'), a = new THREE.Vector3().applyMatrix4(leafMatrix(e, 0)), b = new THREE.Vector3().applyMatrix4(leafMatrix(e, 1));
      expect(a.distanceTo(b)).toBeLessThan(1e-9);
    });
    it('sliding: the leaf moves along the wall by its travel, without rotating', () => {
      const d = D('D6'), c = leafSegment(d, 0)!, o = leafSegment(d, 1)!;
      expect(c.dir).toEqual(o.dir);
      expect(o.a[0] - c.a[0]).toBeCloseTo(d.slide!.travel, 6); expect(o.a[1]).toBe(c.a[1]);
      expect(c.a[0]).toBeGreaterThan(d.opening.from); expect(c.b[0]).toBeLessThan(d.opening.to); // closed: within the opening
      expect(o.a[0]).toBeGreaterThan(d.opening.to - 0.12); // open: the leaf is almost entirely beside the opening
      expect(swingArc(d)).toEqual([c.a, o.b]);
    });
    it('geometry: leaf with handle in one mesh, frame within the masonry opening (stays when leaves are hidden)', () => {
      for (const id of ['D1', 'D6']) {
        const d = D(id), g = leafGeometries(d), f = frameGeometry(d)!;
        g.leaf.computeBoundingBox(); f.computeBoundingBox();
        expect(g.leaf.boundingBox!.min.x).toBeGreaterThanOrEqual(0); expect(g.leaf.boundingBox!.max.x).toBeLessThanOrEqual(d.leafWidth);
        expect(g.leaf.getAttribute('color')).toBeTruthy();
        expect(f.boundingBox!.max.y).toBeCloseTo(d.floorZ + d.opening.height, 6);
        const fb = f.boundingBox!, span = d.opening.along === 'X' ? fb.max.x - fb.min.x : fb.max.z - fb.min.z; // three.js z = −Y
        expect(span).toBeCloseTo(d.opening.width, 6);
      }
    });
  });

  describe('door state: opening, storage, "Show doors"', () => {
    it('open / close / angle; unknown doors and windows unchanged (same reference)', () => {
      let s = defaultDoorState();
      expect(openOf(s, 'D2')).toBe(0);
      s = toggleDoor(s, 'D2'); expect(openOf(s, 'D2')).toBe(1);
      s = setDoorOpen(s, 'D2', 0.5); expect(leafAngle(D('D2'), openOf(s, 'D2'))).toBe(45);
      s = toggleDoor(s, 'D2'); expect(s.open).toEqual({}); // ≥ 0.5 → close; closed doors take no space in the record
      expect(setDoorOpen(s, 'D2', 0)).toBe(s);
      expect(setDoorOpen(s, 'NO-SUCH-DOOR', 1)).toBe(s);
      expect(setDoorOpen(s, 'W2', 1)).toBe(s);                       // a passable window has no open state
      expect(isOperable('W2')).toBe(false);
      expect(openOf(setDoorOpen(s, 'D0', 1), 'D0')).toBe(1);         // the entrance door has an open state
      expect(openOf(setDoorOpen(s, 'D6', 1), 'D6')).toBe(1);
      expect(setDoorOpen(s, 'D2', 7).open.D2).toBe(1);               // out of range → 0…1
      expect(Object.keys(setAllDoors(s, 1).open).sort()).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
    });
    it('serialization: write and read give the same state; invalid data and unknown doors are skipped', () => {
      let s = setDoorOpen(setDoorOpen(defaultDoorState(), 'D6', 1), 'D1', 0.35);
      s = { ...s, show: false };
      const raw = serializeDoorState(s);
      expect(JSON.parse(raw)).toEqual({ v: 1, show: false, open: { D1: 0.35, D6: 1 } });
      expect(parseDoorState(raw)).toEqual(s);
      expect(parseDoorState(null)).toEqual(defaultDoorState());
      expect(parseDoorState('{{{')).toEqual(defaultDoorState());
      expect(parseDoorState(JSON.stringify({ show: 'yes', open: { D1: 2, D2: -1, XX: 1, D0: 1, W2: 1, D3: 'open', D4: Number.NaN } })))
        .toEqual({ show: true, open: { D0: 1, D1: 1 } });
      // door definitions are not part of the state — hiding the leaves removes nothing from the data
      expect(allDoors()).toHaveLength(7);
      expect(project().building.doors).toHaveLength(7);
    });
    it('passage: closed doors block, open from 60 %, hidden leaves do not block; the entrance door too; windows always pass', () => {
      const s = defaultDoorState();
      expect(doorPassable(s, 'D2')).toBe(false);
      expect(doorPassable(setDoorOpen(s, 'D2', PASS_OPEN - 0.05), 'D2')).toBe(false);
      expect(doorPassable(setDoorOpen(s, 'D2', PASS_OPEN), 'D2')).toBe(true);
      expect(doorPassable({ ...s, show: false }, 'D2')).toBe(true);
      expect(doorPassable(s, 'D0')).toBe(false); expect(doorPassable(setDoorOpen(s, 'D0', 1), 'D0')).toBe(true);
      expect(doorPassable({ ...s, show: false }, 'D0')).toBe(true);
      expect(doorPassable(s, 'W2')).toBe(true);
    });
  });

  describe('walk collisions: closed doors block, open and hidden ones let through', () => {
    it('hall H0 ↔ bathroom B0 (D2): closed — stays in the hall; open — passes; closed again — does not come back', () => {
      const start: Vec2 = [2.2, 4.6];
      expect(walkRoomAt('L0', start)!.id).toBe('H0');
      gate(defaultDoorState());
      const blocked = march('L0', start, 0, 1, 2);
      expect(walkRoomAt('L0', blocked)?.id).toBe('H0'); expect(blocked[1]).toBeLessThan(5);
      expect(walkAllowed('L0', [2.2, 5.06], EYE)).toBe(false); // within the wall thickness, in the opening
      gate(setDoorOpen(defaultDoorState(), 'D2', 1));
      expect(walkAllowed('L0', [2.2, 5.06], EYE)).toBe(true);
      const through = march('L0', start, 0, 1, 2);
      expect(walkRoomAt('L0', through)!.id).toBe('B0');
      gate(defaultDoorState());
      const back = march('L0', through, 0, -1, 2.5);
      expect(walkRoomAt('L0', back)!.id).toBe('B0');
    });
    it('hidden leaves ("Show doors" off): every door passes despite the closed state', () => {
      gate({ show: false, open: {} });
      expect(walkRoomAt('L0', march('L0', [2.2, 4.6], 0, 1, 2))!.id).toBe('B0');
      expect(walkRoomAt('L1', march('L1', [2.9, 3.0], 1, 0, 2))!.id).toBe('BR2');
    });
    it('the sliding door D6 works like the others', () => {
      gate(defaultDoorState());
      expect(walkRoomAt('L1', march('L1', [7.4, 4.3], 0, -1, 2))!.id).toBe('BR1');
      gate(setDoorOpen(defaultDoorState(), 'D6', 1));
      expect(walkRoomAt('L1', march('L1', [7.4, 4.3], 0, -1, 2))!.id).toBe('B1');
    });
    it('the room walk never leads outside, even through the open entrance door', () => {
      gate(setDoorOpen(defaultDoorState(), 'D0', 1));
      const p = march('L0', [1.0, 4.2], -1, 0, 2);
      expect(walkRoomAt('L0', p)!.id).toBe('H0');
      expect(p[0]).toBeGreaterThan(0.3);
    });
    it('the building walk (WalkWorld) uses the same gate; a door cannot be closed on a user standing in its opening', () => {
      const site = project().site!;
      const world = new WalkWorld({ footprint: site.footprint, bounds: [-8, -8, 18, 16], ground: () => site.groundLevel });
      const go = (p: WalkPose, dx: number, dy: number, m: number) => { for (let i = 0; i < Math.round(m / 0.1); i++) p = world.step(p, dx * 0.1, dy * 0.1, EYE); return p; };
      gate(defaultDoorState());
      expect(world.placeAt(go({ p: [2.2, 4.6], z: 0 }, 0, 1, 2), EYE).label).toBe('Ground floor — Hall'); // bathroom closed
      gate(setDoorOpen(defaultDoorState(), 'D2', 1));
      const inBath = go({ p: [2.2, 4.6], z: 0 }, 0, 1, 2);
      expect(world.placeAt(inBath, EYE).label).toBe('Ground floor — Bathroom');
      const d = D('D2');
      expect(inDoorway(d, [2.2, 5.06])).toBe(true); expect(inDoorway(d, [2.2, 4.0])).toBe(false); expect(inDoorway(d, inBath.p)).toBe(false);
      // entrance door: closed — no way out, open — out onto the site
      gate(defaultDoorState());
      expect(go({ p: [1.0, 4.2], z: 0 }, -1, 0, 3).p[0]).toBeGreaterThan(0.3);
      gate(setDoorOpen(defaultDoorState(), 'D0', 1));
      expect(world.placeAt(go({ p: [1.0, 4.2], z: 0 }, -1, 0, 3), EYE).kind).toBe('site');
      expect(inDoorway(D('D0'), [0.15, 4.2])).toBe(true);
    });
  });
});
