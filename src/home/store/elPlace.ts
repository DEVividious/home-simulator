// TRANSIENT PLACEMENT STATE: the session of placing / moving a device. While the pointer moves, ONLY this store changes
// (device preview, highlighted wall, dimension badge) — the project, the Undo history, the point list and the meshes of the
// other devices are not touched. The write to USER DESIGN STATE happens once: on pointer release / tap (commitPlace) — one
// drag = one history entry.
// Two mechanisms of the shared mounting-surface engine (the same ones used by wall-mounted furniture):
//   • POINTING — new device / copy / plan: the spot under the pointer (model/mount.ts → pickFromRay / wallFromPlan),
//   • DRAGGING an existing wall device in 3D and the height handle: model/mountDrag.ts session — wall locked, constant grip,
//     limited gain, transfer around a corner / into another room with a margin.
import { t } from '../../i18n';
import { addElectrical, patchElectrical, planNow } from '../actions';
import { DEVICES } from '../model/devices';
import { elRoom, measure, snapAlong, snapHeight, type ElPoint, type ElType, type Placement } from '../model/electrical';
import { beginFloorDrag, liftFloorDrag, moveFloorDrag, reanchorFloorDrag, type FloorDrag } from '../model/floorDrag';
import { surfaceOfWall, surfaceU, wallAt, type PlanViewId } from '../model/mount';
import { beginMountDrag, moveMountDrag, reanchorMountDrag, type MountBox, type MountDrag, type MountPointer } from '../model/mountDrag';
import {
  alignPlacement, checkPlacement, heightFromHit, maxHeightAt, placementInfo, placementOn, surfaceFromPlan, wallRefOf,
  type AlignGuide, type PlacementCheck, type PlacementInfo, type Surface, type WallRef,
} from '../model/elPlacement';
import { roomById } from '../model/rooms';
import { coordContext } from '../plan/planData';
import { sceneApi } from '../scene/sceneApi';
import type { CoordContext } from '../model/electrical';
import { createStore, useStore } from './createStore';
import { ui } from './ui';

export type PlaceMode = 'new' | 'copy' | 'move' | 'height';
export interface PlaceSession {
  mode: PlaceMode;
  type: ElType;
  /** move / height: the point being moved; copy: the source point; new: none */
  id: string | null;
  /** ADD MANY: the session continues after placing (further taps add further devices) */
  multi: boolean;
  placed: number;
  /** height of the device axis [m] — kept when moving between walls */
  height: number;
  /** current preview placement (the last spot pointed at); ok — the last spot where the device CAN stay */
  at: Placement | null;
  ok: Placement | null;
  /** the pointer is over a valid surface now */
  live: boolean;
  check: PlacementCheck;
  guides: AlignGuide[];
  info: PlacementInfo | null;
  /** pointer pressed (dragging the preview / device) */
  dragging: boolean;
  /** preview position on screen (dimension badge) */
  screen: [number, number] | null;
  touch: boolean;
}
export interface PlaceNote { text: string; level: 'info' | 'warn'; n: number }
export const elPlace = createStore<{ s: PlaceSession | null; note: PlaceNote | null }>({ s: null, note: null });
export const usePlace = <T,>(sel: (s: PlaceSession | null) => T) => useStore(elPlace, (x) => sel(x.s));
export const usePlaceNote = () => useStore(elPlace, (x) => x.note);
export const placeNow = () => elPlace.get().s;

