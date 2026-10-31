// PROJECT BOUNDARY — semantic validation of a project package before activation: data errors must surface at load time
// as a readable list, not as an exception deep inside the scene. Pure TS on the package data (no active project).
// Structure (types, required fields) is checked by the zod schema (./schema); this file checks meaning: an enabled module
// MUST have its data; cross references (room ↔ level, door ↔ rooms, furniture ↔ room) must resolve.
import { outOfRange, rangeMessage } from '@home-sim/core/package/range';
import { PROJECT_CAPABILITIES, type ProjectModule, type ProjectPackage } from './types';

const AXIS_TOL = 1e-6;
/** ids the engine uses for its own concepts — a package may not name a room, level or view with them */
const RESERVED_ROOM_IDS = ['EXT', 'exterior'], SITE_LEVEL = 'SITE';
export const RESERVED_VIEW_IDS = ['interior', 'room', 'bookmark', 'pose'];

/** data required by a module: description of what is missing, or null when the package has it */
const MODULE_DATA: Record<ProjectModule, (p: ProjectPackage) => string | null> = {
  site: (p) => (p.site ? null : 'the building and plot outline (site)'),
  environment: (p) => (p.assets?.environment ? null : 'a surroundings model (assets.environment)'),
  sun: (p) => (p.sun ? null : 'geographic position, orientation and time zone (sun)'),
  stairs: (p) => (p.building.stairs?.length ? null : 'stairs (building.stairs)'),
};

/**
 * Errors of a project package (empty list — the package is valid). `catalogIds` — furniture catalog ids used to check the
 * default arrangement (skipped when not given).
 */
