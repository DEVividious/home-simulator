// The numbers of a building must be plain metres near the project origin: every number of the building block and the site is
// finite and within COORD_LIMIT of 0. A coordinate of 1e30 passes the structural schema but stops the solid kernel and breaks
// the camera framing; the compiler (plan.range), the package validation and the print CLI report it with a readable path.
import type { BuildingData } from '../model/building.ts';
import type { ProjectPackage } from './types.ts';

/** the largest coordinate or size a building may have [m] — 10 km from the project origin */
export const COORD_LIMIT = 10_000;

/** a path step: an array element with an `id` is named by it (rooms[K1]), otherwise by its index */
const step = (parent: unknown, k: string) => {
  if (!Array.isArray(parent)) return `.${k}`;
  const id = (parent[Number(k)] as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? `[${id}]` : `[${k}]`;
};

/** numbers out of range in the building block and the site: "building.rooms.rooms[K1].polygon[1][0] = 1e+30" (at most `max`) */
export function outOfRange(p: { building: BuildingData; site?: ProjectPackage['site'] }, max = 10): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (out.length >= max) return;
    if (typeof v === 'number') { if (!Number.isFinite(v) || Math.abs(v) > COORD_LIMIT) out.push(`${path} = ${v}`); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}${step(v, k)}`);
  };
  walk(p.building, 'building');
  if (p.site) walk(p.site, 'site');
  return out;
}

/** the message for numbers out of range */
export const rangeMessage = (found: string[]): string =>
  `coordinates and sizes must be finite and within ${COORD_LIMIT / 1000} km of the project origin (metres): ${found.join('; ')}`;
