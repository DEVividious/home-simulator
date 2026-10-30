// ELECTRICAL / SMART HOME PLANNER: electrical and smart-home points on walls, ceilings and outside.
// This is a design and coordination aid (USER DESIGN STATE) — NOT an installation design: the model does not size cables,
// protective devices, circuits or loads. Every point has an unambiguous location: room, wall, distance along the wall
// and height above the finished floor (AFFL), so that it can be found on site and printed on the plan.
// The plan is GLOBAL (ConfiguratorDoc.electrical — shared by all variants); a variant may have its own layout
// (Variant.electrical) when the user deliberately splits it off. Points known from the project sources (e.g. distribution boards) and the
// building / plot outline come from the project package (project().electrical, project().site). Pure TS (tests without a browser).
import { derived, project } from '../../project/active';
import { fmtNum, lang, t } from '../../i18n';
import { segDist } from '@home-sim/core/model/geom2d';
import { levelIndex, levelName, type RoomWall } from './rooms';
import type { LevelId, Vec2, Vec3 } from './types';

// ------------------------------------------------------------------ point types
export type ElLayer = 'sockets' | 'lights' | 'smart' | 'data' | 'sensors' | 'boards';
export type ElPdfGroup = 'power' | 'lighting' | 'data' | 'smart';
export type ElMount = 'wall' | 'ceiling';
export type SmartMode = 'none' | 'switched' | 'dimmable' | 'sensor' | 'bus' | 'relay' | 'network';
export type ElStatus = 'planned' | 'confirmed' | 'proposed' | 'source' | 'unresolved';

interface ElTypeDef { name: string; short: string; prefix: string; layer: ElLayer; pdf: ElPdfGroup; mount: ElMount; height: number; modules: number; smart: SmartMode; code: string }
const EL_TYPE_DEFS = {
  'socket-1': { prefix: 'G', layer: 'sockets', pdf: 'power', mount: 'wall', height: 0.3, modules: 1, smart: 'none', code: '' },
  'socket-2': { prefix: 'G', layer: 'sockets', pdf: 'power', mount: 'wall', height: 0.3, modules: 2, smart: 'none', code: '2' },
  'socket-3': { prefix: 'G', layer: 'sockets', pdf: 'power', mount: 'wall', height: 0.3, modules: 3, smart: 'none', code: '3' },
  'socket-ext': { prefix: 'G', layer: 'sockets', pdf: 'power', mount: 'wall', height: 0.4, modules: 1, smart: 'none', code: 'IP' },
  switch: { prefix: 'W', layer: 'lights', pdf: 'lighting', mount: 'wall', height: 1.1, modules: 1, smart: 'switched', code: '' },
  light: { prefix: 'L', layer: 'lights', pdf: 'lighting', mount: 'ceiling', height: 0, modules: 1, smart: 'switched', code: '' },
  board: { prefix: 'R', layer: 'boards', pdf: 'power', mount: 'wall', height: 1.4, modules: 1, smart: 'none', code: '' },
  rj45: { prefix: 'D', layer: 'data', pdf: 'data', mount: 'wall', height: 0.3, modules: 2, smart: 'network', code: 'LAN' },
  tv: { prefix: 'D', layer: 'data', pdf: 'data', mount: 'wall', height: 0.3, modules: 1, smart: 'none', code: 'TV' },
  wifi: { prefix: 'D', layer: 'data', pdf: 'data', mount: 'ceiling', height: 0, modules: 1, smart: 'network', code: 'AP' },
  bus: { prefix: 'S', layer: 'smart', pdf: 'smart', mount: 'wall', height: 1.1, modules: 1, smart: 'bus', code: 'B' },
  motion: { prefix: 'C', layer: 'sensors', pdf: 'smart', mount: 'ceiling', height: 0, modules: 1, smart: 'sensor', code: 'PIR' },
  temp: { prefix: 'C', layer: 'sensors', pdf: 'smart', mount: 'wall', height: 1.5, modules: 1, smart: 'sensor', code: 'T' },
  camera: { prefix: 'C', layer: 'sensors', pdf: 'smart', mount: 'wall', height: 2.4, modules: 1, smart: 'network', code: 'CAM' },
  contact: { prefix: 'C', layer: 'sensors', pdf: 'smart', mount: 'wall', height: 2.0, modules: 1, smart: 'sensor', code: 'K' },
  keypad: { prefix: 'S', layer: 'smart', pdf: 'smart', mount: 'wall', height: 1.4, modules: 1, smart: 'bus', code: 'A' },
  'ceiling-smart': { prefix: 'S', layer: 'smart', pdf: 'smart', mount: 'ceiling', height: 0, modules: 1, smart: 'bus', code: 'S' },
  ev: { prefix: 'P', layer: 'sockets', pdf: 'power', mount: 'wall', height: 1.2, modules: 1, smart: 'none', code: 'EV' },
  power3f: { prefix: 'P', layer: 'sockets', pdf: 'power', mount: 'wall', height: 0.5, modules: 1, smart: 'none', code: '3~' },
} as const satisfies Record<string, Omit<ElTypeDef, 'name' | 'short'>>;
/** dictionary key part of a type id ('socket-ext' → 'socketExt') */
const typeKey = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
/** device types; `name` and `short` are getters translated in the current UI language on every access */
export const EL_TYPES = Object.fromEntries(Object.entries(EL_TYPE_DEFS).map(([id, d]) => [id, Object.defineProperties({ ...d }, {
  name: { get: () => t(`electrical.type.${typeKey(id)}`), enumerable: true },
  short: { get: () => t(`electrical.typeShort.${typeKey(id)}`), enumerable: true },
})])) as { readonly [K in keyof typeof EL_TYPE_DEFS]: (typeof EL_TYPE_DEFS)[K] & { readonly name: string; readonly short: string } };
export type ElType = keyof typeof EL_TYPES;
export const EL_TYPE_IDS = Object.keys(EL_TYPES) as ElType[];
export const isElType = (x: unknown): x is ElType => typeof x === 'string' && x in EL_TYPES;

