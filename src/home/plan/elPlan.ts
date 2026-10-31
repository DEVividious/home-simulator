// Electrical plan drawing as a list of vector primitives (polygons, circles, texts) in LCS metres (X right, Y up).
// The same drawing goes to the screen (SVG — ui/ElectricalPlan.tsx) and to the PDF (pdf/electricalPdf.ts), so the printout
// is vector-based and matches what the app shows. "Paper" sizes (line width, text height, symbol size) are given in
// millimetres of the printout and converted with the scale denominator `den`: 1 mm of paper = den / 1000 m.
// Symbols: a readable custom legend modelled on installation symbols (shape = layer, letter code = type). Pure TS.
import { hasGeneratedShell, levelShell } from '../model/shell';
import { allDoors, leafSegment, swingArc } from '../model/doors';
import {
  EL_LAYERS, EL_TYPES, elRooms, EXT, hasSite, houseFootprint, layerOf, measure, plotBoundary, siteLevelId, wallRuns, type ElectricalPlan, type ElLayer, type ElPoint, type ElRoom, type ElType,
} from '../model/electrical';
import { offsetPolygon } from '@home-sim/core/model/geom2d';
import { allLevels, DEFAULT_PLAN_WALL_OFFSET, levelById, levelName, roomById, roomsOfLevel, type RoomWall } from '../model/rooms';
import { stairs } from '../model/stairs';
import { stairDrawing } from '@home-sim/core/model/stairs';
import type { LevelId, Vec2 } from '../model/types';
import { t } from '../../i18n';

export type Prim =
  | { k: 'poly'; pts: Vec2[]; fill?: string; stroke?: string; lw?: number; close?: boolean; dash?: [number, number]; id?: string }
  | { k: 'circle'; c: Vec2; r: number; fill?: string; stroke?: string; lw?: number; id?: string }
  | { k: 'text'; at: Vec2; text: string; size: number; anchor?: 'start' | 'middle' | 'end'; color?: string; bold?: boolean; halo?: boolean; id?: string };

/** plan view: a project level or the site (exterior points further from the building) — the site only when the project has one */
export type PlanView = LevelId | 'SITE';
export const SITE_VIEW = 'SITE';
/** plan views of the project: levels from the lowest + the site */
export const planViews = (): PlanView[] => [...allLevels().map((l) => l.id), ...(hasSite() ? [SITE_VIEW] : [])];
export const planViewName = (view: PlanView): string => (view === SITE_VIEW ? t('plan.site') : levelName(view));

export interface PlanOptions {
  view: PlanView;
  plan: ElectricalPlan;
  layers: ElLayer[];
  /** scale denominator (1 : den) — conversion of paper sizes */
  den: number;
  /** furniture outlines as a light background (optional) */
  furniture?: Vec2[][];
  /** site context: terrace, driveway, gate line (light outlines) */
  /** label at a point: the id alone or id + distance and height (when there are few points) */
  dims?: 'id' | 'auto';
  /** (screen) label density — symbols only / symbols + id / full labels; field absent = print behaviour (`dims`) */
  labels?: 'none' | 'id' | 'full';
  /** room names in the background (the screen draws them itself — they are tappable); default yes */
  roomNames?: boolean;
  selected?: string | null;
  /** symbol colour: by layer (screen, colour PDF) or black */
  mono?: boolean;
  /** (screen) the plan of the level that opens onto the site shows ALL exterior points — a device placed on the lawn does not
   *  disappear from the plan it was placed on; field absent = print: only points within 2.5 m of the building (the rest are on the "Site" page) */
  allExterior?: boolean;
}
export interface PlacedPoint { id: string; type: ElType; at: Vec2; center: Vec2; r: number }
export interface PlanDrawing { prims: Prim[]; symbols: Prim[]; bounds: [number, number, number, number]; points: PlacedPoint[]; types: ElType[]; den: number }

const WALL = '#7d838c', LINE = '#2b3038', LIGHT = '#b9bec6', FAINT = '#dfe2e6';
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];

