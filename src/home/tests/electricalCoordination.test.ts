// ELECTRICAL mode review: regression tests for defects reproduced in the product (B-xx labels as in the review report).
// Each test describes the EXPECTED behaviour. Demo apartment (one level, no site) for the room / store cases; the sample
// house (two levels, site) for exterior points, level changes and the site plan.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultDoc, docErrors, parseDoc, serializeDoc } from '../../document/model';
import { initHistory } from '../../history/history';
import { setLang, t } from '../../i18n';
import { activateProject, withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import type { ProjectPackage } from '../../project/types';
import { addElectrical, patchElectrical, planNow, removeElectrical, setElHeight, setElLevel, setElView } from '../actions';
import {
  addPoint, BOARD_KINDS, defaultPlan, distText, EL_DISCLAIMER, EL_LAYER_IDS, EL_STATUS, EL_TYPE_IDS, EL_TYPES, elRoom, EXT, heightText, nextId, parseHeightCm, PDF_GROUPS, planErrors, pointShown, PURPOSES, removePoint, rowOf,
  SMART_MODES, TABLE_COLUMNS, toCsv, toJson, type ElectricalPlan, type ElLayer, type ElPoint, type Placement,
} from '../model/electrical';
import { dragAim, EYE_LEVEL_FOV, eyeLevelPitch, heightRange, maxHeightAt, placementOnLevel, surfaceFromDrag, surfaceFromPlan } from '../model/elPlacement';
import { allRooms } from '../model/rooms';
import type { Vec2 } from '../model/types';
import { HOW_TO_READ, legendLayout, pageLayout, pdfModel, pdfTexts, renderPdf, splitTallRow, type PdfOptions } from '../pdf/electricalPdf';
import { fontCodePoints, PDF_CHAR_MAP, pdfReplaced, pdfSafe } from '../pdf/pdfText';
import { buildPlan, pointsOfView, shiftIntoView } from '../plan/elPlan';
import { planAim } from '../scene/electricalInput';
import { design, redo, undo } from '../store/design';
import { beginMove, beginNew, cancelPlace, commitPlace, currentWall, placeAt, placeNow } from '../store/elPlace';
import { ui } from '../store/ui';
import { setElLayers } from '../ui/ElectricalPanels';

const root = path.resolve(__dirname, '..', '..', '..');
const readProject = (id: string) => readProjectDir(path.join(root, 'projects', id));
/** socket id G<n> (built from parts: the bare quoted ids collide with a genericity-audit pattern) */
const g = (n: number) => `G${n}`;
const demo = readProject('demo-apartment'), house = readProject('sample-house');
/** activates the sample house for the enclosing describe block (and the demo apartment back afterwards) */
const inHouse = (): void => { beforeAll(() => { activateProject(house); }); afterAll(() => { activateProject(demo); }); };

const ALL_ON = Object.fromEntries(EL_LAYER_IDS.map((l) => [l, true])) as Record<ElLayer, boolean>;
const past = () => design.get().history.past.length, future = () => design.get().history.future.length, doc = () => design.get().history.present;
const reset = (level = 'L1') => {
  cancelPlace();
  design.set({ history: initHistory(defaultDoc()), draft: null });
  ui.set({ section: 'electrical', elView: '2d', elSite: false, level, roomId: null, houseView: 'interior', roomView: '3d', elSnap: 0.05, elMulti: false, selection: null, elHeights: {}, elPanel: null, elMore: false, elLayers: ALL_ON });
};
const onWall = (roomId: string, wallId: string, t: number, h = 0.3): Placement => ({ roomId, wallId, positionAlongWall: t, heightAFFL: h, orientation: 'wall' });
const free = (roomId: string, x: number, y: number, h: number, orientation: ElPoint['orientation'] = 'free'): Placement => ({ roomId, wallId: null, positionAlongWall: 0, heightAFFL: h, orientation, x, y });
const pt = (id: string, at: Placement, type: ElPoint['type'] = 'socket-1', extra: Partial<ElPoint> = {}): ElPoint => ({ id, type, ...at, modules: 1, label: '', smartHome: 'none', source: 'user', status: 'planned', ...extra });
const point = (id: string) => planNow().points.find((p) => p.id === id)!;
/** pointer move in plan (as ui/ElectricalPlan.tsx): spot from the engine → transient state */
const drag = (q: Vec2, view = 'L1') => { const s = placeNow()!; placeAt(surfaceFromPlan(view, q, s.type, currentWall()), [0, 0]); };
/** simple CSV reader (semicolon, quotes) */
const csvRows = (text: string): string[][] => {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ';') { row.push(cur); cur = ''; } else if (c === '\r') continue; else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; }
  return rows;
};
/** Polish letters (the Polish UI dictionary is printed with the same embedded font) */
const PL_LETTERS = '\u0104\u0106\u0118\u0141\u0143\u00D3\u015A\u0179\u017B\u0105\u0107\u0119\u0142\u0144\u00F3\u015B\u017A\u017C';

