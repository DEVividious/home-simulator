// Pantry door flush with the built-in units (reported: "the flush pantry door does not open"): the leaf and the handle are
// the moving part of the item — separate geometry in the hinge-axis frame, rotating 90° into the pantry.
import { describe, expect, it } from 'vitest';
import { generatorOptions } from '../catalog/furniture';
import { generateParts, partMotion } from '../catalog/generators';
import { itemById } from '../catalog/providers';
import { furnitureGeometries, furnitureMovingGeometries } from '../three/furnitureGeometry';
import { isFurnitureOpen, setFurnitureOpen, toggleFurnitureOpen } from '../store/furnitureOpen';

const item = itemById('pantry-front')!, dims = item.dimensions;

describe('pantry door in built-in units: moving part of the item', () => {
  for (const variant of ['left', 'right']) {
    it(`variant "${variant}": leaf + handle move, hinge on the side opposite the handle, opens 90° into the pantry`, () => {
      const o = generatorOptions(item, variant), parts = generateParts('pantryFront', dims, o), mv = parts.filter((p) => p.move);
      expect(mv.map((p) => p.slot).sort()).toEqual(['front', 'metal']);
      const m = partMotion('pantryFront', dims, o)!, leaf = mv.find((p) => p.slot === 'front')!, handle = mv.find((p) => p.slot === 'metal')!;
      expect(Math.abs(m.angle)).toBe(90);
      // hinge at the leaf edge farther from the handle
      const hingeEdge = Math.abs(m.pivot[0] - (leaf.c[0] - leaf.s[0] / 2)) < Math.abs(m.pivot[0] - (leaf.c[0] + leaf.s[0] / 2)) ? leaf.c[0] - leaf.s[0] / 2 : leaf.c[0] + leaf.s[0] / 2;
      expect(Math.abs(handle.c[0] - hingeEdge)).toBeGreaterThan(leaf.s[0] * 0.8);
      expect(Math.abs(m.pivot[0]) + 0.03).toBeGreaterThan(dims.w / 2 - 0.03);        // at the side of the portal
      // the free end of the open leaf goes into the built-in depth (−y), not into the kitchen
      const free = (leaf.c[0] * 2 - hingeEdge) - m.pivot[0], a = (m.angle * Math.PI) / 180;
      expect(Math.sin(a) * free).toBeLessThan(-0.7);
    });
  }
  it('geometry: the fixed part without the leaf; the moving part in the hinge-axis frame (axis at the origin)', () => {
    const o = generatorOptions(item, 'right'), st = furnitureGeometries('pantryFront', dims, o), mv = furnitureMovingGeometries('pantryFront', dims, o)!;
    const tri = (g: { getAttribute: (n: string) => { count: number } }) => g.getAttribute('position').count / 3;
    const all = generateParts('pantryFront', dims, o);
    expect(tri(st.get('front')!) + tri(mv.geoms.get('front')!)).toBe(all.filter((p) => p.slot === 'front').length * 12);
    expect(mv.geoms.has('metal')).toBe(true);                                        // the handle moves with the leaf
    expect(all.filter((p) => p.move && p.slot === 'metal').length).toBe(1);
    const b = mv.geoms.get('front')!.boundingBox!;
    expect(Math.abs(b.max.x)).toBeLessThan(0.05);                                    // the leaf starts at the axis…
    expect(b.min.x).toBeLessThan(-0.8);                                              // …and reaches 0.9 m towards the handle
    expect(furnitureMovingGeometries('kitchenBase', { w: 0.6, d: 0.6, h: 0.87 }, {})).toBeNull();
  });
  it('open state is view state (not the document): toggled by item id', () => {
    expect(isFurnitureOpen('x')).toBe(false);
    toggleFurnitureOpen('x'); expect(isFurnitureOpen('x')).toBe(true);
    setFurnitureOpen('x', false); expect(isFurnitureOpen('x')).toBe(false);
  });
});
