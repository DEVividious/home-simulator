// Which object is "visible under the pointer" (scene/press.ts). R3F delivers a press to every object on the ray, including
// those behind a wall; the one that is visible reacts. Glass does not occlude: an item seen through glazing (room-view camera
// behind a wall with a glazed door) is visible, so it can be grabbed — a wall drawn in front of the item still occludes it.
import { describe, expect, it } from 'vitest';
import { isNearest, isNearestSolid } from '../scene/press';

type O = { name: string; visible: boolean; parent: O | null; material?: unknown };
const obj = (name: string, material?: unknown, visible = true, parent: O | null = null): O => ({ name, visible, parent, material });
const WALL = { name: 'MAT_Wall', transparent: false, opacity: 1 };
const GLASS_HIGH = { name: 'MAT_Ext_glass', transparent: false, opacity: 1, transmission: 1 };       // high profile: transmission
const GLASS_LOW = { name: 'MAT_Ext_glass', transparent: true, opacity: 0.3, transmission: 0 };       // other profiles: transparency
const ev = (object: O, ...order: O[]) => ({ object, intersections: order.map((o) => ({ object: o })) });

describe('object under the pointer', () => {
  const tv = obj('tv', { name: 'MAT_Furniture' }), wall = obj('wall', WALL);
  it('a wall drawn in front of the item occludes it: the item is neither nearest nor "nearest ignoring glass"', () => {
    expect(isNearest(ev(tv, wall, tv))).toBe(false);
    expect(isNearestSolid(ev(tv, wall, tv))).toBe(false);
  });
  it('glass in front of the item (both quality profiles) does not occlude it', () => {
    for (const g of [GLASS_HIGH, GLASS_LOW]) {
      const glass = obj('glass', g);
      expect(isNearest(ev(tv, glass, tv))).toBe(false);                        // plain rule: the glass is nearest
      expect(isNearestSolid(ev(tv, glass, tv))).toBe(true);
      expect(isNearestSolid(ev(tv, glass, glass, tv))).toBe(true);             // two panes (insulated glazing unit)
      expect(isNearestSolid(ev(tv, glass, wall, tv))).toBe(false);             // there is still a wall behind the glass
    }
  });
  it('a hidden object (itself or through an ancestor) does not occlude; a material in an array is recognised', () => {
    const hidden = obj('debug', WALL, false), child = obj('child', WALL, true, obj('group', undefined, false));
    expect(isNearestSolid(ev(tv, hidden, child, tv))).toBe(true);
    expect(isNearestSolid(ev(tv, obj('pane', [GLASS_LOW]), tv))).toBe(true);
  });
  it('a semi-transparent overlay with high opacity (≥ 0.6) occludes like a wall; no hits — the object is nearest', () => {
    expect(isNearestSolid(ev(tv, obj('haze', { transparent: true, opacity: 0.8 }), tv))).toBe(false);
    expect(isNearestSolid(ev(tv))).toBe(true);
  });
});
