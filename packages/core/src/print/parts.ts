// The parts of the print (ADR 0030): one per level — its slab and walls up to the underside of the next slab — and a removable
// roof. The last level is split at a height `z`: below it the level's part, above it the roof part (the rest of the walls, the
// space under the roof, the roof, its chimneys and parapets), which then stands on a flat bottom:
//   rooms with flat ceilings only (a cold roof space, a flat roof, no roof at all): z = the lowest ceiling — the rooms are open in
//     the level's part and the roof part has no ceiling hanging over the bed; eaves reaching lower are cut off at z;
//   rooms under the slopes: z = the lowest underside of the roof (the bottom of the eaves) or the lowest ceiling, whichever is
//     lower; at least 0.3 m above the floor.
// Faces lying in the split plane are moved off it in the inputs before the boolean (a ceiling at z rises 5 mm in the solid that
// keeps what is below z, a sill at z drops 5 mm in the solid that keeps what is above), so the cut never meets a face of the
// opposite side. Stairs are solid flights (stepped, or a ramp when steps are too small to print) in the part of their lower level;
// the steps in the thickness of the slab above go with the upper level's part, standing in the opening of its floor. Roof windows
// and dormer windows are recesses inside a frame; glass, frames, door leaves and furniture are not printed. Every solid is kept in the caller's
// scope; heights are in metres of the building.
import { building, roomsOfLevel, type Building, type BuildingData } from '../model/building.ts';
import { offsetPolygon } from '../model/geom2d.ts';
import { regionPolygon, surfaceRange } from '../model/roof.ts';
import { stairFrame } from '../model/stairs.ts';
import type { LevelId, StairDef, Vec2, Vec3 } from '../package/types.ts';
import { builtLevels, dormerOpenings, levelFrame, levelSolid, span } from '../solid/levels.ts';
import { PROUD, snap } from '../solid/openings.ts';
import { prism } from '../solid/prism.ts';
import { roofSolid, roofWindowsOf } from '../solid/roofSolid.ts';
import type { Keep } from '../solid/scope.ts';
import type { CrossSection, Geometry, Manifold } from '../solid/wasm.ts';
import type { PrintProfile } from './profiles.ts';
import { mmPerM } from './scale.ts';

export { builtLevels };
export type EavesMode = 'keep' | 'trim';

/** the split of the last level: its height and why there */
export interface Split {
  level: LevelId;
  z: number;
  rule: 'ceiling' | 'eaves' | 'floor' | 'wall-top';
  /** how far the eaves reach below the split — that much of them is not printed [m] */
  eavesBelow: number;
  /** the roof comes below the split over the walls (that part of it belongs to the level's part) */
  roofBelow: boolean;
}

/** the lowest point of the roof's underside over the plan polygons (null: no roof there) */
function undersideLow(b: Building, level: LevelId, polys: Vec2[][]): number {
  const pieces = b.roof?.byLevel(level) ?? [];
  let lo = Infinity;
  for (const p of polys) { const r = surfaceRange({ pieces, which: 'region' }, p); if (r) lo = Math.min(lo, r[0]); }
  return lo;
}

/** where the last level is split into its part and the roof part */
export function splitHeight(b: Building, level: LevelId, eaves: EavesMode = 'keep'): Split {
  const L = b.levelById.get(level)!, rooms = roomsOfLevel(b, level), pieces = b.roof?.byLevel(level) ?? [];
  if (!pieces.length) return { level, z: levelFrame(b, level).wallTop, rule: 'wall-top', eavesBelow: 0, roofBelow: false };
  const ceilLow = Math.min(...rooms.map((r) => r.floorZ + r.ceiling.range()[0]));
  const walls = undersideLow(b, level, rooms.map((r) => offsetPolygon(r.polygon, b.shell.exteriorWall)));
  const roof = eaves === 'trim' ? walls : Math.min(walls, undersideLow(b, level, pieces.filter((p) => p.kind === 'part').map((p) => regionPolygon(p.cover))));
  let z = ceilLow, rule: Split['rule'] = 'ceiling';
  if (!rooms.every((r) => r.ceiling.kind === 'flat') && roof <= ceilLow) { z = roof; rule = 'eaves'; }
  if (z < L.floorZ + 0.3) { z = L.floorZ + 0.3; rule = 'floor'; }
  z = snap(z);
  return { level, z, rule, eavesBelow: Math.max(0, snap(z - roof)), roofBelow: walls < z - 1e-6 };
}