const OK: PlacementCheck = { level: 'ok', messages: [] };
const roomName = (id: string) => { const r = roomById(id); return r ? r.label : id; };
let ctx: CoordContext | null = null, noteN = 0, noteTimer = 0;
/** a short note above the scene (e.g. "Drag onto a wall") — disappears by itself */
export function placeNote(text: string, level: PlaceNote['level'] = 'info', ms = 2200) {
  if (typeof window !== 'undefined') { window.clearTimeout(noteTimer); noteTimer = window.setTimeout(() => elPlace.set({ note: null }), ms); }
  elPlace.set({ note: { text, level, n: ++noteN } });
}
const pointPlacement = (p: ElPoint): Placement => ({ roomId: p.roomId, wallId: p.wallId, positionAlongWall: p.positionAlongWall, heightAFFL: p.heightAFFL, orientation: p.orientation, ...(p.x !== undefined ? { x: p.x, y: p.y } : {}) });
const session = (mode: PlaceMode, type: ElType, id: string | null, height: number, at: Placement | null, extra: Partial<PlaceSession> = {}): PlaceSession => ({
  mode, type, id, multi: false, placed: 0, height, at, ok: at, live: !!at, check: OK, guides: [], info: at ? placementInfo(at, type, roomName) : null, dragging: false, screen: null, touch: false, ...extra,
});
/** starting height of a new device: the last one used for this type or the catalogue default */
export const startHeight = (type: ElType) => ui.get().elHeights[type] ?? DEVICES[type].defaultHeight;

/** a new device from the catalogue: straight into placing mode (no form) */
export function beginNew(type: ElType, multi = ui.get().elMulti) {
  ctx = coordContext();
  ui.set({ selection: null, elPanel: null });
  elPlace.set({ s: session('new', type, null, startHeight(type), null, { multi }) });
}
/** device copy: a preview that can be dragged straight onto any wall */
export function beginCopy(id: string) {
  const p = planNow().points.find((x) => x.id === id);
  if (!p) return;
  ctx = coordContext();
  ui.set({ elPanel: null });
  elPlace.set({ s: session('copy', p.type, id, p.heightAFFL, null) });
}
/** device box on the wall: width from the device definition, v — the device axis; limits as when storing a point (5 cm from the wall end, floor and ceiling) */
export const deviceBox = (p: Pick<ElPoint, 'type' | 'width'>): MountBox => ({
  w: DEVICES[p.type].footprint * (p.type === 'board' ? (p.width ?? 0.6) / 0.6 : 1), h: p.type === 'board' ? 0.5 : 0.085, d: 0.02, anchor: 'center', edge: 0.05, vMin: 0.05, topMargin: 0.05,
});
/** drag session of a wall device over the mounting surface (3D); null — the device is pointed at, not dragged */
let mdrag: MountDrag | null = null;
/**
 * Drag session of a CEILING device or a free point (floor, site) in 3D. The marker of such a device hangs at its height (a
 * lamp — under the ceiling), while POINTING hits the floor: the ray through the marker lands on the floor offset by the parallax
 * of that height, so dragging by pointing would make the lamp jump by about 2 m on the first pointer move.
 * Dragging moves the device on a horizontal plane THROUGH THE GRIP POINT (model/floorDrag.ts — like standing furniture):
 * constant grip, limited gain; the room and height of the new spot follow from the plan point, as in the "Plan" view.
 */
let adrag: { d: FloorDrag; view: PlanViewId } | null = null;
function startMountDrag(p: ElPoint, pointer: MountPointer | null | undefined) {
  mdrag = null; adrag = null;
  if (!pointer) return;
  if (p.orientation !== 'wall' || !p.wallId) {
    const room = elRoom(p.roomId);
    if (room && p.x !== undefined && p.y !== undefined) adrag = { d: beginFloorDrag([p.x, p.y], room.floorZ + p.heightAFFL, pointer), view: room.level };
    return;
  }
  const s = surfaceOfWall(p.roomId, p.wallId);
  if (s) mdrag = beginMountDrag(s, surfaceU(s, p.wallId, p.positionAlongWall), p.heightAFFL, deviceBox(p), pointer);
}
/** a drag session is in progress (along a wall or on the grip plane) — pointer moves are handled by dragTo, not by pointing */
export const mountDragging = () => mdrag !== null || adrag !== null;
/** moving an existing device: a drag (with `pointer` — a session over the mounting surface) or "Move" + pointing at a spot */
export function beginMove(id: string, opts: { dragging?: boolean; touch?: boolean; pointer?: MountPointer | null } = {}) {
  const p = planNow().points.find((x) => x.id === id);
  if (!p) return;
  ctx = coordContext();
  startMountDrag(p, opts.pointer);
  elPlace.set({ s: session('move', p.type, id, p.heightAFFL, pointPlacement(p), { dragging: !!opts.dragging, touch: !!opts.touch }) });
}
/** height change with the ↕ handle (3D) */
export function beginHeight(id: string, touch = false, pointer: MountPointer | null = null) {
  const p = planNow().points.find((x) => x.id === id);
  if (!p || p.orientation !== 'wall') return;
  ctx = coordContext();
  startMountDrag(p, pointer);
  elPlace.set({ s: session('height', p.type, id, p.heightAFFL, pointPlacement(p), { dragging: true, touch }) });
}
/** the view changed while dragging (scene size, camera): the grip is recomputed — the device stays in place */
export function reanchorDrag(pointer: MountPointer) {
  if (mdrag) mdrag = reanchorMountDrag(mdrag, pointer);
  if (adrag) adrag = { ...adrag, d: reanchorFloorDrag(adrag.d, pointer) };
}
/** whether a screen point lies over the scene (canvas element); without a scene (tests without a browser) — yes */
const overScene = (at: [number, number]): boolean => { const r = sceneApi.dom?.getBoundingClientRect(); return !r || (at[0] >= r.left && at[0] <= r.right && at[1] >= r.top && at[1] <= r.bottom); };
/**
 * Pointer move in a drag session over the mounting surface. Moving: position along the wall (height kept), transfer around a
 * corner / into another room; ↕ handle: height only. Returns false when there is no session (pointing applies then).
 */
