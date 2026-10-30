import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateProject, project, withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { fixtureDir } from '../../test/setup';
import { BUILTIN_ITEMS, clampDim, displayName, resolveDims, sizeLabel } from '../catalog/furniture';
import { generateParts, partBounds } from '../catalog/generators';
import { MATERIALS, materialById, physicalSize, repeatPerMeter, textureExtent } from '../catalog/materials';
import { itemById } from '../catalog/providers';
import { furnitureWarnings, obbOf } from '../model/collision';
import { obbCorners, obbOverlap, pointInPolygon, signedArea } from '@home-sim/core/model/geom2d';
import { arrangeScenario, findFreeSpot } from '../model/placement';
import { allLevels, allRooms, levelAtZ, roomAt, roomById, type HomeRoom } from '../model/rooms';
import { DEFAULT_SNAP, rotFacing, snapPlacement, snapRotation } from '../model/snapping';
import type { FurniturePlacement } from '../model/types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const sampleHouse = () => readProjectDir(path.join(ROOT, 'projects', 'sample-house'));
const slopedCeiling = () => readProjectDir(fixtureDir('sloped-ceiling'));
const room = (id: string) => roomById(id)!;
const item = (id: string) => itemById(id)!;
const P = (catalogId: string, x: number, y: number, rot = 0, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({ id: `t-${catalogId}-${x}-${y}`, catalogId, x, y, rot, ...extra });
const neighbour = (p: FurniturePlacement) => ({ id: p.id, name: item(p.catalogId).name, item: item(p.catalogId), placement: p, dims: resolveDims(item(p.catalogId), p) });

describe('rooms (from the project package, every level)', () => {
  it('demo apartment: 4 rooms on one level; ids from the package data', () => {
    expect(allLevels().map((l) => l.id)).toEqual(['L1']);
    expect(allRooms().map((r) => r.id).sort()).toEqual(['R1', 'R2', 'R3', 'R4']);
  });
  it('sample house: 8 rooms — 3 on the ground floor, 5 on the first floor; levels ordered by floor height', () => {
    withProject(sampleHouse(), () => {
      expect(allLevels().map((l) => [l.id, l.floorZ])).toEqual([['L0', 0], ['L1', 2.95]]);
      expect(allRooms().filter((r) => r.level === 'L0').map((r) => r.id).sort()).toEqual(['B0', 'H0', 'LK']);
      expect(allRooms().filter((r) => r.level === 'L1').map((r) => r.id).sort()).toEqual(['B1', 'BR1', 'BR2', 'H1', 'O1']);
      expect(room('H1').floorZ).toBe(2.95);
      expect(room('H1').stairOpening).toEqual([0.3, 0.3, 2.25, 3.46]);
    });
  });
  it('living room R1: rectangle 6.18 × 3.60 m, doors D1 / D3, windows W1 / W2; outline counter-clockwise', () => {
    const g = room('R1');
    expect(g.rectangular).toBe(true);
    expect(g.area).toBeCloseTo(6.18 * 3.6, 2);
    expect(signedArea(g.polygon)).toBeCloseTo(6.18 * 3.6, 6);
    expect(g.doors.map((d) => d.id).sort()).toEqual(['D1', 'D3']);
    expect(g.windows.map((w) => w.id).sort()).toEqual(['W1', 'W2']);
    const wall = g.walls.find((w) => w.holes.some((h) => h.id === 'W1'))!;
    const h = wall.holes.find((x) => x.id === 'W1')!;
    expect(h.t1 - h.t0).toBeCloseTo(7.5 - 5.1, 3); // window 2.40 wide, sill 0.85, head 2.35
    expect([h.z0, h.z1]).toEqual([0.85, 2.35]);
    expect(wall.a[1]).toBeCloseTo(0.3, 6); expect(wall.inward[0]).toBeCloseTo(0, 9); expect(wall.inward[1]).toBeCloseTo(1, 9); // wall y = 0.30, room towards +Y
    for (const w of g.walls) expect(pointInPolygon([(w.a[0] + w.b[0]) / 2 + w.inward[0] * 0.1, (w.a[1] + w.b[1]) / 2 + w.inward[1] * 0.1], g.polygon)).toBe(true);
  });
  it('point membership: room centre → that room; level from height', () => {
    for (const r of allRooms()) expect(roomAt(r.level, r.center)?.id).toBe(r.id);
    expect(levelAtZ(3.2)).toBe('L1');                   // a single level — every height belongs to it
    expect(roomAt('L1', [-5, -5])).toBeNull();
    withProject(sampleHouse(), () => {
      for (const r of allRooms()) expect(roomAt(r.level, r.center)?.id).toBe(r.id);
      expect(levelAtZ(0.01)).toBe('L0');
      expect(levelAtZ(1.4)).toBe('L0');                 // below the midpoint between the floors (1.475)
      expect(levelAtZ(1.6)).toBe('L1');
      expect(levelAtZ(3.2)).toBe('L1');
      expect(roomAt('L0', [2, 2])?.id).toBe('H0');
      expect(roomAt('L1', [2, 2])?.id).toBe('H1');      // the same plan point on the upper level
    });
  });
  it('sloped ceiling: height = min(flat top, slope); 1.50 m at the knee wall, 2.60 m under the flat part; polygonal glazing as a wall hole', () => {
    withProject(slopedCeiling(), () => {
      const r = room('A1');
      expect(r.ceiling.kind).toBe('roof');                 // an attic ceiling of an old package: under the roof derived from it
      // ridge at y = 2.80, z 4.00, slope 1:1, flat top 2.60 → flat for |y − 2.80| ≤ 1.40
      expect(r.ceiling.heightAt(2, 2.8)).toBeCloseTo(2.6, 6);
      expect(r.ceiling.heightAt(2, 1.4)).toBeCloseTo(2.6, 6);
      expect(r.ceiling.heightAt(2, 0.3)).toBeCloseTo(1.5, 6);
      expect(r.ceiling.heightAt(2, 5.3)).toBeCloseTo(1.5, 6);
      expect(r.ceiling.heightAt(2, 1.0)).toBeCloseTo(2.2, 6);
      expect(r.walls.some((w) => w.holes.some((h) => h.id === 'G1' && h.polygon && h.kind === 'glazing'))).toBe(true);
    });
  });
});

describe('furniture catalog: 1:1 dimensions, variants, parameters', () => {
  it('every item: id, name, category, dimensions > 0, source, licence, default material', () => {
    for (const i of BUILTIN_ITEMS) {
      expect(i.dimensions.w * i.dimensions.d * i.dimensions.h).toBeGreaterThan(0);
      expect(i.source.length).toBeGreaterThan(3); expect(i.license.length).toBeGreaterThan(3);
      expect(materialById(i.defaultMaterial)).not.toBeNull();
      for (const m of Object.values(i.materialSlots)) expect(materialById(m)).not.toBeNull();
    }
  });
  it('beds 90 / 120 / 140 / 160 / 180 × 200: frame +10 cm, mattress inside the outline', () => {
    const bed = item('bed');
    for (const [v, w] of [['90', 1.0], ['120', 1.3], ['140', 1.5], ['160', 1.7], ['180', 1.9]] as [string, number][]) {
      const d = resolveDims(bed, { variant: v });
      expect(d.w).toBeCloseTo(w, 6); expect(d.d).toBeCloseTo(2.1, 6);
    }
    expect(displayName(bed, { variant: '140' })).toBe(`${bed.name} 140 × 200`);
  });
  it('parametric dimensions: clamped to the range and step; non-parametric dimensions unchanged', () => {
    const desk = item('desk');
    expect(resolveDims(desk, { dims: { w: 1.63 } }).w).toBeCloseTo(1.65, 6);
    expect(resolveDims(desk, { dims: { w: 5 } }).w).toBeCloseTo(2.2, 6);
    expect(resolveDims(item('office-chair'), { dims: { w: 2 } }).w).toBeCloseTo(0.64, 6);
    expect(clampDim(desk, 'h', 0.5)).toBeCloseTo(0.7, 6);
    expect(sizeLabel(resolveDims(desk))).toBe('140 × 70 × 75 cm');
  });
  it('parts of every generator fit in the w × d × h outline (dimensionally correct furniture)', () => {
    for (const i of BUILTIN_ITEMS) for (const v of [undefined, ...(i.variants ?? []).map((x) => x.id)]) {
      const d = resolveDims(i, { variant: v ?? null });
      const parts = generateParts(i.runtimeModel.generator!, d, { ...(i.runtimeModel.options ?? {}), ...((i.variants ?? []).find((x) => x.id === v)?.options ?? {}) });
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        const b = partBounds(p);
        expect(b[0]).toBeGreaterThanOrEqual(-d.w / 2 - 1e-6); expect(b[3]).toBeLessThanOrEqual(d.w / 2 + 1e-6);
        expect(b[1]).toBeGreaterThanOrEqual(-d.d / 2 - 1e-6); expect(b[4]).toBeLessThanOrEqual(d.d / 2 + 1e-6);
        expect(b[2]).toBeGreaterThanOrEqual(-1e-6); expect(b[5]).toBeLessThanOrEqual(d.h + 1e-6);
      }
      // the item reaches its full dimensions (no "empty" outline)
      const all = parts.map(partBounds);
      expect(Math.max(...all.map((b) => b[5]))).toBeCloseTo(d.h, 2);
    }
  });
});

