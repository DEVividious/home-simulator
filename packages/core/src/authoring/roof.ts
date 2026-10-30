// plan.json › roof → project.json › building.roof (ADR 0027, 0028). Every part is resolved to its outline rectangle (outer wall
// faces), its extent (the outline grown by the eaves and verges, and the strip that carries a subordinate wing into the wing it
// joins — up to that wing's ridge, so valleys and the lower ridge running into the higher roof come out of the union) and its
// underside planes (from the knee height or the 1.40 / 2.20 lines, and the pitch). Dormers stand on one plane of a part and are
// carried back to its ridge; chimneys run from the slab of the lowest level they stand in. A level slope without a roof block
// becomes a gable part with exactly the planes of the old attic ceilings. The checks a union cannot make are made here.
import { area } from '../model/geom2d.ts';
import { outerOutline } from '../model/outline.ts';
import { gableExtent, inRegion, planeJson, planeZ, raise, regionPolygon, roofModel, ROOF_DEFAULTS, surfaceAt, surfaceRange, type Plane, type RoofModel } from '../model/roof.ts';
import type { DormerJson, Rect, RoofJson, RoofPartJson, Vec2 } from '../package/types.ts';
import type { Plan } from './plan.ts';

type PlanRoof = NonNullable<Plan['roof']>;
type PartIn = PlanRoof['parts'][number];

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);
const deg = (k: number) => (Math.atan(k) * 180) / Math.PI;
const rectOf = (a: Vec2, b: Vec2): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const bboxOf = (pts: Vec2[]): Rect => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
const grow = (r: Rect, d: number): Rect => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const r3Rect = (r: Rect): Rect => r.map(r3) as Rect;

export interface RoofContext {
  plan: Plan;
  /** a plan point in project metres (`at` — the level, or a room of it, the point was read on) */
  P: (p: Vec2, at?: string) => Vec2;
  /** one coordinate of a plan point (axis 0: x, 1: y) in project metres */
  along: (axis: 0 | 1, c: number, level: string) => number;
  /** room outlines in metres */
  polys: Map<string, Vec2[]>;
  err: (code: string, message: string) => void;
  warn: (code: string, message: string) => void;
}

/** a window of a dormer front that stands in a wall: an ordinary window of the room (metres) */
export interface DormerWallWindow { id: string; room: string; at: Vec2; width: number; sill?: number; head?: number }

export interface CompiledRoof {
  json: RoofJson | null;
  model: RoofModel | null;
  windows: DormerWallWindow[];
}

/** the planes of a gable from the ridge position and height (zr) and the slope k; `ax` — the coordinate across the ridge */
const gablePlanes = (ax: 0 | 1, r: number, zr: number, k: number): Plane[] => (ax === 1
  ? [{ gx: 0, gy: -k, z0: zr + k * r }, { gx: 0, gy: k, z0: zr - k * r }]
  : [{ gx: -k, gy: 0, z0: zr + k * r }, { gx: k, gy: 0, z0: zr - k * r }]);

interface Resolved {
  in: PartIn | null;
  id: string;
  level: string;
  type: RoofPartJson['type'];
  rect: Rect | null;
  polygon: Vec2[] | null;
  ridge: 'X' | 'Y' | null;
  /** ridge coordinate across, ridge underside height, slope of the long planes */
  r: number; zr: number; k: number; pitch: number;
  planes: Plane[];
  /** overhang per side: W, S, E, N */
  over: [number, number, number, number];
  /** strips that carry the part into the wing it joins */
  extra: Rect[];
  /** hip end planes by side (dropped at a joined end) */
  ends: { W?: Plane; E?: Plane; S?: Plane; N?: Plane };
}

