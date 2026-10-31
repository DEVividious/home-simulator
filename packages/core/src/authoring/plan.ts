// AUTHORING FORMAT — plan.json: the compact description of a building that people and AI agents write. The
// compiler (./compile.ts, npm run project:build) turns it into the project package projects/<id>/project.json, which is the
// only thing the engine reads. plan.json states facts once ("a 0.9 m door between Hall and Bathroom at this point, hinge on
// the left, opens into the bathroom"); everything derived — door gaps in BOTH rooms, wall faces, hinge vectors, polygon order,
// areas, bounding boxes — is computed, never typed by hand.
//
// Coordinates: units "m" — project coordinates in metres (+X right on the plan, +Y up on the plan, +Z up). Units "px" — every
// POINT (rect, polygon, at, box, boundary) is in pixels of the source image (x right, y DOWN) and is converted with the
// calibration block; every SIZE (width, sill, head, heights, dims, offsets) is always in metres.
import { z } from 'zod';
import { NamesSchema, ProjectSchema, RoomKindSchema } from '../package/schema.ts';

const num = z.number().finite();
const pt = z.tuple([num, num]);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'letters, digits, - _ .');
const side = z.enum(['N', 'S', 'E', 'W']).describe('wall of the room facing that side (N = +y, S = −y, E = +x, W = −x; plan up = N); in an L or U room the one that holds "along", else the longest');

export const CalibrationSchema = z.strictObject({
  pxPerM: num.positive().describe('pixels per metre of the source image'),
  originPx: pt.describe('pixel that becomes the project origin (x = 0, y = 0)'),
  methods: z.array(z.strictObject({ method: z.string(), pxPerM: num.positive(), note: z.string().optional() })).optional()
    .describe('independent scale estimates (scale bar, printed area, door width…) — the build reports their agreement'),
});

const RoomSchema = z.strictObject({
  id, name: z.string().min(1), names: NamesSchema.optional().describe('the name in other languages (language code → name), e.g. {"en": "Kitchen"} next to a Polish name'), level: id, kind: RoomKindSchema, tags: z.array(z.string()).optional(), label: z.string().optional(),
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
  swingInto: id.optional().describe('hinged: the room the leaf opens into, or "exterior" for an outward-opening outside door (default: the second room, or the room for an exterior door)'),
  hinge: z.enum(['left', 'right']).optional().describe('hinged: hinge side as seen from the room the door opens into, looking at the wall'),
  slideTo: z.enum(['start', 'end']).optional().describe('sliding / pocket: the leaf moves towards the start (smaller coordinate) or end of the opening'),
  height: num.positive().optional(), leafHeight: num.positive().optional(),
  confidence: z.enum(['confirmed', 'probable', 'unknown']).optional(), source: z.string().optional(),
});

const LineSchema = z.strictObject({ at: num.describe('coordinate across the ridge (point units)'), height: num.positive().describe('ceiling height on this line [m]') });

/** sloped ceiling of a level (attic under a pitched roof): the ridge, and how the ceiling falls away from it */
export const SlopeSchema = z.strictObject({
  ridge: z.enum(['X', 'Y']).describe('the ridge line runs along this plan axis (X: left–right on the plan, Y: up–down)'),
  ridgeAt: num.optional().describe('coordinate of the ridge line on the other axis (a point coordinate: px in a px plan); default: middle of the level'),
  lines: z.array(LineSchema).min(1).max(2)
    .describe('height lines drawn on the plan (e.g. knee wall 1.40 and 2.20); two lines on one side of the ridge give the slope'),
  pitch: num.positive().lt(80).optional().describe('roof pitch [°] — needed when only one line is given'),
  flat: num.positive().optional().describe('height of the flat ceiling top (collar beams) [m]; default: the level ceiling'),
}).refine((s) => s.lines.length === 2 || s.pitch !== undefined, 'give two height lines, or one line and the pitch');

const rect4 = z.tuple([num, num, num, num]);

/** a roof part ("wing"): the roof over a rectangle of a level's walls */
export const RoofPartSchema = z.strictObject({
  id, level: id.describe('the level the part covers: its rooms get their ceilings from it'),
  type: z.enum(['gable', 'hip', 'shed', 'flat']),
  rect: rect4.optional().describe('[x0, y0, x1, y1] — OUTER faces of the walls under the part (points); or "rooms"; default: the level outline (it must be a rectangle unless flat)'),
  rooms: z.array(id).min(1).optional().describe('the part covers these rooms (their outline grown by the exterior wall)'),
  polygon: z.array(pt).min(4).optional().describe('flat part only: outer faces of the walls under it, axis-aligned edges'),
  ridge: z.enum(['X', 'Y']).optional().describe('gable / hip: the ridge runs along this plan axis (default: along the longer side)'),
  ridgeAt: num.optional().describe('coordinate of the ridge line on the other axis (a point coordinate); default: the middle'),
  down: z.enum(['N', 'S', 'E', 'W']).optional().describe('shed (and a flat roof with a pitch): the side the roof falls towards'),
  pitch: num.min(0).lt(80).optional().describe('roof pitch [°] (gable / hip / shed: 5–75; flat: 0–5)'),
  pitchEnds: num.positive().lt(80).optional().describe('hip: pitch of the two end planes [°] (default: pitch)'),
  knee: num.optional().describe('height above the level floor where the underside of the roof structure meets the OUTER face of the eaves walls [m] (knee wall); default: the level ceiling + slab (a roof on top of the ceiling), for flat: the level ceiling'),
  lines: z.array(LineSchema).min(1).max(2).optional().describe('instead of knee: ceiling height lines from the plan (1.40 / 2.20); two lines on one side of the ridge give the pitch'),
  eaves: num.min(0).optional().describe('overhang at the eaves [m] (default: roof.eaves; flat: 0)'),
  verge: num.min(0).optional().describe('overhang at a gable end [m] (default: roof.verge)'),
  parapet: num.positive().optional().describe('flat: parapet height above the covering [m]'),
  source: z.string().optional(),
}).refine((p) => [p.rect, p.rooms, p.polygon].filter(Boolean).length <= 1, 'give at most one of rect / rooms / polygon')
  .refine((p) => !p.polygon || p.type === 'flat', 'a polygon outline is for flat parts only (pitched parts: rectangles)')
  .refine((p) => !(p.knee !== undefined && p.lines), 'give knee or lines, not both');

