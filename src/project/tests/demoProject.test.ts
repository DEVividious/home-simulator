// ZERO CORE CHANGES: the synthetic apartment (package demo-apartment) goes through the same engine code as the sample house —
// no branches on the project id. Expected values computed by hand from the plan described in the package (9.00 × 7.00 m).
import path from 'node:path';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultDoc, docErrors, parseDoc, type ConfiguratorDoc, type Variant } from '../../document/model';
import { initHistory } from '../../history/history';
import { applyVariantView, currentSun, currentView, setVariantStairs } from '../../home/actions';
import { backStep } from '../../home/backNav';
import { itemById } from '../../home/catalog/providers';
import { defaultFurniture } from '../../home/model/defaults';
import { allDoors, interactiveDoors } from '../../home/model/doors';
import { elRooms, hasSite, resolvePlan } from '../../home/model/electrical';
import { surfaceOfWall, surfacesOfLevel } from '../../home/model/mount';
import { mountedAt } from '../../home/model/mountedFurniture';
import { allLevels, allRooms, roomAt, roomById, roomsWithTag } from '../../home/model/rooms';
import { hasGeneratedShell, levelShell, orthogonalPlan, shellBounds } from '../../home/model/shell';
import { hasStairs } from '../../home/model/stairs';
import type { Vec3 } from '../../home/model/types';
import { viewpoints } from '../../home/model/viewpoints';
import { exteriorViews, homeViewId, INTERIOR_VIEW_ID, viewPresets } from '../../home/model/views';
import { walkAllowed } from '../../home/model/walk';
import { exteriorDoors } from '../../home/model/walkWorld';
import { presetGoal } from '../../home/scene/CameraController';
import { sceneApi } from '../../home/scene/sceneApi';
import { sceneMode } from '../../home/scene/sceneMode';
import { screenshotCaption, screenshotMeta } from '../../home/screenshot';
import { design, variantOf } from '../../home/store/design';
import { ui, type Selection } from '../../home/store/ui';
import { Inspector } from '../../home/ui/Inspector';
import { SectionArrange } from '../../home/ui/SectionArrange';
import { SectionVariants } from '../../home/ui/SectionVariants';
import { hasModule, project, withProject } from '../active';
import { readProjectDir } from '../node';
import type { ProjectPackage } from '../types';
import { validateProject } from '../validate';

const root = path.resolve(__dirname, '..', '..', '..');
const demo = project();                                                     // active in unit tests (src/test/setup.ts)
const house = readProjectDir(path.join(root, 'projects', 'sample-house'));
/** the sample house with a surroundings model as well — a project with every module that has UI state */
const houseWithSurroundings: ProjectPackage = { ...house, manifest: { ...house.manifest, modules: [...house.manifest.modules, 'environment'] }, assets: { ...house.assets, environment: 'model/surroundings.glb' } };
const inHouse = <T,>(fn: () => T): T => withProject(house, fn);

