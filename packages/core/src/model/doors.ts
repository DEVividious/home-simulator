// Door leaves in plan — pure functions of one door record. Every door type is one or more leaves (panels), each a segment a → b
// (a: the hinge edge, or the start of a sliding leaf) at an opening amount t ∈ [0, 1]:
//   hinged-single  one leaf turning about `hinge` from `closedDir` towards `openDir` by openAngle · t;
//   hinged-double  two leaves of half the width, hinged at both jambs (the second at hinge + closedDir · leafWidth), turning
//                  into the same room;
//   folding        two panels of half the width (a bifold): the first turns about `hinge`, the second is hinged to its free edge
//                  and its far edge runs along the wall line back towards the hinge, so the pair folds into a V;
//   sliding, pocket one leaf moving along the wall by travel · t;
//   sectional      an overhead (garage) door: one leaf in plan, standing in the wall line; in 3D a stack of panels running up
//                  its tracks, round a bend and back under the ceiling of the room it lifts into (sectionPose).
// The plan symbols (swing arcs) and the floor a leaf sweeps (for warnings) follow from the same leaves.
import type { DoorDef, Vec2 } from '../package/types.ts';

export interface LeafSegment { a: Vec2; b: Vec2; dir: Vec2 }

const clamp01 = (t: number) => Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
const at = (p: Vec2, d: Vec2, k: number): Vec2 => [p[0] + d[0] * k, p[1] + d[1] * k];

/** number of leaves (panels) of a door */
export const leafCount = (d: DoorDef): number => (d.type === 'hinged-double' || d.type === 'folding' ? 2 : 1);
/** width of one leaf [m] (the record's leafWidth is all of them together) */
export const leafWidthOf = (d: DoorDef): number => d.leafWidth / leafCount(d);
/** leaf angle [°] at opening t (0 — closed, 1 — fully open) */
export const leafAngle = (d: DoorDef, t: number) => (d.openAngle ?? 0) * clamp01(t);

/** the leaves of a door in plan at opening t (empty for a door with neither a hinge nor a track) */
export function doorLeaves(d: DoorDef, t: number): LeafSegment[] {
  if (d.hinge && d.closedDir && d.openDir) {
    const th = (leafAngle(d, t) * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), w = leafWidthOf(d), h = d.hinge, C = d.closedDir, O = d.openDir;
    const dir: Vec2 = [C[0] * c + O[0] * s, C[1] * c + O[1] * s];
    if (d.type === 'hinged-double') {
      const h2 = at(h, C, d.leafWidth), dir2: Vec2 = [-C[0] * c + O[0] * s, -C[1] * c + O[1] * s];
      return [{ a: h, b: at(h, dir, w), dir }, { a: h2, b: at(h2, dir2, w), dir: dir2 }];
    }
    if (d.type === 'folding') {
      const j = at(h, dir, w), end = at(h, C, 2 * w * c), dir2: Vec2 = [C[0] * c - O[0] * s, C[1] * c - O[1] * s];
      return [{ a: h, b: j, dir }, { a: j, b: end, dir: dir2 }];
    }
    return [{ a: h, b: at(h, dir, d.leafWidth), dir }];
  }
  if (d.lift) return [{ a: d.lift.origin, b: at(d.lift.origin, d.lift.dir, d.leafWidth), dir: d.lift.dir }];
  if (d.slide) {
    const k = (d.opening.width - d.leafWidth) / 2 + d.slide.travel * clamp01(t), a = at(d.slide.origin, d.slide.dir, k);
    return [{ a, b: at(a, d.slide.dir, d.leafWidth), dir: d.slide.dir }];
  }
  return [];
}

/** swing arcs for a plan, as polylines: the path of each hinged leaf's free edge (a bifold: of the fold between its panels);
 *  sliding — the track of the leaf; sectional — its two overhead tracks from the jambs into the room (as dashed on a plan: the
 *  polyline's segments 0–1 and 2–3) */
