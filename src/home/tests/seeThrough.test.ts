import { describe, expect, it } from 'vitest';
import { SEE_THROUGH, seeUniforms, setSeeThroughTarget } from '../three/seeThrough';
import { shellBounds } from '../model/shell';

describe('tree see-through cone follows the project bounds', () => {
  it('aims at the centre of the bounds (three.js: x, height, −y) with a radius from the plan diagonal', () => {
    setSeeThroughTarget({ min: [0, 0, -0.2], max: [12, 8, 6] });
    expect(SEE_THROUGH.focus.toArray()).toEqual([6, 2.9, -4]);
    expect(SEE_THROUGH.radius).toBeCloseTo(0.55 * Math.hypot(12, 8), 6);
    expect(seeUniforms.uSeeFocus.value.toArray()).toEqual([6, 2.9, -4]);
    expect(seeUniforms.uSeeRadius.value).toBe(SEE_THROUGH.radius);
  });
  it('works for the active project shell', () => {
    const b = shellBounds();
    setSeeThroughTarget(b);
    expect(SEE_THROUGH.focus.x).toBeCloseTo((b.min[0] + b.max[0]) / 2, 6);
    expect(SEE_THROUGH.radius).toBeGreaterThan(3);
  });
});
