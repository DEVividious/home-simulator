// Levels and rooms of the project — the core's derived building (packages/core/src/model/building.ts) for the active project:
// room walls (outline edges) with openings (doors, passages, windows, irregular glazing), the ceiling profile (flat, or sloped
// with a flat top), point membership. The number of levels and rooms comes from the data only. Translated wall labels are
// added here — the core holds no UI text.
import { levelAtZ as coreLevelAtZ, roomAt as coreRoomAt, type Level, type Room, type RoomWall } from '@home-sim/core/model/building';
import { fmtM, t } from '../../i18n';
import { building } from './building';
import type { LevelId, Vec2 } from './types';

export type { RoomJson, RoomKind } from '@home-sim/core/package/types';
export type { CeilingProfile } from '@home-sim/core/model/ceiling';
export { DEFAULT_CUT_HEIGHT, DEFAULT_DOOR_HEIGHT, DEFAULT_PLAN_WALL_OFFSET, nearestWall, type HoleKind, type Level, type RoomWall, type WallHole } from '@home-sim/core/model/building';
export type HomeRoom = Room;

/** user-facing description of a wall: "Wall 2 · 3.63 m · window" */
export function wallLabel(w: RoomWall): string {
  const tags = [...new Set(w.holes.map((h) => (h.kind === 'door' ? t('rooms.hole.door') : h.kind === 'passage' ? t('rooms.hole.passage') : t('rooms.hole.window'))))];
  return `${t('rooms.wallLabel', { index: w.index, length: fmtM(w.length) })}${tags.length ? ' · ' + tags.join(', ') : ''}`;
}

/** project levels from the lowest */
export const allLevels = (): Level[] => building().levels;
export const levelById = (id: LevelId | null | undefined): Level | null => (id ? building().levelById.get(id) ?? null : null);
export const levelName = (id: LevelId): string => building().levelById.get(id)?.name ?? id;
/** lowest level (navigation start, ground level) */
export const baseLevel = (): Level => building().levels[0];
/** level index in order from the lowest (−1: unknown) */
export const levelIndex = (id: LevelId): number => building().levels.findIndex((l) => l.id === id);
/** all rooms of the project */
export const allRooms = (): HomeRoom[] => building().rooms;
export const roomById = (id: string | null | undefined): HomeRoom | null => (id ? building().roomById.get(id) ?? null : null);
export const roomsOfLevel = (level: LevelId): HomeRoom[] => building().roomsByLevel.get(level) ?? [];
export const wallById = (room: HomeRoom, wallId: string) => room.walls.find((w) => w.id === wallId) ?? null;
/** rooms with a tag (e.g. "garage") */
export const roomsWithTag = (tag: string): HomeRoom[] => building().rooms.filter((r) => r.tags.includes(tag));

/** room containing point (x, y) on the given level */
export const roomAt = (level: LevelId, p: Vec2): HomeRoom | null => coreRoomAt(building(), level, p);

/** level from height z (LCS): the highest one whose floor lies below the midpoint to the next level */
export const levelAtZ = (z: number): LevelId => coreLevelAtZ(building(), z);
