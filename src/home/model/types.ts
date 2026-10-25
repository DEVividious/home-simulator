// Home configurator — types of the user's design state (USER DESIGN STATE).
// Everything in metres, in the building LCS (project X / Y axes, Z up; ±0.00 = finished floor of the base level).
// The state is part of ConfiguratorDoc (v6): Variant.interiors + document-level bookmarks / importedAssets — a single source of truth.
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** level id — from the project data (project().building.rooms.levels) */
export type LevelId = string;

/** item dimensions: w — width (local x axis), d — depth (local y axis, back → front), h — height */
export interface Dims { w: number; d: number; h: number }

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

/**
 * Mount record of a wall object (TV, mirror, shelf, wall lamp, wall cabinet): the room wall from the project data,
 * the distance of the object axis from the start of that wall and the bottom height above the finished floor. The source of truth
 * for a wall object's position — the world position (x, y, rot, elevation) is computed from it.
 */
export interface WallMount { wallId: string; u: number; height: number }

/** item in a room: (x, y) — outline centre in LCS, rot — rotation about Z [°, counter-clockwise];
 *  rot = 0: item front (local +y) faces building +Y, back (local −y) towards −Y */
export interface FurniturePlacement {
  id: string;
  catalogId: string;
  variant?: string | null;
  x: number;
  y: number;
  rot: number;
  /** bottom height above the room floor (default 0) */
  elevation?: number;
  /** overridden dimensions (parametric items; within catalog limits) */
  dims?: Partial<Dims> | null;
  /** main part material (overrides the catalog defaultMaterial) */
  materialId?: string | null;
  /** materials of additional parts (e.g. { top: 'quartz-white' } — worktop) */
  slots?: Record<string, string> | null;
  /** wall object: mount record (x, y, rot, elevation are then values computed by the mounting engine) */
  mount?: WallMount | null;
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