/**
 * The building block with the faces in the split plane moved off it: for the solid that keeps what is below z, ceilings, heads and
 * door tops at z (or less than 5 mm above) rise to z + 5 mm; for the solid that keeps what is above, sills at z drop 5 mm.
 */
export function atSplit(data: BuildingData, level: LevelId, z: number, keep: 'below' | 'above'): BuildingData {
  const d = JSON.parse(JSON.stringify(data)) as BuildingData;
  const lift = (v: number) => (v > z - 1e-6 && v < z + PROUD ? snap(z + PROUD) : v);
  const drop = (v: number) => (v > z - PROUD && v < z + 1e-6 ? snap(z - PROUD) : v);
  for (const r of d.rooms.rooms) {
    if (r.level !== level) continue;
    if (keep === 'below') {
      if (r.ceiling.kind === 'flat') r.ceiling.z = lift(r.ceiling.z!);
      else if (r.ceiling.flat_z !== undefined) r.ceiling.flat_z = lift(r.ceiling.flat_z);
      for (const o of r.openings) if (o.head_z !== undefined) o.head_z = lift(o.head_z);
      for (const dj of r.doors) { const h = r.floor_z + (dj.height ?? 2.05), l = lift(h); if (l !== h) dj.height = snap(l - r.floor_z); }
    } else {
      for (const o of r.openings) if (o.sill_z !== undefined && o.sill_z > r.floor_z + 1e-6) o.sill_z = drop(o.sill_z);
    }
  }
  return d;
}

/** the building block without roof windows and dormer windows — the print has recesses there instead of openings */
export function solidInputs(data: BuildingData): BuildingData {
  const d = JSON.parse(JSON.stringify(data)) as BuildingData;
  for (const r of d.rooms.rooms) r.roof_windows = [];
  for (const dm of d.roof?.dormers ?? []) delete dm.window;
  return d;
}

/** a print note: something the print does differently from the building, not a size change */
export interface PrintNote { code: string; element: string; message: string }

const ccwPoly = (p: Vec2[]): Vec2[] => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s < 0 ? [...p].reverse() : p; };

/**
 * A flight of stairs or the landing as a profile (u along the walking line, z up) extruded across the flight: the canonical frame
 * (stairs.ts) mapped onto the plan, the local axes turned so the map is a rotation (a mirror would turn the solid inside out).
 */
function flightSolid(geo: Geometry, keep: Keep, s: StairDef, profile: Vec2[], origin: Vec2, along: Vec2, x0: number, x1: number, floorZ: number, [z0, z1]: [number, number]): Manifold | null {
  const f = stairFrame(s);
  let cs = keep(new geo.CrossSection([ccwPoly(profile.map((p) => [snap(p[0]), snap(p[1])] as Vec2))]));
  cs = keep(cs.intersect(keep(new geo.CrossSection([[[-1e3, z0], [1e3, z0], [1e3, z1], [-1e3, z1]]]))));
  if (cs.area() < 1e-8) return null;
  const w = (p: Vec2): Vec2 => f.toWorld(p);
  const o = w([x0, origin[1]]), uW = w([x0 + along[0], origin[1] + along[1]]), xW = w([x0 + 1, origin[1]]);
  const U: Vec3 = [uW[0] - o[0], uW[1] - o[1], 0], X: Vec3 = [xW[0] - o[0], xW[1] - o[1], 0], width = x1 - x0;
  // local (u, z, w) → plan o + U·u + X·w, height floorZ + z; det [U, Z, X] = U × Z · X must be positive
  const det = (U[1] * 1 - 0) * X[0] - (U[0] * 1) * X[1];
  const [W, start]: [Vec3, Vec2] = det > 0 ? [X, o] : [[-X[0], -X[1], 0], [o[0] + X[0] * width, o[1] + X[1] * width]];
  const m = keep(cs.extrude(width));
  return keep(m.transform([U[0], U[1], 0, 0, 0, 0, 1, 0, W[0], W[1], 0, 0, start[0], start[1], floorZ, 1]));
}

/**
 * Solid stairs from the floor of their lower level — two flights and the landing — between the heights `from` and `to`
 * (absolute). `reach` carries the end of the upper flight that far beyond the stairs' outline: the piece printed with the upper
 * level runs into the edge of its floor there.
 */
