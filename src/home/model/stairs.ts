// Stairs between levels (walk mode, schematic steps, cladding) — data from the project package (project().building.stairs).
// A project without stairs (a single-level apartment) has nothing here: every function returns "no stairs". The geometry of
// one stair record (canonical frame, parts, ramp height, steps) is in the core (packages/core/src/model/stairs.ts); here it
// is bound to the active project and the stairs card text is translated.
import { stairArrivesAt as coreStairArrivesAt } from '@home-sim/core/model/building';
import * as core from '@home-sim/core/model/stairs';
import { fmtNum, t } from '../../i18n';
import { building } from './building';
import type { LevelId, Vec2 } from './types';
import type { StairDef } from '@home-sim/core/package/types';

export type { StairDef, StairOrient } from '@home-sim/core/package/types';
export { stairFrame, stairSteps, type StairFrame } from '@home-sim/core/model/stairs';
import type { HomeRoom } from './rooms';

/** project stairs (empty list — project without stairs) */
export const stairs = (): StairDef[] => building().stairs;
/** whether stairs arrive at the level from a lower one (opening in the floor / slab) */
export const stairArrivesAt = (level: LevelId): boolean => coreStairArrivesAt(building(), level);
export const hasStairs = (): boolean => stairs().length > 0;
/** structure description on the stairs card — numbers from the project stair data (flights, steps in cm, landing level with
 *  2–3 decimals) */
export function stairFacts(s: StairDef): string {
  const cm = (m: number) => { const v = Math.round(m * 1000) / 10; return fmtNum(v, Number.isInteger(v) ? 0 : 1); };
  const lz = s.kind === 'straight' ? 0 : s.landingZ, abs = Math.abs(lz), level = `${lz < 0 ? '−' : '+'}${fmtNum(abs, abs.toFixed(3).endsWith('0') ? 2 : 3)}`;
  const v = { risers: s.risers, riser: cm(s.riser), tread: cm(s.tread), level };
  if (s.kind === 'straight') return t('stairs.factsStraight', v);
  if (s.kind === 'l-turn') return t('stairs.factsL', { ...v, upper: s.upperRisers });
  return t('stairs.facts', v);
}
/** stairs whose outline (with margin m) contains the point */
export const stairAt = (p: Vec2, m = 0): StairDef | null => core.stairAt(stairs(), p, m);
export const inStairBox = (p: Vec2, m = 0) => stairAt(p, m) !== null;

/** stair part under the point: flight 1, landing, flight 2 */
export const stairPart = (p: Vec2, s: StairDef | null = stairAt(p)) => core.stairPart(p, s);
/** walking surface height on the stairs (a ramp along the step nosings — smooth camera motion) */
export const stairZ = (p: Vec2, s: StairDef | null = stairAt(p)): number => core.stairZ(p, s);
/** whether a figure (radius r) fits on the stairs at point p */
export const stairAllowed = (p: Vec2, r: number, s: StairDef | null = stairAt(p)): boolean => core.stairAllowed(p, r, s);
/** the parts of a room's stair opening as convex rectangles (an L opening is two or three) */
export function stairOpeningRects(room: Pick<HomeRoom, 'level' | 'stairOpening'>): [number, number, number, number][] {
  const o = room.stairOpening;
  if (!o) return [];
  const s = stairs().find((q) => q.toLevel === room.level && q.bbox.every((v, i) => Math.abs(v - o[i]) < 1e-6));
  return s ? core.stairRects(s) : [o];
}
/** whether a plan point is in a stair opening of the level (inside the stairs' outline, the L of an l-turn) */
export const inStairOpening = (level: LevelId, p: Vec2): boolean => stairs().some((s) => s.toLevel === level && core.stairAt([s], p) !== null);
