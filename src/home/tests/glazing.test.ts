// Gable windows as the user chooses them (model/glazing.ts): the bars of a quick choice and of placed bars, a glazing split by a
// partition, the view from outside, each part's bars in its own frame, the defaults, the validation of the variant.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { building } from '@home-sim/core/model/building';
import { levelSolid } from '@home-sim/core/solid/levels';
import { scoped } from '@home-sim/core/solid/scope';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { withProject } from '../../project/active';
import { barsFor, choiceOf, DEFAULT_FRAME, DOOR_TRANSOM, glazingErrors, glazingShapes, layoutOf, placedOf, type GlazingShape, type ResolvedChoice } from '../model/glazing';
import { variantExtrasErrors, sameDesign, type Variant } from '../model/variantData';

const root = path.resolve(__dirname, '../../..');
const planOf = (id: string) => JSON.parse(fs.readFileSync(path.join(root, `packages/core/tests/fixtures/${id}.plan.json`), 'utf8'));
let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

// a pentagon 4 m wide (along 10…14), 3 m high at its apex, standing 0.9 m above a floor at 3.0; a bar drawn at 12
const G: GlazingShape = { group: 'G', ids: ['G'], roomIds: ['R'], level: 'L', floorZ: 3, parts: [{ id: 'G', poly: [[10, 3.9], [14, 3.9], [14, 5.4], [12, 6.9], [10, 5.4]] }],
  s0: 10, s1: 14, z0: 3.9, z1: 6.9, gaps: [], drawn: [12], axis: [1, 0], flip: false };
const pick = (c: Partial<ResolvedChoice>): ResolvedChoice => ({ ...choiceOf(null, 'G'), ...c });

describe('gable window choices', () => {
  it('no choice: the project look — default frame colour, the bars as drawn, no cross bar', () => {
    expect(choiceOf(null, 'G')).toEqual({ color: DEFAULT_FRAME, bars: 'project', transom: 'none', cols: null, rows: null });
    expect(layoutOf(G, choiceOf(undefined, 'G'))).toEqual({ cols: [12], rows: [] });
  });
  it('quick choice: panes evenly over the width; a cross bar at door height above the floor or half way up', () => {
    expect(layoutOf(G, pick({ bars: 3 })).cols).toEqual([11, 12, 13]);
    expect(layoutOf(G, pick({ bars: 0, transom: 'door' }))).toEqual({ cols: [], rows: [{ z: 3 + DOOR_TRANSOM }] });
    expect(layoutOf(G, pick({ bars: 1, transom: 'half' })).rows[0].z).toBeCloseTo(5.4, 9);
    expect(layoutOf({ ...G, floorZ: 0.5 }, pick({ transom: 'door' })).rows).toEqual([]);       // below the glazing
  });
  it('placed bars: fractions as seen from outside, the cross bar of one pane bounded by the bars around it', () => {
    const l = layoutOf(G, pick({ cols: [0.25, 0.6], rows: [{ h: 0.5 }, { h: 0.2, at: 0.8 }] }));
    expect(l.cols).toEqual([11, 12.4]);
    expect(l.rows[0]).toEqual({ z: 5.4 }); expect(l.rows[1].z).toBeCloseTo(4.5, 9); expect(l.rows[1].s0).toBe(12.4); expect(l.rows[1].s1).toBe(14);
    // seen from outside the other way round (along runs right to left): the same fractions from the other end
    const m = layoutOf({ ...G, flip: true }, pick({ cols: [0.25], rows: [{ h: 0.2, at: 0.1 }] }));
    expect(m.cols).toEqual([13]); expect(m.rows[0].s0).toBe(13); expect(m.rows[0].s1).toBe(14);
    // and back: a layout kept as placed bars gives the same bars
    expect(placedOf(G, l)).toEqual({ cols: [0.25, 0.6], rows: [{ h: 0.5 }, { h: 0.2, at: 0.8 }] });
    const again = layoutOf(G, pick(placedOf(G, l)));
    expect(again.cols).toEqual(l.cols); expect(again.rows[1].s0).toBe(12.4);
  });
  it('a glazing split by a partition is divided over its whole width; the partition counts as one of the divisions', () => {
    const S: GlazingShape = { ...G, s0: 0, s1: 4.705, gaps: [3.2075], drawn: [] };
    const cols = (bars: 1 | 2 | 3) => layoutOf(S, pick({ bars })).cols;
    expect(cols(1)).toEqual([]);                                                   // 2 panes: the partition alone
    expect(cols(2)).toHaveLength(1); expect(cols(2)[0]).toBeCloseTo(4.705 / 3, 9);  // 3 panes: one bar more
    expect(cols(3)).toHaveLength(2);
    // a cross bar of one pane stops at the partition
    const r = layoutOf(S, pick({ bars: 0, rows: [{ h: 0.5, at: 0.9 }] })).rows[0];
    expect(r.s0).toBe(3.2075); expect(r.s1).toBe(4.705);
  });
  it('the variant keeps valid choices only, and they make a different design', () => {
    expect(glazingErrors({ G: { color: '#a5713f', bars: 2, transom: 'half', cols: [0.3], rows: [{ h: 0.4, at: 0.5 }] } })).toEqual([]);
    expect(glazingErrors({ G: { color: 'red', bars: 7, transom: 'top', cols: [1.2], rows: [{ h: 0 }] } })).toHaveLength(5);
    const v: Variant = { id: 'v', name: 'v', interiors: {} };
    expect(variantExtrasErrors({ ...v, glazing: { G: { bars: 'project' } } })).toEqual([]);
    expect(sameDesign(v, { ...v, glazing: { G: { color: '#ffffff' } } })).toBe(false);
  });
});