export function dragTo(pointer: MountPointer, screen: [number, number] | null, alt = false): boolean {
  const s = placeNow();
  if (!s) return false;
  if (adrag) {
    // a pointer outside the scene moves nothing (as for wall devices); outside rooms / inside a wall — invalid preview
    if (!overScene(pointer.screen)) { placeAt(null, screen, alt); return true; }
    let d = moveFloorDrag(adrag.d, pointer);
    // A ceiling of a different height (neighbouring room, sloped ceiling): the device hangs at a different height there, so the
    // grip plane passes through the NEW height — the position is recomputed for the same pointer and grip (the marker stays
    // under the pointer). A few steps suffice: under a slope the height changes with the position.
    for (let i = 0; i < 4; i++) {
      const surface = surfaceFromPlan(adrag.view, [d.x, d.y], s.type), at = surface ? placementOn(surface, s.type, s.height, 0) : null, room = at ? elRoom(at.roomId) : null;
      if (!at || !room || Math.abs(room.floorZ + at.heightAFFL - d.z) <= 0.005) break;
      d = liftFloorDrag(d, room.floorZ + at.heightAFFL, pointer);
    }
    adrag = { ...adrag, d };
    placeAt(surfaceFromPlan(adrag.view, [d.x, d.y], s.type), screen, alt);
    return true;
  }
  if (!mdrag) return false;
  const height = s.mode === 'height';
  // a pointer OUTSIDE the scene rectangle (side panel, toolbar): the ray there is only an extrapolation — it points at no wall,
  // so it moves nothing
  const outside = !height && !overScene(pointer.screen);
  // the device moves to any wall of the level pointed at, also in a neighbouring room (wall-mounted furniture — only through a passage)
  mdrag = moveMountDrag(mdrag, pointer, { axes: height ? 'v' : 'u', transfer: !height && !outside, rooms: 'any' });
  // pointer outside the scene or away from all walls (lawn, sky): the preview stays at the last spot as invalid — releasing
  // does not change the device position and creates no history entry (commitPlace)
  if (outside || (!height && mdrag.away)) { elPlace.set({ s: { ...s, live: false, screen, check: { level: 'error', messages: [t('elPlace.dragOntoWall')] }, guides: [] } }); return true; }
  const room = elRoom(mdrag.surface.spaceId), w = wallAt(mdrag.surface, mdrag.u), wall = room?.walls.find((x) => x.id === w.wallId);
  if (!room || !wall) return true;
  const step = alt ? 0 : ui.get().elSnap, plan = planNow();
  const along = snapAlong(room, wall, w.t, height ? 0 : step);
  if (height) {
    const a = alignPlacement(plan, { roomId: room.id, wallId: wall.id, positionAlongWall: along, heightAFFL: heightFromHit(room, wall, along, room.floorZ + mdrag.v, step), orientation: 'wall' }, s.type, s.id, { height: step > 0 });
    const check = checkPlacement(plan, a.at, s.type, ctx, s.id);
    elPlace.set({ s: { ...s, at: a.at, ok: a.at, height: a.at.heightAFFL, live: true, check, guides: a.guides, info: placementInfo(a.at, s.type, roomName), screen } });
    return true;
  }
  applyPlacement({ roomId: room.id, wallId: wall.id, positionAlongWall: along, heightAFFL: snapHeight(Math.max(0.05, Math.min(maxHeightAt(room, wall, along), s.height)), 0), orientation: 'wall' }, screen, alt);
  return true;
}
export const setPlaceDragging = (dragging: boolean, touch = false) => { const s = placeNow(); if (s) elPlace.set({ s: { ...s, dragging, touch } }); };
export const setPlaceMulti = (multi: boolean) => { ui.set({ elMulti: multi }); const s = placeNow(); if (s) elPlace.set({ s: { ...s, multi } }); };
/** the wall the preview is on now (engine hysteresis) */
export const currentWall = (): WallRef | null => wallRefOf(placeNow()?.at ?? null);

