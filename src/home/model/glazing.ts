// Gable windows (glazings with a polygonal outline) as the user chose them — a few plain choices instead of a joinery editor:
// the colour of the frame and its bars, how many vertical bars divide it (as drawn in the project, none, or 1–3 evenly), and one
// horizontal bar (none, at door height, half way up). The choices live in the variant (Variant.glazing, by window id); a
// window without a choice keeps the project's look. A glazing split by a partition into a window per room (plan.json `group`)
// is one window to the user: its parts change together and are divided over its whole width. Pure TS: the scene turns a
// choice into bars with barsOf.
import { project } from '../../project/active';
import type { GlazingBars } from '@home-sim/core/solid/frames';
import type { ShellWindow } from '@home-sim/core/solid/openings';

export type BarsChoice = 'project' | 0 | 1 | 2 | 3;
export type TransomChoice = 'none' | 'door' | 'half';
export interface GlazingChoice { color?: string; bars?: BarsChoice; transom?: TransomChoice }

/** frame colours offered (the dictionary key of each name: glazing.color.<key>); the first is the default */
export const FRAME_COLORS = [
  { hex: '#4a4e55', key: 'anthracite' }, { hex: '#f2f1ec', key: 'white' }, { hex: '#1f2124', key: 'black' },
  { hex: '#8b9096', key: 'grey' }, { hex: '#5b4636', key: 'brown' }, { hex: '#a5713f', key: 'oak' },
] as const;
export const DEFAULT_FRAME = FRAME_COLORS[0].hex;
export const BARS: BarsChoice[] = ['project', 0, 1, 2, 3];
export const TRANSOMS: TransomChoice[] = ['none', 'door', 'half'];
/** height of the "door height" bar above the room floor [m] (the head of a standard door) */
export const DOOR_TRANSOM = 2.05;

export interface GableWindow { id: string; roomId: string; level: string; mullions: number[]; group: string }
/** the gable windows of the project: id, room, the bars drawn in the project (along the wall) and the glazing they are part of
 *  (their own id when not split) */
export function gableWindows(): GableWindow[] {
  return project().building.rooms.rooms.flatMap((r) => r.openings.filter((o) => o.polygon_YZ).map((o) => ({ id: o.id, roomId: r.id, level: r.level, mullions: o.mullions ?? [], group: o.group ?? o.id })));
}
/** the gable windows as the user sees them: one entry per glazing, with the ids of its parts */
export function glazingGroups(): { group: string; ids: string[]; roomIds: string[]; drawn: boolean }[] {
  const out = new Map<string, { group: string; ids: string[]; roomIds: string[]; drawn: boolean }>();
  for (const w of gableWindows()) {
    const g = out.get(w.group) ?? { group: w.group, ids: [], roomIds: [], drawn: false };
    g.ids.push(w.id); g.roomIds.push(w.roomId); g.drawn ||= w.mullions.length > 0;
    out.set(w.group, g);
  }
  return [...out.values()];
}

/** the extent of a glazing made of several windows, in the frame of one of them: along its width (s0…s1), its top (absolute)
 *  and the middles of the partitions between its parts (each one already divides it) */
export interface GlazingExtent { s0: number; s1: number; top: number; gaps: number[] }
export function extentOf(w: ShellWindow, parts: ShellWindow[]): GlazingExtent {
  const base = w.a[0] * w.dir[0] + w.a[1] * w.dir[1];
  const spans = parts.map((p) => { const o = p.a[0] * w.dir[0] + p.a[1] * w.dir[1] - base, ss = (p.outline ?? [[0, 0], [p.width, 0]]).map((q) => o + q[0]); return [Math.min(...ss), Math.max(...ss)] as const; }).sort((a, b) => a[0] - b[0]);
  const tops = parts.map((p) => p.z0 + Math.max(...(p.outline ?? [[0, p.z1 - p.z0]]).map((q) => q[1])));
  const gaps = spans.slice(1).map((s, i) => (spans[i][1] + s[0]) / 2);
  return { s0: spans[0][0], s1: Math.max(...spans.map((s) => s[1])), top: Math.max(...tops), gaps };
}

/** the choice in force for a window: the user's, filled with the defaults */
export function choiceOf(glazing: Record<string, GlazingChoice> | null | undefined, id: string): Required<GlazingChoice> {
  const c = glazing?.[id] ?? {};
  return { color: c.color ?? DEFAULT_FRAME, bars: c.bars ?? 'project', transom: c.transom ?? 'none' };
}

/** the bars of a window for a choice: vertical ones as drawn or evenly spaced over the width of its glazing (`whole`: the
 *  glazing it is part of; default: the window alone), the horizontal one at door height (above the room floor `floorZ`) or half
 *  way up the glazing — left out where they miss this window (the scene's bar builder drops a bar outside its outline) */
export function barsOf(w: ShellWindow, c: Required<GlazingChoice>, floorZ: number, whole: GlazingExtent = extentOf(w, [w])): GlazingBars {
  const own = Math.max(...(w.outline ?? [[0, w.z1 - w.z0]]).map((q) => q[1])), { s0, s1 } = whole;
  let at = c.bars === 'project' ? [...(w.mullions ?? [])] : Array.from({ length: c.bars }, (_, k) => s0 + ((k + 1) * (s1 - s0)) / (c.bars as number + 1));
  // a partition between parts is one of the divisions: it takes the place of the bar nearest to it
  if (c.bars !== 'project') for (const g of whole.gaps) { if (!at.length) break; const k = at.reduce((b, x, i) => (Math.abs(x - g) < Math.abs(at[b] - g) ? i : b), 0); at = at.filter((_, i) => i !== k); }
  const t = c.transom === 'door' ? floorZ + DOOR_TRANSOM - w.z0 : c.transom === 'half' ? (whole.top - w.z0) / 2 : null;
  return { at, transom: t !== null && t > 0.15 && t < own - 0.15 ? t : null };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** validation of Variant.glazing */
export function glazingErrors(g: unknown): string[] {
  if (g === undefined || g === null) return [];
  if (typeof g !== 'object' || Array.isArray(g)) return ['glazing: an object by window id'];
  const e: string[] = [];
  for (const [id, c] of Object.entries(g as Record<string, unknown>)) {
    const x = c as GlazingChoice;
    if (!x || typeof x !== 'object') { e.push(`glazing.${id}: an object`); continue; }
    if (x.color !== undefined && !(typeof x.color === 'string' && HEX.test(x.color))) e.push(`glazing.${id}.color: #rrggbb`);
    if (x.bars !== undefined && !BARS.includes(x.bars)) e.push(`glazing.${id}.bars: "project" or 0–3`);
    if (x.transom !== undefined && !TRANSOMS.includes(x.transom)) e.push(`glazing.${id}.transom: none, door or half`);
  }
  return e;
}
