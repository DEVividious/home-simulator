// Stairs between levels (walk mode, schematic steps, cladding) — data from the project package (project().building.stairs).
// A project without stairs (a single-level apartment) has nothing here: every function returns "no stairs".
// The engine supports one kind: two-flight U-turn stairs with a landing (`u-turn`). Its layout is described in a canonical
// frame — flights along Y, entry from the larger-Y side, lower flight on the larger-X side, upper flight on the smaller-X side,
// landing at the smaller-Y edge — and `orient` turns (multiples of 90°) and mirrors that frame onto the plan. `split`,
// `landingEdge` are canonical coordinates; `bbox` is always the outline on the plan.
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
  /** canonical frame → plan: mirror across the flights first (the lower flight on the smaller-X side), then turn
   *  counter-clockwise; absent = as canonical (walking up the lower flight towards −Y) */
  orient?: StairOrient;
}
export interface StairOrient { rotate: 0 | 90 | 180 | 270; mirror: boolean }

/** canonical frame of the stairs: its box (same corner as bbox, sides swapped when turned by 90°) and the maps */
export interface StairFrame { box: [number, number, number, number]; toLocal: (p: Vec2) => Vec2; toWorld: (q: Vec2) => Vec2 }
export function stairFrame(s: StairDef): StairFrame {
  const [x0, y0, x1, y1] = s.bbox, r = s.orient?.rotate ?? 0, m = !!s.orient?.mirror;
  const W = x1 - x0, D = y1 - y0, [cw, cd] = r === 90 || r === 270 ? [D, W] : [W, D];
  const box: [number, number, number, number] = [x0, y0, x0 + cw, y0 + cd];
  if (!r && !m) return { box, toLocal: (p) => p, toWorld: (q) => q };
  return {
    box,
    toLocal: ([px, py]) => {
      const ux = px - x0, uy = py - y0;
      let cx = r === 0 ? ux : r === 90 ? uy : r === 180 ? cw - ux : cw - uy;
      const cy = r === 0 ? uy : r === 90 ? cd - ux : r === 180 ? cd - uy : ux;
      if (m) cx = cw - cx;
      return [x0 + cx, y0 + cy];
    },
    toWorld: ([qx, qy]) => {
      const cx = m ? cw - (qx - x0) : qx - x0, cy = qy - y0;
      const [ux, uy] = r === 0 ? [cx, cy] : r === 90 ? [cd - cy, cx] : r === 180 ? [cw - cx, cd - cy] : [cy, cw - cx];
      return [x0 + ux, y0 + uy];
    },
  };
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
  if (!s) return 'landing';
  const q = stairFrame(s).toLocal(p);
  if (q[1] <= s.landingEdge) return 'landing';
  return q[0] > s.split ? 'flight1' : 'flight2';
}

/** walking surface height on the stairs (a ramp along the step nosings — smooth camera motion) */
export function stairZ(p: Vec2, s: StairDef | null = stairAt(p)): number {
  if (!s) return 0;
  const f = stairFrame(s), part = stairPart(p, s), t = Math.min(1, Math.max(0, (f.box[3] - f.toLocal(p)[1]) / s.run));
  if (part === 'landing') return s.landingZ;
  if (part === 'flight1') return s.landingZ * t;
  return s.landingZ + (s.topZ - s.landingZ) * (1 - t);
}

/** whether a figure (radius r) fits on the stairs at point p: walls at smaller X and Y, balustrade on the larger-X side, partition between the flights (canonical frame) */
export function stairAllowed(p: Vec2, r: number, s: StairDef | null = stairAt(p)): boolean {
  if (!s) return false;
  const f = stairFrame(s), [x0, y0, x1] = f.box, q = f.toLocal(p);
  if (q[0] < x0 + r || q[1] < y0 + r || q[0] > x1 - r * 0.7) return false;
  if (stairPart(p, s) === 'landing') return true;
  // between the flights (partition + balustrade) — passing only via the landing
  return Math.abs(q[0] - s.split) > r * 0.6;
}

/** schematic preview steps: [x0, y0, x1, y1, zTop] (boxes from the lower level floor) */
export function stairSteps(s: StairDef): [number, number, number, number, number][] {
  const out: [number, number, number, number, number][] = [];
  const f = stairFrame(s), bbox = f.box, { tread, riser, risers, landingZ, split, gap } = s;
  const y1 = bbox[3], le = s.landingEdge;
  // flight 1 (lower): from the entry (y1) towards the landing; landing; flight 2 (upper): from the landing to the upper level
  for (let i = 0; i < risers - 1; i++) out.push([split + gap / 2, y1 - (i + 1) * tread, bbox[2], y1 - i * tread, riser * (i + 1)]);
  out.push([bbox[0], bbox[1], bbox[2], le, landingZ]);
  for (let i = 0; i < risers - 1; i++) out.push([bbox[0], le + i * tread, split - gap / 2, le + (i + 1) * tread, landingZ + riser * (i + 1)]);
  return out.map(([a, b, c, d, z]) => { const p = f.toWorld([a, b]), q = f.toWorld([c, d]); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), z]; });
}
