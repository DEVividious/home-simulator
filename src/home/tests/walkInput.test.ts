// Walk motion input: diagonally (W + D) the user used to walk 2.92 m in 1 s instead of 2.00 m (the "forward" and "side"
// components were clamped separately and summed — a vector of length √2). The input is clamped to the unit circle.
import { describe, expect, it } from 'vitest';
import { walkInputVector } from '../model/walk';

const len = (v: [number, number]) => Math.hypot(v[0], v[1]);

describe('walk: input vector (keys + joystick) clamped to the unit circle', () => {
  it('one direction: unchanged', () => {
    for (const [f, s] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]] as [number, number][]) expect(walkInputVector(f, s)).toEqual([f, s]);
  });
  it('two keys at once (diagonal): length 1 — the same speed as straight ahead, direction 45°', () => {
    for (const [f, s] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][]) {
      const v = walkInputVector(f, s);
      expect(len(v)).toBeCloseTo(1, 12);
      expect(v[0]).toBeCloseTo(f * Math.SQRT1_2, 12); expect(v[1]).toBeCloseTo(s * Math.SQRT1_2, 12);
    }
  });
  it('analogue joystick inside the unit circle: values unchanged (a slow step stays slow)', () => {
    for (const [f, s] of [[0.3, 0.2], [-0.5, 0.5], [0.6, -0.8], [0, 0.07]] as [number, number][]) expect(walkInputVector(f, s)).toEqual([f, s]);
  });
  it('key + joystick in the same direction or joystick in a corner: clamped to length 1, direction kept', () => {
    expect(walkInputVector(2, 0)).toEqual([1, 0]);
    const v = walkInputVector(1.6, 1.2);
    expect(len(v)).toBeCloseTo(1, 12); expect(v[0] / v[1]).toBeCloseTo(1.6 / 1.2, 12);
    const w = walkInputVector(1, 0.4);                       // W + joystick slightly tilted sideways
    expect(len(w)).toBeCloseTo(1, 12); expect(w[1] / w[0]).toBeCloseTo(0.4, 12);
  });
  it('non-numeric values do not break the step (no motion)', () => {
    expect(walkInputVector(NaN, 1)).toEqual([0, 0]); expect(walkInputVector(Infinity, 0)).toEqual([0, 0]);
  });
});