// Demo apartment, living room R1 (x 2.52…8.7, y 0.3…3.9): R1-w1 south (y 0.3), R1-w2 east (x 8.7, from the SE corner up),
// R1-w3 north (y 3.9, partition to the bedroom R2 at y 4.02), R1-w4 west (x 2.52, partition to the hallway R4 at x 2.4).
describe('B-04 / B-06: plan — an existing device is dragged with a fixed grip, not lifted above the finger', () => {
  // screen → plan as in ui/ElectricalPlan.tsx: k metres per pixel, screen Y axis down; S — plan → screen
  const view = (k: number) => ({ M: (s: [number, number]): Vec2 => [s[0] * k, 20 - s[1] * k], S: (q: Vec2): [number, number] => [q[0] / k, (20 - q[1]) / k] });
  const wallOf = (s: ReturnType<typeof surfaceFromPlan>) => (s && s.kind === 'wall' ? `${s.room.id}/${s.wall.id}` : null);
  const tOf = (s: ReturnType<typeof surfaceFromPlan>) => (s && s.kind === 'wall' ? s.t : NaN);
  it('aim point on screen: existing device = pointer + grip vector (mouse and finger alike, symmetric); a new device / copy led by a finger — above the finger', () => {
    const grab: [number, number] = [3, -5];                                                         // symbol centre − press point
    expect(planAim([200, 300], { kind: 'device', grab })).toEqual([203, 295]);
    expect(planAim([200, 250], { kind: 'device', grab })[1] - 295).toBe(-50); expect(planAim([200, 350], { kind: 'device', grab })[1] - 295).toBe(50);
    expect(planAim([200, 300], { kind: 'ghost', touch: true, moved: 0 })).toEqual([200, 300]);
    expect(planAim([200, 300], { kind: 'ghost', touch: true, moved: 20 })).toEqual([200, 272]);     // the lift grows (no jump)…
    expect(planAim([200, 300], { kind: 'ghost', touch: true, moved: 400 })).toEqual([200, 244]);    // …up to 56 px above the finger
    expect(planAim([200, 300], { kind: 'ghost', touch: false, moved: 400 })).toEqual([200, 300]);   // mouse: preview under the cursor
  });
  it('the pointer holds the symbol (offset into the room): the aim point is moved towards the current wall by that offset — at most up to the wall', () => {
    const cur = { roomId: 'R1', wallId: 'R1-w2' };                                                  // east wall, x = 8.7; interior on the −x side
    expect(dragAim([8.3, 2.0], cur, 0.4)[0]).toBeCloseTo(8.69, 6);                                  // symbol at its natural offset → 1 cm in front of the wall
    const a = dragAim([7.8, 2.0], cur, 0.4); expect(a[0]).toBeCloseTo(8.2, 9); expect(a[1]).toBe(2.0); // pointer deeper in the room: constant offset
    expect(dragAim([8.5, 2.0], cur, 0.4)[0]).toBeCloseTo(8.69, 6);                                  // pointer closer to the wall than the symbol: not past the wall
    expect(dragAim([8.8, 2.0], cur, 0.4)).toEqual([8.8, 2.0]);                                      // pointer behind the wall: the pointer decides
    expect(dragAim([7.8, 2.0], null, 0.4)).toEqual([7.8, 2.0]); expect(dragAim([7.8, 2.0], cur, 0)).toEqual([7.8, 2.0]);   // ceiling / no wall: unchanged
  });
  it('phone: a socket on the north wall, finger 60 px sideways — stays on its wall; vertical wall: 50 px up and down = the same distance', () => {
    const k = 0.0107, { M, S } = view(k), off = 0.21;                                               // room in focus: 1.07 cm / px, symbol 0.21 m from the wall
    const press = S([5.5, 3.9 - off]), cur = { roomId: 'R1', wallId: 'R1-w3' };
    for (let i = 1; i <= 30; i++) expect(wallOf(surfaceFromDrag('L1', M([press[0] - i * 2, press[1]]), 'socket-1', cur, off)), `step ${i}`).toBe('R1/R1-w3');
    const pressW = S([2.52 + off, 2.0]), curW = { roomId: 'R1', wallId: 'R1-w4' };
    const tAt = (dy: number) => { const s = surfaceFromDrag('L1', M([pressW[0], pressW[1] + dy]), 'socket-1', curW, off); expect(wallOf(s)).toBe('R1/R1-w4'); return tOf(s); };
    const t0 = tAt(0), up = tAt(-50), down = tAt(50);
    expect(Math.abs(up - t0)).toBeCloseTo(50 * k, 6); expect(Math.abs(down - t0)).toBeCloseTo(50 * k, 6); expect(Math.sign(up - t0)).toBe(-Math.sign(down - t0));
  });
  it('mouse: a socket 20 cm (and 5 cm) from a corner, grabbing the symbol and moving 8 px along the wall — stays on its wall and moves as far as the cursor', () => {
    const k = 0.0196, { M, S } = view(k), off = 0.39;                                               // the whole level on a desktop screen
    for (const t0 of [0.2, 0.05]) {
      // R1-w2 (x = 8.7) starts in the SE corner (8.7; 0.3); the symbol 0.39 m into the room — closer to the south wall than to its own
      const press = S([8.7 - off, 0.3 + t0]), cur = { roomId: 'R1', wallId: 'R1-w2' };
      expect(tOf(surfaceFromDrag('L1', M(press), 'socket-1', cur, off))).toBeCloseTo(t0, 6);        // the grip does not move the device
      for (let i = 1; i <= 8; i++) { const s = surfaceFromDrag('L1', M([press[0], press[1] - i]), 'socket-1', cur, off); expect(wallOf(s), `t0 ${t0}, step ${i}`).toBe('R1/R1-w2'); expect(tOf(s)).toBeCloseTo(t0 + i * k, 6); }
    }
  });
  it('pointer drift towards a thin partition does not move the device into the next room while the pointer is in the room; past the wall — it does', () => {
    const k = 0.0196, { M, S } = view(k), off = 0.39, cur = { roomId: 'R1', wallId: 'R1-w4' };     // 12 cm behind the west wall is the hallway (R4: x up to 2.4)
    const press = S([2.52 + off, 2.0]);
    for (const drift of [4, 8, 14, 19]) expect(wallOf(surfaceFromDrag('L1', M([press[0] - drift, press[1] - 30]), 'socket-1', cur, off)), `drift ${drift} px`).toBe('R1/R1-w4');
    expect(wallOf(surfaceFromDrag('L1', M([press[0] - 30, press[1] - 30]), 'socket-1', cur, off))).toBe('R4/R4-w2');   // the pointer is already in the hallway
  });
  it('going round a corner: the device stays on its wall until the symbol is clearly at the next one; then it lies under the pointer along the new wall', () => {
    const off = 0.39, cur = { roomId: 'R1', wallId: 'R1-w2' };
    expect(wallOf(surfaceFromDrag('L1', [8.225, 3.475], 'socket-1', cur, off))).toBe('R1/R1-w2');   // near the NE corner, symbol ≈ 0.43 m from both walls
    const next = surfaceFromDrag('L1', [7.5, 3.575], 'socket-1', cur, off);                         // symbol along the north wall, far from the east one
    expect(wallOf(next)).toBe('R1/R1-w3'); expect(tOf(next)).toBeCloseTo(8.7 - 7.5, 6);             // position = pointer projection (no shift by the symbol offset)
    expect(wallOf(surfaceFromDrag('L1', [7.5, 3.575], 'socket-1', { roomId: 'R1', wallId: 'R1-w3' }, off))).toBe('R1/R1-w3');   // and stays there (no flicker)
    // ceiling device: no wall — the spot under the pointer
    const lamp = surfaceFromDrag('L1', [6.0, 2.0], 'light', null, 0)!;
    expect(lamp.kind).toBe('area'); expect(lamp.room.id).toBe('R1');
  });
});