describe('materials: real scale', () => {
  it('60 × 60 tile: module 0.60 m, texture = 4 modules, repeat 1 / 2.4 per metre', () => {
    const m = materialById('tile-60-grey')!;
    expect(physicalSize(m)).toEqual([0.6, 0.6]);
    expect(textureExtent(m)).toEqual([2.4, 2.4]);
    expect(repeatPerMeter(m)[0]).toBeCloseTo(1 / 2.4, 9);
    expect(physicalSize(m, { size: [0.3, 0.3] })).toEqual([0.3, 0.3]);
  });
  it('planks: repeat = [board length, width × pattern rows] — consistent with physicalSize in the catalog', () => {
    for (const m of MATERIALS.filter((x) => x.textureSet.type === 'planks')) {
      const [w, h] = physicalSize(m);
      expect(w).toBeCloseTo(m.physicalSize[0], 6); expect(h).toBeCloseTo(m.physicalSize[1], 6);
    }
    const v = materialById('vinyl-oak-natural')!;
    expect(physicalSize(v, { boardWidth: 0.2, pattern: 'half' })).toEqual([1.22, 0.4]);
  });
  it('the required categories are in the catalog', () => {
    const cats = new Set(MATERIALS.map((m) => m.category));
    for (const c of ['wall-paint', 'wallpaper', 'wall-tile', 'floor-tile', 'vinyl', 'laminate', 'wood', 'stone', 'decorative-slats', 'fabric', 'rug']) expect(cats.has(c)).toBe(true);
  });
});

