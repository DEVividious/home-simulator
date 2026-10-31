// Editing during a walk: a building walk started in a room keeps the room context after the room walk hands over to the
// building walk (report: after walking from one room into another the TV could not be selected). State logic only — no browser.
// Demo apartment: hallway R4, living room R1 (one level L1); the cross-level case uses the sample house (L0 / L1).
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activateProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { goSection } from '../actions';
import { backStep } from '../backNav';
import { sceneMode } from '../scene/sceneMode';
import { exitWalk, isWalking, startWalk, ui, type Section } from '../store/ui';
import { walkHud } from '../store/walk';

const root = path.resolve(__dirname, '..', '..', '..');
const base = { houseView: 'exterior' as const, level: 'L1', roomId: null, roomView: '3d' as const, environment: true };
const POSE = { p: [6.3, 1.5] as [number, number], z: 0, yaw: 0, pitch: 0 };
/** state after the room walk handed over to the building walk; the user started in the hallway and now stands in the living room */
const handedOver = (section: Section = 'arrange') => {
  ui.set({ section, roomId: null, houseView: 'walk', roomView: '3d', selection: null, walkGo: { pose: POSE, from: { roomId: 'R4', level: 'L1' }, n: 7 } });
  walkHud.set({ on: true, roomId: 'R1', kind: 'room', place: 'Apartment — Living room with kitchenette' });
};

beforeEach(() => {
  ui.set({ settingsOpen: false, onboardingDone: true, menu: null, sheet: 'collapsed', selection: null, compare: null,
    section: 'look', roomId: null, roomView: '3d', houseView: 'exterior', level: 'L1', walkGo: { n: 0 } });
  walkHud.set({ on: false, roomId: null, kind: '', place: '' });
});

describe('scene mode during a building walk', () => {
  it('the room underfoot is the scene room (walls and floor can be picked) — only when given', () => {
    expect(sceneMode({ ...base, houseView: 'walk', walkRoomId: 'R1' })).toMatchObject({ kind: 'walk', roomId: 'R1', roomView: 'walk', cutZ: null });
    expect(sceneMode({ ...base, houseView: 'walk' })).toMatchObject({ kind: 'walk', roomId: null });
    expect(sceneMode({ ...base, houseView: 'walk', walkRoomId: null })).toMatchObject({ kind: 'walk', roomId: null });
  });
  it('an unknown room underfoot is ignored; outside a walk the room underfoot does not matter', () => {
    expect(sceneMode({ ...base, houseView: 'walk', walkRoomId: 'no-such-room' }).roomId).toBeNull();
    expect(sceneMode({ ...base, houseView: 'interior', walkRoomId: 'R1' })).toMatchObject({ kind: 'level', roomId: null });
    expect(sceneMode({ ...base, roomId: 'R4', walkRoomId: 'R1' })).toMatchObject({ kind: 'room', roomId: 'R4' });
  });
});

describe('whether the user is walking (one rule for keys, bars and the pointer)', () => {
  it('building walk and room walk', () => {
    expect(isWalking({ houseView: 'walk', roomId: null, roomView: '3d' })).toBe(true);
    expect(isWalking({ houseView: 'interior', roomId: 'R4', roomView: 'walk' })).toBe(true);
  });
  it('stale fields do not fake a walk: room in 3D after a building walk, building view after a room walk', () => {
    expect(isWalking({ houseView: 'walk', roomId: 'R4', roomView: '3d' })).toBe(false);
    expect(isWalking({ houseView: 'exterior', roomId: null, roomView: 'walk' })).toBe(false);
    expect(isWalking({ houseView: 'interior', roomId: null, roomView: 'walk' })).toBe(false);
  });
});

describe('end of the walk', () => {
  it('walk from the Look step: exterior building view; the room view does not stay on "walk"', () => {
    ui.set({ roomView: 'walk' });
    startWalk();
    expect(ui.get()).toMatchObject({ houseView: 'walk', roomId: null });
    exitWalk();
    expect(ui.get()).toMatchObject({ houseView: 'exterior', roomId: null, roomView: '3d', selection: null });
  });
  it('walk started in a room: back to the 3D view of the room the user stands in', () => {
    handedOver();
    ui.set({ selection: { kind: 'furniture', roomId: 'R1', id: 'arch-tv' } });
    const n = ui.get().camera.n;
    exitWalk();
    const s = ui.get();
    expect(s).toMatchObject({ roomId: 'R1', level: 'L1', houseView: 'interior', roomView: '3d', section: 'arrange', selection: null });
    expect(s.camera).toMatchObject({ preset: 'room', n: n + 1 });
    expect(s.walkGo.from ?? null).toBeNull();                                 // the next walk from the Look step is a plain tour
  });
  it('walk started in a room, user on the stairs / on the site: back to the room the walk started from', () => {
    handedOver();
    walkHud.set({ roomId: null, kind: 'stairs', place: 'Stairs' });
    exitWalk();
    expect(ui.get()).toMatchObject({ roomId: 'R4', level: 'L1', houseView: 'interior', roomView: '3d' });
  });
  it('another step (the user switched to Look during the walk): back in the room, still in Look (usability issue B1)', () => {
    handedOver('look');
    exitWalk();
    expect(ui.get()).toMatchObject({ roomId: 'R1', section: 'look' });
  });
  it('the Versions step during the walk: back in the room — Arrange (the step that works with a room)', () => {
    handedOver('variants');
    exitWalk();
    expect(ui.get()).toMatchObject({ roomId: 'R1', section: 'arrange' });
  });
  it('system "back" on a phone: walk started in a room → room → level section → building view', () => {
    handedOver();
    const seq: string[] = [];
    while (backStep()) { const s = ui.get(); seq.push(`${s.houseView}/${s.roomId ?? '-'}/${s.roomView}`); }
    expect(seq).toEqual(['interior/R1/3d', 'interior/-/3d', 'exterior/-/3d']);
  });
});

describe('end of the walk in a multi-level building (sample house)', () => {
  beforeAll(() => { activateProject(readProjectDir(path.join(root, 'projects', 'sample-house'))); });
  afterAll(() => { activateProject(readProjectDir(path.join(root, 'projects', 'demo-apartment'))); });
  it('walk started in a room, the room underfoot on another level: the level of that room', () => {
    ui.set({ section: 'arrange', roomId: null, houseView: 'walk', roomView: '3d', level: 'L0', walkGo: { pose: { p: [1.8, 4.2], z: 0, yaw: 0, pitch: 0 }, from: { roomId: 'H0', level: 'L0' }, n: 3 } });
    walkHud.set({ on: true, roomId: 'BR1', kind: 'room', place: 'First floor — Main bedroom' });
    exitWalk();
    expect(ui.get()).toMatchObject({ roomId: 'BR1', level: 'L1', roomView: '3d', houseView: 'interior' });
  });
});

describe('steps during a walk started in a room', () => {
  it('Versions → Arrange does not interrupt the walk (as in a room walk)', () => {
    handedOver('variants');
    goSection('arrange');
    expect(ui.get()).toMatchObject({ section: 'arrange', houseView: 'walk', roomId: null });
  });
  it('touring from the Look step: Arrange ends the walk with a level section (unchanged)', () => {
    startWalk();
    goSection('arrange');
    expect(ui.get()).toMatchObject({ section: 'arrange', houseView: 'interior' });
  });
});
