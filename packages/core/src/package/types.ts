// PROJECT PACKAGE CONTRACT — the facts of one building in the shape the engine loads (projects/<id>/project.json).
// Pure types: no engine module is imported here, so the core (packages/core), the app (src/) and the tools share one definition.
// The structure is validated by the zod schema in ./schema; the app's semantic checks live in src/project/validate.ts.
// Field reference: docs/PROJECT_PACKAGE_SPEC.md. Coordinates: metres, +Z up (ADR 0008).

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** level id — from the project data (building.rooms.levels) */
export type LevelId = string;

/** item dimensions: w — width (local x axis), d — depth (local y axis, back → front), h — height */
export interface Dims { w: number; d: number; h: number }

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

// ------------------------------------------------------------------ rooms
export interface DoorJson { along: 'X' | 'Y'; from_: number; to: number; across: number[]; width: number; door_id: string | null; leaf: number | null; height: number | null }
export interface OpeningJson { id: string; kind: string; plane_axis: 'X' | 'Y'; inner: number; from_: number; to: number; sill_z?: number; head_z?: number; polygon_YZ?: number[][] }
/** flat: at height z. roof: under the roof of the room's level (building.roof) — the underside of the roof structure, capped by
 *  the flat top flat_z (collar ties). attic (written before the roof existed): the ridge runs along X at y = ridge_y, or along Y at
 *  x = ridge_x; the ceiling falls by `slope` per metre away from it, capped by flat_z — a gable roof is derived from it at load */
export interface CeilingJson { kind: 'flat' | 'attic' | 'roof'; z?: number; flat_z?: number; ridge_y?: number; ridge_x?: number; z_at_ridge?: number; slope?: number }
/** room kind: default finishes, icons, plan colours — from the project data (field `kind`), never from the name */
/** a text in other languages: ISO 639-1 language code → text (next to the text in the package's own language) */
export type Names = Record<string, string>;

export type RoomKind = 'bath' | 'kitchen' | 'garage' | 'tech' | 'hall' | 'bed' | 'living' | 'office' | 'storage' | 'room';
/** room record in the package data */
export interface RoomJson {
  id: string; name: string; level: LevelId; floor_z: number; area: number; area_data: number; id_source: string; bbox: number[]; polygon: number[][];
  rectangular: boolean; ceiling: CeilingJson; stair_opening: number[] | null; doors: DoorJson[]; openings: OpeningJson[]; roof_windows: { id: string; plan_rect: number[] }[];
  /** display name (default: `name`) */
  label?: string;
  /** the display name in other languages (language code → name); `name` / `label` are in the package's language */
  names?: Names;
  kind?: RoomKind;
  /** tags that drive engine behaviour (e.g. "garage" — vehicle fitting, "kitchen" — kitchen units) */
  tags?: string[];
}

// ------------------------------------------------------------------ doors
/** hinged-double: two leaves hinged at both jambs; folding: two panels folding to the hinge jamb (a bifold) — `leafWidth` is all the
 *  leaves together, `hinge` / `closedDir` belong to the first leaf (packages/core/src/model/doors.ts) */
export type DoorType = 'hinged-single' | 'hinged-double' | 'folding' | 'sliding' | 'pocket';

export interface DoorDef {
  id: string;
  level: LevelId;
  /** rooms on both sides (the second: a room id or 'exterior') */
  rooms: [string, string];
  floorZ: number;
  /** wall opening: wall axis, range along the axis, wall faces (cross coordinate), clear width and height of the masonry opening */
  opening: { along: 'X' | 'Y'; from: number; to: number; faces: number[]; width: number; height: number };
  /** leaf width [m] — of all the leaves together (a double door, a bifold) */
  leafWidth: number;
  /** leaf height [m] */
  height: number;
  type: DoorType;
  /** hinge axis in plan (LCS) — hinged leaves */
  hinge: Vec2 | null;
  /** direction of the closed leaf (from hinge to lock) and of the leaf opened by 90° — unit vectors */
  closedDir: Vec2 | null;
  openDir: Vec2 | null;
  /** hinge side as seen from the room the door opens into */
  hingeSide: 'left' | 'right' | null;
  /** room the leaf opens into */
  swingInto: string | null;
  /** full opening angle [°] */
  openAngle: number | null;
  /** sliding leaf: opening start on the wall axis, sliding direction, travel [m] */
  slide: { origin: Vec2; dir: Vec2; travel: number } | null;
  source: string[];
  confidence: 'confirmed' | 'probable' | 'unknown';
  notes?: string;
  /** door flush with the wall (concealed frame, leaf face in the wall face on the opening side) */
  flush?: boolean;
}