describe('B-14: phone — plan framing with the device card open', () => {
  it('the view shifts only as much as needed to keep the selected device in the plan field; inside the field — no shift', () => {
    expect(shiftIntoView(100, 293, 30, 36)).toBe(0);
    expect(shiftIntoView(297, 293, 30, 36)).toBe(40);                                               // below the bottom edge: content 40 px up (297 → 257)
    expect(shiftIntoView(10, 293, 30, 36)).toBe(-20);                                               // above the top: content 20 px down
    expect(shiftIntoView(100, 50, 30, 36)).toBe(70);                                                // field lower than the margins: to the top margin
  });
});

describe('B-03: a ceiling device pointed at inside a wall does not become an "Outside" point inside the building', () => {
  describe('sample house (with a site)', () => {
    inHouse();
    it('plan: inside a wall (within the building outline, outside rooms) there is no spot; outside the outline — a site point; in a room — the ceiling', () => {
      expect(surfaceFromPlan('L0', [3.36, 2.0], 'light')).toBeNull();                       // partition between the hall and the living room
      expect(surfaceFromPlan('L0', [9.85, 2.0], 'motion')).toBeNull();                      // exterior wall (inside the facade face)
      const out = surfaceFromPlan('L0', [12, 2], 'light')!;
      expect(out.kind).toBe('area'); expect(out.room.id).toBe(EXT);
      expect(surfaceFromPlan('L0', [6.0, 4.0], 'light')!.room.id).toBe('LK');
      // site plan: a ground point only outside the building (no "outside" point above a room either)
      expect(surfaceFromPlan('SITE', [14, 12], 'light')!.room.id).toBe(EXT);
      expect(surfaceFromPlan('SITE', [3.36, 2.0], 'light')).toBeNull(); expect(surfaceFromPlan('SITE', [6, 4], 'light')).toBeNull();
      expect(surfaceFromPlan('L1', [12, 2], 'light')).toBeNull();                           // the upper level does not open onto the site
    });
  });
  describe('demo apartment (no site)', () => {
    beforeEach(() => reset());
    it('inside a wall or outside the apartment there is no spot at all', () => {
      expect(surfaceFromPlan('L1', [2.46, 1.5], 'light')).toBeNull();                       // wall between the hallway and the living room
      expect(surfaceFromPlan('L1', [9.5, 2.0], 'light')).toBeNull();                        // outside: no site
      expect(surfaceFromPlan('L1', [6.0, 2.0], 'light')!.room.id).toBe('R1');
    });
    it('a lamp dropped inside a wall stays where it was (no history entry); a new lamp clicked in a wall is not created', () => {
      beginNew('light'); drag([6, 2]); const id = commitPlace()!;
      const before = { ...point(id) }, h0 = past();
      beginMove(id, { dragging: true }); drag([2.46, 1.5]);
      expect(placeNow()!.live).toBe(false);
      commitPlace();
      expect(point(id)).toEqual(before); expect(past()).toBe(h0);
      const n = planNow().points.length;
      beginNew('light'); drag([2.46, 2.5]);
      expect(placeNow()!.live).toBe(false); expect(placeNow()!.check.messages[0]).toBe('Point at a spot in the room.');
      expect(commitPlace()).toBeNull(); expect(planNow().points.length).toBe(n);
      cancelPlace();
    });
  });
});

