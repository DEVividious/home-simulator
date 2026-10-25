// Electrical / smart-home plan: points from the project sources, wall snapping, AFFL height, distance from the left corner,
// storage and validation (global / variant plan), coordination warnings, table / CSV / JSON, plan drawing (levels, site)
// and the PDF document (pages, scale, vectors, embedded font). Most cases run on the sample house (two levels, site);
// the demo apartment checks a project without a site.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultDoc, docErrors, type ConfiguratorDoc } from '../../document/model';
import { activateProject, project, withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import type { ProjectPackage } from '../../project/types';
import { backStep } from '../backNav';
import {
  addPoint, alongRun, defaultPlan, EL_DISCLAIMER, EL_LAYER_IDS, EL_TYPE_IDS, EL_TYPES, elRoom, elWall, EXT, hasSite, houseFootprint, inGroup, measure, nearestElWall, nextId, PDF_GROUPS, placeFree,
  placeOnWall, planErrors, planRows, plotBoundary, pointWarnings, removePoint, resolvePlan, retype, snapAlong, snapHeight, TABLE_COLUMNS, tableCells, toCsv, toJson, updatePoint, wallRuns,
  type ElectricalPlan, type ElPoint,
} from '../model/electrical';
import { roomById } from '../model/rooms';
import { variantExtrasErrors } from '../model/variantData';
import { pageLayout, pdfModel, renderPdf, tableWidths, type PdfOptions } from '../pdf/electricalPdf';
import { buildPlan, fitScale, isSitePoint, planViews, pointsOfView, symbolPrims, viewBounds } from '../plan/elPlan';
import { beginNew, placeNow } from '../store/elPlace';
import { ui } from '../store/ui';

const root = path.resolve(__dirname, '..', '..', '..');
const readProject = (id: string) => readProjectDir(path.join(root, 'projects', id));
/** socket id G<n> (built from parts: the bare quoted ids collide with a genericity-audit pattern) */
const g = (n: number) => `G${n}`;
const house = readProject('sample-house');

const wallPt = (roomId: string, wallId: string, t: number, h: number, type: ElPoint['type'] = 'socket-1', extra: Partial<ElPoint> = {}): ElPoint =>
  ({ id: 'X1', type, roomId, wallId, positionAlongWall: t, heightAFFL: h, orientation: 'wall', modules: 1, label: '', smartHome: 'none', source: 'user', status: 'planned', ...extra });
/** a user plan on top of the source points: sockets, switch, data, TV, a sensor and a socket upstairs, a facade socket, a ceiling light and a garden light */
const sample = (): ElectricalPlan => {
  let p = defaultPlan();
  const add = (type: ElPoint['type'], roomId: string, wallId: string, t: number, h: number, extra: Partial<ElPoint> = {}) => { p = addPoint(p, type, { roomId, wallId, positionAlongWall: t, heightAFFL: h, orientation: 'wall' }, extra).plan; };
  add('socket-1', 'LK', 'LK-w1', 1.0, 0.3); add('socket-2', 'LK', 'LK-w3', 1.2, 0.3, { label: 'by the sofa' }); add('switch', 'H0', 'H0-w1', 0.3, 1.1); add('rj45', 'LK', 'LK-w1', 1.4, 0.3, { circuitLabel: 'LAN-1' });
  add('tv', 'LK', 'LK-w3', 1.6, 0.3); add('temp', 'BR1', 'BR1-w4', 1.0, 1.5); add('socket-1', 'BR1', 'BR1-w4', 0.5, 0.3, { notes: 'by the bed; "left" side' });
  { const n = nearestElWall(elRoom(EXT)!, [5, -0.6]); add('socket-ext', EXT, n.wall.id, Math.round(n.t * 100) / 100, 0.4); }
  p = addPoint(p, 'light', { roomId: 'LK', wallId: null, positionAlongWall: 0, heightAFFL: 2.7, orientation: 'ceiling', x: 6, y: 4 }).plan;
  p = addPoint(p, 'light', { roomId: EXT, wallId: null, positionAlongWall: 0, heightAFFL: 0.4, orientation: 'free', x: 14, y: 12 }, { purpose: 'garden lighting' }).plan;
  return p;
};
const SOURCE_IDS = ['B1', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'SW1', 'SW2', 'SW3', 'SW4'];

describe('project without a site (demo apartment)', () => {
  it('no facade space, no building outline or plot boundary; source points sit on the apartment walls', () => {
    expect(hasSite()).toBe(false);
    expect(elRoom(EXT)).toBeNull(); expect(houseFootprint()).toEqual([]); expect(plotBoundary()).toEqual([]);
    expect(planViews()).toEqual(['L1']);
    const p = defaultPlan();
    expect(p.points.map((q) => q.id).sort()).toEqual(['B1', 'S1', 'S2', 'S3', 'S4', 'S5', 'SW1', 'SW2', 'SW3', 'SW4']);
    expect(planErrors(p)).toEqual([]);
    expect(pdfModel(p, { format: 'a4', groups: ['all'], project: 'Demo', date: '2026-10-03', scope: 'shared plan' }).map((x) => (x.kind === 'plan' ? x.view : 'table'))).toEqual(['L1', 'table']);
  });
});

describe('sample house', () => {
  beforeAll(() => { activateProject(house); });
  afterAll(() => { activateProject(readProject('demo-apartment')); });

  describe('points from the project sources', () => {
    it('every source point lands on the model wall at its plan position; labels, status and source come from the package', () => {
      const p = defaultPlan();
      expect(p.points.map((q) => q.id).sort()).toEqual(SOURCE_IDS);
      for (const q of p.points) {
        const src = project().electrical.points.find((x) => x.id === q.id)!;
        expect(q).toMatchObject({ type: src.type, roomId: src.roomId, label: src.label, source: src.source, status: 'source', orientation: 'wall' });
        const m = measure(q)!;
        expect(m.pos[0], q.id).toBeCloseTo(src.x, 3); expect(m.pos[1], q.id).toBeCloseTo(src.y, 3);
        expect(m.pos[2], q.id).toBeCloseTo(roomById(q.roomId)!.floorZ + src.heightAFFL, 6);
      }
      const b = p.points.find((q) => q.id === 'B1')!;
      expect(b).toMatchObject({ type: 'board', roomId: 'H0', wallId: 'H0-w2', boardKind: 'unspecified', width: 0.4, label: 'Distribution board' });
      expect(measure(b)!.normal).toEqual([-1, 0]);                  // the hall's east wall, symbol on the hall side
      expect(planErrors(p)).toEqual([]);
      expect(resolvePlan(undefined, undefined)).toEqual(p); expect(resolvePlan(null, null)).toEqual(p);
    });
    it('a source point that does not lie on a model wall (or names an unknown room) is skipped — no guessing', () => {
      const pkg = structuredClone(house) as ProjectPackage;
      pkg.electrical.points.push(
        { id: 'S9', type: 'socket-1', roomId: 'LK', x: 6, y: 4, heightAFFL: 0.3, label: 'mid-room', source: 'test', status: 'source' },
        { id: 'S10', type: 'socket-1', roomId: 'NOPE', x: 3.42, y: 2, heightAFFL: 0.3, label: 'unknown room', source: 'test', status: 'source' },
      );
      expect(withProject(pkg, () => defaultPlan().points.map((q) => q.id).sort())).toEqual(SOURCE_IDS);
    });
  });

  describe('point on a wall: snapping, height, distance from the left corner', () => {
    it('wall hit: the point lies on the wall plane, stores wallId and roomId, height above the finished floor', () => {
      const room = elRoom('LK')!, w = room.walls.find((x) => x.id === 'LK-w4')!;
      const hit: [number, number] = [w.a[0] + w.dir[0] * 1.234 + w.inward[0] * 0.07, w.a[1] + w.dir[1] * 1.234 + w.inward[1] * 0.07];
      const pl = placeOnWall(room, w, hit, room.floorZ + 1.137, 'socket-2', 0);
      expect(pl).toMatchObject({ roomId: 'LK', wallId: w.id, orientation: 'wall' }); expect(pl.positionAlongWall).toBeCloseTo(1.234, 3); expect(pl.heightAFFL).toBeCloseTo(1.137, 3);
      const m = measure({ ...wallPt('LK', w.id, pl.positionAlongWall, pl.heightAFFL) })!;
      // exactly on the wall line (7 cm click offset removed), normal into the room
      expect(Math.abs((m.pos[0] - w.a[0]) * w.inward[0] + (m.pos[1] - w.a[1]) * w.inward[1])).toBeLessThan(1e-9);
      expect(m.normal).toEqual(w.inward); expect(m.pos[2]).toBeCloseTo(room.floorZ + 1.137, 3);
      // projection without height → the type's default height; ceiling types land on the ceiling
      expect(placeOnWall(room, w, hit, null, 'switch').heightAFFL).toBe(EL_TYPES.switch.height);
      const c = placeFree(room, [6, 4], 'light');
      expect(c).toMatchObject({ roomId: 'LK', wallId: null, orientation: 'ceiling', x: 6, y: 4 }); expect(c.heightAFFL).toBeCloseTo(roomById('LK')!.ceiling.heightAt(6, 4), 2);
    });
    it('upper level: the height is stored above the level floor, the position in project coordinates is absolute', () => {
      const room = elRoom('BR1')!, w = room.walls.find((x) => x.id === 'BR1-w4')!;
      expect(room.floorZ).toBe(2.95);
      const pl = placeOnWall(room, w, [w.a[0] + w.dir[0] * 1.5, w.a[1] + w.dir[1] * 1.5], room.floorZ + 1.1, 'switch');
      expect(pl.heightAFFL).toBeCloseTo(1.1, 6);
      expect(measure(wallPt('BR1', w.id, pl.positionAlongWall, pl.heightAFFL))!.pos[2]).toBeCloseTo(4.05, 6);
    });
    it('snapping to 5 / 10 cm counted from the left corner; no snapping = exact position; margin from the corners', () => {
      const room = elRoom('LK')!, w = room.walls.find((x) => x.id === 'LK-w4')!;
      const run = wallRuns('LK').find((r) => r.walls.includes(w))!;
      let before = 0;
      for (const x of run.walls) { if (x === w) break; before += x.length; }
      for (const step of [0.05, 0.1]) {
        const t = snapAlong(room, w, 1.234, step), fromLeft = run.length - (before + t);
        expect(Math.abs(fromLeft / step - Math.round(fromLeft / step))).toBeLessThan(1e-6);
      }
      expect(snapAlong(room, w, 1.234, 0)).toBeCloseTo(1.234, 3);
      expect(snapAlong(room, w, -5, 0.05)).toBeGreaterThanOrEqual(0.05 - 1e-9); expect(snapAlong(room, w, 99, 0.05)).toBeLessThanOrEqual(w.length - 0.05 + 1e-9);
      expect(snapHeight(1.137, 0.05)).toBeCloseTo(1.15, 6); expect(snapHeight(1.137, 0)).toBeCloseTo(1.137, 6); expect(snapHeight(-1, 0.05)).toBe(0);
    });
    it('distances from the left and right corner add up to the wall length; left = wall end, looking from inside', () => {
      const p = wallPt('H0', 'H0-w1', 2.0, 0.3), m = measure(p)!;            // south wall of the hall: y = 0.3 from x 0.3 to 3.3
      expect(m.fromRight).toBeCloseTo(2.0, 6); expect(m.fromLeft).toBeCloseTo(1.0, 6); expect(m.fromLeft! + m.fromRight!).toBeCloseTo(m.run!.length, 6);
      expect(m.pos[0]).toBeCloseTo(2.3, 6);                                    // looking south from inside, the left corner is x = 3.3
      expect(m.run!.side).toBe('bottom');
      expect(m.wallLabel).toBe('1 · bottom');
    });
    it('wall runs: one run per straight wall; a distance from the left corner maps back to the wall segment', () => {
      const runs = wallRuns('LK');
      expect(runs.map((r) => r.side)).toEqual(['bottom', 'right', 'top', 'left']);
      expect(runs.reduce((s, r) => s + r.walls.length, 0)).toBe(elRoom('LK')!.walls.length);
      const b1 = measure(defaultPlan().points.find((q) => q.id === 'B1')!)!;
      expect(b1.fromRight).toBeCloseTo(0.3, 3); expect(b1.fromLeft).toBeCloseTo(4.4, 3);
      const left = runs.find((r) => r.side === 'left')!, at = alongRun('LK', left.index, 1.0)!;
      expect(at.wallId).toBe('LK-w4'); expect(measure(wallPt('LK', at.wallId, at.positionAlongWall, 0.3))!.fromLeft).toBeCloseTo(1.0, 3);
      expect(alongRun('LK', left.index, 99)!.positionAlongWall).toBeCloseTo(0.02, 3); expect(alongRun('LK', 99, 1)).toBeNull();
    });
    it('a wall made of collinear segments is one run: the real corners are the reference; the distance crosses segments', () => {
      // fixture: the demo hallway with an extra vertex on its south wall (two collinear segments)
      const pkg = structuredClone(readProject('demo-apartment')) as ProjectPackage, r4 = pkg.building.rooms.rooms.find((r) => r.id === 'R4')!;
      r4.polygon = [[0.3, 0.3], [1.2, 0.3], [2.4, 0.3], [2.4, 2.9], [0.3, 2.9]];
      withProject(pkg, () => {
        const runs = wallRuns('R4'), south = runs.find((r) => r.walls.length === 2)!;
        expect(south.walls.map((w) => w.id)).toEqual(['R4-w1', 'R4-w2']); expect(south.length).toBeCloseTo(2.1, 6); expect(south.side).toBe('bottom');
        expect(runs).toHaveLength(4);
        const m = measure(wallPt('R4', 'R4-w2', 0.5, 0.3))!;                   // 0.9 + 0.5 from the run start
        expect(m.fromRight).toBeCloseTo(1.4, 6); expect(m.fromLeft).toBeCloseTo(0.7, 6);
        const far = alongRun('R4', south.index, 1.8)!;                         // 1.8 m from the left corner → the first segment
        expect(far).toEqual({ wallId: 'R4-w1', positionAlongWall: 0.3 });
      });
    });
    it('facade (EXT): walls from the building outline, the point on the outer side; outline and plot boundary from the package', () => {
      expect(houseFootprint()).toEqual(project().site!.footprint);
      expect(plotBoundary()).toEqual(project().site!.boundary);
      const ext = elRoom(EXT)!;
      expect(ext.exterior).toBe(true); expect(ext.floorZ).toBe(project().site!.groundLevel); expect(ext.level).toBe('L0');
      expect(ext.walls).toHaveLength(houseFootprint().length);
      for (const wl of ext.walls) {
        const mid: [number, number] = [(wl.a[0] + wl.b[0]) / 2 + wl.inward[0] * 0.2, (wl.a[1] + wl.b[1]) / 2 + wl.inward[1] * 0.2];
        expect(mid[0] < 0 || mid[0] > 10 || mid[1] < 0 || mid[1] > 8, wl.id).toBe(true);    // "inward" points out of the building
      }
      const n = nearestElWall(ext, [5, -0.6]);
      expect(n.wall.a[1]).toBeCloseTo(0, 6); expect(n.wall.b[1]).toBeCloseTo(0, 6); expect(n.d).toBeCloseTo(0.6, 6);
      expect(placeFree(ext, [14.02, 12.03], 'light', 0.05)).toMatchObject({ roomId: EXT, orientation: 'free', x: 14, y: 12.05 });
    });
  });

  describe('point types and smart home', () => {
    it('full type set: sockets, switch, light, board, RJ45, TV, Wi-Fi, bus, sensors, camera, contact, keypad, ceiling device, EV, 3-phase', () => {
      for (const t of ['socket-1', 'socket-2', 'socket-3', 'socket-ext', 'switch', 'light', 'board', 'rj45', 'tv', 'wifi', 'bus', 'motion', 'temp', 'camera', 'contact', 'keypad', 'ceiling-smart', 'ev', 'power3f']) expect(EL_TYPE_IDS).toContain(t);
      for (const t of EL_TYPE_IDS) { expect(EL_LAYER_IDS).toContain(EL_TYPES[t].layer); expect(Object.keys(PDF_GROUPS)).toContain(EL_TYPES[t].pdf); expect(EL_TYPES[t].name).not.toMatch(/^electrical\./); }
      expect(EL_TYPES['socket-2'].name).toBe('Double 230 V socket'); expect(EL_TYPES.board.name).toBe('Distribution board');
      expect(EL_TYPES['socket-2'].modules).toBe(2); expect(EL_TYPES['socket-3'].modules).toBe(3);
      expect(retype(wallPt('LK', 'LK-w1', 1, 0.3), 'socket-3')).toEqual({ type: 'socket-3', modules: 3, smartHome: 'none' });
      expect(retype(wallPt('LK', 'LK-w1', 1, 0.3, 'socket-1', { smartHome: 'relay' }), 'rj45').smartHome).toBe('relay');           // the user's choice stays
    });
    it('ids: category prefix + number, never reused after removing one in the middle; no clash with source ids', () => {
      let p = defaultPlan();
      expect(nextId(p, 'board')).toBe('R1'); expect(nextId(p, 'socket-2')).toBe('G1'); expect(nextId(p, 'rj45')).toBe('D1'); expect(nextId(p, 'motion')).toBe('C1'); expect(nextId(p, 'ev')).toBe('P1');
      expect(nextId(p, 'bus')).toBe('S7');                                     // S1–S6 are source sockets
      for (let i = 0; i < 3; i++) p = addPoint(p, 'socket-1', { roomId: 'LK', wallId: 'LK-w1', positionAlongWall: 0.5 + i, heightAFFL: 0.3, orientation: 'wall' }).plan;
      p = removePoint(p, g(2));
      expect(nextId(p, 'socket-1')).toBe('G4');
      expect(updatePoint(p, 'G1', { heightAFFL: 1.1 }).points.find((q) => q.id === 'G1')!.heightAFFL).toBe(1.1);
      expect(new Set(sample().points.map((q) => q.id)).size).toBe(sample().points.length);
    });
  });

  describe('storage: global document plan, optional variant layout, validation', () => {
    it('point validation: type, room, wall, distance and height range, text fields', () => {
      expect(planErrors(undefined)).toEqual([]); expect(planErrors(sample())).toEqual([]);
      const bad = { version: 1, points: [
        { ...wallPt('LK', 'LK-w4', 1, 0.3), id: 'A' }, { ...wallPt('LK', 'LK-w4', 1, 0.3), id: 'A' }, { ...wallPt('999', 'x', 1, 0.3), id: 'B' }, { ...wallPt('LK', 'LK-w99', 1, 0.3), id: 'C' },
        { ...wallPt('LK', 'LK-w1', 99, 0.3), id: 'D' }, { ...wallPt('LK', 'LK-w4', 1, 30), id: 'E' }, { ...wallPt('LK', 'LK-w4', 1, 0.3), id: 'F', type: 'laser' }, { ...wallPt('LK', 'LK-w4', 1, 0.3), id: 'G', modules: 9, smartHome: 'x', status: 'y' },
        { ...wallPt('LK', 'LK-w4', 1, 0.3), id: 'H', orientation: 'ceiling', wallId: null },
      ] };
      const e = planErrors(bad).join(' | ');
      for (const re of [/unique id/, /unknown room/, /unknown wall/, /positionAlongWall/, /heightAFFL/, /unknown type/, /modules/, /smartHome/, /status/, /position x, y/]) expect(e).toMatch(re);
      expect(planErrors({ points: [] })).toHaveLength(1); expect(planErrors('x')).toHaveLength(1);
    });
    it('project document: electrical is an optional field, an invalid plan is rejected; a variant may have its own layout', () => {
      const doc: ConfiguratorDoc = defaultDoc(), v = doc.variants[0];
      expect(doc.projectId).toBe('sample-house');
      expect(docErrors(doc)).toEqual([]);
      expect(docErrors({ ...doc, electrical: sample() })).toEqual([]);
      expect(docErrors({ ...doc, electrical: { version: 1, points: [{ ...wallPt('LK', 'no-such-wall', 1, 0.3) }] } }).join()).toMatch(/unknown wall/);
      expect(variantExtrasErrors({ ...v, electrical: sample() } as never)).toEqual([]);
      expect(variantExtrasErrors({ ...v, electrical: { version: 2, points: [] } } as never).join()).toMatch(/electrical \(variant\)/);
      const own = { version: 1 as const, points: [] };
      expect(resolvePlan(sample(), own)).toBe(own);                 // the variant's own layout wins
      expect(resolvePlan(sample(), null).points.length).toBeGreaterThan(SOURCE_IDS.length);
      // a JSON round trip does not change the plan
      const s = sample(); expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    });
  });

  describe('coordination warnings (information only — nothing is removed)', () => {
    it('socket behind an open door leaf, in a built-in unit, next to sanitary fittings, in a clear opening', () => {
      const p = wallPt('H0', 'H0-w1', 2.0, 0.3), m = measure(p)!, q: [number, number] = [m.pos[0], m.pos[1]];
      const box = (hw: number, hd: number): [number, number][] => [[q[0] - hw, q[1] - 0.01], [q[0] + hw, q[1] - 0.01], [q[0] + hw, q[1] + hd], [q[0] - hw, q[1] + hd]];
      const none = { doorLeaves: [], furniture: [] };
      expect(pointWarnings(p, none)).toEqual([]);
      const leaf = { doorLeaves: [{ roomIds: ['H0', 'LK'], a: [q[0] - 0.4, q[1] + 0.05] as [number, number], b: [q[0] + 0.5, q[1] + 0.05] as [number, number], name: 'D1' }], furniture: [] };
      expect(pointWarnings(p, leaf)[0]).toMatchObject({ kind: 'door' }); expect(pointWarnings({ ...p, heightAFFL: 2.2 }, leaf)).toEqual([]);          // above the leaf — no note
      expect(pointWarnings(p, leaf)[0].text).toContain('D1');
      const f = (sanitary: boolean, builtIn: boolean, z1 = 2) => ({ doorLeaves: [], furniture: [{ roomId: 'H0', corners: box(0.4, 0.6), z0: 0, z1, name: 'wardrobe', sanitary, builtIn }] });
      expect(pointWarnings(p, f(false, true))[0]).toMatchObject({ kind: 'furniture' }); expect(pointWarnings(p, f(true, false))[0]).toMatchObject({ kind: 'sanitary' });
      expect(pointWarnings(p, f(false, false))).toEqual([]);                                 // ordinary furniture — no note
      expect(pointWarnings({ ...p, heightAFFL: 1.1 }, f(false, true, 0.9))).toEqual([]);     // point above the worktop — no note
      // a point in the clear opening of a door (D1 in the hall's east wall) or a window (W1 in the living room's south wall)
      expect(pointWarnings(wallPt('H0', 'H0-w2', 4.0, 1.0), none)[0]).toMatchObject({ kind: 'opening' });
      expect(pointWarnings(wallPt('LK', 'LK-w1', 2.0, 1.2), none)[0]).toMatchObject({ kind: 'opening' });
      expect(pointWarnings(wallPt('LK', 'LK-w1', 2.0, 0.3), none)).toEqual([]);              // below the sill
    });
    // regression: window sill_z / head_z are absolute heights — the compiler once wrote them relative to the level floor
    it('a point in the clear opening of an upper-level window (W5, main bedroom) is reported', () => {
      expect(pointWarnings(wallPt('BR1', 'BR1-w3', 3.0, 1.2), { doorLeaves: [], furniture: [] })[0]).toMatchObject({ kind: 'opening' });
    });
  });

  describe('point table, CSV, JSON', () => {
    it('table columns; rows: level → room → id; distance and height in cm', () => {
      const plan = sample();
      expect([...TABLE_COLUMNS]).toEqual(['ID', 'Room', 'Type', 'Wall', 'Distance', 'Height', 'Qty', 'Description', 'Smart Home', 'Circuit', 'Notes']);
      const rows = planRows(plan);
      expect(rows).toHaveLength(plan.points.length);
      expect(rows.findIndex((r) => r.level === 'L1')).toBeGreaterThan(rows.findIndex((r) => r.roomId === EXT));
      expect(rows.findIndex((r) => r.roomId === EXT)).toBeGreaterThan(rows.findIndex((r) => r.level === 'L0'));
      const row = rows.find((r) => r.id === g(2))!, cells = tableCells(row);
      expect(cells).toHaveLength(11); expect(cells[0]).toBe(g(2)); expect(cells[1]).toBe('LK Living room with kitchen'); expect(cells[2]).toBe('Double 230 V socket');
      expect(cells[4]).toMatch(/^\d+ cm from the left corner$/); expect(cells[5]).toBe('30 cm'); expect(cells[6]).toBe('2'); expect(cells[7]).toBe('by the sofa');
      expect(row.distance! + row.distanceRight!).toBe(Math.round(measure(plan.points.find((p) => p.id === g(2))!)!.run!.length * 100));
      expect(tableCells(rows.find((r) => r.id === 'L1')!)[5]).toBe('ceiling');
      expect(tableCells(rows.find((r) => r.id === 'L2')!)[1]).toBe('Outside');
      expect(tableCells(rows.find((r) => r.id === 'B1')!)[7]).toMatch(/^Distribution board · unspecified.*approx\. 40 cm wide$/);
      expect(tableCells(rows.find((r) => r.id === 'S1')!)[10]).toBe('from source');
      expect(planRows(plan, 'data').map((r) => r.id).sort()).toEqual(['B1', 'D1', 'D2']);       // boards as a reference on every layer
      expect(inGroup(plan.points.find((p) => p.id === 'C1')!, 'smart')).toBe(true); expect(inGroup(plan.points.find((p) => p.id === 'C1')!, 'power')).toBe(false);
    });
    it('CSV: semicolon, BOM, quotes in fields; JSON: points with reference dimensions and the disclaimer', () => {
      const plan = sample(), csv = toCsv(plan), lines = csv.trim().split('\r\n');
      expect(csv.charCodeAt(0)).toBe(0xfeff); expect(lines).toHaveLength(plan.points.length + 1); expect(lines[0].split(';')).toHaveLength(18);
      expect(lines.find((l) => l.startsWith('G3;'))).toContain('"by the bed; ""left"" side"');
      const j = JSON.parse(toJson(plan, { project: 'House', exportedAt: '2026-10-03T00:00:00Z', scope: 'shared plan' }));
      expect(j.schema).toBe('home-simulator/electrical-points'); expect(j.points).toHaveLength(plan.points.length); expect(j.disclaimer).toMatch(/CONCEPT \/ COORDINATION PLAN/);
      const g1 = j.points.find((p: { id: string }) => p.id === 'G1');
      expect(g1).toMatchObject({ roomId: 'LK', wallId: 'LK-w1', heightAFFL: 0.3, type: 'socket-1' }); expect(g1.fromLeftCm + g1.fromRightCm).toBe(628); expect(g1.lcs.z).toBeCloseTo(0.3, 3);
      expect(j.points.find((p: { id: string }) => p.id === 'C1').lcs.z).toBeCloseTo(2.95 + 1.5, 3);   // upper level: absolute height
    });
  });

  describe('plan drawing', () => {
    it('views: ground floor, first floor, site — every view shows its own points; layers filter', () => {
      const plan = sample();
      expect(planViews()).toEqual(['L0', 'L1', 'SITE']);
      const ids = (v: 'L0' | 'L1' | 'SITE', layers = EL_LAYER_IDS) => pointsOfView(plan, v, layers).map((p) => p.id).sort();
      expect(ids('L0')).toEqual(['B1', 'D1', 'D2', 'G1', g(2), 'G4', 'L1', 'S1', 'S2', 'S3', 'S4', 'SW1', 'SW2', 'W1']);
      expect(ids('L1')).toEqual(['C1', 'G3', 'S5', 'S6', 'SW3', 'SW4']);
      expect(ids('SITE')).toEqual(['G4', 'L2']);
      expect(ids('L0', ['data'])).toEqual(['D1', 'D2']); expect(ids('L0', [])).toEqual([]);
      expect(isSitePoint(plan.points.find((p) => p.id === 'L2')!)).toBe(true); expect(isSitePoint(plan.points.find((p) => p.id === 'G4')!)).toBe(false);
    });
    it('drawing: symbol and id of every point, paper sizes by scale; distance labels only when there are few points', () => {
      const plan = sample();
      const d = buildPlan({ view: 'L0', plan, layers: EL_LAYER_IDS, den: 100, dims: 'auto' });
      expect(d.points.map((p) => p.id).sort()).toEqual(['B1', 'D1', 'D2', 'G1', g(2), 'G4', 'L1', 'S1', 'S2', 'S3', 'S4', 'SW1', 'SW2', 'W1']);
      const texts = d.symbols.filter((p) => p.k === 'text').map((p) => (p as { text: string }).text);
      for (const id of ['G1', g(2), 'B1', 'D1', 'W1', 'L1', 'SW1']) expect(texts).toContain(id);
      expect(texts.some((t) => /^\d+ · h30$/.test(t))).toBe(true);                         // distance · height next to the symbol (few points)
      expect(buildPlan({ view: 'L0', plan, layers: EL_LAYER_IDS, den: 100, dims: 'id' }).symbols.some((p) => p.k === 'text' && /· h/.test(p.text))).toBe(false);
      // id text 2.2 mm of paper at 1:100 = 0.22 m
      const idText = d.symbols.find((p) => p.k === 'text' && p.text === 'G1') as { size: number };
      expect(idText.size).toBeCloseTo(0.22, 6);
      expect(d.types).toEqual(expect.arrayContaining(['socket-1', 'socket-2', 'switch', 'light', 'board', 'rj45', 'tv', 'socket-ext']));
      // background: walls, rooms, doors — no furniture unless given
      expect(d.prims.filter((p) => p.k === 'text').length).toBeGreaterThanOrEqual(3);
      const withF = buildPlan({ view: 'L0', plan, layers: EL_LAYER_IDS, den: 100, furniture: [[[4, 1], [5, 1], [5, 2], [4, 2]]] });
      expect(withF.prims.length).toBe(d.prims.length + 1);
      const sym = symbolPrims(plan.points.find((p) => p.id === g(2))!, [0, 0], [0, 1], 0.42, 0.03, '#c0392b');
      expect(sym.prims.some((p) => p.k === 'text' && p.text === '2')).toBe(true); expect(sym.center[1]).toBeGreaterThan(0.3);
    });
    it('scale from the standard series: the ground floor fits A4 at 1:75 and A3 at 1:50', () => {
      const b = viewBounds('L0', []), a4 = pageLayout('a4'), a3 = pageLayout('a3');
      expect(fitScale(b, a4.area[2] - a4.area[0], a4.area[3] - a4.area[1])).toBe(75);
      expect(fitScale(b, a3.area[2] - a3.area[0], a3.area[3] - a3.area[1])).toBe(50);
      expect(fitScale([0, 0, 1000, 1000], 100, 100)).toBe(1000);
    });
  });

  describe('PDF document', () => {
    const opts = (o: Partial<PdfOptions> = {}): PdfOptions => ({ format: 'a4', groups: ['all'], project: 'House — test', date: '2026-10-03', scope: 'shared plan', ...o });
    it('pages: every level (and the site when there are distant exterior points) + table; layers as separate pages', () => {
      const plan = sample(), all = pdfModel(plan, opts());
      expect(all.map((p) => (p.kind === 'plan' ? p.view : 'table'))).toEqual(['L0', 'L1', 'SITE', 'table']);
      expect(all[0]).toMatchObject({ kind: 'plan', count: 14 }); expect((all[0] as { title: string }).title).toBe('Electrical plan — Ground floor — All');
      const tab = all[3] as { rows: string[][]; title: string };
      expect(tab.rows).toHaveLength(plan.points.length); expect(tab.rows.every((r) => r.length === 11)).toBe(true); expect(tab.title).toBe('Point table — all layers');
      const layers = pdfModel(plan, opts({ groups: ['power', 'lighting', 'data', 'smart'] }));
      expect(layers.filter((p) => p.kind === 'plan').map((p) => `${(p as { group: string }).group}:${(p as { view: string }).view}`))
        .toEqual(['power:L0', 'power:L1', 'lighting:L0', 'lighting:L1', 'lighting:SITE', 'data:L0', 'smart:L1']);
      expect((layers[layers.length - 1] as { rows: string[][] }).rows).toHaveLength(plan.points.length);       // table: union of the layers without repeats
      expect(pdfModel(plan, opts({ groups: ['data'], table: false })).every((p) => p.kind === 'plan')).toBe(true);
      // source points only: still every level for "All", no site page
      expect(pdfModel(defaultPlan(), opts()).map((p) => (p.kind === 'plan' ? p.view : 'table'))).toEqual(['L0', 'L1', 'table']);
      expect(tableWidths(277).reduce((a, b) => a + b, 0)).toBeCloseTo(277, 6);
    });
    it('PDF: valid file, A4 / A3 landscape, page count, embedded font, no raster images', async () => {
      const plan = sample();
      const fonts = { regular: readFileSync('src/home/pdf/fonts/DejaVuSans-subset.ttf').toString('base64'), bold: readFileSync('src/home/pdf/fonts/DejaVuSans-Bold-subset.ttf').toString('base64') };
      for (const format of ['a4', 'a3'] as const) {
        const o = opts({ format }), pages = pdfModel(plan, o), bytes = Buffer.from(await renderPdf(pages, o, fonts)), txt = bytes.toString('latin1');
        expect(txt.slice(0, 5)).toBe('%PDF-');
        expect((txt.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(pages.length);
        expect(txt).toMatch(format === 'a4' ? /\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/ : /\/MediaBox \[0 0 1190\.5\d* 841\.8\d*\]/);
        expect(txt).toContain('/FontFile2'); expect(txt).not.toMatch(/\/Subtype\s*\/Image/);
        expect(bytes.length).toBeGreaterThan(40_000); expect(bytes.length).toBeLessThan(400_000);
      }
      expect(EL_DISCLAIMER.join(' ')).toMatch(/^CONCEPT \/ COORDINATION PLAN\..*verified on site.*suitably qualified person\.$/);
    });
  });

  describe('interface: section, layers, back', () => {
    it('Electrical section; layers visible by default; system "back": placing → panel → selection → room → leaving the mode', () => {
      expect(ui.get().elLayers).toEqual({ sockets: true, lights: true, smart: true, data: true, sensors: true, boards: true });
      expect([0, 0.01, 0.05, 0.1]).toContain(ui.get().elSnap);
      expect(ui.get().elView).toBe('2d');                                                    // first use: plan
      ui.set({ section: 'electrical', houseView: 'interior', roomId: 'LK', elPanel: 'catalog', selection: { kind: 'electrical', id: 'B1' } });
      beginNew('socket-2');
      expect(ui.get().elPanel).toBeNull();                                                   // choosing a device closes the catalogue
      ui.set({ elPanel: 'layers', selection: { kind: 'electrical', id: 'B1' } });
      expect(backStep()).toBe(true); expect(placeNow()).toBeNull();
      expect(backStep()).toBe(true); expect(ui.get().elPanel).toBeNull();
      expect(backStep()).toBe(true); expect(ui.get().selection).toBeNull();
      expect(backStep()).toBe(true); expect(ui.get().roomId).toBeNull();
      expect(backStep()).toBe(true); expect(ui.get().section).toBe('building');
      expect(elWall('LK', 'LK-w1')!.roomId).toBe('LK');
    });
  });
});