// ------------------------------------------------------------------ stairs
/** stair kinds: one straight flight; two flights at a right angle with a landing in the corner (`l-turn`); two flights side
 *  by side with a landing across both (`u-turn`) */
export type StairKind = 'straight' | 'l-turn' | 'u-turn';
interface StairCommon {
  id: string;
  /** level the stairs start from and the level they lead to */
  fromLevel: LevelId; toLevel: LevelId;
  /** plan outline [x0, y0, x1, y1] — the bounding box of the flights and landings (an L stair does not fill its corner) */
  bbox: [number, number, number, number];
  /** risers of the (lower) flight: straight — all of them; l-turn — the lower flight; u-turn — each flight; riser height,
   *  tread depth [m] */
  risers: number; riser: number; tread: number;
  flightWidth: number;
  /** upper level height relative to the lower level floor [m] */
  topZ: number;
  /** length in plan of the (lower) flight: (risers − 1) treads [m] */
  run: number;
  confidence: string;
  /** note from the project sources shown with the stairs (e.g. railing height from the plan) */
  note?: string;
  /** canonical frame → plan: mirror across the flights first (turning left instead of right), then turn counter-clockwise;
   *  absent = as canonical (walking up the lower flight towards −Y) */
  orient?: StairOrient;
}
/** one flight up the canonical −Y, entry at the larger-Y side; a box longer than the flight leaves a top landing at the
 *  upper floor height */
export interface StraightStairDef extends StairCommon { kind: 'straight' }
/** lower flight up the canonical −Y on the larger-X side, a landing in the (larger-X, smaller-Y) corner, upper flight towards
 *  −X along the smaller-Y side — turning right */
export interface LTurnStairDef extends StairCommon {
  kind: 'l-turn';
  /** risers of the upper flight and its length in plan [m] */
  upperRisers: number; upperRun: number;
  /** landing height relative to the lower level floor [m] */
  landingZ: number;
}
/** lower flight on the larger-X side up the canonical −Y, the landing at the smaller-Y edge, upper flight on the smaller-X side
 *  back towards +Y — turning right */
export interface UTurnStairDef extends StairCommon {
  kind: 'u-turn';
  /** gap between the flights [m] */
  gap: number;
  /** landing height relative to the lower level floor [m] */
  landingZ: number;
  /** flight split line (canonical X) and landing edge (canonical Y) */
  split: number; landingEdge: number;
}
export type StairDef = StraightStairDef | LTurnStairDef | UTurnStairDef;
export interface StairOrient { rotate: 0 | 90 | 180 | 270; mirror: boolean }

// ------------------------------------------------------------------ generated shell
/** generated shell parameters [m] */
export interface ShellSpec {
  /** exterior wall thickness */
  exteriorWall: number;
  /** floor and roof slab thickness */
  slab: number;
}

// ------------------------------------------------------------------ roof
/** a roof plane: the points p with n·p = d (n a unit vector pointing up, n[2] > 0); "below the plane" is n·p ≤ d */
export interface RoofPlaneJson { n: Vec3; d: number }
export type RoofPartType = 'gable' | 'hip' | 'shed' | 'flat';
export type Rect = [number, number, number, number];

