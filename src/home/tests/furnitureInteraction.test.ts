// Dragging furniture in the scene (scene/interaction.ts): who drives a drag and when the camera gets control back.
// Reported defects: a second finger took over the dragged object (a 1.39 m jump) and ended the drag, a pinch started on a selected
// TV threw it by 1.25 m; Esc with a button pressed rotated the camera by 16.7° on the next pixel of motion; releasing the LEFT button
// while another one was pressed did not end the drag.
// The browser window is replaced here by a listener registry (capture phase first); the behaviour in the real scene is checked by
// scripts/verify/verify_furniture_edit.mjs.
// Data: demo apartment — living room R1, TV "arch-R1-tv" on the north wall R1-w3 (y = 3.90; +u runs towards −X).
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDoc } from '../../document/model';
import { initHistory } from '../../history/history';
import { withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { addElectrical, applyArchitectLayout, applyKitchen, planNow } from '../actions';
import { isWallMounted } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { addFurniture, removeFurniture, updateFurniture, withActive, withInterior } from '../model/interiors';
import { mountSurfaces } from '../model/mount';
import { furnitureBox, mountedPatch } from '../model/mountedFurniture';
import { levelById } from '../model/rooms';
import type { FurniturePlacement } from '../model/types';
import { canStartDrag, listen, mountedNow, nudge, nudgeMountedSide, screenAxis } from '../scene/interaction';
import { sceneApi } from '../scene/sceneApi';
import { cutHeight, PLAN_CUT_HEIGHT } from '../scene/sceneMode';
import { arrangementOf, commit, design, redo, undo, updateArrangement } from '../store/design';
import { ui } from '../store/ui';
import { patchFurnitureTree, patchRaycast, setSection } from '../three/cutaway';

const house = readProjectDir(path.resolve(__dirname, '..', '..', '..', 'projects', 'sample-house'));
const freshDoc = () => design.set({ history: initHistory(defaultDoc()), draft: null });

type Fn = (e: unknown) => void;
const reg = new Map<string, { fn: Fn; capture: boolean }[]>();
const fakeWindow = {
  addEventListener: (t: string, fn: Fn, capture = false) => { reg.set(t, [...(reg.get(t) ?? []), { fn, capture: !!capture }]); },
  removeEventListener: (t: string, fn: Fn, capture = false) => { reg.set(t, (reg.get(t) ?? []).filter((l) => !(l.fn === fn && l.capture === !!capture))); },
};
const fire = (t: string, e: object) => { const ls = reg.get(t) ?? []; for (const l of [...ls.filter((x) => x.capture), ...ls.filter((x) => !x.capture)]) l.fn(e); };
const listening = () => [...reg.values()].reduce((n, l) => n + l.length, 0);
const CANVAS = { id: 'canvas' } as unknown as HTMLCanvasElement;
const ptr = (o: Partial<{ pointerId: number; pointerType: string; buttons: number; isPrimary: boolean; target: unknown; clientX: number; clientY: number }> = {}) =>
  ({ pointerId: 1, pointerType: 'mouse', buttons: 1, isPrimary: true, target: CANVAS, clientX: 0, clientY: 0, ...o }) as unknown as PointerEvent;
const touch = (id: number, o: Parameters<typeof ptr>[0] = {}) => ptr({ pointerId: id, pointerType: 'touch', isPrimary: id === 10, ...o });
/** drag started by pointer `start`: log of moves and ends */
function session(start: PointerEvent, lock = true) {
  const log = { moves: [] as number[], ends: [] as ('commit' | 'cancel')[] };
  listen(start, (e) => log.moves.push(e.clientX), (e) => log.ends.push(e ? 'commit' : 'cancel'), lock);
  return log;
}

/** the window replaced by a listener registry — only in the drag-listener tests (the other tests of the file run without a window) */
function withFakeWindow() {
  const ui0 = ui.get();
  beforeEach(() => {
    reg.clear();
    vi.stubGlobal('window', fakeWindow);
    sceneApi.dom = CANVAS; sceneApi.locked = false; sceneApi.onLock = () => {};
    ui.set({ houseView: 'interior', roomId: 'R1', roomView: '3d' });
  });
  afterEach(() => { vi.unstubAllGlobals(); sceneApi.dom = null; sceneApi.locked = false; ui.set(ui0); });
}

describe('the drag is driven by the pointer that started it', () => {
  withFakeWindow();
  it('move, release and cancel of ANOTHER pointer are ignored (a second finger neither takes over the object nor ends the drag)', () => {
    const log = session(touch(10));
    expect(sceneApi.locked).toBe(true);
    fire('pointermove', touch(10, { clientX: 5 }));
    fire('pointermove', touch(11, { clientX: 300 }));                       // second finger — was: the object jumped under it
    fire('pointerup', touch(11));                                           // was: commit while the first finger was still down
    fire('pointercancel', touch(12));
    expect(log).toEqual({ moves: [5], ends: [] });
    expect(sceneApi.locked).toBe(true);
    fire('pointermove', touch(10, { clientX: 9 }));
    fire('pointerup', touch(10));
    expect(log).toEqual({ moves: [5, 9], ends: ['commit'] });
    expect(sceneApi.locked).toBe(false);
    expect(listening()).toBe(0);
  });

  it('a second finger ON THE SCENE during a finger drag: the drag is cancelled, the camera takes the gesture at once (pinch)', () => {
    const log = session(touch(10));
    fire('pointermove', touch(10, { clientX: 24 }));
    fire('pointerdown', touch(11));
    expect(log.ends).toEqual(['cancel']);
    expect(sceneApi.locked).toBe(false);
    // further motion and lifting the fingers neither move nor commit anything
    fire('pointermove', touch(10, { clientX: 60 })); fire('pointermove', touch(11, { clientX: 90 }));
    fire('pointerup', touch(11)); fire('pointerup', touch(10));
    expect(log).toEqual({ moves: [24], ends: ['cancel'] });
    expect(listening()).toBe(0);
  });

  it('a second finger in walk mode: the drag is cancelled, looking around waits until the first finger is lifted (the walk camera only knows where it touched)', () => {
    ui.set({ roomView: 'walk' });
    const log = session(touch(10));
    fire('pointerdown', touch(11));
    expect(log.ends).toEqual(['cancel']);
    expect(sceneApi.locked).toBe(true);
    fire('pointerup', touch(11));
    expect(sceneApi.locked).toBe(true);
    fire('pointerup', touch(10));
    expect(sceneApi.locked).toBe(false);
    expect(log.ends).toEqual(['cancel']);
    expect(listening()).toBe(0);
  });

  it('a second finger OUTSIDE the scene (a UI button) and a second pointer during a mouse drag do not cancel the drag', () => {
    const a = session(touch(10));
    fire('pointerdown', touch(11, { target: { id: 'button' } }));
    expect(a.ends).toEqual([]);
    fire('pointerup', touch(10));
    expect(a.ends).toEqual(['commit']);
    const b = session(ptr());
    fire('pointerdown', touch(11));
    expect(b.ends).toEqual([]);
    fire('pointerup', ptr());
    expect(b.ends).toEqual(['commit']);
  });

  it('another press does not start a second drag: another one is running (lock) or it is a second finger (camera gesture)', () => {
    expect(canStartDrag(ptr())).toBe(true);
    expect(canStartDrag(touch(10))).toBe(true);
    expect(canStartDrag(touch(11))).toBe(false);                            // a second finger — even when the first one drags no furniture
    session(touch(10));
    expect(canStartDrag(touch(10))).toBe(false);
    expect(canStartDrag(ptr())).toBe(false);
  });
});

describe('cancelling and releasing the button', () => {
  withFakeWindow();
  it('Esc cancels at once, but the camera stays paused until the button is released (was: a 16.7° rotation on the next pixel of motion)', () => {
    const log = session(ptr());
    fire('pointermove', ptr({ clientX: 40 }));
    let stopped = 0;
    fire('keydown', { key: 'Escape', stopImmediatePropagation: () => { stopped++; } });
    expect(log).toEqual({ moves: [40], ends: ['cancel'] });
    expect(stopped).toBe(1);                                                // Esc only cancels — it neither deselects nor leaves the room
    expect(sceneApi.locked).toBe(true);
    fire('pointermove', ptr({ clientX: 41 }));                              // motion after the cancel: neither the furniture nor the camera
    expect(log.moves).toEqual([40]);
    expect(sceneApi.locked).toBe(true);
    fire('pointerup', ptr({ buttons: 0 }));
    expect(log.ends).toEqual(['cancel']);                                   // the release after the cancel commits nothing
    expect(sceneApi.locked).toBe(false);
    expect(listening()).toBe(0);
  });

  it('other keys do not interrupt the drag', () => {
    const log = session(ptr());
    let stopped = 0;
    fire('keydown', { key: 'Shift', stopImmediatePropagation: () => { stopped++; } });
    expect(log.ends).toEqual([]);
    expect(stopped).toBe(0);
  });

  it('mouse: releasing the LEFT button while another one is held ends the drag (the browser sends a move then, not a release)', () => {
    const log = session(ptr());
    fire('pointermove', ptr({ clientX: 30, buttons: 3 }));                  // left + right: the drag goes on
    fire('pointermove', ptr({ clientX: 31, buttons: 2 }));                  // left released, right held
    expect(log).toEqual({ moves: [30], ends: ['commit'] });
    expect(sceneApi.locked).toBe(true);                                     // the camera waits for the last button to be released
    fire('pointermove', ptr({ clientX: 80, buttons: 2 }));
    expect(log.moves).toEqual([30]);
    fire('pointerup', ptr({ buttons: 0 }));
    expect(log.ends).toEqual(['commit']);
    expect(sceneApi.locked).toBe(false);
    expect(listening()).toBe(0);
  });

  it('pointercancel cancels and frees the camera; a lost release does not leave the scene locked (the next press of the same pointer cleans up)', () => {
    const a = session(touch(10));
    fire('pointercancel', touch(10));
    expect(a.ends).toEqual(['cancel']);
    expect(sceneApi.locked).toBe(false);
    const b = session(ptr());
    fire('pointerdown', ptr());                                             // the release never arrived (e.g. outside the browser window)
    expect(b.ends).toEqual(['cancel']);
    expect(sceneApi.locked).toBe(false);
    expect(listening()).toBe(0);
  });

  it('a drag from the catalog (started outside the scene) does not lock the camera', () => {
    const log = session(ptr({ target: { id: 'card' } }), false);
    expect(sceneApi.locked).toBe(false);
    fire('pointermove', ptr({ clientX: 12 }));
    fire('pointerup', ptr({ buttons: 0 }));
    expect(log).toEqual({ moves: [12], ends: ['commit'] });
    expect(sceneApi.locked).toBe(false);
  });
});

// ------------------------------------------------------------------ top view
// The room plan cuts the architecture at 1.20 m but does not clip furniture — it is shown whole. The furniture raycast rejected
// everything above the PLAN section, so a TV (0.95–1.79 m), a mirror or a tall wardrobe could not be selected or grabbed in plan.
// Data: sample-house — ground floor L0 (+0.00) and first floor L1 (+2.95).
describe('top view: furniture above the plan section can be picked', () => {
  /** furniture as in the scene: a group with a box whose underside is at `bottom` and height `h` (three.js world: Y up), with the furniture raycast */
  const furniture = (bottom: number, h: number) => {
    const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(1.45, h, 0.05));
    m.position.set(0, bottom + h / 2, 0); g.add(m); g.updateMatrixWorld(true);
    patchFurnitureTree(g);
    return g;
  };
  /** plan pointer: a ray straight down above the box centre */
  const fromAbove = (o: THREE.Object3D) => new THREE.Raycaster(new THREE.Vector3(0, 60, 0), new THREE.Vector3(0, -1, 0)).intersectObject(o, true).length;
  const levels = () => ({ L0: levelById('L0')!, L1: levelById('L1')!, cut0: cutHeight('L0'), cut1: cutHeight('L1') });
  /** the furniture raycast reads the level heights of the active project — every case runs on sample-house */
  const inHouse = (fn: () => void) => () => withProject(house, fn);
  afterEach(() => setSection(null));

  it('ground-floor plan (section 1.20 m): a TV at 0.95–1.79 m and a 1.78 m fridge are hit; furniture of the floor above — not', inHouse(() => {
    const { L0, L1 } = levels();
    expect(L1.floorZ).toBeCloseTo(2.95, 6);
    setSection(L0.floorZ + PLAN_CUT_HEIGHT);
    expect(fromAbove(furniture(L0.floorZ + 0.95, 0.84))).toBeGreaterThan(0);  // TV — was: 0 hits
    expect(fromAbove(furniture(L0.floorZ, 1.78))).toBeGreaterThan(0);         // fridge (its top above the plan section)
    expect(fromAbove(furniture(L0.floorZ, 0.42))).toBeGreaterThan(0);         // coffee table — as before
    expect(fromAbove(furniture(L1.floorZ, 0.9))).toBe(0);                     // another level does not intercept clicks
    expect(fromAbove(furniture(L1.floorZ + 0.95, 0.84))).toBe(0);
  }));
  it('level section and 3D room view unchanged: everything below the level section, nothing above it', inHouse(() => {
    const { L0, L1, cut0, cut1 } = levels();
    setSection(L0.floorZ + cut0);
    expect(fromAbove(furniture(L0.floorZ + 0.95, 0.84))).toBeGreaterThan(0);
    expect(fromAbove(furniture(L1.floorZ, 0.9))).toBe(0);
    setSection(L1.floorZ + PLAN_CUT_HEIGHT);                                    // plan of a room on the first floor
    expect(fromAbove(furniture(L1.floorZ + 0.6, 0.9))).toBeGreaterThan(0);     // a mirror above 1.20 m
    expect(fromAbove(furniture(L1.floorZ + cut1 + 0.2, 0.3))).toBe(0);
    setSection(null);                                                          // no section (exterior view, walk): everything
    expect(fromAbove(furniture(L1.floorZ, 0.9))).toBeGreaterThan(0);
  }));
  it('architecture is still filtered by the plan section (a click hits what is visible)', inHouse(() => {
    const { L0 } = levels();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 2.7, 0.25));
    wall.position.set(0, L0.floorZ + 1.35, 0); wall.updateMatrixWorld(true);
    patchRaycast(wall);
    setSection(L0.floorZ + PLAN_CUT_HEIGHT);
    expect(fromAbove(wall)).toBe(0);                                           // the wall top (2.70 m) is above the section
  }));
  it('a hidden part of the architecture (a roof in the section of the level it covers) catches no click', inHouse(() => {
    const { L0 } = levels();
    const group = new THREE.Group(), roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4));
    roof.position.set(0, L0.floorZ + 1.0, 0); group.add(roof); group.updateMatrixWorld(true);
    patchRaycast(roof);
    setSection(null);
    expect(fromAbove(group)).toBeGreaterThan(0);
    group.visible = false;
    expect(fromAbove(group)).toBe(0);
  }));
});

