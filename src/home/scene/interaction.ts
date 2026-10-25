// Furniture editing with the mouse (Room Mode): moving over the floor with snapping (walls, corners, alignment to other
// furniture, optional grid; ALT — temporarily no snapping), rotation with a ring (15° steps, ALT — smooth), dragging from the
// catalogue into the room with a preview. During a drag only transient state (drag) changes — on release ONE history entry.
// Standing furniture is guided over a horizontal plane through the GRAB POINT (model/floorDrag.ts) — not over the floor.
// Wall-mounted objects (catalogue items with `mount: 'wall'`) are dragged ALONG THE WALL by the shared mount engine
// (model/mountDrag.ts) — not over the floor; every drag recomputes the grab when the view changes during the move.
import { displayName, elevationOf, isWallMounted, resolveDims, type CatalogItem } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { furnitureWarnings, obbOf } from '../model/collision';
import { angleDiff, clampToPolygon, deg, normDeg, pointInPolygon, round } from '../model/geom2d';
import { addFurniture, furnitureById, newId, removeFurniture, updateFurniture } from '../model/interiors';
import { pickFromRay, pickOnSurface, surfacePoint, wallFromPlan } from '../model/mount';
import { beginMountDrag, gridU, MOUNT, moveMountDrag, nudgeMount, mountPose, reanchorMountDrag, type MountDrag, type MountDragOptions } from '../model/mountDrag';
import { attachMounted, duplicateSpot, mountedAt, mountedDrop, mountedPatch, mountedRects, mountReadout, mountWarnings, nearestMount } from '../model/mountedFurniture';
import { beginFloorDrag, moveFloorDrag, reanchorFloorDrag } from '../model/floorDrag';
import { findFreeSpot, neighbours } from '../model/placement';
import { nearestWall, roomById, type HomeRoom } from '../model/rooms';
import { DEFAULT_SNAP, keepInside, rotFacing, snapPlacement, snapRotation } from '../model/snapping';
import type { FurniturePlacement, Vec2 } from '../model/types';
import { arrangementOf, commit, design, updateArrangement } from '../store/design';
import { withActive, withInterior } from '../model/interiors';
import { drag, type DragState } from '../store/drag';
import { isWalking, toast, ui } from '../store/ui';
import { t } from '../../i18n';
import { mountPointerAt, viewStamp } from './mountPointer';
import { floorHit, lockControls, overCanvas, sceneApi, screenOf } from './sceneApi';

const snapOpts = (alt: boolean) => ({ ...DEFAULT_SNAP, enabled: ui.get().snap.enabled && !alt, grid: ui.get().snap.grid });

/** other furniture of the room as rectangles (snapping / alignment) */
function snapOthers(list: FurniturePlacement[], exceptId: string | null) {
  return list.filter((f) => f.id !== exceptId).flatMap((f) => {
    const it = itemById(f.catalogId);
    return it && !it.flat ? [{ id: f.id, obb: obbOf(f, resolveDims(it, f)) }] : [];
  });
}

/** position after snapping (the furniture centre always inside the room) */
function placeAt(room: HomeRoom, item: CatalogItem, p: FurniturePlacement, x: number, y: number, rot: number, others: FurniturePlacement[], alt: boolean) {
  const dims = resolveDims(item, p);
  const c = clampToPolygon([x, y], room.polygon, 0.02);
  const r = snapPlacement(room, { w: dims.w, d: dims.d, placement: item.placement }, { x: c[0], y: c[1], rot }, snapOthers(others, p.id), snapOpts(alt));
  // furniture does not enter walls (pushed inside; also with Alt — Alt disables only snapping)
  const k = keepInside(room, dims, r);
  const out = { x: round(k.x, 4), y: round(k.y, 4), rot: round(normDeg(r.rot), 3) };
  const warnings = furnitureWarnings(room, item, { ...p, ...out }, dims, neighbours(others.filter((f) => f.id !== p.id)));
  return { ...out, guides: r.guides, warnings };
}

/**
 * Whether a press may start a drag: no other drag is in progress (camera lock), and on touch — only the FIRST finger. The second
 * finger belongs to the camera gesture (pinch): a drag started with it on the selected furniture would move it instead of zooming.
 */