/** exterior points further than 2.5 m from the building outline — shown on the "Site" plan */
export function isSitePoint(p: ElPoint): boolean {
  if (p.roomId !== EXT || p.orientation === 'wall') return false;
  const q: Vec2 = [p.x ?? 0, p.y ?? 0], F = houseFootprint();
  let d = Infinity;
  for (let i = 0; i < F.length; i++) { const a = F[i], b = F[(i + 1) % F.length], ab: Vec2 = [b[0] - a[0], b[1] - a[1]], L2 = ab[0] * ab[0] + ab[1] * ab[1]; const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / L2)); d = Math.min(d, Math.hypot(q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t)); }
  return d > 2.5;
}
/** points of a view: a level (interiors + facade and, on the level that opens onto the site, exterior points: in print only nearby
 *  ones — within 2.5 m of the building, on screen (`allExterior`) all of them) or the site (all exterior points) */
export function pointsOfView(plan: ElectricalPlan, view: PlanView, layers: ElLayer[], allExterior = false): ElPoint[] {
  return plan.points.filter((p) => {
    if (!layers.includes(layerOf(p.type))) return false;
    if (view === 'SITE') return p.roomId === EXT;
    if (p.roomId === EXT) return view === siteLevelId() && (allExterior || !isSitePoint(p));
    return roomById(p.roomId)?.level === view;
  });
}

