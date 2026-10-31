// The generated shell as manifold solids: one closed solid per level — mass minus voids (ADR 0024) — and one roof solid per level
// with roof parts (roofSolid.ts, ADR 0027).
//   mass   = the footprint (room outlines grown by the exterior wall, merged) extruded as the floor slab (slab underside → floor)
//            and the walls; the walls end at the underside of the next slab, rise to the roof's underside where the level's roof
//            parts cover them, and on a last level without a roof end at the wall top under a flat roof slab;
//   voids  = the rooms (through the top below another level; up to the flat top or into the roof under a roof), the opening
//            cutters and the stair shaft, unioned in one batch and subtracted once; chimneys are added afterwards.
// Inputs are snapped to 0.1 mm, every prism gets exact top and bottom heights, and cutters stand 5 mm proud of the faces they
// cut, so no near-coplanar faces reach the boolean. Pure helpers (frames, bounds) need no kernel; the solids take the loaded
// kernel as an argument.
import { roomsOfLevel, stairArrivesAt, type Building, type Level, type Room } from '../model/building.ts';
import { offsetPolygon } from '../model/geom2d.ts';
import { inRegion, surfaceRange } from '../model/roof.ts';
import type { LevelId, Vec2, Vec3 } from '../package/types.ts';
import { joinMeshes, slatMeshes, windowMeshes, type PlainMesh } from './frames.ts';
import { solidMesh, type SolidMesh } from './mesh.ts';
import { levelOpenings, PROUD, snap, type OpeningCut, type PlanMass, type ShellWindow } from './openings.ts';
import { prism, rectSection, roofSpace } from './prism.ts';
import { roofBounds, roofPieces, roofSolid, type RoofWindow } from './roofSolid.ts';
import { scoped, type Keep } from './scope.ts';
import { wallSection } from './slice.ts';
import { TagTable } from './tags.ts';
import { kernelMessage, type CrossSection, type Geometry, type Manifold } from './wasm.ts';

/** vertical frame of a level's solid (absolute z) */
export interface LevelFrame {
  level: LevelId;
  /** underside of the floor slab */
  bottom: number;
  floor: number;
  /** top of the walls: the highest ceiling of the level's rooms; under a roof the highest point of its underside over the walls */
  wallTop: number;
  /** top of the solid: the underside of the next level's slab, the top of the flat roof slab over a last level, or under a
   *  roof the highest point of the walls */
  top: number;
  last: boolean;
  /** the level's walls rise to roof parts */
  roofed: boolean;
}

/** wall height of a level: the highest ceiling of its rooms */
export function wallTop(rooms: Room[], floorZ: number): number {
  let top = 0;
  for (const r of rooms) top = Math.max(top, r.floorZ + r.ceiling.range()[1]);
  return top > floorZ ? top : floorZ + 2.6;
}

/** levels that have rooms (the others have no solid) */
export const builtLevels = (b: Building) => b.levels.filter((l) => roomsOfLevel(b, l.id).length);
const nextBuilt = (b: Building, level: LevelId): Level | null => { const L = builtLevels(b), i = L.findIndex((l) => l.id === level); return L[i + 1] ?? null; };
/** the walls of a level in plan: every room grown by the exterior wall */
const grownRooms = (b: Building, level: LevelId) => roomsOfLevel(b, level).map((r) => offsetPolygon(r.polygon, b.shell.exteriorWall));

export function levelFrame(b: Building, level: LevelId): LevelFrame {
  const i = b.levels.findIndex((l) => l.id === level), floor = b.levels[i]?.floorZ ?? 0, next = b.levels[i + 1], slab = b.shell.slab;
  const pieces = roofPieces(b, level);
  if (pieces.length) {
    // walls under the roof rise to its underside (the dormers' included); under the next level to its slab
    let under = -Infinity;
    for (const p of grownRooms(b, level)) { const r = surfaceRange({ pieces, which: 'region' }, p); if (r) under = Math.max(under, r[1]); }
    const up = nextBuilt(b, level), top = snap(Math.max(under, up ? up.floorZ - slab : -Infinity, floor + 0.01));
    return { level, bottom: snap(floor - slab), floor, wallTop: top, top, last: !up, roofed: true };
  }
  const walls = wallTop(roomsOfLevel(b, level), floor);
  if (!next) return { level, bottom: snap(floor - slab), floor, wallTop: snap(walls), top: snap(walls + slab), last: true, roofed: false };
  const top = snap(Math.max(floor + 0.01, next.floorZ - slab));
  return { level, bottom: snap(floor - slab), floor, wallTop: snap(Math.min(walls, top)), top, last: false, roofed: false };
}