export function stairSolid(geo: Geometry, keep: Keep, s: StairDef, floorZ: number, [from, to]: [number, number], ramp: boolean, reach = 0): Manifold | null {
  const f = stairFrame(s), [bx0, by0, bx1, by1] = f.box, { tread: t, riser: r, risers, landingZ, split, gap } = s, le = s.landingEdge, P = PROUD, n = risers - 1;
  const clip: [number, number] = [Math.max(-1, from - floorZ), Math.min(1e3, to - floorZ)];
  // flight 1: from the entry (y = by1, u = 0) down the canonical y to the landing edge; its far end runs 5 mm into the landing
  const run1 = by1 - le, top1: Vec2[] = [];
  if (ramp) top1.push([0, r], [(n - 1) * t, r * n]);
  else for (let i = 0; i < n; i++) top1.push([i * t, r * (i + 1)], [(i + 1) * t, r * (i + 1)]);
  top1.push([run1 + P, r * n]);
  const f1 = flightSolid(geo, keep, s, [[0, -P], [run1 + P, -P], ...[...top1].reverse()], [0, by1], [0, -1], split + gap / 2, bx1 + P, floorZ, clip);
  // landing: the full width at the far end of the flights (flight 1 runs into it, flight 2 starts inside it)
  const land = flightSolid(geo, keep, s, [[-P, -P], [le - by0, -P], [le - by0, landingZ], [-P, landingZ]], [0, by0], [0, 1], bx0 - P, bx1 + P, floorZ, clip);
  // flight 2: from the landing edge up the canonical y; it starts 5 mm inside the landing
  const top2: Vec2[] = [[-P, landingZ], [0, landingZ]];
  if (ramp) top2.push([0, landingZ + r], [(n - 1) * t, landingZ + r * n], [n * t, landingZ + r * n]);
  else for (let i = 0; i < n; i++) top2.push([i * t, landingZ + r * (i + 1)], [(i + 1) * t, landingZ + r * (i + 1)]);
  if (reach > 0) top2.push([top2[top2.length - 1][0] + reach, top2[top2.length - 1][1]]);
  const end2 = top2[top2.length - 1][0];
  const f2 = flightSolid(geo, keep, s, [[-P, -P], [end2, -P], ...[...top2].reverse()], [0, le], [0, 1], bx0 - P, split - gap / 2, floorZ, clip);
  const parts = [f1, land, f2].filter((m): m is Manifold => !!m);
  return parts.length ? keep(geo.Manifold.union(parts)) : null;
}

/** a recess: the convex hull of a rectangle o + u·[a0, a1] + v·[c0, c1] between two depths along n */
function recess(geo: Geometry, keep: Keep, o: Vec3, u: Vec3, v: Vec3, n: Vec3, a0: number, a1: number, c0: number, c1: number, d0: number, d1: number): Manifold {
  const pts: Vec3[] = [];
  for (const a of [a0, a1]) for (const c of [c0, c1]) for (const d of [d0, d1]) pts.push([0, 1, 2].map((k) => o[k] + u[k] * a + v[k] * c + n[k] * d) as Vec3);
  return keep(geo.Manifold.hull(pts));
}

/** recesses of the roof windows and the dormer windows of a level (frames of the frame width stay flush with the face) */
function windowRecesses(geo: Geometry, keep: Keep, b: Building, level: LevelId, profile: PrintProfile, n: number, notes: PrintNote[]): Manifold[] {
  const k = mmPerM(n), T = profile.wall / k, S = profile.slab / k, H = profile.hole / k, min = profile.slab / 2 / k, frame = Math.max(0.06, T), out: Manifold[] = [];
  const th = b.roof?.thickness ?? 0;
  for (const w of roofWindowsOf(b, level)) {
    const f = w.frame, dr = Math.min(th / 2, th - S);
    if (dr < min || f.width - 2 * frame < H || f.height - 2 * frame < H) { notes.push({ code: 'roof-window.omitted', element: w.id, message: `roof window ${w.id} is not shown: the roof or the window is too small at this scale` }); continue; }
    out.push(recess(geo, keep, f.o, f.u, f.v, f.n, frame, f.width - frame, frame, f.height - frame, th - dr, th + PROUD));
  }
  for (const c of dormerOpenings(b, roomsOfLevel(b, level)).cuts) {
    const W = c.outline[1][0] - c.outline[0][0], z0 = c.z0, z1 = c.z1, dr = Math.min(c.depth / 2, c.depth - T);
    if (dr < min || W - 2 * frame < H || z1 - z0 - 2 * frame < H) { notes.push({ code: 'dormer-window.omitted', element: c.id, message: `dormer window ${c.id} is not shown: the window is too small at this scale` }); continue; }
    const o: Vec3 = [c.a[0], c.a[1], 0], u: Vec3 = [c.dir[0], c.dir[1], 0], nn: Vec3 = [c.out[0], c.out[1], 0];
    const t0 = Math.min(c.outline[0][0], c.outline[1][0]);
    out.push(recess(geo, keep, o, u, [0, 0, 1], nn, t0 + frame, t0 + W - frame, z0 + frame, z1 - frame, c.depth - dr, c.depth + PROUD));
  }
  return out;
}

