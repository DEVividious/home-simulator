// Wall mass of a level in plan — rectangles [x0, y0, x1, y1] that the plan views fill (openings are drawn on top). Today it
// is the wall cells of the grid shell merged into strips; it moves to the solid's section when the grid shell is retired
// (ADR 0026).
import type { Building } from './building.ts';
import { gridLevelShell } from './gridShell.ts';
import type { LevelId } from '../package/types.ts';

export const planMass = (b: Building, level: LevelId): [number, number, number, number][] => gridLevelShell(b, level).mass;