/** bounds of the walls: the room outlines grown by the exterior wall, from the lowest slab underside to the highest wall solid top */
export function wallBounds(b: Building): { min: Vec3; max: Vec3 } {
  const levels = builtLevels(b), t = b.shell.exteriorWall;
  if (!levels.length) return { min: [0, 0, 0], max: [1, 1, 1] };
  const pts = levels.flatMap((l) => roomsOfLevel(b, l.id).flatMap((r) => r.polygon)), frames = levels.map((l) => levelFrame(b, l.id));
  const box = {
    min: [snap(Math.min(...pts.map((p) => p[0])) - t), snap(Math.min(...pts.map((p) => p[1])) - t), Math.min(...frames.map((f) => f.bottom))] as Vec3,
    max: [snap(Math.max(...pts.map((p) => p[0])) + t), snap(Math.max(...pts.map((p) => p[1])) + t), Math.max(...frames.map((f) => f.top))] as Vec3,
  };
  // walls that bound no room: the corners of their prisms
  for (const w of b.walls.filter((x) => levels.some((l) => l.id === x.level))) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), n: Vec2 = [-(w.b[1] - w.a[1]) / L * w.thickness / 2, (w.b[0] - w.a[0]) / L * w.thickness / 2];
    for (const p of [w.a, w.b]) for (const k of [-1, 1]) for (let j = 0; j < 2; j++) { const v = snap(p[j] + n[j] * k); box.min[j] = Math.min(box.min[j], v); box.max[j] = Math.max(box.max[j], v); }
    box.min[2] = Math.min(box.min[2], snap(w.z0)); box.max[2] = Math.max(box.max[2], snap(w.z1));
  }
  return box;
}

/** bounds of the generated shell: the walls and the roof (eaves, ridges, chimneys) */
export function shellBounds(b: Building): { min: Vec3; max: Vec3 } {
  const w = wallBounds(b), r = roofBounds(b);
  if (!r) return w;
  return { min: [0, 1, 2].map((k) => snap(Math.min(w.min[k], r.min[k]))) as Vec3, max: [0, 1, 2].map((k) => snap(Math.max(w.max[k], r.max[k]))) as Vec3 };
}

const snap2 = (p: Vec2): Vec2 => [snap(p[0]), snap(p[1])];

/** an opening cutter: a plan rectangle extruded like a room, or the outline in the wall plane pushed through the wall */
function cutterSolid(geo: Geometry, keep: Keep, c: OpeningCut): Manifold {
  if (c.box) return prism(keep, rectSection(geo, keep, c.box), c.z0, c.z1);
  const cs = keep(new geo.CrossSection([c.outline]));
  const local = keep(cs.extrude(c.depth + 2 * PROUD));
  // local (t, z, d) → plan a + dir·t + out·(d − PROUD), height z
  return keep(local.transform([c.dir[0], c.dir[1], 0, 0, 0, 0, 1, 0, c.out[0], c.out[1], 0, 0, c.a[0] - c.out[0] * PROUD, c.a[1] - c.out[1] * PROUD, 0, 1]));
}

/** windows in the fronts of dormers set back from the walls: cutters through the front and frames (a front in a wall plane
 *  holds an ordinary room window instead) */
