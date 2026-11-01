// plan.json → project.json. Deterministic: the same plan always yields the same package. Everything a person or an
// agent tends to get wrong by hand is derived here: units and the y flip of image coordinates, polygon order (counter-
// clockwise from the lowest-left corner — wall ids <room>-w<n> follow it), areas and bounding boxes, the door gap in BOTH
// rooms with the wall faces it crosses, hinge position and directions from "hinge side + room it opens into", window wall
// axis and face, stairs from risers and level heights, furniture against a wall, provenance on every fact.
// Problems are returned as issues (error / warning); the CLI refuses to write a package with errors.
import { flatCeiling, roofCeiling, type CeilingProfile } from '../model/ceiling.ts';
import { leafSectors, SECTIONAL, type LeafSector } from '../model/doors.ts';
import { distToPolygonEdges } from '../model/geom2d.ts';
import { outerOutline } from '../model/outline.ts';
import { canonicalDir, lineC, lineFrame, linePt, lineT, type LineAxis, type LineFrame } from '../model/wallLine.ts';
import { areaBelow, atticPlanes, surfaceAt, surfaceFacets, type RoofPiece } from '../model/roof.ts';
import type { ArchitectItem, DoorDef, FreeWallJson, ElectricalDefaults, ProjectModule, ProjectPackage, Rect, RoomJson, StairDef, Vec2, Viewpoint } from '../package/types.ts';
import { PlanSchema, type Plan, type PlanInput } from './plan.ts';
import { outOfRange, rangeMessage } from '../package/range.ts';
import { compileRoof } from './roof.ts';

export interface Issue { level: 'error' | 'warning'; code: string; message: string }
export interface CatalogItemInfo { id: string; dimensions: { w: number; d: number; h: number }; variants?: { id: string; dimensions?: Partial<{ w: number; d: number; h: number }> }[]; mount?: string }
export interface CompileResult { project: ProjectPackage | null; issues: Issue[]; adjustments: string[] }

const EPS = 1e-6;
/** full opening of a bifold door [°]: its panels fold into a narrow V, not flat against each other */
const FOLD_ANGLE = 80;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const snap5 = (x: number) => Math.round(x * 200) / 200;
const cleanZero = (x: number) => (Object.is(x, -0) ? 0 : x);

// ------------------------------------------------------------------ polygons
const area2 = (p: Vec2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
/** counter-clockwise, starting at the vertex with the smallest y, then the smallest x; collinear duplicates removed */
export function normalizePolygon(poly: Vec2[]): Vec2[] {
  let p = poly.filter((q, i) => { const n = poly[(i + 1) % poly.length]; return Math.abs(q[0] - n[0]) > EPS || Math.abs(q[1] - n[1]) > EPS; });
  p = p.filter((q, i) => { const a = p[(i + p.length - 1) % p.length], b = p[(i + 1) % p.length]; return Math.abs((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])) > EPS; });
  if (area2(p) < 0) p = [...p].reverse();
  let k = 0;
  p.forEach((q, i) => { if (q[1] < p[k][1] - EPS || (Math.abs(q[1] - p[k][1]) <= EPS && q[0] < p[k][0])) k = i; });
  return [...p.slice(k), ...p.slice(0, k)].map(([x, y]) => [cleanZero(r3(x)), cleanZero(r3(y))] as Vec2);
}
const rectPoly = ([x0, y0, x1, y1]: number[]): Vec2[] => [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]];
const bboxOf = (p: Vec2[]) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))] as [number, number, number, number];
function inPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const orthogonal = (p: Vec2[]) => p.every((a, i) => { const b = p[(i + 1) % p.length]; return Math.abs(a[0] - b[0]) <= EPS || Math.abs(a[1] - b[1]) <= EPS; });
/** area shared by two outlines: orthogonal — cells of the grid spanned by both outlines' coordinates, inside both; with slanted
 *  edges — 1 cm samples strictly inside both (outlines that only touch along an edge share nothing) */
function overlapArea(pa: Vec2[], pb: Vec2[]): number {
  const [ax0, ay0, ax1, ay1] = bboxOf(pa), [bx0, by0, bx1, by1] = bboxOf(pb);
  if (Math.min(ax1, bx1) <= Math.max(ax0, bx0) || Math.min(ay1, by1) <= Math.max(ay0, by0)) return 0;
  if (!orthogonal(pa) || !orthogonal(pb)) {
    const x0 = Math.max(ax0, bx0), x1 = Math.min(ax1, bx1), y0 = Math.max(ay0, by0), y1 = Math.min(ay1, by1), h = 0.01;
    const inside = (q: Vec2, p: Vec2[]) => inPolygon(q, p) && distToPolygonEdges(q, p) > 1e-6;
    let n = 0;
    for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) if (inside([x, y], pa) && inside([x, y], pb)) n++;
    return n * h * h;
  }
  const xs = [...new Set([...pa, ...pb].map((q) => q[0]))].sort((u, v) => u - v), ys = [...new Set([...pa, ...pb].map((q) => q[1]))].sort((u, v) => u - v);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const c: Vec2 = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
    if (inPolygon(c, pa) && inPolygon(c, pb)) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  }
  return area;
}

/** an edge of a room outline with its outward side: on the line c of its wall frame (model/wallLine.ts) — along X (c = y), along
 *  Y (c = x) or slanted ("D": its own direction) — from lo to hi along it */
interface Edge extends LineFrame {
  room: string; axis: LineAxis; a: Vec2; b: Vec2;
  /** coordinate of the face (constant) */ c: number; lo: number; hi: number;
  /** +1 — the room is on the smaller side of the face, outward = +n; −1 — outward = −n */ out: 1 | -1;
}
function edgesOf(roomId: string, poly: Vec2[]): Edge[] {
  const out: Edge[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], d: Vec2 = [b[0] - a[0], b[1] - a[1]];
    if (Math.hypot(d[0], d[1]) <= EPS) return;
    const axis: LineAxis = Math.abs(d[1]) <= EPS ? 'X' : Math.abs(d[0]) <= EPS ? 'Y' : 'D', f = lineFrame(axis, axis === 'D' ? canonicalDir(d) : null);
    // CCW: the interior is on the left of a → b; outward normal = (dy, −dx)
    const ta = lineT(f, a), tb = lineT(f, b), o = d[1] * f.n[0] - d[0] * f.n[1];
    out.push({ room: roomId, axis, ...f, a, b, c: lineC(f, a), lo: Math.min(ta, tb), hi: Math.max(ta, tb), out: o > 0 ? 1 : -1 });
  });
  return out;
}
/** coordinate of a point along an edge and across it */
const alongOf = (e: LineFrame, p: Vec2) => lineT(e, p);
const acrossOf = (e: LineFrame, p: Vec2) => lineC(e, p);
/** two edges on parallel lines (the same kind of frame; slanted: directions within 2°) */
const parallel = (e1: Edge, e2: Edge) => e1.axis === e2.axis && (e1.axis !== 'D' || Math.abs(e1.dir[0] * e2.dir[1] - e1.dir[1] * e2.dir[0]) < 0.035);
/** another edge seen in the frame of e: its face coordinate and its range along e */
const inFrameOf = (e: Edge, o: Edge) => (e.axis !== 'D' ? o : { c: (acrossOf(e, o.a) + acrossOf(e, o.b)) / 2, lo: Math.min(alongOf(e, o.a), alongOf(e, o.b)), hi: Math.max(alongOf(e, o.a), alongOf(e, o.b)) });
/** a gap's / window's wall line: the frame kind and, slanted, its direction (written before the coordinates) */
const lineOf = (e: Edge) => (e.axis === 'D' ? { along: 'D' as const, dir: e.dir.map((v) => r6(v)) as Vec2 } : { along: e.axis });

export interface CompileOptions {
  /** furniture catalog the plan's items are checked against; null — no catalog: items are placed with their own `dims` and not
   *  checked (tools that only need the building, e.g. the print export) */
  catalog: CatalogItemInfo[] | null;
  /** room ids and their vertex counts recorded when the package was released (projects/<id>/ids.lock.json) */
  lock?: { rooms: Record<string, { vertices: number; first: Vec2 }> } | null;
}