export const canStartDrag = (e: PointerEvent) => !sceneApi.locked && (e.pointerType !== 'touch' || e.isPrimary);

/**
 * Listener for one drag. It is driven ONLY by the pointer that started it: move, release and cancel of other pointers are
 * ignored (a second finger would take over the dragged object — a jump of over a metre — and lifting it would commit the
 * position while the first was still down). End: `onEnd(e)` — release (commit); `onEnd(null)` — cancel: Escape,
 * pointercancel or a second finger on the scene during a finger drag (camera gesture, as in the electrical planner).
 * `lock` — a drag started in the scene suspends camera control. The lock lasts UNTIL THE POINTER IS RELEASED, also after a cancel
 * and after releasing only the left button: the camera remembered the press point, so unlocked with a button down it would
 * rotate the view by the whole drag distance in one jump. Exception: a second finger with the orbit camera — there the
 * two-finger gesture (zoom) starts afresh, so the camera takes it over at once; the walk camera knows only the first touch point.
 */
export function listen(start: PointerEvent, onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent | null) => void, lock = true) {
  const id = start.pointerId, finger = start.pointerType === 'touch';
  let active = true;
  if (lock) lockControls(true);
  const end = (e: PointerEvent | null) => { if (active) { active = false; onEnd(e); } };
  const release = () => { cleanup(); if (lock) lockControls(false); };
  const move = (e: PointerEvent) => {
    if (!active || e.pointerId !== id) return;
    // mouse: left button released while another is down — the browser then sends a move, and pointerup only after the last button
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) end(e); else onMove(e);
  };
  const up = (e: PointerEvent) => { if (e.pointerId === id) { end(e); release(); } };
  const cancel = (e: PointerEvent) => { if (e.pointerId === id) { end(null); release(); } };
  const down = (e: PointerEvent) => {
    // the same pointer pressed again: the release never arrived (e.g. outside the window) — the scene must not stay locked
    if (e.pointerId === id) { end(null); release(); return; }
    if (!active || !finger || e.pointerType !== 'touch' || e.target !== sceneApi.dom) return;
    end(null);
    if (!isWalking(ui.get())) release();
  };
  // Escape during a drag only cancels it (does not deselect or leave the room — the shortcut does that outside a drag)
  const key = (e: KeyboardEvent) => { if (active && e.key === 'Escape') { e.stopImmediatePropagation(); end(null); } };
  function cleanup() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('keydown', key, true);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  // capture phase: before camera control on the scene element — a camera unlocked here already sees the second finger's press
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('keydown', key, true);
}

