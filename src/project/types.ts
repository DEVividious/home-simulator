// PROJECT BOUNDARY — the project package contract: the facts of one building in the shape the engine loads.
// The engine (src/home, src/document, …) never imports building data files; it receives them only through this contract
// (project() from ./active). Packages are runtime-loaded JSON directories (projects/<id>/project.json, ADR 0006); their
// structure is validated by the zod schema in ./schema and their semantics by ./validate. Field reference:
// docs/PROJECT_PACKAGE_SPEC.md.
import type { ArchitectItem } from '../home/model/defaults';
import type { DoorDef } from '../home/model/doors';
import type { RoomJson } from '../home/model/rooms';
import type { ShellSpec } from '../home/model/shell';
import type { StairDef } from '../home/model/stairs';
import type { SunSite } from '../home/model/sun';
import type { FurniturePlacement, Vec2, Vec3 } from '../home/model/types';
import type { ProjectViews } from '../home/model/views';
import type { Viewpoint } from '../home/model/viewpoints';

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

export interface ProjectLevel { id: string; name: string; floorZ: number }

export interface ProjectManifest {
  projectId: string;
  /** display name (app title, PDF, exports) */
  name: string;
  /** one line under the name (e.g. an address) */
  description?: string;
  /** title on documents (PDF, exports); defaults to `name` */
  documentTitle?: string;
  /** preferred UI language of the project ('en', 'pl'); the viewer's choice wins */
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
 * from the room outlines (ADR 0010).
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
