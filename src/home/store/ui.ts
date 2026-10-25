// UI state (transient, not part of the project): section, Home / Expert mode, level, room (Room Mode) and view
// (3D / TOP / WALK), selection, camera commands, catalog drag, snap lines, toasts.
// Preferences (mode, snapping, onboarding, surroundings) — localStorage.
import { t } from '../../i18n';
import { hasCapability, hasModule, project } from '../../project/active';
import type { ProjectCapability } from '../../project/types';
import { homeViewId } from '../model/views';
import type { ElLayer, ElType } from '../model/electrical';
import { baseLevel, levelById, roomById } from '../model/rooms';
import type { LevelId, RoomView, Vec2 } from '../model/types';
import { createStore, useStore } from './createStore';
import { walkHud } from './walk';
import { classifyMobileGpu, defaultTier, detectPlatform, deviceClass, forDevice, profileWithSaver, webglRendererString, withDebug, type Platform, type Tier } from '../quality/profile';

 /** graphics quality: high — 2048 px shadows, glass with transmission, PBR maps; medium — 1024 px shadows; low — no shadows or maps */
export type Quality = Tier;

export type Section = 'building' | 'interiors' | 'materials' | 'furniture' | 'electrical' | 'variants' | 'expert';
const ALL_SECTIONS: { id: Section; capability?: ProjectCapability }[] = [
  { id: 'building' }, { id: 'interiors', capability: 'interiors' }, { id: 'materials', capability: 'interiors' }, { id: 'furniture', capability: 'interiors' },
  { id: 'electrical', capability: 'electrical' }, { id: 'variants', capability: 'variants' },
];
/** navigation sections of the active project (Expert — additionally, only in expert mode): a capability section is there when
 *  the project uses the capability; the first section is named after the building type */
export const sections = (): { id: Section; label: string }[] => ALL_SECTIONS.filter((x) => !x.capability || hasCapability(x.capability))
  .map((x) => ({ id: x.id, label: x.id === 'building' ? t(`section.building.${project().manifest.buildingType}`) : t(`section.${x.id}`) }));

export type Selection =
  | { kind: 'furniture'; roomId: string; id: string }
  /** wall; wallIds — several selected walls of a room (Ctrl / Shift + click, toggles in the panel) */
  | { kind: 'wall'; roomId: string; wallId: string; wallIds?: string[] }
  | { kind: 'floor'; roomId: string }
  | { kind: 'ceiling'; roomId: string }
  | { kind: 'room'; roomId: string }
  /** door: door card — open / close, angle */
  | { kind: 'door'; id: string }
  /** stairs: finish card (cladding, handrail, balustrade) */
  | { kind: 'stairs' }
  /** electrical / smart-home point */
  | { kind: 'electrical'; id: string }
  | { kind: 'house'; name: string; data: Record<string, unknown>; point: [number, number, number] }
  | null;

/** building view without entering a room: exterior (camera preset), level section ("doll's house") or a walk through the
 *  building and site (eye level, WASD + mouse look, stairs, walking outside) */
export type HouseView = 'exterior' | 'interior' | 'walk';

/** walk command: start at a viewpoint (eye-level bookmark) or at a given spot (counter — repetition) */
/** `eye` / `fov` (WINDOW VIEW CHECK): eye height and field of view for this start only — the user setting is unchanged;
 *  `windowView` — id of the check view (information for the UI and tests);
 *  `from` — a walk started IN A ROOM (the room walk turned into a home walk at the stairs / exterior doors): the room editing
 *  context stays — room surfaces underfoot can be picked, and ending the walk returns to the room */
export interface WalkGo { viewpointId?: string | null; pose?: { p: Vec2; z: number; yaw: number; pitch: number } | null; eye?: number; fov?: number; windowView?: string | null; from?: { roomId: string; level: LevelId } | null; n: number }

/** building view: a project view id (model/views.ts) or "interior" — level cutaway */
export type CameraPresetId = string;