export function compileRoof(ctx: RoofContext): CompiledRoof {
  const { plan, P, along, polys, err, warn } = ctx, D = plan.defaults, t = D.exteriorWall;
  const levels = new Map(plan.levels.map((l) => [l.id, l]));
  const roomsOf = (level: string) => plan.rooms.filter((r) => r.level === level);
  /** the walls of a level in plan: its rooms grown by the exterior wall */
  const grownRooms = (level: string) => roomsOf(level).map((r) => grownPolygon(polys.get(r.id)!, t));
  /** levels above a level (by floor height) */
  const above = (level: string) => plan.levels.filter((l) => l.floorZ > (levels.get(level)?.floorZ ?? 0) + 0.01).map((l) => l.id);
  /** whether a point lies over the walls of a level (its rooms grown by the exterior wall) */
  const overLevel = (level: string, x: number, y: number) => grownRooms(level).some((g) => inRegion(g, x, y));
  const R = plan.roof, covering = R?.covering ?? ROOF_DEFAULTS.covering, buildup = R?.buildup ?? ROOF_DEFAULTS.buildup;
  const eavesDefault = R?.eaves ?? ROOF_DEFAULTS.eaves, vergeDefault = R?.verge ?? ROOF_DEFAULTS.verge;
  const parts: Resolved[] = [];

  /** the slope of a level as gable data: ridge, its height and the slope (the old attic formula) */
  const slopeGable = (lv: Plan['levels'][number], rect: Rect) => {
    const s = lv.slope!, ax: 0 | 1 = s.ridge === 'X' ? 1 : 0, lo = rect[ax] + t, hi = rect[ax + 2] - t;
    const r = s.ridgeAt !== undefined ? along(ax, s.ridgeAt, lv.id) : (lo + hi) / 2;
    const lines = s.lines.map((l) => ({ at: along(ax, l.at, lv.id), height: l.height }));
    let k: number;
    if (lines.length === 2) {
      const [a, b] = lines;
      if ((a.at - r) * (b.at - r) < 0) { err('level.slope', `level "${lv.id}": both slope lines must lie on one side of the ridge`); return null; }
      k = Math.abs(b.height - a.height) / Math.max(1e-6, Math.abs(b.at - a.at));
      if (Math.abs(b.at - r) < Math.abs(a.at - r) !== b.height > a.height) err('level.slope', `level "${lv.id}": the ceiling must rise towards the ridge`);
      if (s.pitch !== undefined && Math.abs(deg(k) - s.pitch) > 5) warn('level.slope', `level "${lv.id}": the lines give a ${Math.round(deg(k) * 100) / 100}° slope, the pitch says ${s.pitch}°`);
    } else k = tan(s.pitch!);
    const zr = lv.floorZ + lines[0].height + k * Math.abs(r - lines[0].at), flat = s.flat ?? lv.ceiling;
    if (zr - lv.floorZ < flat) warn('level.slope', `level "${lv.id}": the slope does not reach the flat ceiling at ${flat} m — check the lines or the pitch`);
    return { ridge: s.ridge, ax, r, zr, k };
  };

  /** the outline of a level as a rectangle (outer faces), or null with the outline polygon when it is not one */
  const levelRect = (level: string): { rect: Rect | null; polygon: Vec2[] } => {
    const outline = outerOutline(roomsOf(level).map((r) => polys.get(r.id)!), t), b = bboxOf(outline);
    return { rect: Math.abs(area(outline) - (b[2] - b[0]) * (b[3] - b[1])) < 1e-6 ? b : null, polygon: outline };
  };

  if (R) {
    for (const p of R.parts) {
      const lv = levels.get(p.level), what = `roof part "${p.id}"`;
      if (!lv) { err('roof.level', `${what}: unknown level "${p.level}"`); continue; }
      if (!roomsOf(p.level).length) { err('roof.level', `${what}: level "${p.level}" has no rooms`); continue; }
      let rect: Rect | null = null, polygon: Vec2[] | null = null;
      if (p.rect) rect = rectOf(P([p.rect[0], p.rect[1]], p.level), P([p.rect[2], p.rect[3]], p.level));
      else if (p.rooms) {
        const bad = p.rooms.filter((id) => !polys.has(id) || plan.rooms.find((r) => r.id === id)!.level !== p.level);
        if (bad.length) { err('roof.rooms', `${what}: ${bad.join(', ')} — not rooms of level "${p.level}"`); continue; }
        rect = grow(bboxOf(p.rooms.flatMap((id) => polys.get(id)!)), t);
      } else if (p.polygon) polygon = p.polygon.map((q) => P(q, p.level));
      else {
        const o = levelRect(p.level);
        if (o.rect) rect = o.rect;
        else if (p.type === 'flat') polygon = o.polygon;
        else { err('roof.rect', `${what}: the outline of level "${p.level}" is not a rectangle — give "rect" or "rooms" for every wing`); continue; }
      }
      if (rect) rect = r3Rect(rect);
      const box = rect ?? bboxOf(polygon!), fz = lv.floorZ;
      const zKnee = fz + (p.knee ?? (p.type === 'flat' ? lv.ceiling : lv.ceiling + D.slab));
      const ridge: 'X' | 'Y' = p.ridge ?? (box[2] - box[0] >= box[3] - box[1] ? 'X' : 'Y');
      const res: Resolved = { in: p, id: p.id, level: p.level, type: p.type, rect, polygon, ridge: p.type === 'gable' || p.type === 'hip' ? ridge : null, r: 0, zr: zKnee, k: 0, pitch: p.pitch ?? 0, planes: [], over: [0, 0, 0, 0], extra: [], ends: {} };
      // the slope from two lines, or the pitch
      const lines = p.lines?.map((l) => ({ at: 0, raw: l.at, height: l.height }));
      const slopeK = (ax: 0 | 1) => {
        if (lines?.length === 2) {
          for (const l of lines) l.at = along(ax, l.raw, p.level);
          const k = Math.abs(lines[1].height - lines[0].height) / Math.max(1e-6, Math.abs(lines[1].at - lines[0].at));
          if (p.pitch !== undefined && Math.abs(deg(k) - p.pitch) > 5) warn('roof.pitch', `${what}: the lines give ${Math.round(deg(k) * 10) / 10}°, the pitch says ${p.pitch}°`);
          return k;
        }
        if (lines) for (const l of lines) l.at = along(ax, l.raw, p.level);
        if (p.pitch === undefined) { if (p.type !== 'flat') err('roof.pitch', `${what}: give the pitch (or two height lines)`); return 0; }
        return tan(p.pitch);
      };
      if (p.type === 'gable' || p.type === 'hip') {
        const ax: 0 | 1 = ridge === 'X' ? 1 : 0, c0 = box[ax], c1 = box[ax + 2];
        const r = p.ridgeAt !== undefined ? along(ax, p.ridgeAt, p.level) : (c0 + c1) / 2, k = slopeK(ax);
        // the ridge height: from a height line, or from the knee at the farther eaves wall
        const zr = lines ? fz + lines[0].height + k * Math.abs(r - lines[0].at) : zKnee + k * Math.max(r - c0, c1 - r);
        Object.assign(res, { r, zr, k, pitch: deg(k), planes: gablePlanes(ax, r, zr, k) });
        const [o0, o1] = [p.eaves ?? eavesDefault, p.verge ?? vergeDefault];
        res.over = ridge === 'X' ? [p.type === 'hip' ? o0 : o1, o0, p.type === 'hip' ? o0 : o1, o0] : [o0, p.type === 'hip' ? o0 : o1, o0, p.type === 'hip' ? o0 : o1];
        if (p.type === 'hip') {
          const ke = tan(p.pitchEnds ?? p.pitch ?? deg(k)), zE = zr - k * Math.max(r - c0, c1 - r), e = 1 - ax, e0 = box[e], e1 = box[e + 2];
          const lo: Plane = e === 0 ? { gx: ke, gy: 0, z0: zE - ke * e0 } : { gx: 0, gy: ke, z0: zE - ke * e0 };
          const hi: Plane = e === 0 ? { gx: -ke, gy: 0, z0: zE + ke * e1 } : { gx: 0, gy: -ke, z0: zE + ke * e1 };
          res.ends = e === 0 ? { W: lo, E: hi } : { S: lo, N: hi };
          if (2 * ((zr - zE) / ke) > e1 - e0 + 1e-6) warn('roof.hip', `${what}: the hip ends meet before the ridge — the roof becomes a pyramid (tent) roof`);
          if (p.pitchEnds !== undefined && (p.pitchEnds < 5 || p.pitchEnds > 75)) err('roof.pitch', `${what}: hip end pitch ${p.pitchEnds}° (5–75°)`);
        }
      } else {
        const down = p.down ?? 'S', k = slopeK(down === 'S' || down === 'N' ? 1 : 0);
        if (p.type === 'shed' || k > 0) {
          // rises away from the low eaves on the `down` side
          const ax: 0 | 1 = down === 'S' || down === 'N' ? 1 : 0, sgn = down === 'S' || down === 'W' ? 1 : -1, edge = sgn > 0 ? box[ax] : box[ax + 2];
          const zLow = lines ? fz + lines[0].height - k * sgn * (lines[0].at - edge) : zKnee;
          const plane: Plane = ax === 1 ? { gx: 0, gy: sgn * k, z0: zLow - sgn * k * edge } : { gx: sgn * k, gy: 0, z0: zLow - sgn * k * edge };
          const zHigh = planeZ(plane, sgn > 0 && ax === 0 ? box[2] : box[0], sgn > 0 && ax === 1 ? box[3] : box[1]);
          Object.assign(res, { r: sgn > 0 ? box[ax + 2] : box[ax], zr: Math.max(zLow, zHigh), k, pitch: deg(k), planes: [plane] });
        } else Object.assign(res, { zr: lines ? fz + lines[0].height : zKnee, planes: [{ gx: 0, gy: 0, z0: lines ? fz + lines[0].height : zKnee }] });
        const o0 = p.eaves ?? (p.type === 'flat' ? 0 : eavesDefault), o1 = p.verge ?? (p.type === 'flat' ? o0 : vergeDefault);
        res.over = down === 'S' || down === 'N' ? [o1, o0, o1, o0] : [o0, o1, o0, o1];
      }
      if (p.type === 'flat' ? res.pitch > 5 : res.pitch < 5 || res.pitch > 75) err('roof.pitch', `${what}: pitch ${Math.round(res.pitch * 10) / 10}° (${p.type === 'flat' ? 'flat: 0–5°' : '5–75°'})`);
      if (p.parapet && p.type !== 'flat') err('roof.parapet', `${what}: a parapet belongs to a flat part`);
      parts.push(res);
    }
  } else {
    // no roof block: every level slope becomes a gable part with the planes of the old attic ceilings
    for (const lv of plan.levels) {
      if (!lv.slope || !roomsOf(lv.id).length) continue;
      const o = levelRect(lv.id), rect = r3Rect(o.rect ?? bboxOf(o.polygon));
      if (!o.rect) warn('roof.outline', `level "${lv.id}": the outline is not a rectangle — the gable from its slope covers the bounding rectangle; describe the wings in a "roof" block`);
      const g = slopeGable(lv, rect);
      if (!g) continue;
      const res: Resolved = { in: null, id: `slope-${lv.id}`, level: lv.id, type: 'gable', rect, polygon: null, ridge: g.ridge, r: g.r, zr: g.zr, k: g.k, pitch: deg(g.k), planes: gablePlanes(g.ax, g.r, g.zr, g.k), over: [0, 0, 0, 0], extra: [], ends: {} };
      const e = gableExtent(rect, g.ridge, ROOF_DEFAULTS.eaves, ROOF_DEFAULTS.verge);
      res.over = [rect[0] - e[0], rect[1] - e[1], e[2] - rect[2], e[3] - rect[3]];
      parts.push(res);
    }
  }
  const ids = new Set<string>();
  for (const p of parts) { if (ids.has(p.id)) err('roof.id', `roof part "${p.id}": repeated id`); ids.add(p.id); }

  // ---- sides against a higher level: no overhang (the roof meets that level's wall)
  for (const p of parts) {
    const b = p.rect ?? bboxOf(p.polygon!), up = above(p.level), e = 0.02;
    const sides: [Vec2, Vec2, Vec2][] = [[[b[0], b[1]], [b[0], b[3]], [-1, 0]], [[b[0], b[1]], [b[2], b[1]], [0, -1]], [[b[2], b[1]], [b[2], b[3]], [1, 0]], [[b[0], b[3]], [b[2], b[3]], [0, 1]]];
    sides.forEach(([a, c, out], i) => {
      const hits = [0.25, 0.5, 0.75].some((s) => up.some((l) => overLevel(l, a[0] + (c[0] - a[0]) * s + out[0] * e, a[1] + (c[1] - a[1]) * s + out[1] * e)));
      if (hits) p.over[i] = 0;
    });
    // a level above the part's roof
    for (const l of up) for (const g of grownRooms(l).map(bboxOf)) {
      const w = Math.min(g[2], b[2]) - Math.max(g[0], b[0]), d = Math.min(g[3], b[3]) - Math.max(g[1], b[1]);
      if (w > t + 0.02 && d > t + 0.02) { err('roof.levelAbove', `roof part "${p.id}": level "${l}" stands over it — a roof part covers the top of its level`); break; }
    }
  }

  // ---- joins: a pitched wing whose end meets a wing with a crossing ridge (at least as high) runs into it up to its ridge
  const extentOf = (p: Resolved): Rect => { const b = p.rect!; return [b[0] - p.over[0], b[1] - p.over[1], b[2] + p.over[2], b[3] + p.over[3]]; };
  const pitched = parts.filter((p) => p.rect && p.ridge);
  const joins: [Resolved, Resolved][] = [];
  for (const a of pitched) for (const end of a.ridge === 'X' ? ['W', 'E'] as const : ['S', 'N'] as const) {
    const b = a.rect!, i = { W: 0, S: 1, E: 2, N: 3 }[end], sgn = end === 'W' || end === 'S' ? -1 : 1, ax = end === 'W' || end === 'E' ? 0 : 1;
    const edge = b[i], mid = ax === 0 ? (b[1] + b[3]) / 2 : (b[0] + b[2]) / 2;
    const probe: Vec2 = ax === 0 ? [edge + sgn * 0.01, mid] : [mid, edge + sgn * 0.01];
    const host = pitched.find((h) => h !== a && h.level === a.level && h.ridge !== a.ridge && inRegion(h.rect!, probe[0], probe[1]) && h.zr >= a.zr - 0.01);
    if (!host) continue;
    joins.push([a, host]);
    a.over[i] = 0;
    delete a.ends[end];
    const he = extentOf(host), ae = extentOf(a), rB = host.r;
    if ((rB - edge) * sgn > 1e-6) {
      const strip: Rect = ax === 0 ? [Math.min(edge, rB), Math.max(ae[1], he[1]), Math.max(edge, rB), Math.min(ae[3], he[3])] : [Math.max(ae[0], he[0]), Math.min(edge, rB), Math.min(ae[2], he[2]), Math.max(edge, rB)];
      if (strip[2] - strip[0] > 1e-6 && strip[3] - strip[1] > 1e-6) a.extra.push(r3Rect(strip));
    } else if ((rB - edge) * sgn < -1e-6) {
      // the wing runs past the other ridge: its roof stops there
      a.over[i] = -(edge - rB) * sgn;
    }
  }
  for (const p of parts) if (p.type === 'hip') p.planes = [...p.planes, ...Object.values(p.ends)];

  // ---- the parts as package records
  const jsonParts: RoofPartJson[] = parts.map((p) => {
    const extent: Rect[] = p.rect ? [r3Rect(extentOf(p)), ...p.extra] : [];
    const out: RoofPartJson = { id: p.id, level: p.level, type: p.type, ...(p.rect ? { rect: p.rect } : { polygon: p.polygon!.map(([x, y]) => [r3(x), r3(y)] as Vec2) }), extent, planes: p.planes.map(planeJson) };
    if (p.polygon) out.extentPolygon = grownPolygon(p.polygon, p.over[0]).map(([x, y]) => [r3(x), r3(y)] as Vec2);
    if (p.in?.parapet) out.parapet = p.in.parapet;
    if (p.ridge) out.ridge = p.ridge;
    if (p.type !== 'flat' || p.pitch) out.pitch = Math.round(p.pitch * 10) / 10;
    return out;
  });
  const partModel = jsonParts.length ? roofModel({ covering, buildup, parts: jsonParts }) : null;

  // ---- dormers
  const dormers: DormerJson[] = [], windows: DormerWallWindow[] = [];
  for (const d of R?.dormers ?? []) {
    const p = parts.find((x) => x.id === d.part), what = `dormer "${d.id}"`;
    if (!p || !p.rect || p.type === 'flat') { err('dormer.part', `${what}: "${d.part}" is not a pitched roof part`); continue; }
    const lv = levels.get(p.level)!, fz = lv.floorZ, own = partModel!.byLevel(p.level).filter((q) => q.id === p.id);
    const rect = rectOf(P([d.rect[0], d.rect[1]], p.level), P([d.rect[2], d.rect[3]], p.level));
    const at = (x: number, y: number) => surfaceAt({ pieces: own, which: 'inner' }, x, y);
    const c = at((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
    if (!c || (Math.abs(c.plane.gx) > 1e-9) === (Math.abs(c.plane.gy) > 1e-9)) { err('dormer.plane', `${what}: not over a plane of "${p.id}"`); continue; }
    const P0 = c.plane, front: DormerJson['front'] = P0.gx > 0 ? 'W' : P0.gx < 0 ? 'E' : P0.gy > 0 ? 'S' : 'N';
    const fi = { W: 0, S: 1, E: 2, N: 3 }[front], bi = (fi + 2) % 4, ax = front === 'W' || front === 'E' ? 0 : 1, a = 1 - ax;
    // it must stand on one plane (not across a hip, a valley or the ridge)
    const corner = (u: number, f: number): Vec2 => (ax === 0 ? [f, u] : [u, f]);
    const inset = [0.02, 0.5, 0.98].flatMap((s) => [0.02, 0.5, 0.98].map((r) => [rect[0] + (rect[2] - rect[0]) * s, rect[1] + (rect[3] - rect[1]) * r] as Vec2));
    if (inset.some((q) => at(q[0], q[1])?.plane !== P0)) { err('dormer.plane', `${what}: it does not stand on one plane of "${p.id}" (it crosses a hip, a valley or the ridge)`); continue; }
    // a front within 2 cm of the outer face of the walls stands in that wall
    const flush = Math.abs(rect[fi] - p.rect[fi]) < 0.02;
    if (flush) rect[fi] = p.rect[fi];
    // carried back to the ridge (the high edge of a shed), where it is under the roof
    const back = p.r;
    if ((back - rect[bi]) * (bi >= 2 ? 1 : -1) > 0) rect[bi] = back;
    const cheek = buildup, frontWall = flush ? t : buildup, inner: Rect = [...rect] as Rect;
    inner[a] += cheek; inner[a + 2] -= cheek; inner[fi] += fi >= 2 ? -frontWall : frontWall;
    const zF = fz + d.front, kd = tan(d.pitch), sgnF = fi >= 2 ? -1 : 1;   // +1: the roof rises towards +axis from the front
    let planes: Plane[];
    if (d.type === 'gable') {
      // eaves at the cheeks, the ridge from the front back into the roof
      const a0 = rect[a], a1 = rect[a + 2];
      planes = a === 0 ? [{ gx: kd, gy: 0, z0: zF - kd * a0 }, { gx: -kd, gy: 0, z0: zF + kd * a1 }] : [{ gx: 0, gy: kd, z0: zF - kd * a0 }, { gx: 0, gy: -kd, z0: zF + kd * a1 }];
    } else {
      const f = rect[fi];
      planes = [ax === 0 ? { gx: sgnF * kd, gy: 0, z0: zF - sgnF * kd * f } : { gx: 0, gy: sgnF * kd, z0: zF - sgnF * kd * f }];
    }
    const v = vergeDefault, extent: Rect = [...rect] as Rect;
    extent[a] -= v; extent[a + 2] += v; extent[fi] += fi >= 2 ? v : -v;
    // the dormer must sit on the roof and disappear into it at the back
    const top = (x: number, y: number) => Math.min(...planes.map((q) => planeZ(raise(q, buildup + covering), x, y)));
    const roofTop = (x: number, y: number) => surfaceAt({ pieces: own, which: 'cover', lift: buildup + covering }, x, y)?.z ?? -Infinity;
    const backPts = [rect[a], (rect[a] + rect[a + 2]) / 2, rect[a + 2]].map((u) => corner(u, rect[bi]));
    if (backPts.some((q) => top(q[0], q[1]) > roofTop(q[0], q[1]) + 0.01)) err('dormer.high', `${what}: its roof is higher than the roof of "${p.id}" at the ridge — lower "front" or the pitch`);
    const frontMid = corner((rect[a] + rect[a + 2]) / 2, rect[fi]);
    if (zF < planeZ(P0, frontMid[0], frontMid[1]) - 0.01) err('dormer.low', `${what}: its eaves (${d.front} m) are below the roof plane at its front`);
    const rec: DormerJson = { id: d.id, part: p.id, type: d.type, front, rect: r3Rect(rect), inner: r3Rect(inner), extent: r3Rect(extent), planes: planes.map(planeJson) };
    if (d.window) {
      const w = d.window, room = plan.rooms.find((r) => r.id === w.room);
      if (!room || room.level !== p.level) err('dormer.window', `${what}: window room "${w.room}" is not on level "${p.level}"`);
      else if (flush) windows.push({ id: w.id, room: w.room, at: corner((rect[a] + rect[a + 2]) / 2, inner[fi]), width: w.width, sill: w.sill, head: w.head });
      else {
        rec.window = { id: w.id, roomId: w.room, width: w.width, sill_z: r3(fz + (w.sill ?? D.sill)), head_z: r3(fz + (w.head ?? D.head)) };
        // a front set back from the wall stands on the roof: the window between the roof below it and the dormer roof above
        const face = corner((rect[a] + rect[a + 2]) / 2, inner[fi]), under = planeZ(P0, face[0], face[1]), over = Math.min(...planes.map((q) => planeZ(q, face[0], face[1])));
        if (rec.window.sill_z < under + 0.05 || rec.window.head_z > over) err('dormer.window', `${what}: the window (${w.sill ?? D.sill}–${w.head ?? D.head} m) must lie between the roof below its front (${r3(under - fz)} m) and the dormer roof (${r3(over - fz)} m)`);
      }
      if (w.width > inner[a + 2] - inner[a] - 0.1) err('dormer.window', `${what}: a ${w.width} m window does not fit its ${r3(inner[a + 2] - inner[a])} m front`);
    }
    dormers.push(rec);
  }

  // ---- chimneys
  const lowestFirst = [...plan.levels].sort((x, y) => x.floorZ - y.floorZ);
  const chimneys = (R?.chimneys ?? []).flatMap((c) => {
    const rect = r3Rect(rectOf(P([c.rect[0], c.rect[1]], lowestFirst[0].id), P([c.rect[2], c.rect[3]], lowestFirst[0].id)));
    const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2, lv = lowestFirst.find((l) => overLevel(l.id, cx, cy));
    if (!lv) { err('chimney.outside', `chimney "${c.id}": not over the walls of any level`); return []; }
    return [{ id: c.id, rect, bottom: r3(lv.floorZ - D.slab), top: c.top }];
  });

  const json: RoofJson | null = jsonParts.length ? { covering, buildup, parts: jsonParts, ...(dormers.length ? { dormers } : {}), ...(chimneys.length ? { chimneys } : {}), ...(R?.source ? { source: R.source } : {}), ...(R?.confidence ? { confidence: R.confidence } : {}) } : null;
  const model = json ? roofModel(json) : null;
  if (!model) return { json, model, windows };

  // ---- checks the union cannot make
  const surfaceTop = (level: string) => ({ pieces: model.byLevel(level), which: 'cover' as const, lift: model.thickness });
  for (const c of chimneys) {
    const cx = (c.rect[0] + c.rect[2]) / 2, cy = (c.rect[1] + c.rect[3]) / 2;
    const roofAt = Math.max(-Infinity, ...model.levels.map((l) => surfaceAt(surfaceTop(l), cx, cy)?.z ?? -Infinity));
    if (Number.isFinite(roofAt) && c.top < roofAt + 0.3) warn('chimney.low', `chimney "${c.id}": its top (${c.top} m) is less than 30 cm above the roof (${r3(roofAt)} m)`);
  }
  // the roof parts of a level cover its walls where no level stands above
  for (const level of model.levels) {
    const up = above(level), rects = parts.filter((p) => p.level === level).map((p) => (p.rect ? grow(p.rect, 0.01) : null)), polysOf = parts.filter((p) => p.level === level && p.polygon).map((p) => p.polygon!);
    let bare = 0;
    for (const poly of grownRooms(level)) {
      const g = bboxOf(poly);
      const xs = [...new Set([...poly.map((q) => q[0]), ...rects.flatMap((r) => (r ? [r[0], r[2]] : [])).filter((x) => x > g[0] && x < g[2])])].sort((u, w) => u - w);
      const ys = [...new Set([...poly.map((q) => q[1]), ...rects.flatMap((r) => (r ? [r[1], r[3]] : [])).filter((y) => y > g[1] && y < g[3])])].sort((u, w) => u - w);
      for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
        const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
        if (!inRegion(poly, x, y) || up.some((l) => overLevel(l, x, y))) continue;
        if (rects.some((r) => r && x > r[0] && x < r[2] && y > r[1] && y < r[3]) || polysOf.some((q) => inRegion(q, x, y))) continue;
        bare += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
    if (bare > 0.01) err('roof.cover', `level "${level}": ${r3(bare)} m² of its walls are under no roof part — add a part or widen one`);
  }
  // overlapping eaves of joined wings at one height
  for (const [a, host] of joins) {
    const za = a.zr - a.k * Math.max(a.r - a.rect![a.ridge === 'X' ? 1 : 0], a.rect![a.ridge === 'X' ? 3 : 2] - a.r);
    const zb = host.zr - host.k * Math.max(host.r - host.rect![host.ridge === 'X' ? 1 : 0], host.rect![host.ridge === 'X' ? 3 : 2] - host.r);
    if (Math.abs(za - zb) > 0.02) warn('roof.eaves', `roof parts "${a.id}" and "${host.id}" meet with their eaves ${Math.round(Math.abs(za - zb) * 100)} cm apart — give them the same knee height`);
  }
  // the ridge height from the drawings
  if (R?.ridgeHeight !== undefined) {
    let top = -Infinity;
    for (const level of model.levels) for (const p of model.byLevel(level)) { const r = surfaceRange(surfaceTop(level), regionPolygon(p.cover)); if (r) top = Math.max(top, r[1]); }
    if (Math.abs(top - R.ridgeHeight) > 0.1) warn('roof.ridgeHeight', `the roof's ridge comes out at ${r3(top)} m, the drawings say ${R.ridgeHeight} m — check the knee height and the pitch`);
  }
  // a level that is the top of part of the building with no roof part over it: a last level keeps a flat slab, a lower one is open
  for (const lv of plan.levels) {
    if (model.byLevel(lv.id).length || !roomsOf(lv.id).length) continue;
    const up = above(lv.id);
    let bare = 0;
    const upper = up.flatMap((l) => grownRooms(l));
    for (const poly of grownRooms(lv.id)) {
      const xs = [...new Set([...poly, ...upper.flat()].map((q) => q[0]))].sort((u, w) => u - w), ys = [...new Set([...poly, ...upper.flat()].map((q) => q[1]))].sort((u, w) => u - w);
      for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
        const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
        if (inRegion(poly, x, y) && !up.some((l) => overLevel(l, x, y))) bare += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
    if (bare > 0.01) warn('roof.missing', `level "${lv.id}": ${r3(bare)} m² of it have no level and no roof part above (${up.length ? 'open at the top' : 'a flat slab'}) — add a roof part (flat or pitched)`);
  }
  return { json, model, windows };
}

/** an orthogonal polygon grown by d (mitred) */
function grownPolygon(p: Vec2[], d: number): Vec2[] {
  if (!d) return p;
  const n = p.length, s = p.reduce((acc, a, i) => { const b = p[(i + 1) % n]; return acc + a[0] * b[1] - b[0] * a[1]; }, 0) >= 0 ? 1 : -1;
  return p.map((b, i) => {
    const a = p[(i + n - 1) % n], c = p[(i + 1) % n];
    const e1: Vec2 = [b[0] - a[0], b[1] - a[1]], e2: Vec2 = [c[0] - b[0], c[1] - b[1]], l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1: Vec2 = [(s * e1[1]) / l1, (-s * e1[0]) / l1], n2: Vec2 = [(s * e2[1]) / l2, (-s * e2[0]) / l2], den = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    return [b[0] + ((n1[0] + n2[0]) * d) / den, b[1] + ((n1[1] + n2[1]) * d) / den] as Vec2;
  });
}
