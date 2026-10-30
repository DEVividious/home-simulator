// Print profiles (ADR 0031): the smallest features a printer makes reliably, in mm on the print. The printability adjustments
// thicken and widen the model's inputs to these sizes before the boolean; the checks after it measure against them.

export type ProfileId = 'fdm-0.4' | 'fdm-0.6' | 'resin';

export interface PrintProfile {
  id: ProfileId;
  label: string;
  /** a vertical wall (three or more extrusion lines) */
  wall: number;
  /** a horizontal slab, lintel or roof layer (five or more layers) */
  slab: number;
  /** a free-standing pier, post or chimney — its cross-section in every direction */
  pier: number;
  /** fit clearance per side; the parts stack on flat faces, nothing fits into anything (reported, not used) */
  clearance: number;
  /** the smallest opening that stays open */
  hole: number;
  /** the steepest overhang printed without supports, from the vertical [°] */
  overhang: number;
  /** the longest bridge printed without supports */
  bridge: number;
  /** the smallest step height (risers lower than this print as a ramp) */
  step: number;
}

export const PROFILES: Record<ProfileId, PrintProfile> = {
  'fdm-0.4': { id: 'fdm-0.4', label: 'FDM, 0.4 mm nozzle, 0.2 mm layers', wall: 1.2, slab: 1.0, pier: 2.0, clearance: 0.25, hole: 1.5, overhang: 45, bridge: 15, step: 0.5 },
  'fdm-0.6': { id: 'fdm-0.6', label: 'FDM, 0.6 mm nozzle, 0.3 mm layers', wall: 1.8, slab: 1.2, pier: 3.0, clearance: 0.3, hole: 2.0, overhang: 45, bridge: 15, step: 0.6 },
  resin: { id: 'resin', label: 'resin (MSLA), 0.05 mm layers', wall: 0.6, slab: 0.6, pier: 1.0, clearance: 0.15, hole: 0.8, overhang: 30, bridge: 5, step: 0.2 },
};

/** the profile of a nozzle option ("0.4", "0.6", "resin"), with an optional smallest wall [mm] (a pier is never thinner than a wall) */
export function profileOf(nozzle = '0.4', minWall?: number): PrintProfile {
  const id: ProfileId | undefined = nozzle === '0.4' || nozzle === 'fdm-0.4' ? 'fdm-0.4' : nozzle === '0.6' || nozzle === 'fdm-0.6' ? 'fdm-0.6' : nozzle === 'resin' ? 'resin' : undefined;
  if (!id) throw new Error(`unknown nozzle "${nozzle}" (0.4, 0.6 or resin)`);
  const p = PROFILES[id];
  if (minWall === undefined) return p;
  if (!(minWall > 0)) throw new Error(`--min-wall must be a positive number of mm, not ${minWall}`);
  return { ...p, wall: minWall, pier: Math.max(p.pier, minWall) };
}