/** same warnings / guides content → previous reference (drag state subscribers do not re-render) */
const sameJson = <T,>(prev: T, next: T): T => (prev === next || JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
const stableDrag = (guides: DragState['guides'], warnings: DragState['warnings']) => {
  const d = drag.get();
  return { guides: sameJson(d.guides, guides), warnings: sameJson(d.warnings, warnings) };
};

const IDLE: Pick<DragState, 'item' | 'guides' | 'warnings' | 'mount'> = { item: null, guides: [], warnings: [], mount: null };
/** pointer distance after which a press becomes a drag [px] */
const dragStartPx = (e: PointerEvent) => (e.pointerType === 'touch' ? 8 : 4);
const selectFurniture = (roomId: string, id: string) => ui.set({ selection: { kind: 'furniture', roomId, id } });

// ------------------------------------------------------------------ moving
/**
 * Moving furniture. Selection happens AFTER the pointer is released: selecting on press would open the side panel, which
 * narrows the scene during the move — a drag start point computed in the old view produced a jump of several metres.
 * `grabZ` — height (LCS Z) of the furniture point hit by the pointer: standing furniture is guided over a horizontal plane
 * through that point (the grabbed spot stays under the pointer); without it — over the floor.
 */
export function startMove(e: PointerEvent, roomId: string, id: string, grabZ?: number) {
  const room = roomById(roomId);
  const a = arrangementOf(design.get(), roomId);
  const p = furnitureById(a, id), item = p && itemById(p.catalogId);
  if (!room || !p || !item || !canStartDrag(e)) return;
  if (isWallMounted(item)) { startMountedMove(e, roomId, item, p); return; }
  const ptr = mountPointerAt(e.clientX, e.clientY);
  if (!ptr || !overCanvas(e.clientX, e.clientY)) return;
  // grab plane within the furniture solid (above the floor, up to its top edge)
  const base = room.floorZ + elevationOf(item, p), z = Math.min(base + resolveDims(item, p).h, Math.max(room.floorZ, grabZ ?? room.floorZ));
  const x0 = e.clientX, y0 = e.clientY, minPx = dragStartPx(e);
  let d = beginFloorDrag([p.x, p.y], z, ptr), moved = false, last: { x: number; y: number; rot: number } | null = null, stamp = viewStamp();
  listen(e, (ev) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < minPx) return;
    moved = true;
    const q = mountPointerAt(ev.clientX, ev.clientY);
    if (!q) return;
    // the view changed during the drag (scene size, camera): grab recomputed — the furniture stays in place
    const now = viewStamp();
    if (now !== stamp) { stamp = now; d = reanchorFloorDrag(d, q); return; }
    d = moveFloorDrag(d, q);
    const r = placeAt(room, item, p, d.x, d.y, p.rot, a.furniture, ev.altKey);
    last = { x: r.x, y: r.y, rot: r.rot };
    drag.set({ item: { roomId, id, ...last, mode: 'move' }, ...stableDrag(r.guides, r.warnings) });
  }, (ev) => {
    // commit first (new position in the document), then end the preview — no flash of the old position
    if (ev && moved && last) updateArrangement(roomId, t('scene.historyMove', { name: displayName(item, p) }), (x) => updateFurniture(x, id, last!));
    drag.set(IDLE);
    if (ev) selectFurniture(roomId, id);
  });
}

