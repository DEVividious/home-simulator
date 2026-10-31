// UI operations (navigation and editing) — a thin layer over the stores: every project change = one commit (one undo / redo
// entry) with a readable label; navigation changes only the UI state and the camera command.
import type * as THREE from 'three';
import { fmtCm, t } from '../i18n';
import { hasCapability, hasModule } from '../project/active';
import { createVariant, docErrors, duplicateVariant, renameVariant, type Variant } from '../document/model';
import { exportVariant, importVariant, type VariantSun, type VariantView } from './model/variantData';
import { hasStairs } from './model/stairs';
import type { DeepPartial, StairsConfig } from './model/stairsConfig';
import { aboveViewId, homeViewId } from './model/views';
import { viewpointById } from './model/viewpoints';
import { displayName, resolveDims } from './catalog/furniture';
import { itemById } from './catalog/providers';
import { materialById } from './catalog/materials';
import { round } from '@home-sim/core/model/geom2d';
import {
  activeArrangement, deleteArrangement, duplicateArrangement, duplicateFurniture, furnitureById, loadArrangement, newEmptyArrangement,
  newId, removeFurniture, renameArrangement, saveArrangement, setFinish, withActive, withInterior, type FinishTarget,
} from './model/interiors';
import { arrangeScenario, SCENARIOS } from './model/placement';
import { architectFurniture, defaultFurniture, kitchenBuiltIn } from './model/defaults';
import { allRooms, baseLevel, roomById, roomsOfLevel, type HomeRoom } from './model/rooms';
import { duplicateMounted } from './scene/interaction';
import type { CameraBookmark, FinishRef, FurniturePlacement, LevelId, RoomView, ScenarioPreset, Vec3 } from './model/types';
import { arrangementOf, commit, design, docOf, preview, previewArrangement, interiorOfRoom, updateArrangement, updateInterior, updateVariant, variantOf, withActiveVariant } from './store/design';
import { attachMounted, patchPlacement } from './model/mountedFurniture';
import { cameraTo, enterRoom, exitRoom, exitWalk, isEditWalk, isWalking, startWalk, toast, ui, type CameraPresetId, type ElView, type Mode, type Section, type UiState } from './store/ui';
import { cancelPlace, forgetPlace } from './store/elPlace';
import { EYE_LEVEL_FOV, eyeLevelPitch, heightRange } from './model/elPlacement';
import { sceneApi } from './scene/sceneApi';
import { walkInput } from './scene/walkInput';
import { doorById, doorCenter, inDoorway, isOperable, openOf } from './model/doors';
import { doors, openDoor, toggleDoorOpen } from './store/doors';
import type { Vec2 } from './model/types';
import { addPoint, EL_TYPES, elRoom, elWall, removePoint, resolvePlan, siteLevelId, updatePoint, type ElectricalPlan, type ElPoint, type ElType, type Placement } from './model/electrical';

// ------------------------------------------------------------------ navigation
export function goSection(section: Section) {
  const s = ui.get();
  if (section === s.section) return;
  if (section === 'look') {
    const wasInside = s.roomId || s.houseView === 'interior';
    // a walk through the building and site continues (the walk places are in the Look step)
    ui.set({ section, roomId: null, houseView: s.houseView === 'walk' && !s.roomId ? 'walk' : 'exterior', selection: null, hoverRoom: null });
    if (wasInside) cameraTo(homeViewId());
    return;
  }
  if (s.section === 'electrical') { cancelPlace(); ui.set({ elPanel: null, elMore: false }); }
  if (section === 'electrical') {
    // ELECTRICAL mode: its own view (plan / 3D); a walk is not resumed
    const walking = s.houseView === 'walk' && !s.roomId;
    ui.set({ section, elView: s.elView === 'walk' ? '3d' : s.elView, elPanel: null, selection: null, hoverRoom: null, roomView: s.roomView === 'walk' ? '3d' : s.roomView, ...(s.roomId ? {} : { houseView: 'interior' as const }) });
    if (!s.roomId && (s.houseView !== 'interior' || walking)) cameraTo('interior');
    return;
  }
  // a walk started in a room continues in the Arrange step (as in a room walk); touring from the Look step — cutaway
  if (section === 'arrange' && !s.roomId && s.houseView !== 'interior' && !isEditWalk(s)) {
    ui.set({ section, houseView: 'interior', selection: null });
    cameraTo('interior');
    return;
  }
  ui.set({ section });
}

export function goPreset(id: CameraPresetId) {
  if (id === 'interior') { ui.set({ roomId: null, houseView: 'interior', selection: null }); cameraTo('interior'); return; }
  ui.set({ roomId: null, houseView: 'exterior', selection: null });
  cameraTo(id);
}

export function setLevel(level: LevelId) {
  const s = ui.get();
  if (s.roomId) exitRoom();
  ui.set({ level, houseView: 'interior', hoverRoom: null });
  cameraTo('interior');
}

export const setRoomView = (v: RoomView) => ui.set({ roomView: v });
export { enterRoom, exitRoom };

/** simple or advanced mode (ADR 0038): leaving advanced mode leaves its steps and its whole-home wall scope */
export function setMode(mode: Mode) {
  const s = ui.get();
  if (mode === s.mode) return;
  if (mode === 'simple' && (s.section === 'electrical' || s.section === 'expert')) goSection('look');
  ui.set((u) => ({ mode, ...(mode === 'simple' && u.wallScope === 'house' ? { wallScope: 'all' as const } : {}) }));
}