describe('B-05 / B-13: height from the card — the same limits as when dragging; an empty field is not zero', () => {
  beforeEach(() => reset());
  /** demo apartment with a sloped ceiling in the bedroom: 2.60 m at the partition, falling towards the north wall (knee wall ≈ 1.26 m) */
  const sloped = (): ProjectPackage => {
    const p = structuredClone(demo) as ProjectPackage;
    p.building.rooms.rooms.find((r) => r.id === 'R2')!.ceiling = { kind: 'attic', flat_z: 2.6, ridge_y: 4.02, z_at_ridge: 2.6, slope: 0.5 } as never;
    return p;
  };
  it('height limits at the device spot: 5 cm … 5 cm below the ceiling / slope; facade and site without a ceiling', () => {
    const room = elRoom('R1')!, wall = room.walls.find((w) => w.id === 'R1-w2')!;
    expect(heightRange(pt('G1', onWall('R1', 'R1-w2', 1.5)))).toEqual([0.05, maxHeightAt(room, wall, 1.5)]);
    expect(heightRange(pt('G1', onWall('R1', 'R1-w2', 1.5)))[1]).toBeCloseTo(2.55, 2);             // living room ceiling 2.60 m
    expect(heightRange(pt('G3', free('R1', 6, 2, 0.1)))[1]).toBeCloseTo(elRoom('R1')!.ceilingAt(6, 2) - 0.05, 6);   // floor point in a room
    withProject(sloped(), () => {
      const r2 = elRoom('R2')!, knee = r2.walls.find((w) => w.id === 'R2-w3')!;                    // north wall, y = 6.7
      expect(heightRange(pt('W1', onWall('R2', 'R2-w3', 2.0), 'switch'))[1]).toBe(maxHeightAt(r2, knee, 2.0));
      expect(maxHeightAt(r2, knee, 2.0)).toBeLessThan(1.3); expect(maxHeightAt(r2, knee, 2.0)).toBeGreaterThan(1.2);
    });
    withProject(house, () => {
      expect(heightRange(pt(g(2), onWall(EXT, 'EXT-w4', 3.45, 0.4), 'socket-ext'))).toEqual([0.05, 6]);
      expect(heightRange(pt('L1', free(EXT, 14, 12, 0.3), 'light'))).toEqual([0.05, 6]);
    });
  });
  it('typed 999 cm, [+] at the ceiling, 0 and a negative value, a knee wall: the height stays within the room limits', () => {
    const id = addElectrical('socket-2', onWall('R1', 'R1-w2', 1.5))!, h = () => point(id).heightAFFL;
    setElHeight(id, 9.99); expect(h()).toBeCloseTo(2.55, 2);
    const hTop = h(), n = past();
    setElHeight(id, hTop + 0.05); expect(h()).toBe(hTop); expect(past()).toBe(n);                   // [+] at the ceiling: no change and no history entry
    setElHeight(id, 0); expect(h()).toBe(0.05);
    setElHeight(id, -0.2); expect(h()).toBe(0.05);
    withProject(sloped(), () => {
      const k = addElectrical('switch', onWall('R2', 'R2-w3', 2.0, 1.1))!;
      setElHeight(k, 2.0);
      expect(point(k).heightAFFL).toBeLessThan(1.3); expect(point(k).heightAFFL).toBeGreaterThan(1.2);
      expect(ui.get().elHeights.switch).toBe(point(k).heightAFFL);                                  // remembered type height = height after clamping
    });
  });
  it('height field text [cm]: empty, spaces only and non-numeric text — no value (no change); decimal comma', () => {
    expect(parseHeightCm('')).toBeNull(); expect(parseHeightCm('   ')).toBeNull(); expect(parseHeightCm('abc')).toBeNull(); expect(parseHeightCm('12abc')).toBeNull();
    expect(parseHeightCm('112')).toBeCloseTo(1.12, 9); expect(parseHeightCm(' 30 ')).toBeCloseTo(0.3, 9); expect(parseHeightCm('1,2')).toBeCloseTo(0.012, 9); expect(parseHeightCm('110.5')).toBeCloseTo(1.105, 9);
    expect(parseHeightCm('-20')).toBeCloseTo(-0.2, 9); expect(parseHeightCm('0')).toBe(0);
  });
});

describe('B-08: an exterior point placed on the site-level plan does not vanish from that plan', () => {
  inHouse();
  // L1 3 m east of the building (a site point), L2 1.5 m from the facade, L3 far in the garden; G1 in the living room
  const plan = (): ElectricalPlan => ({ version: 1, points: [pt('L1', free(EXT, 13, 4, 0.3), 'light'), pt('L2', free(EXT, 11.5, 4, 0.3), 'light'), pt('L3', free(EXT, 14, 12, 0.3), 'light'), pt('G1', onWall('LK', 'LK-w2', 1.5))] });
  const ids = (p: ElPoint[]) => p.map((x) => x.id).sort();
  it('screen: every exterior point on the site-level plan; print: as before only within 2.5 m of the building (the rest — on the "Site" page)', () => {
    const p = plan();
    expect(ids(pointsOfView(p, 'L0', EL_LAYER_IDS))).toEqual(['G1', 'L2']);
    expect(ids(pointsOfView(p, 'L0', EL_LAYER_IDS, true))).toEqual(['G1', 'L1', 'L2', 'L3']);
    expect(ids(pointsOfView(p, 'L1', EL_LAYER_IDS, true))).toEqual([]);
    expect(ids(pointsOfView(p, 'SITE', EL_LAYER_IDS, true))).toEqual(['L1', 'L2', 'L3']);
    expect(pointsOfView(p, 'L0', ['sockets'], true).map((x) => x.id)).toEqual(['G1']);             // layers filter as before
    expect(buildPlan({ view: 'L0', plan: p, layers: EL_LAYER_IDS, den: 100, labels: 'none', allExterior: true }).points.map((x) => x.id).sort()).toEqual(['G1', 'L1', 'L2', 'L3']);
    expect(buildPlan({ view: 'L0', plan: p, layers: EL_LAYER_IDS, den: 100, dims: 'auto' }).points.map((x) => x.id).sort()).toEqual(['G1', 'L2']);
    const pages = pdfModel(p, { format: 'a4', groups: ['all'], project: 'House', date: '2026-10-05', scope: 'shared plan' });
    expect(pages.map((x) => (x.kind === 'plan' ? `${x.view}:${x.count}` : 'table'))).toEqual(['L0:2', 'L1:0', 'SITE:3', 'table']);
  });
});