/** a part of the print as a solid (in the caller's scope), in building coordinates */
export interface PartSolid {
  /** "L0", "L1" … for the levels, "roof" */
  id: string;
  kind: 'level' | 'roof';
  level: LevelId;
  /** heights of its bottom and top [m] */
  base: number;
  top: number;
  solid: Manifold;
  /** heights for the thin-wall sections, and the plan region they are checked in (null: everywhere) */
  sections: number[];
  mask: Vec2[][] | null;
}

export interface BuiltParts { parts: PartSolid[]; split: Split | null; notes: PrintNote[] }

const keepBelow = (keep: Keep, m: Manifold, z: number) => keep(m.trimByPlane([0, 0, -1], -z));
const keepAbove = (keep: Keep, m: Manifold, z: number) => keep(m.trimByPlane([0, 0, 1], z));
const loopsSection = (geo: Geometry, keep: Keep, loops: Vec2[][]): CrossSection => keep(new geo.CrossSection(loops));

/** heights for the thin-wall sections of a level's part: its middle, just above the sills, just below the heads */
function sectionHeights(b: Building, level: LevelId, base: number, top: number): number[] {
  const floor = b.levelById.get(level)!.floorZ, zs = new Set<number>([Math.round(((floor + top) / 2) * 100) / 100]);
  for (const r of roomsOfLevel(b, level)) for (const w of r.windows) { zs.add(Math.round((r.floorZ + w.sill + 0.01) * 1000) / 1000); zs.add(Math.round((r.floorZ + w.head - 0.01) * 1000) / 1000); }
  return [...zs].filter((z) => z > Math.max(base, floor) + 0.005 && z < top - 0.005).sort((p, q) => p - q);
}

