// Eye-level viewpoints: a walk start at a named place — a person standing in the building or on the plot,
// eyes at eyeHeight above the floor / ground. The list comes from the project package (project().viewpoints).
// View direction: yaw [rad] — forward = (−sin yaw, cos yaw) in LCS (as in walk mode), pitch [rad] upwards.
// When opened, the point is "settled" in the walk model (WalkWorld.settle) — it avoids walls; furniture does not block.
import { project } from '../../project/active';
import type { LevelId, Vec2 } from './types';

export interface Viewpoint {
  id: string;
  /** name shown in the UI; `en` — optional working name (tests, scripts) */
  name: string;
  en?: string;
  p: Vec2;
  /** level / site: hint for the feet height when settling */
  level: LevelId | 'SITE';
  /** point the person looks at (LCS, height above the floor / ground) */
  look: [number, number, number];
  fov: number;
  hint: string;
}

/** view direction from point p to point look (yaw, pitch) with the eyes at height eye */
export function lookAngles(p: Vec2, look: [number, number, number], eye: number): { yaw: number; pitch: number } {
  const dx = look[0] - p[0], dy = look[1] - p[1];
  return { yaw: Math.atan2(-dx, dy), pitch: Math.atan2(look[2] - eye, Math.hypot(dx, dy)) };
}

const NONE: Viewpoint[] = [];
/** project viewpoints (empty list — the project defines none) */
export const viewpoints = (): Viewpoint[] => project().viewpoints ?? NONE;
export const viewpointById = (id: string | null | undefined) => viewpoints().find((v) => v.id === id) ?? null;