// ------------------------------------------------------------------ wall-mounted objects
/** snapping of a wall-mounted object: 1 cm grid (or the grid from the settings), alignment to other objects and openings; ALT — none */
function mountOptions(alt: boolean, id: string): MountDragOptions {
  const sn = ui.get().snap, on = sn.enabled && !alt;
  return {
    step: on ? (sn.grid > 0 ? sn.grid : MOUNT.gridFine) : 0, align: on,
    others: (s) => mountedRects(s.spaceId, arrangementOf(design.get(), s.spaceId).furniture, s, id),
    // wall-hung furniture stays inside the building: the facade is a mounting surface only for exterior devices
    accept: (s) => !s.exterior,
  };
}
/** transient scene state for an object's position on a surface (preview, badge, warnings) */
function publishMount(d: MountDrag, id: string, o: MountDragOptions, screen: [number, number], touch: boolean) {
  const pose = mountPose(d.surface, d.box, d.out.u, d.out.v), read = mountReadout(d.surface, d.out.u, d.out.v);
  const warnings = mountWarnings(d.surface, d.box, d.out.u, d.out.v, o.others?.(d.surface) ?? []);
  drag.set({
    item: { roomId: d.surface.spaceId, id, x: pose.x, y: pose.y, rot: pose.rot, elevation: pose.elevation, mode: 'move' },
    mount: { id, surfaceId: d.surface.id, u: d.out.u, v: d.out.v, ...read, guides: d.guides, candidate: d.candidate, screen, touch },
    ...stableDrag([], warnings),
  });
}
/** saving a wall-mounted object's position: one history entry, also when moving into another room */
function commitMount(fromRoom: string, p: FurniturePlacement, item: CatalogItem, d: { surface: MountDrag['surface']; box: MountDrag['box'] }, u: number, v: number, label?: string) {
  const patch = mountedPatch(d.surface, d.box, u, v), toRoom = d.surface.spaceId, name = displayName(item, p);
  if (toRoom === fromRoom) { updateArrangement(fromRoom, label ?? t('scene.historyMove', { name }), (x) => updateFurniture(x, p.id, patch)); return; }
  const dest = roomById(toRoom);
  commit(t('scene.historyTransfer', { name, room: dest?.label ?? toRoom }), (doc) => ({
    ...doc, variants: doc.variants.map((vr) => {
      if (vr.id !== doc.activeVariantId) return vr;
      const out = withInterior(vr.interiors ?? {}, fromRoom, (ri) => withActive(ri, (x) => removeFurniture(x, p.id)));
      return { ...vr, interiors: withInterior(out, toRoom, (ri) => withActive(ri, (x) => addFurniture(x, { ...p, ...patch }))) };
    }),
  }));
}
function startMountedMove(e: PointerEvent, roomId: string, item: CatalogItem, p: FurniturePlacement) {
  // wall furniture away from the wall (older save): the first move hangs it on the nearest wall of the room
  const at = mountedAt(roomId, item, p) ?? nearestMount(roomId, item, p), ptr = mountPointerAt(e.clientX, e.clientY);
  if (!at || !ptr) return;
  const x0 = e.clientX, y0 = e.clientY, minPx = dragStartPx(e), touch = e.pointerType === 'touch', id = p.id;
  let d = beginMountDrag(at.surface, at.u, at.v, at.box, ptr), moved = false, stamp = viewStamp();
  listen(e, (ev) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < minPx) return;
    const q = mountPointerAt(ev.clientX, ev.clientY);
    if (!q) return;
    const o = mountOptions(ev.altKey, id), now = viewStamp();
    // start of the move and every view change: grab computed for the current position — the object does not jump
    if (!moved || now !== stamp) { moved = true; stamp = now; d = reanchorMountDrag(d, q); }
    else d = moveMountDrag(d, q, o);
    publishMount(d, id, o, [ev.clientX, ev.clientY], touch);
  }, (ev) => {
    const end = d.surface.spaceId;
    if (ev && moved && (d.out.u !== at.u || d.out.v !== at.v || d.surface.id !== at.surface.id || !p.mount)) commitMount(roomId, p, item, d, d.out.u, d.out.v);
    drag.set(IDLE);
    if (ev) selectFurniture(ev && moved ? end : roomId, id);
  });
}
/** position of a wall-mounted object on its surface (inspector, keys) — null: the furniture is not a wall-mounted object on a wall */
export function mountedNow(roomId: string, id: string) {
  const p = furnitureById(arrangementOf(design.get(), roomId), id), item = p && itemById(p.catalogId);
  const at = p && item ? mountedAt(roomId, item, p) : null;
  return p && item && at ? { p, item, ...at, ...mountReadout(at.surface, at.u, at.v) } : null;
}
/** moves a wall-mounted object by a step: du — along the wall (positive towards the LEFT corner), dv — up */
export function nudgeMounted(roomId: string, id: string, du: number, dv: number) {
  const m = mountedNow(roomId, id);
  if (!m) return;
  const n = nudgeMount(m.surface, m.box, m.u, m.v, du, dv);
  if (n.u === m.u && n.v === m.v && m.p.mount) return;
  commitMount(roomId, m.p, m.item, m, n.u, n.v, t(du ? 'scene.historyMove' : 'scene.historyHeight', { name: displayName(m.item, m.p) }));
}
/** probe step for finding the object's axis directions on screen [m] and the smallest visible component of its image [px] */
const AXIS_PROBE = 0.2, AXIS_MIN_PX = 0.5;
/**
 * Axis of a wall-mounted object for an arrow ON SCREEN. `su`, `sv` — screen images of the +u (along the wall) and +v (up) steps
 * [px; x right, y down], null — point outside the frame; (`ax`, `ay`) — the arrow (x right, y up). Each arrow has its axis:
 * ← → along the wall, ↑ ↓ height — with the sign as that axis appears on screen. When height is NOT VISIBLE (top view),
 * ↑ ↓ do not change it: they switch to the wall axis if it runs up / down on screen (a wall vertical on screen) —
 * otherwise nothing happens (null). ← → without a visible horizontal wall component (in plan: across the wall) also do
 * nothing and never change the height. In 3D views ↑ ↓ always mean height — even when a steep camera foreshortens the up step
 * more than the step along an oblique wall.
 */