// ------------------------------------------------------------------ wall-object steps in the direction visible on screen
// The ↑ / ↓ arrows changed the height also in the top view (silently — the height is not visible there), and on a wall vertical on
// screen ← / → moved the object down / up. The "◀ ▶" buttons in the panel and on the phone toolbar were computed relative to the
// room: in the default view (camera behind the TV wall) "◀" moved the object RIGHT on screen.
describe('wall-object axis for an on-screen arrow', () => {
  // screen images of the +u (along the wall) and +v (up) steps [px; x right, y down]
  it('camera in front of the wall: ← → along the wall, ↑ ↓ height', () => {
    const su: [number, number] = [-24, 0], sv: [number, number] = [0, -24];        // seen from the room +u runs to the left
    expect(screenAxis(su, sv, 1, 0)).toEqual({ axis: 'u', sign: -1 });
    expect(screenAxis(su, sv, -1, 0)).toEqual({ axis: 'u', sign: 1 });
    expect(screenAxis(su, sv, 0, 1)).toEqual({ axis: 'v', sign: 1 });
    expect(screenAxis(su, sv, 0, -1)).toEqual({ axis: 'v', sign: -1 });
  });
  it('camera behind the wall (view through a cut-away wall): +u runs right on screen', () => {
    expect(screenAxis([24, 0], [0, -24], 1, 0)).toEqual({ axis: 'u', sign: 1 });
    expect(screenAxis([24, 0], [0, -24], -1, 0)).toEqual({ axis: 'u', sign: -1 });
  });
  it('default room view (steep camera, the wall oblique on screen): ↑ ↓ still mean HEIGHT although the image of a step along the wall has a larger vertical component', () => {
    // camera 60° down: the up step is foreshortened on screen (2.8; −5) and the wall runs obliquely (10.4; −7)
    const su: [number, number] = [10.4, -7], sv: [number, number] = [2.8, -5];
    expect(screenAxis(su, sv, 0, 1)).toEqual({ axis: 'v', sign: 1 });
    expect(screenAxis(su, sv, 0, -1)).toEqual({ axis: 'v', sign: -1 });
    expect(screenAxis(su, sv, 1, 0)).toEqual({ axis: 'u', sign: 1 });
    expect(screenAxis(su, sv, -1, 0)).toEqual({ axis: 'u', sign: -1 });
  });
  it('top view, a wall horizontal on screen: ↑ ↓ do nothing (the height is not visible), ← → along the wall', () => {
    const su: [number, number] = [19, 0], sv: [number, number] = [0, 0];
    expect(screenAxis(su, sv, 0, 1)).toBeNull();
    expect(screenAxis(su, sv, 0, -1)).toBeNull();
    expect(screenAxis(su, sv, 1, 0)).toEqual({ axis: 'u', sign: 1 });
  });
  it('top view, a wall vertical on screen: ↑ ↓ along the wall towards the arrow, ← → nothing', () => {
    const su: [number, number] = [0, -19], sv: [number, number] = [0, 0];           // +u runs up on screen
    expect(screenAxis(su, sv, 0, 1)).toEqual({ axis: 'u', sign: 1 });
    expect(screenAxis(su, sv, 0, -1)).toEqual({ axis: 'u', sign: -1 });
    expect(screenAxis(su, sv, 1, 0)).toBeNull();
    expect(screenAxis(su, sv, -1, 0)).toBeNull();
  });
  it('a wall seen edge-on (a step along it has no horizontal component): ← → nothing — they never change the height, even though perspective tilts the screen vertical', () => {
    const su: [number, number] = [0.2, -9], sv: [number, number] = [2.8, -5];
    expect(screenAxis(su, sv, 1, 0)).toBeNull();
    expect(screenAxis(su, sv, -1, 0)).toBeNull();
    expect(screenAxis(su, sv, 0, 1)).toEqual({ axis: 'v', sign: 1 });
  });
  it('a point outside the frame (no image): nothing', () => {
    expect(screenAxis(null, null, 1, 0)).toBeNull();
  });
});