describe('demo-apartment: a package without house modules', () => {
  it('manifest: apartment, one level, no modules', () => {
    expect(demo.manifest.projectId).toBe('demo-apartment');
    expect(demo.manifest.buildingType).toBe('apartment');
    expect(demo.manifest.modules).toEqual([]);
    expect(allLevels().map((l) => l.id)).toEqual(['L1']);
    for (const m of ['site', 'environment', 'sun', 'stairs'] as const) expect(hasModule(m)).toBe(false);
    expect(hasSite()).toBe(false);
    expect(hasStairs()).toBe(false);
    expect(roomsWithTag('garage')).toEqual([]);
  });

  it('rooms: four, areas from the plan dimensions', () => {
    const area = Object.fromEntries(allRooms().map((r) => [r.id, r.area]));
    // R1 6.18 × 3.60; R2 6.18 × 2.68; R3 2.10 × 3.68; R4 2.10 × 2.60
    expect(area).toEqual({ R1: 22.25, R2: 16.56, R3: 7.73, R4: 5.46 });
    expect(roomAt('L1', [6, 2])?.id).toBe('R1');
    expect(roomAt('L1', [1, 5])?.id).toBe('R3');
    expect(roomAt('L1', [2.46, 2])).toBeNull();                       // inside the wall
    expect(roomById('R1')!.kind).toBe('living');
    expect(roomsWithTag('kitchen').map((r) => r.id)).toEqual(['R1']);
  });

  it('walls and openings: doors and windows land on the right walls', () => {
    const r1 = roomById('R1')!;
    expect(r1.walls).toHaveLength(4);
    expect(r1.doors.map((d) => d.id).sort()).toEqual(['D1', 'D3']);
    expect(r1.windows.map((w) => w.id).sort()).toEqual(['W1', 'W2']);
    const w1 = r1.windows.find((w) => w.id === 'W1')!;
    expect(w1.t1 - w1.t0).toBeCloseTo(2.4, 6);
    expect([w1.sill, w1.head]).toEqual([0.85, 2.35]);
    // hallway: three doors (entrance, living room, bathroom)
    expect(roomById('R4')!.doors.map((d) => d.id).sort()).toEqual(['D0', 'D1', 'D2']);
  });

  it('doors: the engine draws and opens all of them (the entrance too)', () => {
    expect(allDoors().map((d) => d.id)).toEqual(['D0', 'D1', 'D2', 'D3']);
    expect(interactiveDoors()).toHaveLength(4);
    // without a site there is no way out onto terrain
    expect(exteriorDoors()).toEqual([]);
  });

  it('walk: inside the rooms yes, inside a wall and outside the apartment no', () => {
    expect(walkAllowed('L1', [6, 2], 1.68)).toBe(true);
    expect(walkAllowed('L1', [2.46, 3.5], 1.68)).toBe(false);
    expect(walkAllowed('L1', [-1, 2], 1.68)).toBe(false);
  });
});

describe('demo-apartment: shell generated from the rooms', () => {
  it('no building model file; the plan is orthogonal', () => {
    expect(hasGeneratedShell()).toBe(true);
    expect(orthogonalPlan()).toBe(true);
  });

  it('outline: 9.00 × 7.00 m, from the underside of the slab to the top of the ceiling', () => {
    const b = shellBounds();
    expect(b.min).toEqual([0, 0, -0.25]);
    expect(b.max[0]).toBeCloseTo(9, 6); expect(b.max[1]).toBeCloseTo(7, 6); expect(b.max[2]).toBeCloseTo(2.85, 6);
  });

  it('wall volume = gross plan − rooms − openings', () => {
    const s = levelShell('L1');
    // volume of a closed solid from its faces: Σ (p · n) · area / 3 (divergence theorem)
    const vol = (quads: typeof s.walls) => quads.reduce((v, q) => {
      const [a, b, , d] = q.p, e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
      return v + (a[0] * q.n[0] + a[1] * q.n[1] + a[2] * q.n[2]) * area / 3;
    }, 0);
    const rooms = 22.248 + 16.5624 + 7.728 + 5.46;                    // room areas (exact products)
    const mass = (9 * 7 - rooms) * 2.6;
    // openings through the wall: doors 2.05 high (D0 1.0 × 0.30; D1 0.9 × 0.12; D2 0.8 × 0.12; D3 0.9 × 0.12), windows in 0.30 walls
    const doors = (1.0 * 0.3 + 0.9 * 0.12 + 0.8 * 0.12 + 0.9 * 0.12) * 2.05;
    const windows = (2.4 * 1.5 + 0.5 * 1.3 + 2.0 * 1.5 + 0.7 * 0.8) * 0.3;
    expect(vol(s.walls)).toBeCloseTo(mass - doors - windows, 4);
    // floor and ceiling slab under / over the whole plan
    expect(vol(s.floor)).toBeCloseTo(9 * 7 * 0.25, 6);
    expect(vol(s.top)).toBeCloseTo(9 * 7 * 0.25, 6);
  });

  it('shell windows: four, in 0.30 exterior walls', () => {
    const w = levelShell('L1').windows;
    expect(w.map((x) => x.id).sort()).toEqual(['W1', 'W2', 'W3', 'W4']);
    for (const x of w) expect(x.depth).toBeCloseTo(0.3, 6);
    const w2 = w.find((x) => x.id === 'W2')!;
    expect(w2.out).toEqual([1, 0]);                                    // east wall — outwards towards +X
    expect([w2.width, w2.z0, w2.z1]).toEqual([expect.closeTo(0.5, 6), 1.05, 2.35]);
  });
});