/** The parts of an adjusted building block at 1:n: the solids of every level, the last one split, and the roof part. */
export function buildParts(geo: Geometry, keep: Keep, data: BuildingData, n: number, profile: PrintProfile, eaves: EavesMode): BuiltParts {
  const withWindows = building(data), inputs = solidInputs(data), b = building(inputs), levels = builtLevels(b), notes: PrintNote[] = [];
  if (!levels.length) return { parts: [], split: null, notes };
  const k = mmPerM(n), [lo, hi] = span(b), parts: PartSolid[] = [], last = levels[levels.length - 1].id;
  const ramp = (s: StairDef) => s.riser * k < profile.step || s.tread * k < profile.step;
  const built = new Set(levels.map((l) => l.id));
  const clipped = (s: StairDef, level: LevelId, why: string) => notes.push({ code: 'stairs.clipped', element: s.id, message: `stairs ${s.id}: the steps above the top of level ${level}'s part are not printed (${why})` });
  // stairs from a level: in its part up to the part's top
  const withStairs = (m: Manifold, bb: Building, level: LevelId, top: number): Manifold => {
    const flights: Manifold[] = [];
    for (const s of bb.stairs.filter((x) => x.fromLevel === level)) {
      const floor = bb.levelById.get(level)!.floorZ, st = stairSolid(geo, keep, s, floor, [-Infinity, top], ramp(s));
      if (ramp(s)) notes.push({ code: 'stairs.ramp', element: s.id, message: `stairs ${s.id}: steps lower than ${profile.step} mm print as a ramp` });
      if (floor + s.topZ > top + 1e-6 && !built.has(s.toLevel)) clipped(s, level, 'the level they lead to has no part');
      if (st) flights.push(st);
    }
    return flights.length ? keep(geo.Manifold.union([m, ...flights])) : m;
  };
  // stairs arriving at a level: the steps in the thickness of its slab (above the top of the part below) stand in the opening
  // of the slab, on the bed, and run 5 mm into the edge of the floor the stairs lead onto
  const arriving = (m: Manifold, bb: Building, level: LevelId): Manifold => {
    for (const s of bb.stairs.filter((x) => x.toLevel === level && built.has(x.fromLevel))) {
      const from = bb.levelById.get(s.fromLevel)!, top = levelFrame(bb, s.fromLevel).top;
      if (from.floorZ + s.topZ <= top + 1e-6) continue;
      const st = stairSolid(geo, keep, s, from.floorZ, [top, Infinity], ramp(s), PROUD), high = st ? st.boundingBox().max[2] - top : 0;
      if (!st || high * k < profile.step) { clipped(s, s.fromLevel, `they are lower than ${profile.step} mm on the print`); continue; }
      if (keep(st.intersect(m)).volume() < 1e-9) { clipped(s, s.fromLevel, `they do not meet the floor of level ${level}`); continue; }
      notes.push({ code: 'stairs.split', element: s.id, message: `stairs ${s.id}: the steps in the slab of level ${level} (${Math.round(high * 100)} cm) are printed with level ${level}'s part, in the opening of its floor` });
      m = keep(geo.Manifold.union([m, st]));
    }
    return m;
  };
  for (const l of levels) {
    if (l.id === last) continue;
    const s = levelSolid(geo, keep, b, l.id, { roofOverlap: PROUD })!, f = s.frame;
    let m = arriving(withStairs(s.solid, b, l.id, f.top), b, l.id);
    const roof = roofSolid(geo, keep, b, l.id, lo, hi);
    if (roof) {
      notes.push({ code: 'roof.fixed', element: l.id, message: `the roof over level ${l.id} is printed with its level (only the roof of the last level comes off)` });
      const pockets = windowRecesses(geo, keep, withWindows, l.id, profile, n, notes);
      m = keep(geo.Manifold.union([m, roof.solid]));
      if (pockets.length) m = keep(m.subtract(keep(geo.Manifold.union(pockets))));
    }
    const top = m.boundingBox().max[2];
    parts.push({ id: l.id, kind: 'level', level: l.id, base: f.bottom, top, solid: m, sections: sectionHeights(b, l.id, f.bottom, f.top), mask: null });
  }
  // the last level: its part below the split, the roof part above it
  const split = splitHeight(b, last, eaves), z = split.z;
  const below = building(atSplit(inputs, last, z, 'below')), above = building(atSplit(inputs, last, z, 'above'));
  const sb = levelSolid(geo, keep, below, last, { roofOverlap: PROUD })!, footprint = sb.plan.footprint;
  let lower = arriving(withStairs(sb.solid, below, last, z), below, last);
  const roofed = !!b.roof?.byLevel(last).length, fp = () => prism(keep, loopsSection(geo, keep, footprint), lo, hi);
  if (roofed && split.roofBelow) {
    const r = roofSolid(geo, keep, below, last, lo, hi);
    if (r) lower = keep(geo.Manifold.union([lower, keep(r.solid.intersect(fp()))]));
  }
  parts.push({ id: last, kind: 'level', level: last, base: sb.frame.bottom, top: z, solid: keepBelow(keep, lower, z), sections: sectionHeights(b, last, sb.frame.bottom, z), mask: null });
  const sa = levelSolid(geo, keep, above, last, { roofOverlap: PROUD })!, r = roofed ? roofSolid(geo, keep, above, last, lo, hi) : null;
  let upper = keepAbove(keep, r ? keep(geo.Manifold.union([sa.solid, r.solid])) : sa.solid, z);
  if (eaves === 'trim' && roofed) {
    upper = keep(upper.intersect(fp()));
    notes.push({ code: 'eaves.trimmed', element: 'roof', message: 'the eaves and verges are cut at the outer faces of the walls (--eaves trim)' });
  } else if (split.eavesBelow > 1e-4) {
    notes.push({ code: 'eaves.cut', element: 'roof', message: `the eaves are cut at the split height: their lowest ${Math.round(split.eavesBelow * 100)} cm are not printed, so the roof stands flat on the bed` });
  }
  const pockets = roofed ? windowRecesses(geo, keep, withWindows, last, profile, n, notes) : [];
  if (pockets.length) upper = keep(upper.subtract(keep(geo.Manifold.union(pockets))));
  parts.push({ id: 'roof', kind: 'roof', level: last, base: z, top: upper.boundingBox().max[2], solid: upper, sections: [snap(z + 0.01)], mask: footprint });
  return { parts, split, notes };
}
