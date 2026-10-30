// GENERATED SHELL of the active project — the core's grid shell (packages/core/src/model/gridShell.ts) bound to the active
// project. A project without a building model file (project().assets.model) gets walls, slabs and windows computed from the
// room outlines; orthogonal plans only, no roof (ADR 0010; replaced by the manifold shell, ADR 0024).
import { gridLevelShell, gridShellBounds, orthogonalPlan as coreOrthogonalPlan } from '@home-sim/core/model/gridShell';
import { derived, project } from '../../project/active';
import { building } from './building';
import { allRooms, type HomeRoom } from './rooms';
import type { LevelId, Vec2, Vec3 } from './types';
import type { ShellSpec } from '@home-sim/core/package/types';

export type { ShellSpec } from '@home-sim/core/package/types';
export type { LevelShell, ShellQuad, ShellWindow } from '@home-sim/core/model/gridShell';
export { SHELL_DEFAULTS } from '@home-sim/core/model/building';

export const shellSpec = (): ShellSpec => building().shell;
/** whether the engine builds the shell itself (the project has no model file) */
export const hasGeneratedShell = (): boolean => !project().assets?.model;
/** whether the room plan is orthogonal (precondition of the generated shell) */
export const orthogonalPlan = (rooms: HomeRoom[] = allRooms()): boolean => coreOrthogonalPlan(rooms);

/** level shell (once per project package and level) */
export const levelShell = (level: LevelId) => gridLevelShell(building(), level);

/** building bounds in space: from the generated shell (room plan + exterior walls, from the slab underside to the top of the roof slab) */
export const shellBounds = derived((): { min: Vec3; max: Vec3 } => gridShellBounds(building()));

/** building outline in plan (bounding rectangle) — obstacle for walking on the site when the project does not supply its own */
export const shellFootprint = derived((): Vec2[] => { const b = shellBounds(); return [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]]]; });