// ------------------------------------------------------------------ scene bar: Around | From above | Walk (the same words outside and in a room)
export type SceneView = 'around' | 'above' | 'walk';
/** the scene-bar view shown now; null — the level section ("doll's house"), shown by the level chips */
export function sceneViewOf(s: Pick<UiState, 'roomId' | 'roomView' | 'houseView' | 'camera'>): SceneView | null {
  if (s.roomId) return s.roomView === 'walk' ? 'walk' : s.roomView === 'top' ? 'above' : 'around';
  if (s.houseView === 'walk') return 'walk';
  if (s.houseView === 'interior') return null;
  return s.camera.preset === aboveViewId() ? 'above' : 'around';
}
export function goView(v: SceneView) {
  const s = ui.get();
  if (s.roomId) { setRoomView(v === 'walk' ? 'walk' : v === 'above' ? 'top' : '3d'); return; }
  if (v === 'walk') { if (s.houseView !== 'walk') startWalk(); return; }
  // a walk started in a room goes back to that room; otherwise the house from outside
  if (s.houseView === 'walk' && isEditWalk(s)) { exitWalk(); if (v === 'above') setRoomView('top'); return; }
  const above = aboveViewId();
  if (v === 'above' && !above) { setLevel(s.level); return; }
  goPreset(v === 'above' ? above! : homeViewId());
}

/** a place in the Look step: a view of the project, a walk start at a viewpoint, or a saved view */
export function goPlace(id: string) {
  if (viewpointById(id)) { startWalk({ viewpointId: id }); return; }
  const b = (docOf(design.get()).bookmarks ?? []).find((x) => x.id === id);
  if (b) { openBookmark(b); return; }
  goPreset(id);
}

/** "Start from" in a room: the furniture of the plan, a proposal (office, guest room) or an empty room — one history entry,
 *  the room's current furniture is replaced (simple mode keeps one layout per room; alternatives are versions, ADR 0042) */
export type StartFrom = 'plan' | 'office' | 'guest' | 'empty';
export function startFrom(roomId: string, what: StartFrom) {
  const room = roomById(roomId);
  if (!room) return;
  let items: FurniturePlacement[] = [];
  if (what === 'plan') {
    // wall-mounted objects (wall cabinets, a TV) get a mounting record — as in the default arrangement
    const plan = architectFurniture(roomId, newId('arch')).map((f) => attachMounted(roomId, f));
    items = plan.length ? plan : defaultFurniture(roomId);
  } else if (what === 'office' || what === 'guest') {
    const r = arrangeScenario(room, what, []);
    items = r.placed;
    if (r.skipped.length) toast(t('actions.scenarioSkipped', { label: SCENARIOS.find((x) => x.id === what)!.label, items: r.skipped.join(', ') }), 'warn');
  }
  updateArrangement(roomId, t(`history.startFrom.${what}`), (a) => ({ ...a, furniture: items, ...(what === 'office' || what === 'guest' ? { scenario: what } : {}) }));
  ui.set({ selection: null });
}

// ------------------------------------------------------------------ furniture
const curRoom = () => roomById(ui.get().roomId);

export function deleteFurniture(roomId: string, id: string) {
  const p = furnitureById(arrangementOf(design.get(), roomId), id), it = p && itemById(p.catalogId);
  if (!p) return;
  updateArrangement(roomId, t('history.removeFurniture', { name: it ? displayName(it, p) : t('history.furnitureFallback') }), (a) => removeFurniture(a, id));
  ui.set({ selection: null });
}

export function duplicateSelected(roomId: string, id: string) {
  const room = roomById(roomId), p = furnitureById(arrangementOf(design.get(), roomId), id), it = p && itemById(p.catalogId);
  if (!room || !p || !it) return;
  // wall-mounted object: copy next to it, on the same wall and height; no room on the wall — a message, selection unchanged
  const mounted = duplicateMounted(roomId, id);
  if (mounted) { if (mounted.id) ui.set({ selection: { kind: 'furniture', roomId, id: mounted.id } }); return; }
  const d = resolveDims(it, p), off = Math.min(0.3, Math.max(0.15, d.w * 0.25));
  const nid = newId('f');
  updateArrangement(roomId, t('history.duplicateFurniture', { name: displayName(it, p) }), (a) => duplicateFurniture(a, id, [off, -off], nid).arrangement);
  ui.set({ selection: { kind: 'furniture', roomId, id: nid } });
}

export function patchFurniture(roomId: string, id: string, label: string, patch: Partial<FurniturePlacement>) {
  updateArrangement(roomId, label, (a) => patchPlacement(roomId, a, id, patch));
}

/** item variant change (e.g. bed / rug size): user dimensions reset, centre unchanged */
export function setFurnitureVariant(roomId: string, id: string, variant: string) {
  const p = furnitureById(arrangementOf(design.get(), roomId), id), it = p && itemById(p.catalogId);
  if (!p || !it) return;
  const v = it.variants?.find((x) => x.id === variant);
  updateArrangement(roomId, t('history.furnitureVariant', { name: it.name, variant: v?.name ?? variant }), (a) => patchPlacement(roomId, a, id, { variant, dims: null }));
}

// ------------------------------------------------------------------ finishes
/**
 * Preview of a change to the active variant without a history entry (colour sampler while choosing): the scene shows the colour
 * being chosen, and the change is committed once, by a regular action, when the picker closes. Preview and commit compute the
 * same change function.
 */
