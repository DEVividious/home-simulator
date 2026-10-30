// Room ceiling profile: flat, or under the roof (ADR 0027) — the underside of the roof of the room's level (model/roof.ts), capped
// by the room's flat top (collar ties). Heights here are above the room floor. The profile also gives the ceiling's planar pieces
// (finishes, height lines on the plan), the points along a wall where it bends or steps (wall finishes need a vertex there) and
// its range. One function answers "how high is the ceiling here" for every consumer.
import { FLAT, surfaceAt, surfaceBreaks, surfaceFacets, type Facet, type RoofPiece, type Surface } from './roof.ts';
import type { Rect, Vec2 } from '../package/types.ts';

export interface CeilingProfile {
  kind: 'flat' | 'roof';
  /** the flat ceiling (absolute z): the whole ceiling, or the flat top of a ceiling under the roof */
  flatZ: number;
  /** ceiling height above the room floor at point (x, y) */
  heightAt: (x: number, y: number) => number;
  /** the ceiling as planar pieces over the room (absolute z), roof windows cut out */
  facets: () => Facet[];
  /** positions t along the segment a → b (0 < t < its length) where the ceiling bends or steps */
  breaksAlong: (a: Vec2, b: Vec2) => number[];
  /** lowest and highest ceiling height above the floor over the room */
  range: () => [number, number];
}

const memo = <T>(f: () => T): (() => T) => { let v: T | undefined; return () => (v ??= f()); };

export function flatCeiling(z: number, floorZ: number, polygon: Vec2[]): CeilingProfile {
  const h = z - floorZ;
  return { kind: 'flat', flatZ: z, heightAt: () => h, facets: () => [{ polygon, plane: FLAT(z) }], breaksAlong: () => [], range: () => [h, h] };
}

/**
 * The ceiling of a room under the roof pieces of its level, capped by the flat top `flatZ`; roof windows are holes in it. A room
 * the roof does not reach below the flat top gets a flat profile.
 */
export function roofCeiling(pieces: RoofPiece[], flatZ: number, floorZ: number, polygon: Vec2[], roofWindows: Rect[]): CeilingProfile {
  const s: Surface = { pieces, which: 'inner', cap: flatZ };
  const all = surfaceFacets(s, polygon);
  if (all.every((f) => f.plane.gx === 0 && f.plane.gy === 0 && Math.abs(f.plane.z0 - flatZ) < 1e-9)) return flatCeiling(flatZ, floorZ, polygon);
  const range = memo((): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    for (const f of all) for (const q of f.polygon) { const z = f.plane.z0 + f.plane.gx * q[0] + f.plane.gy * q[1]; lo = Math.min(lo, z); hi = Math.max(hi, z); }
    return [lo - floorZ, hi - floorZ];
  });
  return {
    kind: 'roof', flatZ,
    heightAt: (x, y) => (surfaceAt(s, x, y)?.z ?? flatZ) - floorZ,
    facets: memo(() => (roofWindows.length ? surfaceFacets(s, polygon, roofWindows) : all)),
    breaksAlong: (a, b) => surfaceBreaks(s, a, b),
    range,
  };
}
