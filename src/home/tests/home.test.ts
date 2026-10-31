// Home configurator logic (no browser): project store (history, preview), document serialization and validation, finishes,
// room membership, LCS ↔ three.js transforms, arrangements, GLB import (normalisation), import endpoint (names, signatures),
// thumbnails, scene mode, wall cutaway, keeping furniture inside, walking between rooms, project default furnishing.
// Data: the demo apartment (active), the sample house (two levels) and the "sloped-ceiling" fixture where a test needs them.
import path from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultDoc, docErrors, parseDoc, serializeDoc } from '../../document/model';
import { initHistory } from '../../history/history';
import { fmtM, fmtNum, t } from '../../i18n';
import { activateProject, project, withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { fixtureDir } from '../../test/setup';
import { BUILTIN_ITEMS, resolveDims } from '../catalog/furniture';
import { furnitureThumbnail } from '../catalog/thumbnails';
import { itemById, setImportedAssets } from '../catalog/providers';
import { pointInPolygon } from '@home-sim/core/model/geom2d';
import {
  activeArrangement, addFurniture, defaultInterior, deleteArrangement, duplicateArrangement, loadArrangement, newEmptyArrangement, renameArrangement,
  removeFurniture, saveArrangement, setFinish, updateFurniture,
} from '../model/interiors';
import { allLevels, allRooms, roomAt, roomById, roomsOfLevel, roomsWithTag } from '../model/rooms';
import { keepInside, rotFacing } from '../model/snapping';
import { BODY_R, doorCorridors, FRONT_STOP, walkRoomAt, walkStep } from '../model/walk';
import { architectItems, architectFurniture, architectItemOf, defaultFurniture, isArchitectId, kitchenBuiltIn } from '../model/defaults';
import { furnitureWarnings } from '../model/collision';
import { neighbours } from '../model/placement';
import type { Arrangement, CameraBookmark, FurniturePlacement, ImportedAsset } from '../model/types';
import { cutHeight, sceneMode } from '../scene/sceneMode';
import { safeName, validSignature } from '../server';
import { arrangementOf, cancelPreview, commit, design, docOf, preview, previewArrangement, redo, undo, updateArrangement } from '../store/design';
import { clipState, nearWalls, setCutaway, visibleAt } from '../three/cutaway';
import { analyze, convexHull, normalize, TRI_WARN, warningsFor } from '../three/importGlb';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const sampleHouse = () => readProjectDir(path.join(ROOT, 'projects', 'sample-house'));
const slopedCeiling = () => readProjectDir(fixtureDir('sloped-ceiling'));
/** a room of the demo apartment that has default furniture: user items are told apart by id */
const ROOM = 'R2';
const desk = (id: string, x = 6, y = 5.3, rot = 0): FurniturePlacement => ({ id, catalogId: 'desk', x, y, rot });
const mine = (a: Arrangement) => a.furniture.filter((f) => !isArchitectId(f.id));
const reset = () => design.set({ history: initHistory(defaultDoc()), saved: null, draft: null, loaded: true });

describe('project store: one history entry per operation, preview outside the history', () => {
  beforeEach(reset);
  it('commit creates an entry; no change — no entry', () => {
    expect(updateArrangement(ROOM, 'add desk', (a) => addFurniture(a, desk('f1')))).toBe(true);
    expect(design.get().history.past).toHaveLength(1);
    expect(updateArrangement(ROOM, 'nothing', (a) => a)).toBe(false);
    expect(updateArrangement(ROOM, 'the same', (a) => updateFurniture(a, 'f1', { x: 6 }))).toBe(false);
    expect(design.get().history.past).toHaveLength(1);
    expect(mine(arrangementOf(design.get(), ROOM)).map((f) => f.id)).toEqual(['f1']);
    // the project default furniture of the room stays in the arrangement
    expect(arrangementOf(design.get(), ROOM).furniture.length).toBe(defaultFurniture(ROOM).length + 1);
  });
  it('dragging (many previews) = one entry; cancelling the preview restores the state', () => {
    const f1 = () => arrangementOf(design.get(), ROOM).furniture.find((f) => f.id === 'f1')!;
    updateArrangement(ROOM, 'add', (a) => addFurniture(a, desk('f1')));
    for (let i = 1; i <= 50; i++) previewArrangement(ROOM, (a) => updateFurniture(a, 'f1', { x: 6 + i * 0.01 }));
    expect(design.get().history.past).toHaveLength(1);
    expect(f1().x).toBeCloseTo(6.5);
    cancelPreview();
    expect(f1().x).toBe(6);
    previewArrangement(ROOM, (a) => updateFurniture(a, 'f1', { x: 6.3 }));
    updateArrangement(ROOM, 'move', (a) => updateFurniture(a, 'f1', { x: 6.3 }));
    expect(design.get().history.past).toHaveLength(2);
    expect(design.get().draft).toBeNull();
  });
  it('undo / redo: move, rotate, add, remove, material', () => {
    updateArrangement(ROOM, 'add', (a) => addFurniture(a, desk('f1')));
    updateArrangement(ROOM, 'rotate', (a) => updateFurniture(a, 'f1', { rot: 90 }));
    updateArrangement(ROOM, 'material', (a) => updateFurniture(a, 'f1', { materialId: 'wood-walnut' }));
    updateArrangement(ROOM, 'floor', (a) => setFinish(a, { kind: 'floor' }, { materialId: 'vinyl-oak-natural' }));
    const a = () => arrangementOf(design.get(), ROOM), f1 = () => mine(a())[0];
    expect(a().finishes.floor?.materialId).toBe('vinyl-oak-natural');
    undo(); expect(a().finishes.floor).toBeNull();
    undo(); expect(f1().materialId ?? null).toBeNull();
    undo(); expect(f1().rot).toBe(0);
    undo(); expect(mine(a())).toHaveLength(0);
    expect(undo()).toBe(false);
    redo(); redo(); expect(f1().rot).toBe(90);
    updateArrangement(ROOM, 'new branch', (x) => updateFurniture(x, 'f1', { x: 6.2 }));
    expect(redo()).toBe(false); // a new change clears the future
  });
  it('document with a preview: docOf returns the preview, the history — the committed state', () => {
    preview((d) => ({ ...d, bookmarks: [{ id: 'b', name: 'x', position: [0, 0, 0], target: [1, 1, 1], fov: 40 }] }));
    expect(docOf(design.get()).bookmarks).toHaveLength(1);
    expect(design.get().history.present.bookmarks).toHaveLength(0);
    cancelPreview();
    commit('bookmark', (d) => ({ ...d, bookmarks: [{ id: 'b', name: 'x', position: [0, 0, 0], target: [1, 1, 1], fov: 40 }] }));
    expect(design.get().history.present.bookmarks).toHaveLength(1);
  });
});

describe('document serialization (interiors, bookmarks, imported models)', () => {
  it('write → read without loss', () => {
    const d = defaultDoc();
    const ri = { ...defaultInterior(ROOM) };
    ri.arrangements = [{ ...ri.arrangements[0], name: 'Bedroom A', saved: true, furniture: [desk('f1'), { id: 'f2', catalogId: 'bed', variant: '140', x: 6, y: 5.5, rot: 180, dims: null, materialId: 'fabric-grey' }],
      finishes: { walls: { [`${ROOM}-w3`]: { materialId: 'paint-white', color: '#9aa88f' } }, floor: { materialId: 'tile-60-grey', layout: { size: [0.6, 1.2], grout: 0.003, rotation: 90 } }, ceiling: null } }];
    const bm: CameraBookmark = { id: 'cam-1', name: 'Living room', position: [1, 2, 3], target: [4, 5, 1], fov: 50, roomId: 'R1', view: '3d' };
    const doc = { ...d, variants: [{ ...d.variants[0], interiors: { [ROOM]: ri } }], bookmarks: [bm] };
    expect(docErrors(doc)).toEqual([]);
    const back = parseDoc(serializeDoc(doc));
    expect(back).toEqual(doc);
  });
  it('validation: unknown furniture / material / position rejected', () => {
    const d = defaultDoc();
    const bad = (furniture: unknown[], finishes = { walls: {}, floor: null, ceiling: null }) =>
      ({ ...d, variants: [{ ...d.variants[0], interiors: { [ROOM]: { activeArrangementId: 'a', arrangements: [{ id: 'a', name: 'A', furniture, finishes }] } } }] });
    expect(docErrors(bad([{ id: 'x', catalogId: 'piano', x: 0, y: 0, rot: 0 }])).join()).toMatch(/unknown furniture piano/);
    expect(docErrors(bad([{ id: 'x', catalogId: 'desk', x: 'a', y: 0, rot: 0 }])).join()).toMatch(/numbers/);
    expect(docErrors(bad([], { walls: { w: { materialId: 'gold' } }, floor: null, ceiling: null } as never)).join()).toMatch(/unknown material gold/);
    expect(docErrors({ ...d, importedAssets: [{ id: 1 }] }).join()).toMatch(/model 1/);
  });
});

describe('materials: assigned to one wall / all walls, floor, ceiling', () => {
  const room = roomById(ROOM)!;
  const a0 = activeArrangement(defaultInterior(ROOM));
  it('one wall and all walls of the room', () => {
    const one = setFinish(a0, { kind: 'wall', wallId: room.walls[2].id }, { materialId: 'paint-white', color: '#3e5a4e' });
    expect(Object.keys(one.finishes.walls)).toEqual([room.walls[2].id]);
    const all = setFinish(one, { kind: 'walls', wallIds: room.walls.map((w) => w.id) }, { materialId: 'paint-greige' });
    expect(Object.keys(all.finishes.walls).sort()).toEqual(room.walls.map((w) => w.id).sort());
    expect(Object.values(all.finishes.walls).every((f) => f.materialId === 'paint-greige' && !f.color)).toBe(true);
    // deep copy — changing one wall does not change the others
    all.finishes.walls[room.walls[0].id].materialId = 'x';
    expect(all.finishes.walls[room.walls[1].id].materialId).toBe('paint-greige');
  });
  it('back to the project finish (null); no change = the same reference', () => {
    const f = setFinish(a0, { kind: 'floor' }, { materialId: 'vinyl-oak-natural' });
    expect(setFinish(f, { kind: 'floor' }, { materialId: 'vinyl-oak-natural' })).toBe(f);
    expect(setFinish(f, { kind: 'floor' }, null).finishes.floor).toBeNull();
    const w = setFinish(a0, { kind: 'wall', wallId: room.walls[0].id }, { materialId: 'paint-white' });
    expect(setFinish(w, { kind: 'wall', wallId: room.walls[0].id }, null).finishes.walls).toEqual({});
  });
});

describe('point membership in a room', () => {
  const check = () => {
    for (const r of allRooms()) {
      let p: [number, number] | null = null;
      for (let x = r.bbox[0] + 0.05; x < r.bbox[2] && !p; x += 0.1) for (let y = r.bbox[1] + 0.05; y < r.bbox[3] && !p; y += 0.1) if (pointInPolygon([x, y], r.polygon, -1)) p = [x, y];
      expect(p, r.id).not.toBeNull();
      expect(roomAt(r.level, p!)?.id, r.id).toBe(r.id);
    }
    for (const l of allLevels()) expect(roomAt(l.id, [-5, -5])).toBeNull();
  };
  it('a point inside every room → that room; outside the building → none (demo apartment, sample house)', () => {
    check();
    expect(roomAt('L0', [3, 2])).toBeNull();          // a level the project does not have
    withProject(sampleHouse(), check);
  });
  it('rooms do not overlap (outline centres belong to one room)', () => {
    const run = () => {
      for (const r of allRooms()) {
        const owners = allRooms().filter((q) => q.level === r.level && pointInPolygon(r.center, q.polygon, -1));
        if (pointInPolygon(r.center, r.polygon, -1)) expect(owners.map((q) => q.id), r.id).toEqual([r.id]);
      }
    };
    run(); withProject(sampleHouse(), run);
  });
});

describe('room arrangements: save, copy, rename, delete, load', () => {
  it('acceptance scenario: "Bedroom A" → copy "Bedroom B"', () => {
    let ri = defaultInterior(ROOM);
    ri = { ...ri, arrangements: [addFurniture(ri.arrangements[0], desk('f1'))] };
    ri = saveArrangement(ri, 'Bedroom A');
    expect(activeArrangement(ri)).toMatchObject({ name: 'Bedroom A', saved: true });
    const original = activeArrangement(ri).furniture.map((f) => f.id);
    ri = duplicateArrangement(ri, 'Bedroom B');
    expect(ri.arrangements.map((a) => a.name)).toEqual(['Bedroom A', 'Bedroom B']);
    expect(activeArrangement(ri).name).toBe('Bedroom B');
    // new furniture ids in the copy, the same items
    expect(activeArrangement(ri).furniture.map((f) => f.catalogId)).toEqual(ri.arrangements[0].furniture.map((f) => f.catalogId));
    expect(activeArrangement(ri).furniture.some((f) => original.includes(f.id))).toBe(false);
    expect(duplicateArrangement(ri, 'Bedroom B').arrangements.map((a) => a.name)).toContain('Bedroom B (2)');
    const a = ri.arrangements[0].id;
    ri = loadArrangement(ri, a);
    expect(activeArrangement(ri).name).toBe('Bedroom A');
    ri = renameArrangement(ri, a, 'Bedroom A1');
    expect(ri.arrangements[0].name).toBe('Bedroom A1');
    ri = deleteArrangement(ri, a);
    expect(ri.arrangements.map((x) => x.name)).toEqual(['Bedroom B']);
    expect(deleteArrangement(ri, ri.arrangements[0].id)).toBe(ri); // the last arrangement stays
    ri = newEmptyArrangement(ri, 'Empty');
    expect(activeArrangement(ri).furniture).toEqual([]);
  });
});

describe('scene mode and hiding what is in the way', () => {
  let demo: ReturnType<typeof project>;
  beforeAll(() => { demo = project(); activateProject(sampleHouse()); });
  afterAll(() => { activateProject(demo); });
  it('section: none from outside, level and room — above the floor, walk — no section; surroundings only with the module', () => {
    const base = { houseView: 'exterior' as const, level: 'L0' as const, roomId: null, roomView: '3d' as const, environment: true };
    // the sample house has no surroundings module: no surroundings regardless of the device preference
    expect(sceneMode(base)).toMatchObject({ kind: 'exterior', cutZ: null, environment: false });
    const withEnv = { ...project(), manifest: { ...project().manifest, modules: [...project().manifest.modules, 'environment' as const] } };
    withProject(withEnv, () => {
      expect(sceneMode(base)).toMatchObject({ kind: 'exterior', cutZ: null, environment: true });
      expect(sceneMode({ ...base, roomId: 'BR1', roomView: 'walk' })).toMatchObject({ kind: 'room', cutZ: null, environment: true });
      expect(sceneMode({ ...base, houseView: 'interior' })).toMatchObject({ kind: 'level', environment: false });
    });
    expect(sceneMode({ ...base, houseView: 'interior', level: 'L1' })).toMatchObject({ kind: 'level', cutZ: 2.95 + cutHeight('L1'), environment: false });
    expect(sceneMode({ ...base, roomId: 'BR1' })).toMatchObject({ kind: 'room', level: 'L1', cutZ: 2.95 + cutHeight('L1') });
    expect(sceneMode({ ...base, roomId: 'H0', roomView: 'walk' })).toMatchObject({ kind: 'room', level: 'L0', cutZ: null });
    expect(sceneMode({ ...base, roomId: 'H0' })).toMatchObject({ cutZ: cutHeight('L0'), environment: false });
    // the compiled section clears the window heads of the level (2.35 m)
    expect(cutHeight('L0')).toBeGreaterThan(2.35);
    // section height from the level data, below the ceiling of every room of the level (the ceiling is cut away)
    for (const l of allLevels()) {
      expect(cutHeight(l.id)).toBe(l.cutHeight);
      for (const r of roomsOfLevel(l.id)) expect(cutHeight(l.id), r.id).toBeLessThan(r.ceiling.heightAt(...r.center));
    }
  });
  it('wall cutaway: walls between the camera and the room; points above the section and in the cutaway are invisible (raycast)', () => {
    withProject(demo, () => {
      const room = roomById(ROOM)!;
      const [x0, y0] = room.bbox;
      const cam = new THREE.Vector3(x0 - 4, 6, -(y0 - 4)); // from the −X, −Y side of the LCS
      const walls = nearWalls(room, cam);
      expect(walls.length).toBeGreaterThan(0);
      expect(walls.every((w) => w.inward[0] > 0.5 || w.inward[1] > 0.5)).toBe(true); // west / south walls
      const inside = new THREE.Vector3(room.center[0], 1.2, -room.center[1]);
      expect(nearWalls(room, inside)).toEqual([]);
      setCutaway(room, walls);
      const w = walls[0], mid = new THREE.Vector3(w.a[0] + w.dir[0] * w.length / 2 - w.inward[0] * 0.1, 1.5, -(w.a[1] + w.dir[1] * w.length / 2 - w.inward[1] * 0.1));
      expect(visibleAt(mid)).toBe(false);
      expect(visibleAt(new THREE.Vector3(mid.x, 0.03, mid.z))).toBe(true); // the plinth stays
      expect(visibleAt(inside)).toBe(true);
      clipState.cutY = 2.3;
      expect(visibleAt(new THREE.Vector3(inside.x, 2.5, inside.z))).toBe(false);
      clipState.cutY = null;
      setCutaway(null, []);
      expect(visibleAt(mid)).toBe(true);
    });
  });
});

describe('wall collision while dragging: pushed back inside', () => {
  const room = roomById(ROOM)!; // X 2.52 … 8.70 × Y 4.02 … 6.70
  it('a bed pushed into the north wall returns to the wall face (5 mm gap)', () => {
    const k = keepInside(room, { w: 1, d: 2.1 }, { x: 7.5, y: 6.2, rot: 180 });
    expect(k.y).toBeCloseTo(6.7 - 0.005 - 1.05, 6);
    expect(k.x).toBeCloseTo(7.5, 6);
    expect(k.pushed).toHaveLength(1);
  });
  it('an item in a corner — pushed from two walls; an item inside — unchanged', () => {
    const k = keepInside(room, { w: 1.4, d: 0.7 }, { x: 2.6, y: 4.1, rot: 0 }); // centre in the room (clamping the centre to the outline)
    expect(k.x).toBeCloseTo(2.52 + 0.005 + 0.7, 6);
    expect(k.y).toBeCloseTo(4.02 + 0.005 + 0.35, 6);
    expect(keepInside(room, { w: 1.4, d: 0.7 }, { x: 5.6, y: 5.36, rot: 30 })).toMatchObject({ x: 5.6, y: 5.36, pushed: [] });
  });
  it('an item larger than the room — not pushed (a warning instead of a block)', () => {
    expect(keepInside(room, { w: 0.6, d: 3.0 }, { x: 5.6, y: 5.36, rot: 0 })).toMatchObject({ x: 5.6, y: 5.36, pushed: [] });
  });
});

describe('walk: moving between rooms through doors, walls block', () => {
  const go = (level: string, p: [number, number], dx: number, dy: number, steps = 60) => { for (let i = 0; i < steps; i++) p = walkStep(level, p, dx, dy, 1.68); return p; };
  it('bedroom R2 → through door D3 → living room R1', () => {
    const p = go('L1', [3.65, 4.6], 0, -0.05);
    expect(walkRoomAt('L1', p)?.id).toBe('R1');
  });
  it('hallway R4 → through door D1 → living room R1', () => {
    const p = go('L1', [1.8, 1.45], 0.05, 0);
    expect(walkRoomAt('L1', p)?.id).toBe('R1');
  });
  it('walking straight at a wall stops FRONT_STOP before it (usability issue B13), a diagonal move slides along the wall', () => {
    const p = go('L1', [6.0, 5.36], 0.05, 0);
    expect(walkRoomAt('L1', p)?.id).toBe('R2');
    expect(p[0]).toBeLessThanOrEqual(8.7 - FRONT_STOP + 1e-9);
    expect(p[0]).toBeGreaterThan(8.7 - FRONT_STOP - 0.06);
    const q = go('L1', [7.0, 4.6], 0.05, 0.02);
    expect(q[0]).toBeGreaterThan(8.7 - FRONT_STOP - 0.1);
    expect(q[0]).toBeLessThanOrEqual(8.7 - BODY_R + 1e-9);
    expect(q[1]).toBeGreaterThan(5.5); // sliding in +Y after reaching the stop
    // along the wall the body radius still holds: a walk parallel to the wall 30 cm from it goes on
    const r = go('L1', [8.7 - 0.3, 4.6], 0, 0.05, 20);
    expect(r[1]).toBeGreaterThan(5.5);
    expect(r[0]).toBeCloseTo(8.7 - 0.3, 6);
  });
  it('every room of every level is reachable on foot (through doors and passages) — demo apartment and both levels of the sample house', () => {
    const reach = () => {
      for (const level of allLevels().map((l) => l.id)) {
        const rooms = roomsOfLevel(level), edges = new Map<string, Set<string>>();
        for (const r of rooms) for (const d of r.doors) {
          const w = r.walls.find((x) => x.id === d.wallId)!;
          const p = go(level, [d.center[0] + w.inward[0] * 0.45, d.center[1] + w.inward[1] * 0.45], -w.inward[0] * 0.05, -w.inward[1] * 0.05, 40);
          const to = walkRoomAt(level, p)?.id;
          if (to && to !== r.id) { if (!edges.has(r.id)) edges.set(r.id, new Set()); edges.get(r.id)!.add(to); }
        }
        const seen = new Set([rooms[0].id]), queue = [rooms[0].id];
        while (queue.length) for (const n of edges.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
        expect([...seen].sort(), level).toEqual(rooms.map((r) => r.id).sort());
      }
    };
    reach();
    withProject(sampleHouse(), reach);
  });
  it('the exterior door does not lead outside; a sloped ceiling blocks (eyes at 1.68 m)', () => {
    // 3 interior doors × 2 sides; the exterior door D0 has no corridor
    expect(doorCorridors('L1').length).toBe(6);
    expect(doorCorridors('L1').some((c) => c.doorId === 'D0')).toBe(false);
    const out = go('L1', [0.8, 1.8], -0.05, 0, 80); // hallway R4 → towards the exterior door D0 (x 0.00–0.30)
    expect(walkRoomAt('L1', out)?.id).toBe('R4');
    expect(out[0]).toBeGreaterThanOrEqual(0.3 + BODY_R - 1e-9);
    withProject(slopedCeiling(), () => {
      const p = go('L1', [2.3, 2.8], 0, -0.05, 80); // sloped room A1 → towards the knee wall (y = 0.30, ceiling 1.50 m)
      expect(walkRoomAt('L1', p)?.id).toBe('A1');
      expect(roomById('A1')!.ceiling.heightAt(p[0], p[1])).toBeGreaterThanOrEqual(1.68 + 0.1);
      expect(p[1]).toBeGreaterThan(0.3 + BODY_R + 0.05); // stopped by the slope before the wall
    });
  });
});

describe('default furnishing: the project layout, kitchen units, ready-made placements', () => {
  const check = (id: string) => { const r = roomById(id)!, f = defaultFurniture(id), nb = neighbours(f); return { r, f, warn: nb.flatMap((n) => furnitureWarnings(r, n.item, n.placement, n.dims, nb.filter((o) => o.id !== n.id)).map((w) => `${n.id}: ${w.text}`)) }; };
  const data = (room: string) => architectItems().filter((a) => a.room === room);
  it('every room of the demo apartment: the default layout from the package data, without warnings', () => {
    for (const r of allRooms()) {
      const { f, warn } = check(r.id);
      expect(warn, r.id).toEqual([]);
      expect(f.map((x) => x.catalogId).sort(), r.id).toEqual(data(r.id).map((a) => a.catalogId).sort());
      expect(defaultInterior(r.id).arrangements[0].furniture.length, r.id).toBe(f.length);
    }
  });
  it('kitchen room (tag "kitchen"): kitchen units = the "kitchen" group of the layout, insertable with new ids', () => {
    expect(roomsWithTag('kitchen').map((r) => r.id)).toEqual(['R1']);
    const room = roomById('R1')!, kitchen = kitchenBuiltIn(room);
    expect(kitchen.map((x) => x.catalogId).sort()).toEqual(['fridge-freestanding', 'kitchen-cooktop', 'kitchen-sink', 'kitchen-wall']);
    expect(kitchenBuiltIn(room, 'arch-t1').map((x) => x.id)).toEqual(architectFurniture('R1', 'arch', 'kitchen').map((x) => x.id.replace(/^arch-/, 'arch-t1-')));
    // one run along the east wall (x = 8.70): fronts towards the room (rot 90 → front −X)
    expect(kitchen.every((k) => k.rot === 90)).toBe(true);
    for (const k of kitchen) { const d = resolveDims(itemById(k.catalogId)!, k); expect(k.x + d.d / 2, k.id).toBeLessThanOrEqual(8.7 + 1e-6); expect(k.x + d.d / 2, k.id).toBeGreaterThan(8.7 - 0.1); }
    // the rest of the living room: the sofa faces the TV on the opposite wall
    const living = defaultFurniture('R1').filter((x) => !kitchen.some((k) => k.id === x.id));
    const tv = living.find((x) => x.catalogId === 'tv-wall')!, sofa = living.find((x) => x.catalogId === 'sofa')!;
    expect(tv.rot).toBe(180); expect(sofa.rot).toBe(0); expect(Math.abs(sofa.x - tv.x)).toBeLessThan(0.6); expect(tv.y).toBeGreaterThan(sofa.y + 2);
  });
  it('bathroom R3 from the layout (bathtub, toilet, vanity, mirror, washer) — without warnings; real catalog sizes', () => {
    expect(check('R3').f.map((x) => x.catalogId).sort()).toEqual(['bathtub', 'mirror', 'toilet', 'vanity', 'washer']);
    expect(check('R3').warn).toEqual([]);
    const bath = check('R3').f.find((x) => x.catalogId === 'bathtub')!;
    expect(resolveDims(itemById('bathtub')!, bath).w).toBeCloseTo(1.7, 2);
  });
  it('PROJECT DEFAULT ≠ building geometry: ordinary arrangement items with an "arch-…" id, each with a source description', () => {
    for (const a of architectItems()) {
      expect(itemById(a.catalogId), a.key).toBeTruthy();
      expect(a.source.length, a.key).toBeGreaterThan(3); expect(['dimensioned', 'drawn', 'approximate']).toContain(a.basis); expect(a.note.length, a.key).toBeGreaterThan(5);
    }
    const f = defaultFurniture('R3');
    expect(f.every((x) => isArchitectId(x.id))).toBe(true);
    expect(architectItemOf('arch-mxyz-3-R3-wc')?.catalogId).toBe('toilet'); // still recognised after insertion with a new prefix
    expect(architectItemOf('f-abc-1')).toBeNull();
    // editable: delete and move like any item
    let a = defaultInterior('R3').arrangements[0];
    a = removeFurniture(a, 'arch-R3-washer'); a = updateFurniture(a, 'arch-R3-wc', { y: 4.5 });
    expect(a.furniture.map((x) => x.id)).not.toContain('arch-R3-washer');
    expect(a.furniture.find((x) => x.id === 'arch-R3-wc')!.y).toBe(4.5);
    expect(defaultFurniture('R3').find((x) => x.id === 'arch-R3-wc')!.y).toBeCloseTo(4.2, 3); // default data untouched
  });
  it('ready-made placements outside the sources (interiors.extra) are default furniture, not layout items', () => {
    withProject(slopedCeiling(), () => {
      const { f, warn } = check('A2');
      expect(f.map((x) => [x.id, x.catalogId])).toEqual([['x-A2-desk', 'desk']]);
      expect(warn).toEqual([]);
      expect(isArchitectId(f[0].id)).toBe(false);
      expect(architectItemOf(f[0].id)).toBeNull();
    });
  });
  it('rooms without furnishing in the data — no default furniture', () => {
    withProject(sampleHouse(), () => {
      expect(defaultFurniture('H1')).toEqual([]);
      expect(defaultInterior('H1').arrangements[0].furniture).toEqual([]);
    });
    withProject(slopedCeiling(), () => expect(defaultFurniture('A1')).toEqual([]));
  });
});

describe('transforms: LCS ↔ three.js (furniture rotation, front)', () => {
  it('rot (° CCW in LCS) → rotation.y in three.js: the local front (−Z) points to (−sin r, cos r)', () => {
    for (const rot of [0, 15, 90, 135, 180, 270, 333]) {
      const g = new THREE.Object3D();
      g.rotation.y = (rot * Math.PI) / 180;
      g.updateMatrixWorld();
      const f = new THREE.Vector3(0, 0, -1).applyMatrix4(g.matrixWorld); // furniture front in three.js
      const r = (rot * Math.PI) / 180;
      expect(f.x).toBeCloseTo(-Math.sin(r), 9);
      expect(-f.z).toBeCloseTo(Math.cos(r), 9);
    }
  });
  it('rotFacing(n): the front faces direction n', () => {
    for (const n of [[1, 0], [0, 1], [-1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2]] as [number, number][]) {
      const r = (rotFacing(n) * Math.PI) / 180;
      expect(-Math.sin(r)).toBeCloseTo(n[0], 9);
      expect(Math.cos(r)).toBeCloseTo(n[1], 9);
    }
  });
});

describe('GLB import: analysis and normalisation (scale, pivot, footprint, warnings)', () => {
  // a model "in centimetres": a 100 × 50 × 200 unit box offset from the file origin
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 50, 200), new THREE.MeshStandardMaterial());
  mesh.position.set(30, 25 + 7, -12);
  scene.add(mesh);
  const a = analyze(scene);
  it('unit detection (cm), triangles', () => {
    expect(a.unit.unit).toBe('cm');
    expect(a.unit.scale).toBe(0.01);
    expect(a.triangles).toBe(12);
  });
  it('normalisation: dimensions in metres, pivot = footprint centre and bottom, rotating the front swaps width and depth', () => {
    const n = normalize(a, 0.01, 180);
    expect(n.dims).toEqual({ w: 1, d: 2, h: 0.5 });
    expect(n.offset).toEqual([30, 7, -12]);
    const r = normalize(a, 0.01, 90);
    expect(r.dims.w).toBeCloseTo(2, 6);
    expect(r.dims.d).toBeCloseTo(1, 6);
    expect(n.footprint.length).toBe(4);
  });
  it('convex hull and warnings about heavy / unusual models', () => {
    expect(convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]])).toHaveLength(4);
    expect(warningsFor({ ...a, triangles: 600_000 }, { w: 1, d: 1, h: 1 }, 1000)).toEqual([t('three.glbVeryHeavy', { tris: fmtNum(600_000, 0), max: fmtNum(TRI_WARN, 0) })]);
    expect(warningsFor({ ...a, triangles: 200_000 }, { w: 1, d: 1, h: 1 }, 1000)).toEqual([t('three.glbHeavy', { tris: fmtNum(200_000, 0), max: fmtNum(TRI_WARN, 0) })]);
    expect(warningsFor(a, { w: 12, d: 1, h: 1 }, 1000)).toEqual([t('three.glbTooLarge', { size: fmtM(12) })]);
    expect(warningsFor(a, { w: 1, d: 0.6, h: 0.75 }, 1000)).toEqual([]);
  });
  it('catalog item from an imported model (project registry)', () => {
    const asset: ImportedAsset = { id: 'm1', name: 'Armchair X', file: 'm1.glb', bytes: 1000, triangles: 12, dims: { w: 0.8, d: 0.9, h: 1 }, scale: 0.01, offset: [0, 0, 0], footprint: [], rotation: 180, category: 'living', warnings: [], createdAt: '2026-01-01' };
    setImportedAssets([asset]);
    const it = itemById('imported:m1')!;
    expect(it).toMatchObject({ name: 'Armchair X', provider: 'imported', runtimeModel: { type: 'glb', url: '/user-assets/furniture/imported/m1.glb', rotation: 180 } });
    expect(resolveDims(it, null)).toEqual({ w: 0.8, d: 0.9, h: 1 });
    setImportedAssets([]);
    expect(itemById('imported:m1')).toBeNull();
  });
});

