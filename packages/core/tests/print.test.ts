// The print export (ADR 0030–0033, 0035): every fixture prints on a Creality K1C at the automatic scale and at small scales with
// printability adjustments; every STL is closed when read back and a valid manifold for the kernel; the bytes are deterministic;
// the split, the adjustments, the scale choice, the printer table and the PNG encoder behave as documented.
import { beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { building, type BuildingData } from '@home-sim/core/model/building';
import { adjustForPrint } from '@home-sim/core/print/adjust';
import { printModel, type PrintModel } from '@home-sim/core/print/model';
import { buildParts, splitHeight, stairSolid } from '@home-sim/core/print/parts';
import { printPreview } from '@home-sim/core/print/preview';
import { findPrinters, parseBed } from '@home-sim/core/print/printers';
import { profileOf } from '@home-sim/core/print/profiles';
import { encodePng } from '@home-sim/core/print/raster';
import { fitOnBed, parseScale } from '@home-sim/core/print/scale';
import { checkStl, splitNeedles } from '@home-sim/core/print/stl';
import type { StairDef } from '@home-sim/core/package/types';
import { levelSolid } from '@home-sim/core/solid/levels';
import { liveObjects, scoped } from '@home-sim/core/solid/scope';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { PACKAGES } from './packages';

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

const K1C = parseBed('K1C'), FDM = profileOf('0.4');
const print = (id: string, scale: number | null = null, eaves: 'keep' | 'trim' = 'keep'): PrintModel => printModel(PACKAGES[id](), geo, { bed: K1C, profile: FDM, scale, eaves, name: id });

/** the STL as the kernel's mesh: vertices merged by their bits — the kernel accepts only a closed, consistently oriented mesh */
function kernelStatus(stl: Uint8Array): string {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength), n = dv.getUint32(80, true), ids = new Map<string, number>(), vert: number[] = [], tri = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12, key = `${dv.getUint32(o, true)},${dv.getUint32(o + 4, true)},${dv.getUint32(o + 8, true)}`;
    let id = ids.get(key);
    if (id === undefined) { id = vert.length / 3; ids.set(key, id); vert.push(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)); }
    tri[t * 3 + k] = id;
  }
  const mesh = new geo.Mesh({ numProp: 3, vertProperties: new Float32Array(vert), triVerts: tri });
  const m = new geo.Manifold(mesh), status = m.status();
  m.delete();
  return status;
}

function expectPrintable(m: PrintModel) {
  expect(m.problems).toEqual([]);
  for (const p of m.parts) {
    expect(p.problems, p.id).toEqual([]);
    expect(p.ok).toBe(true);
    expect(p.stl).not.toBeNull();
    const back = checkStl(p.stl!);
    expect(back.problems, p.id).toEqual([]);
    expect(Math.abs(back.volume - p.volumeMm3)).toBeLessThan(1e-3 * p.volumeMm3 + 0.1);
    expect(kernelStatus(p.stl!), p.id).toBe('NoError');
    expect(p.thin, p.id).toEqual([]);
  }
  expect(m.ok).toBe(true);
}