export interface UiState {
  mode: 'home' | 'expert';
  section: Section;
  houseView: HouseView;
  level: LevelId;
  roomId: string | null;
  roomView: RoomView;
  /** camera command (counter — the same preset can be repeated) */
  /** preset: a building view or a reserved command — 'room' (room framing), 'bookmark' (bookmark), 'pose' (given pose) */
  camera: { preset: CameraPresetId; n: number; bookmarkId?: string; pose?: CameraPose };
  selection: Selection;
  snap: { enabled: boolean; grid: number };
  toast: { text: string; level: 'info' | 'warn' | 'error'; n: number } | null;
  onboardingDone: boolean;
  environment: boolean;
  settingsOpen: boolean;
  expert: {
    grid: boolean; axes: boolean; wireframe: boolean; perf: boolean; confidence: boolean;
    tab: 'layers' | 'object' | 'config' | 'perf';
  };
  /** scope of a wall material change: selected walls / whole room / whole home */
  wallScope: 'one' | 'all' | 'house';
  /** highlighted room (hover in the cutaway / in the list) */
  hoverRoom: string | null;
  autosave: boolean;
  /** eye height in walk mode [m] */
  eyeHeight: number;
  /** recently used material / paint colour (quick repeat) */
  recentColors: string[];
  quality: Quality;
  /** quality profile platform — detected automatically (platformAuto) or chosen by the user */
  platform: Platform;
  platformAuto: boolean;
  /** "Battery saver" (phone / tablet) — balanced profile + 60 fps limit */
  batterySaver: boolean;
  /** mobile layout: bottom drawer state — collapsed / medium / expanded */
  sheet: 'collapsed' | 'medium' | 'expanded';
  /** A ↔ B comparison on a phone — the side shown (same camera) */
  compareSide: 'A' | 'B';
  /** neutral interior finish where no materials are chosen (preview — not saved in the project) */
  neutralInterior: boolean;
  walkGo: WalkGo;
  /** date (YYYY-MM-DD) and time (minutes from local midnight) of the sun simulation */
  sun: { date: string; minutes: number };
  /** sun panel expanded */
  sunPanel: boolean;
  /** A/B comparison (split screen) — two home variants or two room arrangements; null — no comparison */
  compare: Compare;
  /** "add point" tool (type) — clicking a wall / ceiling / plan adds a point; null — none */
  elTool: ElType | null;
  /** visibility of symbol layers (Sockets, Lights, Smart Home, Data, Sensors, Boards) */
  elLayers: Record<ElLayer, boolean>;
  /** snapping when moving points [m]: 0 — none, 0.05, 0.10 */
  elSnap: number;
  /** ELECTRICAL mode plan: furniture as a light background */
  elPlanFurniture: boolean;
  /** ELECTRICAL mode: view (plan / 3D / eye level), site plan instead of a level, label density on the plan */
  elView: ElView;
  elSite: boolean;
  elLabels: 'none' | 'id' | 'full';
  /** open toolbar panel: device catalogue, layers, export */
  elPanel: 'catalog' | 'layers' | 'export' | null;
  /** ADD MANY (series) — the last choice */
  elMulti: boolean;
  /** the last height used for devices of a type [m] — the start for the next ones */
  elHeights: Partial<Record<ElType, number>>;
  /** card of the selected device: "More" expanded */
  elMore: boolean;
  /** short tips on first entry — shown */
  elTipsDone: boolean;
}
export type ElView = '2d' | '3d' | 'walk';

export type Compare = { kind: 'variants'; a: string; b: string } | { kind: 'room'; roomId: string; a: string; b: string } | null;
/** camera pose (LCS) — the view stored in a variant */
export interface CameraPose { position: [number, number, number]; target: [number, number, number]; fov: number }

/** today's date (browser calendar) */
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const qDate = /^\d{4}-\d{2}-\d{2}$/.test(q0('date') ?? '') ? q0('date')! : null;
const qTime = (() => { const m = /^(\d{1,2}):(\d{2})$/.exec(q0('time') ?? ''); return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : null; })();
function q0(k: string) { return typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(k) : null; }

