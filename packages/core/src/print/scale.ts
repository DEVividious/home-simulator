// The scale of the print (ADR 0032): one of the standard scales, the largest model at which every part — allowed to turn by 90°
// on the bed — fits the bed minus a margin on every side and the build height. Sizes here are in mm on the print.
import type { Bed } from './printers.ts';

/** standard scales, the largest model first */
export const SCALES: readonly number[] = [50, 75, 87, 100, 120, 150, 160, 200, 250, 300];

/** mm on the print per metre of the building */
export const mmPerM = (n: number): number => 1000 / n;
/** "1:75" */
export const scaleLabel = (n: number): string => `1:${n}`;
/** "1to75" — in file and directory names */
export const scaleTag = (n: number): string => `1to${n}`;

/** "1:75", "75" → 75; "auto" or nothing → null */
export function parseScale(s: string | undefined): number | null {
  if (s === undefined || s === '' || s === 'auto') return null;
  const m = /^\s*(?:1\s*:\s*)?(\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m || !(Number(m[1]) >= 1)) throw new Error(`invalid scale "${s}" (expected auto or 1:N, e.g. 1:100)`);
  return Number(m[1]);
}

export interface Fit {
  fits: boolean;
  /** turned by 90° on the bed */
  rotated: boolean;
  /** share of the bed's width and depth the part covers [%] */
  usage: [number, number];
  /** what does not fit: the plan, the height */
  over: ('plan' | 'height')[];
}

/** whether a part of the given size [mm] fits the bed with the margin [mm] kept free on every side */
export function fitOnBed(size: readonly [number, number, number], bed: Bed, margin: number): Fit {
  const W = bed.x - 2 * margin, D = bed.y - 2 * margin, e = 1e-6;
  const straight = size[0] <= W + e && size[1] <= D + e, turned = size[1] <= W + e && size[0] <= D + e;
  const rotated = !straight && turned, tall = bed.z !== null && size[2] > bed.z + e;
  const [w, d] = rotated ? [size[1], size[0]] : [size[0], size[1]];
  const over: Fit['over'] = [];
  if (!straight && !turned) over.push('plan');
  if (tall) over.push('height');
  return { fits: !over.length, rotated, usage: [Math.round((w / bed.x) * 1000) / 10, Math.round((d / bed.y) * 1000) / 10], over };
}