/**
 * Pointer move: `surface` — the spot from the engine (null: no valid surface → the preview stays at the last spot as invalid).
 * `alt` — temporarily without snapping. `why` — a hint when there is no spot (by default by mounting type: wall device — wall,
 * ceiling device — room).
 */
export function placeAt(surface: Surface | null, screen: [number, number] | null, alt = false, why?: string) {
  const s = placeNow();
  if (!s || s.mode === 'height') return;
  const at = surface ? placementOn(surface, s.type, s.height, alt ? 0 : ui.get().elSnap) : null;
  if (!at) { elPlace.set({ s: { ...s, live: false, screen, check: { level: 'error', messages: [why ?? (DEVICES[s.type].mountType === 'WALL' ? t('elPlace.dragOntoWall') : t('elPlace.pointInRoom'))] }, guides: [] } }); return; }
  applyPlacement(at, screen, alt);
}
/**
 * Level change while placing: the spot pointed at in the previous view no longer applies — the preview of a new device / copy
 * disappears until the next pointer move (the session continues). A device being moved keeps its current spot.
 */
export function forgetPlace() {
  const s = placeNow();
  if (s && (s.mode === 'new' || s.mode === 'copy')) elPlace.set({ s: { ...s, at: null, ok: null, live: false, check: OK, guides: [], info: null, screen: null, dragging: false } });
}
/** the common end of both mechanisms (pointing, dragging): alignment to neighbouring devices, spot check, description for the user */
function applyPlacement(at: Placement, screen: [number, number] | null, alt: boolean) {
  const s = placeNow();
  if (!s) return;
  const step = alt ? 0 : ui.get().elSnap, plan = planNow(), ignore = s.mode === 'move' ? s.id : null;
  let guides: AlignGuide[] = [];
  if (step > 0) { const a = alignPlacement(plan, at, s.type, ignore, { along: true }); at = a.at; guides = a.guides; }
  else guides = alignPlacement(plan, at, s.type, ignore).guides;
  const check = checkPlacement(plan, at, s.type, ctx, ignore);
  elPlace.set({ s: { ...s, at, ok: check.level === 'error' ? s.ok : at, live: true, check, guides, info: placementInfo(at, s.type, roomName), screen } });
}
/** an existing point at the same spot (≤ 6 cm along the wall and vertically; ceiling / free point ≤ 10 cm) — instead of a duplicate */
export function pointAt(at: Placement, ignoreId: string | null = null): ElPoint | null {
  for (const p of planNow().points) {
    if (p.id === ignoreId || p.roomId !== at.roomId || p.orientation !== at.orientation) continue;
    if (at.orientation === 'wall') { if (p.wallId === at.wallId && Math.abs(p.positionAlongWall - at.positionAlongWall) <= 0.06 && Math.abs(p.heightAFFL - at.heightAFFL) <= 0.06) return p; }
    else if (Math.hypot((p.x ?? 0) - (at.x ?? 0), (p.y ?? 0) - (at.y ?? 0)) <= 0.1) return p;
  }
  return null;
}
const same = (a: Placement, b: Placement) => a.roomId === b.roomId && a.wallId === b.wallId && a.orientation === b.orientation && Math.abs(a.positionAlongWall - b.positionAlongWall) < 1e-6 && Math.abs(a.heightAFFL - b.heightAFFL) < 1e-6 && (a.x ?? 0) === (b.x ?? 0) && (a.y ?? 0) === (b.y ?? 0);

