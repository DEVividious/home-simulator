// plan.json → project.json (ADR 0014). Deterministic: the same plan always yields the same package. Everything a person or an
// agent tends to get wrong by hand is derived here: units and the y flip of image coordinates, polygon order (counter-
// clockwise from the lowest-left corner — wall ids <room>-w<n> follow it), areas and bounding boxes, the door gap in BOTH
// rooms with the wall faces it crosses, hinge position and directions from "hinge side + room it opens into", window wall
// axis and face, stairs from risers and level heights, furniture against a wall, provenance on every fact.
// Problems are returned as issues (error / warning); the CLI refuses to write a package with errors.
import type { ArchitectItem } from '../home/model/defaults';
import type { DoorDef } from '../home/model/doors';
import type { RoomJson } from '../home/model/rooms';
import type { StairDef } from '../home/model/stairs';
import type { Vec2 } from '../home/model/types';
import type { Viewpoint } from '../home/model/viewpoints';
import type { ElectricalDefaults, ProjectModule, ProjectPackage } from '../project/types';
import { PlanSchema, type Plan, type PlanInput } from './plan';

export interface Issue { level: 'error' | 'warning'; code: string; message: string }
export interface CatalogItemInfo { id: string; dimensions: { w: number; d: number; h: number }; variants?: { id: string; dimensions?: Partial<{ w: number; d: number; h: number }> }[]; mount?: string }
export interface CompileResult { project: ProjectPackage | null; issues: Issue[]; adjustments: string[] }

const EPS = 1e-6;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
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

/** an axis-aligned edge of a room outline with its outward side */
interface Edge { room: string; axis: 'X' | 'Y'; /** coordinate of the face (constant) */ c: number; lo: number; hi: number; /** +1 — the room is on the smaller side of the face, outward = +; −1 — outward = − */ out: 1 | -1 }
function edgesOf(roomId: string, poly: Vec2[]): Edge[] {
  const out: Edge[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    // CCW: the interior is on the left of a → b; outward normal = (dy, −dx)
    if (Math.abs(a[1] - b[1]) <= EPS) out.push({ room: roomId, axis: 'X', c: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]), out: b[0] > a[0] ? -1 : 1 });
    else if (Math.abs(a[0] - b[0]) <= EPS) out.push({ room: roomId, axis: 'Y', c: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]), out: b[1] > a[1] ? 1 : -1 });
  });
  return out;
}
/** coordinate of a point along an edge and across it */
const alongOf = (e: Edge, p: Vec2) => (e.axis === 'X' ? p[0] : p[1]);
const acrossOf = (e: Edge, p: Vec2) => (e.axis === 'X' ? p[1] : p[0]);

export interface CompileOptions {
  catalog: CatalogItemInfo[];
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
  let toM = (p: Vec2): Vec2 => p;
  if (plan.units === 'px') {
    const c = plan.calibration;
    if (!c) { err('calibration', 'units "px" need a calibration block (pxPerM, originPx)'); return { project: null, issues, adjustments }; }
    toM = ([x, y]) => [(x - c.originPx[0]) / c.pxPerM, (c.originPx[1] - y) / c.pxPerM];
    const ms = c.methods ?? [];
    if (ms.length < 2) warn('calibration.methods', 'fewer than two independent scale estimates — ask for one known dimension to confirm the scale');
    else {
      const vals = ms.map((m) => m.pxPerM), spread = (Math.max(...vals) - Math.min(...vals)) / c.pxPerM;
      if (spread > 0.05) warn('calibration.agreement', `scale estimates differ by ${(spread * 100).toFixed(1)} % (> 5 %): ${ms.map((m) => `${m.method} ${m.pxPerM.toFixed(2)}`).join(', ')}`);
    }
  }
  const regularize = plan.regularize ?? plan.units === 'px';
  const P = (p: Vec2): Vec2 => { const q = toM(p); return regularize ? [snap5(q[0]), snap5(q[1])] : [r3(q[0]), r3(q[1])]; };

