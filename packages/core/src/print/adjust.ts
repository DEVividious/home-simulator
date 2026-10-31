// Printability adjustments (ADR 0031): at a small scale real walls, slabs and openings become smaller than a printer makes. The
// building's inputs are changed before the boolean — never the finished mesh — so the solid is built by the same code as the
// app's shell, and every change is reported with the element, the size in the building and on the print:
//   exterior walls, slabs and the roof thickened to the profile's wall and slab;
//   interior walls thinner than a printed wall: both rooms' faces of the wall move back by half the difference;
//   openings narrower or lower than the smallest hole widened (or closed where the wall has no room for them);
//   lintels thinner than a printed slab: the head lowered (or raised to the top where the opening would close); a sill that
//     leaves a band thinner than a slab at the bottom of the roof part: lowered to the split;
//   piers between two openings narrower than a printed pier: two windows (or two doors) merge, a window next to a door shrinks;
//   chimneys narrower than a pier grown.
// The input and the output are the package's `building` block (JSON); the derived building is built from the result.
import { building, DEFAULT_DOOR_HEIGHT, SHELL_DEFAULTS, type BuildingData } from '../model/building.ts';
import { offsetPolygon, signedArea } from '../model/geom2d.ts';
import { canonicalDir, gapFrame, lineC, lineFrame, lineT, windowFrame, type LineFrame } from '../model/wallLine.ts';
import type { DoorJson, LevelId, OpeningJson, Rect, RoomJson, Vec2 } from '../package/types.ts';
import { levelFrame } from '../solid/levels.ts';
import { builtLevels, splitHeight, type EavesMode } from './parts.ts';
import type { PrintProfile } from './profiles.ts';
import { mmPerM } from './scale.ts';

export type AdjustCode =
  | 'wall.exterior' | 'wall.interior' | 'slab' | 'roof.thickness'
  | 'opening.widened' | 'opening.closed' | 'lintel.lowered' | 'lintel.removed' | 'sill.lowered' | 'opening.at-split'
  | 'pier.merged' | 'pier.widened' | 'chimney.grown' | 'roof-window.widened';

/** one change of the building made for printing */
export interface Adjustment {
  code: AdjustCode;
  /** what changed: "exterior walls", "wall A | B", an opening or chimney id */
  element: string;
  level?: LevelId;
  /** the size in the building before and after [m] */
  from: number;
  to: number;
  /** the size on the print before and after [mm] */
  scaledMm: number;
  printedMm: number;
  /** the rule that asked for it */
  rule: string;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const EPS = 1e-9;
/** an edge of a room outline: its wall line frame (model/wallLine.ts), the face coordinate c on it and its range along it */
interface Edge { i: number; a: Vec2; b: Vec2; f: LineFrame; c: number; lo: number; hi: number }
function edgesOf(poly: Vec2[]): Edge[] {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], d: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const f = Math.abs(d[0]) < 1e-6 ? lineFrame('Y') : Math.abs(d[1]) < 1e-6 ? lineFrame('X') : lineFrame('D', canonicalDir(d));
    const ta = lineT(f, a), tb = lineT(f, b);
    return { i, a, b, f, c: lineC(f, a), lo: Math.min(ta, tb), hi: Math.max(ta, tb) };
  });
}
/** the edge of a room on the wall line c of frame f that holds the span [s0, s1] */
const edgeAt = (edges: Edge[], f: LineFrame, c: number, s0: number, s1: number) => edges.find((e) => Math.abs(e.f.dir[0] * f.dir[1] - e.f.dir[1] * f.dir[0]) < 1e-6 && e.f.dir[0] * f.dir[0] + e.f.dir[1] * f.dir[1] > 0
  && Math.abs(e.c - c) < 2e-3 && (s0 + s1) / 2 > e.lo - 1e-6 && (s0 + s1) / 2 < e.hi + 1e-6) ?? null;

/** distance along the ray p + s·d to the nearest edge of the loops, and the loop hit */
function rayHit(p: Vec2, d: Vec2, loops: Vec2[][]): { s: number; loop: number } | null {
  let best: { s: number; loop: number } | null = null;
  loops.forEach((poly, k) => {
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i], e = poly[(i + 1) % poly.length], ex = e[0] - c[0], ey = e[1] - c[1], den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = c[0] - p[0], wy = c[1] - p[1], s = (wx * ey - wy * ex) / den, u = (wx * d[1] - wy * d[0]) / den;
      if (s > 1e-7 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || s < best.s)) best = { s, loop: k };
    }
  });
  return best;
}

