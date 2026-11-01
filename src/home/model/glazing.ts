// Gable windows (glazings with a polygonal outline) as the user chose them — a few plain choices instead of a joinery editor:
// the colour of the frame and its bars, how the bars divide it — a quick choice (as drawn in the project, none, or 1–3 vertical
// bars evenly; one horizontal bar at door height or half way up) or bars the user placed anywhere (vertical ones from frame to
// frame, horizontal ones across the whole glazing or one pane). The choices live in the variant (Variant.glazing, by window id);
// a window without a choice keeps the project's look. A glazing split by a partition into a window per room (plan.json `group`)
// is one window to the user: its parts change together and are divided over its whole width, the partition being one of the
// divisions. Placed bars are kept as fractions of the glazing as seen from outside (left to right, bottom to top), so one layout
// fits every window. Pure TS: the scene turns a layout into each part's bars with barsFor.
import { windowFrame, lineC } from '@home-sim/core/model/wallLine';
import type { GlazingBars } from '@home-sim/core/solid/frames';
import type { ShellWindow } from '@home-sim/core/solid/openings';
import { project } from '../../project/active';

export type BarsChoice = 'project' | 0 | 1 | 2 | 3;
export type TransomChoice = 'none' | 'door' | 'half';
/** a placed horizontal bar: `h` of the glazing's height up from its bottom; only across the pane at `at` of its width (else
 *  frame to frame) */
export interface PlacedRow { h: number; at?: number }
/** placed bars (`cols`, `rows`) take the place of the quick choice (`bars`, `transom`) */
export interface GlazingChoice { color?: string; bars?: BarsChoice; transom?: TransomChoice; cols?: number[]; rows?: PlacedRow[] }
export interface ResolvedChoice { color: string; bars: BarsChoice; transom: TransomChoice; cols: number[] | null; rows: PlacedRow[] | null }

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
/** nearest a bar comes to the frame or to another bar [m] */
export const BAR_GAP = 0.1;

/** one glazing as the user sees it, in the plan's coordinates: `along` the wall line (as the package gives openings), z absolute */
export interface GlazingShape {
  group: string; ids: string[]; roomIds: string[]; level: string;
  /** floor of its room (the first part's) */
  floorZ: number;
  /** the outline of every part: [along, z] */
  parts: { id: string; poly: [number, number][] }[];
  /** extent: along s0…s1, z0…z1 */
  s0: number; s1: number; z0: number; z1: number;
  /** the middles of the partitions between its parts (along) — fixed divisions */
  gaps: number[];
  /** the vertical bars the project draws (along) */
  drawn: number[];
  /** the direction of `along` in the plan */
  axis: [number, number];
  /** `along` runs right to left as seen from outside */
  flip: boolean;
}

/** the gable windows of the project, one entry per glazing (the parts of a split one together) */
export function glazingShapes(): GlazingShape[] {
  const out = new Map<string, GlazingShape>();
  for (const r of project().building.rooms.rooms) {
    const n = r.polygon.length, cx = r.polygon.reduce((s, p) => s + p[0], 0) / n, cy = r.polygon.reduce((s, p) => s + p[1], 0) / n;
    for (const o of r.openings) {
      if (!o.polygon_YZ) continue;
      const f = windowFrame(o), side = o.inner - lineC(f, [cx, cy]) >= 0 ? 1 : -1, outward: [number, number] = [f.n[0] * side, f.n[1] * side];
      // seen from outside (looking against `outward`, z up) the right hand points along z × outward
      const flip = -outward[1] * f.dir[0] + outward[0] * f.dir[1] < 0, poly = o.polygon_YZ.map((q) => [q[0], q[1]] as [number, number]);
      const key = o.group ?? o.id, g = out.get(key) ?? { group: key, ids: [], roomIds: [], level: r.level, floorZ: r.floor_z, parts: [], s0: Infinity, s1: -Infinity, z0: Infinity, z1: -Infinity, gaps: [], drawn: [], axis: [f.dir[0], f.dir[1]], flip };
      g.ids.push(o.id); g.roomIds.push(r.id); g.parts.push({ id: o.id, poly }); g.drawn.push(...(o.mullions ?? []));
      for (const [a, z] of poly) { g.s0 = Math.min(g.s0, a); g.s1 = Math.max(g.s1, a); g.z0 = Math.min(g.z0, z); g.z1 = Math.max(g.z1, z); }
      out.set(key, g);
    }
  }
  for (const g of out.values()) {
    const spans = g.parts.map((p) => [Math.min(...p.poly.map((q) => q[0])), Math.max(...p.poly.map((q) => q[0]))]).sort((a, b) => a[0] - b[0]);
    g.gaps = spans.slice(1).map((s, i) => (spans[i][1] + s[0]) / 2);
    g.drawn.sort((a, b) => a - b);
  }
  return [...out.values()];
}
/** the glazing a window is part of */
export const shapeOf = (id: string, shapes = glazingShapes()) => shapes.find((g) => g.ids.includes(id));

