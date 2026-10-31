// Stairs geometry — pure functions of one stair record. Three kinds (StairDef.kind): one straight flight, two flights at a
// right angle with a landing in the corner (`l-turn`), two flights side by side with a landing across both (`u-turn`). Each is
// laid out in a canonical frame — the lower flight is walked up towards −Y with its entry at the larger-Y side, and the stairs
// turn right (towards −X) — and `orient` turns (multiples of 90°) and mirrors that frame onto the plan. The layout is a list of
// pieces (flights and landings, canonical rectangles) and the sides of the pieces (walls, open sides, the partition between
// U-turn flights); the walk, the steps, the app's meshes, the print and the plan previews all read the pieces. `split`,
// `landingEdge` are canonical coordinates; `bbox` is always the outline's bounding box on the plan.
import { ccw, distToPolygonEdges, pointInPolygon, segDist } from './geom2d.ts';
import type { StairDef, Vec2 } from '../package/types.ts';

type Box = [number, number, number, number];

/** canonical frame of the stairs: its box (same corner as bbox, sides swapped when turned by 90°) and the maps */
export interface StairFrame { box: Box; toLocal: (p: Vec2) => Vec2; toWorld: (q: Vec2) => Vec2 }
export function stairFrame(s: StairDef): StairFrame {
  const [x0, y0, x1, y1] = s.bbox, r = s.orient?.rotate ?? 0, m = !!s.orient?.mirror;
  const W = x1 - x0, D = y1 - y0, [cw, cd] = r === 90 || r === 270 ? [D, W] : [W, D];
  const box: Box = [x0, y0, x0 + cw, y0 + cd];
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

// ------------------------------------------------------------------ pieces
export type StairPartId = 'flight1' | 'landing' | 'flight2' | 'top';
/** a flight in the canonical frame: its rectangle, the direction one walks up it (an axis), the heights at its start and end
 *  (relative to the lower floor) and its risers — risers − 1 treads, the last riser steps onto the next piece */
export interface StairFlight { kind: 'flight'; id: 'flight1' | 'flight2'; rect: Box; dir: Vec2; z0: number; z1: number; risers: number }
/** a landing (or the top landing of a straight flight at the upper floor height) in the canonical frame */
export interface StairLanding { kind: 'landing'; id: 'landing' | 'top'; rect: Box; z: number }
export type StairPiece = StairFlight | StairLanding;

/** the length of a flight in plan and the distance of a canonical point from its start edge, along the walking direction */
export const flightLength = (f: StairFlight) => (f.dir[0] ? f.rect[2] - f.rect[0] : f.rect[3] - f.rect[1]);
export function flightAlong(f: StairFlight, q: Vec2): number {
  const [x0, y0, x1, y1] = f.rect;
  return f.dir[0] > 0 ? q[0] - x0 : f.dir[0] < 0 ? x1 - q[0] : f.dir[1] > 0 ? q[1] - y0 : y1 - q[1];
}
/** the canonical rectangle of a flight between two distances from its start edge (its whole width) */
export function flightSlice(f: StairFlight, d0: number, d1: number): Box {
  const [x0, y0, x1, y1] = f.rect, a = Math.min(d0, d1), b = Math.max(d0, d1);
  if (f.dir[0] > 0) return [x0 + a, y0, x0 + b, y1];
  if (f.dir[0] < 0) return [x1 - b, y0, x1 - a, y1];
  if (f.dir[1] > 0) return [x0, y0 + a, x1, y0 + b];
  return [x0, y1 - b, x1, y1 - a];
}
/** the walking surface height of a flight at a distance from its start: a ramp along the step nosings */
export const flightZ = (f: StairFlight, d: number) => f.z0 + (f.z1 - f.z0) * Math.min(1, Math.max(0, d / Math.max(1e-9, flightLength(f))));

const piecesCache = new WeakMap<StairDef, StairPiece[]>();
/** flights and landings in the canonical frame, from the bottom up */
export function stairPieces(s: StairDef): StairPiece[] {
  const hit = piecesCache.get(s);
  if (hit) return hit;
  const [x0, y0, x1, y1] = stairFrame(s).box, out: StairPiece[] = [];
  if (s.kind === 'straight') {
    const end = Math.max(y0, y1 - s.run);
    out.push({ kind: 'flight', id: 'flight1', rect: [x0, end, x1, y1], dir: [0, -1], z0: 0, z1: s.topZ, risers: s.risers });
    if (end - y0 > 1e-3) out.push({ kind: 'landing', id: 'top', rect: [x0, y0, x1, end], z: s.topZ });
  } else if (s.kind === 'l-turn') {
    const yl = Math.max(y0, y1 - s.run), xl = Math.min(x1, x0 + s.upperRun);
    const w1 = Math.min(s.flightWidth, x1 - xl), w2 = Math.min(s.flightWidth, yl - y0);
    out.push({ kind: 'flight', id: 'flight1', rect: [x1 - w1, yl, x1, y1], dir: [0, -1], z0: 0, z1: s.landingZ, risers: s.risers });
    out.push({ kind: 'landing', id: 'landing', rect: [xl, y0, x1, yl], z: s.landingZ });
    out.push({ kind: 'flight', id: 'flight2', rect: [x0, y0, xl, y0 + w2], dir: [-1, 0], z0: s.landingZ, z1: s.topZ, risers: s.upperRisers });
  } else {
    const le = s.landingEdge, g = s.gap / 2;
    out.push({ kind: 'flight', id: 'flight1', rect: [s.split + g, le, x1, y1], dir: [0, -1], z0: 0, z1: s.landingZ, risers: s.risers });
    out.push({ kind: 'landing', id: 'landing', rect: [x0, y0, x1, le], z: s.landingZ });
    out.push({ kind: 'flight', id: 'flight2', rect: [x0, le, s.split - g, y1], dir: [0, 1], z0: s.landingZ, z1: s.topZ, risers: s.risers });
  }
  piecesCache.set(s, out);
  return out;
}

/** what is along a side of a piece: `entry` (the foot of the lower flight), `exit` (onto the upper floor), `joined` (the next
 *  piece), `wall`, `open` (a drop — a balustrade), `partition` (between the flights of a U-turn) */
export type StairSideKind = 'entry' | 'exit' | 'joined' | 'wall' | 'open' | 'partition';
/** a side of a piece in the canonical frame: segment a → b, the outward normal, and whether it is on the outer outline */
export interface StairSide { piece: StairPiece; a: Vec2; b: Vec2; out: Vec2; kind: StairSideKind; outer: boolean }

const sidesCache = new WeakMap<StairDef, StairSide[]>();
/** every side of every piece, split where it meets another piece */
export function stairSides(s: StairDef): StairSide[] {
  const hit = sidesCache.get(s);
  if (hit) return hit;
  const pieces = stairPieces(s), box = stairFrame(s).box, out: StairSide[] = [], E = 1e-6;
  const first = pieces[0] as StairFlight, last = pieces[pieces.length - 1];
  for (const p of pieces) {
    const [x0, y0, x1, y1] = p.rect;
    const edges: [Vec2, Vec2, Vec2][] = [[[x0, y0], [x1, y0], [0, -1]], [[x1, y0], [x1, y1], [1, 0]], [[x1, y1], [x0, y1], [0, 1]], [[x0, y1], [x0, y0], [-1, 0]]];
    for (const [a, b, n] of edges) {
      // k: the coordinate constant along this side; the side runs along the other one
      const k = n[0] ? 0 : 1, c = a[k], lo = Math.min(a[1 - k], b[1 - k]), hi = Math.max(a[1 - k], b[1 - k]);
      // the parts of this side another piece touches on its outer side
      const cover: [number, number][] = [];
      for (const o of pieces) {
        if (o === p) continue;
        const oc = n[k] > 0 ? o.rect[k] : o.rect[k + 2];
        if (Math.abs(oc - c) > E) continue;
        const l = Math.max(lo, o.rect[1 - k]), h = Math.min(hi, o.rect[3 - k]);
        if (h - l > E) cover.push([l, h]);
      }
      cover.sort((u, v) => u[0] - v[0]);
      const runs: [number, number, boolean][] = [];
      let t = lo;
      for (const [l, h] of cover) { if (l - t > E) runs.push([t, l, false]); runs.push([Math.max(t, l), h, true]); t = Math.max(t, h); }
      if (hi - t > E) runs.push([t, hi, false]);
      const outer = Math.abs(c - (n[k] > 0 ? box[k + 2] : box[k])) < E;
      for (const [l, h, joined] of runs) {
        const pa: Vec2 = k === 0 ? [c, l] : [l, c], pb: Vec2 = k === 0 ? [c, h] : [h, c];
        // keep the side running counter-clockwise around its piece
        const [sa, sb] = n[0] > 0 || n[1] < 0 ? [pa, pb] : [pb, pa];
        let kind: StairSideKind;
        if (joined) kind = 'joined';
        else if (p === first && n[0] === -first.dir[0] && n[1] === -first.dir[1]) kind = 'entry';
        else if (p === last && (p.kind === 'landing' || (n[0] === p.dir[0] && n[1] === p.dir[1]))) kind = 'exit';
        else if (s.kind === 'u-turn') kind = p.kind === 'landing' ? (outer ? (n[0] > 0 ? 'open' : 'wall') : 'joined') : outer ? (n[0] > 0 ? 'open' : 'wall') : 'partition';
        else if (s.kind === 'l-turn') kind = outer ? 'wall' : 'open';
        else kind = 'open';
        out.push({ piece: p, a: sa, b: sb, out: n, kind, outer });
      }
    }
  }
  sidesCache.set(s, out);
  return out;
}

/** the outline of the stairs on the plan (counter-clockwise): the box, or the L of an l-turn */
const outlineCache = new WeakMap<StairDef, Vec2[]>();
export function stairOutline(s: StairDef): Vec2[] {
  const hit = outlineCache.get(s);
  if (hit) return hit;
  const f = stairFrame(s), [x0, y0, x1, y1] = f.box;
  let loop: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  if (s.kind === 'l-turn') {
    const [f1, land, f2] = stairPieces(s);
    loop = [[x0, y0], [x1, y0], [x1, y1], [f1.rect[0], y1], [f1.rect[0], land.rect[3]], [land.rect[0], land.rect[3]], [land.rect[0], f2.rect[3]], [x0, f2.rect[3]]];
  }
  // drop repeated and collinear corners (a landing as wide as the flight)
  loop = loop.filter((p, i) => { const q = loop[(i + 1) % loop.length]; return Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9; });
  loop = loop.filter((p, i) => { const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-12; });
  const out = ccw(loop.map((q) => f.toWorld(q)));
  outlineCache.set(s, out);
  return out;
}

/** the plan rectangles of the pieces (an L stair is two or three; the U-turn's gap belongs to neither flight) */
export function stairRects(s: StairDef): Box[] {
  const f = stairFrame(s);
  return stairPieces(s).map(({ rect: [a, b, c, d] }) => { const p = f.toWorld([a, b]), q = f.toWorld([c, d]); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]; });
}