describe('every fixture prints on a K1C', () => {
  for (const id of Object.keys(PACKAGES)) {
    it(`${id}: the automatic scale fits the bed (220 × 220 × 250, 10 mm margin); every part passes its checks; nothing thin`, () => {
      const m = print(id);
      expect(m.n).not.toBeNull();
      expectPrintable(m);
      for (const p of m.parts) {
        const [w, d, h] = p.sizeMm;
        expect(w).toBeLessThanOrEqual(200 + 1e-6); expect(d).toBeLessThanOrEqual(200 + 1e-6); expect(h).toBeLessThanOrEqual(250);
        // the STL lies on the bed: z from 0, inside the bed minus the margin
        const P = p.placed.positions;
        let zmin = Infinity, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (let i = 0; i < P.length; i += 3) { zmin = Math.min(zmin, P[i + 2]); xmin = Math.min(xmin, P[i]); xmax = Math.max(xmax, P[i]); ymin = Math.min(ymin, P[i + 1]); ymax = Math.max(ymax, P[i + 1]); }
        expect(Math.abs(zmin)).toBeLessThan(1e-4);
        expect(xmin).toBeGreaterThanOrEqual(10 - 1e-3); expect(xmax).toBeLessThanOrEqual(210 + 1e-3); expect(ymin).toBeGreaterThanOrEqual(10 - 1e-3); expect(ymax).toBeLessThanOrEqual(210 + 1e-3);
      }
      // the parts stack: one per built level and the roof part
      const b = building(PACKAGES[id]()), built = b.levels.filter((l) => b.roomsByLevel.get(l.id)!.length).map((l) => l.id);
      expect(m.parts.map((p) => p.id)).toEqual([...built, 'roof']);
      expect(liveObjects()).toBe(0);
    });
  }

  for (const n of [200, 300]) for (const id of Object.keys(PACKAGES)) {
    it(`${id} at 1:${n}: the adjusted building still prints (closed, standing, nothing thin)`, () => expectPrintable(print(id, n)));
  }

  it('with --eaves trim every fixture prints and no roof part reaches beyond the walls', () => {
    for (const id of Object.keys(PACKAGES)) {
      const m = print(id, 100, 'trim'), keep = print(id, 100);
      expectPrintable(m);
      const roof = (x: PrintModel) => x.parts.find((p) => p.id === 'roof')!.sizeMm, walls = m.parts[0].sizeMm;
      expect(Math.max(...roof(m).slice(0, 2)), id).toBeLessThanOrEqual(Math.max(...walls.slice(0, 2)) + 1e-3);
      expect(Math.max(...roof(m).slice(0, 2))).toBeLessThanOrEqual(Math.max(...roof(keep).slice(0, 2)) + 1e-3);
    }
  });
});

describe('the sample house', () => {
  it('prints at 1:75 on a K1C in three parts; the roof comes off at the ceiling of the first floor', () => {
    const m = print('sample-house');
    expect(m.n).toBe(75);
    expect(m.auto).toBe(true);
    expect(m.parts.map((p) => p.id)).toEqual(['L0', 'L1', 'roof']);
    expect(m.split).toMatchObject({ level: 'L1', z: 5.55, rule: 'ceiling' });
    // 1:50 was tried first and does not fit (the roof is 212 mm long)
    expect(m.candidates.map((c) => [c.n, c.fits])).toEqual([[50, false], [75, true]]);
    expect(m.notes.map((x) => x.code).sort()).toEqual(['eaves.cut', 'stairs.split']);
    // nothing to adjust at 1:75 — every wall is printable as it is
    expect(m.adjustments).toEqual([]);
    // the wide windows' lintels are long bridges: reported as needing supports, located and named
    const lintels = m.parts[0].overhangs.supports.map((s) => s.what);
    expect(lintels).toContain('lintel of W1');
  });

  it('the same input gives the same bytes', () => {
    const a = print('sample-house'), b = print('sample-house');
    for (let i = 0; i < a.parts.length; i++) expect(Buffer.from(a.parts[i].stl!).equals(Buffer.from(b.parts[i].stl!))).toBe(true);
    const img = (x: PrintModel) => encodePng(printPreview(x, { bed: K1C, margin: 10, title: 'sample-house' }));
    expect(Buffer.from(img(a)).equals(Buffer.from(img(b)))).toBe(true);
  });

  it('at 1:300 the walls, slabs and lintels are thickened in the inputs and every change is reported', () => {
    const m = print('sample-house', 300), codes = m.adjustments.map((a) => a.code);
    expect(codes).toContain('wall.exterior');
    expect(codes).toContain('slab');
    expect(codes.filter((c) => c === 'wall.interior').length).toBe(9);
    expect(codes).toContain('lintel.lowered');
    for (const a of m.adjustments) { expect(a.printedMm).toBeGreaterThanOrEqual(a.code.startsWith('lintel') ? 1 : 0); expect(a.element).toBeTruthy(); }
    const wall = m.adjustments.find((a) => a.element === 'wall H0 | LK')!;
    expect(wall).toMatchObject({ from: 0.12, to: 0.36, scaledMm: 0.4, printedMm: 1.2 });
    expect(m.minimums!.wall).toBeGreaterThanOrEqual(1.2);
  });

  it('a thickened interior wall keeps its door: both faces move back and the door follows them', () => {
    const { data } = adjustForPrint(PACKAGES['sample-house'](), 300, FDM), b = building(data);
    const h0 = b.roomById.get('H0')!, lk = b.roomById.get('LK')!;
    expect(Math.max(...h0.polygon.map((p) => p[0]))).toBeCloseTo(3.3 - 0.12, 6);
    expect(Math.min(...lk.polygon.map((p) => p[0]))).toBeCloseTo(3.42 + 0.12, 6);
    expect(h0.doors.some((d) => d.id === 'D1')).toBe(true);
    scoped((keep) => {
      const s = levelSolid(geo, keep, b, 'L0')!, d1 = s.cuts.find((c) => c.id === 'D1')!;
      expect(d1.depth).toBeCloseTo(0.36, 6);
    });
  });
});