/** the choice in force for a window: the user's, filled with the defaults */
export function choiceOf(glazing: Record<string, GlazingChoice> | null | undefined, id: string): ResolvedChoice {
  const c = glazing?.[id] ?? {};
  return { color: c.color ?? DEFAULT_FRAME, bars: c.bars ?? 'project', transom: c.transom ?? 'none', cols: c.cols ?? null, rows: c.rows ?? null };
}

/** the bars of a glazing, resolved: vertical ones (along) and horizontal ones (z; across the whole glazing or between s0 and s1) */
export interface Layout { cols: number[]; rows: { z: number; s0?: number; s1?: number }[] }

/** between a fraction of the glazing as seen from outside and `along` */
export const alongOf = (g: GlazingShape, u: number) => (g.flip ? g.s1 - u * (g.s1 - g.s0) : g.s0 + u * (g.s1 - g.s0));
export const fractionOf = (g: GlazingShape, a: number) => (g.flip ? g.s1 - a : a - g.s0) / (g.s1 - g.s0 || 1);
/** the pane boundaries around `along` a: the nearest bar, partition or edge on either side */
export function paneAt(g: GlazingShape, cols: number[], a: number): [number, number] {
  const cuts = [g.s0, ...cols, ...g.gaps, g.s1];
  return [Math.max(...cuts.filter((x) => x <= a)), Math.min(...cuts.filter((x) => x >= a))];
}

/** the bars of a glazing for a choice */
export function layoutOf(g: GlazingShape, c: ResolvedChoice): Layout {
  let cols: number[];
  if (c.cols) cols = c.cols.map((u) => alongOf(g, u));
  else if (c.bars === 'project') cols = [...g.drawn];
  else {
    const n = c.bars;
    cols = Array.from({ length: n }, (_, k) => g.s0 + ((k + 1) * (g.s1 - g.s0)) / (n + 1));
    // a partition between parts is one of the divisions: it takes the place of the bar nearest to it
    for (const gap of g.gaps) { if (!cols.length) break; const k = cols.reduce((b, x, i) => (Math.abs(x - gap) < Math.abs(cols[b] - gap) ? i : b), 0); cols = cols.filter((_, i) => i !== k); }
  }
  cols.sort((a, b) => a - b);
  let rows: Layout['rows'];
  if (c.rows) rows = c.rows.map((r) => { const z = g.z0 + r.h * (g.z1 - g.z0); if (r.at === undefined) return { z }; const [s0, s1] = paneAt(g, cols, alongOf(g, r.at)); return { z, s0, s1 }; });
  else {
    const z = c.transom === 'door' ? g.floorZ + DOOR_TRANSOM : c.transom === 'half' ? (g.z0 + g.z1) / 2 : null;
    rows = z !== null && z > g.z0 + 0.15 && z < g.z1 - 0.15 ? [{ z }] : [];
  }
  return { cols, rows };
}

/** a layout as placed bars (fractions as seen from outside), to keep in the variant; `rowAt`: the pane of each pane-wide row */
export function placedOf(g: GlazingShape, l: Layout): { cols: number[]; rows: PlacedRow[] } {
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4, H = g.z1 - g.z0 || 1;
  return {
    cols: l.cols.map((a) => r4(fractionOf(g, a))).sort((a, b) => a - b),
    rows: l.rows.map((r) => ({ h: r4((r.z - g.z0) / H), ...(r.s0 !== undefined && r.s1 !== undefined ? { at: r4(fractionOf(g, (r.s0 + r.s1) / 2)) } : {}) })),
  };
}

/** the bars of one part of a glazing in its own frame (the shell window: along its width from `a`, up from its bottom) */
export function barsFor(w: ShellWindow, g: GlazingShape, l: Layout): GlazingBars {
  const k = g.axis[0] * w.dir[0] + g.axis[1] * w.dir[1] >= 0 ? 1 : -1, off = w.a[0] * w.dir[0] + w.a[1] * w.dir[1], s = (a: number) => a * k - off;
  return {
    at: l.cols.map(s),
    rows: l.rows.map((r) => (r.s0 === undefined || r.s1 === undefined ? { t: r.z - w.z0 } : { t: r.z - w.z0, s0: Math.min(s(r.s0), s(r.s1)), s1: Math.max(s(r.s0), s(r.s1)) })),
  };
}

const HEX = /^#[0-9a-f]{6}$/i, FRACTION = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1;
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
    if (x.cols !== undefined && !(Array.isArray(x.cols) && x.cols.length <= 20 && x.cols.every(FRACTION))) e.push(`glazing.${id}.cols: fractions between 0 and 1`);
    if (x.rows !== undefined && !(Array.isArray(x.rows) && x.rows.length <= 20 && x.rows.every((r) => r && typeof r === 'object' && FRACTION(r.h) && (r.at === undefined || FRACTION(r.at)))))
      e.push(`glazing.${id}.rows: { h, at? } with fractions between 0 and 1`);
  }
  return e;
}