const inOutline = (s: StairDef, p: Vec2, m: number) => {
  const [x0, y0, x1, y1] = s.bbox;
  if (p[0] <= x0 - m || p[0] >= x1 + m || p[1] <= y0 - m || p[1] >= y1 + m) return false;
  const o = stairOutline(s);
  return o.length === 4 ? true : pointInPolygon(p, o, 0) || (m > 0 && distToPolygonEdges(p, o) < m);
};
/** stairs whose outline (with margin m) contains the point */
export const stairAt = (list: readonly StairDef[], p: Vec2, m = 0): StairDef | null => list.find((s) => inOutline(s, p, m)) ?? null;

const inRect = (q: Vec2, [x0, y0, x1, y1]: Box, e = 1e-9) => q[0] >= x0 - e && q[0] <= x1 + e && q[1] >= y0 - e && q[1] <= y1 + e;
const rectDist = (q: Vec2, [x0, y0, x1, y1]: Box) => Math.hypot(Math.max(x0 - q[0], 0, q[0] - x1), Math.max(y0 - q[1], 0, q[1] - y1));
/** the piece under a canonical point (the nearest one in the gap between U-turn flights) */
function pieceAt(s: StairDef, q: Vec2): StairPiece {
  const ps = stairPieces(s);
  return ps.find((p) => inRect(q, p.rect)) ?? ps.reduce((b, p) => (rectDist(q, p.rect) < rectDist(q, b.rect) ? p : b));
}

