// Gable windows as the user chooses them (model/glazing.ts): the bars of a choice, the defaults, the validation of the variant.
import { describe, expect, it } from 'vitest';
import type { ShellWindow } from '@home-sim/core/solid/openings';
import { barsOf, choiceOf, DEFAULT_FRAME, DOOR_TRANSOM, extentOf, glazingErrors } from '../model/glazing';
import { variantExtrasErrors, sameDesign, type Variant } from '../model/variantData';

// a pentagon 4 m wide, 3 m high at its apex, standing 0.9 m above a floor at 3.0
const W: ShellWindow = { id: 'G', roomId: 'R', wallId: 'R-w1', kind: 'glazing', a: [0, 0], dir: [1, 0], out: [0, -1], width: 4, z0: 3.9, z1: 6.9, depth: 0.4,
  outline: [[0, 0], [4, 0], [4, 1.5], [2, 3], [0, 1.5]], mullions: [2] };

describe('gable window choices', () => {
  it('no choice: the project look — default frame colour, the bars as drawn, no cross bar', () => {
    expect(choiceOf(null, 'G')).toEqual({ color: DEFAULT_FRAME, bars: 'project', transom: 'none' });
    expect(barsOf(W, choiceOf(undefined, 'G'), 3)).toEqual({ at: [2], transom: null });
  });
  it('panes evenly over the width; a cross bar at door height above the floor or half way up the apex', () => {
    expect(barsOf(W, { color: '#ffffff', bars: 3, transom: 'none' }, 3).at).toEqual([1, 2, 3]);
    expect(barsOf(W, { color: '#ffffff', bars: 0, transom: 'door' }, 3)).toEqual({ at: [], transom: 3 + DOOR_TRANSOM - 3.9 });
    const half = barsOf(W, { color: '#ffffff', bars: 1, transom: 'half' }, 3);
    expect(half.at).toEqual([2]); expect(half.transom).toBeCloseTo(1.5, 9);
    expect(barsOf(W, { color: '#ffffff', bars: 0, transom: 'door' }, 0.5).transom).toBeNull();   // below the glazing
  });
  it('a glazing split by a partition is divided over its whole width; the partition counts as one of the divisions', () => {
    // two parts of one 4.705 m glazing: 3.15 m and 1.44 m with an 11.5 cm partition between them (like a gable split by a wall)
    const L: ShellWindow = { ...W, id: 'L', width: 3.15, outline: [[0, 0], [3.15, 0], [3.15, 2.6], [0, 0.8]], mullions: [] };
    const R: ShellWindow = { ...W, id: 'R', a: [3.265, 0], width: 1.44, outline: [[0, 0], [1.44, 0], [1.44, 1.2], [0, 2.6]], mullions: [] };
    const whole = extentOf(L, [L, R]), pick = (bars: 1 | 2 | 3) => barsOf(L, { color: DEFAULT_FRAME, bars, transom: 'none' }, 3, whole).at;
    expect(whole.s0).toBe(0); expect(whole.s1).toBeCloseTo(4.705, 9); expect(whole.gaps[0]).toBeCloseTo(3.2075, 9);
    expect(pick(1)).toEqual([]);                                                   // 2 panes: the partition alone
    expect(pick(2)).toHaveLength(1); expect(pick(2)[0]).toBeCloseTo(4.705 / 3, 9);  // 3 panes: one bar more
    expect(pick(3)).toHaveLength(2);
    expect(extentOf(R, [L, R]).s0).toBeCloseTo(-3.265, 9);                          // in the frame of the other part
  });
  it('the variant keeps valid choices only, and they make a different design', () => {
    expect(glazingErrors({ G: { color: '#a5713f', bars: 2, transom: 'half' } })).toEqual([]);
    expect(glazingErrors({ G: { color: 'red', bars: 7, transom: 'top' } })).toHaveLength(3);
    const v: Variant = { id: 'v', name: 'v', interiors: {} };
    expect(variantExtrasErrors({ ...v, glazing: { G: { bars: 'project' } } })).toEqual([]);
    expect(sameDesign(v, { ...v, glazing: { G: { color: '#ffffff' } } })).toBe(false);
  });
});