describe('printability adjustments of openings, piers and chimneys', () => {
  // one room under a flat roof at 1:100: two windows 10 cm apart, a 12 cm window, a lintel of 5 cm, a 10 cm chimney
  const plan = {
    schema: 'home-simulator/plan', version: 1, project: { id: 'print-rules', name: 'Print rules', buildingType: 'house' }, units: 'm', source: 'synthetic test fixture',
    levels: [{ id: 'G', name: 'Ground', floorZ: 0, ceiling: 2.6 }],
    rooms: [{ id: 'A', name: 'A', level: 'G', kind: 'living', rect: [0.3, 0.3, 6.3, 4.3] }],
    doors: [{ id: 'D0', between: ['A', 'exterior'], at: [0.15, 2.0], width: 1.0 }],
    windows: [
      { id: 'W1', room: 'A', at: [1.0, 0.3], width: 0.8 }, { id: 'W2', room: 'A', at: [1.9, 0.3], width: 0.8 },
      { id: 'W3', room: 'A', at: [4.0, 0.3], width: 0.12, sill: 1.2, head: 1.32 },
      { id: 'W4', room: 'A', at: [5.5, 0.3], width: 0.8, head: 2.55 },
    ],
    roof: { parts: [{ id: 'flat', level: 'G', type: 'flat', parapet: 0.3 }], chimneys: [{ id: 'C1', rect: [3.0, 3.0, 3.1, 3.1], top: 3.6 }] },
  };

  it('merges two windows over a narrow pier, widens a small window, lowers a thin lintel, grows a thin chimney — and prints', () => {
    const r = compilePlan(plan, { catalog: null });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    const m = printModel(r.project!.building, geo, { bed: K1C, profile: FDM, scale: 100, name: 'print-rules' });
    const by = (code: string) => m.adjustments.filter((a) => a.code === code).map((a) => a.element);
    expect(by('pier.merged')).toEqual(['W1 + W2']);
    expect(by('opening.widened')).toEqual(['W3', 'W3']);
    expect(by('lintel.lowered')).toEqual(['W4']);
    expect(by('chimney.grown')).toEqual(['C1']);
    expectPrintable(m);
    const { data } = adjustForPrint(r.project!.building, 100, FDM), a = data.rooms.rooms[0];
    expect(a.openings.map((o) => o.id).sort()).toEqual(['W1', 'W3', 'W4']);
    const w1 = a.openings.find((o) => o.id === 'W1')!, w3 = a.openings.find((o) => o.id === 'W3')!;
    expect([Math.min(w1.from_, w1.to), Math.max(w1.from_, w1.to)]).toEqual([0.6, 2.3]);
    expect(Math.abs(w3.to - w3.from_)).toBeCloseTo(0.15, 6);
    expect(w3.head_z! - w3.sill_z!).toBeCloseTo(0.15, 6);
    expect(a.openings.find((o) => o.id === 'W4')!.head_z).toBeCloseTo(2.5, 6);
  });
});