/** object whose values are dictionary entries translated on access (`prefix.<id>`) */
function labels<K extends string>(prefix: string, ids: readonly K[]): Record<K, string> {
  const o = {} as Record<K, string>;
  for (const k of ids) Object.defineProperty(o, k, { get: () => t(`${prefix}.${k}`), enumerable: true });
  return o;
}
/** read-only list whose items are dictionary entries translated on access */
function lazyList(keys: readonly string[]): readonly string[] {
  const a: string[] = [];
  keys.forEach((k, i) => Object.defineProperty(a, i, { get: () => t(k), enumerable: true }));
  return a;
}

const layer = (id: ElLayer, color: string) => ({ get name() { return t(`electrical.layer.${id}`); }, color });
export const EL_LAYERS: Record<ElLayer, { name: string; color: string }> = {
  sockets: layer('sockets', '#c0392b'), lights: layer('lights', '#b7791f'), smart: layer('smart', '#7a3fc4'),
  data: layer('data', '#1f6feb'), sensors: layer('sensors', '#1a8f5a'), boards: layer('boards', '#18212b'),
};
export const EL_LAYER_IDS = Object.keys(EL_LAYERS) as ElLayer[];
const group = (id: ElPdfGroup | 'all', layers: ElLayer[]) => ({ get name() { return t(`electrical.pdfGroup.${id}`); }, layers });
export const PDF_GROUPS: Record<ElPdfGroup | 'all', { name: string; layers: ElLayer[] }> = {
  power: group('power', ['sockets', 'boards']), lighting: group('lighting', ['lights', 'boards']),
  data: group('data', ['data', 'boards']), smart: group('smart', ['smart', 'sensors', 'boards']),
  all: group('all', ['sockets', 'lights', 'data', 'smart', 'sensors', 'boards']),
};
export const SMART_MODES: Record<SmartMode, string> = labels('electrical.smartMode', ['none', 'switched', 'dimmable', 'sensor', 'bus', 'relay', 'network'] as const);
export const EL_STATUS: Record<ElStatus, string> = labels('electrical.status', ['planned', 'confirmed', 'proposed', 'source', 'unresolved'] as const);
/** distribution board kind — the source does not decide, the user chooses */
export const BOARD_KINDS = labels('electrical.boardKind', ['unspecified', 'electrical', 'smart', 'teletech'] as const);
export type BoardKind = keyof typeof BOARD_KINDS;
/** what the point serves (coordination with the kitchen, appliances, the surroundings) — suggestions only, the field is free text */
export const PURPOSES = lazyList(['fridge', 'oven', 'hob', 'dishwasher', 'hood', 'smallAppliances', 'microwave', 'washer', 'dryer', 'tv', 'desk', 'bed', 'gatePower', 'gateControl',
  'wicketLock', 'garageDoorDrive', 'pergolaPower', 'pergolaControl', 'gardenLighting', 'evCharger', 'heatPump', 'ventilation'].map((k) => `electrical.purpose.${k}`));