describe('gable windows of a compiled project', () => {
  it('read from the package, seen from outside, and each part gets its bars in its own frame (the shell window)', () => {
    // roof-gable-y: the walls along X are gables — a pentagon with an off-centre bar in the south and in the north gable
    const p0 = compilePlan(planOf('roof-gable-y'), { catalog: null }).project!, b0 = building(p0.building), room = b0.rooms.find((r) => r.ceiling.kind === 'roof')!;
    const [x0, y0, x1, y1] = room.bbox, xm = (x0 + x1) / 2, h = (x: number, y: number) => room.ceiling.heightAt(x, y);
    const outline = (y: number) => [[xm - 0.5, 0.3], [xm - 0.5, h(xm - 0.5, y) - 0.15], [xm, h(xm, y) - 0.15], [xm + 0.5, h(xm + 0.5, y) - 0.15], [xm + 0.5, 0.3]];
    const plan = planOf('roof-gable-y');
    plan.windows = [...(plan.windows ?? []), { id: 'WS', room: room.id, at: [xm, y0], outline: outline(y0 + 0.01), mullions: [xm + 0.2] }, { id: 'WN', room: room.id, at: [xm, y1], outline: outline(y1 - 0.01), mullions: [xm + 0.2] }];
    const r = compilePlan(plan, { catalog: null });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    withProject(r.project!, () => {
      const shapes = glazingShapes(), S = shapes.find((g) => g.group === 'WS')!, N = shapes.find((g) => g.group === 'WN')!;
      // from the south, east (+x) is on the right; from the north, on the left
      expect(S.flip).toBe(false); expect(N.flip).toBe(true);
      expect(S.drawn).toEqual([xm + 0.2]); expect(S.s1 - S.s0).toBeCloseTo(1, 6);
      expect(placedOf(S, layoutOf(S, choiceOf(null, 'WS'))).cols).toEqual([0.7]);
      expect(placedOf(N, layoutOf(N, choiceOf(null, 'WN'))).cols).toEqual([0.3]);
      scoped((keep) => {
        const ws = levelSolid(geo, keep, building(r.project!.building), room.level)!.windows;
        for (const g of [S, N]) {
          const w = ws.find((x) => x.id === g.group)!, bars = barsFor(w, g, layoutOf(g, choiceOf(null, g.group)));
          expect(bars.at[0]).toBeCloseTo(w.mullions![0], 6);                           // the drawn bar lands where the shell has it
          const row = barsFor(w, g, layoutOf(g, { ...choiceOf(null, g.group), rows: [{ h: 0.25, at: 0.9 }] })).rows[0];
          expect(row.t).toBeCloseTo(0.25 * (g.z1 - g.z0) + g.z0 - w.z0, 6);
          expect(row.s1! - row.s0!).toBeCloseTo(g.flip ? 0.7 : 0.3, 6);                  // the pane right of the bar, seen from outside
        }
      });
    });
  });
});