describe('snapping', () => {
  const g = room('R2'); // X 2.52–8.70, Y 4.02–6.70; window W3 on the wall y = 6.70 at x 4.60–6.60
  const desk = item('desk'), dd = resolveDims(desk);
  it('to a wall: desk 10 cm from the wall y = 6.70 → back to the wall, touching (5 mm gap)', () => {
    const r = snapPlacement(g, { w: dd.w, d: dd.d, placement: 'wall' }, { x: 7.4, y: 6.7 - 0.35 - 0.1, rot: 175 }, []);
    expect(r.rot).toBeCloseTo(180, 6);
    expect(r.y + dd.d / 2).toBeCloseTo(6.7 - DEFAULT_SNAP.gap, 4);
    expect(r.walls.length).toBe(1);
  });
  it('corner: two perpendicular walls at once', () => {
    const r = snapPlacement(g, { w: dd.w, d: dd.d, placement: 'wall' }, { x: 2.52 + 0.7 + 0.08, y: 6.7 - 0.35 - 0.06, rot: 180 }, []);
    expect(r.walls.length).toBe(2);
    expect(r.x - dd.w / 2).toBeCloseTo(2.52 + DEFAULT_SNAP.gap, 4);
    expect(r.y + dd.d / 2).toBeCloseTo(6.7 - DEFAULT_SNAP.gap, 4);
  });
  it('ALT (disabled) — unchanged; out of range — unchanged', () => {
    const p = { x: 7.4, y: 6.27, rot: 180 };
    expect(snapPlacement(g, { w: 1.4, d: 0.7, placement: 'wall' }, p, [], { ...DEFAULT_SNAP, enabled: false })).toMatchObject(p);
    expect(snapPlacement(g, { w: 1.4, d: 0.7, placement: 'wall' }, { x: 5.6, y: 5.36, rot: 0 }, []).walls).toEqual([]);
  });
  it('alignment with another item and the grid', () => {
    const other = { id: 'o', obb: obbOf({ x: 5.5, y: 4.9, rot: 0 }, { w: 0.6, d: 0.6 }) };
    const r = snapPlacement(g, { w: 0.6, d: 0.6, placement: 'free' }, { x: 5.53, y: 5.8, rot: 0 }, [other]);
    expect(r.x).toBeCloseTo(5.5, 6); expect(r.aligned).toEqual(['o']);
    const s = snapPlacement(g, { w: 0.6, d: 0.6, placement: 'free' }, { x: 5.93, y: 5.47, rot: 0 }, [], { ...DEFAULT_SNAP, grid: 0.1 });
    expect(s.x).toBeCloseTo(5.9, 6); expect(s.y).toBeCloseTo(5.5, 6);
  });
  it('rotation: 15° / 45° / 90° steps; back to a wall with normal n', () => {
    expect(snapRotation(37)).toBe(30); expect(snapRotation(37, 45)).toBe(45); expect(snapRotation(-91, 90)).toBe(270);
    expect(rotFacing([0, 1])).toBe(0); expect(rotFacing([0, -1])).toBe(180); expect(rotFacing([-1, 0])).toBe(90); expect(rotFacing([1, 0])).toBe(270);
  });
});