export interface ElPoint {
  id: string;
  type: ElType;
  /** room (id from the building data) or EXT */
  roomId: string;
  /** room wall (or building outline edge for EXT); null — ceiling / free point, location in (x, y) */
  wallId: string | null;
  /** distance along the wall from its start (wall.a) [m]; the report and the inspector convert it to the distance from the left corner */
  positionAlongWall: number;
  /** height of the point axis above the finished floor (AFFL) [m]; outside — above the ground / paving */
  heightAFFL: number;
  orientation: 'wall' | 'ceiling' | 'free';
  /** points without a wall (ceiling, site): location in plan (LCS) */
  x?: number; y?: number;
  /** number of modules / sockets in the frame */
  modules: number;
  label: string;
  circuitLabel?: string;
  notes?: string;
  purpose?: string;
  smartHome: SmartMode;
  /** where the point comes from: 'user' or a source name */
  source: string;
  status: ElStatus;
  /** distribution board: kind and approximate width [m] */
  boardKind?: BoardKind;
  width?: number;
  /** links for a future Smart Home Planner (optional; no UI yet — written and read back losslessly) */
  smart?: SmartLinks;
}
/**
 * Fields of a future Smart Home Planner: device links and membership. Placement does not depend on these fields — extending
 * them requires no changes to the placement engine or the position record.
 */
export interface SmartLinks {
  /** ids of the points that control this device / that this device controls */
  controlledBy?: string[];
  controls?: string[];
  sensorType?: string;
  automationGroup?: string;
  network?: string;
  bus?: string;
}
export const SMART_LINK_KEYS = ['controlledBy', 'controls', 'sensorType', 'automationGroup', 'network', 'bus'] as const;
export function smartLinksErrors(x: unknown, where: string): string[] {
  if (x === undefined) return [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return [`${where}: smart home links object`];
  const e: string[] = [], o = x as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(SMART_LINK_KEYS as readonly string[]).includes(k)) e.push(`${where}.${k}: unknown field`);
  for (const k of ['controlledBy', 'controls'] as const) if (o[k] !== undefined && !(Array.isArray(o[k]) && (o[k] as unknown[]).every((v) => typeof v === 'string'))) e.push(`${where}.${k}: list of ids`);
  for (const k of ['sensorType', 'automationGroup', 'network', 'bus'] as const) if (o[k] !== undefined && typeof o[k] !== 'string') e.push(`${where}.${k}: text`);
  return e;
}
export interface ElectricalPlan {
  version: 1; points: ElPoint[];
  /** highest ISSUED id number per prefix (G, W, L…) — written when the point with the highest number is removed,
   *  so that the next point does not get it (a printed plan must not point at a different device). Optional field, no version
   *  change: a plan without the field is valid and gets it only on such a removal. */
  lastId?: Record<string, number>;
}

// ------------------------------------------------------------------ walls, wall runs, building outline
/** building outline at ground level (exterior faces) — the walls of the virtual EXT room; empty when the project has no site */
export const houseFootprint = (): Vec2[] => project().site?.footprint ?? [];
/** plot boundary — background of the "Site" plan; empty when the project has no site */
export const plotBoundary = (): Vec2[] => project().site?.boundary ?? [];
/** whether the project has ground around the building (facades and points on the site) */
export const hasSite = (): boolean => !!project().site;
/** level from which one exits to the site (null — project without a site) */
export const siteLevelId = (): LevelId | null => project().site?.levelId ?? null;

// spaces, walls and wall runs — the shared mounting-surface model (model/mount.ts); the names used by the planner
export { EXT, mountSpace as elRoom, mountSpaces as elRooms, mountWall as elWall, wallRuns, type MountSpace as ElRoom, type MountWall as ElWall, type WallRun } from './mount';
import { EXT, mountSpace as elRoom, wallRuns, type MountSpace as ElRoom, type MountWall as ElWall, type WallRun } from './mount';

