// AUTHORING FORMAT — plan.json: the compact description of a building that people and AI agents write (ADR 0014). The
// compiler (./compile.ts, npm run project:build) turns it into the project package projects/<id>/project.json, which is the
// only thing the engine reads. plan.json states facts once ("a 0.9 m door between Hall and Bathroom at this point, hinge on
// the left, opens into the bathroom"); everything derived — door gaps in BOTH rooms, wall faces, hinge vectors, polygon order,
// areas, bounding boxes — is computed, never typed by hand.
//
// Coordinates: units "m" — project coordinates in metres (+X right on the plan, +Y up on the plan, +Z up). Units "px" — every
// POINT (rect, polygon, at, box, boundary) is in pixels of the source image (x right, y DOWN) and is converted with the
// calibration block; every SIZE (width, sill, head, heights, dims, offsets) is always in metres.
import { z } from 'zod';
import { ProjectSchema, RoomKindSchema } from '../project/schema';

const num = z.number().finite();
const pt = z.tuple([num, num]);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'letters, digits, - _ .');
const side = z.enum(['N', 'S', 'E', 'W']).describe('wall of the room: N = max y, S = min y, E = max x, W = min x (plan up = N)');

export const CalibrationSchema = z.strictObject({
  pxPerM: num.positive().describe('pixels per metre of the source image'),
  originPx: pt.describe('pixel that becomes the project origin (x = 0, y = 0)'),
  methods: z.array(z.strictObject({ method: z.string(), pxPerM: num.positive(), note: z.string().optional() })).optional()
    .describe('independent scale estimates (scale bar, printed area, door width…) — the build reports their agreement'),
});

const RoomSchema = z.strictObject({
  id, name: z.string().min(1), level: id, kind: RoomKindSchema, tags: z.array(z.string()).optional(), label: z.string().optional(),
  rect: z.tuple([num, num, num, num]).optional().describe('[x0, y0, x1, y1] of the inner wall faces'),
  polygon: z.array(pt).min(4).optional().describe('inner wall faces, axis-aligned edges, any order of corners along the outline'),
  ceiling: num.positive().optional().describe('ceiling height above this room floor [m]; default: level ceiling'),
  areaPrinted: num.positive().optional().describe('area printed on the plan [m²] (checked against the computed area)'),
  source: z.string().optional(),
}).refine((r) => !!r.rect !== !!r.polygon, 'give exactly one of rect / polygon');

const DoorSchema = z.strictObject({
  id, between: z.tuple([id, id]).describe('the two rooms on either side; use "exterior" for an outside door'),
  at: pt.describe('any point in the middle of the door opening (on or inside the wall between the rooms)'),
  width: num.positive().describe('clear opening in the masonry [m]'),
  type: z.enum(['hinged-single', 'sliding', 'pocket']).default('hinged-single'),
  swingInto: id.optional().describe('hinged: the room the leaf opens into (default: the second room, or the room for an exterior door)'),
  hinge: z.enum(['left', 'right']).optional().describe('hinged: hinge side as seen from the room the door opens into, looking at the wall'),
  slideTo: z.enum(['start', 'end']).optional().describe('sliding / pocket: the leaf moves towards the start (smaller coordinate) or end of the opening'),
  height: num.positive().optional(), leafHeight: num.positive().optional(),
  confidence: z.enum(['confirmed', 'probable', 'unknown']).optional(), source: z.string().optional(),
});

const PassageSchema = z.strictObject({ between: z.tuple([id, id]), at: pt, width: num.positive(), height: num.positive().optional() });

const WindowSchema = z.strictObject({
  id, room: id, at: pt.describe('a point on the window wall, in the middle of the window'), width: num.positive(),
  sill: num.min(0).optional(), head: num.positive().optional(),
  passable: z.boolean().optional().describe('floor-level glazed door one can walk through onto the terrain'),
});

const StairSchema = z.strictObject({
  id, from: id, to: id,
  box: z.tuple([num, num, num, num]).describe('[x0, y0, x1, y1] — walls at x0 and y0; the lower flight starts at y1 on the x > split side'),
  risers: z.number().int().min(2).describe('risers per flight (two flights, U-turn)'),
  tread: num.positive(), flightWidth: num.positive(), gap: num.min(0).default(0.05),
  note: z.string().optional(), confidence: z.string().optional(),
});

const FurnitureSchema = z.strictObject({
  key: id.optional(), room: id, catalogId: z.string().min(1), variant: z.string().nullable().optional(),
  at: pt.optional().describe('centre of the footprint'), rot: num.optional().describe('0 = front faces +Y, 90 = −X, 180 = −Y, 270 = +X'),
  wall: side.optional().describe('back against this wall of the room (instead of at / rot)'),
  along: num.optional().describe('with wall: coordinate of the item centre along the wall (x for N / S walls, y for E / W walls)'),
  dims: z.strictObject({ w: num.optional(), d: num.optional(), h: num.optional() }).optional(),
  elevation: num.optional(), group: z.string().optional(), materialId: z.string().optional(),
  basis: z.enum(['dimensioned', 'drawn', 'approximate']).optional(), note: z.string().optional(), source: z.string().optional(),
});

