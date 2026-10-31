// The line of a wall an opening lies in. An opening record measures along its wall (`from` / `to`, the parameter t) and across it
// (the wall faces, c): a wall along X has t = x and c = y, along Y t = y and c = x, and a slanted wall (`along` / `plane_axis`
// "D") carries its unit direction `dir` — t = p · dir, c = p · n with n = (−dir.y, dir.x). Every reader of door gaps, windows
// and door openings goes through these frames, so walls along the axes and slanted walls are handled by the same code.
import type { Vec2 } from '../package/types.ts';

/** the line kinds of an opening record: along X, along Y, or slanted (a direction of its own) */
export type LineAxis = 'X' | 'Y' | 'D';
/** a wall line frame: unit direction along the wall and the unit normal the face coordinate is measured along */
export interface LineFrame { dir: Vec2; n: Vec2 }

const X_FRAME: LineFrame = { dir: [1, 0], n: [0, 1] }, Y_FRAME: LineFrame = { dir: [0, 1], n: [1, 0] };
/** the frame of a line: X, Y, or slanted with direction dir */
export function lineFrame(along: LineAxis, dir?: readonly number[] | null): LineFrame {
  if (along === 'X') return X_FRAME;
  if (along === 'Y') return Y_FRAME;
  if (!dir) throw new Error('a slanted wall line needs its direction');
  const l = Math.hypot(dir[0], dir[1]) || 1, d: Vec2 = [dir[0] / l, dir[1] / l];
  return { dir: d, n: [-d[1], d[0]] };
}
/** coordinate along the line, across it, and the point of (t, c) */
export const lineT = (f: LineFrame, p: readonly number[]) => p[0] * f.dir[0] + p[1] * f.dir[1];
export const lineC = (f: LineFrame, p: readonly number[]) => p[0] * f.n[0] + p[1] * f.n[1];
export const linePt = (f: LineFrame, t: number, c: number): Vec2 => [f.dir[0] * t + f.n[0] * c, f.dir[1] * t + f.n[1] * c];

/** the direction of a line, made unique: pointing to +x (or +y when vertical) */
export function canonicalDir(d: readonly number[]): Vec2 {
  const l = Math.hypot(d[0], d[1]) || 1;
  let x = d[0] / l, y = d[1] / l;
  if (x < -1e-9 || (Math.abs(x) <= 1e-9 && y < 0)) { x = -x; y = -y; }
  return [x + 0, y + 0];
}
/** the line kind of a direction: X, Y or slanted */
export const axisOf = (d: readonly number[]): LineAxis => (Math.abs(d[1]) < 1e-6 * Math.hypot(d[0], d[1]) ? 'X' : Math.abs(d[0]) < 1e-6 * Math.hypot(d[0], d[1]) ? 'Y' : 'D');

/** the frame of a door gap (DoorJson) or a door opening (DoorDef.opening): `along` and, slanted, `dir` */
export const gapFrame = (g: { along: LineAxis; dir?: readonly number[] | null }): LineFrame => lineFrame(g.along, g.dir);
/** the frame of a window (OpeningJson): `plane_axis` is the axis constant along the face (X for a wall along Y), "D" slanted */
export const windowFrame = (o: { plane_axis: LineAxis; dir?: readonly number[] | null }): LineFrame => (o.plane_axis === 'D' ? lineFrame('D', o.dir) : o.plane_axis === 'X' ? Y_FRAME : X_FRAME);