const LS = 'home-simulator.ui.v1';
function prefs(): Partial<UiState> {
  try { return JSON.parse(window.localStorage.getItem(LS) ?? '{}') as Partial<UiState>; } catch { return {}; }
}
const p = typeof window !== 'undefined' ? prefs() : {};
const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

// deep links: /?section=interiors&room=<id>
// (ids only — labels are not computed at module load, before the UI language is set)
const qSection = ALL_SECTIONS.find((x) => x.id === q.get('section') && (!x.capability || hasCapability(x.capability)))?.id ?? null;
// room from the URL — only one that exists in the project; starting level: the room's or the project default
const qRoom = roomById(q.get('room'))?.id ?? null;
const startLevel = roomById(qRoom)?.level ?? levelById(project().manifest.defaultView.levelId)?.id ?? baseLevel().id;
// quality profile platform — ?platform=desktop|mobile (tests, diagnostics) → the user's saved choice → detection
const qPlatform: Platform = q.get('platform') === 'mobile' || q.get('platform') === 'desktop' ? q.get('platform') as Platform
  : p.platformAuto === false && (p.platform === 'mobile' || p.platform === 'desktop') ? p.platform
  : typeof navigator !== 'undefined' ? detectPlatform() : 'desktop';
// phone GPU class (a general rule from the WebGL renderer string) — default tier and max DPR; ?gpuclass=flagship|standard (tests)
if (qPlatform === 'mobile' && typeof navigator !== 'undefined') {
  deviceClass.renderer = webglRendererString();
  const forced = q.get('gpuclass');
  deviceClass.gpu = forced === 'flagship' || forced === 'standard' ? forced : classifyMobileGpu(deviceClass.renderer, (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null);
}
if (typeof window !== 'undefined' && (q.has('section') || q.has('room'))) {
  const u = new URL(window.location.href); ['section', 'room'].forEach((k) => u.searchParams.delete(k)); window.history.replaceState(null, '', u);
}

export const ui = createStore<UiState>({
  mode: q.get('mode') === 'expert' ? 'expert' : (p.mode ?? 'home'),
  section: qSection ?? 'building',
  houseView: qRoom ? 'interior' : project().manifest.defaultView.view ?? 'exterior',
  level: startLevel,
  roomId: qRoom,
  roomView: '3d',
  camera: { preset: homeViewId(), n: 0 },
  selection: null,
  snap: p.snap ?? { enabled: true, grid: 0 },
  toast: null,
  onboardingDone: q.get('onboarding') === 'off' ? true : (p.onboardingDone ?? false),
  // surroundings belong to a project module: a project without it has them off regardless of the device preference (shared by projects)
  environment: hasModule('environment') && (q.get('env') === 'off' ? false : (p.environment ?? true)),
  settingsOpen: false,
  expert: { grid: false, axes: true, wireframe: false, perf: true, confidence: false, tab: 'layers' },
  wallScope: 'one',
  hoverRoom: null,
  autosave: p.autosave ?? true,
  eyeHeight: p.eyeHeight ?? 1.68,
  recentColors: p.recentColors ?? [],
  platform: qPlatform,
  platformAuto: !(q.get('platform') === 'desktop' || q.get('platform') === 'mobile') && p.platformAuto !== false,
  batterySaver: q.get('saver') === 'on' ? true : q.get('saver') === 'off' ? false : (p.batterySaver ?? false),
  sheet: 'collapsed',
  compareSide: 'A',
  // tier: ?quality= (tests, links) → saved choice → platform default (desktop — high, phone — balanced)
  quality: (['high', 'medium', 'low'] as Quality[]).find((x) => x === q.get('quality')) ?? p.quality ?? defaultTier(qPlatform, deviceClass.gpu),
  neutralInterior: q.get('neutral') === 'off' ? false : (p.neutralInterior ?? true),
  walkGo: { n: 0 },
  // default: today, 14:00 (afternoon); ?date=YYYY-MM-DD&time=HH:MM
  // a project without the sun module: always the default light and no panel — the URL and the device preference do not apply
  sun: { date: (hasModule('sun') ? qDate : null) ?? todayIso(), minutes: (hasModule('sun') ? qTime : null) ?? 14 * 60 },
  sunPanel: hasModule('sun') && (q.get('sun') === 'open' ? true : (p.sunPanel ?? false)),
  compare: null,
  elTool: null,
  elLayers: { sockets: true, lights: true, smart: true, data: true, sensors: true, boards: true, ...(p.elLayers ?? {}) },
  elSnap: p.elSnap ?? 0.05,
  elPlanFurniture: p.elPlanFurniture ?? true,
  // first use: PLAN (easiest for placing many points); later — the last used view (a walk is not resumed)
  elView: q.get('elview') === '3d' ? '3d' : q.get('elview') === '2d' ? '2d' : p.elView === '3d' ? '3d' : '2d',
  elSite: false,
  elLabels: p.elLabels === 'id' || p.elLabels === 'full' ? p.elLabels : 'none',
  elPanel: null,
  elMulti: p.elMulti ?? false,
  elHeights: p.elHeights ?? {},
  elMore: false,
  elTipsDone: q.get('onboarding') === 'off' ? true : (p.elTipsDone ?? false),
});

ui.subscribe(() => {
  const s = ui.get();
  // preferences of modules the project lacks (surroundings, sun panel) are not saved: the device keeps the values from a project
  // that has the module (read just before writing — another tab may have changed them)
  const env = hasModule('environment'), sun = hasModule('sun'), kept: Partial<UiState> = env && sun ? {} : prefs();
  try { window.localStorage.setItem(LS, JSON.stringify({ batterySaver: s.batterySaver, mode: s.mode, snap: s.snap, onboardingDone: s.onboardingDone, environment: env ? s.environment : kept.environment, autosave: s.autosave, eyeHeight: s.eyeHeight, recentColors: s.recentColors, quality: s.quality, platform: s.platform, platformAuto: s.platformAuto, neutralInterior: s.neutralInterior, sunPanel: sun ? s.sunPanel : kept.sunPanel, elLayers: s.elLayers, elSnap: s.elSnap, elPlanFurniture: s.elPlanFurniture, elView: s.elView === 'walk' ? '3d' : s.elView, elLabels: s.elLabels, elMulti: s.elMulti, elHeights: s.elHeights, elTipsDone: s.elTipsDone })); } catch { /* private window */ }
});

export const useUi = <T,>(sel: (s: UiState) => T) => useStore(ui, sel);

/** walls selected in the panel (at least one) */
export const selectedWallIds = (s: Selection): string[] => (s?.kind === 'wall' ? (s.wallIds?.length ? s.wallIds : [s.wallId]) : []);

/**
 * Click on a room surface (wall / floor / ceiling):
 * — a click on an already selected surface — deselect;
 * — outside the Materials section, when another element (e.g. furniture) is selected — deselect only (the next click picks the surface);
 * — a wall with Ctrl / Shift — add to / remove from a multi-wall selection.
 */
export function clickSurface(roomId: string, target: { kind: 'wall'; wallId: string } | { kind: 'floor' } | { kind: 'ceiling' }, mods: { add: boolean }) {
  const s = ui.get(), cur = s.selection;
  if (target.kind === 'wall' && mods.add && cur?.kind === 'wall' && cur.roomId === roomId) {
    const ids = selectedWallIds(cur), has = ids.includes(target.wallId);
    const next = has ? ids.filter((x) => x !== target.wallId) : [...ids, target.wallId];
    ui.set({ selection: next.length ? { kind: 'wall', roomId, wallId: next[next.length - 1], wallIds: next } : null, wallScope: 'one' });
    return;
  }
  const same = cur && 'roomId' in cur && cur.roomId === roomId && cur.kind === target.kind && (target.kind !== 'wall' || selectedWallIds(cur).length === 1 && (cur as { wallId: string }).wallId === target.wallId);
  if (same) { ui.set({ selection: null }); return; }
  if (cur && s.section !== 'materials' && !(cur.kind === 'wall' || cur.kind === 'floor' || cur.kind === 'ceiling')) { ui.set({ selection: null }); return; }
  ui.set({ selection: target.kind === 'wall' ? { kind: 'wall', roomId, wallId: target.wallId } : { kind: target.kind, roomId }, ...(target.kind === 'wall' && s.wallScope === 'house' ? {} : target.kind === 'wall' ? { wallScope: 'one' as const } : {}) });
}

let toastN = 0;
export const toast = (text: string, level: 'info' | 'warn' | 'error' = 'info') => ui.set({ toast: { text, level, n: ++toastN } });
export const cameraTo = (preset: UiState['camera']['preset'], bookmarkId?: string) => ui.set((s) => ({ camera: { preset, n: s.camera.n + 1, bookmarkId } }));

/** entering a room (Room Mode) */
export function enterRoom(roomId: string, level: LevelId) {
  ui.set((s) => ({ roomId, level, selection: null, section: s.section === 'building' || s.section === 'variants' ? 'interiors' : s.section, camera: { preset: 'room', n: s.camera.n + 1 } }));
}
export function exitRoom() {
  ui.set((s) => ({ roomId: null, selection: null, houseView: 'interior', roomView: '3d', camera: { preset: 'interior', n: s.camera.n + 1 } }));
}

/** walk through the home and site: start at a viewpoint (by default — in front of the entrance) or at a given spot */
export function startWalk(go: Omit<WalkGo, 'n'> = {}) {
  ui.set((s) => ({ roomId: null, houseView: 'walk', selection: null, hoverRoom: null, walkGo: { ...go, n: s.walkGo.n + 1 } }));
}
/**
 * End of a home walk. A walk started in a room (walkGo.from) returns to the 3D view of the room the user stands in — and from
 * the stairs or the site to the room it left; touring from the Home section — to the building view. The room view goes back to
 * 3D: the next room entry does not start with a walk.
 */
export function exitWalk() {
  const from = ui.get().walkGo.from, room = from ? roomById(walkHud.get().roomId) ?? roomById(from.roomId) : null;
  if (room) {
    ui.set((s) => ({ roomId: room.id, level: room.level, houseView: 'interior', roomView: '3d', selection: null, hoverRoom: null, walkGo: { n: s.walkGo.n },
      section: s.section === 'building' || s.section === 'variants' ? 'interiors' : s.section, camera: { preset: 'room', n: s.camera.n + 1 } }));
    return;
  }
  ui.set((s) => ({ houseView: 'exterior', roomView: '3d', selection: null, camera: { preset: homeViewId(), n: s.camera.n + 1 } }));
}

/** whether the user is walking: a home and site walk or a room walk (one rule for keys, bars and the pointer) */
export const isWalking = (s: Pick<UiState, 'houseView' | 'roomId' | 'roomView'>): boolean => (s.houseView === 'walk' && !s.roomId) || (!!s.roomId && s.roomView === 'walk');
/** a home walk started in a room — the room editing context stays (WalkGo.from) */
export const isEditWalk = (s: Pick<UiState, 'houseView' | 'roomId' | 'walkGo'>): boolean => s.houseView === 'walk' && !s.roomId && !!s.walkGo.from;

/** active quality profile (a constant object from PROFILES — a stable reference for the selector) */
export const useQualityProfile = () => useUi((s) => withDebug(forDevice(profileWithSaver(s.platform, s.quality, s.batterySaver))));
export const qualityProfile = () => withDebug(forDevice(profileWithSaver(ui.get().platform, ui.get().quality, ui.get().batterySaver)));