const PointSchema = z.strictObject({
  id: id.optional(), type: z.string().min(1), room: id, height: num.describe('height above the finished floor [m]'), label: z.string(),
  at: pt.optional(), wall: side.optional(), along: num.optional(), width: num.optional(), notes: z.string().optional(),
});

export const PlanSchema = z.strictObject({
  $schema: z.string().optional(),
  schema: z.literal('home-simulator/plan'),
  version: z.literal(1),
  project: z.strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().min(1), description: z.string().optional(), documentTitle: z.string().optional(),
    language: z.string().optional(), buildingType: z.enum(['house', 'apartment']),
    origin: z.string().optional().describe('where the project origin is and how the axes run (human-readable)'),
    metadata: z.record(z.string(), z.union([z.string(), num, z.boolean(), z.null()])).optional(),
  }),
  units: z.enum(['m', 'px']).default('m'),
  calibration: CalibrationSchema.optional(),
  /** regularise geometry: snap to 5 mm, align room faces on shared lines, set shared wall thickness to the interior wall
   *  when it is close (default: on for px plans, off for m plans) */
  regularize: z.boolean().optional(),
  source: z.string().describe('default provenance of every fact (e.g. "floor plan image plan.png, calibrated from printed areas")'),
  defaults: z.strictObject({
    exteriorWall: num.positive().default(0.3), interiorWall: num.positive().default(0.12), slab: num.positive().default(0.25),
    doorHeight: num.positive().default(2.05), leafHeight: num.positive().default(2.0), sill: num.min(0).default(0.85), head: num.positive().default(2.35),
    confidence: z.enum(['confirmed', 'probable', 'unknown']).default('probable'), basis: z.enum(['dimensioned', 'drawn', 'approximate']).default('approximate'),
  }).prefault({}),
  levels: z.array(z.strictObject({ id, name: z.string(), floorZ: num, ceiling: num.positive().describe('ceiling height above the floor [m]'), cutHeight: num.positive().optional().describe('section height above the floor [m]; default: 10 cm above the highest window head, at least 2.30, below the ceiling') })).min(1),
  rooms: z.array(RoomSchema).min(1),
  doors: z.array(DoorSchema).default([]),
  passages: z.array(PassageSchema).default([]),
  windows: z.array(WindowSchema).default([]),
  stairs: z.array(StairSchema).default([]),
  furniture: z.array(FurnitureSchema).default([]),
  notIncluded: z.array(z.strictObject({ room: id, what: z.string(), why: z.string() })).default([]),
  electrical: z.array(PointSchema).default([]),
  site: z.strictObject({
    boundary: z.array(pt).min(3).optional(), margin: num.positive().optional().describe('plot = building footprint grown by this margin [m]'),
    groundLevel: num.default(-0.15).describe('terrain next to the building relative to the lowest floor [m]'),
  }).optional(),
  sun: z.strictObject({
    lat: num.min(-90).max(90), lon: num.min(-180).max(180), timeZone: z.string().min(1),
    northAzimuthX: num.describe('azimuth of the +X axis measured clockwise from geographic north [°] (90 = +X points east)'),
    confidence: z.enum(['confirmed', 'probable', 'unknown']).default('probable'), placeName: z.string().optional(),
  }).optional(),
  viewpoints: z.array(z.strictObject({ id, name: z.string(), level: z.string(), at: pt, look: z.tuple([num, num, num]), fov: num.default(70), hint: z.string().default('') })).default([]),
  defaultView: z.strictObject({ level: id.optional(), room: id.optional(), view: z.enum(['exterior', 'interior']).optional() }).optional(),
  notes: z.record(z.string(), z.string()).optional().describe('per room: where its default layout comes from'),
  capabilities: z.array(z.enum(['interiors', 'electrical', 'variants', 'walk'])).optional()
    .describe('sections the app offers for this building (default: all four)'),
  assets: ProjectSchema.shape.assets.describe('model files in the project directory, copied to project.json: model (building GLB instead of the generated shell), site (terrain GLB, needs "site"), environment (surroundings GLB — enables the environment module), bounds, sectionCaps, plinthExtra, groundMeshes'),
  views: ProjectSchema.shape.views.describe('camera presets, copied to project.json (default: the engine views)'),
  catalog: ProjectSchema.shape.catalog.describe('the project\'s own furniture / material catalog files (ids "<project id>:…"), copied to project.json'),
  dataSources: z.record(z.string(), z.string()).optional(),
});

export type Plan = z.output<typeof PlanSchema>;
export type PlanInput = z.input<typeof PlanSchema>;