/** a roof part ("wing"): the roof over a rectangle of a level's walls (a flat part may cover a polygon) */
export interface RoofPartJson {
  id: string;
  /** the level the part covers — the ceilings of its rooms come from the part's planes */
  level: LevelId;
  type: RoofPartType;
  /** the outer faces of the walls under the part [x0, y0, x1, y1] — or, for a flat part, a polygon */
  rect?: Rect;
  polygon?: Vec2[];
  /** plan extent of the roof: the outline grown by the eaves and verges, plus the strips that run into the wing this one joins */
  extent: Rect[];
  /** flat part over a polygon: its extent as a polygon (instead of `extent`) */
  extentPolygon?: Vec2[];
  /** underside of the roof structure (the ceiling of the rooms below): the roof lies above every plane of the part */
  planes: RoofPlaneJson[];
  /** parapet height above the top of the covering (flat part) [m] */
  parapet?: number;
  /** authoring facts kept for reference: ridge axis, pitch [°] */
  ridge?: 'X' | 'Y';
  pitch?: number;
}

/** a dormer: a small wing on a roof plane — walls (cheeks, front) standing on the roof, its own gable or shed roof */
export interface DormerJson {
  id: string;
  /** the roof part it stands on */
  part: string;
  type: 'gable' | 'shed';
  /** the side its front faces (downhill on the part's plane) */
  front: 'N' | 'S' | 'E' | 'W';
  /** outer faces of its walls [x0, y0, x1, y1]; the back runs into the roof */
  rect: Rect;
  /** the room space it adds (inside its walls) */
  inner: Rect;
  /** plan extent of its roof (the rect grown by the verge at the cheeks and the front) */
  extent: Rect;
  /** underside of its roof */
  planes: RoofPlaneJson[];
  /** the window of a front set back from the wall (a front in the plane of a wall holds an ordinary room window instead) */
  window?: { id: string; roomId: string; width: number; sill_z: number; head_z: number };
}

/** a chimney: a box from `bottom` (the slab underside of the lowest level it stands in) to `top` (absolute) */
export interface ChimneyJson { id: string; rect: Rect; bottom: number; top: number }

export interface RoofJson {
  /** thickness of the covering (tiles, sheet) and of the structure under it (rafters, insulation, lining), across the planes [m] */
  covering: number;
  buildup: number;
  parts: RoofPartJson[];
  dormers?: DormerJson[];
  chimneys?: ChimneyJson[];
  source?: string;
  confidence?: 'confirmed' | 'probable' | 'unknown';
}

// ------------------------------------------------------------------ interiors, sun, views
/** furniture item from the project sources (default arrangement) */
export interface ArchitectItem {
  key: string; room: string; catalogId: string; variant: string | null; x: number; y: number; rot: number;
  dims?: Partial<Dims>; fit?: 'ceiling' | 'hood'; elevation?: number; source: string;
  /** front material when given by the sources (otherwise the item's default material) */
  materialId?: string;
  /** dimensioned — dimension annotated on the plan; drawn — outline from the plan vectors; approximate — position from the plan, dimension assumed */
  basis: 'dimensioned' | 'drawn' | 'approximate'; note: string; group?: string;
}

/** project position and orientation — sun simulation input (project module `sun`) */
export interface SunSite {
  lat: number; lon: number;
  /** azimuth of the project's +X axis from grid north and the meridian convergence [°] */
  gridAzimuthX: number; convergence: number;
  /** geographic azimuth of the +X axis = grid + convergence */
  trueAzimuthX: number;
  /** orientation confidence; 'confirmed' removes the "approximate north" badge */
  confidence: string;
  /** estimated uncertainty of north [°] */
  uncertaintyDeg: number;
  /** IANA time zone, e.g. "Europe/Berlin", "America/New_York" */
  timeZone: string;
  /** place name shown in the sun panel */
  placeName?: string;
}

/** explicit camera pose in project coordinates */
export interface CameraViewPose { position: Vec3; target: Vec3; fov: number }