describe('arrows and step buttons: the object moves in the direction visible on screen', () => {
  const ROOM = 'R1', TV = 'arch-R1-tv', MIRROR = 'mirror-east';
  const dom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 }) } as unknown as HTMLCanvasElement;
  /** room plan: an orthographic camera above the room, X right, Y up (as on plans), zoom in px / m */
  const topView = () => {
    const c = new THREE.OrthographicCamera(-600, 600, 400, -400, 0.1, 400);
    c.up.set(0, 0, -1); c.position.set(5.6, 35, -2.1); c.zoom = 140; c.lookAt(5.6, 0, -2.1); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    sceneApi.camera = c; sceneApi.dom = dom;
  };
  /** perspective camera at the LCS position (x, y, z), looking at an LCS point */
  const perspective = (pos: [number, number, number], at: [number, number, number]) => {
    const c = new THREE.PerspectiveCamera(50, 1200 / 800, 0.05, 900);
    c.position.set(pos[0], pos[2], -pos[1]); c.lookAt(at[0], at[2], -at[1]); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    sceneApi.camera = c; sceneApi.dom = dom;
  };
  const f = (id: string) => arrangementOf(design.get(), ROOM).furniture.find((x) => x.id === id)!;
  const past = () => design.get().history.past.length;
  const ST = 0.01;

  beforeEach(() => {
    freshDoc();
    // a mirror on the living-room east wall R1-w2 (vertical on the plan screen): +u runs towards +Y; u = 2.50 → y = 2.80
    const E = mountSurfaces(ROOM).find((x) => x.segments.some((g) => g.wallId === 'R1-w2'))!, base: FurniturePlacement = { id: MIRROR, catalogId: 'mirror', variant: 'rect', x: 0, y: 0, rot: 0 };
    updateArrangement(ROOM, 'mirror', (a) => addFurniture(a, { ...base, ...mountedPatch(E, furnitureBox(itemById('mirror')!, base), 2.5, 1.1) }));
  });
  afterEach(() => { sceneApi.camera = null; sceneApi.dom = null; });

  it('top view, the TV on a wall horizontal on screen: ↑ / ↓ change no height and create no history entry; → moves it right', () => {
    topView();
    const a = f(TV), p0 = past();
    nudge(ROOM, TV, 0, ST); nudge(ROOM, TV, 0, -ST);
    expect(f(TV)).toBe(a);                                                    // was: height 1.00 → 1.01 → 1.00 (two history entries)
    expect(past()).toBe(p0);
    nudge(ROOM, TV, ST, 0);
    expect(f(TV).x).toBeCloseTo(a.x + ST, 6);
    expect(f(TV).elevation).toBe(a.elevation);
    expect(past()).toBe(p0 + 1);
  });

  it('top view, the mirror on a wall vertical on screen: ↑ moves it up the screen (+Y), ↓ down; ← / → nothing (was: ← / → moved it down / up)', () => {
    topView();
    const a = f(MIRROR), p0 = past();
    nudge(ROOM, MIRROR, ST, 0); nudge(ROOM, MIRROR, -ST, 0);
    expect(f(MIRROR)).toBe(a);
    expect(past()).toBe(p0);
    nudge(ROOM, MIRROR, 0, ST);
    expect(f(MIRROR).y).toBeCloseTo(a.y + ST, 6);
    expect(f(MIRROR).elevation).toBe(a.elevation);
    nudge(ROOM, MIRROR, 0, -ST);
    expect(f(MIRROR).y).toBeCloseTo(a.y, 6);
  });

  it('camera in the room facing the wall: → right on screen (+X), ↑ raises the object', () => {
    perspective([6.3, 0.6, 1.6], [6.3, 3.9, 1.42]);
    const a = f(TV);
    nudge(ROOM, TV, ST, 0);
    expect(f(TV).x).toBeCloseTo(a.x + ST, 6);
    nudge(ROOM, TV, 0, ST);
    expect(f(TV).elevation).toBeCloseTo(a.elevation! + ST, 6);
  });

  it('the "◀" button (panel, phone toolbar): left ON SCREEN — camera behind the TV wall and camera in the room', () => {
    perspective([6.3, 8.5, 7], [6.3, -0.5, 0.5]);                             // default room view: camera behind the wall, above it, looking −Y
    const a = f(TV);
    nudgeMountedSide(ROOM, TV, -1, ST);
    expect(f(TV).x).toBeCloseTo(a.x + ST, 6);                                 // left on screen = +X from behind (was: the opposite way)
    nudgeMountedSide(ROOM, TV, 1, ST);
    expect(f(TV).x).toBeCloseTo(a.x, 6);
    perspective([6.3, 0.6, 1.6], [6.3, 3.9, 1.42]);                           // from the room: left on screen = −X
    nudgeMountedSide(ROOM, TV, -1, ST);
    expect(f(TV).x).toBeCloseTo(a.x - ST, 6);
  });

  it('the "◀" button with a wall vertical on screen (plan): towards the left corner as seen from the room — the button is never dead', () => {
    topView();
    const u0 = mountedNow(ROOM, MIRROR)!.u;
    nudgeMountedSide(ROOM, MIRROR, -1, ST);
    expect(mountedNow(ROOM, MIRROR)!.u).toBeCloseTo(u0 + ST, 6);
  });
});

