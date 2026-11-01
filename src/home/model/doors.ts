// Doors — pure TS (tests without a browser).
// Definitions come from the project package (project().building.doors): opening, leaf, hinge, opening direction and angle, type,
// rooms on both sides — door behaviour follows from this data only. Facts beyond geometry (decisions about
// specific doors, exterior joinery opened in walk mode) — project().building.doorFacts.
// User state (open / closed, "Show doors") is separate (DoorState) — it neither changes nor removes door definitions.
import { derived } from '../../project/active';
import type { LevelId, Vec2 } from './types';
import { doorLeaves, type LeafSegment } from '@home-sim/core/model/doors';
import { gapFrame, lineC, linePt, lineT } from '@home-sim/core/model/wallLine';
import type { DoorDef, DoorType } from '@home-sim/core/package/types';
export type { DoorDef, DoorType } from '@home-sim/core/package/types';

interface DoorsModel { all: DoorDef[]; byId: Map<string, DoorDef>; interactive: DoorDef[] }
const model = derived((p): DoorsModel => {
  const over = p.building.doorFacts?.overrides ?? {};
  const all = p.building.doors.map((d) => (over[d.id] ? { ...d, flush: over[d.id].flush, source: [...d.source, over[d.id].source] } : d));
  return { all, byId: new Map(all.map((d) => [d.id, d])), interactive: all.filter(isInteractive) };
});
/** all doors of the project */
export const allDoors = (): DoorDef[] => model().all;
export const doorById = (id: string | null | undefined): DoorDef | null => (id ? model().byId.get(id) ?? null : null);
export const doorsOfLevel = (level: LevelId): DoorDef[] => model().all.filter((d) => d.level === level);
export const doorsOfRoom = (roomId: string): DoorDef[] => model().all.filter((d) => d.rooms.includes(roomId));

/** doors the engine draws and opens itself (every door with a hinge, a sliding track or overhead tracks, also doors to the exterior) */
export function isInteractive(d: DoorDef) { return d.hinge !== null || d.slide !== null || !!d.lift; }
export const interactiveDoors = (): DoorDef[] => model().interactive;

/** i18n keys of door types */
export const doorTypeKey = (t: DoorType): string => `doors.type.${t}`;

/** whether a door has an open state (interactive door of the door model) */
export const isOperable = (id: string): boolean => { const d = doorById(id); return !!d && isInteractive(d); };

/** leaf thickness [m] */
export const LEAF_T = 0.04;
/** opening degree (0…1) from which the door can be passed through */
export const PASS_OPEN = 0.6;
/** full open / close time [s] */
export const DOOR_ANIM_S = 0.55;
/** full open / close time of a sectional (overhead) door — its panels run the whole way up and under the ceiling [s] */
export const LIFT_ANIM_S = 2.4;
/** full open / close time of a door [s] */
export const animSeconds = (id: string) => (doorById(id)?.lift ? LIFT_ANIM_S : DOOR_ANIM_S);
/** longest door animation of the project [s] (how long rendering continues after a state change) */
export const maxAnimSeconds = () => (model().interactive.some((d) => d.lift) ? LIFT_ANIM_S : DOOR_ANIM_S);

const clamp01 = (t: number): number => Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));

export { doorLeaves, leafAngle, leafCount, leafWidthOf, liftLevel, sectionCount, sectionPose, swingArcs, swingDepth, type LeafSegment } from '@home-sim/core/model/doors';

/** the first leaf in plan at opening t (a → b: from the hinge edge / the start of a sliding leaf) — every leaf: doorLeaves */
export const leafSegment = (d: DoorDef, t: number): LeafSegment | null => doorLeaves(d, t)[0] ?? null;

/** opening centre in plan (on the wall axis) */
export function doorCenter(d: DoorDef): Vec2 {
  const m = (d.opening.from + d.opening.to) / 2, c = d.opening.faces.reduce((s, v) => s + v, 0) / d.opening.faces.length;
  return linePt(gapFrame(d.opening), m, c);
}

/** whether a point stands in the clear opening (with margin m along and across the wall) — closing a door "on a person" is blocked */
export function inDoorway(d: DoorDef, p: Vec2, m = 0.3): boolean {
  const f = gapFrame(d.opening), t = lineT(f, p), c = lineC(f, p), lo = Math.min(...d.opening.faces), hi = Math.max(...d.opening.faces);
  return t > d.opening.from - 0.05 && t < d.opening.to + 0.05 && c > lo - m && c < hi + m;
}

// ------------------------------------------------------------------ user state
export interface DoorState {
  /** "Show doors": false — leaves hidden (openings and frames remain), no leaf collisions */
  show: boolean;
  /** door opening degree 0…1 (no entry = closed) */
  open: Record<string, number>;
}
export const defaultDoorState = (): DoorState => ({ show: true, open: {} });

export const openOf = (s: DoorState, id: string) => clamp01(s.open[id] ?? 0);

/** whether the door can be passed: "Show doors" off (free passages) or the leaf open at least PASS_OPEN */
export function doorPassable(s: DoorState, id: string): boolean {
  if (!isOperable(id)) return true;
  return !s.show || openOf(s, id) >= PASS_OPEN;
}

export function setDoorOpen(s: DoorState, id: string, t: number): DoorState {
  if (!isOperable(id)) return s;
  const v = Math.round(clamp01(t) * 1000) / 1000;
  if (openOf(s, id) === v) return s;
  const open = { ...s.open };
  if (v === 0) delete open[id]; else open[id] = v;
  return { ...s, open };
}
export const toggleDoor = (s: DoorState, id: string): DoorState => setDoorOpen(s, id, openOf(s, id) >= 0.5 ? 0 : 1);
/** every door with an open state */
export const OPERABLE_IDS = (): string[] => interactiveDoors().map((d) => d.id);
export const setAllDoors = (s: DoorState, t: number): DoorState => OPERABLE_IDS().reduce((acc, id) => setDoorOpen(acc, id, t), s);

/** state serialization (browser preferences): version + only doors that are not closed */
export function serializeDoorState(s: DoorState): string {
  const open = Object.fromEntries(Object.entries(s.open).filter(([id, v]) => isOperable(id) && v > 0).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ v: 1, show: s.show, open });
}
/** state parsing: unknown doors and invalid values are skipped (door definitions may change after a data rebuild) */
export function parseDoorState(raw: string | null | undefined): DoorState {
  const out = defaultDoorState();
  if (!raw) return out;
  try {
    const j = JSON.parse(raw) as { show?: unknown; open?: unknown };
    if (typeof j.show === 'boolean') out.show = j.show;
    if (j.open && typeof j.open === 'object') for (const [id, v] of Object.entries(j.open as Record<string, unknown>)) {
      if (isOperable(id) && typeof v === 'number' && Number.isFinite(v) && v > 0) out.open[id] = Math.round(clamp01(v) * 1000) / 1000;
    }
  } catch { /* corrupted record — default state */ }
  return out;
}