export interface ElMeasure {
  room: ElRoom; wall: ElWall | null; run: WallRun | null;
  /** distance along the wall from the LEFT corner of the run, looking at the wall from the point's side (from inside the room), and from the right [m] */
  fromLeft: number | null; fromRight: number | null;
  /** position in LCS: point on the wall face (or ceiling / free point), absolute height relative to ±0.00 and normal into the room */
  pos: Vec3; normal: Vec2;
  wallLabel: string;
}
/** position and reference dimensions of a point; null — the point refers to a non-existent room / wall */
export function measure(p: ElPoint): ElMeasure | null {
  const room = elRoom(p.roomId);
  if (!room) return null;
  if (p.wallId === null || p.orientation !== 'wall') {
    const x = p.x ?? 0, y = p.y ?? 0, z = p.orientation === 'ceiling' ? room.floorZ + room.ceilingAt(x, y) : room.floorZ + p.heightAFFL;
    return { room, wall: null, run: null, fromLeft: null, fromRight: null, pos: [x, y, z], normal: [0, 0], wallLabel: p.orientation === 'ceiling' ? t('electrical.ceiling') : '—' };
  }
  const wall = room.walls.find((w) => w.id === p.wallId);
  if (!wall) return null;
  const run = wallRuns(room.id).find((r) => r.walls.includes(wall))!;
  let before = 0;
  for (const w of run.walls) { if (w === wall) break; before += w.length; }
  const s = before + p.positionAlongWall;                    // from the run start (a) — the right corner looking from inside
  return {
    room, wall, run, fromRight: s, fromLeft: run.length - s,
    pos: [wall.a[0] + wall.dir[0] * p.positionAlongWall, wall.a[1] + wall.dir[1] * p.positionAlongWall, room.floorZ + p.heightAFFL], normal: wall.inward,
    wallLabel: `${run.index} · ${run.side}`,
  };
}

// ------------------------------------------------------------------ plan: defaults, saving, validation
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** room wall nearest to a plan point: wall, t along the wall, distance */
export function nearestElWall(room: ElRoom, q: Vec2): { wall: ElWall; t: number; d: number } {
  let best = { wall: room.walls[0], t: 0, d: Infinity };
  for (const w of room.walls) { const s = segDist(q, w.a, w.b); if (s.d < best.d) best = { wall: w, t: s.t * w.length, d: s.d }; }
  return best;
}

/** points from the project sources (distribution boards from the user's drawing) placed on the model walls */
export function defaultPlan(): ElectricalPlan {
  const pts: ElPoint[] = [];
  for (const d of project().electrical.points) {
    const room = elRoom(d.roomId);
    if (!room || !isElType(d.type)) continue;
    const n = nearestElWall(room, [d.x, d.y]);
    if (n.d > 0.05) continue;                              // the source point does not lie on a model wall — no guessing
    pts.push({ id: d.id, type: d.type, roomId: d.roomId, wallId: n.wall.id, positionAlongWall: round(n.t), heightAFFL: d.heightAFFL, orientation: 'wall', modules: 1, label: d.label, notes: d.notes,
      smartHome: 'none', source: d.source, status: d.status as ElStatus, ...(d.type === 'board' ? { boardKind: 'unspecified' as BoardKind, width: d.width } : {}) });
  }
  return { version: 1, points: pts };
}
const sourcePlan = derived(() => defaultPlan());
/** effective plan: the variant's own → the document's global → points from the sources */
export function resolvePlan(docPlan: ElectricalPlan | null | undefined, variantPlan?: ElectricalPlan | null): ElectricalPlan {
  return variantPlan ?? docPlan ?? sourcePlan();
}

export const EL_LIMITS = { height: [0, 3.2, 0.01], modules: [1, 6, 1], width: [0.2, 1.6, 0.01] } as const;

export function planErrors(p: unknown, where = 'electrical'): string[] {
  if (p === undefined || p === null) return [];
  const e: string[] = [], x = p as ElectricalPlan;
  if (typeof p !== 'object' || x.version !== 1 || !Array.isArray(x.points)) return [`${where}: expected { version: 1, points: [] }`];
  if (x.points.length > 2000) e.push(`${where}: at most 2000 points`);
  const ids = new Set<string>();
  x.points.forEach((q, i) => {
    const tag = `${where}.points[${i}]`;
    if (!q || typeof q !== 'object') { e.push(`${tag}: object`); return; }
    if (typeof q.id !== 'string' || !q.id || ids.has(q.id)) e.push(`${tag}.id: unique id`);
    ids.add(q.id);
    if (!isElType(q.type)) { e.push(`${tag}.type: unknown type "${String(q.type)}"`); return; }
    const room = elRoom(q.roomId);
    if (!room) { e.push(`${tag}.roomId: unknown room "${String(q.roomId)}"`); return; }
    if (!['wall', 'ceiling', 'free'].includes(q.orientation)) e.push(`${tag}.orientation: wall | ceiling | free`);
    if (q.orientation === 'wall') {
      const w = room.walls.find((v) => v.id === q.wallId);
      if (!w) e.push(`${tag}.wallId: unknown wall "${String(q.wallId)}"`);
      else if (!fin(q.positionAlongWall) || q.positionAlongWall < -1e-6 || q.positionAlongWall > w.length + 1e-6) e.push(`${tag}.positionAlongWall: 0–${w.length.toFixed(2)} m`);
    } else if (!fin(q.x) || !fin(q.y) || Math.abs(q.x) > 80 || Math.abs(q.y) > 80) e.push(`${tag}: position x, y [m]`);
    if (!fin(q.heightAFFL) || q.heightAFFL < -0.5 || q.heightAFFL > 8) e.push(`${tag}.heightAFFL: −0.5–8 m`);
    if (!Number.isInteger(q.modules) || q.modules < 1 || q.modules > 6) e.push(`${tag}.modules: 1–6`);
    if (typeof q.label !== 'string') e.push(`${tag}.label: text`);
    if (!(q.smartHome in SMART_MODES)) e.push(`${tag}.smartHome: ${Object.keys(SMART_MODES).join(' | ')}`);
    if (!(q.status in EL_STATUS)) e.push(`${tag}.status: ${Object.keys(EL_STATUS).join(' | ')}`);
    if (typeof q.source !== 'string') e.push(`${tag}.source: text`);
    for (const k of ['circuitLabel', 'notes', 'purpose'] as const) if (q[k] !== undefined && typeof q[k] !== 'string') e.push(`${tag}.${k}: text`);
    if (q.boardKind !== undefined && !(q.boardKind in BOARD_KINDS)) e.push(`${tag}.boardKind`);
    if (q.width !== undefined && !(fin(q.width) && q.width >= 0.1 && q.width <= 3)) e.push(`${tag}.width: 0.1–3 m`);
    e.push(...smartLinksErrors(q.smart, `${tag}.smart`));
  });
  if (x.lastId !== undefined && !(!!x.lastId && typeof x.lastId === 'object' && !Array.isArray(x.lastId) && Object.values(x.lastId).every((v) => Number.isInteger(v) && v >= 0))) e.push(`${where}.lastId: highest issued numbers (prefix → integer ≥ 0)`);
  return e;
}

