// The STL check of the skill dialog's hidden checker (ADR 0046): a closed box passes, a box with a missing or a flipped triangle
// does not; the size and the bed fit (turned by 90° when that helps).
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain ES module of the scripts (no types)
import { fitsBed, stlCheck } from './lib.mjs';

type V = [number, number, number];
function stl(tris: V[][]): Buffer {
  const b = Buffer.alloc(84 + tris.length * 50);
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((x, c) => b.writeFloatLE(x, 84 + i * 50 + 12 + k * 12 + c * 4))));
  return b;
}
/** a closed box w × d × h, outward triangles */
function box(w: number, d: number, h: number): V[][] {
  const p = (x: number, y: number, z: number): V => [x * w, y * d, z * h];
  const q = (a: V, b: V, c: V, e: V): V[][] => [[a, b, c], [a, c, e]];
  return [
    ...q(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)), ...q(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)),
    ...q(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), ...q(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)),
    ...q(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), ...q(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)),
  ];
}

describe('usability: STL check of the skill dialog', () => {
  it('a closed box: closed, no degenerate triangles, its size', () => {
    expect(stlCheck(stl(box(150, 90, 40)))).toEqual({ ok: true, triangles: 12, closed: true, openEdges: 0, degenerate: 0, size: [150, 90, 40] });
  });
  it('a missing triangle or a flipped one opens the surface; not an STL is said so', () => {
    expect(stlCheck(stl(box(10, 10, 10).slice(1))).closed).toBe(false);
    const t = box(10, 10, 10); t[3] = [t[3][0], t[3][2], t[3][1]];
    expect(stlCheck(stl(t)).ok).toBe(false);
    expect(stlCheck(Buffer.from('solid x\nendsolid x\n')).ok).toBe(false);
  });
  it('bed fit: turned by 90° when that helps, the height never', () => {
    expect(fitsBed([230, 150, 40], [220, 220, 250])).toBe(false);
    expect(fitsBed([200, 210, 40], [220, 220, 250])).toBe(true);
    expect(fitsBed([150, 210, 40], [210, 160, 250])).toBe(true);
    expect(fitsBed([100, 100, 260], [220, 220, 250])).toBe(false);
  });
});