describe('B-12: a selection of a non-existent device (an undone addition) writes nothing', () => {
  beforeEach(() => reset());
  it('fresh project: removing / changing / setting the height of a missing point — no history entry, document unchanged, "Redo" kept', () => {
    const id = addElectrical('socket-2', onWall('R1', 'R1-w2', 1.5))!;
    undo();
    expect([past(), future()]).toEqual([0, 1]); expect(doc().electrical).toBeUndefined();
    ui.set({ selection: { kind: 'electrical', id } });                                              // the selection points at a point that is gone
    removeElectrical(id);
    expect([past(), future()]).toEqual([0, 1]); expect(doc().electrical).toBeUndefined(); expect(ui.get().selection).toBeNull();
    expect(patchElectrical(id, { label: 'x' }, 'label')).toBe(false);
    setElHeight(id, 1.1);
    expect([past(), future()]).toEqual([0, 1]); expect(doc().electrical).toBeUndefined();
    redo();
    expect(planNow().points.some((p) => p.id === id)).toBe(true);
    // an existing point: one history entry as before
    expect(patchElectrical(id, { label: 'by the desk' }, 'label')).toBe(true); expect(point(id).label).toBe('by the desk');
    removeElectrical(id); expect(planNow().points.some((p) => p.id === id)).toBe(false);
  });
});

describe('B-15: hiding the layer of the selected device', () => {
  it('a device is shown when it exists and its layer is on', () => {
    const plan: ElectricalPlan = { version: 1, points: [pt('G1', onWall('R1', 'R1-w2', 1.5)), pt('L1', free('R1', 6, 2, 2.6, 'ceiling'), 'light')] };
    expect(pointShown(plan, 'G1', ALL_ON)).toBe(true);
    expect(pointShown(plan, 'G1', { ...ALL_ON, sockets: false })).toBe(false); expect(pointShown(plan, 'L1', { ...ALL_ON, sockets: false })).toBe(true);
    expect(pointShown(plan, 'G7', ALL_ON)).toBe(false);
  });
  it('turning off the layer of the selected device clears the selection (the card closes, Delete has nothing to delete); another layer — the selection stays', () => {
    reset();
    const sock = addElectrical('socket-2', onWall('R1', 'R1-w2', 1.5))!;
    ui.set({ selection: { kind: 'electrical', id: sock }, elMore: true });
    setElLayers({ ...ALL_ON, lights: false });
    expect(ui.get().selection).toEqual({ kind: 'electrical', id: sock }); expect(ui.get().elLayers.lights).toBe(false);
    setElLayers({ ...ALL_ON, sockets: false });
    expect(ui.get().selection).toBeNull(); expect(ui.get().elMore).toBe(false); expect(ui.get().elLayers.sockets).toBe(false);
    expect(planNow().points.some((p) => p.id === sock)).toBe(true);                                    // the device stays in the plan
    ui.set({ selection: { kind: 'electrical', id: sock } });
    setElLayers(Object.fromEntries(EL_LAYER_IDS.map((l) => [l, false])) as Record<ElLayer, boolean>);   // "Hide all"
    expect(ui.get().selection).toBeNull();
    ui.set({ elLayers: ALL_ON });
  });
});

describe('B-19: placement preview and a level change', () => {
  inHouse();
  beforeEach(() => reset('L0'));
  it('a spot pointed at on the previous level no longer applies (the session continues — a wall on the new level can be pointed at)', () => {
    beginNew('socket-2'); drag([9.4, 2.0], 'L0');
    expect(placeNow()!.at!.roomId).toBe('LK');
    setElLevel('L1');
    expect(placeNow()!.mode).toBe('new'); expect(placeNow()!.at).toBeNull(); expect(placeNow()!.live).toBe(false); expect(placeNow()!.info).toBeNull();
    expect(commitPlace()).toBeNull();                                                               // nothing is created without pointing
    cancelPlace();
  });
  it('the preview belongs to the view only on its own level (facade and site — the site-exit level; walk — every level)', () => {
    expect(placementOnLevel({ roomId: 'LK' }, 'L0')).toBe(true); expect(placementOnLevel({ roomId: 'LK' }, 'L1')).toBe(false);
    expect(placementOnLevel({ roomId: 'BR1' }, 'L1')).toBe(true); expect(placementOnLevel({ roomId: EXT }, 'L0')).toBe(true); expect(placementOnLevel({ roomId: EXT }, 'L1')).toBe(false);
    expect(placementOnLevel({ roomId: 'LK' }, null)).toBe(true);
  });
});

describe('B-18: the eye-level view starts with the socket line in frame', () => {
  /** position of the 30 cm line on the wall ahead in the frame: 0 — centre, 1 — bottom edge (vertical field of view) */
  const lineInFrame = (dist: number, eye: number, pitch: number, fov: number) => Math.tan(Math.atan2(eye - 0.3, dist) + pitch) / Math.tan((fov * Math.PI) / 360);
  it('the pitch depends on the distance to the wall: close up the view looks lower, from far almost level; the 30 cm line always in frame', () => {
    for (const d of [0.6, 1.0, 1.35, 2.0, 3.0, 5.0]) { const f = lineInFrame(d, 1.68, eyeLevelPitch(d, 1.68, 70), 70); expect(f, `wall ${d} m`).toBeGreaterThan(0.2); expect(f, `wall ${d} m`).toBeLessThan(0.92); }
    expect(lineInFrame(1.35, 1.68, eyeLevelPitch(1.35, 1.68, 70), 70)).toBeCloseTo(0.6, 2);         // above the bottom toolbar
    expect(eyeLevelPitch(5, 1.68, 70)).toBe(-0.05); expect(eyeLevelPitch(0.3, 1.68, 70)).toBe(-0.6);
    expect(lineInFrame(1.35, 1.68, -0.05, 70)).toBeGreaterThan(1);                                  // the old start: the socket out of frame
  });
  const everyRoom = (level: string) => {
    reset(level);
    for (const r of allRooms()) {
      ui.set({ section: 'electrical', elView: '3d', houseView: 'interior', roomId: r.id, level: r.level, roomView: '3d' });
      setElView('walk');
      const go = ui.get().walkGo, pose = go.pose!, f = [-Math.sin(pose.yaw), Math.cos(pose.yaw)];
      expect(ui.get().houseView).toBe('walk'); expect(go.fov).toBe(EYE_LEVEL_FOV);
      // distance to the wall ahead: the nearest intersection of the viewing direction with the room outline
      let dist = Infinity;
      for (const w of r.walls) { const den = f[0] * w.inward[0] + f[1] * w.inward[1]; if (den >= -1e-9) continue; const s = ((w.a[0] - pose.p[0]) * w.inward[0] + (w.a[1] - pose.p[1]) * w.inward[1]) / den, u = (pose.p[0] + f[0] * s - w.a[0]) * w.dir[0] + (pose.p[1] + f[1] * s - w.a[1]) * w.dir[1]; if (s > 0 && u >= -1e-6 && u <= w.length + 1e-6) dist = Math.min(dist, s); }
      expect(lineInFrame(dist, ui.get().eyeHeight, pose.pitch, go.fov!), `${r.id} ${r.label}: wall ${dist.toFixed(2)} m, pitch ${pose.pitch.toFixed(2)}`).toBeLessThan(0.95);
      setElView('3d');
    }
  };
  it('start in every room of the demo apartment: a socket 30 cm up on the wall ahead is in frame', () => { everyRoom('L1'); });
  describe('sample house', () => {
    inHouse();
    it('start in every room of both levels: a socket 30 cm up on the wall ahead is in frame', () => { everyRoom('L0'); });
  });
});