export function swingArcs(d: DoorDef, steps = 16): Vec2[][] {
  if (d.lift) { const [l] = doorLeaves(d, 0), r = liftReach(d), i = d.lift.into; return [[at(l.a, i, r), l.a, l.b, at(l.b, i, r)]]; }
  if (!d.hinge) { const s0 = doorLeaves(d, 0)[0], s1 = doorLeaves(d, 1)[0]; return s0 && s1 ? [[s0.a, s1.b]] : []; }
  const path = (k: number) => Array.from({ length: steps + 1 }, (_, i) => doorLeaves(d, i / steps)[k].b);
  return d.type === 'hinged-double' ? [path(0), path(1)] : [path(0)];
}

/** the quarter discs the leaves sweep on the floor: hinge, closed and open directions, radius (a bifold's first panel covers
 *  the floor its pair folds over) */
export interface LeafSector { hinge: Vec2; closedDir: Vec2; openDir: Vec2; radius: number }
export function leafSectors(d: DoorDef): LeafSector[] {
  if (!d.hinge || !d.closedDir || !d.openDir) return [];
  const w = leafWidthOf(d);
  if (d.type === 'hinged-double') return [{ hinge: d.hinge, closedDir: d.closedDir, openDir: d.openDir, radius: w }, { hinge: at(d.hinge, d.closedDir, d.leafWidth), closedDir: [-d.closedDir[0], -d.closedDir[1]], openDir: d.openDir, radius: w }];
  return [{ hinge: d.hinge, closedDir: d.closedDir, openDir: d.openDir, radius: w }];
}
/** how far the open leaves reach into the room they open into, from the wall face [m] (0: sliding) */
export function swingDepth(d: DoorDef): number {
  if (!d.hinge || !d.openDir) return 0;
  const o = d.openDir, h = d.hinge;
  return Math.max(0, ...Array.from({ length: 9 }, (_, i) => doorLeaves(d, i / 8)).flat().flatMap((l) => [l.a, l.b]).map((p) => (p[0] - h[0]) * o[0] + (p[1] - h[1]) * o[1]));
}

// ------------------------------------------------------------------ sectional (overhead) doors
/** a sectional door: panels of about this height, the bend of its tracks and how far above the leaf top they run [m] */
export const SECTIONAL = { panel: 0.5, radius: 0.3, rise: 0.1 } as const;
/** number of panels of a sectional door (0 for any other door) */
export const sectionCount = (d: DoorDef): number => (d.lift ? Math.max(2, Math.round(d.height / SECTIONAL.panel)) : 0);
/** height of the horizontal tracks above the floor (the open panels lie there) [m] */
export const liftLevel = (d: DoorDef): number => d.height + SECTIONAL.rise;
/** how far the centre of every panel travels along the tracks from closed to open: the bottom panel ends just past the bend */
const liftRun = (d: DoorDef) => liftLevel(d) - SECTIONAL.radius + (SECTIONAL.radius * Math.PI) / 2 + 0.06;
/**
 * panel k (0: the bottom one) of a sectional door at opening t: its centre's distance from the closed leaf plane into the room
 * the door lifts into (`depth`), its height above the floor (`z`) and its tilt (0: upright … π/2: flat under the ceiling, the top
 * edge leaning into the room). The panel centres run on the tracks: up the jambs, round a quarter bend, back under the ceiling.
 */
export function sectionPose(d: DoorDef, t: number, k: number): { depth: number; z: number; angle: number } {
  const n = sectionCount(d), h = d.height / Math.max(1, n), R = SECTIONAL.radius, level = liftLevel(d), qV = level - R, arc = (R * Math.PI) / 2;
  const q = (k + 0.5) * h + clamp01(t) * liftRun(d);
  if (q <= qV) return { depth: 0, z: q, angle: 0 };
  if (q <= qV + arc) { const a = (q - qV) / R; return { depth: R - R * Math.cos(a), z: qV + R * Math.sin(a), angle: a }; }
  return { depth: R + (q - qV - arc), z: level, angle: Math.PI / 2 };
}
/** how far a fully open sectional door reaches into the room, from the closed leaf plane [m] (0 for any other door) */
export function liftReach(d: DoorDef): number {
  const n = sectionCount(d);
  return n ? sectionPose(d, 1, n - 1).depth + d.height / n / 2 : 0;
}