export function validateProject(p: ProjectPackage, catalogIds?: ReadonlySet<string>): string[] {
  const e: string[] = [], m = p.manifest, data = p.building.rooms;
  // --- format, manifest ↔ levels
  if (p.schema !== 'home-simulator/project') e.push(`unknown package schema: ${String(p.schema)}`);
  if (p.version !== 1) e.push(`unsupported package version: ${String(p.version)}`);
  if (m.units !== 'm') e.push('package units must be metres');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(m.projectId)) e.push(`manifest.projectId "${m.projectId}": use lower-case letters, digits and hyphens`);
  const levelIds = new Set(Object.keys(data.levels));
  if (!levelIds.size) e.push('package without levels');
  if (levelIds.has(SITE_LEVEL)) e.push(`level "${SITE_LEVEL}": id reserved by the engine (site plan)`);
  for (const l of m.levels) {
    const d = data.levels[l.id];
    if (!d) e.push(`manifest.levels: level "${l.id}" is missing from building.rooms.levels`);
    else if (Math.abs(d.floor_z - l.floorZ) > 1e-9) e.push(`manifest.levels: level "${l.id}" has a different floor (${l.floorZ}) than the room data (${d.floor_z})`);
  }
  for (const id of levelIds) if (!m.levels.some((l) => l.id === id)) e.push(`manifest.levels: level "${id}" from building.rooms.levels is missing`);
  if (!levelIds.has(m.defaultView.levelId)) e.push(`manifest.defaultView: unknown level "${m.defaultView.levelId}"`);
  if (new Set(m.modules).size !== m.modules.length) e.push('manifest.modules: repeated module');
  for (const c of m.capabilities) if (!PROJECT_CAPABILITIES.includes(c)) e.push(`manifest.capabilities: unknown capability "${String(c)}"`);
  // --- rooms
  const roomIds = new Set<string>(), openingIds = new Set<string>();
  let orthogonal = true;
  for (const r of data.rooms) {
    if (roomIds.has(r.id)) e.push(`room "${r.id}": repeated id`);
    if (RESERVED_ROOM_IDS.includes(r.id)) e.push(`room "${r.id}": id reserved by the engine (exterior space)`);
    roomIds.add(r.id);
    if (!levelIds.has(r.level)) e.push(`room "${r.id}": unknown level "${r.level}"`);
    if (r.polygon.length < 3) e.push(`room "${r.id}": outline has fewer than 3 points`);
    // walls along the plan axes or at 45° to them (within 1.5°)
    r.polygon.forEach((a, i) => { const b = r.polygon[(i + 1) % r.polygon.length], dx = b[0] - a[0], dy = b[1] - a[1]; if (Math.abs(dx) > AXIS_TOL && Math.abs(dy) > AXIS_TOL && Math.abs(Math.abs(Math.atan2(Math.abs(dy), Math.abs(dx))) - Math.PI / 4) > (1.5 * Math.PI) / 180) orthogonal = false; });
    for (const o of r.openings) { if (openingIds.has(o.id)) e.push(`room "${r.id}": window "${o.id}" — repeated id`); openingIds.add(o.id); }
  }
  if (!data.rooms.length) e.push('package without rooms');
  // level section, plan and camera framing are computed from the room outlines of a level — an empty level shows nothing
  else for (const id of levelIds) if (!data.rooms.some((r) => r.level === id)) e.push(`level "${id}": no rooms (every level needs at least one)`);
  if (m.defaultView.roomId && !roomIds.has(m.defaultView.roomId)) e.push(`manifest.defaultView: unknown room "${m.defaultView.roomId}"`);
  // --- numbers: plain metres near the origin (the solid kernel stops on a coordinate of 1e30, the camera framing breaks)
  const far = outOfRange(p);
  if (far.length) e.push(rangeMessage(far));
  // --- shell: without a file-based model the engine builds it from the outlines — walls along the axes or at 45°
  if (!p.assets?.model && !orthogonal) e.push('a project without a building model file (assets.model) needs room walls along the plan axes or at 45° to them — the generated shell does not build other angles');
  // --- doors
  const doorIds = new Set<string>();
  for (const d of p.building.doors) {
    if (doorIds.has(d.id)) e.push(`door "${d.id}": repeated id`);
    doorIds.add(d.id);
    if (!levelIds.has(d.level)) e.push(`door "${d.id}": unknown level "${d.level}"`);
    for (const r of d.rooms) if (r !== 'exterior' && !roomIds.has(r)) e.push(`door "${d.id}": unknown room "${r}"`);
  }
  for (const r of data.rooms) for (const d of r.doors) if (d.door_id && !doorIds.has(d.door_id)) e.push(`room "${r.id}": door gap points to unknown door "${d.door_id}"`);
  for (const id of Object.keys(p.building.doorFacts?.overrides ?? {})) if (!doorIds.has(id)) e.push(`doorFacts.overrides: unknown door "${id}"`);
  // --- stairs
  for (const s of p.building.stairs ?? []) for (const l of [s.fromLevel, s.toLevel]) if (!levelIds.has(l)) e.push(`stairs "${s.id}": unknown level "${l}"`);
  // --- roof: parts on known levels; dormers on known parts with their windows in rooms; a ceiling under the roof needs a part on its level
  const roof = p.building.roof, partIds = new Set<string>(), roofLevels = new Set(roof?.parts.map((x) => x.level) ?? []);
  for (const part of roof?.parts ?? []) {
    if (partIds.has(part.id)) e.push(`roof part "${part.id}": repeated id`);
    partIds.add(part.id);
    if (!levelIds.has(part.level)) e.push(`roof part "${part.id}": unknown level "${part.level}"`);
    if (part.type !== 'flat' && !part.rect) e.push(`roof part "${part.id}": a ${part.type} part needs a rect (a polygon is for flat parts only)`);
  }
  for (const d of roof?.dormers ?? []) {
    if (!partIds.has(d.part)) e.push(`dormer "${d.id}": unknown roof part "${d.part}"`);
    if (d.window && !roomIds.has(d.window.roomId)) e.push(`dormer "${d.id}": window in unknown room "${d.window.roomId}"`);
  }
  for (const r of data.rooms) if (r.ceiling.kind === 'roof' && !roofLevels.has(r.level)) e.push(`room "${r.id}": its ceiling is under the roof but level "${r.level}" has no roof part`);
  // --- default furnishing and electrical
  const keys = new Set<string>();
  for (const it of p.interiors.items) {
    if (keys.has(it.key)) e.push(`furniture "${it.key}": repeated key`);
    keys.add(it.key);
    if (!roomIds.has(it.room)) e.push(`furniture "${it.key}": unknown room "${it.room}"`);
  }
  for (const roomId of Object.keys(p.interiors.extra ?? {})) if (!roomIds.has(roomId)) e.push(`interiors.extra: unknown room "${roomId}"`);
  if (catalogIds) {
    const placed = [...p.interiors.items.map((it) => ({ what: `furniture "${it.key}"`, id: it.catalogId })), ...Object.values(p.interiors.extra ?? {}).flat().map((f) => ({ what: `interiors.extra "${f.id}"`, id: f.catalogId }))];
    for (const q of placed) if (!catalogIds.has(q.id)) e.push(`${q.what}: unknown catalog item "${q.id}"`);
  }
  for (const id of Object.keys(p.interiors.notes ?? {})) if (!roomIds.has(id)) e.push(`interiors.notes: unknown room "${id}"`);
  const pointIds = new Set<string>();
  for (const q of p.electrical.points) {
    if (pointIds.has(q.id)) e.push(`electrical point "${q.id}": repeated id`);
    pointIds.add(q.id);
    if (!roomIds.has(q.roomId)) e.push(`electrical point "${q.id}": unknown room "${q.roomId}"`);
  }
  // --- site, views
  if (p.site && !levelIds.has(p.site.levelId)) e.push(`site.levelId: unknown level "${p.site.levelId}"`);
  for (const v of p.viewpoints ?? []) if (v.level !== SITE_LEVEL ? !levelIds.has(v.level) : !p.site) e.push(`viewpoint "${v.id}": ${v.level === SITE_LEVEL ? 'the project has no site' : `unknown level "${v.level}"`}`);
  if (p.views) {
    const ids = new Set(p.views.presets.map((v) => v.id));
    if (!p.views.presets.length) e.push('views.presets: empty list (omit the field to use the default views)');
    if (ids.size !== p.views.presets.length) e.push('views.presets: repeated id');
    for (const reserved of RESERVED_VIEW_IDS) if (ids.has(reserved)) e.push(`views.presets: id "${reserved}" is reserved`);
    if (p.views.home && !ids.has(p.views.home)) e.push(`views.home: unknown view "${p.views.home}"`);
    for (const v of p.views.presets) if (!v.dir && !v.pose) e.push(`view "${v.id}": needs a direction (dir) or a camera pose (pose)`);
  }
  // --- modules: every enabled one must have its data
  for (const mod of m.modules) {
    const check = MODULE_DATA[mod];
    if (!check) { e.push(`manifest.modules: unknown module "${String(mod)}"`); continue; }
    const missing = check(p);
    if (missing) e.push(`module "${mod}" requires ${missing}`);
  }
  return e;
}
