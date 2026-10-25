// RUNTIME SCENE — scene mode derived from the UI state (no state of its own): exterior view, level section ("dollhouse")
// or room (Room Mode: 3D / top / walk). The horizontal section hides everything above cutZ (roof, ceiling, upper level) —
// elements hiding the interior disappear automatically.
import { hasModule } from '../../project/active';
import { baseLevel, DEFAULT_CUT_HEIGHT, levelById, roomById } from '../model/rooms';
import type { LevelId, RoomView } from '../model/types';
import type { UiState } from '../store/ui';

/** section height above the level floor [m] — from the level data (Level.cutHeight): above the lintels, below the ceiling / slopes */
export const cutHeight = (level: LevelId) => levelById(level)?.cutHeight ?? DEFAULT_CUT_HEIGHT;
/** section in the top view (TOP VIEW) — as in architectural plans (about 1.2 m; below sloped attic ceilings) */
export const PLAN_CUT_HEIGHT = 1.2;

export interface SceneMode {
  /** walk — walk through the building and site */
  kind: 'exterior' | 'level' | 'room' | 'walk';
  level: LevelId;
  /** edited room: Room Mode — the room the user entered; a building walk started in a room — the room underfoot */
  roomId: string | null;
  roomView: RoomView;
  /** horizontal section (Z in LCS) or none */
  cutZ: number | null;
  /** surroundings (trees, neighbours) — only in the exterior view */
  environment: boolean;
}

export const levelFloor = (level: LevelId) => (levelById(level) ?? baseLevel()).floorZ;

export function sceneMode(s: Pick<UiState, 'houseView' | 'level' | 'roomId' | 'roomView' | 'environment'> & { /** building walk started in a room: the room underfoot */ walkRoomId?: string | null }): SceneMode {
  // surroundings belong to a project module: a project without it has no surroundings regardless of the device preference (shared by projects)
  const env = s.environment && hasModule('environment');
  // photo matching: the whole building without a section, surroundings per the toggle (photos from the site)
  const room = roomById(s.roomId);
  if (room) {
    const cut = s.roomView === 'walk' ? null : room.floorZ + (s.roomView === 'top' ? PLAN_CUT_HEIGHT : cutHeight(room.level));
    // walk: view through the windows — surroundings (trees, neighbours, road) as from outside
    return { kind: 'room', level: room.level, roomId: room.id, roomView: s.roomView, cutZ: cut, environment: s.roomView === 'walk' && env };
  }
  // building and site walk: no section, room ceilings visible (roomView 'walk'), surroundings through the windows and on the site;
  // the room underfoot (walk started in a room) — its walls, floor and ceiling can be pointed at as in a room walk
  if (s.houseView === 'walk') return { kind: 'walk', level: s.level, roomId: roomById(s.walkRoomId)?.id ?? null, roomView: 'walk', cutZ: null, environment: env };
  if (s.houseView === 'interior') return { kind: 'level', level: s.level, roomId: null, roomView: '3d', cutZ: levelFloor(s.level) + cutHeight(s.level), environment: false };
  return { kind: 'exterior', level: s.level, roomId: null, roomView: '3d', cutZ: null, environment: env };
}

export const sameMode = (a: SceneMode, b: SceneMode) =>
  a.kind === b.kind && a.level === b.level && a.roomId === b.roomId && a.roomView === b.roomView && a.cutZ === b.cutZ && a.environment === b.environment;

/**
 * Near plane of the orbit camera: 2% of the distance to the target, no less than the mode's base value, no more than 4 m.
 * The resolution of a 24-bit depth buffer at distance d is about d² / (near · 2²⁴); finishes lie 3 mm in front of the slab / wall.
 */
export const cameraNear = (distance: number, base: number) => Math.min(4, Math.max(base, distance * 0.02));
/** smallest depth difference a 24-bit buffer resolves at distance `distance` (m) */
export const depthResolution = (distance: number, near: number) => (distance * distance) / (near * 2 ** 24);