/** the outline with every edge moved inwards by its own distance (edges of one line move together, by the larger distance) */
function offsetEdges(poly: Vec2[], d: number[]): Vec2[] {
  const n = poly.length, sgn = signedArea(poly) >= 0 ? 1 : -1;
  const dir = poly.map((a, i) => { const b = poly[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as Vec2; });
  const dd = [...d];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (Math.abs(dir[i][0] * dir[j][1] - dir[i][1] * dir[j][0]) < 1e-9) dd[i] = dd[j] = Math.max(dd[i], dd[j]); }
  // the moved line of edge i: through a_i + inward·d_i along dir_i
  const base = poly.map((a, i) => [a[0] - sgn * dir[i][1] * dd[i], a[1] + sgn * dir[i][0] * dd[i]] as Vec2);
  return poly.map((_, i) => {
    const h = (i - 1 + n) % n, p = base[h], u = dir[h], q = base[i], v = dir[i], den = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(den) < 1e-12) return [r6(q[0]), r6(q[1])];
    const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
    return [r6(p[0] + u[0] * t), r6(p[1] + u[1] * t)];
  });
}

/** an opening in a room's JSON on one wall, as a span along the wall and absolute heights */
type Hole = { kind: 'window'; o: OpeningJson; s0: number; s1: number } | { kind: 'door'; o: DoorJson; s0: number; s1: number };

/** the smallest features of the adjusted building on the print [mm] (null: there is none) */
export interface Minimums { wall: number; slab: number; roof: number | null; opening: number | null; pier: number | null }

/**
 * The building block adjusted for printing at 1:n with a profile; `eaves` decides where the level under the roof is split (the
 * lintels of that level end there). The input is not changed.
 */