export function screenAxis(su: Vec2 | null, sv: Vec2 | null, ax: number, ay: number): { axis: 'u' | 'v'; sign: 1 | -1 } | null {
  const along = (s: Vec2 | null) => (s ? s[0] * ax - s[1] * ay : 0), c = { u: along(su), v: along(sv) }, seen = (k: 'u' | 'v') => Math.abs(c[k]) > AXIS_MIN_PX;
  const axis = ay && seen('v') ? 'v' : seen('u') ? 'u' : null;
  return axis && { axis, sign: c[axis] > 0 ? 1 : -1 };
}
/** screen images of the +u and +v steps of a wall-mounted object, computed at the centre of its face (the camera may look at the wall from inside or from behind) */
function mountAxesOnScreen(m: NonNullable<ReturnType<typeof mountedNow>>): { su: Vec2 | null; sv: Vec2 | null } {
  const at = (du: number, dv: number) => screenOf(surfacePoint(m.surface, m.u + du, m.v + (m.box.anchor === 'bottom' ? m.box.h / 2 : 0) + dv, MOUNT.wallGap));
  const o = at(0, 0), a = at(AXIS_PROBE, 0), b = at(0, AXIS_PROBE);
  return { su: o && a ? [a[0] - o[0], a[1] - o[1]] : null, sv: o && b ? [b[0] - o[0], b[1] - o[1]] : null };
}
/** arrow keys for a wall-mounted object: a step towards the arrow ON SCREEN (axis per `screenAxis`); an arrow without a visible axis — nothing */
function nudgeMountedScreen(roomId: string, id: string, dx: number, dy: number) {
  const m = mountedNow(roomId, id);
  if (!m) return false;
  const { su, sv } = mountAxesOnScreen(m), a = screenAxis(su, sv, Math.sign(dx), Math.sign(dy)), step = Math.abs(dx || dy);
  if (a) nudgeMounted(roomId, id, a.axis === 'u' ? a.sign * step : 0, a.axis === 'v' ? a.sign * step : 0);
  return true;
}
/**
 * "◀ ▶" buttons (panel, phone toolbar): a step along the wall in the direction visible ON SCREEN — like the arrows. Computed
 * relative to the room they would move the object the opposite way when the camera looks at the wall from behind (the default
 * room view). When the wall runs vertically on screen (top view), "left" means towards the left corner as seen from the room —
 * the button always works.
 */
export function nudgeMountedSide(roomId: string, id: string, side: -1 | 1, step: number) {
  const m = mountedNow(roomId, id);
  if (!m) return;
  const a = screenAxis(mountAxesOnScreen(m).su, null, side, 0);
  nudgeMounted(roomId, id, (a ? a.sign : -side) * step, 0);
}

// ------------------------------------------------------------------ rotation (ring)
export function startRotate(e: PointerEvent, roomId: string, id: string) {
  const room = roomById(roomId);
  const a = arrangementOf(design.get(), roomId);
  const p = furnitureById(a, id), item = p && itemById(p.catalogId);
  if (!room || !p || !item || isWallMounted(item) || !canStartDrag(e)) return; // a wall-mounted object has no rotation — its back faces the wall
  const q0 = floorHit(e.clientX, e.clientY, room.floorZ);
  if (!q0) return;
  const ang0 = deg(Math.atan2(q0[1] - p.y, q0[0] - p.x));
  let moved = false, last: number | null = null;
  listen(e, (ev) => {
    const q = floorHit(ev.clientX, ev.clientY, room.floorZ);
    if (!q) return;
    moved = true;
    const raw = p.rot + angleDiff(deg(Math.atan2(q[1] - p.y, q[0] - p.x)), ang0);
    const rot = ev.altKey || !ui.get().snap.enabled ? round(normDeg(raw), 1) : snapRotation(raw, 15);
    last = rot;
    const dims = resolveDims(item, p);
    const warnings = furnitureWarnings(room, item, { ...p, rot }, dims, neighbours(a.furniture.filter((f) => f.id !== id)));
    drag.set({ item: { roomId, id, x: p.x, y: p.y, rot, mode: 'rotate' }, ...stableDrag([], warnings) });
  }, (ev) => {
    if (ev && moved && last !== null) updateArrangement(roomId, t('scene.historyRotate', { name: displayName(item, p) }), (x) => updateFurniture(x, id, { rot: last! }));
    drag.set(IDLE);
  });
}