const DormerSchema = z.strictObject({
  id, part: id.describe('the roof part it stands on'), type: z.enum(['gable', 'shed']),
  rect: rect4.describe('[x0, y0, x1, y1] — outer faces of its walls in plan (points); the back may stop where it meets the roof — it is carried on to the ridge'),
  front: num.positive().describe('height above the level floor of the underside of the dormer roof at its eaves (gable: at the cheeks; shed: at the front) [m]'),
  pitch: num.positive().lt(80).describe('pitch of the dormer roof [°]'),
  window: z.strictObject({ id, room: id, width: num.positive(), sill: num.min(0).optional(), head: num.positive().optional() }).optional()
    .describe('the window in its front: centred, sill / head above the room floor'),
  source: z.string().optional(),
});

/** the roof of the building: parts (wings) over the levels, dormers, chimneys */
export const RoofSchema = z.strictObject({
  covering: num.min(0).default(0.05).describe('covering thickness (tiles, sheet) across the planes [m]'),
  buildup: num.positive().default(0.25).describe('thickness of the structure under it (rafters, insulation, lining) [m]'),
  eaves: num.min(0).default(0.5).describe('default overhang at the eaves [m]'),
  verge: num.min(0).default(0.3).describe('default overhang at a gable end [m]'),
  ridgeHeight: num.positive().optional().describe('height of the highest ridge (top of the covering) above z = 0 from the drawings [m] — checked (±10 cm)'),
  parts: z.array(RoofPartSchema).min(1),
  dormers: z.array(DormerSchema).default([]),
  chimneys: z.array(z.strictObject({ id, rect: rect4.describe('[x0, y0, x1, y1] (points)'), top: num.describe('height of its top above z = 0 [m]') })).default([]),
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
  kind: z.enum(['straight', 'l-turn', 'u-turn']).default('u-turn').describe('straight: one flight; l-turn: two flights at a right angle, a landing in the corner; u-turn: two flights side by side, a landing across both'),
  box: z.tuple([num, num, num, num]).describe('[x0, y0, x1, y1] — outline of the whole stair (every flight and landing; for an l-turn the box around the L)'),
  up: z.enum(['N', 'S', 'E', 'W']).default('S').describe('direction one walks up the (lower) flight (N = +y, plan up); a straight flight arrives at that end of the box, an l-turn or u-turn has its landing there'),
  turn: z.enum(['left', 'right']).default('right').describe('l-turn, u-turn: which way one turns on the landing going up (towards the upper flight)'),
  risers: z.number().int().min(2).describe('straight: all the risers; l-turn: the risers of the lower flight; u-turn: risers per flight (both flights have them)'),
  upperRisers: z.number().int().min(2).optional().describe('l-turn: the risers of the upper flight'),
  tread: num.positive(), flightWidth: num.positive(), gap: num.min(0).default(0.05).describe('u-turn: the gap between the flights [m]'),
  note: z.string().optional(), confidence: z.string().optional(),
}).refine((s) => s.kind !== 'l-turn' || s.upperRisers !== undefined, 'an l-turn needs upperRisers (the risers of the upper flight)')
  .refine((s) => s.kind === 'l-turn' || s.upperRisers === undefined, 'upperRisers is for l-turn stairs only');

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
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().min(1), names: NamesSchema.optional(), description: z.string().optional(), documentTitle: z.string().optional(),
    language: z.string().optional().describe('the language the names are written in (en, pl); `names` add the other languages'), buildingType: z.enum(['house', 'apartment']),
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
  levels: z.array(z.strictObject({ id, name: z.string(), names: NamesSchema.optional(), floorZ: num, ceiling: num.positive().describe('ceiling height above the floor [m]'), cutHeight: num.positive().optional().describe('section height above the floor [m]; default: 10 cm above the highest window head, at least 2.30, below the ceiling'), slope: SlopeSchema.optional().describe('sloped ceilings of every room on this level (attic): without a roof block it becomes a gable roof part over the level; with one, a cross-check. A room\'s own `ceiling` is its flat top'), calibration: CalibrationSchema.optional().describe('px plans drawn as one image per level: the scale and origin of THIS level\'s image (the origin pixel = the same building corner on every image); default: the plan calibration') })).min(1),
  rooms: z.array(RoomSchema).min(1),
  doors: z.array(DoorSchema).default([]),
  passages: z.array(PassageSchema).default([]),
  windows: z.array(WindowSchema).default([]),
  roofWindows: z.array(z.strictObject({ id, room: id, rect: z.tuple([num, num, num, num]).describe('[x0, y0, x1, y1] of the window in the sloped ceiling, seen from above') })).default([]),
  roof: RoofSchema.optional().describe('the roof: parts over the levels (gable, hip, shed, flat), dormers, chimneys; without it a level slope builds a gable part'),
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
  viewpoints: z.array(z.strictObject({ id, name: z.string(), names: NamesSchema.optional(), level: z.string(), at: pt, look: z.tuple([num, num, num]), fov: num.default(70), hint: z.string().default(''), hints: NamesSchema.optional() })).default([]),
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
