// Home configurator — types of the user's design state (USER DESIGN STATE).
// Everything in metres, in the building LCS (project X / Y axes, Z up; ±0.00 = finished floor of the base level).
// The state is part of ConfiguratorDoc (v6): Variant.interiors + document-level bookmarks / importedAssets — a single source of truth.
import type { Dims, FurniturePlacement, Vec2, Vec3 } from '@home-sim/core/package/types';
// package-contract types shared with the core (ADR 0023)
export type { Dims, FurniturePlacement, LevelId, Vec2, Vec3, WallMount } from '@home-sim/core/package/types';

/** layout parameters of a repeating material (tiles, boards, panels) — override the catalog values */
export interface FinishLayout {
  /** tile / panel size [m] */
  size?: [number, number];
  /** grout [m] */
  grout?: number;
  /** pattern rotation [°] (board direction: 0 = along the building X axis) */
  rotation?: number;
  /** pattern offset [m] */
  offset?: [number, number];
  /** boards / panels: board width and length [m] */
  boardWidth?: number;
  boardLength?: number;
  /** board pattern: straight, 1/2 offset, 1/3 offset, random */
  pattern?: 'straight' | 'half' | 'third' | 'random';
}

/** finish assignment: catalog material (+ colour for paints, + layout for repeating materials) */
export interface FinishRef {
  materialId: string;
  color?: string | null;
  layout?: FinishLayout | null;
}

export interface RoomFinishes {
  /** finish of individual walls (wall id from rooms: `${roomId}-w${i}`); no entry = default */
  walls: Record<string, FinishRef>;
  floor: FinishRef | null;
  ceiling: FinishRef | null;
}


export type ScenarioPreset = 'office' | 'guest' | 'hybrid';

export interface Arrangement {
  id: string;
  name: string;
  furniture: FurniturePlacement[];
  finishes: RoomFinishes;
  /** scenario the arrangement was created from (preset) — informative */
  scenario?: ScenarioPreset | null;
  /** saved by the user (name given deliberately) */
  saved?: boolean;
}

export interface RoomInterior {
  activeArrangementId: string;
  arrangements: Arrangement[];
}

export type RoomView = '3d' | 'top' | 'walk';

export interface CameraBookmark {
  id: string;
  name: string;
  /** camera position and target point in LCS */
  position: Vec3;
  target: Vec3;
  fov: number;
  roomId?: string | null;
  view?: RoomView | null;
}

/** furniture model imported by the user (GLB / glTF) — metadata after normalization (file in assets/furniture/imported/) */
export interface ImportedAsset {
  id: string;
  name: string;
  file: string;
  bytes: number;
  triangles: number;
  /** dimensions after normalization [m] */
  dims: Dims;
  /** scale applied to the file (file units → metres) */
  scale: number;
  /** pivot offset (in file coordinates after scaling): outline centre at (0, 0), bottom at z = 0 */
  offset: Vec3;
  /** plan outline (convex) in item coordinates [m] */
  footprint: Vec2[];
  /** rotation about the vertical axis [°] — turns the model front from the file to the item front */
  rotation?: number;
  /** thumbnail (PNG saved next to the model) */
  thumbnail?: string | null;
  category: string;
  warnings: string[];
  createdAt: string;
}