/** rotation by a step with a button / key (degrees; + counter-clockwise) */
export function rotateBy(roomId: string, id: string, step: number) {
  const p = furnitureById(arrangementOf(design.get(), roomId), id), item = p && itemById(p.catalogId);
  if (!p || !item || isWallMounted(item)) return;
  updateArrangement(roomId, t('scene.historyRotateBy', { step: `${step > 0 ? '+' : ''}${step}`, name: displayName(item, p) }), (x) => updateFurniture(x, id, { rot: round(normDeg(p.rot + step), 3) }));
}

/** moving by a step with the arrow keys [m] (direction in the top-view screen frame: building X / Y) */
export function nudge(roomId: string, id: string, dx: number, dy: number) {
  const room = roomById(roomId), p = furnitureById(arrangementOf(design.get(), roomId), id), item = p && itemById(p.catalogId);
  if (!room || !p || !item) return;
  if (isWallMounted(item) && nudgeMountedScreen(roomId, id, dx, dy)) return;
  const c = clampToPolygon([p.x + dx, p.y + dy], room.polygon, 0.02);
  updateArrangement(roomId, t('scene.historyMove', { name: displayName(item, p) }), (x) => updateFurniture(x, id, { x: round(c[0], 4), y: round(c[1], 4) }));
}

// ------------------------------------------------------------------ adding from the catalogue
/** new furniture at a free spot in the room (clicking a catalogue card) */
export function addToRoom(roomId: string, item: CatalogItem, variant: string | null = null, near?: Vec2): string | null {
  const room = roomById(roomId);
  if (!room) return null;
  const a = arrangementOf(design.get(), roomId);
  const p = attachMounted(roomId, findFreeSpot(room, item, { id: newId('f'), variant }, a.furniture, near));
  updateArrangement(roomId, t('scene.historyAdd', { name: displayName(item, p) }), (x) => addFurniture(x, p));
  ui.set({ selection: { kind: 'furniture', roomId, id: p.id } });
  return p.id;
}

/** mounting surface of the room under the pointer: a wall face or the wall nearest to the pointed floor spot */
function wallUnderPointer(clientX: number, clientY: number, roomId: string) {
  const ptr = mountPointerAt(clientX, clientY);
  if (!ptr) return null;
  const pick = ptr.kind === 'plan' ? wallFromPlan(ptr.view, ptr.q) : pickFromRay({ level: ptr.level, origin: ptr.origin, dir: ptr.dir, visible: ptr.visible }, 'wall');
  const on = pick && pick.kind === 'wall' ? pickOnSurface(pick) : null;
  return on && on.surface.spaceId === roomId ? on : null;
}

/** initial rotation of furniture dropped at a point: wall-placed — back to the nearest wall */
function initialRot(room: HomeRoom, item: CatalogItem, q: Vec2) {
  if (item.placement !== 'wall') return 0;
  return rotFacing(nearestWall(room, q).wall.inward);
}

/**
 * Dragging a catalogue card: cursor over the room → furniture preview on the floor (with snapping), release → add
 * (one history entry) and select; a click without dragging → a free spot in the room.
 */