describe('the split of the last level', () => {
  it('a cold roof space: at the ceiling; rooms under the slopes: at the bottom of the eaves; no roof: at the top of the walls', () => {
    expect(splitHeight(building(PACKAGES['sample-house']()), 'L1')).toMatchObject({ rule: 'ceiling', z: 5.55 });
    const gy = building(PACKAGES['roof-gable-y']()), s = splitHeight(gy, 'A');
    expect(s.rule).toBe('eaves');
    expect(s.eavesBelow).toBe(0);
    expect(splitHeight(building(PACKAGES['demo-apartment']()), 'L1')).toMatchObject({ rule: 'wall-top', z: 2.6 });
    // the eaves trimmed: the lowest underside is at the outer faces of the walls, the roof over the walls goes with the level
    const t = splitHeight(gy, 'A', 'trim');
    expect(t.z).toBeGreaterThan(s.z);
    expect(t.roofBelow).toBe(true);
  });

  it('the parts meet in the split plane: the level part ends there and the roof part starts there', () => {
    const m = print('roof-gable-y'), lower = m.parts.find((p) => p.id === 'A')!, roof = m.parts.find((p) => p.id === 'roof')!, k = 1000 / m.n!;
    const z = (p: typeof lower, f: (a: number, b: number) => number) => { let v = p === lower ? -Infinity : Infinity; for (let i = 2; i < p.model.positions.length; i += 3) v = f(v, p.model.positions[i]); return v; };
    expect(z(lower, Math.max) / k).toBeCloseTo(m.split!.z, 4);
    expect(z(roof, Math.min) / k).toBeCloseTo(m.split!.z, 4);
  });

  it('roof windows and dormer windows are recesses in the roof part, not holes; they are left out when too small', () => {
    const at75 = print('roof-gable-y'), at150 = print('roof-gable-y', 150);
    expect(at75.notes.filter((x) => x.code.endsWith('.omitted'))).toEqual([]);
    expect(at150.notes.map((x) => x.code)).toContain('dormer-window.omitted');
    scoped((keep) => {
      // the recesses take volume out of the roof part, so it is smaller than the same part without them
      const { data } = adjustForPrint(PACKAGES['roof-gable-y'](), 75, FDM), noWindows = JSON.parse(JSON.stringify(data)) as BuildingData;
      for (const r of noWindows.rooms.rooms) r.roof_windows = [];
      for (const d of noWindows.roof!.dormers ?? []) delete d.window;
      const roofOf = (x: BuildingData) => buildParts(geo, keep, x, 75, FDM, 'keep').parts.find((p) => p.id === 'roof')!.solid.volume();
      expect(roofOf(data)).toBeLessThan(roofOf(noWindows) - 1e-4);
    });
  });
});

describe('stairs', () => {
  it('are one solid in every orientation: the same volume, standing in their outline, clipped at the top of the part', () => {
    const base = PACKAGES['sample-house']().stairs![0];
    scoped((keep) => {
      const volumes: number[] = [];
      for (const rotate of [0, 90, 180, 270] as const) for (const mirror of [false, true]) for (const ramp of [false, true]) {
        const [x0, y0, x1, y1] = base.bbox, turned = rotate % 180 !== 0;
        const s: StairDef = { ...base, orient: { rotate, mirror }, bbox: turned ? [x0, y0, x0 + (y1 - y0), y0 + (x1 - x0)] : base.bbox };
        const m = stairSolid(geo, keep, s, 0, [-Infinity, 2.7], ramp)!;
        expect(m.status()).toBe('NoError');
        expect(m.decompose().map((c) => keep(c)).length).toBe(1);
        const bb = m.boundingBox();
        for (const k of [0, 1]) { expect(bb.min[k]).toBeGreaterThanOrEqual(s.bbox[k] - 0.0051); expect(bb.max[k]).toBeLessThanOrEqual(s.bbox[k + 2] + 0.0051); }
        expect(bb.max[2]).toBeCloseTo(2.7, 6);
        if (!ramp) volumes.push(m.volume());
      }
      for (const v of volumes) expect(v).toBeCloseTo(volumes[0], 6);
    });
  });

  it('the steps in the slab of the upper level stand in its floor opening, on the bed of its part, on top of the lower flight', () => {
    const s = PACKAGES['sample-house']().stairs![0];                      // last step of the upper flight at 2.787, L0's part ends at 2.70
    expect(print('sample-house').notes.map((x) => x.code)).toContain('stairs.split');
    scoped((keep) => {
      const parts = buildParts(geo, keep, PACKAGES['sample-house'](), 75, FDM, 'keep').parts, L0 = parts[0].solid, L1 = parts[1].solid;
      // the last tread of the upper flight (canonical frame = plan here): x from the wall to the gap, one tread before the opening's edge
      const tread = keep(geo.Manifold.cube([s.split - s.gap / 2 - s.bbox[0], s.tread, 0.5], false).translate([s.bbox[0], s.bbox[3] - s.tread, 2.6]));
      expect(keep(L1.intersect(tread)).volume()).toBeCloseTo((s.split - s.gap / 2 - s.bbox[0]) * s.tread * (s.landingZ + 8 * s.riser - 2.7), 6);
      expect(keep(L1.intersect(tread)).boundingBox().min[2]).toBeCloseTo(2.7, 6);
      expect(keep(L0.intersect(tread)).boundingBox().max[2]).toBeCloseTo(2.7, 6);
    });
    // lower than the smallest step on the print: left out, and the note says why
    expect(print('sample-house', 300).notes.find((x) => x.code === 'stairs.clipped')?.message).toMatch(/lower than 0.5 mm/);
  });
});

