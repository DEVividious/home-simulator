// The generated shell as manifold solids: one closed solid per level — mass minus voids (ADR 0024).
//   mass   = the footprint (room outlines grown by the exterior wall, merged) extruded as the floor slab (slab underside → floor),
//            the walls (floor → underside of the next slab, or the wall top on the last level) and, over the last level, the
//            roof slab (wall top → wall top + slab);
//   voids  = the rooms (floor → wall top, through the top on lower levels), the opening cutters and the stair shaft,
//            unioned in one batch and subtracted once.
// Inputs are snapped to 0.1 mm, every prism gets exact top and bottom heights, and cutters stand 5 mm proud of the faces they
// cut, so no near-coplanar faces reach the boolean. Rooms stay open up to the wall top as in the grid shell (sloped ceilings
// are interior finishes until the roof takes them over, ADR 0027); the roof itself comes later. Pure helpers (frames, bounds)
// need no kernel; the solids take the loaded kernel as an argument.
import { roomsOfLevel, stairArrivesAt, type Building, type Room } from '../model/building.ts';
import type { LevelId, Vec2, Vec3 } from '../package/types.ts';
import { windowMeshes, type PlainMesh } from './frames.ts';
import { solidMesh, type SolidMesh } from './mesh.ts';
import { levelOpenings, PROUD, snap, type OpeningCut, type PlanMass, type ShellWindow } from './openings.ts';
import { scoped, type Keep } from './scope.ts';
import { TagTable } from './tags.ts';
import type { CrossSection, Geometry, Manifold } from './wasm.ts';

/** vertical frame of a level's solid (absolute z) */
export interface LevelFrame {
  level: LevelId;
  /** underside of the floor slab */
  bottom: number;
  floor: number;
  /** top of the walls: the highest ceiling of the level's rooms (at most the solid top) */
  wallTop: number;
  /** top of the solid: the underside of the next level's slab, or the top of the roof slab over the last level */
  top: number;
  last: boolean;
}

/** wall height of a level: the highest ceiling of its rooms (a sloped ceiling is highest where the room comes closest to the ridge) */
export function wallTop(rooms: Room[], floorZ: number): number {
  let top = 0;
  for (const r of rooms) {
    for (const q of r.polygon) top = Math.max(top, r.floorZ + r.ceiling.heightAt(q[0], q[1]));
    const c = r.ceiling, [x0, y0, x1, y1] = r.bbox;
    if (c.kind === 'attic') top = Math.max(top, r.floorZ + c.heightAt(Math.min(x1, Math.max(x0, c.ridgeX ?? x0)), Math.min(y1, Math.max(y0, c.ridgeY ?? y0))));
  }
  return top > floorZ ? top : floorZ + 2.6;
}

export function levelFrame(b: Building, level: LevelId): LevelFrame {
  const i = b.levels.findIndex((l) => l.id === level), floor = b.levels[i]?.floorZ ?? 0, next = b.levels[i + 1], slab = b.shell.slab;
  const walls = wallTop(roomsOfLevel(b, level), floor);
  if (!next) return { level, bottom: snap(floor - slab), floor, wallTop: snap(walls), top: snap(walls + slab), last: true };
  const top = snap(Math.max(floor + 0.01, next.floorZ - slab));
  return { level, bottom: snap(floor - slab), floor, wallTop: snap(Math.min(walls, top)), top, last: false };
}

/** levels that have rooms (the others have no solid) */
const builtLevels = (b: Building) => b.levels.filter((l) => roomsOfLevel(b, l.id).length);

/** bounds of the generated shell: the room outlines grown by the exterior wall, from the lowest slab underside to the highest solid top */
export function shellBounds(b: Building): { min: Vec3; max: Vec3 } {
  const levels = builtLevels(b), t = b.shell.exteriorWall;
  if (!levels.length) return { min: [0, 0, 0], max: [1, 1, 1] };
  const pts = levels.flatMap((l) => roomsOfLevel(b, l.id).flatMap((r) => r.polygon)), frames = levels.map((l) => levelFrame(b, l.id));
  return {
    min: [snap(Math.min(...pts.map((p) => p[0])) - t), snap(Math.min(...pts.map((p) => p[1])) - t), Math.min(...frames.map((f) => f.bottom))],
    max: [snap(Math.max(...pts.map((p) => p[0])) + t), snap(Math.max(...pts.map((p) => p[1])) + t), Math.max(...frames.map((f) => f.top))],
  };
}

