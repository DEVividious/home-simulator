// Walk motion input: diagonally (W + D) the user used to walk 2.92 m in 1 s instead of 2.00 m (the "forward" and "side"
// components were clamped separately and summed — a vector of length √2). The input is clamped to the unit circle.
import { describe, expect, it } from 'vitest';
import { walkInputVector } from '../model/walk';
import { approach, keyClear, keyDown, keyInput, keyUp, PAD, padInput, TAP_MS, walkKeys } from '../scene/walkInput';

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

describe('walk: a short key tap walks a short step (usability issue A4)', () => {
  it('a tapped key counts as held for TAP_MS after the press, a held key until it is released', () => {
    const k = walkKeys();
    keyDown(k, 'KeyW', 1000); keyUp(k, 'KeyW');
    expect(keyInput(k, 1010).f).toBe(1);
    expect(keyInput(k, 1000 + TAP_MS - 1).f).toBe(1);
    expect(keyInput(k, 1000 + TAP_MS + 1).f).toBe(0);
    keyDown(k, 'KeyA', 2000);
    expect(keyInput(k, 9000).s).toBe(-1);                       // held: no time limit
    keyUp(k, 'KeyA');
    expect(keyInput(k, 9001).s).toBe(0);
  });
  it('auto-repeat does not extend the tap; Shift runs only while held; clear forgets taps', () => {
    const k = walkKeys();
    keyDown(k, 'KeyS', 0); keyDown(k, 'KeyS', 300, true); keyUp(k, 'KeyS');
    expect(keyInput(k, TAP_MS + 1).f).toBe(0);
    keyDown(k, 'ShiftLeft', 0);
    expect(keyInput(k, 5000).run).toBe(true);
    keyUp(k, 'ShiftLeft');
    expect(keyInput(k, 100).run).toBe(false);
    keyDown(k, 'ArrowUp', 0); keyClear(k);
    expect(keyInput(k, 10).f).toBe(0);
  });
});

describe('walk: joystick response (usability issue A4 — the pad was slow)', () => {
  it('inside the dead zone nothing; just past it 40 % of the walking speed, not a crawl', () => {
    expect(padInput(0.05, -0.05)).toEqual({ f: 0, s: 0, run: false });
    const p = padInput(0, -(PAD.dead + 0.01));
    expect(p.f).toBeGreaterThan(PAD.start - 0.01); expect(p.f).toBeLessThan(PAD.start + 0.05); expect(p.run).toBe(false);
  });
  it('full speed and running at the outer ring; direction kept (up the screen = forward, right = right)', () => {
    const p = padInput(0, -1);
    expect(p.f).toBeCloseTo(1, 12); expect(p.s).toBeCloseTo(0, 12); expect(p.run).toBe(true);
    const d = padInput(0.5, 0.5);                                   // down-right: back and right, equal parts
    expect(d.f).toBeCloseTo(-d.s, 12); expect(d.s).toBeGreaterThan(0); expect(len([d.f, d.s])).toBeLessThanOrEqual(1);
    expect(padInput(NaN, 0)).toEqual({ f: 0, s: 0, run: false });
  });
});

describe('walk: a door clicked from far away is walked up to (usability issue A4)', () => {
  it('steps straight towards the target, never past the reach, then arrives', () => {
    let p: [number, number] = [0, 0], yaw = 0, arrived = false, n = 0;
    const to = { p: [0, 5] as [number, number], reach: 1.4 };
    while (!arrived && n++ < 200) {
      const a = approach(p, yaw, to, 0.1, 1 / 30);
      p = [p[0] + a.mx, p[1] + a.my]; yaw = a.yaw; arrived = a.arrived;
    }
    expect(arrived).toBe(true);
    expect(Math.hypot(to.p[0] - p[0], to.p[1] - p[1])).toBeCloseTo(1.4, 9);
    expect(p[0]).toBeCloseTo(0, 12);
  });
  it('the view turns towards the target (forward = (−sin yaw, cos yaw))', () => {
    let yaw = 0;
    for (let i = 0; i < 60; i++) yaw = approach([0, 0], yaw, { p: [-3, 0], reach: 1 }, 0, 1 / 30).yaw;
    expect(-Math.sin(yaw)).toBeCloseTo(-1, 3); expect(Math.cos(yaw)).toBeCloseTo(0, 3);
  });
});
