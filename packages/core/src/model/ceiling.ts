// Room ceiling profile: flat, or sloped (attic) with a flat top — from the room record of the package. Heights here are
// above the room floor; `heightBreaks` lists where a sloped profile bends (edges of the flat top, the ridge), which is where
// wall finishes and wall outlines need a vertex.
import type { CeilingJson } from '../package/types.ts';

export interface CeilingProfile {
  kind: 'flat' | 'attic';
  /** ceiling height above the room floor at point (x, y) */
  heightAt: (x: number, y: number) => number;
  /** sloped-ceiling parameters (absolute z): flat top, ridge, slope; the ridge runs along X (ridgeY) or along Y (ridgeX) */
  flatZ?: number;
  ridgeY?: number;
  ridgeX?: number;
  zAtRidge?: number;
  slope?: number;
}

export function ceilingOf(c: CeilingJson, floorZ: number): CeilingProfile {
  if (c.kind === 'flat') { const z = c.z!; return { kind: 'flat', heightAt: () => z - floorZ }; }
  const flat = c.flat_z!, zr = c.z_at_ridge!, k = c.slope!;
  if (c.ridge_x !== undefined) { const rx = c.ridge_x; return { kind: 'attic', flatZ: flat, ridgeX: rx, zAtRidge: zr, slope: k, heightAt: (x) => Math.min(flat, zr - k * Math.abs(x - rx)) - floorZ }; }
  const ry = c.ridge_y!;
  return { kind: 'attic', flatZ: flat, ridgeY: ry, zAtRidge: zr, slope: k, heightAt: (_x, y) => Math.min(flat, zr - k * Math.abs(y - ry)) - floorZ };
}

/** where a sloped ceiling profile breaks (edges of the flat ceiling, ridge): coordinates on axis 1 (y, ridge along X) or 0 (x) */
export function heightBreaks(room: { ceiling: CeilingProfile }): { axis: 0 | 1; at: number[] } {
  const c = room.ceiling;
  if (c.kind !== 'attic') return { axis: 1, at: [] };
  const d = (c.zAtRidge! - c.flatZ!) / c.slope!, axis = c.ridgeX !== undefined ? 0 : 1, r = axis === 0 ? c.ridgeX! : c.ridgeY!;
  return { axis, at: [r - d, r, r + d] };
}
