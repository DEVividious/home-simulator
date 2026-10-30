// PROJECT BOUNDARY — structural schema of a project package (zod). It is the single source of the generated JSON Schema
// (schemas/project.schema.json, npm run schema:generate) used by editors and by authoring tools. Semantic checks
// (cross references, module data) live in ./validate. Top-level objects are strict, so a typo in a field name is an
// error; nested records accept extra fields so that tools may add provenance notes.
import { z } from 'zod';

const num = z.number().finite();
const vec2 = z.tuple([num, num]);
const vec3 = z.tuple([num, num, num]);
const id = z.string().min(1);
const confidence = z.enum(['confirmed', 'probable', 'unknown']);

export const RoomKindSchema = z.enum(['bath', 'kitchen', 'garage', 'tech', 'hall', 'bed', 'living', 'office', 'storage', 'room']);

const DoorGapSchema = z.looseObject({
  along: z.enum(['X', 'Y']), from_: num, to: num, across: z.array(num).length(2), width: num,
  door_id: z.string().nullable(), leaf: num.nullable(), height: num.nullable(),
}).describe('door gap or passage in a room wall; the same gap appears in the rooms on both sides');

const WindowSchema = z.looseObject({
  id, kind: z.string(), plane_axis: z.enum(['X', 'Y']).describe('axis whose coordinate is constant along the wall face'),
  inner: num.describe('coordinate of the room-side wall face'), from_: num, to: num,
  sill_z: num.optional(), head_z: num.optional(), polygon_YZ: z.array(z.array(num)).optional(),
});

/** flat: absolute height z; attic (sloped): flat top flat_z, ridge along X at y = ridge_y or along Y at x = ridge_x, height
 *  z_at_ridge on the ridge line, fall `slope` [m per m] away from it */
const CeilingSchema = z.looseObject({
  kind: z.enum(['flat', 'attic']), z: num.optional(), flat_z: num.optional(), ridge_y: num.optional(), ridge_x: num.optional(), z_at_ridge: num.optional(), slope: num.optional(),
}).refine((c) => c.kind !== 'flat' || c.z !== undefined, 'a flat ceiling needs "z"')
  .refine((c) => c.kind !== 'attic' || (c.flat_z !== undefined && c.z_at_ridge !== undefined && (c.slope ?? 0) > 0 && (c.ridge_x === undefined) !== (c.ridge_y === undefined)),
    'a sloped ceiling needs flat_z, z_at_ridge, slope > 0 and exactly one of ridge_x / ridge_y');

export const RoomSchema = z.looseObject({
  id, name: z.string(), label: z.string().optional(), level: id, floor_z: num,
  area: num, area_data: num, id_source: z.string(),
  bbox: z.array(num).length(4), polygon: z.array(vec2).min(3).describe('inner wall faces, metres, project coordinates'),
  rectangular: z.boolean(), ceiling: CeilingSchema,
  stair_opening: z.array(num).length(4).nullable(), doors: z.array(DoorGapSchema), openings: z.array(WindowSchema),
  roof_windows: z.array(z.looseObject({ id, plan_rect: z.array(num) })),
  kind: RoomKindSchema, tags: z.array(z.string()).optional(),
});

export const DoorSchema = z.looseObject({
  id, level: id, rooms: z.tuple([id, id]), floorZ: num,
  opening: z.looseObject({ along: z.enum(['X', 'Y']), from: num, to: num, faces: z.array(num).length(2), width: num, height: num }),
  leafWidth: num, height: num, type: z.enum(['hinged-single', 'hinged-double', 'sliding', 'pocket']),
  hinge: vec2.nullable(), closedDir: vec2.nullable(), openDir: vec2.nullable(),
  hingeSide: z.enum(['left', 'right']).nullable(), swingInto: z.string().nullable(), openAngle: num.nullable(),
  slide: z.looseObject({ origin: vec2, dir: vec2, travel: num }).nullable(),
  source: z.array(z.string()), confidence, notes: z.string().optional(), flush: z.boolean().optional(),
});

const StairSchema = z.looseObject({
  id, kind: z.literal('u-turn'), fromLevel: id, toLevel: id, bbox: z.tuple([num, num, num, num]),
  risers: z.number().int().positive(), riser: num, tread: num, flightWidth: num, gap: num, landingZ: num, topZ: num,
  split: num, run: num, landingEdge: num, confidence: z.string(), note: z.string().optional(),
  orient: z.strictObject({ rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), mirror: z.boolean() }).optional(),
});

const DimsSchema = z.looseObject({ w: num.optional(), d: num.optional(), h: num.optional() });

const ArchitectItemSchema = z.looseObject({
  key: id, room: id, catalogId: id, variant: z.string().nullable(), x: num, y: num, rot: num,
  dims: DimsSchema.optional(), fit: z.enum(['ceiling', 'hood']).optional(), elevation: num.optional(),
  source: z.string(), materialId: z.string().optional(), basis: z.enum(['dimensioned', 'drawn', 'approximate']), note: z.string(), group: z.string().optional(),
});