export const previewVariant = (fn: (v: Variant) => Variant) => preview((d) => withActiveVariant(d, fn));
/** preview of a room surface finish (wall / walls / floor / ceiling) */
export const previewFinish = (room: HomeRoom, target: FinishTarget, ref: FinishRef | null) => previewArrangement(room.id, (a) => setFinish(a, target, ref));
export function applyFinish(room: HomeRoom, target: FinishTarget, ref: FinishRef | null, label?: string) {
  const m = ref ? materialById(ref.materialId) : null;
  const what = target.kind === 'floor' ? t('history.finishFloor') : target.kind === 'ceiling' ? t('history.finishCeiling') : target.kind === 'walls' ? (target.wallIds.length === room.walls.length ? t('history.finishAllWalls') : target.wallIds.length > 1 ? t('history.finishWalls', { n: target.wallIds.length }) : t('history.finishWall')) : t('history.finishWall');
  updateArrangement(room.id, label ?? t('history.finish', { what, name: m?.name ?? t('history.finishDefault') }), (a) => setFinish(a, target, ref));
  if (ref?.color) ui.set((s) => ({ recentColors: [ref.color!, ...s.recentColors.filter((c) => c !== ref.color)].slice(0, 8) }));
}

/** rooms covered by a "whole home" change (no bathrooms, garages or technical rooms) */
export const HOUSE_WALL_ROOMS = () => allRooms().filter((r) => !['bath', 'garage', 'tech'].includes(r.kind));

/** finish of all walls in the home — one history entry (active arrangements of the rooms) */
export function applyWallsHouse(ref: FinishRef | null, label?: string) {
  const m = ref ? materialById(ref.materialId) : null;
  commit(label ? t('history.wholeHome', { label }) : t('history.wallsWholeHome', { name: m?.name ?? t('history.projectFinish') }), (d) => withActiveVariant(d, wallsHouseWith(ref)));
  if (ref?.color) ui.set((s) => ({ recentColors: [ref.color!, ...s.recentColors.filter((c) => c !== ref.color)].slice(0, 8) }));
}
const wallsHouseWith = (ref: FinishRef | null) => (v: Variant): Variant => {
  let interiors = v.interiors ?? {};
  for (const r of HOUSE_WALL_ROOMS()) interiors = withInterior(interiors, r.id, (ri) => withActive(ri, (a) => setFinish(a, { kind: 'walls', wallIds: r.walls.map((w) => w.id) }, ref)));
  return interiors === v.interiors ? v : { ...v, interiors };
};
export const previewWallsHouse = (ref: FinishRef | null) => previewVariant(wallsHouseWith(ref));

// ------------------------------------------------------------------ arrangements
export function saveArrangementAs(roomId: string, name: string) {
  const n = name.trim();
  if (!n) return;
  updateInterior(roomId, t('history.saveArrangement', { name: n }), (x) => saveArrangement(x, n));
  toast(t('actions.arrangementSaved', { name: activeArrangement(interiorOfRoom(design.get(), roomId)).name }));
}

export function duplicateArrangementAs(roomId: string, name: string) {
  const n = name.trim();
  updateInterior(roomId, t('history.copyArrangement', { name: n }), (x) => duplicateArrangement(x, n));
  toast(t('actions.copyCreated', { name: activeArrangement(interiorOfRoom(design.get(), roomId)).name }));
}

export const renameArr = (roomId: string, id: string, name: string) => updateInterior(roomId, t('history.renameArrangement', { name: name.trim() }), (x) => renameArrangement(x, id, name));
export const deleteArr = (roomId: string, id: string) => { updateInterior(roomId, t('history.deleteArrangement'), (x) => deleteArrangement(x, id)); ui.set({ selection: null }); };

/** loads an arrangement: it becomes the active arrangement of the room */
export function loadArr(roomId: string, id: string) {
  const ri = interiorOfRoom(design.get(), roomId);
  const target = ri.arrangements.find((a) => a.id === id);
  if (!target) return;
  commit(t('history.loadArrangement', { name: target.name }), (d) => withActiveVariant(d, (v) => ({ ...v, interiors: { ...(v.interiors ?? {}), [roomId]: loadArrangement(ri, id) } })));
  ui.set({ selection: null });
}

export function newArr(roomId: string, name: string) {
  updateInterior(roomId, t('history.newArrangement', { name }), (x) => newEmptyArrangement(x, name));
  ui.set({ selection: null });
}

/** furnishing proposal (OFFICE / GUEST ROOM / HYBRID) as a new arrangement — room geometry unchanged */
export function applyScenario(roomId: string, scenario: ScenarioPreset) {
  const room = roomById(roomId);
  if (!room) return;
  const def = SCENARIOS.find((s) => s.id === scenario)!;
  const { placed, skipped } = arrangeScenario(room, scenario, []);
  const name = t('actions.scenarioArrangementName', { label: def.label });
  updateInterior(roomId, t('history.scenario', { label: def.label }), (ri) => {
    const n = newEmptyArrangement(ri, name);
    return { ...n, arrangements: n.arrangements.map((a) => (a.id === n.activeArrangementId ? { ...a, furniture: placed, scenario } : a)) };
  });
  ui.set({ selection: null });
  toast(skipped.length ? t('actions.scenarioSkipped', { label: def.label, items: skipped.join(', ') }) : t('actions.scenarioPlaced', { label: def.label, count: placed.length }), skipped.length ? 'warn' : 'info');
}