const snap2 = (p: Vec2): Vec2 => [snap(p[0]), snap(p[1])];
/** prism of a cross-section between two heights — the heights are set exactly, not by adding a translation */
const prism = (keep: Keep, cs: CrossSection, z0: number, z1: number): Manifold => keep(keep(cs.extrude(1)).warp((v) => { v[2] = v[2] > 0.5 ? z1 : z0; }));
const rect = (geo: Geometry, keep: Keep, [x0, y0, x1, y1]: readonly number[]) => keep(new geo.CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]));

/** an opening cutter: a plan rectangle extruded like a room, or the outline in the wall plane pushed through the wall */
function cutterSolid(geo: Geometry, keep: Keep, c: OpeningCut): Manifold {
  if (c.box) return prism(keep, rect(geo, keep, c.box), c.z0, c.z1);
  const cs = keep(new geo.CrossSection([c.outline]));
  const local = keep(cs.extrude(c.depth + 2 * PROUD));
  // local (t, z, d) → plan a + dir·t + out·(d − PROUD), height z
  return keep(local.transform([c.dir[0], c.dir[1], 0, 0, 0, 0, 1, 0, c.out[0], c.out[1], 0, 0, c.a[0] - c.out[0] * PROUD, c.a[1] - c.out[1] * PROUD, 0, 1]));
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

/** the solid of one level, built in the caller's scope; null for a level without rooms */
export function levelSolid(geo: Geometry, keep: Keep, b: Building, level: LevelId): LevelSolid | null {
  const rooms = roomsOfLevel(b, level);
  if (!rooms.length) return null;
  const { Manifold, CrossSection } = geo, frame = levelFrame(b, level), tags = new TagTable(), t = b.shell.exteriorWall;
  const outlines = rooms.map((r) => r.polygon.map(snap2));
  // footprint: every room grown by the wall thickness (square corners — the grid shell's "within t of a room"), merged
  const footprint = keep(keep(new CrossSection(outlines)).offset(t, 'Miter', 2));
  const plan: PlanMass = { footprint: footprint.toPolygons().map((p) => p.map((q) => [q[0], q[1]] as Vec2)), rooms: outlines };
  const mass: Manifold[] = [
    keep(tags.original(prism(keep, footprint, frame.bottom, frame.floor), { kind: 'slab', level })),
    keep(tags.original(prism(keep, footprint, frame.floor, frame.last ? frame.wallTop : frame.top), { kind: 'mass', level })),
  ];
  if (frame.last) mass.push(keep(tags.original(prism(keep, footprint, frame.wallTop, frame.top), { kind: 'slab', level })));
  // voids: rooms (through the top below another level), openings, stair shaft
  const roomTop = frame.last ? frame.wallTop : frame.top + PROUD;
  const voids: Manifold[] = rooms.map((r, i) => keep(tags.original(prism(keep, keep(new CrossSection([outlines[i]])), snap(r.floorZ), roomTop), { kind: 'room', level, roomId: r.id })));
  const { cuts, windows } = levelOpenings(rooms, plan, frame.wallTop);
  for (const c of cuts) voids.push(keep(tags.original(cutterSolid(geo, keep, c), { kind: 'opening', level, roomId: c.roomId, holeId: c.id, wallId: c.wallId })));
  if (stairArrivesAt(b, level)) {
    const stairId = b.stairs.find((s) => s.toLevel === level)?.id;
    for (const r of rooms) if (r.stairOpening) {
      const box = rect(geo, keep, r.stairOpening.map(snap));
      voids.push(keep(tags.original(prism(keep, box, snap(frame.bottom - PROUD), snap(frame.floor + PROUD)), { kind: 'shaft', level, roomId: r.id, stairId })));
    }
  }
  const solid = keep(keep(Manifold.union(mass)).subtract(keep(Manifold.union(voids))));
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
  bounds: { min: Vec3; max: Vec3 };
  volume: number;
}
export interface ShellMeshes { levels: LevelMeshes[]; triangles: number; ms: number }

const meshes = new WeakMap<Building, ShellMeshes>();
/** the generated shell of a building as plain meshes (once per building); every WASM object is freed before returning */
export function shellMeshes(geo: Geometry, b: Building): ShellMeshes {
  const hit = meshes.get(b);
  if (hit) return hit;
  const t0 = Date.now();
  const levels = scoped((keep) => builtLevels(b).map((l) => {
    const s = levelSolid(geo, keep, b, l.id)!, box = s.solid.boundingBox(), w = windowMeshes(s.windows);
    return { level: l.id, frame: s.frame, solid: solidMesh(s.solid, s.tags), frames: w.frames, glass: w.glass, windows: s.windows, bounds: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 }, volume: s.solid.volume() };
  }));
  const out: ShellMeshes = { levels, triangles: levels.reduce((n, l) => n + l.solid.index.length / 3, 0), ms: Date.now() - t0 };
  meshes.set(b, out);
  return out;
}