describe('collisions (warnings)', () => {
  const g = room('R2');
  it('item in a wall, item ↔ item, chair under a desk allowed, rug under furniture allowed', () => {
    const desk = P('desk', 7.4, 6.7 - 0.35, 180), chair = P('office-chair', 7.4, 6.1, 0), bed = P('bed', 7.4, 6.2, 180);
    expect(furnitureWarnings(g, item('desk'), desk, resolveDims(item('desk')), [neighbour(chair)])).toEqual([]);
    const w = furnitureWarnings(g, item('bed'), bed, resolveDims(item('bed'), bed), [neighbour(desk)]);
    expect(w.map((x) => x.kind)).toContain('overlap');
    expect(w.map((x) => x.kind)).toContain('outside');
    expect(furnitureWarnings(g, item('rug'), P('rug', 7.4, 5.6, 0, { variant: '120x170' }), resolveDims(item('rug'), { variant: '120x170' }), [neighbour(desk), neighbour(chair)])).toEqual([]);
  });
  it('door zone and window: a tall wardrobe in front of window W3 / in front of a door → warning', () => {
    const win = g.windows[0], wall = g.walls.find((w) => w.id === win.wallId)!, t = (win.t0 + win.t1) / 2;
    expect(win.id).toBe('W3');
    const c: [number, number] = [wall.a[0] + wall.dir[0] * t + wall.inward[0] * 0.3, wall.a[1] + wall.dir[1] * t + wall.inward[1] * 0.3];
    const wr = P('wardrobe', c[0], c[1], rotFacing(wall.inward));
    const kinds = furnitureWarnings(g, item('wardrobe'), wr, resolveDims(item('wardrobe')), []).map((x) => x.kind);
    expect(kinds.includes('window') || kinds.includes('door')).toBe(true);
    // in front of door D3 (x 3.20–4.10 on the wall y = 4.02, opening into R2)
    const wd = P('wardrobe', 3.65, 4.02 + 0.31, 0);
    expect(furnitureWarnings(g, item('wardrobe'), wd, resolveDims(item('wardrobe')), []).map((x) => x.kind)).toContain('door');
  });
  it('sloped ceiling: a 2.2 m wardrobe at the knee wall → "does not fit under the slope"; under the flat part — no warning', () => {
    withProject(slopedCeiling(), () => {
      const r = room('A1'), wardrobe = item('wardrobe'), dims = resolveDims(wardrobe);
      expect(dims.h).toBeGreaterThan(1.5);
      expect(furnitureWarnings(r, wardrobe, P('wardrobe', 2.6, 0.3 + 0.31, 0), dims, []).map((x) => x.kind)).toContain('slope');
      // flat top 2.60 m spans y 1.40–4.20 — a free-standing wardrobe in the middle of the room fits under it
      expect(furnitureWarnings(r, wardrobe, P('wardrobe', 2.6, 2.8, 0), dims, []).map((x) => x.kind)).not.toContain('slope');
    });
  });
});