export function compilePlan(input: PlanInput | unknown, opts: CompileOptions): CompileResult {
  const issues: Issue[] = [], adjustments: string[] = [];
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 60)) err('schema', `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { project: null, issues, adjustments };
  }
  const plan: Plan = parsed.data, D = plan.defaults, source = plan.source;

  // ---- units: px → metres (y flipped), sizes stay in metres
  // a px plan may give each level its own calibration (one image per level); points convert with their level's
  let toM = (p: Vec2, _level?: string): Vec2 => p;
  if (plan.units === 'px') {
    const cal = new Map(plan.levels.flatMap((l) => (l.calibration ? [[l.id, l.calibration] as const] : [])));
    if (!plan.calibration && cal.size < plan.levels.length) { err('calibration', 'units "px" need a calibration block (pxPerM, originPx) — for the plan or for every level'); return { project: null, issues, adjustments }; }
    toM = ([x, y], level) => { const c = (level && cal.get(level)) || plan.calibration || [...cal.values()][0]; return [(x - c.originPx[0]) / c.pxPerM, (c.originPx[1] - y) / c.pxPerM]; };
    for (const [where, c] of [...(plan.calibration ? [['plan', plan.calibration] as const] : []), ...[...cal].map(([l, c]) => [`level ${l}`, c] as const)]) {
      // symbol priors are weak: they count only when nothing measured exists (as in tools/image/calibrate.py)
      const all = c.methods ?? [], measured = all.filter((m) => !m.method.startsWith('symbol')), ms = measured.length ? measured : all;
      if (ms.length < 2) warn('calibration.methods', `${where}: fewer than two independent scale estimates — ask for one known dimension to confirm the scale`);
      else {
        const vals = ms.map((m) => m.pxPerM), spread = (Math.max(...vals) - Math.min(...vals)) / c.pxPerM;
        if (spread > 0.05) warn('calibration.agreement', `${where}: scale estimates differ by ${(spread * 100).toFixed(1)} % (> 5 %): ${ms.map((m) => `${m.method} ${m.pxPerM.toFixed(2)}`).join(', ')}`);
      }
    }
  }
  const regularize = plan.regularize ?? plan.units === 'px';
  const roomLevel = new Map(plan.rooms.map((r) => [r.id, r.level]));
  /** a point of the plan in project metres; `at` = the level (or a room of it) whose image it was read from */
  const P = (p: Vec2, at?: string): Vec2 => { const q = toM(p, at && (roomLevel.get(at) ?? at)); return regularize ? [snap5(q[0]), snap5(q[1])] : [r3(q[0]), r3(q[1])]; };

  // ---- levels
  const levels = new Map(plan.levels.map((l) => [l.id, l]));
  const sortedLevels = [...plan.levels].sort((a, b) => a.floorZ - b.floorZ);
  const lowest = sortedLevels[0];

  // ---- rooms: outlines in metres
  const outlines = new Map<string, Vec2[]>();
  for (const r of plan.rooms) {
    if (!levels.has(r.level)) err('room.level', `room "${r.id}": unknown level "${r.level}"`);
    if (outlines.has(r.id)) err('room.id', `room "${r.id}": repeated id`);
    const raw = r.rect ? rectPoly([...P([r.rect[0], r.rect[1]], r.level), ...P([r.rect[2], r.rect[3]], r.level)]) : r.polygon!.map((q) => P(q, r.level));
    outlines.set(r.id, raw);
  }
  if (regularize) regularizeWalls(plan, outlines, D.interiorWall, adjustments);
  const polys = new Map<string, Vec2[]>();
  for (const r of plan.rooms) {
    const poly = normalizePolygon(outlines.get(r.id)!);
    polys.set(r.id, poly);
    // walls run along the plan axes or at 45° to them (a chamfered corner, a bay); other angles are not built
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length], deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, off = Math.abs(deg / 45 - Math.round(deg / 45)) * 45;
      if (off > 1.5) err('room.angle', `room "${r.id}": edge ${i} runs at ${Math.round(((deg % 180) + 180) % 180)}° — walls must run along the plan axes or at 45° to them`);
    });
    const lk = opts.lock?.rooms[r.id];
    if (lk && (lk.vertices !== poly.length || Math.abs(lk.first[0] - poly[0][0]) > 0.3 || Math.abs(lk.first[1] - poly[0][1]) > 0.3)) err('ids.lock', `room "${r.id}": the outline changed its vertex count or first corner since the package was released — wall ids would shift (user data refers to them). Re-lock with --force-relock if this is intended.`);
  }
  if (opts.lock) for (const id of Object.keys(opts.lock.rooms)) if (!polys.has(id)) err('ids.lock', `room "${id}" was released and is missing now`);
  const edges = new Map<string, Edge[]>([...polys].map(([id, p]) => [id, edgesOf(id, p)]));
  const levelOfRoom = (id: string) => plan.rooms.find((r) => r.id === id)?.level;

  // overlapping rooms on a level
  for (const a of plan.rooms) for (const b of plan.rooms) {
    if (a.id >= b.id || a.level !== b.level) continue;
    if (overlapArea(polys.get(a.id)!, polys.get(b.id)!) > 0.02 * 0.02) err('room.overlap', `rooms "${a.id}" and "${b.id}" overlap`);
  }

  // ---- the roof (plan roof block, or a gable from every level slope)
  const along = (axis: 0 | 1, c: number, level: string) => (axis === 0 ? P([c, 0], level)[0] : P([0, c], level)[1]);
  const roof = compileRoof({ plan, P, along, polys, err, warn });

  // ---- walls between rooms: thickness lint
  for (const a of plan.rooms) for (const b of plan.rooms) {
    if (a.id >= b.id || a.level !== b.level) continue;
    for (const ea of edges.get(a.id)!) for (const e2 of edges.get(b.id)!) {
      if (!parallel(ea, e2) || ea.out === e2.out) continue;
      const eb = inFrameOf(ea, e2), gap = (eb.c - ea.c) * ea.out, overlap = Math.min(ea.hi, eb.hi) - Math.max(ea.lo, eb.lo);
      if (gap > 0.005 && gap < 0.5 && overlap > 0.3 && Math.abs(gap - D.interiorWall) > 0.015 && Math.abs(gap - D.exteriorWall) > 0.015) {
        warn('wall.thickness', `wall between "${a.id}" and "${b.id}" is ${r3(gap)} m thick (interior ${D.interiorWall}, exterior ${D.exteriorWall}) — check the outlines; if the drawing really shows it, keep it (the shell fills the gap) and note it in the README`);
      }
    }
  }

  // ---- door and passage gaps
  const gaps = new Map<string, RoomJson['doors']>();
  const addGap = (roomId: string, g: RoomJson['doors'][number]) => { const l = gaps.get(roomId) ?? []; l.push(g); gaps.set(roomId, l); };
  /** the wall of `a` facing `b` (or the exterior) through which the opening at p passes */
  const wallBetween = (a: string, b: string, p: Vec2, w: number, what: string): { axis: LineAxis; frame: LineFrame; faces: [number, number]; from: number; to: number; edgeA: Edge; edgeB: Edge | null } | null => {
    const ea = edges.get(a), eb = b === 'exterior' ? null : edges.get(b);
    if (!ea) { err('ref', `${what}: unknown room "${a}"`); return null; }
    if (b !== 'exterior' && !eb) { err('ref', `${what}: unknown room "${b}"`); return null; }
    if (b !== 'exterior' && levelOfRoom(a) !== levelOfRoom(b)) { err('ref', `${what}: rooms "${a}" and "${b}" are on different levels`); return null; }
    let best: { score: number; res: NonNullable<ReturnType<typeof wallBetween>> } | null = null;
    for (const e1 of ea) {
      const t = alongOf(e1, p);
      if (t < e1.lo - 0.05 || t > e1.hi + 0.05) continue;
      const from = r3(t - w / 2), to = r3(t + w / 2);
      if (from < e1.lo - 0.005 || to > e1.hi + 0.005) continue;
      if (eb) {
        for (const o2 of eb) {
          if (!parallel(e1, o2) || o2.out === e1.out) continue;
          const e2 = inFrameOf(e1, o2), gap = (e2.c - e1.c) * e1.out;
          if (gap <= 0 || gap > 0.8 || from < e2.lo - 0.005 || to > e2.hi + 0.005) continue;   // up to a wall with a flue in it
          const mid = (e1.c + e2.c) / 2, off = Math.abs(acrossOf(e1, p) - mid), score = off + Math.abs(t - (from + to) / 2);
          if (off > gap / 2 + 0.3) continue;                 // "at" must be on (or right next to) this wall
          if (!best || score < best.score) best = { score, res: { axis: e1.axis, frame: e1, faces: [Math.min(e1.c, e2.c), Math.max(e1.c, e2.c)].map(r3) as [number, number], from, to, edgeA: e1, edgeB: o2 } };
        }
      } else {
        // exterior: nothing of the same level within the exterior wall thickness on the outward side
        const outer = r3(e1.c + e1.out * D.exteriorWall);
        const blocked = plan.rooms.some((r) => r.id !== a && r.level === levelOfRoom(a) && edges.get(r.id)!.some((o) => { if (!parallel(o, e1) || o.out === e1.out) return false; const e = inFrameOf(e1, o); return (e.c - e1.c) * e1.out > 0 && (e.c - e1.c) * e1.out < 0.6 && Math.min(e.hi, to) - Math.max(e.lo, from) > 0; }));
        if (blocked) continue;
        const score = Math.abs(acrossOf(e1, p) - (e1.c + outer) / 2);
        if (score > 0.8) continue;
        if (!best || score < best.score) best = { score, res: { axis: e1.axis, frame: e1, faces: [Math.min(e1.c, outer), Math.max(e1.c, outer)].map(r3) as [number, number], from, to, edgeA: e1, edgeB: null } };
      }
    }
    if (!best) err('door.wall', `${what}: no wall ${b === 'exterior' ? `of "${a}" on the outside of the building` : `shared by "${a}" and "${b}"`} holds a ${w} m opening at [${p.map(r3).join(', ')}] — move "at" onto the wall or check the outlines`);
    return best?.res ?? null;
  };

  const doors: DoorDef[] = [];
  for (const d of plan.doors) {
    const [a, b] = d.between, what = `door "${d.id}"`;
    const p = P(d.at, a), w = d.width;
    const wall = wallBetween(a, b, p, w, what);
    if (!wall) continue;
    const opHeight = d.height ?? D.doorHeight, leafW = r3(w - 0.1);
    const gap = { ...lineOf(wall.edgeA), from_: wall.from, to: wall.to, across: wall.faces, width: r2(w), door_id: d.id, leaf: r2(leafW), height: opHeight } as RoomJson['doors'][number];
    addGap(a, gap); if (b !== 'exterior') addGap(b, { ...gap });
    const base: Pick<DoorDef, 'id' | 'level' | 'rooms' | 'floorZ' | 'opening' | 'leafWidth' | 'height' | 'type' | 'source' | 'confidence'> = { id: d.id, level: levelOfRoom(a)!, rooms: [a, b], floorZ: levels.get(levelOfRoom(a)!)?.floorZ ?? 0,
      opening: { ...(({ along, dir }) => (dir ? { along, dir } : { along }))(lineOf(wall.edgeA)), from: wall.from, to: wall.to, faces: [...wall.faces], width: r2(w), height: opHeight }, leafWidth: r2(leafW), height: d.leafHeight ?? D.leafHeight,
      type: d.type, source: [d.source ?? source], confidence: d.confidence ?? D.confidence };
    // the wall line runs along `axis`; unit vector along it and the across direction
    const f = wall.frame, u: Vec2 = f.dir, at = (t: number, c: number): Vec2 => (wall.axis === 'D' ? linePt(f, t, c).map(r3) as Vec2 : linePt(f, t, c));
    if (d.type === 'hinged-single' || d.type === 'hinged-double' || d.type === 'folding') {
      const into = d.swingInto ?? (b === 'exterior' ? a : b);
      if (into !== a && into !== b) { err('door.swing', `${what}: swingInto "${into}" is not one of ${a} / ${b}`); continue; }
      // face of the room the door opens into and the normal into that room (outwards: the outer face of the exterior wall)
      const intoEdge = into === a ? wall.edgeA : into === 'exterior' ? { c: r3(wall.edgeA.c + wall.edgeA.out * D.exteriorWall), out: -wall.edgeA.out } : wall.edgeB!;
      const n: Vec2 = [-intoEdge.out * f.n[0], -intoEdge.out * f.n[1]];
      const view: Vec2 = [-n[0], -n[1]], right: Vec2 = [view[1], -view[0]];
      const side = d.hinge ?? 'left';
      // right side of the opening as seen from the room = end of the gap in the `right` direction
      const rightIsEnd = right[0] * u[0] + right[1] * u[1] > 0;
      const hingeAtEnd = side === 'right' ? rightIsEnd : !rightIsEnd;
      const jamb = hingeAtEnd ? wall.to : wall.from, t = hingeAtEnd ? jamb - 0.05 : jamb + 0.05;
      const face = intoEdge.c;
      const hinge: Vec2 = at(r3(t), face);
      const closedDir: Vec2 = hingeAtEnd ? [-u[0], -u[1]] : [u[0], u[1]];
      doors.push({ ...base, hinge, closedDir: closedDir.map(cleanZero) as Vec2, openDir: n.map(cleanZero) as Vec2, hingeSide: d.type === 'hinged-double' ? null : side, swingInto: into, openAngle: d.type === 'folding' ? FOLD_ANGLE : 90, slide: null });
    } else if (d.type === 'sectional') {
      const into = d.swingInto ?? (b === 'exterior' ? a : b);
      if (into !== a && into !== b || into === 'exterior') { err('door.swing', `${what}: a sectional door lifts into one of its rooms (${[a, b].filter((x) => x !== 'exterior').join(' / ')}), not "${into}"`); continue; }
      // the leaf stands at the face of the room it lifts into; its panels run up and back under that room's ceiling
      const intoEdge = into === a ? wall.edgeA : wall.edgeB!, n: Vec2 = [-intoEdge.out * f.n[0], -intoEdge.out * f.n[1]];
      const room = plan.rooms.find((r) => r.id === into)!, lv = levels.get(room.level), ceiling = room.ceiling ?? lv?.slope?.flat ?? lv?.ceiling ?? 2.6;
      const leafH = d.leafHeight ?? D.leafHeight;
      if (leafH + SECTIONAL.rise > ceiling + 0.005) warn('door.lift', `${what}: its panels lie ${r3(leafH + SECTIONAL.rise)} m high when open, above the ceiling of "${into}" (${r3(ceiling)} m) — lower the leaf or check the ceiling`);
      doors.push({ ...base, hinge: null, closedDir: null, openDir: null, hingeSide: null, swingInto: into, openAngle: null, slide: null,
        lift: { origin: at(r3(wall.from + (w - leafW) / 2), intoEdge.c), dir: u.map(cleanZero) as Vec2, into: n.map(cleanZero) as Vec2 } });
    } else {
      const toEnd = (d.slideTo ?? 'end') === 'end', mid = r3((wall.faces[0] + wall.faces[1]) / 2);
      const originT = toEnd ? wall.from : wall.to, dir: Vec2 = toEnd ? u : [-u[0], -u[1]];
      const origin: Vec2 = at(originT, mid);
      doors.push({ ...base, hinge: null, closedDir: null, openDir: null, hingeSide: null, swingInto: null, openAngle: null, slide: { origin, dir: dir.map(cleanZero) as Vec2, travel: r2(leafW) } });
    }
  }
  // two leaves sweeping the same floor usually mean a misread swing (or a real clash worth a note)
  const inSweep = (q: LeafSector, p: Vec2) => {
    const dx = p[0] - q.hinge[0], dy = p[1] - q.hinge[1];
    return dx * q.closedDir[0] + dy * q.closedDir[1] >= 0 && dx * q.openDir[0] + dy * q.openDir[1] >= 0 && Math.hypot(dx, dy) <= q.radius;
  };
  const hinged = doors.filter((d) => d.hinge && d.closedDir && d.openDir && d.swingInto !== 'exterior');
  for (let i = 0; i < hinged.length; i++) for (let j = i + 1; j < hinged.length; j++) {
    const a = hinged[i], b = hinged[j];
    if (a.level !== b.level || a.swingInto !== b.swingInto) continue;
    let hits = 0;   // samples of a's quarter discs (10 cm grid) that a leaf of b also sweeps
    for (const sa of leafSectors(a)) for (const sb of leafSectors(b)) {
      if (Math.hypot(sa.hinge[0] - sb.hinge[0], sa.hinge[1] - sb.hinge[1]) > sa.radius + sb.radius) continue;
      for (let u = 0.05; u < sa.radius; u += 0.1) for (let v = 0.05; v < sa.radius; v += 0.1) {
        const p: Vec2 = [sa.hinge[0] + sa.closedDir[0] * u + sa.openDir[0] * v, sa.hinge[1] + sa.closedDir[1] * u + sa.openDir[1] * v];
        if (inSweep(sa, p) && inSweep(sb, p)) hits++;
      }
    }
    if (hits >= 2) warn('door.swingOverlap', `doors "${a.id}" and "${b.id}" sweep the same floor in "${a.swingInto}" — check the swing sides on the drawing (an entrance door may open outwards: swingInto "exterior")`);
  }
  for (const g of plan.passages) {
    const [a, b] = g.between, p = P(g.at, a), wall = wallBetween(a, b, p, g.width, `passage ${a} ↔ ${b}`);
    if (!wall) continue;
    const gap = { ...lineOf(wall.edgeA), from_: wall.from, to: wall.to, across: wall.faces, width: r2(g.width), door_id: null, leaf: null, height: g.height ?? null } as RoomJson['doors'][number];
    addGap(a, gap); if (b !== 'exterior') addGap(b, { ...gap });
  }

  // ---- windows (and the windows of dormer fronts that stand in a wall)
  const windows = new Map<string, RoomJson['openings']>();
  const addWindow = (w: { id: string; room: string; width?: number; sill?: number; head?: number; passable?: boolean; outline?: [number, number][] }, p: Vec2) => {
    const es = edges.get(w.room);
    if (!es) { err('ref', `window "${w.id}": unknown room "${w.room}"`); return; }
    let best: Edge | null = null, bd = Infinity;
    for (const e of es) {
      const t = alongOf(e, p), dd = Math.abs(acrossOf(e, p) - e.c) + (t < e.lo ? e.lo - t : t > e.hi ? t - e.hi : 0);
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best || bd > 0.6) { err('window.wall', `window "${w.id}": "at" is not on a wall of "${w.room}"`); return; }
    // a polygonal glazing: its corners along the wall (point coordinates, converted like the wall's points) and heights
    if (w.outline && best.axis === 'D') { err('window.outline', `window "${w.id}": an outline window is for walls along the plan axes`); return; }
    const corners = w.outline?.map(([a, h]) => [best!.axis === 'X' ? P([a, 0], w.room)[0] : P([0, a], w.room)[1], h] as Vec2);
    const t = alongOf(best, p), from = corners ? r3(Math.min(...corners.map((q) => q[0]))) : r3(t - w.width! / 2), to = corners ? r3(Math.max(...corners.map((q) => q[0]))) : r3(t + w.width! / 2);
    if (from < best.lo - 0.005 || to > best.hi + 0.005) err('window.span', `window "${w.id}": ${r3(to - from)} m does not fit the wall (${r3(best.lo)}…${r3(best.hi)})`);
    const interior = plan.rooms.some((r) => r.id !== w.room && r.level === levelOfRoom(w.room) && edges.get(r.id)!.some((o) => { if (!parallel(o, best!) || o.out === best!.out) return false; const e = inFrameOf(best!, o); return (e.c - best!.c) * best!.out > 0 && (e.c - best!.c) * best!.out < 0.6 && Math.min(e.hi, to) - Math.max(e.lo, from) > 0; }));
    if (interior) warn('window.interior', `window "${w.id}" sits on an interior wall of "${w.room}"`);
    const sill = corners ? Math.min(...corners.map((q) => q[1])) : w.sill ?? (w.passable ? 0 : D.sill), head = corners ? Math.max(...corners.map((q) => q[1])) : w.head ?? D.head;
    const list = windows.get(w.room) ?? [];
    // sill_z / head_z are absolute (project Z), like every height in rooms data — the engine subtracts the room floor
    const fz = levels.get(levelOfRoom(w.room)!)?.floorZ ?? 0;
    const plane = best.axis === 'D' ? { plane_axis: 'D' as const, dir: lineOf(best).dir! } : { plane_axis: best.axis === 'X' ? 'Y' as const : 'X' as const };
    list.push({ id: w.id, kind: corners ? 'glazing' : sill < 0.05 ? 'window (floor-to-lintel)' : 'window', ...plane, inner: best.axis === 'D' ? r6(best.c) : best.c, from_: from, to, sill_z: r3(fz + sill), head_z: r3(fz + head),
      ...(corners ? { polygon_YZ: corners.map(([a, h]) => [r3(a), r3(fz + h)]) } : {}) });
    windows.set(w.room, list);
  };
  for (const w of plan.windows) { if (!edges.has(w.room)) { err('ref', `window "${w.id}": unknown room "${w.room}"`); continue; } addWindow(w, P(w.at, w.room)); }
  for (const w of roof.windows) addWindow(w, w.at);

  // section height of a level (when the plan gives none): above the highest lintel of the level, below its ceiling
  const defaultCut = (l: { id: string; ceiling: number }) => {
    const heads = plan.windows.filter((w) => levelOfRoom(w.room) === l.id).map((w) => w.head ?? D.head);
    return r3(Math.min(l.ceiling - 0.05, Math.max(2.3, D.doorHeight + 0.1, ...heads.map((h) => h + 0.1))));
  };

  // ---- stairs
  const stairs: StairDef[] = [];
  const stairOpenings = new Map<string, [number, number, number, number]>();
  for (const s of plan.stairs) {
    const lf = levels.get(s.from), lt = levels.get(s.to);
    if (!lf || !lt) { err('stairs.level', `stairs "${s.id}": unknown level`); continue; }
    const [a, b] = [P([s.box[0], s.box[1]], s.from), P([s.box[2], s.box[3]], s.from)];
    const box: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const rise = lt.floorZ - lf.floorZ, T = s.tread, fw = s.flightWidth;
    // canonical frame (model/stairs.ts): up the lower flight towards −Y, turning right; `up` turns it, `turn: left` mirrors it
    const rotate = ({ S: 0, E: 90, N: 180, W: 270 } as const)[s.up], mirror = s.kind !== 'straight' && s.turn === 'left';
    const across = rotate % 180 ? box[3] - box[1] : box[2] - box[0], deep = rotate % 180 ? box[2] - box[0] : box[3] - box[1];
    const head = { id: s.id, fromLevel: s.from, toLevel: s.to, bbox: box }, topZ = r3(rise);
    const tail = { confidence: s.confidence ?? D.confidence, ...(s.note ? { note: s.note } : {}), ...(rotate || mirror ? { orient: { rotate, mirror } } : {}) };
    const total = s.kind === 'u-turn' ? 2 * s.risers : s.risers + (s.upperRisers ?? 0), riser = r3(rise / total), run = r3((s.risers - 1) * T);
    if (riser > 0.2 || riser < 0.14) warn('stairs.riser', `stairs "${s.id}": riser ${riser} m (comfortable: 0.15–0.19) — ${total} risers for ${r3(rise)} m`);
    if (s.kind === 'straight') {
      if (Math.abs(across - fw) > 0.06) warn('stairs.width', `stairs "${s.id}": box is ${r3(across)} m wide, the flight ${fw} m`);
      if (deep < run - 0.06) err('stairs.depth', `stairs "${s.id}": box is ${r3(deep)} m long, ${s.risers - 1} treads of ${T} m need ${run} m`);
      else if (deep > run + T + 0.01) warn('stairs.depth', `stairs "${s.id}": box is ${r3(deep - run)} m longer than ${s.risers - 1} treads — the rest is a landing at the upper floor; check the risers and the tread`);
      stairs.push({ ...{ id: s.id, kind: 'straight' as const }, ...head, risers: s.risers, riser, tread: T, flightWidth: fw, topZ, run: r3(Math.min(run, deep)), ...tail });
    } else if (s.kind === 'l-turn') {
      const up = s.upperRisers!, upperRun = r3((up - 1) * T), landD = deep - run, landW = across - upperRun;
      if (landD < fw * 0.8 || landW < fw * 0.8) err('stairs.depth', `stairs "${s.id}": box is ${r3(across)} × ${r3(deep)} m — ${s.risers - 1} + ${up - 1} treads of ${T} m leave a landing of ${r3(landW)} × ${r3(landD)} m for flights ${fw} m wide`);
      else if (landD > fw + 0.6 || landW > fw + 0.6) warn('stairs.depth', `stairs "${s.id}": the landing comes out ${r3(landW)} × ${r3(landD)} m for flights ${fw} m wide — check the risers of each flight and the tread`);
      stairs.push({ ...{ id: s.id, kind: 'l-turn' as const }, ...head, risers: s.risers, upperRisers: up, riser, tread: T, flightWidth: fw, landingZ: r3((rise * s.risers) / total), topZ, run, upperRun, ...tail });
    } else {
      const width = 2 * fw + s.gap;
      if (Math.abs(across - width) > 0.06) warn('stairs.width', `stairs "${s.id}": box is ${r3(across)} m wide across the flights, they need ${r3(width)} m`);
      if (deep < run + fw * 0.8) err('stairs.depth', `stairs "${s.id}": box is too short for ${s.risers - 1} treads of ${T} m plus a landing`);
      const cy1 = box[1] + deep;
      stairs.push({ ...{ id: s.id, kind: 'u-turn' as const }, ...head, risers: s.risers, riser, tread: T, flightWidth: fw, gap: s.gap, landingZ: r3(rise / 2), topZ, split: r3(box[0] + fw + s.gap / 2), run, landingEdge: r3(cy1 - run), ...tail });
    }
    // opening in the floor of the upper level: the room of `to` containing the box centre
    const c: Vec2 = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const upper = plan.rooms.find((r) => r.level === s.to && inPolygon(c, polys.get(r.id)!));
    if (!upper) err('stairs.arrival', `stairs "${s.id}": no room of level "${s.to}" contains the stair box`);
    else stairOpenings.set(upper.id, box);
    const lower = plan.rooms.find((r) => r.level === s.from && inPolygon(c, polys.get(r.id)!));
    if (!lower) err('stairs.start', `stairs "${s.id}": no room of level "${s.from}" contains the stair box`);
  }

  // ---- free-standing walls: the axis, the openings along it, heights absolute (standing on the slab below the level)
  const freeWalls: FreeWallJson[] = [];
  for (const w of plan.walls) {
    const lv = levels.get(w.level);
    if (!lv) { err('wall.level', `wall "${w.id}": unknown level "${w.level}"`); continue; }
    const a = P(w.from, w.level), b = P(w.to, w.level), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) { err('wall.length', `wall "${w.id}": its ends are the same point`); continue; }
    const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], z0 = r3(lv.floorZ - D.slab), z1 = r3(lv.floorZ + (w.height ?? lv.ceiling)), t = w.thickness ?? D.exteriorWall;
    const openings: FreeWallJson['openings'] = [];
    for (const o of w.openings) {
      const q = P(o.at, w.level), s = (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1], off = Math.abs((q[0] - a[0]) * u[1] - (q[1] - a[1]) * u[0]);
      const t0 = r3(s - o.width / 2), t1 = r3(s + o.width / 2);
      if (off > t / 2 + 0.3) err('wall.opening', `wall "${w.id}": opening "${o.id}" is not on the wall (${r3(off)} m off its axis)`);
      if (t0 < -0.005 || t1 > L + 0.005) err('wall.opening', `wall "${w.id}": opening "${o.id}" (${o.width} m) does not fit the wall (0…${r3(L)})`);
      if (lv.floorZ + o.head > z1 + 1e-6) err('wall.opening', `wall "${w.id}": opening "${o.id}" is higher than the wall`);
      openings.push({ id: o.id, t0, t1, z0: r3(lv.floorZ + o.sill), z1: r3(lv.floorZ + o.head), ...(o.slats ? { infill: { kind: 'slats', width: o.slats.width, depth: o.slats.depth ?? t, gap: o.slats.gap } } : {}) });
    }
    freeWalls.push({ id: w.id, level: w.level, a, b, thickness: t, z0, z1, openings });
  }

  // ---- roof windows and the room ceilings: flat, or under the roof of the level (its planes, capped by the flat top)
  const roofWindows = new Map<string, RoomJson['roof_windows']>();
  for (const w of plan.roofWindows) {
    if (!polys.has(w.room)) { err('ref', `roof window "${w.id}": unknown room "${w.room}"`); continue; }
    const a = P([w.rect[0], w.rect[1]], w.room), b = P([w.rect[2], w.rect[3]], w.room);
    roofWindows.set(w.room, [...(roofWindows.get(w.room) ?? []), { id: w.id, plan_rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(r3) }]);
  }
  const ceilings = new Map<string, { json: RoomJson['ceiling']; profile: CeilingProfile }>();
  for (const r of plan.rooms) {
    const lv = levels.get(r.level), poly = polys.get(r.id)!, fz = lv?.floorZ ?? 0;
    const flat = r3(fz + (r.ceiling ?? lv?.slope?.flat ?? lv?.ceiling ?? 2.6)), under = roof.model?.byLevel(r.level) ?? [];
    const profile = under.length ? roofCeiling(under, flat, fz, poly, (roofWindows.get(r.id) ?? []).map((w) => w.plan_rect as Rect)) : flatCeiling(flat, fz, poly);
    ceilings.set(r.id, { json: profile.kind === 'roof' ? { kind: 'roof', flat_z: flat } : { kind: 'flat', z: flat }, profile });
  }
  for (const w of plan.roofWindows) {
    if (!polys.has(w.room)) continue;
    const r = plan.rooms.find((x) => x.id === w.room)!, c = ceilings.get(w.room)!.profile, under = roof.model?.byLevel(r.level) ?? [];
    if (c.kind !== 'roof') { warn('roofWindow.flat', `roof window "${w.id}": room "${w.room}" has no sloped ceiling`); continue; }
    // in one sloped plane of the ceiling (not across a ridge, a hip, a valley or the flat top)
    const [x0, y0, x1, y1] = roofWindows.get(w.room)!.find((q) => q.id === w.id)!.plan_rect;
    const fs = surfaceFacets({ pieces: under, which: 'inner', cap: c.flatZ }, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    const planes = new Set(fs.map((f) => `${r3(f.plane.gx)},${r3(f.plane.gy)},${r3(f.plane.z0)}`));
    if (planes.size !== 1 || (fs[0].plane.gx === 0 && fs[0].plane.gy === 0)) err('roofWindow.plane', `roof window "${w.id}": it must lie within one sloped plane of the ceiling of "${w.room}" (it crosses ${planes.size} planes or the flat top)`);
  }
  // a level slope given together with a roof block: the roof must give the same ceilings (within 5 cm)
  if (plan.roof) for (const lv of plan.levels) {
    if (!lv.slope) continue;
    const s = lv.slope, ax: 0 | 1 = s.ridge === 'X' ? 1 : 0, pts = plan.rooms.filter((r) => r.level === lv.id && r.ceiling === undefined).flatMap((r) => polys.get(r.id)!);
    if (!pts.length || s.lines.length < 1) continue;
    const lo = Math.min(...pts.map((q) => q[ax])), hi = Math.max(...pts.map((q) => q[ax])), ridge = s.ridgeAt !== undefined ? along(ax, s.ridgeAt, lv.id) : (lo + hi) / 2;
    const lines = s.lines.map((l) => ({ at: along(ax, l.at, lv.id), height: l.height }));
    const k = lines.length === 2 ? Math.abs(lines[1].height - lines[0].height) / Math.max(1e-6, Math.abs(lines[1].at - lines[0].at)) : Math.tan((s.pitch! * Math.PI) / 180);
    const own: RoofPiece = { id: 'slope', kind: 'part', level: lv.id, region: [-1e6, -1e6, 1e6, 1e6], inner: [-1e6, -1e6, 1e6, 1e6], cover: [-1e6, -1e6, 1e6, 1e6],
      planes: atticPlanes({ kind: 'attic', ...(ax === 1 ? { ridge_y: ridge } : { ridge_x: ridge }), z_at_ridge: lv.floorZ + lines[0].height + k * Math.abs(ridge - lines[0].at), slope: k }) };
    for (const r of plan.rooms.filter((x) => x.level === lv.id && x.ceiling === undefined)) {
      const poly = polys.get(r.id)!, fromSlope = roofCeiling([own], r3(lv.floorZ + (s.flat ?? lv.ceiling)), lv.floorZ, poly, []), c = ceilings.get(r.id)!.profile;
      const worst = Math.max(...[...poly, ...poly.map((q, i) => { const n = poly[(i + 1) % poly.length]; return [(q[0] + n[0]) / 2, (q[1] + n[1]) / 2] as Vec2; })].map((q) => Math.abs(fromSlope.heightAt(q[0], q[1]) - c.heightAt(q[0], q[1]))));
      if (worst > 0.05) warn('roof.slope', `room "${r.id}": the roof gives a ceiling up to ${Math.round(worst * 100)} cm away from the level slope — check the knee height, the pitch and the ridge`);
    }
  }
  // openings under the roof: a window head or a door above the ceiling at its wall
  for (const r of plan.rooms) {
    const c = ceilings.get(r.id)!.profile, fz = levels.get(r.level)?.floorZ ?? 0;
    if (c.kind !== 'roof') continue;
    const es = edges.get(r.id)!, inward = (e: Edge): Vec2 => [-e.out * 0.01 * e.n[0], -e.out * 0.01 * e.n[1]];
    const ceilingOver = (e: Edge, from: number, to: number) => Math.min(...[from + 0.01, (from + to) / 2, to - 0.01].map((t) => { const d = inward(e), p = linePt(e, t, e.c); return c.heightAt(p[0] + d[0], p[1] + d[1]); }));
    /** the edge of the room on a window's or a gap's wall line */
    const onWall = (kind: LineAxis, dir: Vec2 | undefined, cs: number[], from: number, to: number) => es.find((x) => x.axis === kind && (kind !== 'D' || (!!dir && Math.abs(x.dir[0] * dir[1] - x.dir[1] * dir[0]) < 1e-6)) && cs.some((v) => Math.abs(v - x.c) < 1e-5) && from >= x.lo - 0.01 && to <= x.hi + 0.01);
    for (const o of windows.get(r.id) ?? []) {
      const e = onWall(o.plane_axis === 'D' ? 'D' : o.plane_axis === 'Y' ? 'X' : 'Y', o.dir, [o.inner], o.from_, o.to);
      // a polygonal glazing (a gable window): every corner under the roof plane at its place — it may rise past the flat top of
      // the ceiling into the space under the ridge, as gable glazings are drawn up to their apex
      if (e && o.polygon_YZ) {
        const d = inward(e), roofAt = (x: number, y: number) => (surfaceAt({ pieces: roof.model?.byLevel(r.level) ?? [], which: 'inner' }, x, y)?.z ?? fz + c.heightAt(x, y)) - fz;
        const over = o.polygon_YZ.find(([a, z]) => { const q = linePt(e, a, e.c); return z - fz > roofAt(q[0] + d[0], q[1] + d[1]) + 0.01; });
        if (over) err('window.roof', `window "${o.id}": its corner at ${r3(over[0])} is ${r3(over[1] - fz)} m high, above the roof plane there — follow the roof plane`);
      } else if (e && o.head_z! - fz > ceilingOver(e, o.from_, o.to) + 0.01) err('window.roof', `window "${o.id}": its head (${r3(o.head_z! - fz)} m) is above the roof plane at its wall (${r3(ceilingOver(e, o.from_, o.to))} m) — lower it, or put it in a dormer`);
    }
    for (const g of gaps.get(r.id) ?? []) {
      const e = onWall(g.along, g.dir, g.across, g.from_, g.to), h = g.height ?? (g.door_id ? D.doorHeight : null);
      if (e && h !== null && h > ceilingOver(e, g.from_, g.to) + 0.01) err('door.roof', `${g.door_id ? `door "${g.door_id}"` : 'passage'} in "${r.id}": ${h} m high, the roof plane at its wall is ${r3(ceilingOver(e, g.from_, g.to))} m`);
    }
  }

  // ---- rooms
  const rooms: RoomJson[] = plan.rooms.map((r) => {
    const poly = polys.get(r.id)!, lv = levels.get(r.level), floorZ = lv?.floorZ ?? 0, area = r2(Math.abs(area2(poly)) / 2);
    const bb = bboxOf(poly);
    const ce = ceilings.get(r.id)!;
    if (r.areaPrinted && Math.abs(area - r.areaPrinted) / r.areaPrinted > 0.1) {
      // under a roof a plan prints the usable area (PN-ISO 9836: full above 2.20 m, half between 1.40 and 2.20, none below)
      const fs = ce.profile.kind === 'roof' ? ce.profile.facets() : null, all = Math.abs(area2(poly)) / 2;
      const usable = fs ? r2(all - areaBelow(fs, floorZ + 2.2) + (areaBelow(fs, floorZ + 2.2) - areaBelow(fs, floorZ + 1.4)) / 2) : null;
      if (usable === null || Math.abs(usable - r.areaPrinted) / r.areaPrinted > 0.1) warn('room.area', `room "${r.id}": computed area ${area} m²${usable !== null ? ` (usable under the roof ${usable} m²)` : ''} differs from the printed ${r.areaPrinted} m² by more than 10 %`);
    }
    return {
      id: r.id, name: r.name, ...(r.label ? { label: r.label } : {}), ...(r.names ? { names: r.names } : {}), level: r.level, floor_z: floorZ, area, area_data: r.areaPrinted ?? area, id_source: r.source ?? source,
      bbox: bb, polygon: poly, rectangular: poly.length === 4, ceiling: ce.json,
      stair_opening: stairOpenings.get(r.id) ?? null, doors: gaps.get(r.id) ?? [], openings: windows.get(r.id) ?? [], roof_windows: roofWindows.get(r.id) ?? [], kind: r.kind, tags: r.tags ?? [],
    } as RoomJson;
  });

  // ---- furniture
  const cat = opts.catalog && new Map(opts.catalog.map((c) => [c.id, c]));
  const keys = new Map<string, number>();
  /** the wall of a room facing a side (N = +Y): the one holding `along`, else the longest; an L room has two west walls */
  const sideEdge = (room: string, side: 'N' | 'S' | 'E' | 'W', along?: number): Edge => {
    const axis = side === 'N' || side === 'S' ? 'X' : 'Y', out = side === 'N' || side === 'E' ? 1 : -1;
    const cand = edges.get(room)!.filter((e) => e.axis === axis && e.out === out);
    const holding = along === undefined ? [] : cand.filter((e) => along >= e.lo - 0.01 && along <= e.hi + 0.01);
    // several walls hold it (a U room): the outermost one on that side
    const pick = holding.length ? holding : cand;
    return pick.reduce((b, e) => (holding.length ? (e.c - b.c) * out > 0 : e.hi - e.lo > b.hi - b.lo) ? e : b);
  };
  const items: ArchitectItem[] = [];
  for (const f of plan.furniture) {
    const it: CatalogItemInfo | undefined = cat ? cat.get(f.catalogId) : { id: f.catalogId, dimensions: { w: 0, d: 0, h: 0 } };
    const poly = polys.get(f.room);
    if (!it) { err('furniture.catalog', `furniture in "${f.room}": unknown catalog item "${f.catalogId}" (see data/furnitureCatalog.json)`); continue; }
    if (!poly) { err('ref', `furniture "${f.catalogId}": unknown room "${f.room}"`); continue; }
    const vd = it.variants?.find((v) => v.id === f.variant)?.dimensions ?? {};
    const dims = { ...it.dimensions, ...vd, ...(f.dims ?? {}) };
    if (cat && f.variant && !it.variants?.some((v) => v.id === f.variant)) err('furniture.variant', `furniture "${f.catalogId}" in "${f.room}": unknown variant "${f.variant}" (${(it.variants ?? []).map((v) => v.id).join(', ') || 'no variants'})`);
    let x: number, y: number, rot: number;
    if (f.wall) {
      const half = dims.d / 2 + 0.005;
      const along = f.along !== undefined ? (plan.units === 'px' ? P(f.wall === 'N' || f.wall === 'S' ? [f.along, 0] : [0, f.along], f.room)[f.wall === 'N' || f.wall === 'S' ? 0 : 1] : f.along) : undefined;
      const e = sideEdge(f.room, f.wall, along), t = along ?? (e.lo + e.hi) / 2;
      if (f.wall === 'S') { x = t; y = e.c + half; rot = 0; }
      else if (f.wall === 'N') { x = t; y = e.c - half; rot = 180; }
      else if (f.wall === 'W') { x = e.c + half; y = t; rot = 270; }
      else { x = e.c - half; y = t; rot = 90; }
    } else if (f.at) { [x, y] = P(f.at, f.room); rot = f.rot ?? 0; }
    else { err('furniture.place', `furniture "${f.catalogId}" in "${f.room}": give "at" (+ rot) or "wall" (+ along)`); continue; }
    if (!inPolygon([x, y], poly)) warn('furniture.outside', `furniture "${f.catalogId}" in "${f.room}": centre [${r3(x)}, ${r3(y)}] is outside the room`);
    // under a sloped ceiling: the top of the item at each corner of its footprint against the ceiling there
    const ce = ceilings.get(f.room)?.profile;
    if (ce?.kind === 'roof') {
      const top = (f.elevation ?? 0) + (dims.h ?? 0), a = (rot * Math.PI) / 180;
      const ceilingAt = (u: number, v: number) => ce.heightAt(x + u * Math.cos(a) - v * Math.sin(a), y + u * Math.sin(a) + v * Math.cos(a));
      const low = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ceilingAt((u * dims.w) / 2, (v * dims.d) / 2)));
      if (top > low + 0.02) warn('furniture.ceiling', `furniture "${f.catalogId}" in "${f.room}": ${r3(top)} m high but the sloped ceiling is ${r3(low)} m above part of it — move it towards the ridge, pick a lower variant or give lower "dims"`);
    }
    const base = `${f.room}-${f.catalogId}`, n = (keys.get(base) ?? 0) + 1;
    keys.set(base, n);
    const key = f.key ?? (n === 1 ? base : `${base}-${n}`);
    items.push({ key, room: f.room, catalogId: f.catalogId, variant: f.variant ?? null, x: r3(x), y: r3(y), rot, source: f.source ?? source, basis: f.basis ?? D.basis, note: f.note ?? '',
      ...(f.dims ? { dims: f.dims } : {}), ...(f.elevation !== undefined ? { elevation: f.elevation } : {}), ...(f.group ? { group: f.group } : {}), ...(f.materialId ? { materialId: f.materialId } : {}) });
  }
  // keys must be unique also when given explicitly
  const seen = new Set<string>();
  for (const it of items) { if (seen.has(it.key)) err('furniture.key', `furniture key "${it.key}" is repeated`); seen.add(it.key); }

  // ---- electrical points
  const points: ElectricalDefaults['points'] = [];
  const typeCount = new Map<string, number>();
  for (const q of plan.electrical) {
    const poly = polys.get(q.room);
    if (!poly) { err('ref', `electrical point "${q.label}": unknown room "${q.room}"`); continue; }
    let x: number, y: number;
    if (q.wall) {
      const e = sideEdge(q.room, q.wall, q.along), al = q.along ?? (e.lo + e.hi) / 2;
      [x, y] = q.wall === 'S' || q.wall === 'N' ? [al, e.c] : [e.c, al];
    } else if (q.at) [x, y] = P(q.at, q.room);
    else { err('electrical.place', `electrical point "${q.label}": give "at" or "wall" + "along"`); continue; }
    const onWall = edges.get(q.room)!.some((e) => Math.abs(acrossOf(e, [x, y]) - e.c) <= 0.05 && alongOf(e, [x, y]) >= e.lo - 0.01 && alongOf(e, [x, y]) <= e.hi + 0.01);
    if (!onWall) warn('electrical.wall', `electrical point "${q.label}" in "${q.room}" is not on a wall (within 5 cm) — the engine skips it`);
    const prefix = q.type.startsWith('socket') ? 'S' : q.type.startsWith('switch') ? 'SW' : q.type === 'board' ? 'B' : 'P';
    const n = (typeCount.get(prefix) ?? 0) + 1;
    typeCount.set(prefix, n);
    points.push({ id: q.id ?? `${prefix}${n}`, type: q.type, roomId: q.room, x: r3(x), y: r3(y), heightAFFL: q.height, label: q.label, source, status: 'source', ...(q.width ? { width: q.width } : {}), ...(q.notes ? { notes: q.notes } : {}) });
  }

  // ---- site, sun
  let site: ProjectPackage['site'] = null;
  if (plan.site) {
    const all = [...polys.values()].flat(), [bx0, by0, bx1, by1] = bboxOf(all), t = D.exteriorWall;
    // the outer faces of the ground level (an L or U building is not its bounding box)
    const ground = plan.rooms.filter((r) => r.level === lowest.id).map((r) => polys.get(r.id)!);
    const footprint = outerOutline(ground, t).map(([x, y]) => [r3(x), r3(y)] as Vec2);
    const m = plan.site.margin ?? 6;
    const boundary: Vec2[] = plan.site.boundary ? plan.site.boundary.map((q) => P(q, lowest.id)) : [[bx0 - t - m, by0 - t - m], [bx1 + t + m, by0 - t - m], [bx1 + t + m, by1 + t + m], [bx0 - t - m, by1 + t + m]].map(([x, y]) => [r3(x), r3(y)] as Vec2);
    site = { footprint, boundary, groundLevel: plan.site.groundLevel, levelId: lowest.id };
    if (all.some((q) => !inPolygon(q, boundary))) err('site.boundary', 'the building is not inside the plot boundary');
  }
  const sun = plan.sun ? { lat: plan.sun.lat, lon: plan.sun.lon, gridAzimuthX: plan.sun.northAzimuthX, convergence: 0, trueAzimuthX: plan.sun.northAzimuthX, confidence: plan.sun.confidence, uncertaintyDeg: plan.sun.confidence === 'confirmed' ? 2 : 15, timeZone: plan.sun.timeZone, ...(plan.sun.placeName ? { placeName: plan.sun.placeName } : {}) } : undefined;
  if (sun) { try { new Intl.DateTimeFormat('en-US', { timeZone: sun.timeZone }); } catch { err('sun.timeZone', `unknown IANA time zone "${sun.timeZone}"`); } }

  // ---- names in other languages: a language some names have, every name should have (the app shows a mix otherwise)
  {
    const named: [string, Record<string, string> | undefined][] = [[`project`, plan.project.names], ...plan.levels.map((l) => [`level "${l.id}"`, l.names] as [string, Record<string, string> | undefined]),
      ...plan.rooms.map((r) => [`room "${r.id}"`, r.names] as [string, Record<string, string> | undefined]), ...plan.viewpoints.map((v) => [`viewpoint "${v.id}"`, v.names] as [string, Record<string, string> | undefined])];
    for (const l of new Set(named.flatMap(([, n]) => Object.keys(n ?? {})))) {
      const missing = named.filter(([, n]) => !n?.[l]).map(([w]) => w);
      if (l === plan.project.language) warn('names.language', `names in "${l}" repeat the language the names are written in (project.language) — leave them out`);
      else if (missing.length) warn('names.missing', `names in "${l}" are missing for ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''} — the app would mix languages`);
    }
  }

  // ---- viewpoints
  const viewpoints: Viewpoint[] = plan.viewpoints.map((v) => { const lv = v.level === 'SITE' ? lowest.id : v.level, p = P(v.at, lv), look = P([v.look[0], v.look[1]], lv); return { id: v.id, name: v.name, ...(v.names ? { names: v.names } : {}), p, level: v.level, look: [look[0], look[1], v.look[2]], fov: v.fov, hint: v.hint, ...(v.hints ? { hints: v.hints } : {}) }; });

  // ---- manifest
  const modules: ProjectModule[] = [...(site ? ['site' as const] : []), ...(plan.assets?.environment ? ['environment' as const] : []), ...(sun ? ['sun' as const] : []), ...(stairs.length ? ['stairs' as const] : [])];
  if (plan.assets?.site && !site) err('assets.site', 'a terrain model needs the "site" block');
  const dv = plan.defaultView;
  const project: ProjectPackage = {
    schema: 'home-simulator/project', version: 1,
    manifest: {
      projectId: plan.project.id, name: plan.project.name, ...(plan.project.names ? { names: plan.project.names } : {}),
      ...(plan.project.description ? { description: plan.project.description } : {}), ...(plan.project.documentTitle ? { documentTitle: plan.project.documentTitle } : {}),
      ...(plan.project.language ? { language: plan.project.language } : {}),
      units: 'm',
      coordinateSystem: { name: 'LCS', description: plan.project.origin ?? 'origin at the outer corner of the building (bottom-left of the plan); +X right on the plan, +Y up on the plan, +Z up; Z = 0 is the finished floor of the lowest level', up: 'Z', handedness: 'right' },
      buildingType: plan.project.buildingType,
      levels: sortedLevels.map((l) => ({ id: l.id, name: l.name, ...(l.names ? { names: l.names } : {}), floorZ: l.floorZ })),
      dataSources: plan.dataSources ?? { rooms: source, doors: source, interiors: source, electrical: source },
      modules, capabilities: plan.capabilities ?? ['interiors', 'electrical', 'variants', 'walk'],
      defaultView: { levelId: dv?.level ?? lowest.id, roomId: dv?.room ?? null, view: dv?.view ?? (plan.project.buildingType === 'apartment' ? 'interior' : 'exterior') },
      metadata: plan.project.metadata ?? {},
    },
    building: {
      rooms: { levels: Object.fromEntries(sortedLevels.map((l) => [l.id, { name: l.name, floor_z: l.floorZ, cut_height: l.cutHeight ?? defaultCut(l), plan_wall_offset: r3(D.interiorWall / 2) }])), rooms },
      doors,
      ...(plan.windows.some((w) => w.passable) ? { doorFacts: { passableOpenings: plan.windows.filter((w) => w.passable).map((w) => w.id) } } : {}),
      ...(stairs.length ? { stairs } : {}),
      ...(freeWalls.length ? { walls: freeWalls } : {}),
      shell: { exteriorWall: D.exteriorWall, slab: D.slab },
      ...(roof.json ? { roof: roof.json } : {}),
    },
    interiors: { items, notIncluded: plan.notIncluded, ...(plan.notes ? { notes: plan.notes } : {}) },
    electrical: { points },
    ...(site ? { site } : {}),
    ...(sun ? { sun } : {}),
    ...(plan.assets ? { assets: plan.assets } : {}),
    ...(plan.catalog ? { catalog: plan.catalog } : {}),
    ...(plan.views ? { views: plan.views } : {}),
    ...(viewpoints.length ? { viewpoints } : {}),
  };
  // a coordinate far from the origin (a px plan without calibration, a typo of a few zeros) stops the solid kernel
  const far = outOfRange(project);
  if (far.length) err('plan.range', rangeMessage(far));
  return { project: issues.some((i) => i.level === 'error') ? null : project, issues, adjustments };
}

/**
 * Raster plans: faces of different rooms that should lie on one wall line drift by a few centimetres, and shared walls come out
 * 9 or 15 cm thick. (1) faces of the same side within 4 cm are averaged (the corners of slanted walls stay); (2) a wall between
 * two rooms whose thickness is within 8 cm of the interior wall gets exactly the interior thickness, keeping its centre line.
 * Every change is reported.
 */
function regularizeWalls(plan: Plan, outlines: Map<string, Vec2[]>, t: number, log: string[]) {
  for (const axis of [0, 1] as const) {
    // (1) cluster coordinates of all vertices on this axis per level
    for (const lv of plan.levels) {
      const ids = plan.rooms.filter((r) => r.level === lv.id).map((r) => r.id);
      const vals = ids.flatMap((id) => outlines.get(id)!.map((q) => q[axis])).sort((a, b) => a - b);
      const clusters: number[][] = [];
      for (const v of vals) { const c = clusters[clusters.length - 1]; if (c && v - c[c.length - 1] <= 0.04) c.push(v); else clusters.push([v]); }
      const map = new Map<number, number>();
      for (const c of clusters) { const m = snap5(c.reduce((s, v) => s + v, 0) / c.length); for (const v of c) map.set(v, m); }
      // a corner of a slanted wall keeps its place (moving one end would turn the wall off 45°)
      const slantedEnd = (p: Vec2[], i: number) => [p[(i + p.length - 1) % p.length], p[(i + 1) % p.length]].some((q) => Math.abs(q[0] - p[i][0]) > EPS && Math.abs(q[1] - p[i][1]) > EPS);
      for (const id of ids) outlines.set(id, outlines.get(id)!.map((q, i, p) => { const n: Vec2 = [q[0], q[1]]; if (!slantedEnd(p, i)) n[axis] = map.get(q[axis]) ?? q[axis]; return n; }));
    }
    // (2) shared walls → interior thickness: face of a (outward +axis) against a face of b (outward −axis)
    const along = axis === 0 ? 'Y' : 'X', o = 1 - axis;
    for (const a of plan.rooms) for (const b of plan.rooms) {
      if (a.level !== b.level || a.id === b.id) continue;
      for (const ea of edgesOf(a.id, normalizePolygon(outlines.get(a.id)!)).filter((e) => e.axis === along && e.out === 1)) {
        for (const eb of edgesOf(b.id, normalizePolygon(outlines.get(b.id)!)).filter((e) => e.axis === along && e.out === -1)) {
          const gap = eb.c - ea.c, overlap = Math.min(ea.hi, eb.hi) - Math.max(ea.lo, eb.lo);
          if (gap <= 0.01 || overlap < 0.3 || Math.abs(gap - t) < 0.002 || Math.abs(gap - t) > 0.08) continue;
          // a face ending at a slanted wall stays (moving it would turn that wall off 45°)
          const slanted = (id: string, e: Edge) => { const p = outlines.get(id)!; return p.some((q, i) => (Math.abs(q[axis] - e.c) < 1e-9 && q[o] >= e.lo - 1e-9 && q[o] <= e.hi + 1e-9) && [p[(i + p.length - 1) % p.length], p[(i + 1) % p.length]].some((r) => Math.abs(r[0] - q[0]) > EPS && Math.abs(r[1] - q[1]) > EPS)); };
          if (slanted(a.id, ea) || slanted(b.id, eb)) continue;
          const c = (ea.c + eb.c) / 2, na = snap5(c - t / 2), nb = r3(na + t);
          // move the vertices of these two faces (the edge end points), nothing else of the outlines
          const move = (poly: Vec2[], e: Edge, v: number) => poly.map((q) => (Math.abs(q[axis] - e.c) < 1e-9 && q[o] >= e.lo - 1e-9 && q[o] <= e.hi + 1e-9 ? (axis === 0 ? [v, q[1]] : [q[0], v]) : q) as Vec2);
          outlines.set(a.id, move(outlines.get(a.id)!, ea, na));
          outlines.set(b.id, move(outlines.get(b.id)!, eb, nb));
          log.push(`wall ${a.id} | ${b.id}: ${r3(gap)} m → ${t} m (centre line kept at ${r3(c)})`);
        }
      }
    }
  }
}