/** stair part under the point: the lower flight, the landing, the upper flight (`top`: the top landing of a straight flight) */
export function stairPart(p: Vec2, s: StairDef | null): StairPartId {
  if (!s) return 'landing';
  return pieceAt(s, stairFrame(s).toLocal(p)).id;
}

/** walking surface height on the stairs (a ramp along the step nosings — smooth camera motion) */
export function stairZ(p: Vec2, s: StairDef | null): number {
  if (!s) return 0;
  const q = stairFrame(s).toLocal(p), piece = pieceAt(s, q);
  return piece.kind === 'landing' ? piece.z : flightZ(piece, flightAlong(piece, q));
}

/** clearance kept from a side by a figure of radius r: walls the full radius, a balustrade and the partition a little less */
const CLEAR: Partial<Record<StairSideKind, number>> = { wall: 1, open: 0.7, partition: 0.6 };
/** whether a figure (radius r) fits on the stairs at point p: on a piece, clear of the walls, balustrades and partitions —
 *  passing between the flights of a U-turn only via the landing */
export function stairAllowed(p: Vec2, r: number, s: StairDef | null): boolean {
  if (!s) return false;
  const q = stairFrame(s).toLocal(p);
  if (!stairPieces(s).some((x) => inRect(q, x.rect))) return false;
  // a side keeps the figure off only beside it (not around its ends: the U-turn partition ends at the landing)
  return stairSides(s).every((e) => { const k = CLEAR[e.kind]; if (k === undefined) return true; const d = segDist(q, e.a, e.b); return d.t <= 0 || d.t >= 1 || d.d >= r * k; });
}