/** the project's built-in kitchen in the current arrangement — other furniture stays */
export function applyKitchen(roomId: string) {
  const room = roomById(roomId);
  if (!room) return;
  // wall-mounted objects (wall cabinets) get a mounting record — as in the default arrangement
  const kit = kitchenBuiltIn(room, newId('arch')).map((f) => attachMounted(roomId, f));
  if (!kit.length) { toast(t('actions.noKitchen'), 'warn'); return; }
  updateArrangement(roomId, t('history.projectKitchen'), (a) => ({ ...a, furniture: [...a.furniture.filter((f) => !/^kitchen-|^pantry-front$/.test(f.catalogId)), ...kit] }));
  ui.set({ selection: null });
  toast(t('actions.kitchenPlaced', { count: kit.length }));
}

/** the furnishing shown in the project drawings as a NEW room arrangement ("Project layout") — existing arrangements stay unchanged */
export function applyArchitectLayout(roomId: string) {
  // wall-mounted objects (TV, wall cabinets) get a mounting record — as in the default arrangement
  const items = architectFurniture(roomId, newId('arch')).map((f) => attachMounted(roomId, f));
  if (!items.length) { toast(t('actions.noProjectFurnishing'), 'warn'); return; }
  const id = newId('arr');
  updateInterior(roomId, t('history.projectLayout'), (ri) => {
    const next = newEmptyArrangement(ri, t('actions.projectLayoutName'), id);
    return { ...next, arrangements: next.arrangements.map((a) => (a.id === id ? { ...a, furniture: items } : a)) };
  });
  ui.set({ selection: null });
  toast(t('actions.projectLayoutPlaced', { count: items.length }));
}

export function clearRoom(roomId: string) {
  updateArrangement(roomId, t('history.clearRoom'), (a) => (a.furniture.length ? { ...a, furniture: [] } : a));
  ui.set({ selection: null });
}

// ------------------------------------------------------------------ project variants ("versions" in the UI)
/** switching versions: the version being left keeps the current view, sun and picture (saved automatically, ADR 0041) — one
 *  history entry with the switch */
export function switchVariant(id: string) {
  if (docOf(design.get()).activeVariantId === id) return;
  const snap = snapshot();
  commit(t('history.switchVariant'), (d) => (d.activeVariantId === id ? d : { ...withActiveVariant(d, (v) => withSnapshot(v, snap)), activeVariantId: id }));
  ui.set({ selection: null });
  applyVariantView(docOf(design.get()).variants.find((v) => v.id === id));
}
/** "+ New version": a copy of the current design under the next free name ("Version 2"), which becomes active; the version
 *  left keeps its view and picture — one history entry */
export function newVersion() {
  const snap = snapshot();
  commit(t('history.newVersion'), (d) => {
    const cur = withSnapshot(d.variants.find((x) => x.id === d.activeVariantId)!, snap);
    let n = d.variants.length + 1;
    while (d.variants.some((v) => v.name === t('actions.versionName', { n }))) n++;
    const c = { ...duplicateVariant(cur, d.variants), name: t('actions.versionName', { n }) };
    return { ...d, variants: [...d.variants.map((v) => (v.id === cur.id ? cur : v)), c], activeVariantId: c.id };
  });
  ui.set({ selection: null });
}
/** a version's picture for its card: the active one from the scene as it is now (not stored), the others as stored */
export const liveThumbnail = (): string | null => captureThumbnail();
export const renameVersion = (id: string, name: string) => { const n = name.trim(); if (n) commit(t('history.renameVariant'), (d) => ({ ...d, variants: d.variants.map((v) => (v.id === id ? renameVariant(v, uniqueVariantName(d.variants.filter((x) => x.id !== id), n)) : v)) })); };
/** "Start over": the version returns to the project's state (its name and electrical layout stay) — one history entry */
export function resetVersion(id: string) {
  const ok = commit(resetLabel(), (d) => ({ ...d, variants: d.variants.map((v) => (v.id === id ? projectDefaultVariant(v) : v)) }));
  if (ok) { ui.set({ selection: null }); toast(t('actions.variantReset')); } else toast(t('actions.variantAlreadyDefault'));
  return ok;
}

// ------------------------------------------------------------------ complete variant (view, sun, thumbnail, facade)
/** current view: camera (LCS), FOV, surroundings (a project without the environment module: always off — the device preference does not apply) */
export function currentView(): VariantView | null {
  const c = sceneApi.camera as THREE.PerspectiveCamera | null;
  if (!c || !c.isPerspectiveCamera) return null;
  const lcs = (v: THREE.Vector3): Vec3 => [round(v.x, 3), round(-v.z, 3), round(v.y, 3)];
  const t = sceneApi.target ?? c.position.clone().add(c.getWorldDirection(c.position.clone()).multiplyScalar(10));
  return { position: lcs(c.position), target: lcs(t), fov: round(c.fov, 2), environment: hasModule('environment') && ui.get().environment };
}
/** time of day to store in the variant — only for a project with the sun module (a variant of a project without sun has no time of day) */
export const currentSun = (): VariantSun | null => (hasModule('sun') ? { ...ui.get().sun } : null);

/** thumbnail from the current scene image: 320 × 200 px (centre crop), JPEG */
export function captureThumbnail(): string | null {
  const cv = sceneApi.dom;
  if (!cv || ui.get().compare || typeof document === 'undefined') return null;
  try {
    const W = 320, H = 200, t = document.createElement('canvas');
    t.width = W; t.height = H;
    const k = Math.max(W / cv.width, H / cv.height), sw = W / k, sh = H / k;
    t.getContext('2d')!.drawImage(cv, (cv.width - sw) / 2, (cv.height - sh) / 2, sw, sh, 0, 0, W, H);
    return t.toDataURL('image/jpeg', 0.74);
  } catch { return null; }
}

