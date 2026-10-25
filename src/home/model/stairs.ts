// Stairs between levels (walk mode, schematic steps, cladding) — data from the project package (project().building.stairs).
// A project without stairs (a single-level apartment) has nothing here: every function returns "no stairs".
// The engine supports one kind: two-flight U-turn stairs with a landing (`u-turn`), flights along the project Y axis —
// entry from the larger-Y side, lower flight on the larger-X side, upper flight on the smaller-X side; landing at the
// smaller-Y edge. Another shape or rotation requires extending this module (docs/ADDING_A_NEW_BUILDING.md).
import { fmtNum, t } from '../../i18n';
import { derived } from '../../project/active';
import type { LevelId, Vec2 } from './types';

export interface StairDef {
  id: string;
  kind: 'u-turn';
  /** level the stairs start from and the level they lead to */
  fromLevel: LevelId; toLevel: LevelId;
  /** plan outline (floor opening) [x0, y0, x1, y1] */
  bbox: [number, number, number, number];
  /** risers per flight, riser height, tread depth [m] */
  risers: number; riser: number; tread: number;
  flightWidth: number;
  /** gap between the flights [m] */
  gap: number;
  /** landing and upper level height relative to the lower level floor [m] */
  landingZ: number; topZ: number;
  /** flight split line (X coordinate) */
  split: number;
  /** flight length in plan and landing edge (Y coordinate) */
  run: number; landingEdge: number;
  confidence: string;
  /** note from the project sources shown with the stairs (e.g. railing height from the plan) */
  note?: string;
}

const NONE: StairDef[] = [];
const model = derived((p) => p.building.stairs ?? NONE);
/** project stairs (empty list — project without stairs) */
export const stairs = (): StairDef[] => model();
/** whether stairs arrive at the level from a lower one (opening in the floor / slab) */
export const stairArrivesAt = (level: LevelId): boolean => stairs().some((s) => s.toLevel === level);
export const hasStairs = (): boolean => model().length > 0;
/** structure description on the stairs card — numbers from the project stair data (`u-turn` stairs: two flights): steps in cm, landing level with 2–3 decimals */
export function stairFacts(s: StairDef): string {
  const cm = (m: number) => { const v = Math.round(m * 1000) / 10; return fmtNum(v, Number.isInteger(v) ? 0 : 1); };
  const abs = Math.abs(s.landingZ), level = `${s.landingZ < 0 ? '−' : '+'}${fmtNum(abs, abs.toFixed(3).endsWith('0') ? 2 : 3)}`;
  return t('stairs.facts', { risers: s.risers, riser: cm(s.riser), tread: cm(s.tread), level });
}
const inBox = (s: StairDef, p: Vec2, m: number) => p[0] > s.bbox[0] - m && p[0] < s.bbox[2] + m && p[1] > s.bbox[1] - m && p[1] < s.bbox[3] + m;
/** stairs whose outline (with margin m) contains the point */
export const stairAt = (p: Vec2, m = 0): StairDef | null => model().find((s) => inBox(s, p, m)) ?? null;
export const inStairBox = (p: Vec2, m = 0) => stairAt(p, m) !== null;

/** stair part under the point: flight 1, landing, flight 2 */
export function stairPart(p: Vec2, s: StairDef | null = stairAt(p)): 'flight1' | 'landing' | 'flight2' {
  if (!s || p[1] <= s.landingEdge) return 'landing';
  return p[0] > s.split ? 'flight1' : 'flight2';
}

/** walking surface height on the stairs (a ramp along the step nosings — smooth camera motion) */
export function stairZ(p: Vec2, s: StairDef | null = stairAt(p)): number {
  if (!s) return 0;
  const part = stairPart(p, s), t = Math.min(1, Math.max(0, (s.bbox[3] - p[1]) / s.run));
  if (part === 'landing') return s.landingZ;
  if (part === 'flight1') return s.landingZ * t;
  return s.landingZ + (s.topZ - s.landingZ) * (1 - t);
}

/** whether a figure (radius r) fits on the stairs at point p: walls at smaller X and Y, balustrade on the larger-X side, partition between the flights */
export function stairAllowed(p: Vec2, r: number, s: StairDef | null = stairAt(p)): boolean {
  if (!s) return false;
  const [x0, y0, x1] = s.bbox;
  if (p[0] < x0 + r || p[1] < y0 + r || p[0] > x1 - r * 0.7) return false;
  if (stairPart(p, s) === 'landing') return true;
  // between the flights (partition + balustrade) — passing only via the landing
  return Math.abs(p[0] - s.split) > r * 0.6;
}

/** schematic preview steps: [x0, y0, x1, y1, zTop] (boxes from the lower level floor) */
export function stairSteps(s: StairDef): [number, number, number, number, number][] {
  const out: [number, number, number, number, number][] = [];
  const { bbox, tread, riser, risers, landingZ, split, gap } = s;
  const y1 = bbox[3], le = s.landingEdge;
  // flight 1 (lower): from the entry (y1) towards the landing; landing; flight 2 (upper): from the landing to the upper level
  for (let i = 0; i < risers - 1; i++) out.push([split + gap / 2, y1 - (i + 1) * tread, bbox[2], y1 - i * tread, riser * (i + 1)]);
  out.push([bbox[0], bbox[1], bbox[2], le, landingZ]);
  for (let i = 0; i < risers - 1; i++) out.push([bbox[0], le + i * tread, split - gap / 2, le + (i + 1) * tread, landingZ + riser * (i + 1)]);
  return out;
}