// ------------------------------------------------------------------ project layout as a new arrangement
// The default arrangement gets mount records when it is built (defaults.ts), but "Project layout as a new arrangement" and "Project
// kitchen" inserted the furniture straight from the data — the TV and the wall cabinet had no record (the wall was guessed from the position).
describe('project furniture inserted into an arrangement: wall objects with a mount record', () => {
  const ui0 = ui.get();
  afterEach(() => { ui.set(ui0); freshDoc(); });
  const hungWithoutRecord = (roomId: string) => arrangementOf(design.get(), roomId).furniture.filter((x) => isWallMounted(itemById(x.catalogId)) && !x.mount).map((x) => x.catalogId);

  it('"Project layout as a new arrangement": the TV in the new arrangement has a mount record and hangs where the project puts it', () => {
    freshDoc();
    applyArchitectLayout('R1');
    const a = arrangementOf(design.get(), 'R1'), tv = a.furniture.find((x) => x.catalogId === 'tv-wall')!;
    expect(a.name).toBe('Project layout');
    expect(tv.mount).toBeTruthy();                                            // was: no record
    const m = mountedNow('R1', tv.id)!;
    expect(m.surface.id).toBe('R1#3');
    expect(m.u).toBeCloseTo(2.4, 6);
    expect(m.v).toBe(1);
    expect(hungWithoutRecord('R1')).toEqual([]);
  });

  it('"Project kitchen": the wall cabinet inserted into the arrangement has a mount record', () => {
    freshDoc();
    applyKitchen('R1');
    const a = arrangementOf(design.get(), 'R1'), cab = a.furniture.filter((x) => x.catalogId === 'kitchen-wall');
    expect(cab.length).toBeGreaterThan(0);
    expect(cab.every((x) => !!x.mount)).toBe(true);                            // was: no record
    expect(hungWithoutRecord('R1').filter((c) => c === 'kitchen-wall')).toEqual([]);
  });
});