/** schematic steps: [x0, y0, x1, y1, zTop] (boxes from the lower level floor), from the bottom up */
export function stairSteps(s: StairDef): [number, number, number, number, number][] {
  const out: [number, number, number, number, number][] = [], f = stairFrame(s);
  for (const p of stairPieces(s)) {
    if (p.kind === 'landing') { out.push([...p.rect, p.z]); continue; }
    for (let i = 0; i < p.risers - 1; i++) out.push([...flightSlice(p, i * s.tread, (i + 1) * s.tread), p.z0 + s.riser * (i + 1)]);
  }
  return out.map(([a, b, c, d, z]) => { const p = f.toWorld([a, b]), q = f.toWorld([c, d]); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), z]; });
}

/** the landing height of stairs with a landing (null: a straight flight) */
export const stairLandingZ = (s: StairDef): number | null => (s.kind === 'straight' ? null : s.landingZ);
/** risers of every flight, from the bottom */
export const stairFlights = (s: StairDef): number[] => (s.kind === 'straight' ? [s.risers] : s.kind === 'l-turn' ? [s.risers, s.upperRisers] : [s.risers, s.risers]);

/** what a plan draws of the stairs (plan coordinates): the outline, the tread lines, the partition of a U-turn, the walking line
 *  from the foot of the lower flight to the top with its arrowhead, and a point for the label */
export interface StairDrawing { outline: Vec2[]; treads: [Vec2, Vec2][]; edges: [Vec2, Vec2][]; path: Vec2[]; head: [Vec2, Vec2, Vec2]; label: Vec2 }
export function stairDrawing(s: StairDef): StairDrawing {
  const f = stairFrame(s), W = f.toWorld, pieces = stairPieces(s), flights = pieces.filter((p): p is StairFlight => p.kind === 'flight');
  const treads: [Vec2, Vec2][] = [];
  flights.forEach((p, i) => {
    const n = p.risers - 1;
    for (let k = i === 0 ? 1 : 0; k <= (i === flights.length - 1 && pieces[pieces.length - 1] === p ? n - 1 : n); k++) {
      const [x0, y0, x1, y1] = flightSlice(p, k * s.tread, k * s.tread);
      treads.push(p.dir[0] ? [W([x0, y0]), W([x0, y1])] : [W([x0, y0]), W([x1, y0])]);
    }
  });
  const edges = stairSides(s).filter((e) => e.kind === 'partition').map((e) => [W(e.a), W(e.b)] as [Vec2, Vec2]);
  // the walking line: along the middle of each flight; on a landing between parallel flights across its middle
  const mid = (p: StairFlight): Vec2 => [(p.rect[0] + p.rect[2]) / 2, (p.rect[1] + p.rect[3]) / 2];
  const at = (p: StairFlight, d: number): Vec2 => { const [x0, y0] = flightSlice(p, d, d), c = mid(p); return p.dir[0] ? [x0, c[1]] : [c[0], y0]; };
  const f1 = flights[0], path: Vec2[] = [at(f1, Math.min(0.1, flightLength(f1) / 4))];
  for (let i = 1; i < flights.length; i++) {
    const a = flights[i - 1], b = flights[i], ca = mid(a), cb = mid(b), land = pieces.find((p) => p.kind === 'landing' && p.id === 'landing')!;
    if (a.dir[0] === 0 && b.dir[0] !== 0) path.push([ca[0], cb[1]]);
    else if (a.dir[0] !== 0 && b.dir[0] === 0) path.push([cb[0], ca[1]]);
    else if (a.dir[0] === 0) { const y = (land.rect[1] + land.rect[3]) / 2; path.push([ca[0], y], [cb[0], y]); }
    else { const x = (land.rect[0] + land.rect[2]) / 2; path.push([x, ca[1]], [x, cb[1]]); }
  }
  const fl = flights[flights.length - 1], L = flightLength(fl), tip = at(fl, Math.max(L / 2, L - 0.05)), back = at(fl, Math.max(L / 2 - 0.2, L - 0.25));
  const dx = tip[0] - back[0], dy = tip[1] - back[1], k = 0.12 / Math.max(1e-9, Math.hypot(dx, dy));
  path.push(at(fl, Math.max(L / 2, L - 0.15)));
  // the label beside the walking line, a quarter of the flight's width off it
  const lf = s.kind === 'straight' ? f1 : fl, lm = mid(lf), q = (lf.dir[0] ? lf.rect[3] - lf.rect[1] : lf.rect[2] - lf.rect[0]) / 4;
  const label: Vec2 = lf.dir[0] ? [lm[0], lm[1] + q] : [lm[0] + q, lm[1]];
  return { outline: stairOutline(s), treads, edges, path: path.map(W), head: [W(tip), W([back[0] - dy * k, back[1] + dx * k]), W([back[0] + dy * k, back[1] - dx * k])], label: W(label) };
}
