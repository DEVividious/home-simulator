// Door leaves in plan — pure functions of one door record. Every door type is one or more leaves (panels), each a segment a → b
// (a: the hinge edge, or the start of a sliding leaf) at an opening amount t ∈ [0, 1]:
//   hinged-single  one leaf turning about `hinge` from `closedDir` towards `openDir` by openAngle · t;
//   hinged-double  two leaves of half the width, hinged at both jambs (the second at hinge + closedDir · leafWidth), turning
//                  into the same room;
//   folding        two panels of half the width (a bifold): the first turns about `hinge`, the second is hinged to its free edge
//                  and its far edge runs along the wall line back towards the hinge, so the pair folds into a V;
//   sliding, pocket one leaf moving along the wall by travel · t.
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
  if (d.slide) {
    const k = (d.opening.width - d.leafWidth) / 2 + d.slide.travel * clamp01(t), a = at(d.slide.origin, d.slide.dir, k);
    return [{ a, b: at(a, d.slide.dir, d.leafWidth), dir: d.slide.dir }];
  }
  return [];
}

/** swing arcs for a plan, as polylines: the path of each hinged leaf's free edge (a bifold: of the fold between its panels);
 *  sliding — the track of the leaf */
export function swingArcs(d: DoorDef, steps = 16): Vec2[][] {
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