export interface ViewPreset {
  id: string;
  label: string;
  icon: string;
  hint: string;
  /** label and hint in other languages (language code → text) */
  labels?: Names;
  hints?: Names;
  /** direction from the building centre to the camera (project coordinates) — the whole building in frame */
  dir?: Vec3;
  /** explicit camera pose; used when `dir` is absent */
  pose?: CameraViewPose;
  /** framing distance multiplier (default 1.02) */
  fit?: number;
}

/** project views: list, start view */
export interface ProjectViews { presets: ViewPreset[]; home?: string }

export interface Viewpoint {
  id: string;
  /** name shown in the UI; `en` — optional working name (tests, scripts) */
  name: string;
  en?: string;
  /** name and hint in other languages (language code → text) */
  names?: Names;
  hints?: Names;
  p: Vec2;
  /** level / site: hint for the feet height when settling */
  level: LevelId | 'SITE';
  /** point the person looks at (LCS, height above the floor / ground) */
  look: [number, number, number];
  fov: number;
  hint: string;
}

// ------------------------------------------------------------------ package
/** optional engine modules that only make sense for some buildings — a project enables them in its manifest and supplies their data */
export type ProjectModule =
  | 'site'         // plot: terrain (GLB or flat), boundary, walking outside
  | 'environment'  // surroundings model (GLB): trees, neighbours, road
  | 'sun'          // sun simulation (needs geographic position, orientation and time zone)
  | 'stairs';      // stairs between levels (walk, finishes)

export const PROJECT_MODULES: readonly ProjectModule[] = ['site', 'environment', 'sun', 'stairs'];

/** core engine capabilities the project uses — they drive UI sections and actions */
export type ProjectCapability =
  | 'interiors'   // furnishing rooms: arrangements, furniture, materials
  | 'electrical'  // electrical / smart-home plan
  | 'variants'    // design variants and comparison
  | 'walk';       // eye-level walk-through

export const PROJECT_CAPABILITIES: readonly ProjectCapability[] = ['interiors', 'electrical', 'variants', 'walk'];

export interface ProjectLevel { id: string; name: string; floorZ: number; /** the name in other languages */ names?: Names }

export interface ProjectManifest {
  projectId: string;
  /** display name (app title, PDF, exports) */
  name: string;
  /** the name in other languages (language code → name) */
  names?: Names;
  /** one line under the name (e.g. an address) */
  description?: string;
  /** title on documents (PDF, exports); defaults to `name` */
  documentTitle?: string;
  /** the language of the package's names, and the UI language the project prefers ('en', 'pl'); the viewer's choice wins.
   *  Names in other languages: the optional `names` next to each name (manifest, levels, rooms, viewpoints, views) */
  language?: string;
  units: 'm';
  coordinateSystem: { name: string; description: string; up: 'Z'; handedness: 'right' };
  buildingType: 'house' | 'apartment';
  /** levels from the lowest — must match building.rooms.levels (checked by validateProject) */
  levels: ProjectLevel[];
  /** where each data set of the package comes from (human-readable) */
  dataSources: Record<string, string>;
  modules: ProjectModule[];
  capabilities: ProjectCapability[];
  /** app start: level, optional room; `view` — exterior (default) or a section through the level */
  defaultView: { levelId: string; roomId?: string | null; view?: 'exterior' | 'interior' };
  /** what "Restore project defaults" brings back (sentence in the Variants section); absent — generic text */
  resetNote?: string;
  /** free-form descriptive data — the engine does not read it */
  metadata: Record<string, string | number | boolean | null>;
}

/** levels and rooms */
export interface RoomsData {
  levels: Record<string, { name: string; floor_z: number; /** section cut height above the floor [m] */ cut_height?: number; /** half the wall thickness drawn on the plan [m] */ plan_wall_offset?: number }>;
  rooms: RoomJson[];
}