describe('B-22 / B-23: table and CSV', () => {
  it('a floor point in a room (e.g. a floor box) is not described as a ceiling point', () => {
    const floor = rowOf(pt('G9', free('R1', 6, 2, 0.1), 'socket-1', { purpose: 'floor box' }))!;
    expect(distText(floor)).toBe('floor — per plan'); expect(heightText(floor)).toBe('10 cm');
    expect(distText(rowOf(pt('L1', free('R1', 6, 2, 2.6, 'ceiling'), 'light'))!)).toBe('ceiling — per plan');
    expect(withProject(house, () => distText(rowOf(pt('L2', free(EXT, 14, 12, 0.3), 'light'))!))).toBe('x 14.00 / y 12.00 m');
  });
  describe('CSV numbers and formula-like text (sample house)', () => {
    inHouse();
    afterAll(() => setLang('en'));
    const plan = (): ElectricalPlan => ({ version: 1, points: [
      pt('G1', onWall('LK', 'LK-w2', 1.435), 'socket-2', { label: '=SUM(A1:A9)' }), pt(g(2), onWall('LK', 'LK-w2', 5.2), 'socket-1', { circuitLabel: '+L1', notes: '-20 deg outside' }),
      pt('G3', onWall('LK', 'LK-w2', 5.8), 'socket-1', { label: '@home; "x"' }), pt('L4', free(EXT, 5, -2.5, 0.3), 'light'),
    ] });
    it('X / Y / Z with the decimal separator of the UI language (English: point, Polish: comma); a negative number stays a number', () => {
      for (const [lang, sep] of [['en', '.'], ['pl', ',']] as const) {
        setLang(lang);
        const rows = csvRows(toCsv(plan()).replace(/^\uFEFF/, '')), xi = 15;
        expect(rows.every((r) => r.length === 18)).toBe(true);
        for (const r of rows.slice(1)) for (let c = xi; c < xi + 3; c++) expect(r[c], `${lang} ${r[0]} col ${c}`).toMatch(sep === '.' ? /^-?\d+(\.\d+)?$/ : /^-?\d+(,\d+)?$/);
        const g1 = rows.find((r) => r[0] === 'G1')!, l4 = rows.find((r) => r[0] === 'L4')!;
        expect(g1.slice(xi)).toEqual(['9.7', '1.735', '0.3'].map((v) => v.replace('.', sep)));
        expect(l4[xi + 1]).toBe(`-2${sep}5`);
      }
      setLang('en');
    });
    it('text starting with = + - @ is not a formula', () => {
      const rows = csvRows(toCsv(plan()).replace(/^\uFEFF/, '')), head = rows[0], cell = (id: string, col: string) => rows.find((r) => r[0] === id)![head.indexOf(col)];
      expect(cell('G1', 'Description')).toBe("'=SUM(A1:A9)"); expect(cell(g(2), 'Circuit')).toBe("'+L1"); expect(cell(g(2), 'Notes')).toBe("'-20 deg outside"); expect(cell('G3', 'Description')).toBe('\'@home; "x"');
      expect(cell('G1', 'Distance from left corner [cm]')).toMatch(/^\d+$/); expect(cell('G1', 'Height AFFL [cm]')).toBe('30');
    });
  });
});