// ------------------------------------------------------------------ selection after Undo / Redo
// The selection lives outside the document. After undoing the addition of furniture / a device, or the move of furniture to another
// room, it pointed at an object that was no longer there: an empty side panel, and Delete / arrows / Ctrl+D hit nothing.
describe('the selection after Undo / Redo points at an existing object', () => {
  const ui0 = ui.get(), TV = 'arch-R1-tv';
  beforeEach(() => { freshDoc(); ui.set({ selection: null }); });
  afterEach(() => { ui.set(ui0); freshDoc(); });
  const has = (roomId: string, id: string) => arrangementOf(design.get(), roomId).furniture.some((f) => f.id === id);
  /** moving furniture to another room in one history entry (like dragging a wall object through a passage) */
  const transfer = (id: string, from: string, to: string) => {
    const p = arrangementOf(design.get(), from).furniture.find((f) => f.id === id)!;
    commit('transfer', (doc) => ({ ...doc, variants: doc.variants.map((v) => (v.id !== doc.activeVariantId ? v : {
      ...v, interiors: withInterior(withInterior(v.interiors ?? {}, from, (ri) => withActive(ri, (a) => removeFurniture(a, id))), to, (ri) => withActive(ri, (a) => addFurniture(a, { ...p, mount: null }))) })) }));
    ui.set({ selection: { kind: 'furniture', roomId: to, id } });
  };

  it('undone addition of furniture: the selection is cleared; Redo brings the furniture back (unselected)', () => {
    updateArrangement('R1', 'add', (a) => addFurniture(a, { id: 'new', catalogId: 'armchair', x: 5, y: 2, rot: 0 }));
    ui.set({ selection: { kind: 'furniture', roomId: 'R1', id: 'new' } });
    undo();
    expect(has('R1', 'new')).toBe(false);
    expect(ui.get().selection).toBeNull();                                    // was: a selection of non-existent furniture
    redo();
    expect(has('R1', 'new')).toBe(true);
    expect(ui.get().selection).toBeNull();
  });

  it('undone move to another room: the selection follows the furniture back to the room it is in again; Redo — the other way', () => {
    transfer(TV, 'R1', 'R2');
    expect(has('R2', TV)).toBe(true);
    undo();
    expect(has('R1', TV) && !has('R2', TV)).toBe(true);
    expect(ui.get().selection).toEqual({ kind: 'furniture', roomId: 'R1', id: TV });   // was: { roomId: 'R2' } — the furniture is not there
    redo();
    expect(ui.get().selection).toEqual({ kind: 'furniture', roomId: 'R2', id: TV });
  });

  it('undone addition of an electrical device: the selection is cleared (was: an empty device panel)', () => {
    const id = addElectrical('socket-1', { roomId: 'R1', wallId: 'R1-w3', orientation: 'wall', positionAlongWall: 1.2, heightAFFL: 0.3 })!;
    expect(ui.get().selection).toEqual({ kind: 'electrical', id });
    undo();
    expect(planNow().points.some((p) => p.id === id)).toBe(false);
    expect(ui.get().selection).toBeNull();
  });

  it('the selection of an object that still exists after Undo stays unchanged (the same value); other selection kinds — untouched', () => {
    updateArrangement('R1', 'move', (a) => updateFurniture(a, TV, { elevation: 1.1 }));
    const sel = { kind: 'furniture' as const, roomId: 'R1', id: TV };
    ui.set({ selection: sel });
    undo();
    expect(ui.get().selection).toBe(sel);
    const wall = { kind: 'wall' as const, roomId: 'R1', wallId: 'R1-w3' };
    ui.set({ selection: wall });
    redo(); undo();
    expect(ui.get().selection).toBe(wall);
  });
});
