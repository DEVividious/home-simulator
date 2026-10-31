// GENERATED SHELL of the active project. A project without a building model file (project().assets.model) gets walls, slabs
// and windows computed from the room outlines as the core's manifold solids, built in a worker (ADR 0024, 0026 —
// three/coreShell.ts); here, synchronously, what does not need the kernel (the bounds), and the wall mass in plan the worker
// sends back with the solids (the section of every level solid — the plan views draw it).
import { shellBounds as coreShellBounds, wallBounds as coreWallBounds } from '@home-sim/core/solid/levels';
import type { BuildingData } from '@home-sim/core/model/building';
import { derived, project } from '../../project/active';
import { createStore } from '../store/createStore';
import { building } from './building';
import type { LevelId, Vec2, Vec3 } from './types';
import type { ShellSpec } from '@home-sim/core/package/types';

export type { ShellSpec } from '@home-sim/core/package/types';
export { SHELL_DEFAULTS } from '@home-sim/core/model/building';

export const shellSpec = (): ShellSpec => building().shell;
/** whether the engine builds the shell itself (the project has no model file) */
export const hasGeneratedShell = (): boolean => !project().assets?.model;

/** building bounds in space: from the generated shell (room plan + exterior walls, from the slab underside to the top of the
 *  roof; the eaves included) */
export const shellBounds = derived((): { min: Vec3; max: Vec3 } => coreShellBounds(building()));

/** building outline in plan (bounding rectangle of the walls, not the eaves) — obstacle for walking on the site when the project
 *  does not supply its own */
export const shellFootprint = derived((): Vec2[] => { const b = coreWallBounds(building()); return [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]]]; });

/** wall mass in plan per level: loops of the section of the level solid (outer counter-clockwise, holes clockwise) */
export type WallSections = Record<LevelId, Vec2[][]>;
const sections = new WeakMap<BuildingData, WallSections>();
/** raised whenever the sections of a building block arrive (the plan views redraw) */
export const wallSectionsRev = createStore({ n: 0 });
/** the sections of a building block, from the worker's solids */
export function setWallSections(data: BuildingData, s: WallSections): void {
  sections.set(data, s);
  wallSectionsRev.set((x) => ({ n: x.n + 1 }));
}
/** the wall mass of a level of the active project in plan; null until its solids are built — or when the solid kernel failed */
export const wallSection = (level: LevelId): Vec2[][] | null => sections.get(project().building)?.[level] ?? null;
