// Eye-level viewpoints: a walk start at a named place — a person standing in the building or on the plot,
// eyes at eyeHeight above the floor / ground. The list comes from the project package (project().viewpoints).
// View direction: yaw [rad] — forward = (−sin yaw, cos yaw) in LCS (as in walk mode), pitch [rad] upwards.
// When opened, the point is "settled" in the walk model (WalkWorld.settle) — it avoids walls; furniture does not block.
import { project } from '../../project/active';
import { allDoors, doorCenter } from './doors';
import { roomById } from './rooms';
import type { Vec2 } from './types';
import type { Viewpoint } from '@home-sim/core/package/types';
export type { Viewpoint } from '@home-sim/core/package/types';

/** view direction from point p to point look (yaw, pitch) with the eyes at height eye */
export function lookAngles(p: Vec2, look: [number, number, number], eye: number): { yaw: number; pitch: number } {
  const dx = look[0] - p[0], dy = look[1] - p[1];
  return { yaw: Math.atan2(-dx, dy), pitch: Math.atan2(look[2] - eye, Math.hypot(dx, dy)) };
}

const NONE: Viewpoint[] = [];
/** project viewpoints (empty list — the project defines none) */
export const viewpoints = (): Viewpoint[] => project().viewpoints ?? NONE;
export const viewpointById = (id: string | null | undefined) => viewpoints().find((v) => v.id === id) ?? null;

/**
 * The default walk start: just inside the entrance door, facing into the home — starting outside a closed front door, people
 * did not know where they were (usability issue B6). The entrance: a door to the outside on the lowest floor, from a hall
 * when there is one. null — no door to the outside (the first viewpoint is used).
 */
export function entranceStart(): { p: Vec2; z: number; yaw: number } | null {
  const doors = allDoors().map((d) => ({ d, room: roomById(d.rooms.find((r) => r !== 'exterior')) })).filter((x) => x.d.rooms.includes('exterior') && x.room);
  doors.sort((a, b) => a.room!.floorZ - b.room!.floorZ || Number(b.room!.kind === 'hall') - Number(a.room!.kind === 'hall'));
  const e = doors[0];
  if (!e) return null;
  const c = doorCenter(e.d), ax = e.d.opening.along === 'X' ? 1 : 0, r = e.room!;   // ax: the axis across the wall
  const mid = (r.bbox[ax] + r.bbox[ax + 2]) / 2, s = Math.sign(mid - c[ax]) || 1;
  const face = s > 0 ? Math.max(...e.d.opening.faces) : Math.min(...e.d.opening.faces);
  const p: Vec2 = [c[0], c[1]];
  p[ax] = face + s * 0.9;
  const n: Vec2 = ax === 0 ? [s, 0] : [0, s];
  return { p, z: r.floorZ, yaw: Math.atan2(-n[0], n[1]) };
}