  // ---- levels
  const levels = new Map(plan.levels.map((l) => [l.id, l]));
  const sortedLevels = [...plan.levels].sort((a, b) => a.floorZ - b.floorZ);
  const lowest = sortedLevels[0];

  // ---- rooms: outlines in metres
  const outlines = new Map<string, Vec2[]>();
  for (const r of plan.rooms) {
    if (!levels.has(r.level)) err('room.level', `room "${r.id}": unknown level "${r.level}"`);
    if (outlines.has(r.id)) err('room.id', `room "${r.id}": repeated id`);
    const raw = r.rect ? rectPoly(r.rect.length === 4 ? [...P([r.rect[0], r.rect[1]]), ...P([r.rect[2], r.rect[3]])] : r.rect) : r.polygon!.map(P);
    outlines.set(r.id, raw);
  }
  if (regularize) regularizeWalls(plan, outlines, D.interiorWall, adjustments);
  const polys = new Map<string, Vec2[]>();
  for (const r of plan.rooms) {
    const poly = normalizePolygon(outlines.get(r.id)!);
    polys.set(r.id, poly);
    poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if (Math.abs(a[0] - b[0]) > EPS && Math.abs(a[1] - b[1]) > EPS) err('room.orthogonal', `room "${r.id}": edge ${i} is not axis-aligned — the generated shell needs orthogonal outlines`); });
    const lk = opts.lock?.rooms[r.id];
    if (lk && (lk.vertices !== poly.length || Math.abs(lk.first[0] - poly[0][0]) > 0.3 || Math.abs(lk.first[1] - poly[0][1]) > 0.3)) err('ids.lock', `room "${r.id}": the outline changed its vertex count or first corner since the package was released — wall ids would shift (user data refers to them). Re-lock with --force-relock if this is intended.`);
  }
  if (opts.lock) for (const id of Object.keys(opts.lock.rooms)) if (!polys.has(id)) err('ids.lock', `room "${id}" was released and is missing now`);
  const edges = new Map<string, Edge[]>([...polys].map(([id, p]) => [id, edgesOf(id, p)]));
  const levelOfRoom = (id: string) => plan.rooms.find((r) => r.id === id)?.level;

  // overlapping rooms on a level
  for (const a of plan.rooms) for (const b of plan.rooms) {
    if (a.id >= b.id || a.level !== b.level) continue;
    const pa = polys.get(a.id)!, pb = polys.get(b.id)!, [ax0, ay0, ax1, ay1] = bboxOf(pa), [bx0, by0, bx1, by1] = bboxOf(pb);
    if (Math.min(ax1, bx1) - Math.max(ax0, bx0) > 0.02 && Math.min(ay1, by1) - Math.max(ay0, by0) > 0.02) {
      const probe = pa.some((q) => inPolygon([q[0] + 0.01 * Math.sign(((bx0 + bx1) / 2) - q[0]), q[1] + 0.01 * Math.sign(((by0 + by1) / 2) - q[1])], pb));
      if (probe || inPolygon([(ax0 + ax1) / 2, (ay0 + ay1) / 2], pb)) err('room.overlap', `rooms "${a.id}" and "${b.id}" overlap`);
    }
  }

  // ---- walls between rooms: thickness lint
  for (const a of plan.rooms) for (const b of plan.rooms) {
    if (a.id >= b.id || a.level !== b.level) continue;
    for (const ea of edges.get(a.id)!) for (const eb of edges.get(b.id)!) {
      if (ea.axis !== eb.axis || ea.out === eb.out) continue;
      const gap = (eb.c - ea.c) * ea.out, overlap = Math.min(ea.hi, eb.hi) - Math.max(ea.lo, eb.lo);
      if (gap > 0.005 && gap < 0.5 && overlap > 0.3 && Math.abs(gap - D.interiorWall) > 0.015 && Math.abs(gap - D.exteriorWall) > 0.015) {
        warn('wall.thickness', `wall between "${a.id}" and "${b.id}" is ${r3(gap)} m thick (interior ${D.interiorWall}, exterior ${D.exteriorWall}) — check the outlines or record the real thickness`);
      }
    }
  }

  // ---- door and passage gaps
  const gaps = new Map<string, RoomJson['doors']>();
  const addGap = (roomId: string, g: RoomJson['doors'][number]) => { const l = gaps.get(roomId) ?? []; l.push(g); gaps.set(roomId, l); };
  /** the wall of `a` facing `b` (or the exterior) through which the opening at p passes */
  const wallBetween = (a: string, b: string, p: Vec2, w: number, what: string): { axis: 'X' | 'Y'; faces: [number, number]; from: number; to: number; edgeA: Edge; edgeB: Edge | null } | null => {
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
        for (const e2 of eb) {
          if (e2.axis !== e1.axis || e2.out === e1.out) continue;
          const gap = (e2.c - e1.c) * e1.out;
          if (gap <= 0 || gap > 0.6 || from < e2.lo - 0.005 || to > e2.hi + 0.005) continue;
          const mid = (e1.c + e2.c) / 2, off = Math.abs(acrossOf(e1, p) - mid), score = off + Math.abs(t - (from + to) / 2);
          if (off > gap / 2 + 0.3) continue;                 // "at" must be on (or right next to) this wall
          if (!best || score < best.score) best = { score, res: { axis: e1.axis, faces: [Math.min(e1.c, e2.c), Math.max(e1.c, e2.c)].map(r3) as [number, number], from, to, edgeA: e1, edgeB: e2 } };
        }
      } else {
        // exterior: nothing of the same level within the exterior wall thickness on the outward side
        const outer = r3(e1.c + e1.out * D.exteriorWall);
        const blocked = plan.rooms.some((r) => r.id !== a && r.level === levelOfRoom(a) && edges.get(r.id)!.some((e) => e.axis === e1.axis && e.out !== e1.out && (e.c - e1.c) * e1.out > 0 && (e.c - e1.c) * e1.out < 0.6 && Math.min(e.hi, to) - Math.max(e.lo, from) > 0));
        if (blocked) continue;
        const score = Math.abs(acrossOf(e1, p) - (e1.c + outer) / 2);
        if (score > 0.8) continue;
        if (!best || score < best.score) best = { score, res: { axis: e1.axis, faces: [Math.min(e1.c, outer), Math.max(e1.c, outer)].map(r3) as [number, number], from, to, edgeA: e1, edgeB: null } };
      }
    }
    if (!best) err('door.wall', `${what}: no wall ${b === 'exterior' ? `of "${a}" on the outside of the building` : `shared by "${a}" and "${b}"`} holds a ${w} m opening at [${p.map(r3).join(', ')}] — move "at" onto the wall or check the outlines`);
    return best?.res ?? null;
  };

  const doors: DoorDef[] = [];
  for (const d of plan.doors) {
    const [a, b] = d.between, what = `door "${d.id}"`;
    const p = P(d.at), w = d.width;
    const wall = wallBetween(a, b, p, w, what);
    if (!wall) continue;
    const opHeight = d.height ?? D.doorHeight, leafW = r3(w - 0.1);
    const gap = { along: wall.axis, from_: wall.from, to: wall.to, across: wall.faces, width: r2(w), door_id: d.id, leaf: r2(leafW), height: opHeight } as RoomJson['doors'][number];
    addGap(a, gap); if (b !== 'exterior') addGap(b, { ...gap });
    const base: Pick<DoorDef, 'id' | 'level' | 'rooms' | 'floorZ' | 'opening' | 'leafWidth' | 'height' | 'type' | 'source' | 'confidence'> = { id: d.id, level: levelOfRoom(a)!, rooms: [a, b], floorZ: levels.get(levelOfRoom(a)!)?.floorZ ?? 0,
      opening: { along: wall.axis, from: wall.from, to: wall.to, faces: [...wall.faces], width: r2(w), height: opHeight }, leafWidth: r2(leafW), height: d.leafHeight ?? D.leafHeight,
      type: d.type, source: [d.source ?? source], confidence: d.confidence ?? D.confidence };
    // the wall line runs along `axis`; unit vector along it and the across direction
    const u: Vec2 = wall.axis === 'X' ? [1, 0] : [0, 1];
    if (d.type === 'hinged-single') {
      const into = d.swingInto ?? (b === 'exterior' ? a : b);
      if (into !== a && into !== b) { err('door.swing', `${what}: swingInto "${into}" is not one of ${a} / ${b}`); continue; }
      if (into === 'exterior') { err('door.swing', `${what}: a door cannot open into the exterior in the engine — let it open into "${a}"`); continue; }
      // face of the room the door opens into and the normal into that room
      const intoEdge = into === a ? wall.edgeA : wall.edgeB!, n: Vec2 = wall.axis === 'X' ? [0, -intoEdge.out] : [-intoEdge.out, 0];
      const view: Vec2 = [-n[0], -n[1]], right: Vec2 = [view[1], -view[0]];
      const side = d.hinge ?? 'left';
      // right side of the opening as seen from the room = end of the gap in the `right` direction
      const rightIsEnd = right[0] * u[0] + right[1] * u[1] > 0;
      const hingeAtEnd = side === 'right' ? rightIsEnd : !rightIsEnd;
      const jamb = hingeAtEnd ? wall.to : wall.from, t = hingeAtEnd ? jamb - 0.05 : jamb + 0.05;
      const face = intoEdge.c;
      const hinge: Vec2 = wall.axis === 'X' ? [r3(t), face] : [face, r3(t)];
      const closedDir: Vec2 = hingeAtEnd ? [-u[0], -u[1]] : [u[0], u[1]];
      doors.push({ ...base, hinge, closedDir: closedDir.map(cleanZero) as Vec2, openDir: n.map(cleanZero) as Vec2, hingeSide: side, swingInto: into, openAngle: 90, slide: null });
    } else {
      const toEnd = (d.slideTo ?? 'end') === 'end', mid = r3((wall.faces[0] + wall.faces[1]) / 2);
      const originT = toEnd ? wall.from : wall.to, dir: Vec2 = toEnd ? u : [-u[0], -u[1]];
      const origin: Vec2 = wall.axis === 'X' ? [originT, mid] : [mid, originT];
      doors.push({ ...base, hinge: null, closedDir: null, openDir: null, hingeSide: null, swingInto: null, openAngle: null, slide: { origin, dir: dir.map(cleanZero) as Vec2, travel: r2(leafW) } });
    }
  }
  for (const g of plan.passages) {
    const [a, b] = g.between, p = P(g.at), wall = wallBetween(a, b, p, g.width, `passage ${a} ↔ ${b}`);
    if (!wall) continue;
    const gap = { along: wall.axis, from_: wall.from, to: wall.to, across: wall.faces, width: r2(g.width), door_id: null, leaf: null, height: g.height ?? null } as RoomJson['doors'][number];
    addGap(a, gap); if (b !== 'exterior') addGap(b, { ...gap });
  }

  // ---- windows
  const windows = new Map<string, RoomJson['openings']>();
  for (const w of plan.windows) {
    const es = edges.get(w.room);
    if (!es) { err('ref', `window "${w.id}": unknown room "${w.room}"`); continue; }
    const p = P(w.at);
    let best: Edge | null = null, bd = Infinity;
    for (const e of es) {
      const t = alongOf(e, p), dd = Math.abs(acrossOf(e, p) - e.c) + (t < e.lo ? e.lo - t : t > e.hi ? t - e.hi : 0);
      if (dd < bd) { bd = dd; best = e; }
    }
    if (!best || bd > 0.6) { err('window.wall', `window "${w.id}": "at" is not on a wall of "${w.room}"`); continue; }
    const t = alongOf(best, p), from = r3(t - w.width / 2), to = r3(t + w.width / 2);
    if (from < best.lo - 0.005 || to > best.hi + 0.005) err('window.span', `window "${w.id}": ${w.width} m does not fit the wall (${r3(best.lo)}…${r3(best.hi)})`);
    const interior = plan.rooms.some((r) => r.id !== w.room && r.level === levelOfRoom(w.room) && edges.get(r.id)!.some((e) => e.axis === best!.axis && e.out !== best!.out && (e.c - best!.c) * best!.out > 0 && (e.c - best!.c) * best!.out < 0.6 && Math.min(e.hi, to) - Math.max(e.lo, from) > 0));
    if (interior) warn('window.interior', `window "${w.id}" sits on an interior wall of "${w.room}"`);
    const sill = w.sill ?? (w.passable ? 0 : D.sill), head = w.head ?? D.head;
    const list = windows.get(w.room) ?? [];
    // sill_z / head_z are absolute (project Z), like every height in rooms data — the engine subtracts the room floor
    const fz = levels.get(levelOfRoom(w.room)!)?.floorZ ?? 0;
    list.push({ id: w.id, kind: sill < 0.05 ? 'window (floor-to-lintel)' : 'window', plane_axis: best.axis === 'X' ? 'Y' : 'X', inner: best.c, from_: from, to, sill_z: r3(fz + sill), head_z: r3(fz + head) });
    windows.set(w.room, list);
  }

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
    const [a, b] = [P([s.box[0], s.box[1]]), P([s.box[2], s.box[3]])];
    const box: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const rise = lt.floorZ - lf.floorZ, riser = r3(rise / (2 * s.risers)), run = r3((s.risers - 1) * s.tread);
    if (riser > 0.2 || riser < 0.14) warn('stairs.riser', `stairs "${s.id}": riser ${riser} m (comfortable: 0.15–0.19)`);
    const width = 2 * s.flightWidth + s.gap;
    if (Math.abs(box[2] - box[0] - width) > 0.06) warn('stairs.width', `stairs "${s.id}": box is ${r3(box[2] - box[0])} m wide, flights need ${r3(width)} m`);
    if (box[3] - box[1] < run + s.flightWidth * 0.8) err('stairs.depth', `stairs "${s.id}": box is too short for ${s.risers - 1} treads of ${s.tread} m plus a landing`);
    stairs.push({ id: s.id, kind: 'u-turn', fromLevel: s.from, toLevel: s.to, bbox: box, risers: s.risers, riser, tread: s.tread, flightWidth: s.flightWidth, gap: s.gap,
      landingZ: r3(rise / 2), topZ: r3(rise), split: r3(box[0] + s.flightWidth + s.gap / 2), run, landingEdge: r3(box[3] - run),
      confidence: s.confidence ?? D.confidence, ...(s.note ? { note: s.note } : {}) });
    // opening in the floor of the upper level: the room of `to` containing the box centre
    const c: Vec2 = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const upper = plan.rooms.find((r) => r.level === s.to && inPolygon(c, polys.get(r.id)!));
    if (!upper) err('stairs.arrival', `stairs "${s.id}": no room of level "${s.to}" contains the stair box`);
    else stairOpenings.set(upper.id, box);
    const lower = plan.rooms.find((r) => r.level === s.from && inPolygon(c, polys.get(r.id)!));
    if (!lower) err('stairs.start', `stairs "${s.id}": no room of level "${s.from}" contains the stair box`);
  }

  // ---- sloped ceilings (per level) and roof windows
  const along = (axis: 0 | 1, c: number) => (axis === 0 ? P([c, 0])[0] : P([0, c])[1]);
  const attics = new Map<string, RoomJson['ceiling']>();
  for (const lv of plan.levels) {
    if (!lv.slope) continue;
    const s = lv.slope, ax: 0 | 1 = s.ridge === 'X' ? 1 : 0;          // ridge along X → heights vary with y
    const outline = plan.rooms.filter((r) => r.level === lv.id).flatMap((r) => polys.get(r.id) ?? []);
    if (!outline.length) continue;
    const lo = Math.min(...outline.map((q) => q[ax])), hi = Math.max(...outline.map((q) => q[ax]));
    const ridge = s.ridgeAt !== undefined ? along(ax, s.ridgeAt) : (lo + hi) / 2;
    const lines = s.lines.map((l) => ({ at: along(ax, l.at), height: l.height }));
    let k: number;
    if (lines.length === 2) {
      const [a, b] = lines;
      if ((a.at - ridge) * (b.at - ridge) < 0) { err('level.slope', `level "${lv.id}": both slope lines must lie on one side of the ridge`); continue; }
      k = Math.abs(b.height - a.height) / Math.max(1e-6, Math.abs(b.at - a.at));
      if (Math.abs(b.at - ridge) < Math.abs(a.at - ridge) !== b.height > a.height) err('level.slope', `level "${lv.id}": the ceiling must rise towards the ridge`);
    } else k = Math.tan((s.pitch! * Math.PI) / 180);
    if (lines.length === 2 && s.pitch !== undefined && Math.abs(Math.atan(k) * 180 / Math.PI - s.pitch) > 5) warn('level.slope', `level "${lv.id}": the lines give a ${r2(Math.atan(k) * 180 / Math.PI)}° slope, the pitch says ${s.pitch}°`);
    const fz = lv.floorZ, flat = s.flat ?? lv.ceiling, l0 = lines[0];
    const zRidge = fz + l0.height + k * Math.abs(ridge - l0.at);
    if (zRidge - fz < flat) warn('level.slope', `level "${lv.id}": the slope does not reach the flat ceiling at ${flat} m — check the lines or the pitch`);
    const ceiling = { kind: 'attic' as const, flat_z: r3(fz + flat), ...(ax === 1 ? { ridge_y: r3(ridge) } : { ridge_x: r3(ridge) }), z_at_ridge: r3(zRidge), slope: r3(k) };
    for (const r of plan.rooms) if (r.level === lv.id && r.ceiling === undefined) attics.set(r.id, ceiling as RoomJson['ceiling']);
  }
  const roofWindows = new Map<string, RoomJson['roof_windows']>();
  for (const w of plan.roofWindows) {
    if (!polys.has(w.room)) { err('ref', `roof window "${w.id}": unknown room "${w.room}"`); continue; }
    if (!attics.has(w.room)) warn('roofWindow.flat', `roof window "${w.id}": room "${w.room}" has no sloped ceiling`);
    const a = P([w.rect[0], w.rect[1]]), b = P([w.rect[2], w.rect[3]]);
    roofWindows.set(w.room, [...(roofWindows.get(w.room) ?? []), { id: w.id, plan_rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(r3) }]);
  }

  // ---- rooms
  const rooms: RoomJson[] = plan.rooms.map((r) => {
    const poly = polys.get(r.id)!, lv = levels.get(r.level), floorZ = lv?.floorZ ?? 0, area = r2(Math.abs(area2(poly)) / 2);
    const bb = bboxOf(poly);
    if (r.areaPrinted && Math.abs(area - r.areaPrinted) / r.areaPrinted > 0.1) warn('room.area', `room "${r.id}": computed area ${area} m² differs from the printed ${r.areaPrinted} m² by more than 10 %`);
    return {
      id: r.id, name: r.name, ...(r.label ? { label: r.label } : {}), level: r.level, floor_z: floorZ, area, area_data: r.areaPrinted ?? area, id_source: r.source ?? source,
      bbox: bb, polygon: poly, rectangular: poly.length === 4, ceiling: attics.get(r.id) ?? { kind: 'flat', z: r3(floorZ + (r.ceiling ?? lv?.ceiling ?? 2.6)) },
      stair_opening: stairOpenings.get(r.id) ?? null, doors: gaps.get(r.id) ?? [], openings: windows.get(r.id) ?? [], roof_windows: roofWindows.get(r.id) ?? [], kind: r.kind, tags: r.tags ?? [],
    } as RoomJson;
  });

  // ---- furniture
  const cat = new Map(opts.catalog.map((c) => [c.id, c]));
  const keys = new Map<string, number>();
  const items: ArchitectItem[] = [];
  for (const f of plan.furniture) {
    const it = cat.get(f.catalogId), poly = polys.get(f.room);
    if (!it) { err('furniture.catalog', `furniture in "${f.room}": unknown catalog item "${f.catalogId}" (see data/furnitureCatalog.json)`); continue; }
    if (!poly) { err('ref', `furniture "${f.catalogId}": unknown room "${f.room}"`); continue; }
    const vd = it.variants?.find((v) => v.id === f.variant)?.dimensions ?? {};
    const dims = { ...it.dimensions, ...vd, ...(f.dims ?? {}) };
    if (f.variant && !it.variants?.some((v) => v.id === f.variant)) err('furniture.variant', `furniture "${f.catalogId}" in "${f.room}": unknown variant "${f.variant}" (${(it.variants ?? []).map((v) => v.id).join(', ') || 'no variants'})`);
    let x: number, y: number, rot: number;
    if (f.wall) {
      const [x0, y0, x1, y1] = bboxOf(poly), gapW = 0.005, half = dims.d / 2 + gapW;
      const along = f.along !== undefined ? (plan.units === 'px' ? P(f.wall === 'N' || f.wall === 'S' ? [f.along, 0] : [0, f.along])[f.wall === 'N' || f.wall === 'S' ? 0 : 1] : f.along) : undefined;
      if (f.wall === 'S') { x = along ?? (x0 + x1) / 2; y = y0 + half; rot = 0; }
      else if (f.wall === 'N') { x = along ?? (x0 + x1) / 2; y = y1 - half; rot = 180; }
      else if (f.wall === 'W') { x = x0 + half; y = along ?? (y0 + y1) / 2; rot = 270; }
      else { x = x1 - half; y = along ?? (y0 + y1) / 2; rot = 90; }
    } else if (f.at) { [x, y] = P(f.at); rot = f.rot ?? 0; }
    else { err('furniture.place', `furniture "${f.catalogId}" in "${f.room}": give "at" (+ rot) or "wall" (+ along)`); continue; }
    if (!inPolygon([x, y], poly)) warn('furniture.outside', `furniture "${f.catalogId}" in "${f.room}": centre [${r3(x)}, ${r3(y)}] is outside the room`);
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
      const [x0, y0, x1, y1] = bboxOf(poly), al = q.along ?? 0;
      [x, y] = q.wall === 'S' ? [al, y0] : q.wall === 'N' ? [al, y1] : q.wall === 'W' ? [x0, al] : [x1, al];
    } else if (q.at) [x, y] = P(q.at);
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
    const footprint: Vec2[] = [[bx0 - t, by0 - t], [bx1 + t, by0 - t], [bx1 + t, by1 + t], [bx0 - t, by1 + t]].map(([x, y]) => [r3(x), r3(y)] as Vec2);
    const m = plan.site.margin ?? 6;
    const boundary: Vec2[] = plan.site.boundary ? plan.site.boundary.map(P) : footprint.map(([x, y], i) => [r3(x + (i === 1 || i === 2 ? m : -m)), r3(y + (i >= 2 ? m : -m))] as Vec2);
    site = { footprint, boundary, groundLevel: plan.site.groundLevel, levelId: lowest.id };
    if (all.some((q) => !inPolygon(q, boundary))) err('site.boundary', 'the building is not inside the plot boundary');
  }
  const sun = plan.sun ? { lat: plan.sun.lat, lon: plan.sun.lon, gridAzimuthX: plan.sun.northAzimuthX, convergence: 0, trueAzimuthX: plan.sun.northAzimuthX, confidence: plan.sun.confidence, uncertaintyDeg: plan.sun.confidence === 'confirmed' ? 2 : 15, timeZone: plan.sun.timeZone, ...(plan.sun.placeName ? { placeName: plan.sun.placeName } : {}) } : undefined;
  if (sun) { try { new Intl.DateTimeFormat('en-US', { timeZone: sun.timeZone }); } catch { err('sun.timeZone', `unknown IANA time zone "${sun.timeZone}"`); } }

  // ---- viewpoints
  const viewpoints: Viewpoint[] = plan.viewpoints.map((v) => { const p = P(v.at), look = P([v.look[0], v.look[1]]); return { id: v.id, name: v.name, p, level: v.level, look: [look[0], look[1], v.look[2]], fov: v.fov, hint: v.hint }; });

  // ---- manifest
  const modules: ProjectModule[] = [...(site ? ['site' as const] : []), ...(plan.assets?.environment ? ['environment' as const] : []), ...(sun ? ['sun' as const] : []), ...(stairs.length ? ['stairs' as const] : [])];
  if (plan.assets?.site && !site) err('assets.site', 'a terrain model needs the "site" block');
  const dv = plan.defaultView;
  const project: ProjectPackage = {
    schema: 'home-simulator/project', version: 1,
    manifest: {
      projectId: plan.project.id, name: plan.project.name,
      ...(plan.project.description ? { description: plan.project.description } : {}), ...(plan.project.documentTitle ? { documentTitle: plan.project.documentTitle } : {}),
      ...(plan.project.language ? { language: plan.project.language } : {}),
      units: 'm',
      coordinateSystem: { name: 'LCS', description: plan.project.origin ?? 'origin at the outer corner of the building (bottom-left of the plan); +X right on the plan, +Y up on the plan, +Z up; Z = 0 is the finished floor of the lowest level', up: 'Z', handedness: 'right' },
      buildingType: plan.project.buildingType,
      levels: sortedLevels.map((l) => ({ id: l.id, name: l.name, floorZ: l.floorZ })),
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
      shell: { exteriorWall: D.exteriorWall, slab: D.slab },
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
  return { project: issues.some((i) => i.level === 'error') ? null : project, issues, adjustments };
}

/**
 * Raster plans: faces of different rooms that should lie on one wall line drift by a few centimetres, and shared walls come out
 * 9 or 15 cm thick. (1) faces of the same side within 4 cm are averaged; (2) a wall between two rooms whose thickness is within
 * 8 cm of the interior wall gets exactly the interior thickness, keeping its centre line. Every change is reported.
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
      for (const id of ids) outlines.set(id, outlines.get(id)!.map((q) => { const n: Vec2 = [q[0], q[1]]; n[axis] = map.get(q[axis]) ?? q[axis]; return n; }));
    }
    // (2) shared walls → interior thickness
    for (const a of plan.rooms) for (const b of plan.rooms) {
      if (a.level !== b.level || a.id === b.id) continue;
      const pa = outlines.get(a.id)!, pb = outlines.get(b.id)!;
      const ahi = Math.max(...pa.map((q) => q[axis])), blo = Math.min(...pb.map((q) => q[axis]));
      const gap = blo - ahi, o = 1 - axis;
      const overlap = Math.min(Math.max(...pa.map((q) => q[o])), Math.max(...pb.map((q) => q[o]))) - Math.max(Math.min(...pa.map((q) => q[o])), Math.min(...pb.map((q) => q[o])));
      if (gap <= 0.01 || overlap < 0.3 || Math.abs(gap - t) < 0.002 || Math.abs(gap - t) > 0.08) continue;
      const c = (ahi + blo) / 2, na = snap5(c - t / 2), nb = r3(na + t);
      outlines.set(a.id, pa.map((q) => (Math.abs(q[axis] - ahi) < 1e-9 ? (axis === 0 ? [na, q[1]] : [q[0], na]) : q) as Vec2));
      outlines.set(b.id, pb.map((q) => (Math.abs(q[axis] - blo) < 1e-9 ? (axis === 0 ? [nb, q[1]] : [q[0], nb]) : q) as Vec2));
      log.push(`wall ${a.id} | ${b.id}: ${r3(gap)} m → ${t} m (centre line kept at ${r3(c)})`);
    }
  }
}