// ------------------------------------------------------------------ operations
/** next id of the given type: category prefix + number (numbers are never reused within a plan — including the number
 *  of a removed LAST point: `lastId`) */
export function nextId(plan: ElectricalPlan, type: ElType): string {
  const pre = EL_TYPES[type].prefix;
  let n = plan.lastId?.[pre] ?? 0;
  for (const p of plan.points) { const m = new RegExp(`^${pre}(\\d+)$`).exec(p.id); if (m) n = Math.max(n, Number(m[1])); }
  return `${pre}${n + 1}`;
}
/**
 * Snaps the distance along the wall to the grid (0 — no snapping), measured from the LEFT corner of the run. The `margin`
 * keeps the device away from a CORNER — the end of the wall run — not from the joint between segments of the same straight wall:
 * a margin measured from the end of every segment would leave 5 cm on both sides of a joint, so a device moved along the wall would stop
 * and jump by 10 cm, and one grid position would be unreachable.
 */
export function snapAlong(room: ElRoom, wall: ElWall, t: number, step: number, margin = 0.05): number {
  const run = wallRuns(room.id).find((r) => r.walls.includes(wall))!;
  const m = Math.min(margin, wall.length / 2), lo = run.walls[0] === wall ? m : 0, hi = run.walls[run.walls.length - 1] === wall ? wall.length - m : wall.length;
  const lim = (v: number) => Math.max(lo, Math.min(hi, v));
  if (!(step > 0)) return round(lim(t));
  let before = 0;
  for (const w of run.walls) { if (w === wall) break; before += w.length; }
  const fromLeft = run.length - (before + t), snapped = Math.round(fromLeft / step) * step;
  return round(lim(run.length - snapped - before));
}
export const snapHeight = (h: number, step: number) => round(Math.max(0, step > 0 ? Math.round(h / step) * step : h));
/** height typed in the card [cm] → metres; null — empty field or non-numeric text: the device height stays unchanged
 *  (an empty text must not become 0 — a cleared field would put the device on the floor) */
export const parseHeightCm = (text: string): number | null => { const t = text.trim().replace(',', '.'), v = t ? Number(t) : NaN; return Number.isFinite(v) ? v / 100 : null; };