/** stored in the variant: view, sun, thumbnail (joinery and interiors unchanged) */
const snapshot = () => ({ view: currentView(), sun: currentSun(), thumbnail: captureThumbnail(), updatedAt: new Date().toISOString() });
const withSnapshot = (v: Variant, snap: ReturnType<typeof snapshot>): Variant => ({ ...v, view: snap.view ?? v.view ?? null, sun: snap.sun, thumbnail: snap.thumbnail ?? v.thumbnail ?? null, updatedAt: snap.updatedAt });

/** new variant: empty interiors (the project default furnishing) */
export function newVariant(name: string) {
  commit(t('history.newVariant', { name: name.trim() }), (d) => {
    const v = createVariant(uniqueVariantName(d.variants, name));
    return { ...d, variants: [...d.variants, v], activeVariantId: v.id };
  });
  ui.set({ selection: null });
}

/**
 * The variant in the state that follows from the project package: interiors empty (the project default furnishing), stairs
 * bare, no view and no sun. Kept: id and name of the variant and its own electrical layout — the electrical plan is not part of
 * the project facts the variant returns to.
 */
export function projectDefaultVariant(v: Variant): Variant {
  const own = v.electrical;
  return { ...createVariant(v.name, v.id), ...(own ? { electrical: own } : {}) };
}
/** history label of the reset ("Undone: …") — mentions what the project has */
export function resetLabel(): string {
  return hasCapability('interiors') ? t('history.resetWithInteriors') : t('history.reset');
}
/** "Restore project settings": the active variant returns to the state of the project package — one history entry (Undo restores everything) */
export function resetVariantToProject(): boolean {
  const ok = commit(resetLabel(), (d) => withActiveVariant(d, projectDefaultVariant));
  if (ok) { ui.set({ selection: null }); toast(t('actions.variantReset')); } else toast(t('actions.variantAlreadyDefault'));
  return ok;
}

/**
 * Project furniture in ALL rooms: the active arrangement of every room gets the project default furnishing (what the room has
 * before anything in it is changed). Finishes, saved arrangements and the rest of the variant stay. Rooms without their own
 * record already show the project furniture — they are left untouched.
 */
export function furnitureFromProject(v: Variant): Variant {
  if (!v.interiors) return v;
  let interiors = v.interiors;
  for (const roomId of Object.keys(interiors)) {
    const def = defaultFurniture(roomId), same = JSON.stringify(def);
    interiors = withInterior(interiors, roomId, (ri) => withActive(ri, (a) => (JSON.stringify(a.furniture) === same ? a : { ...a, furniture: def })));
  }
  return interiors === v.interiors ? v : { ...v, interiors };
}
/** "Restore project furniture": one history entry (Undo restores all rooms at once) */
export function resetFurnitureToProject(): boolean {
  const ok = commit(t('history.resetFurniture'), (d) => withActiveVariant(d, furnitureFromProject));
  if (ok) { if (ui.get().selection?.kind === 'furniture') ui.set({ selection: null }); toast(t('actions.furnitureReset')); }
  else toast(t('actions.furnitureAlreadyDefault'));
  return ok;
}

export function uniqueVariantName(list: Variant[], name: string): string {
  const base = name.trim() || t('actions.variantFallbackName');
  let n = base, i = 2;
  while (list.some((v) => v.name === n)) n = `${base} (${i++})`;
  return n;
}

/**
 * After choosing a variant: its sun, surroundings and (in the exterior view of the home) camera. Sun and surroundings — only in a
 * project with those modules: the surroundings state is a device preference shared by projects, so a project without the module
 * must not change it.
 */
export function applyVariantView(v: Variant | undefined) {
  const x = v && v;
  if (!x) return;
  if (x.sun && hasModule('sun')) ui.set({ sun: { ...x.sun } });
  if (x.view) {
    if (hasModule('environment')) ui.set({ environment: x.view.environment });
    const s = ui.get();
    if (!s.roomId && s.houseView === 'exterior') ui.set((u) => ({ camera: { preset: 'pose', n: u.camera.n + 1, pose: { position: x.view!.position, target: x.view!.target, fov: x.view!.fov } } }));
  }
}

