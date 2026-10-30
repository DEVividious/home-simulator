// Horizontal sections of a solid: the polygons and the area cut at a height (the level section of the plan views, the parity
// gate against the grid shell, and later the thin-wall checks of the print export).
import type { Vec2 } from '../package/types.ts';
import type { Keep } from './scope.ts';
import type { Manifold } from './wasm.ts';

/** section of a solid at height z: outer loops counter-clockwise, holes clockwise */
export function sectionAt(keep: Keep, m: Manifold, z: number): { polygons: Vec2[][]; area: number } {
  const cs = keep(m.slice(z));
  return { polygons: cs.toPolygons().map((p) => p.map((q) => [q[0], q[1]] as Vec2)), area: cs.area() };
}
