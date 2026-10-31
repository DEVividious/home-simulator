// Previews without a browser (ADR 0035): the raster primitives, and the plan, roof and exterior pictures of every fixture —
// drawn, deterministic, with walls where the plan has them.
import { describe, expect, it } from 'vitest';
import { building } from '@home-sim/core/model/building';
import { exteriorImage } from '@home-sim/core/preview/exterior';
import { planImage, roofImage } from '@home-sim/core/preview/plan';
import { fillPolygon, image, line, shrink, type Image } from '@home-sim/core/print/raster';
import { loadGeometry } from '@home-sim/core/solid/wasm';
import { PACKAGES } from './packages';

const at = (img: Image, x: number, y: number) => [...img.rgb.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3)];
const count = (img: Image, c: number[]) => { let n = 0; for (let i = 0; i < img.rgb.length; i += 3) if (img.rgb[i] === c[0] && img.rgb[i + 1] === c[1] && img.rgb[i + 2] === c[2]) n++; return n; };

describe('raster primitives', () => {
  it('fills polygons by the even-odd rule, holes included', () => {
    const img = image(20, 20);
    fillPolygon(img, [[[2, 2], [18, 2], [18, 18], [2, 18]], [[6, 6], [14, 6], [14, 14], [6, 14]]], [0, 0, 0]);
    expect(count(img, [0, 0, 0])).toBe(16 * 16 - 8 * 8);
    expect(at(img, 10, 10)).toEqual([255, 255, 255]);
    fillPolygon(img, [[[0, 0], [4, 0], [4, 4], [0, 4]]], [255, 0, 0], 0.5);
    expect(at(img, 1, 1)).toEqual([255, 128, 128]);
  });

  it('draws lines of a width, dashed, and shrinks by averaging', () => {
    const img = image(40, 10);
    line(img, 0, 5, 40, 5, [0, 0, 0], 2);
    expect(count(img, [0, 0, 0])).toBe(80);
    const dashed = image(40, 10);
    line(dashed, 0, 5, 40, 5, [0, 0, 0], 2, [4, 4]);
    expect(count(dashed, [0, 0, 0])).toBeGreaterThan(30);
    expect(count(dashed, [0, 0, 0])).toBeLessThan(60);
    const s = shrink(img, 2);
    expect([s.width, s.height]).toEqual([20, 5]);
    expect(at(s, 3, 2)).toEqual([0, 0, 0]);
  });
});

describe('plan previews', () => {
  for (const [id, data] of Object.entries(PACKAGES)) it(`${id}: every level, the roof — the same bytes twice`, () => {
    const d = data(), levels = Object.keys(d.rooms.levels).filter((l) => d.rooms.rooms.some((r) => r.level === l));
    for (const l of levels) {
      const a = planImage(d, l, { name: id }), b = planImage(data(), l, { name: id });
      expect(Buffer.compare(Buffer.from(a.rgb), Buffer.from(b.rgb))).toBe(0);
      expect(count(a, [55, 65, 81]) + count(a, [255, 255, 255])).toBeGreaterThan(a.width * a.height * 0.2);
    }
    expect(roofImage(d, { name: id }) !== null).toBe(!!building(d).roof?.pieces.length);
  });

  it('draws the building from outside', async () => {
    const img = exteriorImage(await loadGeometry(), PACKAGES['sample-house'](), { title: 'sample' });
    expect([img.width, img.height]).toEqual([1440, 634]);
    expect(count(img, [250, 250, 248])).toBeLessThan(img.width * img.height * 0.85);
  });
});