export function dormerOpenings(b: Building, rooms: Room[]): { cuts: OpeningCut[]; windows: ShellWindow[] } {
  const cuts: OpeningCut[] = [], windows: ShellWindow[] = [];
  for (const d of b.roof?.json.dormers ?? []) {
    const w = d.window, room = w && rooms.find((r) => r.id === w.roomId);
    if (!w || !room) continue;
    const [x0, y0, x1, y1] = d.rect, [i0, i1, i2, i3] = d.inner, alongX = d.front === 'N' || d.front === 'S';
    const mid = alongX ? (i0 + i2) / 2 : (i1 + i3) / 2, half = w.width / 2;
    // the inner face of the front, the direction along it (counter-clockwise seen from outside: from the room's left) and out
    const out: Vec2 = d.front === 'N' ? [0, 1] : d.front === 'S' ? [0, -1] : d.front === 'E' ? [1, 0] : [-1, 0];
    const face = d.front === 'N' ? i3 : d.front === 'S' ? i1 : d.front === 'E' ? i2 : i0, outer = d.front === 'N' ? y1 : d.front === 'S' ? y0 : d.front === 'E' ? x1 : x0;
    const dir: Vec2 = [-out[1] || 0, out[0] || 0], depth = snap(Math.abs(outer - face)), t0 = mid - half;
    const a: Vec2 = alongX ? [dir[0] > 0 ? t0 : t0 + w.width, face] : [face, dir[1] > 0 ? t0 : t0 + w.width];
    const box: [number, number, number, number] = alongX
      ? [snap(t0), snap(Math.min(face, outer) - PROUD), snap(t0 + w.width), snap(Math.max(face, outer) + PROUD)]
      : [snap(Math.min(face, outer) - PROUD), snap(t0), snap(Math.max(face, outer) + PROUD), snap(t0 + w.width)];
    const z0 = snap(w.sill_z), z1 = snap(w.head_z);
    cuts.push({ id: w.id, roomId: room.id, wallId: `${d.id}-front`, kind: 'window', a: snap2(a), dir, out, outline: [[0, z0], [w.width, z0], [w.width, z1], [0, z1]], depth, box, z0, z1 });
    windows.push({ id: w.id, roomId: room.id, wallId: `${d.id}-front`, kind: 'window', a, dir, out, width: w.width, z0, z1, depth });
  }
  return { cuts, windows };
}

export interface LevelSolid {
  frame: LevelFrame;
  /** the closed solid of the level (owned by the caller's scope) */
  solid: Manifold;
  tags: TagTable;
  /** the wall mass in plan: the footprint loops and the room outlines */
  plan: PlanMass;
  cuts: OpeningCut[];
  windows: ShellWindow[];
}

/** the heights every solid of a building lies between (prisms that are trimmed by roof planes start and end here) */
export function span(b: Building): [number, number] {
  const s = shellBounds(b);
  return [snap(s.min[2] - 1), snap(s.max[2] + 1)];
}

export interface LevelSolidOptions {
  /** how far the walls rise into the roof above them (the rooms still 5 mm further): the print adds the level and the roof into
   *  one solid, and overlapping solids unite cleanly where solids that only touch keep a seam along the valleys [m] (default 0) */
  roofOverlap?: number;
}