export interface Placement { roomId: string; wallId: string | null; positionAlongWall: number; heightAFFL: number; orientation: ElPoint['orientation']; x?: number; y?: number }
/** position of a new point of the given type from a wall hit (LCS point with height) or a plan hit (no height → the type's default height) */
export function placeOnWall(room: ElRoom, wall: ElWall, hit: Vec2, z: number | null, type: ElType, step = 0): Placement {
  const t = Math.max(0, Math.min(wall.length, (hit[0] - wall.a[0]) * wall.dir[0] + (hit[1] - wall.a[1]) * wall.dir[1]));
  const def = EL_TYPES[type];
  if (def.mount === 'ceiling') return placeFree(room, [wall.a[0] + wall.dir[0] * t + wall.inward[0] * 0.5, wall.a[1] + wall.dir[1] * t + wall.inward[1] * 0.5], type);
  const h = z === null ? def.height : Math.max(0.05, z - room.floorZ);
  return { roomId: room.id, wallId: wall.id, positionAlongWall: snapAlong(room, wall, t, step), heightAFFL: z === null ? def.height : snapHeight(h, step), orientation: 'wall' };
}
/** position on a wall run for a given distance from the LEFT corner: wall segment and distance from its start */
export function alongRun(roomId: string, runIndex: number, fromLeft: number): { wallId: string; positionAlongWall: number } | null {
  const run = wallRuns(roomId).find((r) => r.index === runIndex);
  if (!run) return null;
  let s = Math.max(0.02, Math.min(run.length - 0.02, run.length - fromLeft));
  for (const w of run.walls) { if (s <= w.length + 1e-9) return { wallId: w.id, positionAlongWall: round(Math.min(w.length, s)) }; s -= w.length; }
  const last = run.walls[run.walls.length - 1];
  return { wallId: last.id, positionAlongWall: round(last.length) };
}