describe('placement: free spot and OFFICE / GUEST / HYBRID presets', () => {
  const clean = (g: HomeRoom, placed: FurniturePlacement[]) => {
    for (const p of placed) {
      const others = placed.filter((q) => q.id !== p.id).map(neighbour);
      const w = furnitureWarnings(g, item(p.catalogId), p, resolveDims(item(p.catalogId), p), others).filter((x) => x.level === 'warn');
      expect(w, `${p.catalogId}: ${JSON.stringify(w)}`).toEqual([]);
    }
  };
  it('a new desk goes against a wall, without warnings', () => {
    const g = room('R2'), p = findFreeSpot(g, item('desk'), {}, []);
    expect(furnitureWarnings(g, item('desk'), p, resolveDims(item('desk')), []).filter((w) => w.level === 'warn')).toEqual([]);
  });
  for (const sc of ['office', 'guest', 'hybrid'] as const) {
    it(`bedroom R2: preset ${sc} — main items placed without collisions (room geometry unchanged)`, () => {
      const g = room('R2'), before = JSON.stringify(g.polygon);
      const { placed } = arrangeScenario(g, sc);
      expect(placed.length).toBeGreaterThanOrEqual(3);
      clean(g, placed);
      expect(JSON.stringify(g.polygon)).toBe(before);
    });
  }
  describe('sample house: office O1 (3.00 × 2.58 m) on the upper level', () => {
    let demo: ReturnType<typeof project>;
    beforeAll(() => { demo = project(); activateProject(sampleHouse()); });
    afterAll(() => { activateProject(demo); });
    for (const sc of ['office', 'guest', 'hybrid'] as const) {
      it(`preset ${sc} — main items placed without collisions`, () => {
        const g = room('O1');
        const { placed } = arrangeScenario(g, sc);
        expect(placed.length).toBeGreaterThanOrEqual(3);
        clean(g, placed);
      });
    }
  });
});

describe('2D geometry', () => {
  it('outline rotated by 90° and overlap', () => {
    const o = obbOf({ x: 0, y: 0, rot: 90 }, { w: 2, d: 1 });
    const xs = obbCorners(o).map((p) => p[0]), ys = obbCorners(o).map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9); expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 9);
    expect(obbOverlap(o, obbOf({ x: 0.9, y: 0, rot: 0 }, { w: 1, d: 1 }))).toBe(true);
    expect(obbOverlap(o, obbOf({ x: 1.1, y: 0, rot: 0 }, { w: 1, d: 1 }))).toBe(false);
  });
});