/** stair finish in the variant: a field patch (handrail and balustrade are merged with the existing ones); null — back to the bare state (concrete) */
export function setVariantStairs(patch: DeepPartial<StairsConfig> | null, label: string) {
  if (!hasStairs()) return;                                                 // project without stairs: nothing to finish — document unchanged
  updateVariant(label, stairsWith(patch));
}
const stairsWith = (patch: DeepPartial<StairsConfig> | null) => (v: Variant): Variant => {
  if (patch === null) { const { stairs: _drop, ...rest } = v; void _drop; return rest as Variant; }
  const cur = v.stairs ?? {};
  return { ...v, stairs: { ...cur, ...patch, ...(patch.handrail ? { handrail: { ...(cur.handrail ?? {}), ...patch.handrail } } : {}), ...(patch.balustrade ? { balustrade: { ...(cur.balustrade ?? {}), ...patch.balustrade } } : {}) } } as Variant;
};
export const previewVariantStairs = (patch: DeepPartial<StairsConfig>) => { if (hasStairs()) previewVariant(stairsWith(patch)); };
/** variant export (JSON file to download) */
export function exportVariantFile(id: string) {
  const doc = docOf(design.get()), f = exportVariant(doc, id), v = doc.variants.find((x) => x.id === id)!;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(f, null, 1) + '\n'], { type: 'application/json' }));
  a.download = `variant-${v.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home'}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  return f;
}

/** variant import from a JSON file (schema and data validation); the added variant becomes active */
export function importVariantFile(text: string): { ok: boolean; message: string; errors?: string[] } {
  const r = importVariant(text, docOf(design.get()), (d) => docErrors(d), () => newId('v'), t('document.variantFromFile'));
  if (!r.ok) { toast(t('actions.variantImportFailed', { errors: `${r.errors.slice(0, 2).join('; ')}${r.errors.length > 2 ? ` (+${r.errors.length - 2})` : ''}` }), 'error'); return { ok: false, message: r.errors[0], errors: r.errors }; }
  commit(t('history.importVariant', { name: r.name }), () => r.doc);
  ui.set({ selection: null });
  applyVariantView(r.doc.variants.find((v) => v.id === r.variantId));
  toast(r.warnings.length ? t('actions.variantImportedWarn', { name: r.name, warnings: r.warnings.join('; ') }) : t('actions.variantImported', { name: r.name }));
  return { ok: true, message: r.name };
}

// ------------------------------------------------------------------ A/B comparison
export function startCompare(a: string, b: string) {
  if (a === b) { toast(t('actions.compareTwoVariants'), 'warn'); return; }
  ui.set({ compare: { kind: 'variants', a, b }, selection: null });
}
export function startRoomCompare(roomId: string, a: string, b: string) {
  const r = roomById(roomId);
  if (!r || a === b) { toast(t('actions.compareTwoArrangements'), 'warn'); return; }
  if (ui.get().roomId !== roomId) enterRoom(roomId, r.level);
  ui.set((s) => ({ compare: { kind: 'room', roomId, a, b }, selection: null, roomView: s.roomView === 'walk' ? '3d' : s.roomView }));
}
export const swapCompare = () => ui.set((s) => ({ compare: s.compare ? { ...s.compare, a: s.compare.b, b: s.compare.a } : null }));
/** "Compare" in Versions: the active version against another one (with two versions — the other one) */
export function compareWith(other: string) {
  const d = docOf(design.get());
  startCompare(d.activeVariantId, other);
}
export const exitCompare = () => ui.set({ compare: null });
export function duplicateProjectVariant() {
  commit(t('history.duplicateVariant'), (d) => {
    const v = d.variants.find((x) => x.id === d.activeVariantId)!, c = duplicateVariant(v, d.variants);
    return { ...d, variants: [...d.variants, c], activeVariantId: c.id };
  });
}
export const renameProjectVariant = (name: string) => updateVariant(t('history.renameVariant'), (v) => renameVariant(v, name));
export function deleteProjectVariant(id: string) {
  commit(t('history.deleteVariant'), (d) => {
    if (d.variants.length <= 1) return d;
    const rest = d.variants.filter((v) => v.id !== id);
    return { ...d, variants: rest, activeVariantId: d.activeVariantId === id ? rest[0].id : d.activeVariantId };
  });
}

// ------------------------------------------------------------------ camera bookmarks
export function addBookmark(name: string) {
  const c = sceneApi.camera as THREE.PerspectiveCamera | null, tg = sceneApi.target;
  const s = ui.get();
  // walk through the home and site: target = a point 1 m in front of the eyes (view direction), view 'walk' — opening returns to the walk
  const walking = s.houseView === 'walk' && !s.roomId;
  if (!c || (!tg && !walking)) return;
  const lcs = (v: THREE.Vector3): Vec3 => [round(v.x, 3), round(-v.z, 3), round(v.y, 3)];
  const tgt = walking || !tg ? c.position.clone().add(c.getWorldDirection(c.position.clone())) : tg;
  const b: CameraBookmark = { id: newId('cam'), name: name.trim() || t('actions.bookmarkFallbackName'), position: lcs(c.position), target: lcs(tgt), fov: c.isPerspectiveCamera ? round(c.fov, 2) : 45, roomId: s.roomId, view: s.roomId ? s.roomView : walking ? 'walk' : null };
  commit(t('history.addBookmark', { name: b.name }), (d) => ({ ...d, bookmarks: [...(d.bookmarks ?? []), b] }));
}
/** "Save view" in Look: the current camera as a place named "My view 1", "My view 2", … (no typing) */
export function addBookmarkAuto() {
  const have = new Set((docOf(design.get()).bookmarks ?? []).map((b) => b.name));
  let n = 1;
  while (have.has(t('actions.myView', { n }))) n++;
  addBookmark(t('actions.myView', { n }));
}
export const deleteBookmark = (id: string) => commit(t('history.deleteBookmark'), (d) => ({ ...d, bookmarks: (d.bookmarks ?? []).filter((b) => b.id !== id) }));
export function openBookmark(b: CameraBookmark) {
  if (b.view === 'walk' && !b.roomId) {
    const dx = b.target[0] - b.position[0], dy = b.target[1] - b.position[1], dz = b.target[2] - b.position[2];
    startWalk({ pose: { p: [b.position[0], b.position[1]], z: b.position[2] - ui.get().eyeHeight, yaw: Math.atan2(-dx, dy), pitch: Math.atan2(dz, Math.hypot(dx, dy)) }, fov: b.fov });
    return;
  }
  if (b.roomId && roomById(b.roomId)) { const r = roomById(b.roomId)!; ui.set({ roomId: r.id, level: r.level, roomView: b.view === 'top' ? 'top' : '3d', selection: null }); }
  else ui.set({ roomId: null, houseView: 'exterior', selection: null });
  cameraTo('bookmark', b.id);
}

export { curRoom };

// ------------------------------------------------------------------ doors — view state, no entry in the project history
/** arm's reach in a walk: from how far from the opening a door can be opened / closed [m] */
export const DOOR_REACH = 3.2;
/** camera position in plan (LCS) — in a walk: where the user stands */
const cameraXY = (): Vec2 | null => (sceneApi.camera ? [sceneApi.camera.position.x, -sceneApi.camera.position.z] : null);
const walking = () => isWalking(ui.get());

/** opening / closing a door (door card, walk): open — degree of opening 0…1. In a walk it does not close the door the camera stands in. */
export function setDoor(id: string, open: number): boolean {
  const p = cameraXY();
  if (!isOperable(id)) return false;
  if (walking() && open < openOf(doors.get(), id) && open < 0.6 && p && standsIn(id, p)) { toast(t('actions.standingInDoorway'), 'warn'); return false; }
  openDoor(id, open);
  return true;
}
/** centre of the door opening in plan */
function doorMid(id: string): Vec2 | null {
  const d = doorById(id);
  return d ? doorCenter(d) : null;
}
/** whether a point stands in the door opening (no closing the door "on the user") */
function standsIn(id: string, p: Vec2): boolean {
  const d = doorById(id);
  return !!d && inDoorway(d, p);
}
/** a door clicked from further away is walked up to: the walk stops this far from the opening [m] */
export const DOOR_WALK_TO = 1.4;
/** walk: clicking / tapping a door — open or close it; from further than arm's reach the walk first goes up to the door */
export function toggleDoorInWalk(id: string): boolean {
  const p = cameraXY(), c = doorMid(id);
  if (!isOperable(id)) return false;
  if (p && c && Math.hypot(p[0] - c[0], p[1] - c[1]) > DOOR_REACH) {
    walkInput.to = { p: c, reach: DOOR_WALK_TO, done: () => { toggleDoorInWalk(id); }, fail: () => toast(t('actions.comeCloserToDoor')) };
    return true;
  }
  if (openOf(doors.get(), id) >= 0.5) return setDoor(id, 0);
  toggleDoorOpen(id);
  return true;
}

// ------------------------------------------------------------------ electrical plan / smart home
/** whether the active variant has its own electrical layout (otherwise — the document's global plan) */
export const electricalScope = (): 'global' | 'variant' => (variantOf(design.get()).electrical ? 'variant' : 'global');
export const planNow = (): ElectricalPlan => { const s = design.get(); return resolvePlan(docOf(s).electrical, variantOf(s).electrical); };
const withPlan = (d: import('../document/model').ConfiguratorDoc, fn: (p: ElectricalPlan) => ElectricalPlan) => {
  const v = d.variants.find((x) => x.id === d.activeVariantId) ?? d.variants[0], own = v.electrical;
  const next = fn(resolvePlan(d.electrical, own));
  return own ? withActiveVariant(d, (x) => ({ ...x, electrical: next } as Variant)) : { ...d, electrical: next };
};
/** plan change — one history entry (global Undo / Redo) */
export const commitPlan = (label: string, fn: (p: ElectricalPlan) => ElectricalPlan) => commit(label, (d) => withPlan(d, fn));
/** preview while dragging (no history entry) */
export const previewPlan = (fn: (p: ElectricalPlan) => ElectricalPlan) => preview((d) => withPlan(d, fn));
/** adds a point at the given placement; selects the new point; the tool stays active (further clicks add further points) */
export function addElectrical(type: ElType, at: Placement, extra: Partial<ElPoint> = {}): string | null {
  let id: string | null = null;
  const r = elRoom(at.roomId);
  commitPlan(r && !r.exterior ? t('history.elAddInRoom', { name: EL_TYPES[type].short, room: r.name }) : t('history.elAdd', { name: EL_TYPES[type].short }), (p) => { const a = addPoint(p, type, at, extra); id = a.point.id; return a.plan; });
  if (id) ui.set({ selection: { kind: 'electrical', id } });
  return id;
}
/** the point exists in the effective plan — the selection may point at a device that no longer exists (an undone addition) */
const hasElectrical = (id: string) => planNow().points.some((p) => p.id === id);
/** point change; a non-existent point: nothing happens (false) — no history entry, the document and "Redo" stay untouched
 *  (such a "change" must not write the source points into a fresh document nor clear "Redo"). */
export const patchElectrical = (id: string, patch: Partial<ElPoint>, label: string) => hasElectrical(id) && commitPlan(label, (p) => updatePoint(p, id, patch));
export const previewElectrical = (id: string, patch: Partial<ElPoint>) => previewPlan((p) => updatePoint(p, id, patch));
export function removeElectrical(id: string) {
  if (hasElectrical(id)) commitPlan(t('history.elRemove', { id }), (p) => removePoint(p, id));
  if (ui.get().selection?.kind === 'electrical') ui.set({ selection: null });
}
/** duplicate of a point next to it (30 cm further along the wall / in plan) */
export function duplicateElectrical(id: string): string | null {
  const src = planNow().points.find((p) => p.id === id);
  if (!src) return null;
  const w = elWall(src.roomId, src.wallId), { id: _old, ...rest } = src; void _old;
  const at: Placement = { roomId: src.roomId, wallId: src.wallId, orientation: src.orientation, heightAFFL: src.heightAFFL, positionAlongWall: w ? Math.max(0.05, Math.min(w.length - 0.05, src.positionAlongWall + (src.positionAlongWall + 0.3 < w.length ? 0.3 : -0.3))) : 0, x: src.x === undefined ? undefined : src.x + 0.3, y: src.y };
  return addElectrical(src.type, at, { ...rest, ...at, source: 'user', status: 'planned' });
}
/** GLOBAL vs variant: splitting copies the current plan into the variant; going back removes the variant layout (the global one applies) */
export function setElectricalScope(scope: 'global' | 'variant') {
  if (scope === electricalScope()) return;
  if (scope === 'variant') commit(t('history.elOwnLayout'), (d) => withActiveVariant(d, (v) => ({ ...v, electrical: JSON.parse(JSON.stringify(resolvePlan(d.electrical, null))) } as Variant)));
  else commit(t('history.elSharedPlan'), (d) => withActiveVariant(d, (v) => { const { electrical: _drop, ...rest } = v; void _drop; return rest as Variant; }));
}
export function selectElectrical(id: string | null) { ui.set({ selection: id ? { kind: 'electrical', id } : null }); }
export const setElTool = (t: ElType | null) => ui.set((s) => ({ elTool: s.elTool === t ? null : t, ...(t ? { selection: null } : {}) }));
// ------------------------------------------------------------------ ELECTRICAL mode — view, room, height
/** the room from before the eye-level view — going back to plan / 3D returns to it */
let walkFrom: { roomId: string | null; level: LevelId } | null = null;
const elWalking = () => isWalking(ui.get());
/** PLAN | 3D | eye level. Plan and 3D show the same level and the same room; the walk starts in the current room. */
export function setElView(v: ElView) {
  const s = ui.get();
  if (v === 'walk') {
    if (elWalking()) { ui.set({ elView: 'walk' }); return; }
    // no room selected: the largest room of the current level
    const room = roomById(s.roomId) ?? [...roomsOfLevel(s.level)].sort((a, b) => b.area - a.area)[0] ?? null;
    walkFrom = { roomId: s.roomId, level: s.level };
    ui.set({ elView: 'walk', elSite: false, elPanel: null });
    if (!room) { startWalk(); return; }
    // facing a solid wall (no openings) — that is where points most often go
    const free = (x: HomeRoom['walls'][number]) => x.length - x.holes.reduce((n, h) => n + Math.abs(h.t1 - h.t0), 0);
    const solid = room.walls.filter((x) => !x.holes.length && x.length >= 1.5);
    const w = solid.length ? [...solid].sort((a, b) => b.length - a.length)[0] : [...room.walls].sort((a, b) => free(b) - free(a))[0];
    const dx = w ? (w.a[0] + w.b[0]) / 2 - room.center[0] : 0, dy = w ? (w.a[1] + w.b[1]) / 2 - room.center[1] : 1;
    // pitch by the distance to the wall: the socket line (30 cm) and the new device preview must be in frame right after entering
    startWalk({ pose: { p: room.center, z: room.floorZ, yaw: Math.atan2(-dx, dy), pitch: eyeLevelPitch(Math.hypot(dx, dy), s.eyeHeight, EYE_LEVEL_FOV) }, fov: EYE_LEVEL_FOV });
    return;
  }
  const walking = elWalking(), back = walking ? roomById(walkFrom?.roomId ?? null) : null;
  if (walking) walkFrom = null;
  ui.set((u) => {
    const room = walking ? back : roomById(u.roomId);
    return { elView: v, ...(v === '3d' ? { elSite: false } : {}), roomView: '3d' as const, houseView: 'interior' as const, ...(walking ? { roomId: back?.id ?? null, level: back?.level ?? u.level } : {}),
      camera: { preset: room ? 'room' as const : 'interior' as const, n: u.camera.n + 1 } };
  });
}
/** FOCUS ON ROOM (plan: zoom, 3D: room view) or WHOLE HOME (null) */
export function elFocusRoom(roomId: string | null) {
  const r = roomById(roomId);
  if (elWalking()) return;
  if (!r) { ui.set((u) => ({ roomId: null, roomView: '3d', houseView: 'interior', hoverRoom: null, camera: { preset: 'interior', n: u.camera.n + 1 } })); return; }
  ui.set((u) => ({ roomId: r.id, level: r.level, elSite: false, roomView: '3d', houseView: 'interior', hoverRoom: null, camera: { preset: 'room', n: u.camera.n + 1 } }));
}
/** plan level or site plan (plan view only) */
export function setElLevel(v: LevelId | 'SITE') {
  // a preview pointed at in the previous view (level / site) does not belong to the new one — the placing session continues
  forgetPlace();
  if (v === 'SITE') { if (elWalking()) setElView('2d'); ui.set({ elSite: true, elView: '2d', roomId: null, level: siteLevelId() ?? baseLevel().id, houseView: 'interior' }); return; }
  if (elWalking()) setElView(ui.get().elView === 'walk' ? '3d' : ui.get().elView);
  ui.set((u) => ({ elSite: false, level: v, roomId: null, roomView: '3d', houseView: 'interior', camera: { preset: 'interior', n: u.camera.n + 1 } }));
}
/** device height from the card (− / + / typed value / quick value): one history entry; remembered for the type.
 *  Limits as when dragging: 5 cm above the floor … 5 cm below the ceiling / slope at the device position (model/elPlacement.ts). */
export function setElHeight(id: string, h: number) {
  const p = planNow().points.find((x) => x.id === id);
  if (!p || p.orientation === 'ceiling') return;
  const [lo, hi] = heightRange(p), v = Math.round(Math.max(lo, Math.min(hi, h)) * 1000) / 1000;
  if (Math.abs(v - p.heightAFFL) < 1e-6) return;
  patchElectrical(id, { heightAFFL: v }, t('history.elHeight', { height: fmtCm(v) }));
  ui.set((u) => ({ elHeights: { ...u.elHeights, [p.type]: v } }));
}