export function adjustForPrint(data: BuildingData, n: number, profile: PrintProfile, eaves: EavesMode = 'keep'): { data: BuildingData; changes: Adjustment[]; minimums: Minimums } {
  const d = JSON.parse(JSON.stringify(data)) as BuildingData, changes: Adjustment[] = [], k = mmPerM(n);
  const T = profile.wall / k, S = profile.slab / k, P = profile.pier / k, H = profile.hole / k;
  const note = (code: AdjustCode, element: string, from: number, to: number, rule: string, level?: LevelId) =>
    changes.push({ code, element, ...(level ? { level } : {}), from: r4(from), to: r4(to), scaledMm: r2(from * k), printedMm: r2(to * k), rule });
  const wallRule = `wall ≥ ${profile.wall} mm`, slabRule = `slab ≥ ${profile.slab} mm`, holeRule = `opening ≥ ${profile.hole} mm`, pierRule = `pier ≥ ${profile.pier} mm`;

  // ---- exterior walls, slabs, the roof
  const shell = { ...SHELL_DEFAULTS, ...d.shell };
  if (shell.exteriorWall < T - EPS) {
    note('wall.exterior', 'exterior walls', shell.exteriorWall, T, wallRule);
    // the outer faces move out: the roof parts over them (their outlines are the outer faces) and their overhangs move with them
    const g = T - shell.exteriorWall, grow = (r: Rect): Rect => [r6(r[0] - g), r6(r[1] - g), r6(r[2] + g), r6(r[3] + g)];
    for (const p of d.roof?.parts ?? []) {
      if (p.rect) p.rect = grow(p.rect);
      if (p.polygon) p.polygon = offsetPolygon(p.polygon, g).map((q) => [r6(q[0]), r6(q[1])] as Vec2);
      p.extent = p.extent.map(grow);
      if (p.extentPolygon) p.extentPolygon = offsetPolygon(p.extentPolygon, g).map((q) => [r6(q[0]), r6(q[1])] as Vec2);
    }
    shell.exteriorWall = r6(T);
  }
  if (shell.slab < S - EPS) { note('slab', 'floor and roof slabs', shell.slab, S, slabRule); shell.slab = r6(S); }
  d.shell = shell;
  if (!d.roof) { const derived = building(data).roof; if (derived?.fromAttic && derived.thickness < S - EPS) d.roof = JSON.parse(JSON.stringify(derived.json)); }
  if (d.roof && d.roof.covering + d.roof.buildup < S - EPS) { note('roof.thickness', 'roof', d.roof.covering + d.roof.buildup, S, slabRule); d.roof.buildup = r6(S - d.roof.covering); }

  // ---- interior walls: both faces move back
  const rooms = d.rooms.rooms, byLevel = new Map<LevelId, RoomJson[]>();
  for (const r of rooms) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r]);
  const reported = new Set<string>();
  let minWall = Infinity, minOpening = Infinity, minPier = Infinity;
  for (const [level, rs] of byLevel) {
    const polys = rs.map((r) => r.polygon.map((p) => [p[0], p[1]] as Vec2));
    const moves = rs.map(() => [] as number[]);
    rs.forEach((r, ri) => {
      // the other rooms, and the room itself: a partition end inside a room is a wall between two parts of its outline
      const poly = polys[ri], sgn = signedArea(poly) >= 0 ? 1 : -1, others = polys;
      moves[ri] = poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-6) return 0;
        const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], out: Vec2 = [sgn * u[1], -sgn * u[0]];
        let thin = Infinity, with_ = -1;
        for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const hit = rayHit([a[0] + u[0] * L * f, a[1] + u[1] * L * f], out, others);
          // a wall between two rooms: the gap is filled by the wall mass (the rooms grown by the exterior wall overlap)
          if (hit && hit.s <= 2 * shell.exteriorWall + 1e-6 && hit.s < thin) { thin = hit.s; with_ = hit.loop; }
        }
        if (Number.isFinite(thin)) minWall = Math.min(minWall, Math.max(thin, T));
        if (!(thin < T - EPS)) return 0;
        const key = with_ === ri ? `in ${r.id}` : [r.id, rs[with_].id].sort().join(' | ');
        if (!reported.has(key)) { reported.add(key); note('wall.interior', `wall ${key}`, thin, T, wallRule, level); }
        return (T - thin) / 2;
      });
    });
    rs.forEach((r, ri) => {
      if (!moves[ri].some((m) => m > 0)) return;
      const before = edgesOf(polys[ri]), after = offsetEdges(polys[ri], moves[ri]), moved = edgesOf(after);
      const shift = (f: LineFrame, c: number, s0: number, s1: number): number | null => {
        const e = edgeAt(before, f, c, s0, s1);
        return e && moves[ri][e.i] > 0 ? r6(lineC(f, moved[e.i].a)) : null;
      };
      for (const o of r.openings) { const c = shift(windowFrame(o), o.inner, Math.min(o.from_, o.to), Math.max(o.from_, o.to)); if (c !== null) o.inner = c; }
      for (const dj of r.doors) dj.across = dj.across.map((c) => shift(gapFrame(dj), c, dj.from_, dj.to) ?? c);
      r.polygon = after.map((p) => [p[0], p[1]]);
      const xs = after.map((p) => p[0]), ys = after.map((p) => p[1]);
      r.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    });
  }

  // ---- openings: holes too small, lintels, piers (on the walls as they are now)
  const b = building(d), levels = builtLevels(b), last = levels[levels.length - 1]?.id;
  const topOf = new Map<LevelId, number | null>();
  for (const l of levels) {
    if (l.id === last) topOf.set(l.id, splitHeight(b, l.id, eaves).z);
    else topOf.set(l.id, b.roof?.byLevel(l.id).length ? null : levelFrame(b, l.id).top);
  }
  for (const r of rooms) {
    const edges = edgesOf(r.polygon.map((p) => [p[0], p[1]] as Vec2)), top = topOf.get(r.level) ?? null, floor = r.floor_z;
    const ceilingTop = r.ceiling.kind === 'flat' ? r.ceiling.z! : r.ceiling.flat_z!;
    // too narrow or too low: grow about the middle within the wall, close when the wall has no room
    r.openings = r.openings.filter((o) => {
      if (o.polygon_YZ) return true;
      const e = edgeAt(edges, windowFrame(o), o.inner, Math.min(o.from_, o.to), Math.max(o.from_, o.to));
      let s0 = Math.min(o.from_, o.to), s1 = Math.max(o.from_, o.to), z0 = o.sill_z ?? floor, z1 = o.head_z ?? floor + 2.4;
      /** a span grown to H about its middle and kept within [lo, hi]; null when [lo, hi] is shorter than H */
      const grow = (a: number, c: number, lo: number, hi: number): [number, number] | null => {
        if (hi - lo < H - EPS) return null;
        const s = Math.max(lo, Math.min((a + c) / 2 - H / 2, hi - H));
        return [s, s + H];
      };
      if (s1 - s0 < H - EPS) {
        const g = grow(s0, s1, e ? e.lo : -Infinity, e ? e.hi : Infinity);
        if (!g) { note('opening.closed', o.id, s1 - s0, 0, holeRule, r.level); return false; }
        note('opening.widened', o.id, s1 - s0, H, holeRule, r.level);
        [s0, s1] = g;
      }
      if (z1 - z0 < H - EPS) {
        const g = grow(z0, z1, floor, Math.max(ceilingTop, z1));
        if (!g) { note('opening.closed', o.id, z1 - z0, 0, holeRule, r.level); return false; }
        note('opening.widened', o.id, z1 - z0, H, holeRule, r.level);
        [z0, z1] = g;
      }
      const flip = o.from_ > o.to;
      o.from_ = r6(flip ? s1 : s0); o.to = r6(flip ? s0 : s1); o.sill_z = r6(z0); o.head_z = r6(z1);
      return true;
    });
    for (const dj of r.doors) {
      if (dj.to - dj.from_ < H - EPS) { const g = (H - (dj.to - dj.from_)) / 2; note('opening.widened', dj.door_id ?? 'passage', dj.to - dj.from_, H, holeRule, r.level); dj.from_ = r6(dj.from_ - g); dj.to = r6(dj.to + g); dj.width = r6(dj.to - dj.from_); }
    }
    // lintels: the band between a head and the top of the level's part
    if (top !== null) {
      for (const o of r.openings) {
        if (o.polygon_YZ || o.head_z === undefined) continue;
        const sill = o.sill_z ?? floor, band = top - o.head_z;
        if (band > 1e-6 && band < S - EPS) {
          if (top - S - sill >= H - EPS) { note('lintel.lowered', o.id, band, S, slabRule, r.level); o.head_z = r6(top - S); }
          else { note('lintel.removed', o.id, band, 0, slabRule, r.level); o.head_z = r6(top); }
        }
        // the band under a window at the bottom of the roof part (it stands on the bed there): lowered to the split
        if (r.level === last && o.sill_z !== undefined && sill - top > 1e-6 && sill - top < S - EPS) { note('sill.lowered', o.id, sill - top, 0, slabRule, r.level); o.sill_z = r6(top); }
        // an opening the split crosses: no sliver of it on either side
        else if (r.level === last && sill < top - 1e-6 && o.head_z > top + 1e-6) {
          if (top - sill < H - EPS) { note('opening.at-split', o.id, top - sill, 0, holeRule, r.level); o.sill_z = r6(top); }
          else if (o.head_z - top < H - EPS) { note('opening.at-split', o.id, o.head_z - top, 0, holeRule, r.level); o.head_z = r6(top); }
        }
      }
      for (const dj of r.doors) {
        const head = floor + (dj.height ?? DEFAULT_DOOR_HEIGHT), band = top - head, id = dj.door_id ?? 'passage';
        if (band > 1e-6 && band < S - EPS) {
          if (top - S - floor >= H - EPS) { note('lintel.lowered', id, band, S, slabRule, r.level); dj.height = r6(top - S - floor); }
          else { note('lintel.removed', id, band, 0, slabRule, r.level); dj.height = r6(top - floor); }
        } else if (r.level === last && head > top + 1e-6 && head - top < H - EPS) { note('opening.at-split', id, head - top, 0, holeRule, r.level); dj.height = r6(top - floor); }
      }
    }
    // piers between neighbouring openings on one wall
    for (let guard = 0; guard < 20; guard++) {
      const holes: { e: Edge; h: Hole }[] = [];
      for (const o of r.openings) {
        if (o.polygon_YZ) continue;
        const s0 = Math.min(o.from_, o.to), s1 = Math.max(o.from_, o.to), e = edgeAt(edges, windowFrame(o), o.inner, s0, s1);
        if (e) holes.push({ e, h: { kind: 'window', o, s0, s1 } });
      }
      for (const dj of r.doors) for (const c of dj.across) { const e = edgeAt(edges, gapFrame(dj), c, dj.from_, dj.to); if (e) { holes.push({ e, h: { kind: 'door', o: dj, s0: dj.from_, s1: dj.to } }); break; } }
      let changed = false;
      for (const e of edges) {
        const on = holes.filter((x) => x.e === e).map((x) => x.h).sort((p, q) => p.s0 - q.s0);
        for (let i = 0; i + 1 < on.length && !changed; i++) {
          const A = on[i], B = on[i + 1], gap = B.s0 - A.s1;
          if (!(gap > 1e-6 && gap < P - EPS)) continue;
          changed = true;
          if (A.kind === 'window' && B.kind === 'window') {
            const lo = A.s0, hi = B.s1, a = A.o, z0 = Math.min(a.sill_z ?? floor, B.o.sill_z ?? floor), z1 = Math.max(a.head_z ?? 0, B.o.head_z ?? 0);
            note('pier.merged', `${a.id} + ${B.o.id}`, gap, 0, pierRule, r.level);
            const flip = a.from_ > a.to;
            a.from_ = flip ? hi : lo; a.to = flip ? lo : hi; a.sill_z = z0; a.head_z = z1;
            r.openings = r.openings.filter((o) => o !== B.o);
          } else if (A.kind === 'door' && B.kind === 'door') {
            note('pier.merged', `${A.o.door_id ?? 'passage'} + ${B.o.door_id ?? 'passage'}`, gap, 0, pierRule, r.level);
            A.o.to = B.o.to; A.o.width = r6(A.o.to - A.o.from_); A.o.height = Math.max(A.o.height ?? DEFAULT_DOOR_HEIGHT, B.o.height ?? DEFAULT_DOOR_HEIGHT);
            r.doors = r.doors.filter((x) => x !== B.o);
          } else {
            // a window next to a door: its jamb moves away (it closes when too little is left)
            const w = (A.kind === 'window' ? A : B) as Extract<Hole, { kind: 'window' }>, need = P - gap;
            const s0 = w === A ? w.s0 : w.s0 + need, s1 = w === A ? w.s1 - need : w.s1;
            if (s1 - s0 < H - EPS) { note('opening.closed', w.o.id, w.s1 - w.s0, 0, pierRule, r.level); r.openings = r.openings.filter((o) => o !== w.o); }
            else {
              note('pier.widened', w.o.id, gap, P, pierRule, r.level);
              const flip = w.o.from_ > w.o.to;
              w.o.from_ = r6(flip ? s1 : s0); w.o.to = r6(flip ? s0 : s1);
            }
          }
        }
        if (changed) break;
      }
      if (!changed) {
        for (const e of edges) { const on = holes.filter((x) => x.e === e).map((x) => x.h).sort((p, q) => p.s0 - q.s0); for (let i = 0; i + 1 < on.length; i++) if (on[i + 1].s0 - on[i].s1 > 1e-6) minPier = Math.min(minPier, on[i + 1].s0 - on[i].s1); }
        for (const x of holes) minOpening = Math.min(minOpening, x.h.s1 - x.h.s0, x.h.kind === 'window' && x.h.o.head_z !== undefined ? x.h.o.head_z - (x.h.o.sill_z ?? floor) : Infinity);
        break;
      }
    }
    // roof windows too small in plan
    for (const w of r.roof_windows) {
      const [x0, y0, x1, y1] = w.plan_rect, gx = H - (x1 - x0) > EPS ? (H - (x1 - x0)) / 2 : 0, gy = H - (y1 - y0) > EPS ? (H - (y1 - y0)) / 2 : 0;
      if (gx > 0 || gy > 0) { note('roof-window.widened', w.id, Math.min(x1 - x0, y1 - y0), H, holeRule, r.level); w.plan_rect = [r6(x0 - gx), r6(y0 - gy), r6(x1 + gx), r6(y1 + gy)]; }
    }
  }

  // ---- chimneys: a pier in plan
  for (const c of d.roof?.chimneys ?? []) {
    const [x0, y0, x1, y1] = c.rect, gx = P - (x1 - x0) > EPS ? (P - (x1 - x0)) / 2 : 0, gy = P - (y1 - y0) > EPS ? (P - (y1 - y0)) / 2 : 0;
    if (gx > 0 || gy > 0) { note('chimney.grown', c.id, Math.min(x1 - x0, y1 - y0), P, pierRule); c.rect = [r6(x0 - gx), r6(y0 - gy), r6(x1 + gx), r6(y1 + gy)]; }
  }
  const mm = (x: number) => (Number.isFinite(x) ? r2(x * k) : null);
  const minimums: Minimums = { wall: r2(Math.min(minWall, shell.exteriorWall) * k), slab: r2(shell.slab * k), roof: d.roof ? r2((d.roof.covering + d.roof.buildup) * k) : null, opening: mm(minOpening), pier: mm(minPier) };
  return { data: d, changes, minimums };
}