describe('B-24: the number of a removed device does not come back', () => {
  beforeEach(() => reset());
  const three = () => { let p = defaultPlan(); for (let i = 0; i < 3; i++) p = addPoint(p, 'socket-1', onWall('R1', 'R1-w2', 0.5 + i)).plan; return p; };
  it('removing the LAST device: the next one gets the next number (a printed plan does not point at a different device)', () => {
    let p = removePoint(three(), 'G3');
    expect(nextId(p, 'socket-1')).toBe('G4'); expect(nextId(p, 'socket-2')).toBe('G4'); expect(nextId(p, 'switch')).toBe('W1');
    const a = addPoint(p, 'socket-2', onWall('R1', 'R1-w2', 3.0));
    expect(a.point.id).toBe('G4');
    p = removePoint(removePoint(a.plan, 'G4'), g(2));
    expect(nextId(p, 'socket-1')).toBe(g(5));
    expect(nextId(removePoint(removePoint(three(), 'G1'), g(2)), 'socket-1')).toBe('G4');           // removal in the middle — as before
  });
  it('storage: optional field, no version change — an old plan without it is valid and does not get it unless something is removed; a plan with it validates and round-trips', () => {
    expect(Object.keys(three())).toEqual(['version', 'points']);
    const p = removePoint(three(), 'G3'), d = { ...defaultDoc(), electrical: p };
    expect(planErrors(p)).toEqual([]); expect(docErrors(d)).toEqual([]);
    expect(parseDoc(serializeDoc(d)).electrical).toEqual(p);
    expect(nextId(parseDoc(serializeDoc(d)).electrical!, 'socket-1')).toBe('G4');
    expect(planErrors({ ...p, lastId: { G: -1 } }).join(' ')).toMatch(/lastId/); expect(planErrors({ ...p, lastId: [3] }).join(' ')).toMatch(/lastId/); expect(planErrors({ ...p, lastId: { G: 'x' } }).join(' ')).toMatch(/lastId/);
    expect(Object.keys(JSON.parse(toJson(p, { project: 'Demo', exportedAt: '', scope: '' })))).not.toContain('lastId');   // point export unchanged
  });
  it('in the app: Delete the last socket → a new socket gets the next number; Undo brings the removed one back under its number', () => {
    const ids = [0.5, 1.5, 2.5].map((x) => addElectrical('socket-1', onWall('R1', 'R1-w2', x))!);
    expect(ids).toEqual(['G1', g(2), 'G3']);
    removeElectrical('G3');
    expect(addElectrical('socket-1', onWall('R1', 'R1-w2', 3.0))).toBe('G4');
    undo(); undo();
    expect(planNow().points.map((p) => p.id).filter((x) => /^G\d+$/.test(x))).toEqual(['G1', g(2), 'G3']);
  });
});

