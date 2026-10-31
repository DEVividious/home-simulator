// Horizontal sections of a solid: the polygons and the area cut at a height (the wall mass of the plan views, the thin-wall
// checks of the print export).
import type { Vec2 } from '../package/types.ts';
import type { Keep } from './scope.ts';
import type { CrossSection, Manifold } from './wasm.ts';

/** a cross-section as loops: outer loops counter-clockwise, holes clockwise */
const loops = (cs: CrossSection): Vec2[][] => cs.toPolygons().map((p) => p.map((q) => [q[0], q[1]] as Vec2));

/** section of a solid at height z: outer loops counter-clockwise, holes clockwise */
export function sectionAt(keep: Keep, m: Manifold, z: number): { polygons: Vec2[][]; area: number } {
  const cs = keep(m.slice(z));
  return { polygons: loops(cs), area: cs.area() };
}

/** height of the lower section above the floor: below every sill, above the slab and the stair shaft [m] */
export const LOW_CUT = 0.05;

/** the wall mass of a level in plan: the sections of its solid just above the floor and at the plan's cut height, united — the
 *  lower one closes the windows and keeps the walls under a roof that comes down below the cut, the upper one closes the doors;
 *  an opening open at both heights (a passage up to the ceiling) stays open. Outer loops counter-clockwise, holes clockwise */
export function wallSection(keep: Keep, m: Manifold, floor: number, cut: number): Vec2[][] {
  return loops(keep(keep(m.slice(floor + LOW_CUT)).add(keep(m.slice(Math.max(floor + LOW_CUT, cut))))));
}