describe('import endpoint: safe names and file signatures', () => {
  it('names', () => {
    expect(safeName('model', 'm-abc.glb')).toBe('m-abc.glb');
    expect(safeName('model', '../etc/passwd.glb')).toBeNull();
    expect(safeName('model', 'a/b.glb')).toBeNull();
    expect(safeName('model', 'x.png')).toBeNull();
    expect(safeName('thumb', 'x.png')).toBe('x.png');
    expect(safeName('thumb', 'x.glb')).toBeNull();
  });
  it('GLB / PNG / glTF signatures', () => {
    const glb = Buffer.alloc(32); glb.write('glTF', 0, 'ascii');
    expect(validSignature('a.glb', glb)).toBe(true);
    expect(validSignature('a.glb', Buffer.from('not a model at all, sorry'))).toBe(false);
    expect(validSignature('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe(true);
    expect(validSignature('a.gltf', Buffer.from('{"asset":{"version":"2.0"}}'))).toBe(true);
  });
});

describe('furniture thumbnails (SVG from the generator parts)', () => {
  it('every catalog item has a thumbnail; the cache returns the same result', () => {
    for (const it of BUILTIN_ITEMS) {
      const t = furnitureThumbnail(it);
      expect(t.startsWith('data:image/svg+xml'), it.id).toBe(true);
      expect(decodeURIComponent(t)).toMatch(/<polygon/);
      expect(furnitureThumbnail(it)).toBe(t);
    }
    const bed = BUILTIN_ITEMS.find((i) => i.id === 'bed')!;
    expect(furnitureThumbnail(bed, '90')).not.toBe(furnitureThumbnail(bed, '180'));
  });
});

describe('furniture: 1:1 objects — dimensions and variants', () => {
  it('rug: variant sizes; bed: mattress + frame', () => {
    const rug = BUILTIN_ITEMS.find((i) => i.id === 'rug')!;
    expect(resolveDims(rug, { variant: '160x230', dims: null })).toMatchObject({ w: 1.6, d: 2.3 });
    expect(resolveDims(rug, { variant: '200x300', dims: null })).toMatchObject({ w: 2, d: 3 });
    const bed = BUILTIN_ITEMS.find((i) => i.id === 'bed')!;
    expect(resolveDims(bed, { variant: '160', dims: null }).w).toBeCloseTo(1.7, 6);
  });
});