describe('demo-apartment: furniture, wall mounting, electrical, document', () => {
  it('the TV and mirrors hang on walls (mount records computed from the package data)', () => {
    const r1 = defaultFurniture('R1'), tv = r1.find((f) => f.catalogId === 'tv-wall')!;
    expect(tv.mount).toBeTruthy();
    const s = surfaceOfWall('R1', tv.mount!.wallId)!;
    // north wall of the living room (y = 3.90), facing inwards (−Y)
    expect(s.spaceId).toBe('R1');
    expect(s.normal[1]).toBeCloseTo(-1, 6);
    expect(tv.mount!.height).toBeCloseTo(1.0, 6);
    const m = mountedAt('R1', itemById('tv-wall')!, tv)!;
    // TV centre 6.30 m from the X = 0 axis; its back against the wall
    expect(Math.abs(tv.x - 6.3)).toBeLessThan(1e-6);
    expect(tv.y).toBeCloseTo(3.9 - 0.025 - 0.005, 6);
    expect(m.surface.id).toBe(s.id);
    for (const roomId of ['R2', 'R3', 'R4']) expect(defaultFurniture(roomId).filter((f) => f.catalogId === 'mirror' && f.mount)).toHaveLength(1);
    // wall cabinets and the shelf are wall objects as well
    expect(r1.filter((f) => f.mount).map((f) => f.catalogId).sort()).toEqual(['kitchen-wall', 'tv-wall', 'wall-shelf']);
    // the north wall east of the TV is free up to the corner (scenario: moving it onto the next wall)
    const onNorth = r1.filter((f) => f.mount && surfaceOfWall('R1', f.mount.wallId)!.id === s.id);
    expect(onNorth.map((f) => f.catalogId)).toEqual(['tv-wall']);
  });

  it('mounting surfaces: one per room wall', () => {
    expect(surfacesOfLevel('L1').filter((s) => !s.exterior)).toHaveLength(16);
    expect(elRooms('L1').map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
  });

  it('electrical: every point from the sources lies on a wall', () => {
    const plan = resolvePlan(null);
    expect(plan.points.map((p) => p.id).sort()).toEqual(demo.electrical.points.map((p) => p.id).sort());
    expect(plan.points.find((p) => p.id === 'B1')!.type).toBe('board');
    for (const p of plan.points) expect(p.orientation, p.id).toBe('wall');
  });

  it('document: the default one belongs to the project and is valid; the house document is rejected', () => {
    const doc = defaultDoc();
    expect(doc.projectId).toBe('demo-apartment');
    expect(docErrors(doc)).toEqual([]);
    const houseDoc = inHouse(() => defaultDoc());
    expect(docErrors(houseDoc).join(' ')).toMatch(/sample-house/);
    expect(() => parseDoc(JSON.stringify(houseDoc))).toThrow();
    // and the other way round: the apartment document does not load in the house project
    expect(inHouse(() => docErrors(doc)).join(' ')).toMatch(/demo-apartment/);
  });

  it('views: the engine default set + section; viewpoints from the package', () => {
    expect(exteriorViews().map((v) => v.id)).toEqual(['overview', 'opposite', 'top']);
    expect(viewPresets().at(-1)!.id).toBe(INTERIOR_VIEW_ID);
    expect(homeViewId()).toBe('overview');
    expect(viewpoints().map((v) => v.id)).toEqual(['vp-entry', 'vp-sofa', 'vp-bed']);
  });
});

// A level without rooms used to give a section framing computed from an empty list (min / max = ±∞) — a NaN camera and a dead
// scene. Such a package is rejected at load time, and the section framing always has a finite position.
describe('level without rooms', () => {
  /** the apartment with a second level that has no room */
  const twoLevels: ProjectPackage = {
    ...demo, manifest: { ...demo.manifest, levels: [...demo.manifest.levels, { id: 'L2', name: 'Mezzanine', floorZ: 2.85 }] },
    building: { ...demo.building, rooms: { ...demo.building.rooms, levels: { ...demo.building.rooms.levels, L2: { name: 'Mezzanine', floor_z: 2.85 } } } },
  };
  it('package validation: a level without rooms is an error with a readable message; the shipped packages are valid', () => {
    expect(validateProject(demo)).toEqual([]); expect(validateProject(house)).toEqual([]);
    expect(validateProject(twoLevels)).toEqual(['level "L2": no rooms (every level needs at least one)']);
  });
  it('section framing: a level without rooms (or outside the project) — the building outline at its height, the camera always finite', () => {
    const bounds = { min: [0, 0, -0.25] as Vec3, max: [9, 7, 2.85] as Vec3 };
    const numbers = (g: ReturnType<typeof presetGoal>) => [...g.pos.toArray(), ...g.target.toArray(), g.fov ?? 0];
    withProject(twoLevels, () => {
      const full = presetGoal(INTERIOR_VIEW_ID, bounds, 1.6, 'L1'), empty = presetGoal(INTERIOR_VIEW_ID, bounds, 1.6, 'L2');
      expect(numbers(full).every(Number.isFinite)).toBe(true);
      expect(numbers(empty).every(Number.isFinite), JSON.stringify(numbers(empty))).toBe(true);
      // target: the centre of the building outline (three.js: x, y = Z, z = −Y) on the floor of that level
      expect(empty.target.x).toBeCloseTo(4.5, 6); expect(empty.target.y).toBeCloseTo(2.85, 6); expect(empty.target.z).toBeCloseTo(-3.5, 6);
      expect(empty.pos.distanceTo(empty.target)).toBeGreaterThan(5);
    });
    expect(numbers(presetGoal(INTERIOR_VIEW_ID, bounds, 1.6, 'L0')).every(Number.isFinite)).toBe(true);
  });
});

// The UI and the operations ask about project data — what the project does not have is not offered, shown or saved.
// Panels rendered to text (react-dom/server) on the store state — no browser.
describe('demo-apartment: UI and operations without data the project does not have', () => {
  const html = (c: (props: never) => unknown) => renderToStaticMarkup(createElement(c as FunctionComponent));
  const ui0 = ui.get(), houseDoc = () => inHouse(() => defaultDoc()), demoDoc = () => defaultDoc();
  const start = (doc: ConfiguratorDoc) => design.set({ history: initHistory(doc), draft: null });
  afterEach(() => { ui.set(ui0); start(demoDoc()); });

  it('stairs: house — a button with the rooms in Arrange and a card describing the structure from the stairs data; a finish set is stored in the variant', () => inHouse(() => {
    start(houseDoc());
    ui.set({ section: 'arrange', roomId: null, level: 'L0', selection: null });
    expect(html(SectionArrange)).toContain('data-testid="stairs-open"');
    ui.set({ selection: { kind: 'stairs' } });
    expect(html(Inspector)).toContain('Reinforced concrete structure: 2 flights × 9 steps (16.4 × 27 cm), landing +1.475 — this is building data. Here you choose the finish');
    setVariantStairs({ tread: 'oak', treadThickness: 0.04 }, 'stairs: test');
    expect(design.get().history.past).toHaveLength(1);
    expect(variantOf(design.get()).stairs).toEqual({ tread: 'oak', treadThickness: 0.04 });
  }));
  it('stairs: the apartment without stairs — no button, no card (even with a forced selection), nothing stored in the document', () => {
    start(demoDoc());
    ui.set({ section: 'arrange', roomId: null, level: 'L1', selection: null });
    const side = html(SectionArrange);
    expect(side).toContain('data-testid="room-R1"');                  // the step is there: the apartment's rooms to pick
    expect(side).not.toContain('stairs-open');
    ui.set({ selection: { kind: 'stairs' } });
    expect(html(Inspector)).toBe('');
    setVariantStairs({ tread: 'oak', treadThickness: 0.04 }, 'stairs: test');
    expect(design.get().history.past).toHaveLength(0);
    expect(variantOf(design.get()).stairs).toBeUndefined();
  });

  // a selection of an element the project does not have (state from a URL, a bookmark, another project): the card called
  // module code that threw "the project has no …" — without an error boundary the whole app disappeared. No card is created.
  const FOREIGN: Selection[] = [
    { kind: 'stairs' }, { kind: 'door', id: 'D6' }, { kind: 'electrical', id: 'S6' },
    { kind: 'furniture', roomId: 'LK', id: 'arch-LK-kitchen-base' }, { kind: 'wall', roomId: 'LK', wallId: 'LK-w1' }, { kind: 'floor', roomId: 'LK' }, { kind: 'ceiling', roomId: 'LK' }, { kind: 'room', roomId: 'LK' },
    { kind: 'furniture', roomId: 'R1', id: 'no-such-furniture' },
  ];
  it('selection card: an element or room the apartment does not have — nothing is drawn and nothing throws', () => {
    start(demoDoc());
    const out = FOREIGN.map((selection) => {
      ui.set({ selection });
      try { return [JSON.stringify(selection), html(Inspector)]; } catch (e) { return [JSON.stringify(selection), `EXCEPTION: ${(e as Error).message}`]; }
    });
    expect(out.filter(([, card]) => card !== '')).toEqual([]);
  });
  it('selection card: in the house the same kinds of selection have cards (module gates hide nothing)', () => inHouse(() => {
    start(houseDoc());
    const kind = (selection: Selection) => { ui.set({ selection }); return /data-kind="([^"]+)"/.exec(html(Inspector))?.[1] ?? null; };
    expect(kind({ kind: 'stairs' })).toBe('stairs');
    expect(kind({ kind: 'door', id: 'D6' })).toBe('door');
    // a room and its surfaces have no card: their finishes are in Arrange › Colours (ADR 0040)
    expect(kind({ kind: 'room', roomId: 'LK' })).toBeNull();
    expect(kind({ kind: 'floor', roomId: 'LK' })).toBeNull();
    expect(kind({ kind: 'furniture', roomId: 'LK', id: 'arch-LK-kitchen-base' })).toBe('furniture');
  }));

  // surroundings and the sun are project modules; their UI state is a device preference shared by projects — a project without
  // the module may neither apply nor change it (it would change the other project)
  const exterior = { houseView: 'exterior' as const, roomId: null, roomView: '3d' as const };
  it('surroundings: the apartment scene has none whatever the device preference; a project with the module — per the preference', () => {
    withProject(houseWithSurroundings, () => {
      expect(sceneMode({ ...exterior, level: 'L0', environment: true }).environment).toBe(true);
      expect(sceneMode({ ...exterior, level: 'L0', environment: false }).environment).toBe(false);
    });
    inHouse(() => expect(sceneMode({ ...exterior, level: 'L0', environment: true }).environment).toBe(false));
    expect(sceneMode({ ...exterior, level: 'L1', environment: true }).environment).toBe(false);
    expect(sceneMode({ ...exterior, level: 'L1', environment: true, houseView: 'walk' }).environment).toBe(false);
    expect(sceneMode({ ...exterior, level: 'L1', environment: true, roomId: 'R1', roomView: 'walk' }).environment).toBe(false);
  });
  const SAVED = { view: { position: [1, 2, 3] as Vec3, target: [0, 0, 0] as Vec3, fov: 45, environment: false }, sun: { date: '2026-06-21', minutes: 1080 } };
  const NOW = { environment: true, sun: { date: '2026-10-04', minutes: 840 } };
  it('choosing a variant: its sun and surroundings apply only in a project with those modules; the variant camera — always', () => {
    withProject(houseWithSurroundings, () => {
      ui.set({ ...exterior, ...NOW });
      applyVariantView({ ...houseDoc().variants[0], ...SAVED } as Variant);
      expect(ui.get().environment).toBe(false); expect(ui.get().sun).toEqual(SAVED.sun); expect(ui.get().camera.pose?.position).toEqual([1, 2, 3]);
    });
    inHouse(() => {
      ui.set({ ...exterior, ...NOW });
      applyVariantView({ ...houseDoc().variants[0], ...SAVED } as Variant);
      expect(ui.get().environment).toBe(true);                        // no surroundings module: the preference is untouched
      expect(ui.get().sun).toEqual(SAVED.sun);
    });
    ui.set({ ...exterior, ...NOW, camera: { preset: 'overview', n: 0 } });
    applyVariantView({ ...demoDoc().variants[0], ...SAVED } as Variant);
    expect(ui.get().environment).toBe(true);                          // device preference (set in the other project) unchanged
    expect(ui.get().sun).toEqual(NOW.sun);
    expect(ui.get().camera.pose?.position).toEqual([1, 2, 3]);
  });
  it('saving a variant: the apartment view does not store the surroundings preference, an apartment variant has no time of day', () => {
    sceneApi.camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 100);
    try {
      ui.set(NOW);
      withProject(houseWithSurroundings, () => { expect(currentView()?.environment).toBe(true); expect(currentSun()).toEqual(NOW.sun); });
      inHouse(() => { expect(currentView()?.environment).toBe(false); expect(currentSun()).toEqual(NOW.sun); });
      expect(currentView()?.environment).toBe(false); expect(currentSun()).toBeNull();
    } finally { sceneApi.camera = null; }
  });
  it('Versions step: cards, "New version" and "Compare" — no Save button (autosave, ADR 0041); the apartment does not mention the time of day', () => {
    inHouse(() => {
      start(houseDoc());
      const h = html(SectionVariants);
      expect(h).toContain('data-testid="variant-new"');
      expect(h).toContain(`data-testid="variant-${houseDoc().variants[0].name}"`);
      expect(h).not.toMatch(/variant-save|variant-saveas|project-save/);
      expect(h).not.toContain('versions-compare');                    // one version — nothing to compare
    });
    // a version saved elsewhere may have a time of day — in a project without the sun it is not shown
    const d0 = demoDoc();
    start({ ...d0, variants: [{ ...d0.variants[0], ...SAVED } as Variant, { ...d0.variants[0], id: 'v2', name: 'Version 2' } as Variant] });
    const d = html(SectionVariants);
    expect(d).toContain('data-testid="versions-compare"');
    expect(d).not.toMatch(/time of day|sun|surroundings|21\.06|06-21/i);
  });
  it('system Back on a phone: an open menu closes first, then the room is left; nothing open — Back leaves the app', () => {
    const closed = { settingsOpen: false, onboardingDone: true, sheet: 'collapsed' as const, selection: null, compare: null, roomView: '3d' as const, section: 'look' as const, menu: null };
    ui.set({ ...closed, ...exterior });
    expect(backStep(true)).toBe(false);
    ui.set({ roomId: 'R1', level: 'L1', houseView: 'interior', menu: 'download' });
    expect(backStep()).toBe(true); expect(ui.get().menu).toBeNull();
    expect(backStep()).toBe(true); expect(ui.get().roomId).toBeNull();  // the next step leaves the room
  });
  it('screenshot: caption and metadata without the sun and surroundings in a project without these modules', () => {
    withProject(houseWithSurroundings, () => {
      start(houseDoc());
      ui.set({ ...exterior, environment: true, sun: { date: '2026-06-21', minutes: 720 } });
      const h = screenshotMeta();
      expect(h.project).toBe('Sample house (synthetic data)');
      expect(h.sun).toMatchObject({ date: '2026-06-21', time: '12:00' }); expect(h.view.environment).toBe(true);
      expect(screenshotCaption(h)).toMatch(/^Sun 2026-06-21 12:00 .*view: exterior.*surroundings yes/i);
    });
    start(demoDoc());
    ui.set({ ...exterior, environment: true, sun: { date: '2026-06-21', minutes: 720 } });
    const d = screenshotMeta();
    expect(d.project).toBe('Demo apartment (synthetic data)');
    expect(d.sun).toBeNull(); expect(d.view.environment).toBeNull();
    expect(screenshotCaption(d)).not.toMatch(/sun|surroundings/i);
    expect(screenshotCaption(d)).toMatch(/view: exterior/i);
  });
});