/** ceiling point (in a room) or free point (on the site) at a plan position */
export function placeFree(room: ElRoom, q: Vec2, type: ElType, step = 0): Placement {
  const s = (v: number) => round(step > 0 ? Math.round(v / step) * step : v);
  const x = s(q[0]), y = s(q[1]);
  if (room.exterior) return { roomId: EXT, wallId: null, positionAlongWall: 0, heightAFFL: EL_TYPES[type].mount === 'ceiling' ? 0.3 : EL_TYPES[type].height, orientation: 'free', x, y };
  return { roomId: room.id, wallId: null, positionAlongWall: 0, heightAFFL: round(room.ceilingAt(x, y), 2), orientation: 'ceiling', x, y };
}
/** new point in the plan (id, the type's defaults) */
export function addPoint(plan: ElectricalPlan, type: ElType, at: Placement, extra: Partial<ElPoint> = {}): { plan: ElectricalPlan; point: ElPoint } {
  const def = EL_TYPES[type];
  const point: ElPoint = { id: nextId(plan, type), type, ...at, modules: def.modules, label: '', smartHome: def.smart, source: 'user', status: 'planned', ...(type === 'board' ? { boardKind: 'unspecified' as BoardKind, width: 0.6 } : {}), ...extra };
  return { plan: { ...plan, points: [...plan.points, point] }, point };
}
export const updatePoint = (plan: ElectricalPlan, id: string, patch: Partial<ElPoint>): ElectricalPlan => ({ ...plan, points: plan.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
/** removes a point; when it had the highest number of its prefix — the number is remembered (`lastId`) and never reused */
export function removePoint(plan: ElectricalPlan, id: string): ElectricalPlan {
  const points = plan.points.filter((p) => p.id !== id), k = points.length < plan.points.length ? /^([A-Za-z]+)(\d+)$/.exec(id) : null, n = k ? Number(k[2]) : 0;
  const top = !!k && n > (plan.lastId?.[k[1]] ?? 0) && !points.some((p) => { const q = idKey(p.id); return q[0] === k[1] && q[1] > n; });
  return top ? { ...plan, points, lastId: { ...plan.lastId, [k![1]]: n } } : { ...plan, points };
}
/** type change keeping the position; module count and smart mode — the new type's defaults when they were the old type's defaults */
export function retype(p: ElPoint, type: ElType): Partial<ElPoint> {
  const a = EL_TYPES[p.type], b = EL_TYPES[type];
  return { type, modules: p.modules === a.modules ? b.modules : p.modules, smartHome: p.smartHome === a.smart ? b.smart : p.smartHome };
}

export const layerOf = (t: ElType): ElLayer => EL_TYPES[t].layer;
/** whether the device is drawn: it exists in the plan and its layer is on (only what is visible can be selected) */
export const pointShown = (plan: ElectricalPlan, id: string, layers: Record<ElLayer, boolean>): boolean => { const p = plan.points.find((x) => x.id === id); return !!p && !!layers[layerOf(p.type)]; };
export const pointsOfLevel = (plan: ElectricalPlan, level: LevelId): ElPoint[] => plan.points.filter((p) => elRoom(p.roomId)?.level === level);
export const inGroup = (p: ElPoint, g: ElPdfGroup | 'all') => PDF_GROUPS[g].layers.includes(layerOf(p.type));

// ------------------------------------------------------------------ coordination warnings (information only — nothing is removed)
export interface ElWarning { id: string; kind: 'door' | 'furniture' | 'sanitary' | 'opening'; text: string }
export interface CoordContext {
  /** door leaves in the open position: plan segment [a, b] and name */
  doorLeaves: { roomIds: string[]; a: Vec2; b: Vec2; name: string }[];
  /** room fittings: plan outline, height range above the floor, name, whether sanitary / tall built-in */
  furniture: { roomId: string; corners: Vec2[]; z0: number; z1: number; name: string; sanitary: boolean; builtIn: boolean }[];
}
const inPoly = (q: Vec2, c: Vec2[]) => { let s = false; for (let i = 0, j = c.length - 1; i < c.length; j = i++) if ((c[i][1] > q[1]) !== (c[j][1] > q[1]) && q[0] < ((c[j][0] - c[i][0]) * (q[1] - c[i][1])) / (c[j][1] - c[i][1]) + c[i][0]) s = !s; return s; };
export function pointWarnings(p: ElPoint, ctx: CoordContext): ElWarning[] {
  const m = measure(p), out: ElWarning[] = [];
  if (!m || !m.wall) return out;
  const q: Vec2 = [m.pos[0] + m.normal[0] * 0.06, m.pos[1] + m.normal[1] * 0.06];
  // point inside the clear opening (door, window) of this wall
  const hole = (m.wall as RoomWall).holes?.find((h) => p.positionAlongWall > h.t0 && p.positionAlongWall < h.t1 && p.heightAFFL > h.z0 && p.heightAFFL < h.z1);
  if (hole) out.push({ id: p.id, kind: 'opening', text: t('electrical.warn.inOpening', { id: p.id, kind: hole.kind === 'door' || hole.kind === 'passage' ? t('electrical.door') : t('electrical.window'), hole: hole.id }) });
  // behind the leaf of an open door: the leaf lies against the wall less than 12 cm from the point
  if (p.heightAFFL < 2.05) for (const d of ctx.doorLeaves) {
    if (!d.roomIds.includes(p.roomId)) continue;
    const s = segDist(q, d.a, d.b);
    if (s.d < 0.12 && s.t > 0.02) { out.push({ id: p.id, kind: 'door', text: t('electrical.warn.behindDoor', { id: p.id, name: d.name }) }); break; }
  }
  for (const f of ctx.furniture) {
    if (f.roomId !== p.roomId || p.heightAFFL < f.z0 - 0.02 || p.heightAFFL > f.z1 + 0.02 || !inPoly(q, f.corners)) continue;
    if (f.sanitary) out.push({ id: p.id, kind: 'sanitary', text: t('electrical.warn.sanitary', { id: p.id, name: f.name }) });
    else if (f.builtIn) out.push({ id: p.id, kind: 'furniture', text: t('electrical.warn.builtIn', { id: p.id, name: f.name }) });
    else continue;
    break;
  }
  return out;
}

// ------------------------------------------------------------------ point table (PDF, CSV, JSON)
export interface ElRow {
  id: string; room: string; roomId: string; level: LevelId; type: string; typeId: ElType; wall: string;
  /** distance from the left corner [cm] and AFFL height [cm]; null — not applicable (ceiling / site) */
  distance: number | null; distanceRight: number | null; height: number | null;
  quantity: number; description: string; smartHome: string; circuit: string; notes: string;
  x: number; y: number; z: number; source: string; status: string; layer: ElLayer;
}
const cm = (m: number) => Math.round(m * 100);
export function rowOf(p: ElPoint): ElRow | null {
  const m = measure(p);
  if (!m) return null;
  const def = EL_TYPES[p.type], desc = [p.label, p.purpose, p.type === 'board' ? `${BOARD_KINDS[p.boardKind ?? 'unspecified']}${p.width ? t('electrical.boardWidth', { cm: cm(p.width) }) : ''}` : ''].filter(Boolean).join(' · ');
  return {
    id: p.id, room: m.room.exterior ? t('mount.outside') : `${m.room.id} ${m.room.name}`, roomId: m.room.id, level: m.room.level, type: def.name, typeId: p.type, wall: m.wallLabel,
    distance: m.fromLeft === null ? null : cm(m.fromLeft), distanceRight: m.fromRight === null ? null : cm(m.fromRight), height: p.orientation === 'ceiling' ? null : cm(p.heightAFFL),
    quantity: p.modules, description: desc, smartHome: SMART_MODES[p.smartHome], circuit: p.circuitLabel ?? '', notes: [p.notes, p.status !== 'planned' ? EL_STATUS[p.status] : ''].filter(Boolean).join(' · '),
    x: round(m.pos[0]), y: round(m.pos[1]), z: round(m.pos[2]), source: p.source, status: p.status, layer: def.layer,
  };
}
const idKey = (id: string) => { const m = /^([A-Za-z]+)(\d+)$/.exec(id); return m ? [m[1], Number(m[2])] as const : [id, 0] as const; };
export const byId = (a: { id: string }, b: { id: string }) => { const x = idKey(a.id), y = idKey(b.id); return x[0] === y[0] ? x[1] - y[1] : x[0].localeCompare(y[0]); };
/** table rows: level → room → id */
export function planRows(plan: ElectricalPlan, group: ElPdfGroup | 'all' = 'all'): ElRow[] {
  const rows = plan.points.filter((p) => inGroup(p, group)).map(rowOf).filter((r): r is ElRow => !!r);
  const lv = (r: ElRow) => levelIndex(r.level) + (r.roomId === EXT ? 0.5 : 0);
  return rows.sort((a, b) => lv(a) - lv(b) || a.roomId.localeCompare(b.roomId) || byId(a, b));
}
export const TABLE_COLUMNS = lazyList(['id', 'room', 'type', 'wall', 'distance', 'height', 'quantity', 'description', 'smartHome', 'circuit', 'notes'].map((k) => `electrical.col.${k}`));
/** location of a point without a wall: site — coordinates; ceiling (no height) and a floor / built-in point (with height) — per plan */
export const distText = (r: ElRow) => (r.distance === null ? (r.roomId === EXT ? `x ${fmtNum(r.x)} / y ${fmtNum(r.y)} m` : r.height === null ? t('electrical.ceilingPerPlan') : t('electrical.floorPerPlan')) : t('electrical.fromLeftCorner', { cm: r.distance }));
export const heightText = (r: ElRow) => (r.height === null ? t('electrical.ceiling') : `${r.height} cm`);
export const tableCells = (r: ElRow): string[] => [r.id, r.room, r.type, r.wall, distText(r), heightText(r), String(r.quantity), r.description, r.smartHome, r.circuit, r.notes];

/** CSV cell; TEXT starting with = + - @ (tab, CR) gets an apostrophe — the spreadsheet will not execute a description as a formula */
const csvCell = (v: string | number | null) => { const s = v === null ? '' : typeof v === 'number' ? String(v) : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** metres with the UI language's decimal separator: a spreadsheet with comma-decimal locale settings reads "1.1" as a date */
const csvMetres = (v: number) => (lang() === 'pl' ? String(v).replace('.', ',') : String(v));
/** CSV (semicolon, UTF-8 with BOM, decimal separator of the UI language — opens correctly in spreadsheets with matching locale settings) */
export function toCsv(plan: ElectricalPlan): string {
  const head = ['id', 'room', 'level', 'type', 'wall', 'fromLeft', 'fromRight', 'height', 'quantity', 'description', 'smartHome', 'circuit', 'notes', 'status', 'source', 'x', 'y', 'z'].map((k) => t(`electrical.csv.${k}`));
  const lines = planRows(plan).map((r) => [...[r.id, r.room, levelName(r.level).toLowerCase(), r.type, r.wall, r.distance, r.distanceRight, r.height, r.quantity, r.description, r.smartHome, r.circuit, r.notes, EL_STATUS[r.status as ElStatus] ?? r.status, r.source].map(csvCell), csvMetres(r.x), csvMetres(r.y), csvMetres(r.z)].join(';'));
  return `﻿${[head.join(';'), ...lines].join('\r\n')}\r\n`;
}
export const EL_DISCLAIMER = lazyList(['electrical.disclaimer1', 'electrical.disclaimer2', 'electrical.disclaimer3']);
/** export JSON: points with their source data and computed reference dimensions */
export function toJson(plan: ElectricalPlan, meta: { project: string; exportedAt: string; scope: string }): string {
  const rows = new Map(planRows(plan).map((r) => [r.id, r]));
  return `${JSON.stringify({
    schema: 'home-simulator/electrical-points', version: 1, ...meta, disclaimer: EL_DISCLAIMER.join(' '),
    reference: 'positionAlongWall — from the start of the wall segment in the model; fromLeftCm / fromRightCm — from the wall corners looking from inside the room; heightAFFL — above the finished floor; x, y, z — building LCS [m], z relative to ±0.00',
    points: plan.points.map((p) => { const r = rows.get(p.id); return { ...p, room: r?.room ?? null, wall: r?.wall ?? null, fromLeftCm: r?.distance ?? null, fromRightCm: r?.distanceRight ?? null, lcs: r ? { x: r.x, y: r.y, z: r.z } : null }; }),
  }, null, 1)}\n`;
}