/** the solid of one level, built in the caller's scope; null for a level without rooms */
export function levelSolid(geo: Geometry, keep: Keep, b: Building, level: LevelId, opts: LevelSolidOptions = {}): LevelSolid | null {
  const rooms = roomsOfLevel(b, level);
  if (!rooms.length) return null;
  const { Manifold, CrossSection } = geo, frame = levelFrame(b, level), tags = new TagTable(), t = b.shell.exteriorWall;
  const outlines = rooms.map((r) => r.polygon.map(snap2));
  // footprint: every room grown by the wall thickness (square corners: a point within t of a room on both axes), merged
  const footprint = keep(keep(new CrossSection(outlines)).offset(t, 'Miter', 2));
  const plan: PlanMass = { footprint: footprint.toPolygons().map((p) => p.map((q) => [q[0], q[1]] as Vec2)), rooms: outlines };
  const roomSection = (i: number) => keep(new CrossSection([outlines[i]]));
  const mass: Manifold[] = [keep(tags.original(prism(keep, footprint, frame.bottom, frame.floor), { kind: 'slab', level }))];
  const voids: Manifold[] = [];
  /** where the walls of the level rise (null: everywhere up to the frame's top) */
  let cap: Manifold | null = null;
  if (frame.roofed) {
    const pieces = roofPieces(b, level), [lo, hi] = span(b), up = nextBuilt(b, level), slab = b.shell.slab;
    // walls: up to the roof's underside, and under the next level up to its slab; rooms: up to their flat top under the roof
    // (into the roof where it is lower — 5 mm above the walls, so no face is shared), through the top under the next level
    const o = opts.roofOverlap ?? 0;
    const space = roofSpace(geo, keep, pieces, 'region', o, lo, hi), spaceUp = roofSpace(geo, keep, pieces, 'inner', PROUD + o, lo, hi);
    const nextFp = up ? keep(keep(new CrossSection(roomsOfLevel(b, up.id).map((r) => r.polygon.map(snap2)))).offset(t, 'Miter', 2)) : null;
    const nextTop = up ? snap(up.floorZ - slab) : 0;
    cap = nextFp ? keep(Manifold.union(space, prism(keep, nextFp, lo, nextTop))) : space;
    mass.push(keep(tags.original(keep(prism(keep, footprint, frame.floor, hi).intersect(cap)), { kind: 'mass', level })));
    rooms.forEach((r, i) => {
      const parts = [keep(prism(keep, roomSection(i), snap(r.floorZ), snap(r.ceiling.flatZ)).intersect(spaceUp))];
      if (nextFp) parts.push(prism(keep, keep(roomSection(i).intersect(nextFp)), snap(r.floorZ), snap(nextTop + PROUD)));
      voids.push(keep(tags.original(keep(Manifold.union(parts)), { kind: 'room', level, roomId: r.id })));
    });
  } else {
    mass.push(keep(tags.original(prism(keep, footprint, frame.floor, frame.last ? frame.wallTop : frame.top), { kind: 'mass', level })));
    if (frame.last) mass.push(keep(tags.original(prism(keep, footprint, frame.wallTop, frame.top), { kind: 'slab', level })));
    // rooms through the top below another level
    const roomTop = frame.last ? frame.wallTop : frame.top + PROUD;
    rooms.forEach((r, i) => voids.push(keep(tags.original(prism(keep, roomSection(i), snap(r.floorZ), roomTop), { kind: 'room', level, roomId: r.id }))));
  }
  const openings = levelOpenings(rooms, plan, frame.wallTop), dormers = dormerOpenings(b, rooms);
  const cuts = [...openings.cuts, ...dormers.cuts], windows = [...openings.windows, ...dormers.windows];
  for (const c of cuts) voids.push(keep(tags.original(cutterSolid(geo, keep, c), { kind: 'opening', level, roomId: c.roomId, holeId: c.id, wallId: c.wallId })));
  if (stairArrivesAt(b, level)) {
    const stairId = b.stairs.find((s) => s.toLevel === level)?.id;
    for (const r of rooms) if (r.stairOutline) {
      const box = keep(new CrossSection([r.stairOutline.map(snap2)]));
      voids.push(keep(tags.original(prism(keep, box, snap(frame.bottom - PROUD), snap(frame.floor + PROUD)), { kind: 'shaft', level, roomId: r.id, stairId })));
    }
  }
  let solid = keep(keep(Manifold.union(mass)).subtract(keep(Manifold.union(voids))));
  // chimneys stand in the level (also inside a room) from its slab to its top, under the roof up to the roof's underside
  const grown = grownRooms(b, level), chimneys: Manifold[] = [];
  for (const c of b.roof?.json.chimneys ?? []) {
    const x = (c.rect[0] + c.rect[2]) / 2, y = (c.rect[1] + c.rect[3]) / 2;
    if (c.bottom > frame.top - 0.01 || !grown.some((p) => inRegion(p, x, y))) continue;
    const box = prism(keep, rectSection(geo, keep, c.rect.map(snap)), snap(Math.max(c.bottom, frame.bottom)), cap ? span(b)[1] : frame.top);
    chimneys.push(keep(tags.original(cap ? keep(box.intersect(cap)) : box, { kind: 'chimney', level, chimneyId: c.id })));
  }
  if (chimneys.length) solid = keep(Manifold.union([solid, ...chimneys]));
  // walls that bound no room: a prism about the axis, its openings cut through it
  const free = b.walls.filter((w) => w.level === level).map((w) => {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), u: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L], n: Vec2 = [-u[1] * w.thickness / 2, u[0] * w.thickness / 2];
    const at = (s: number, k: number): Vec2 => snap2([w.a[0] + u[0] * s + n[0] * k, w.a[1] + u[1] * s + n[1] * k]);
    const quad = (s0: number, s1: number, k: number) => keep(new CrossSection([[at(s0, -k), at(s1, -k), at(s1, k), at(s0, k)]]));
    let m = keep(tags.original(prism(keep, quad(0, L, 1), snap(w.z0), snap(w.z1)), { kind: 'mass', level }));
    const cuts = w.openings.map((o) => keep(tags.original(prism(keep, quad(o.t0, o.t1, 1 + (2 * PROUD) / w.thickness), snap(o.z0), snap(o.z1)), { kind: 'opening', level, holeId: o.id, wallId: w.id })));
    if (cuts.length) m = keep(m.subtract(keep(Manifold.union(cuts))));
    return m;
  });
  if (free.length) solid = keep(Manifold.union([solid, ...free]));
  const status = solid.status();
  if (status !== 'NoError') throw new Error(`solid of level ${level}: ${status}`);
  return { frame, solid, tags, plan, cuts, windows };
}