const PlacementSchema = z.looseObject({
  id, catalogId: id, variant: z.string().nullable().optional(), x: num, y: num, rot: num, elevation: num.optional(),
  dims: DimsSchema.nullable().optional(), materialId: z.string().nullable().optional(), slots: z.record(z.string(), z.string()).nullable().optional(),
  mount: z.looseObject({ wallId: id, u: num, height: num }).nullable().optional(),
});

const ElectricalPointSchema = z.looseObject({
  id, type: id, roomId: id, x: num, y: num, heightAFFL: num, width: num.optional(), label: z.string(), source: z.string(), status: z.string(), notes: z.string().optional(),
});

const ViewSchema = z.looseObject({
  id, label: z.string(), icon: z.string(), hint: z.string(), dir: vec3.optional(),
  pose: z.looseObject({ position: vec3, target: vec3, fov: num }).optional(), fit: num.optional(),
});

const ViewpointSchema = z.looseObject({
  id, name: z.string(), en: z.string().optional(), p: vec2, level: id, look: vec3, fov: num, hint: z.string(),
});

export const ManifestSchema = z.strictObject({
  projectId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lower-case letters, digits and hyphens'),
  name: z.string().min(1), description: z.string().optional(), documentTitle: z.string().optional(), language: z.string().optional(),
  units: z.literal('m'),
  coordinateSystem: z.strictObject({ name: z.string(), description: z.string(), up: z.literal('Z'), handedness: z.literal('right') }),
  buildingType: z.enum(['house', 'apartment']),
  levels: z.array(z.strictObject({ id, name: z.string(), floorZ: num })).min(1),
  dataSources: z.record(z.string(), z.string()),
  modules: z.array(z.enum(['site', 'environment', 'sun', 'stairs'])),
  capabilities: z.array(z.enum(['interiors', 'electrical', 'variants', 'walk'])),
  defaultView: z.strictObject({ levelId: id, roomId: z.string().nullable().optional(), view: z.enum(['exterior', 'interior']).optional() }),
  resetNote: z.string().optional(),
  metadata: z.record(z.string(), z.union([z.string(), num, z.boolean(), z.null()])),
});

export const ProjectSchema = z.strictObject({
  $schema: z.string().optional(),
  schema: z.literal('home-simulator/project'),
  version: z.literal(1),
  manifest: ManifestSchema,
  building: z.strictObject({
    rooms: z.strictObject({
      levels: z.record(z.string(), z.looseObject({ name: z.string(), floor_z: num, cut_height: num.optional(), plan_wall_offset: num.optional() })),
      rooms: z.array(RoomSchema).min(1),
    }),
    doors: z.array(DoorSchema),
    doorFacts: z.strictObject({ overrides: z.record(z.string(), z.looseObject({ flush: z.boolean().optional(), source: z.string() })).optional(), passableOpenings: z.array(z.string()).optional() }).optional(),
    stairs: z.array(StairSchema).optional(),
    shell: z.strictObject({ exteriorWall: num.positive().optional(), slab: num.positive().optional() }).optional(),
  }),
  interiors: z.strictObject({
    items: z.array(ArchitectItemSchema),
    notIncluded: z.array(z.looseObject({ room: z.string(), what: z.string(), why: z.string() })),
    extra: z.record(z.string(), z.array(PlacementSchema)).optional(),
    notes: z.record(z.string(), z.string()).optional(),
  }),
  electrical: z.strictObject({ points: z.array(ElectricalPointSchema) }),
  site: z.strictObject({
    footprint: z.array(vec2).min(3), boundary: z.array(vec2).min(3), groundLevel: num, levelId: id,
    walkBounds: z.tuple([num, num, num, num]).optional(),
  }).nullable().optional(),
  sun: z.strictObject({
    lat: num.min(-90).max(90), lon: num.min(-180).max(180), gridAzimuthX: num, convergence: num, trueAzimuthX: num,
    confidence: z.string(), uncertaintyDeg: num, timeZone: z.string().min(1).describe('IANA time zone, e.g. Europe/Berlin'), placeName: z.string().optional(),
  }).optional(),
  assets: z.strictObject({
    model: z.string().optional(), site: z.string().optional(), environment: z.string().optional(),
    bounds: z.strictObject({ min: vec3, max: vec3 }).optional(),
    sectionCaps: z.record(z.string(), z.array(z.string())).optional(),
    plinthExtra: z.record(z.string(), z.array(z.string())).optional(),
    groundMeshes: z.array(z.string()).optional(),
  }).optional(),
  catalog: z.strictObject({ furniture: z.string().optional(), materials: z.string().optional() }).optional(),
  views: z.strictObject({ presets: z.array(ViewSchema), home: z.string().optional() }).optional(),
  viewpoints: z.array(ViewpointSchema).optional(),
});

/** projects/index.json — list of installed project packages */
export const ProjectIndexSchema = z.strictObject({
  schema: z.literal('home-simulator/projects-index'),
  version: z.literal(1),
  default: id,
  projects: z.array(z.strictObject({ id, name: z.string(), description: z.string().optional(), dir: z.string() })),
});

/** human-readable structural errors: "path: message" */
export function schemaErrors(schema: z.ZodType, data: unknown): string[] {
  const r = schema.safeParse(data);
  if (r.success) return [];
  return r.error.issues.slice(0, 50).map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
}