describe('scale, bed and printers', () => {
  it('parses scales and beds', () => {
    expect(parseScale('1:75')).toBe(75); expect(parseScale('100')).toBe(100); expect(parseScale('auto')).toBeNull(); expect(parseScale(undefined)).toBeNull();
    expect(() => parseScale('1:x')).toThrow();
    expect(parseBed('K1C')).toEqual({ name: 'Creality K1C', x: 220, y: 220, z: 250 });
    expect(parseBed('220x200')).toEqual({ name: null, x: 220, y: 200, z: null });
    expect(parseBed('256 × 256 × 256 mm')).toEqual({ name: null, x: 256, y: 256, z: 256 });
    // a model named exactly wins over longer names containing it; otherwise every word must match
    expect(parseBed('k1').name).toBe('Creality K1');
    expect(parseBed('bambu a1 mini').name).toBe('Bambu Lab A1 mini');
    expect(() => parseBed('creality')).toThrow(/ambiguous/);
    expect(() => parseBed('no such printer')).toThrow(/unknown printer/);
    expect(findPrinters('ender 3').map((p) => p.model)).toEqual(['Ender-3']);
    expect(findPrinters('ender').length).toBeGreaterThan(3);
  });

  it('a part fits straight, turned by 90°, or not at all; the margin is kept on every side; the height counts', () => {
    const mk4 = parseBed('Prusa MK4');                                   // 250 × 210 × 220 → 230 × 190 inside the margin
    expect(fitOnBed([210, 150, 10], mk4, 10)).toMatchObject({ fits: true, rotated: false });
    expect(fitOnBed([180, 220, 10], mk4, 10)).toMatchObject({ fits: true, rotated: true });
    expect(fitOnBed([200, 200, 10], mk4, 10)).toMatchObject({ fits: false, over: ['plan'] });
    expect(fitOnBed([100, 100, 230], mk4, 10)).toMatchObject({ fits: false, over: ['height'] });
    expect(fitOnBed([100, 100, 900], parseBed('300x300'), 10).fits).toBe(true);
  });

  it('a scale that does not fit is reported and nothing is written', () => {
    const m = printModel(PACKAGES['sample-house'](), geo, { bed: parseBed('100x100'), profile: FDM, scale: 50, name: 'sample-house' });
    expect(m.ok).toBe(false);
    expect(m.parts.every((p) => p.stl === null && p.problems.some((x) => x.startsWith('does not fit')))).toBe(true);
    const none = printModel(PACKAGES['sample-house'](), geo, { bed: parseBed('20x20'), profile: FDM, name: 'sample-house' });
    expect(none.n).toBeNull();
    expect(none.problems[0]).toMatch(/no standard scale/);
  });
});

describe('STL and PNG', () => {
  it('the STL check finds open edges and degenerate triangles; needles are split without opening the mesh', () => {
    const m = print('roof-hip'), stl = m.parts[0].stl!;
    const cut = stl.slice(0, stl.length - 50);
    new DataView(cut.buffer).setUint32(80, (cut.length - 84) / 50, true);
    expect(checkStl(cut).problems.join()).toMatch(/not closed/);
    // a square split into two triangles plus a needle on the diagonal is cleaned up
    const P = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0.5, 0];
    const out = splitNeedles(P, new Uint32Array([0, 1, 2, 0, 2, 3, 2, 0, 4]), 1e-6);
    expect(out.length / 3).toBe(3);
  });

  it('PNG: signature, size, deterministic stored blocks', () => {
    const img = { width: 3, height: 2, rgb: new Uint8Array(18).fill(200) }, png = encodePng(img);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([3, 2]);
    expect(Buffer.from(encodePng(img)).equals(Buffer.from(png))).toBe(true);
  });
});