/** furnishing the project starts with (project default arrangement) */
export interface InteriorDefaults {
  /** items described by the project sources — ids "arch-<key>" */
  items: ArchitectItem[];
  /** what the sources did not allow to place (shown in the UI) */
  notIncluded: { room: string; what: string; why: string }[];
  /** ready-made placements outside the sources — per room */
  extra?: Record<string, FurniturePlacement[]>;
  /** description of a room's default layout shown in the UI (where it comes from, what it contains) — per room */
  notes?: Record<string, string>;
}

/** electrical points known from the project sources (e.g. distribution boards) */
export interface ElectricalDefaults {
  points: { id: string; type: string; roomId: string; x: number; y: number; heightAFFL: number; width?: number; label: string; source: string; status: string; notes?: string }[];
}

/** building footprint and plot boundary in plan — the "exterior room" (facades, points on the plot) */
export interface SiteOutline {
  /** building footprint at ground level (outer faces) */
  footprint: Vec2[];
  /** plot boundary */
  boundary: Vec2[];
  /** terrain level next to the building relative to the lowest level's floor [m] */
  groundLevel: number;
  /** level from which one walks out onto the terrain */
  levelId: string;
  /** walkable area on the terrain [x0, y0, x1, y1]; defaults to the bounding box of the plot boundary */
  walkBounds?: [number, number, number, number];
}

/** facts about doors that are not in the geometric data */
export interface DoorFacts {
  /** overrides of door definition fields (e.g. a flush door) with their source */
  overrides?: Record<string, { flush?: boolean; source: string }>;
  /** ids of floor-level windows (glazed doors) on the site level through which one can walk out onto the terrain */
  passableOpenings?: string[];
}

/**
 * PROJECT ASSETS — the only place the engine learns about the project's files. Paths are relative to the project
 * directory (projects/<id>/). A project without `model` has no file-based building model: the engine generates the shell
 * from the room outlines.
 */
export interface ProjectAssets {
  /** building model (GLB) */
  model?: string;
  /** terrain model (GLB) — module `site`; without it the terrain is flat at site.groundLevel */
  site?: string;
  /** surroundings model (GLB) — module `environment` */
  environment?: string;
  /** bounds of the file-based model in project coordinates (camera framing); default — computed from rooms */
  bounds?: { min: Vec3; max: Vec3 };
  /** model convention: per level, name prefixes of wall meshes the level section closes with a cap */
  sectionCaps?: Record<string, string[]>;
  /** per level, names of meshes besides walls that a room cut-away opens from above */
  plinthExtra?: Record<string, string[]>;
  /** names of terrain meshes the walk-through stands on (default: every mesh of the site model) */
  groundMeshes?: string[];
}

/** per-project catalog extensions: files relative to the project directory; ids must be prefixed with "<projectId>:" */
export interface ProjectCatalogFiles { furniture?: string; materials?: string }

export interface ProjectPackage {
  schema: 'home-simulator/project';
  version: 1;
  manifest: ProjectManifest;
  building: {
    rooms: RoomsData;
    doors: DoorDef[];
    doorFacts?: DoorFacts;
    /** stairs between levels (walk, finishes); absent — a building without stairs */
    stairs?: StairDef[];
    /** parameters of the shell generated from room outlines (project without assets.model) */
    shell?: Partial<ShellSpec>;
    /** the roof: parts over the levels, dormers, chimneys (absent — derived from attic ceilings, or a flat top) */
    roof?: RoofJson;
  };
  interiors: InteriorDefaults;
  electrical: ElectricalDefaults;
  /** building and plot outline (module site); absent — a project without terrain (apartment) */
  site?: SiteOutline | null;
  /** geographic position, orientation and time zone (module sun) */
  sun?: SunSite;
  /** project files: where the engine takes the building, terrain and surroundings models from */
  assets?: ProjectAssets;
  /** catalog extensions */
  catalog?: ProjectCatalogFiles;
  /** exterior building views (camera presets); absent — the engine's default set */
  views?: ProjectViews;
  /** eye-level viewpoints (walk start) */
  viewpoints?: Viewpoint[];
}
