// Building blocks of the shell solids: prisms with exact heights, plan regions as cross-sections, solids trimmed below roof
// planes, and the space under a roof — the region where the walls of a level rise to the roof and the rooms open into it. They
// take the loaded kernel (or objects made with it) as arguments; every object they make is kept in the caller's scope.
import { inRegion, raise, regionPolygon, type Plane, type Region, type RoofPiece } from '../model/roof.ts';
import type { Rect, Vec2 } from '../package/types.ts';
import { PROUD, snap } from './openings.ts';
import type { Keep } from './scope.ts';
import type { CrossSection, Geometry, Manifold } from './wasm.ts';

const snap2 = (p: Vec2): Vec2 => [snap(p[0]), snap(p[1])];
/** prism of a cross-section between two heights — the heights are set exactly, not by adding a translation */
export const prism = (keep: Keep, cs: CrossSection, z0: number, z1: number): Manifold => keep(keep(cs.extrude(1)).warp((v) => { v[2] = v[2] > 0.5 ? z1 : z0; }));
export const rectSection = (geo: Geometry, keep: Keep, [x0, y0, x1, y1]: readonly number[]): CrossSection => keep(new geo.CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]));
export const regionSection = (geo: Geometry, keep: Keep, r: Region): CrossSection => keep(new geo.CrossSection([regionPolygon(r).map(snap2)]));

/** the part of a solid below every plane (each raised by `lift` across itself) */
export function belowPlanes(keep: Keep, m: Manifold, planes: Plane[], lift = 0): Manifold {
  for (const p of planes) {
    const q = raise(p, lift), l = Math.hypot(q.gx, q.gy, 1);
    m = keep(m.trimByPlane([q.gx / l, q.gy / l, -1 / l], -q.z0 / l));          // keeps z ≤ z0 + gx·x + gy·y
  }
  return m;
}

/**
 * A piece's region grown by PROUD on every side whose outside is not wholly inside another piece: the space under a wing and the
 * wing's mass stand on the same rectangle, and their equal sides must not reach the boolean together (a free side keeps a
 * zero-thickness sheet of the mass). A side inside another piece is absorbed by the unions and stays.
 */
export function grownRegion(geo: Geometry, keep: Keep, p: RoofPiece, all: RoofPiece[], which: 'region' | 'inner'): CrossSection {
  const r = p[which];
  if (typeof r[0] !== 'number') return keep(regionSection(geo, keep, r).offset(PROUD, 'Miter', 2));
  const [x0, y0, x1, y1] = r as Rect, others = all.filter((q) => q !== p), e = 1e-3;
  const covered = (a: Vec2, b: Vec2, out: Vec2) => [0.02, 0.25, 0.5, 0.75, 0.98].every((t) => {
    const x = a[0] + (b[0] - a[0]) * t + out[0] * e, y = a[1] + (b[1] - a[1]) * t + out[1] * e;
    return others.some((q) => inRegion(q[which], x, y));
  });
  return rectSection(geo, keep, [
    snap(covered([x0, y0], [x0, y1], [-1, 0]) ? x0 : x0 - PROUD), snap(covered([x0, y0], [x1, y0], [0, -1]) ? y0 : y0 - PROUD),
    snap(covered([x1, y0], [x1, y1], [1, 0]) ? x1 : x1 + PROUD), snap(covered([x0, y1], [x1, y1], [0, 1]) ? y1 : y1 + PROUD),
  ]);
}

/**
 * The space under the roof pieces of a level between two heights: every piece's region (grown on its free sides) below its
 * planes raised by `lift`, unioned. `region` — where the walls rise to the roof; `inner` — where the rooms open into it.
 */
export function roofSpace(geo: Geometry, keep: Keep, pieces: RoofPiece[], which: 'region' | 'inner', lift: number, z0: number, z1: number): Manifold {
  return keep(geo.Manifold.union(pieces.map((p) => belowPlanes(keep, prism(keep, grownRegion(geo, keep, p, pieces, which), z0, z1), p.planes, lift))));
}