/** drawing area [x0, y0, x1, y1] */
export function viewBounds(view: PlanView, pts: ElPoint[]): [number, number, number, number] {
  const xs: number[] = [], ys: number[] = [];
  if (view === 'SITE') { for (const p of plotBoundary()) { xs.push(p[0]); ys.push(p[1]); } }
  else if (view === siteLevelId()) { for (const p of houseFootprint()) { xs.push(p[0]); ys.push(p[1]); } }
  else for (const r of roomsOfLevel(view)) { xs.push(r.bbox[0], r.bbox[2]); ys.push(r.bbox[1], r.bbox[3]); }
  for (const p of pts) { const m = measure(p); if (m) { xs.push(m.pos[0]); ys.push(m.pos[1]); } }
  const pad = view === 'SITE' ? 1.5 : 1.3;
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** point symbol in a local frame: origin at the point on the wall, e2 — into the room (for ceiling / free points the symbol
 *  is centred on the point). S — symbol size [m], lw — line width [m]. */
export function symbolPrims(p: ElPoint, at: Vec2, n: Vec2, S: number, lw: number, color: string): { prims: Prim[]; center: Vec2; r: number } {
  const wallMounted = n[0] !== 0 || n[1] !== 0, e2: Vec2 = wallMounted ? n : [0, 1], e1: Vec2 = wallMounted ? [n[1], -n[0]] : [1, 0];
  const L = (u: number, v: number): Vec2 => [at[0] + e1[0] * u + e2[0] * v, at[1] + e1[1] * u + e2[1] * v];
  const def = EL_TYPES[p.type], out: Prim[] = [], id = p.id;
  const cy = wallMounted ? 0.95 * S : 0, C = L(0, cy), r = 0.5 * S;
  const arc = (c: Vec2, rr: number, a0: number, a1: number, k = 14): Vec2[] => Array.from({ length: k + 1 }, (_, i) => { const a = ((a0 + ((a1 - a0) * i) / k) * Math.PI) / 180; return [c[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * rr, c[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * rr] as Vec2; });
  const stem = (to: number) => { if (wallMounted) out.push({ k: 'poly', pts: [L(0, 0), L(0, to)], stroke: color, lw, id }); };
  const code = (txt: string, size = 0.36 * S, col = color) => { if (txt) out.push({ k: 'text', at: [C[0], C[1] - size * 0.36], text: txt, size, anchor: 'middle', color: col, bold: true, id }); };
  const layer = def.layer;
  if (p.type === 'board') {
    // distribution board: rectangle on the wall (nominal width), half filled
    const w = Math.max(p.width ?? 0.6, 1.3 * S) / 2, d = 0.55 * S;
    out.push({ k: 'poly', pts: [L(-w, 0), L(w, 0), L(w, d), L(-w, d)], fill: '#ffffff', stroke: color, lw: lw * 1.3, close: true, id });
    out.push({ k: 'poly', pts: [L(-w, 0), L(w, 0), L(-w, d)], fill: color, close: true, id });
    return { prims: out, center: L(0, d / 2), r: Math.max(w, d) };
  }
  if (layer === 'sockets') {
    // socket: semicircle open towards the room on a stem; exterior — filled; number of sockets / code beside it
    stem(cy - r);
    out.push({ k: 'poly', pts: [...arc(C, r, 180, 360), L(-r, cy)], fill: p.type === 'socket-ext' ? color : '#ffffff', stroke: color, lw, close: true, id });
    out.push({ k: 'poly', pts: [L(0, cy), L(0, cy + 0.45 * r)], stroke: color, lw, id });
    const txt = p.type === 'ev' || p.type === 'power3f' || p.type === 'socket-ext' ? def.code : p.modules > 1 ? String(p.modules) : '';
    if (txt) out.push({ k: 'text', at: add(L(r * 1.25, cy - r * 0.55), [0, -0.13 * S]), text: txt, size: 0.4 * S, anchor: 'start', color, bold: true, id });
    return { prims: out, center: C, r: r * 1.1 };
  }
  if (p.type === 'switch') {
    stem(cy - 0.24 * S);
    out.push({ k: 'circle', c: C, r: 0.24 * S, fill: '#ffffff', stroke: color, lw, id });
    out.push({ k: 'poly', pts: [L(0.17 * S, cy + 0.17 * S), L(0.62 * S, cy + 0.62 * S), L(0.84 * S, cy + 0.4 * S)], stroke: color, lw, id });
    return { prims: out, center: C, r: 0.7 * S };
  }
  if (p.type === 'light') {
    const k = r * Math.SQRT1_2;
    out.push({ k: 'circle', c: C, r, fill: '#ffffff', stroke: color, lw, id });
    out.push({ k: 'poly', pts: [[C[0] - k, C[1] - k], [C[0] + k, C[1] + k]], stroke: color, lw, id }, { k: 'poly', pts: [[C[0] - k, C[1] + k], [C[0] + k, C[1] - k]], stroke: color, lw, id });
    return { prims: out, center: C, r };
  }
  stem(cy - r);
  if (layer === 'data') out.push({ k: 'poly', pts: [L(-r, cy - r), L(r, cy - r), L(r, cy + r), L(-r, cy + r)], fill: '#ffffff', stroke: color, lw, close: true, id });
  else if (layer === 'smart') {
    out.push({ k: 'poly', pts: [L(0, cy - r * 1.15), L(r * 1.15, cy), L(0, cy + r * 1.15), L(-r * 1.15, cy)], fill: '#ffffff', stroke: color, lw, close: true, id });
    if (p.type === 'ceiling-smart') out.push({ k: 'circle', c: C, r: r * 1.45, stroke: color, lw, id });
  } else out.push({ k: 'circle', c: C, r, fill: '#ffffff', stroke: color, lw, id });
  code(def.code, def.code.length >= 3 ? 0.3 * S : 0.42 * S);
  return { prims: out, center: C, r: r * 1.2 };
}

/** plan drawing of a view: architectural background + point symbols + ids */
export function buildPlan(o: PlanOptions): PlanDrawing {
  const mm = (v: number) => (v * o.den) / 1000, prims: Prim[] = [], symbols: Prim[] = [];
  const pts = pointsOfView(o.plan, o.view, o.layers, o.allExterior), bounds = viewBounds(o.view, pts);
  // the site plan shows the level that opens onto the site in the background
  const siteLevel = siteLevelId(), level: LevelId = o.view === 'SITE' ? siteLevel ?? '' : o.view;
  const rooms = roomsOfLevel(level), atGround = level === siteLevel;
  // ---- background: plot boundary
  if (o.view === 'SITE') prims.push({ k: 'poly', pts: plotBoundary(), stroke: '#6c9a3b', lw: mm(0.35), close: true, dash: [mm(2.2), mm(1)] });
  // ---- wall mass: shell generated from rooms — exactly its walls; model from a file — building outline (level at
  //      ground) + rooms widened by half the wall thickness
  if (hasGeneratedShell()) {
    if (o.view !== 'SITE') for (const [x0, y0, x1, y1] of levelShell(level).mass) prims.push({ k: 'poly', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill: WALL, close: true });
  } else {
    if (atGround) prims.push({ k: 'poly', pts: houseFootprint(), fill: WALL, close: true });
    if (o.view !== 'SITE') for (const r of rooms) prims.push({ k: 'poly', pts: offsetPolygon(r.polygon, levelById(level)?.planWallOffset ?? DEFAULT_PLAN_WALL_OFFSET), fill: WALL, close: true });
  }
  for (const r of rooms) prims.push({ k: 'poly', pts: r.polygon, fill: '#ffffff', stroke: o.view === 'SITE' ? undefined : LINE, lw: mm(0.18), close: true });
  if (o.view !== 'SITE') {
    // ---- openings: doors (gap through the wall thickness), windows (double line)
    for (const r of rooms) for (const w of r.walls as RoomWall[]) for (const h of w.holes) {
      const out: Vec2 = [-w.inward[0], -w.inward[1]], A = add(w.a, w.dir, h.t0), B = add(w.a, w.dir, h.t1);
      if (h.kind === 'door' || h.kind === 'passage') prims.push({ k: 'poly', pts: [add(A, out, -0.01), add(B, out, -0.01), add(B, out, 0.3), add(A, out, 0.3)], fill: '#ffffff', close: true });
      else {
        prims.push({ k: 'poly', pts: [A, B, add(B, out, 0.24), add(A, out, 0.24)], fill: '#ffffff', close: true });
        for (const d of [0.07, 0.17]) prims.push({ k: 'poly', pts: [add(A, out, d), add(B, out, d)], stroke: '#3f7fbf', lw: mm(0.16) });
      }
    }
    // ---- interior doors: open leaf and swing arc
    for (const d of allDoors().filter((x) => x.level === level)) {
      const arc = swingArc(d, 12), leaf = leafSegment(d, 1);
      if (arc.length > 1) prims.push({ k: 'poly', pts: arc, stroke: LIGHT, lw: mm(0.12) });
      if (leaf) prims.push({ k: 'poly', pts: [leaf.a, leaf.b], stroke: '#8a9099', lw: mm(0.22) });
    }
    // ---- stairs
    for (const st of stairs().filter((x) => x.fromLevel === level || x.toLevel === level)) {
      const d = stairDrawing(st);
      prims.push({ k: 'poly', pts: d.outline, stroke: LIGHT, lw: mm(0.14), close: true });
      for (const [a, b] of d.treads) prims.push({ k: 'poly', pts: [a, b], stroke: FAINT, lw: mm(0.1) });
    }
    // ---- furniture as a light background
    for (const f of o.furniture ?? []) prims.push({ k: 'poly', pts: f, stroke: '#c9cdd3', lw: mm(0.1), close: true, fill: '#f6f7f8' });
    // ---- room names
    if (o.roomNames !== false) for (const r of rooms) prims.push({ k: 'text', at: [r.center[0], r.center[1]], text: `${r.id} ${r.label}`, size: mm(r.area < 6 ? 1.7 : 2.1), anchor: 'middle', color: '#9aa1ab' });
  }
  // ---- points: reference corners, symbols, ids
  const S = mm(4.2), lw = mm(0.3), placed: PlacedPoint[] = [], boxes: [number, number, number, number][] = [];
  const dims = o.labels ? o.labels === 'full' : o.dims === 'auto' && pts.length <= 28;
  const ids = o.labels !== 'none';
  const refs = new Set<string>();
  const types = new Set<ElType>();
  const sorted = [...pts].sort((a, b) => a.id.localeCompare(b.id, 'pl', { numeric: true }));
  for (const p of sorted) {
    const m = measure(p);
    if (!m) continue;
    types.add(p.type);
    const color = o.mono ? '#111111' : o.selected === p.id ? '#0d6efd' : EL_LAYERS[layerOf(p.type)].color;
    const at: Vec2 = [m.pos[0], m.pos[1]], sym = symbolPrims(p, at, m.normal, S, o.selected === p.id ? lw * 1.6 : lw, color);
    symbols.push(...sym.prims);
    placed.push({ id: p.id, type: p.type, at, center: sym.center, r: sym.r });
    // reference corner of the wall run (left, seen from the room) — marker + wall number
    if (ids && m.run && !refs.has(`${m.room.id}:${m.run.index}`)) {
      refs.add(`${m.room.id}:${m.run.index}`);
      const b = m.run.b, d = m.run.dir, n = m.run.inward, t = mm(1.5);
      const c0 = add(add(b, d, -mm(0.4)), n, mm(0.4));
      symbols.push({ k: 'poly', pts: [c0, add(c0, d, -t), add(c0, n, t)], fill: '#111111', close: true });
      symbols.push({ k: 'text', at: add(add(b, d, -mm(3.4)), n, mm(1.6)), text: String(m.run.index), size: mm(1.7), anchor: 'middle', color: '#111111', bold: true, halo: true });
    }
    if (!ids) continue;                                                        // symbols only (screen, default)
    // id (and dimensions, when there is room): the first free spot around the symbol
    const ts = mm(2.2), txt = p.id, sub = dims && m.fromLeft !== null ? `${Math.round(m.fromLeft * 100)} · h${Math.round(p.heightAFFL * 100)}` : dims && p.orientation !== 'wall' ? '' : '';
    const w = Math.max(txt.length * ts * 0.62, sub.length * mm(1.5) * 0.56) + ts * 0.4, h = ts * 1.15 + (sub ? mm(1.9) : 0);
    const wallN: Vec2 = m.normal[0] || m.normal[1] ? m.normal : [0, -1], along: Vec2 = [wallN[1], -wallN[0]];
    const tries: Vec2[] = [add(sym.center, wallN, sym.r + h * 0.6 + mm(0.4)), add(sym.center, along, sym.r + w / 2 + mm(0.5)), add(sym.center, along, -(sym.r + w / 2 + mm(0.5))), add(sym.center, wallN, sym.r + h * 1.7 + mm(0.4)),
      add(add(sym.center, wallN, sym.r + h * 0.6), along, w * 0.9), add(add(sym.center, wallN, sym.r + h * 0.6), along, -w * 0.9)];
    let pos = tries[0];
    for (const c of tries) { const bx: [number, number, number, number] = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2]; if (!boxes.some((q) => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) { pos = c; break; } }
    boxes.push([pos[0] - w / 2, pos[1] - h / 2, pos[0] + w / 2, pos[1] + h / 2], [sym.center[0] - sym.r, sym.center[1] - sym.r, sym.center[0] + sym.r, sym.center[1] + sym.r]);
    symbols.push({ k: 'text', at: [pos[0], pos[1] + (sub ? mm(0.5) : -ts * 0.36)], text: txt, size: ts, anchor: 'middle', color: '#111111', bold: true, halo: true, id: p.id });
    if (sub) symbols.push({ k: 'text', at: [pos[0], pos[1] - mm(1.7)], text: sub, size: mm(1.5), anchor: 'middle', color: '#333333', halo: true, id: p.id });
  }
  return { prims, symbols, bounds, points: placed, types: EL_TYPE_ORDER.filter((t) => types.has(t)), den: o.den };
}
const EL_TYPE_ORDER = Object.keys(EL_TYPES) as ElType[];

/** the largest scale from a standard series at which the area [m] fits the drawing field [mm] */
export const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
export function fitScale(bounds: [number, number, number, number], wMm: number, hMm: number): number {
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
  return SCALES.find((d) => (w * 1000) / d <= wMm && (h * 1000) / d <= hMm) ?? SCALES[SCALES.length - 1];
}
/**
 * How many pixels to shift the content TOWARDS THE AXIS ORIGIN (up / left) so that a point at screen coordinate `s` lands in
 * [pad0, size − pad1]; 0 — already inside; a negative value — the other way. Field narrower than the margins: the point goes to the first margin.
 */
export const shiftIntoView = (s: number, size: number, pad0: number, pad1: number): number => s - Math.max(pad0, Math.min(Math.max(pad0, size - pad1), s));
/** rooms of a view — for hit-testing clicks in the plan */
export const roomsOfView = (view: PlanView): ElRoom[] => (view === 'SITE' ? elRooms(siteLevelId() ?? '').filter((r) => r.exterior) : elRooms(view));
export { wallRuns };