export function startCatalogDrag(e: PointerEvent, item: CatalogItem, variant: string | null, thumb: string) {
  if (e.button !== 0 || !canStartDrag(e)) return;
  const x0 = e.clientX, y0 = e.clientY;
  let started = false;
  // wall-mounted object: the wall spot shown by the last preview — the dropped object gets EXACTLY this mount record
  let hang: ReturnType<typeof mountedDrop>['patch'] | null = null;
  const base: FurniturePlacement = { id: newId('f'), catalogId: item.id, variant, x: 0, y: 0, rot: 0 };
  const name = displayName(item, base);
  drag.set({ catalog: { catalogId: item.id, variant, name, thumb, x: x0, y: y0, started: false } });
  // a drag started on a catalogue card (outside the scene): the camera does not know this press — no lock
  listen(e, (ev) => {
    if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    started = true;
    const roomId = ui.get().roomId, room = roomById(roomId);
    let ghost = null;
    hang = null;
    if (room && overCanvas(ev.clientX, ev.clientY) && isWallMounted(item)) {
      // wall-mounted object: preview on the wall UNDER THE POINTER (or the one nearest to the pointed floor spot), at the default
      // height limited to the wall (knee wall, slope) — preview, warnings and the dropped object in the same place
      const on = wallUnderPointer(ev.clientX, ev.clientY, room.id);
      if (on) {
        const o = mountOptions(ev.altKey, base.id), d = mountedDrop(on.surface, item, base, gridU(on.surface, on.u, o.step ?? 0), o.others?.(on.surface) ?? []);
        hang = d.patch;
        ghost = { roomId: room.id, catalogId: item.id, variant, x: hang.x, y: hang.y, rot: hang.rot, elevation: hang.elevation, warnings: d.warnings };
        drag.set({ guides: [] });
      }
    } else if (room && overCanvas(ev.clientX, ev.clientY)) {
      const q = floorHit(ev.clientX, ev.clientY, room.floorZ);
      if (q && pointInPolygon(q, room.polygon, -1)) {
        const a = arrangementOf(design.get(), room.id);
        const r = placeAt(room, item, base, q[0], q[1], initialRot(room, item, q), a.furniture, ev.altKey);
        ghost = { roomId: room.id, catalogId: item.id, variant, x: r.x, y: r.y, rot: r.rot, warnings: r.warnings };
        drag.set({ guides: r.guides });
      }
    }
    if (!ghost) drag.set({ guides: [] });
    drag.set({ catalog: { catalogId: item.id, variant, name, thumb, x: ev.clientX, y: ev.clientY, started: true }, ghost });
  }, (ev) => {
    const g = drag.get().ghost;
    drag.set({ catalog: null, ghost: null, guides: [] });
    if (!ev) return;
    const roomId = ui.get().roomId;
    if (!started) {
      // card click: add at a free spot in the current room
      if (roomId) addToRoom(roomId, item, variant);
      else toast(t('scene.enterRoomFirst'), 'warn');
      return;
    }
    if (g) {
      const p: FurniturePlacement = hang ? { ...base, id: newId('f'), ...hang } : attachMounted(g.roomId, { ...base, id: newId('f'), x: g.x, y: g.y, rot: g.rot });
      updateArrangement(g.roomId, t('scene.historyAdd', { name }), (x) => addFurniture(x, p));
      ui.set({ selection: { kind: 'furniture', roomId: g.roomId, id: p.id } });
    } else if (overCanvas(ev.clientX, ev.clientY)) toast(roomId ? t('scene.dropOnFloor') : t('scene.enterRoomToPlace'), 'warn');
  }, false);
}

/**
 * Copy of a wall-mounted object: next to the original on the same wall and at the same height, at a spot free of other
 * wall-mounted objects (`duplicateSpot`). Result: null — the furniture is not a wall-mounted object on a wall (the regular
 * standing furniture path copies it); `{ id }` — id of the copy, or null when the wall has no room left (message, no copy, no history entry).
 */
export function duplicateMounted(roomId: string, id: string): { id: string | null } | null {
  const m = mountedNow(roomId, id);
  if (!m) return null;
  const n = duplicateSpot(m.surface, m.box, m.u, m.v, mountedRects(roomId, arrangementOf(design.get(), roomId).furniture, m.surface));
  if (!n) { toast(t('scene.noRoomForCopy', { name: displayName(m.item, m.p) }), 'warn'); return { id: null }; }
  const nid = newId('f');
  updateArrangement(roomId, t('scene.historyDuplicate', { name: displayName(m.item, m.p) }), (a) => addFurniture(a, { ...JSON.parse(JSON.stringify(m.p)) as FurniturePlacement, id: nid, ...mountedPatch(m.surface, m.box, n.u, n.v) }));
  return { id: nid };
}