describe('B-17: PDF — a character missing from the embedded font does not vanish without a trace', () => {
  const ttf = (f: string) => new Uint8Array(readFileSync(`src/home/pdf/fonts/${f}`));
  const reg = fontCodePoints(ttf('DejaVuSans-subset.ttf')), bold = fontCodePoints(ttf('DejaVuSans-Bold-subset.ttf')), has = (cp: number) => reg.has(cp) && bold.has(cp);
  const cp = (ch: string) => ch.codePointAt(0)!;
  afterAll(() => setLang('en'));
  it('the character set comes from the cmap table of the embedded TTF files: the same set in both weights, letters of the UI languages, technical signs; Ω ≈ € φ Δ μ ✓ ⚠ — missing', () => {
    expect(reg.size).toBeGreaterThan(300); expect([...bold].sort((a, b) => a - b)).toEqual([...reg].sort((a, b) => a - b));
    for (const ch of `AZaz09 ${PL_LETTERS}„”–—…°²³µ×±≤≥→←↑↓↔⌀•·`) expect(has(cp(ch)), ch).toBe(true);
    for (const ch of 'Ω≈€φΔμ✓⚠∠▽я🔌') expect(has(cp(ch)), ch).toBe(false);
  });
  it('texts the app prints itself (legend, table, disclaimer, room names) are fully in the font — in every UI language', () => {
    for (const lang of ['en', 'pl']) {
      setLang(lang);
      const own = [...EL_TYPE_IDS.flatMap((x) => [EL_TYPES[x].name, EL_TYPES[x].short, EL_TYPES[x].code]), ...TABLE_COLUMNS, ...HOW_TO_READ, ...EL_DISCLAIMER, ...Object.values(SMART_MODES), ...Object.values(EL_STATUS), ...Object.values(BOARD_KINDS), ...PURPOSES,
        ...Object.values(PDF_GROUPS).map((g) => g.name), t('electrical.ceilingPerPlan'), t('electrical.floorPerPlan'), t('mount.outside'), t('pdf.scaleInfo', { den: 100, format: 'A4', count: 12 }), t('pdf.pageOf', { n: 1, total: 4 }), `G1 ${t('pdf.continued')}`];
      for (const x of own) expect(pdfSafe(x, has).replaced, `${lang}: ${x}`).toEqual([]);
    }
    setLang('en');
    for (const pkg of [demo, house]) withProject(pkg, () => { for (const r of allRooms()) expect(pdfSafe(`${r.id} ${r.label} ${r.name}`, has).replaced, r.id).toEqual([]); });
  });
  it('known characters get a readable spelling, unknown ones "?", spaces and invisible characters are tidied without a report', () => {
    const r = pdfSafe('resistance 10 kΩ ≈ 3.7 kW €', has);
    expect(r.text).toBe('resistance 10 kOhm ~ 3.7 kW EUR'); expect(r.replaced).toEqual([['Ω', 'Ohm'], ['≈', '~'], ['€', 'EUR']]);
    expect(pdfSafe('cos φ = 0.9; Δ; μF', has).text).toBe('cos phi = 0.9; delta; µF');
    expect(pdfSafe('checked ✓ caution ⚠\uFE0F', has).text).toBe('checked OK caution (!)');          // emoji with a variation selector
    expect(pdfSafe('socket 🔌 lamp 💡', has)).toEqual({ text: 'socket ? lamp ?', replaced: [['🔌', '?'], ['💡', '?']] });
    expect(pdfSafe('розетка', has).text).toBe('???????');
    expect(pdfSafe('zo\u0301\u0142ty', has)).toEqual({ text: 'z\u00F3\u0142ty', replaced: [] });  // a letter with a separate accent (NFD) → one letter
    expect(pdfSafe('a\tb\u202Fc\u200Bd\r', has)).toEqual({ text: 'a b cd', replaced: [] });
    expect(pdfSafe('line 1\nline 2', has).text).toBe('line 1\nline 2');
    expect(pdfSafe(`${PL_LETTERS} — „x” 30 cm ±5°`, has)).toEqual({ text: `${PL_LETTERS} — „x” 30 cm ±5°`, replaced: [] });
  });
  it('every character of the reference string is in the font or has a spelling; the spellings can be printed; the result is stable when repeated', () => {
    for (const ch of [...`${PL_LETTERS} Ω Ω ≈ € φ Δ ∆ μ ✓ ⚠ ∅ ℃ ⇒ ₂ ≠`].filter((c) => c !== ' ')) { const r = pdfSafe(ch, has); expect(r.text, ch).not.toBe('?'); for (const c of r.text) expect(has(cp(c)), `${ch} → ${r.text}`).toBe(true); }
    for (const [from, to] of Object.entries(PDF_CHAR_MAP)) { expect(has(cp(from)), `"${from}" is in the font — spelling not needed`).toBe(false); for (const c of to) expect(has(cp(c)), `${from} → ${to}`).toBe(true); }
    const once = pdfSafe('10 kΩ ≈ 🔌', has).text;
    expect(pdfSafe(once, has)).toEqual({ text: once, replaced: [] });
  });
  it('export report: how many characters were replaced in the document texts (header counted once, table cells, drawing labels) and which', () => {
    const plan: ElectricalPlan = { version: 1, points: [pt('G1', onWall('R1', 'R1-w2', 1.5), 'socket-1', { label: '10 kΩ', notes: 'ok ✓ 🔌' }), pt(g(2), onWall('R1', 'R1-w2', 2.5), 'socket-1', { label: '10 kΩ' })] };
    const o: PdfOptions = { format: 'a4', groups: ['all'], project: 'Demo', date: '2026-10-05', scope: 'variant layout „Ω”' }, pages = pdfModel(plan, o), rep = pdfReplaced(pdfTexts(pages, o), has);
    expect(rep.count).toBe(5);                                                                      // Ω in the plan scope (once) + 2 × Ω in labels + ✓ + 🔌
    expect(rep.chars).toEqual([['Ω', 'Ohm'], ['✓', 'OK'], ['🔌', '?']]);
    expect(pdfReplaced(pdfTexts(pdfModel(defaultPlan(), { ...o, scope: 'shared plan' }), { ...o, scope: 'shared plan' }), has)).toEqual({ count: 0, chars: [] });
  });
  it('a PDF with such text is produced (a character without a glyph never reaches jsPDF)', async () => {
    const fonts = { regular: readFileSync('src/home/pdf/fonts/DejaVuSans-subset.ttf').toString('base64'), bold: readFileSync('src/home/pdf/fonts/DejaVuSans-Bold-subset.ttf').toString('base64') };
    const plan: ElectricalPlan = { version: 1, points: [pt('G1', onWall('R1', 'R1-w2', 1.5), 'socket-1', { label: '10 kΩ ≈ 3.7 kW €', notes: 'розетка 🔌' })] };
    const o: PdfOptions = { format: 'a4', groups: ['all'], project: 'Demo Ω', date: '2026-10-05', scope: 'shared plan' }, pages = pdfModel(plan, o);
    const bytes = Buffer.from(await renderPdf(pages, o, fonts));
    expect(bytes.toString('latin1').slice(0, 5)).toBe('%PDF-'); expect((bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(pages.length);
  });
});

describe('B-21: PDF — table and legend layout', () => {
  it('a table row taller than the page is split into parts that fit (no text lost); later parts carry "ID (cont.)"', () => {
    const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
    const row = [['G1'], ['R1 Living room'], lines(3, 't'), lines(120, 'u')];
    const parts = splitTallRow(row, 50);
    expect(parts).toHaveLength(3); expect(parts.map((p) => Math.max(...p.map((c) => c.length)))).toEqual([50, 50, 20]);
    expect(parts[0][0]).toEqual(['G1']); expect(parts[1][0]).toEqual(['G1', '(cont.)']); expect(parts[2][0]).toEqual(['G1', '(cont.)']);
    expect(parts.flatMap((p) => p[3])).toEqual(row[3]); expect(parts.flatMap((p) => p[2])).toEqual(row[2]); expect(parts[1][1]).toEqual([]);
    expect(splitTallRow(row, 120)).toEqual([row]); expect(splitTallRow([[g(2)], ['x']], 50)).toEqual([[[g(2)], ['x']]]);
  });
  it('legend: names wrap in the column; the "How to find a point" block only when it fits above the footer; the legend never overlaps the footer', () => {
    for (const format of ['a4', 'a3'] as const) {
      const L = pageLayout(format), top = L.m + L.head + 10.5 * L.k, bottom = L.h - L.m - L.foot - 2;
      const all = legendLayout(EL_TYPE_IDS.map((_, i) => (i === 10 ? 2 : 1)), L.k, top, bottom, HOW_TO_READ.length);        // 19 types, one name on two lines
      expect(all.ys).toHaveLength(EL_TYPE_IDS.length); expect(all.end).toBeLessThanOrEqual(bottom + 1e-9);
      for (let i = 1; i < all.ys.length; i++) expect(all.ys[i] - all.ys[i - 1]).toBeGreaterThanOrEqual(4.6 * L.k - 1e-9);
      expect(all.howTo).toBe(format === 'a3');                                                       // A4: 19 types fill the column — no help block
      const few = legendLayout([1, 1, 1, 1, 1, 1], L.k, top, bottom, HOW_TO_READ.length);
      expect(few.howTo).toBe(true); expect(few.ys[1] - few.ys[0]).toBeCloseTo(6.4 * L.k, 9); expect(few.end).toBeLessThanOrEqual(bottom);
    }
    // with more types than the column holds — the spacing shrinks, the legend stays above the footer
    const L = pageLayout('a4'), top = L.m + L.head + 10.5 * L.k, bottom = L.h - L.m - L.foot - 2, many = legendLayout(Array.from({ length: 30 }, () => 1), L.k, top, bottom, HOW_TO_READ.length);
    expect(many.howTo).toBe(false); expect(many.end).toBeLessThanOrEqual(bottom + 1e-9);
  });
});