/**
 * Commit: one history entry. New / copy → a point in the plan (selected; in a series — not selected, the session continues);
 * move → placement change (roomId, wallId, distance, orientation — computed by the engine). Release outside a valid surface:
 * a device being moved returns to its spot (no history entry), a new one is not created.
 * Returns the point id or null.
 */
export function commitPlace(): string | null {
  const s = placeNow();
  if (!s) return null;
  const invalid = !s.live || s.check.level === 'error', at = invalid ? null : s.at;
  if (s.mode === 'move' || s.mode === 'height') {
    const p0 = planNow().points.find((x) => x.id === s.id);
    mdrag = null; adrag = null;
    elPlace.set({ s: null });
    if (!p0) return null;
    // release outside a valid surface: the device stays where it was (the last valid, committed spot)
    if (!at) { placeNote(s.check.messages[0] ?? t('elPlace.dragOntoWall'), 'warn'); ui.set({ selection: { kind: 'electrical', id: p0.id } }); return p0.id; }
    if (same(at, pointPlacement(p0))) { ui.set({ selection: { kind: 'electrical', id: p0.id } }); return p0.id; }
    const moved = at.roomId !== p0.roomId || at.wallId !== p0.wallId;
    patchElectrical(p0.id, { roomId: at.roomId, wallId: at.wallId, positionAlongWall: at.positionAlongWall, heightAFFL: at.heightAFFL, orientation: at.orientation, x: at.x, y: at.y },
      s.mode === 'height' ? t('history.elHeightOf', { name: DEVICES[s.type].name }) : moved ? t('history.elTransfer', { name: DEVICES[s.type].name }) : t('history.elMove', { name: DEVICES[s.type].name }));
    if (s.mode === 'height') ui.set((u) => ({ elHeights: { ...u.elHeights, [s.type]: at.heightAFFL } }));
    ui.set({ selection: { kind: 'electrical', id: p0.id } });
    return p0.id;
  }
  if (!at) { placeNote(s.check.messages[0] ?? t('elPlace.dragOntoWall'), 'warn'); elPlace.set({ s: { ...s, dragging: false } }); return null; }
  const dup = pointAt(at);
  if (dup) {
    placeNote(t('elPlace.alreadyHere', { name: DEVICES[dup.type].short.toLowerCase() }), 'warn');
    if (s.multi) elPlace.set({ s: { ...s, dragging: false } }); else { elPlace.set({ s: null }); ui.set({ selection: { kind: 'electrical', id: dup.id } }); }
    return dup.id;
  }
  const src = s.mode === 'copy' ? planNow().points.find((x) => x.id === s.id) : null;
  let extra: Partial<ElPoint> = {};
  if (src) { const { id: _i, roomId: _r, wallId: _w, positionAlongWall: _t, heightAFFL: _h, orientation: _o, x: _x, y: _y, ...rest } = src; void _i; void _r; void _w; void _t; void _h; void _o; void _x; void _y; extra = { ...rest, source: 'user', status: 'planned' }; }
  const id = addElectrical(s.type, at, extra);
  if (s.multi && s.mode === 'new') { ui.set({ selection: null }); elPlace.set({ s: { ...s, placed: s.placed + 1, dragging: false, at: null, ok: null, live: false, guides: [], check: OK, info: null } }); }
  else elPlace.set({ s: null });
  return id;
}
export function cancelPlace() { mdrag = null; adrag = null; if (placeNow()) elPlace.set({ s: null }); }

/** device pose in the scene: a point on the wall face and the normal (LCS) — for drawing the preview */
export const placementPose = (at: Placement, type: ElType) => measure({ ...at, type } as ElPoint);
