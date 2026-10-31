// Joints between the parts of the print: the parts stack like floors, and registration tabs keep them in place. On the top of
// the lower part's exterior walls — on the inner part of the wall, so the outer face stays one plane when stacked — tabs stand
// in squares around every corner of the outline (an L at a corner holds both directions) and at most every TAB_EVERY mm along
// the walls; the part above has a pocket for each tab, with a side clearance and a vertical gap (it rests on the walls, not on
// the tabs), a widened mouth over its first layers (the elephant's foot of the layers on the bed) and a chamfered tab top.
// A tab is made only where the part above has full material over and around its pocket. Fewer than three tabs, or tabs in one
// direction only, make no joint (reported: the walls or the slab are too thin at that scale).
import type { Vec2 } from '../package/types.ts';
import { snap } from '../solid/openings.ts';
import { prism } from '../solid/prism.ts';
import type { Keep } from '../solid/scope.ts';
import type { CrossSection, Geometry, Manifold } from '../solid/wasm.ts';
import type { PrintProfile } from './profiles.ts';

/** the joint's sizes on the print [mm] */
export const JOINT = {
  /** the tab from the outer face of the wall (the wall left over the pocket keeps a wall's thickness) */
  outer: 1.8,
  /** tab height, and the least that still holds */
  height: 1.6, minHeight: 0.8,
  /** the square a tab is cut from, and the longest stretch of wall without one */
  tab: 14, every: 45,
  /** chamfer of the tab top (per side) over its last layers */
  leadIn: 0.2, leadInHeight: 0.4,
  /** the pocket's bottom over the tab top */
  gap: 0.3,
  /** the pocket mouth widened (per side) over its first layers */
  mouth: 0.2, mouthHeight: 0.4,
} as const;

/** what was made at one interface */
export interface JointInfo {
  /** the part below and the part above */
  between: [string, string];
  /** the height of the interface in the building [m] */
  z: number;
  made: boolean;
  tabs: number;
  /** tab height and the clearance per side [mm] */
  heightMm: number;
  clearanceMm: number;
  /** why no joint was made */
  reason?: string;
}

const rect = (geo: Geometry, keep: Keep, x0: number, y0: number, x1: number, y1: number): CrossSection => keep(new geo.CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]));
const unionCs = (geo: Geometry, keep: Keep, list: CrossSection[]): CrossSection => (list.length ? keep(geo.CrossSection.union(list)) : keep(new geo.CrossSection([])));

/**
 * Tabs on the lower part and pockets in the upper one at height z (building metres). `footprint` — the outline loops of the
 * walls of the lower part's level, `wall` — the exterior wall thickness [m], k — mm on the print per metre.
 */
export function joinParts(geo: Geometry, keep: Keep, lower: Manifold, upper: Manifold, footprint: Vec2[][], wall: number, z: number, k: number, profile: PrintProfile, between: [string, string]):
  { lower: Manifold; upper: Manifold; info: JointInfo } {
  const m = 1 / k, c = profile.clearance, info: JointInfo = { between, z: snap(z), made: false, tabs: 0, heightMm: 0, clearanceMm: c };
  const fp = keep(new geo.CrossSection(footprint.map((l) => l.map((p) => [p[0], p[1]] as Vec2))));
  // the band the tabs may stand in: the exterior walls' inner part, where the lower part has material just under z
  const ring = keep(keep(fp.offset(-JOINT.outer * m, 'Miter', 2)).subtract(keep(fp.offset(-wall, 'Miter', 2))));
  let band = keep(ring.intersect(keep(lower.slice(z - 0.05 * m))));
  // over every pocket the part above must have material: the pocket with its clearance, mouth and a wall around it, up to the
  // pocket's top and a slab over it
  const h = JOINT.height, reach = (c + JOINT.mouth + profile.wall) * m, top = z + (h + JOINT.gap + profile.slab) * m;
  for (let zz = z + 0.1 * m; zz < top; zz += 0.2 * m) band = keep(band.intersect(keep(keep(upper.slice(zz)).offset(-reach, 'Miter', 2))));
  band = keep(band.intersect(keep(keep(upper.slice(top - 0.02 * m)).offset(-reach, 'Miter', 2))));
  // squares round the corners of the outline and along the walls
  const s = (JOINT.tab * m) / 2, squares: CrossSection[] = [];
  for (const loop of footprint) loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor((L * k) / JOINT.every);
    squares.push(rect(geo, keep, a[0] - s, a[1] - s, a[0] + s, a[1] + s));
    for (let j = 1; j <= n; j++) { const t = j / (n + 1), x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; squares.push(rect(geo, keep, x - s, y - s, x + s, y + s)); }
  });
  let tabs = keep(band.intersect(unionCs(geo, keep, squares)));
  // no piece narrower than a wall (an opening of the shape), none smaller than 4 mm²
  const w = profile.wall * m;
  tabs = keep(keep(keep(tabs.offset(-w / 2, 'Miter', 2)).offset(w / 2, 'Miter', 2)).intersect(band));
  const pieces = tabs.decompose().map((p) => keep(p)).filter((p) => p.area() * k * k >= 4);
  info.tabs = pieces.length;
  // directions: a piece longer one way lies on a wall that way; a corner L holds both
  const dirs = new Set<string>();
  for (const p of pieces) {
    const bb = p.bounds(), dx = bb.max[0] - bb.min[0], dy = bb.max[1] - bb.min[1];
    dirs.add(dx >= dy ? 'X' : 'Y');
    if (Math.min(dx, dy) * k > (2 * JOINT.tab) / 3) { dirs.add('X'); dirs.add('Y'); }
  }
  if (pieces.length < 3 || dirs.size < 2) {
    info.reason = `only ${pieces.length} tab(s) fit${dirs.size < 2 && pieces.length ? ' along one direction' : ''} — the exterior walls or the slab above are too thin at this scale`;
    return { lower, upper, info };
  }
  const tabsCs = unionCs(geo, keep, pieces);
  // the tab top chamfered only where the tab stays a wall wide
  const lead = tabsCs.offset(-JOINT.leadIn * m, 'Miter', 2).isEmpty() ? 0 : JOINT.leadIn, leadH = lead ? Math.min(JOINT.leadInHeight, h / 2) : 0;
  const lip = [prism(keep, tabsCs, snap(z - 0.1 * m), snap(z + (h - leadH) * m))];
  if (lead) lip.push(prism(keep, keep(tabsCs.offset(-lead * m, 'Miter', 2)), snap(z + (h - leadH) * m - 1e-5), snap(z + h * m)));
  // pockets closer than a wall to each other merge (no thin partition between them)
  const close = (cs: CrossSection) => keep(keep(cs.offset(w / 2, 'Miter', 2)).offset(-w / 2, 'Miter', 2));
  const pocket = keep(geo.Manifold.union([
    prism(keep, close(keep(tabsCs.offset(c * m, 'Miter', 2))), snap(z - 1 * m), snap(z + (h + JOINT.gap) * m)),
    prism(keep, close(keep(tabsCs.offset((c + JOINT.mouth) * m, 'Miter', 2))), snap(z - 1 * m), snap(z + JOINT.mouthHeight * m)),
  ]));
  const lo = keep(geo.Manifold.union([lower, ...lip])), up = keep(upper.subtract(pocket));
  // the fit: stacked, the tabs touch nothing of the part above
  if (keep(keep(geo.Manifold.union(lip)).intersect(up)).volume() > 1e-12) { info.reason = 'the tabs would collide with the part above'; return { lower, upper, info }; }
  return { lower: lo, upper: up, info: { ...info, made: true, heightMm: h } };
}