export interface LevelMeshes {
  level: LevelId;
  frame: LevelFrame;
  solid: SolidMesh;
  frames: PlainMesh;
  glass: PlainMesh;
  windows: ShellWindow[];
  /** the wall mass in plan (slice.ts wallSection): outer loops counter-clockwise, holes clockwise */
  section: Vec2[][];
  bounds: { min: Vec3; max: Vec3 };
  volume: number;
}
export interface RoofMeshes {
  level: LevelId;
  solid: SolidMesh;
  frames: PlainMesh;
  glass: PlainMesh;
  windows: RoofWindow[];
  bounds: { min: Vec3; max: Vec3 };
  volume: number;
}
/** a part of the shell the kernel could not build: a level solid or the roof solid over a level */
export interface ShellFailure { part: 'level' | 'roof'; level: LevelId; error: string }
export interface ShellMeshes { levels: LevelMeshes[]; roofs: RoofMeshes[]; failed: ShellFailure[]; triangles: number; ms: number }

const meshes = new WeakMap<Building, ShellMeshes>();
/** the generated shell of a building as plain meshes (once per building). Every level and every roof is built in its own scope:
 *  a part the kernel fails on is left out and listed in `failed`, the others are kept; every WASM object is freed before
 *  returning */
export function shellMeshes(geo: Geometry, b: Building): ShellMeshes {
  const hit = meshes.get(b);
  if (hit) return hit;
  const t0 = Date.now(), failed: ShellFailure[] = [];
  const attempt = <T>(part: ShellFailure['part'], level: LevelId, fn: (keep: Keep) => T): T | null => {
    try { return scoped(fn); } catch (e) { failed.push({ part, level, error: kernelMessage(e) }); return null; }
  };
  const levels = builtLevels(b).flatMap((l) => attempt('level', l.id, (keep): LevelMeshes[] => {
    const s = levelSolid(geo, keep, b, l.id)!, box = s.solid.boundingBox(), w = windowMeshes(s.windows), slats = slatMeshes(b.walls.filter((x) => x.level === l.id));
    const section = wallSection(keep, s.solid, s.frame.floor, l.floorZ + l.cutHeight);
    return [{ level: l.id, frame: s.frame, solid: solidMesh(s.solid, s.tags), frames: joinMeshes(w.frames, slats), glass: w.glass, windows: s.windows, section, bounds: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 }, volume: s.solid.volume() }];
  }) ?? []);
  const [lo, hi] = span(b);
  const roofs = (b.roof?.levels ?? []).flatMap((level) => attempt('roof', level, (keep): RoofMeshes[] => {
    const r = roofSolid(geo, keep, b, level, lo, hi);
    if (!r) return [];
    const box = r.solid.boundingBox(), w = windowMeshes(r.windows.map((x) => x.frame));
    return [{ level, solid: solidMesh(r.solid, r.tags), frames: w.frames, glass: w.glass, windows: r.windows, bounds: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 }, volume: r.solid.volume() }];
  }) ?? []);
  const triangles = [...levels, ...roofs].reduce((n, l) => n + l.solid.index.length / 3, 0);
  const res: ShellMeshes = { levels, roofs, failed, triangles, ms: Date.now() - t0 };
  meshes.set(b, res);
  return res;
}

export type { CrossSection };
