// UI action registry (ADR 0037 "one action, one place"): every button of the app's chrome is declared here once, with exactly one
// place. Components render an action only through <ActionButton id> (ui/Action.tsx) inside the <Slot> of its place, or — for a
// control that is not a plain button (a picker, a toggle, a group of chips) — through useActionSlot(id). Keyboard shortcuts and
// the phone's "back" call runAction(id). `npm run audit:ui` and src/home/tests/uiRegistry.test.ts check that each action is
// mounted exactly once, that its texts follow the language rules (ADR 0043) and that no UI file calls a handler directly.
import { t } from '../../i18n';
import { hasCapability, hasModule } from '../../project/active';
import type { ProjectCapability, ProjectModule } from '../../project/types';
import { canRedo, canUndo, redoLabel, undoLabel } from '../../history/history';
import {
  addBookmarkAuto, deleteFurniture, duplicateSelected, exitRoom, goSection, goView, newVersion, sceneViewOf, startFrom, compareWith,
  type SceneView, type StartFrom,
} from '../actions';
import { isWallMounted } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { MOUNT } from '../model/mountDrag';
import { levelName, roomById } from '../model/rooms';
import { mountedNow, nudgeMounted, nudgeMountedSide, rotateBy } from '../scene/interaction';
import { arrangementOf, design, docOf, isDirty, redo, save, undo } from '../store/design';
import { doors, setShowDoors } from '../store/doors';
import { downloadPicture, downloadPrint, downloadProject } from '../download';
import { cancelPreview } from '../store/design';
import { layout } from '../store/layout';
import { ui, type Section, type UiState } from '../store/ui';

/** where an action lives — one value per action */
export type Place =
  | 'topbar' | 'menu.download' | 'settings' | 'scenebar' | 'objectbar' | 'look' | 'arrange' | 'arrange.furniture'
  | 'arrange.colours' | 'versions' | 'card' | 'el.toolbar';

export interface ActionDef {
  /** dictionary key of the visible label (steps.json); the label is shown next to the icon */
  label: string;
  icon?: string;
  place: Place;
  testid: string;
  run: (arg?: number) => void;
  /** dynamic visible text (default: the label) */
  text?: () => string;
  /** tooltip */
  title?: () => string;
  enabled?: () => boolean;
  visible?: () => boolean;
  /** pressed / current state (a step, a view, a switch) */
  active?: () => boolean;
  /** shown only in advanced mode */
  advanced?: boolean;
  capability?: ProjectCapability;
  module?: ProjectModule;
  /** keyboard shortcuts, for the help and the audit (handled in HomeApp through runAction) */
  keys?: string[];
  /** icon without a visible label (undo / redo only — they carry an aria-label) */
  iconOnly?: boolean;
  /** buttons of one group (the scene views) carry their value */
  value?: string;
  /** a group the bar counts as one control (the four nudges of a wall object) */
  group?: string;
  /** a control rendered by its own component through useActionSlot (no plain button) */
  control?: boolean;
  tone?: 'primary' | 'danger';
}

const defineActions = <T extends Record<string, ActionDef>>(a: T) => a;

const s = () => ui.get();
const sel = () => { const x = s().selection; return x?.kind === 'furniture' ? x : null; };
const selItem = () => { const x = sel(); const f = x && arrangementOf(design.get(), x.roomId).furniture.find((q) => q.id === x.id); return f ? itemById(f.catalogId) : null; };
const hung = () => isWallMounted(selItem());
const inRoom = () => !!s().roomId;
/** a step; on a phone its panel opens in the sheet, and the active step again folds the sheet away / opens it */
const step = (id: Section): Pick<ActionDef, 'run' | 'active'> => ({
  run: () => {
    const u = s(), phone = layout.get().mobile;
    if (phone && u.section === id && !u.selection) { ui.set({ sheet: u.sheet === 'collapsed' ? 'medium' : 'collapsed' }); return; }
    goSection(id);
    if (phone) ui.set({ selection: null, sheet: 'medium' });
  },
  active: () => s().section === id,
});
const view = (v: SceneView): Pick<ActionDef, 'run' | 'active' | 'value'> => ({ run: () => goView(v), active: () => sceneViewOf(s()) === v, value: v });
const start = (what: StartFrom): Pick<ActionDef, 'run' | 'visible'> => ({ run: () => { const r = s().roomId; if (r) startFrom(r, what); }, visible: inRoom });
const proposals = () => { const r = roomById(s().roomId); return !!r && ['office', 'bed', 'room'].includes(r.kind) && r.area >= 7; };
const nudge = (du: number, dv: number) => () => { const x = sel(); if (!x) return; if (du) nudgeMountedSide(x.roomId, x.id, du as -1 | 1, MOUNT.nudgeFine); else nudgeMounted(x.roomId, x.id, 0, dv); };
/** the save status: saved, saving, waiting for autosave, kept on this device (waiting for the computer), or not saved (the file is
 *  unreadable, or autosave is off — a test switch) */
const saveState = () => {
  const d = design.get(), dirty = isDirty(d);
  return d.saving ? 'saving' : d.sync.problem || (dirty && !ui.get().autosave) ? 'failed' : dirty ? 'waiting' : d.sync.pending || (d.sync.offline && d.target === 'file') ? 'device' : 'saved';
};

export const ACTIONS = defineActions({
  // ---------------------------------------------------------------- top bar: steps
  'step-look': { label: 'steps.look', icon: 'eye', place: 'topbar', testid: 'step-look', ...step('look') },
  'step-arrange': { label: 'steps.arrange', icon: 'sofa', place: 'topbar', testid: 'step-arrange', capability: 'interiors', ...step('arrange') },
  'step-variants': { label: 'steps.variants', icon: 'layers', place: 'topbar', testid: 'step-variants', capability: 'variants', ...step('variants') },
  'step-electrical': { label: 'steps.electrical', icon: 'plug', place: 'topbar', testid: 'step-electrical', capability: 'electrical', advanced: true, ...step('electrical') },
  'step-expert': { label: 'steps.expert', icon: 'expert', place: 'topbar', testid: 'step-expert', advanced: true, ...step('expert') },
  // ---------------------------------------------------------------- top bar: tools
  undo: {
    label: 'steps.undo', icon: 'undo', place: 'topbar', testid: 'undo', iconOnly: true, keys: ['Mod+Z'], run: undo,
    enabled: () => canUndo(design.get().history), title: () => { const w = undoLabel(design.get().history); return w ? t('steps.undoWhat', { what: w }) : t('steps.undo'); },
  },
  redo: {
    label: 'steps.redo', icon: 'redo', place: 'topbar', testid: 'redo', iconOnly: true, keys: ['Mod+Shift+Z', 'Mod+Y'], run: redo,
    enabled: () => canRedo(design.get().history), title: () => { const w = redoLabel(design.get().history); return w ? t('steps.redoWhat', { what: w }) : t('steps.redo'); },
  },
  /** the save status (autosave only, ADR 0041): a button only when the design is not in the file yet (try again now) */
  save: {
    label: 'steps.saved', icon: 'check', place: 'topbar', testid: 'save', keys: ['Mod+S'], control: true, run: () => void save(),
    text: () => t(`steps.save.${saveState()}`), enabled: () => saveState() === 'failed' || saveState() === 'device',
  },
  download: { label: 'steps.download', icon: 'download', place: 'topbar', testid: 'download', run: () => ui.set((u) => ({ menu: u.menu === 'download' ? null : 'download' })), active: () => s().menu === 'download' },
  help: { label: 'steps.help', icon: 'help', place: 'topbar', testid: 'help', run: () => ui.set({ onboardingDone: false, menu: null }) },
  settings: { label: 'steps.settings', icon: 'gear', place: 'topbar', testid: 'settings', run: () => ui.set({ settingsOpen: true, menu: null }) },
  /** the house name ▾ (only when more than one project is installed) */
  project: { label: 'steps.project', place: 'topbar', testid: 'project-select', control: true, run: () => {} },
  // ---------------------------------------------------------------- the Download menu (ADR 0044)
  'download-picture': { label: 'steps.downloadPicture', icon: 'camera', place: 'menu.download', testid: 'download-picture', run: () => { ui.set({ menu: null }); void downloadPicture(); } },
  'download-print': { label: 'steps.downloadPrint', icon: 'cube', place: 'menu.download', testid: 'download-print', run: () => { ui.set({ menu: null }); void downloadPrint(); } },
  'download-project': { label: 'steps.downloadProject', icon: 'save', place: 'menu.download', testid: 'download-project', advanced: true, run: () => { ui.set({ menu: null }); downloadProject(); } },
  // ---------------------------------------------------------------- settings
  language: { label: 'steps.language', place: 'settings', testid: 'language', control: true, run: () => {} },
  picture: { label: 'steps.picture', place: 'settings', testid: 'picture', control: true, run: () => {} },
  surroundings: { label: 'steps.surroundings', place: 'settings', testid: 'env-toggle', module: 'environment', control: true, run: () => {} },
  'advanced-toggle': { label: 'steps.advancedMode', place: 'settings', testid: 'advanced-toggle', control: true, run: () => {} },
  device: { label: 'steps.device', place: 'settings', testid: 'platform', advanced: true, control: true, run: () => {} },
  'neutral-toggle': { label: 'steps.neutral', place: 'settings', testid: 'neutral-toggle', advanced: true, control: true, run: () => {} },
  snap: { label: 'steps.snap', place: 'settings', testid: 'snap-toggle', advanced: true, control: true, run: () => {} },
  'eye-height': { label: 'steps.eyeHeight', place: 'settings', testid: 'eye-height', advanced: true, control: true, run: () => {} },
  files: { label: 'steps.files', place: 'settings', testid: 'files', advanced: true, control: true, run: () => {} },
  'app-data': { label: 'steps.appData', place: 'settings', testid: 'app-data', advanced: true, control: true, run: () => {} },
  // ---------------------------------------------------------------- the scene bar: the only camera control (ADR 0039)
  'view-around': { label: 'steps.around', icon: 'cube', place: 'scenebar', testid: 'view-around', ...view('around') },
  'view-above': { label: 'steps.above', icon: 'top', place: 'scenebar', testid: 'view-above', ...view('above') },
  'view-walk': { label: 'steps.walk', icon: 'walk', place: 'scenebar', testid: 'view-walk', capability: 'walk', ...view('walk') },
  level: { label: 'steps.levels', place: 'scenebar', testid: 'level', control: true, run: () => {} },
  'doors-toggle': {
    label: 'steps.doors', icon: 'door', place: 'scenebar', testid: 'doors-toggle', run: () => setShowDoors(!doors.get().show),
    active: () => doors.get().show, visible: () => !!s().roomId || s().houseView !== 'exterior',
  },
  'scene-back': {
    label: 'steps.back', icon: 'back', place: 'scenebar', testid: 'scene-back', run: exitRoom, visible: inRoom,
    text: () => { const r = roomById(s().roomId); return r ? `${levelName(r.level)} · ${r.label}` : t('steps.back'); },
  },
  // ---------------------------------------------------------------- the object bar: actions on the selected furniture (ADR 0040)
  'obj-rotate-left': { label: 'steps.turnLeft', icon: 'rotl', place: 'objectbar', testid: 'obj-rotate-left', keys: ['Q', 'Shift+Q'], visible: () => !!sel() && !hung(), run: (deg = 90) => { const x = sel(); if (x) rotateBy(x.roomId, x.id, deg); } },
  'obj-rotate-right': { label: 'steps.turnRight', icon: 'rotr', place: 'objectbar', testid: 'obj-rotate-right', keys: ['E', 'Shift+E', 'R'], visible: () => !!sel() && !hung(), run: (deg = 90) => { const x = sel(); if (x) rotateBy(x.roomId, x.id, -deg); } },
  'obj-left': { label: 'steps.left', icon: 'back', place: 'objectbar', testid: 'obj-left', group: 'move', visible: () => !!sel() && hung() && !!mountedNow(sel()!.roomId, sel()!.id), run: nudge(-1, 0) },
  'obj-right': { label: 'steps.right', icon: 'next', place: 'objectbar', testid: 'obj-right', group: 'move', visible: () => !!sel() && hung() && !!mountedNow(sel()!.roomId, sel()!.id), run: nudge(1, 0) },
  'obj-up': { label: 'steps.up', icon: 'up', place: 'objectbar', testid: 'obj-up', group: 'move', visible: () => !!sel() && hung() && !!mountedNow(sel()!.roomId, sel()!.id), run: nudge(0, MOUNT.nudgeFine) },
  'obj-down': { label: 'steps.down', icon: 'down', place: 'objectbar', testid: 'obj-down', group: 'move', visible: () => !!sel() && hung() && !!mountedNow(sel()!.roomId, sel()!.id), run: nudge(0, -MOUNT.nudgeFine) },
  'obj-copy': { label: 'steps.copy', icon: 'copy', place: 'objectbar', testid: 'obj-copy', keys: ['Mod+D'], visible: () => !!sel(), run: () => { const x = sel(); if (x) duplicateSelected(x.roomId, x.id); } },
  'obj-delete': { label: 'steps.delete', icon: 'trash', place: 'objectbar', testid: 'obj-delete', keys: ['Delete', 'Backspace'], tone: 'danger', visible: () => !!sel(), run: () => { const x = sel(); if (x) deleteFurniture(x.roomId, x.id); } },
  'obj-done': { label: 'steps.done', icon: 'check', place: 'objectbar', testid: 'obj-done', tone: 'primary', visible: () => !!sel(), run: () => ui.set({ selection: null }) },
  // ---------------------------------------------------------------- the card (properties of the selection)
  'card-close': { label: 'steps.close', icon: 'close', place: 'card', testid: 'inspector-close', run: () => { cancelPreview(); ui.set({ selection: null }); } },
  // ---------------------------------------------------------------- Look
  'place-save': { label: 'steps.saveView', icon: 'plus', place: 'look', testid: 'place-save', run: addBookmarkAuto },
  // ---------------------------------------------------------------- Arrange
  'arrange-tab': { label: 'steps.arrangeTabs', place: 'arrange', testid: 'arrange-tab', control: true, visible: inRoom, run: () => {} },
  'start-plan': { label: 'steps.startPlan', icon: 'interior', place: 'arrange.furniture', testid: 'start-plan', ...start('plan') },
  'start-office': { label: 'steps.startOffice', icon: 'desk', place: 'arrange.furniture', testid: 'start-office', ...start('office'), visible: proposals },
  'start-guest': { label: 'steps.startGuest', icon: 'bed', place: 'arrange.furniture', testid: 'start-guest', ...start('guest'), visible: proposals },
  'start-empty': { label: 'steps.startEmpty', icon: 'close', place: 'arrange.furniture', testid: 'start-empty', ...start('empty') },
  'add-own': { label: 'steps.addOwn', icon: 'upload', place: 'arrange.furniture', testid: 'import-open', run: () => ui.set({ importOpen: true }) },
  surface: { label: 'steps.surface', place: 'arrange.colours', testid: 'surface', control: true, run: () => {} },
  // ---------------------------------------------------------------- Versions
  'variant-new': { label: 'steps.newVersion', icon: 'plus', place: 'versions', testid: 'variant-new', run: newVersion },
  'versions-compare': {
    label: 'steps.compare', icon: 'layers', place: 'versions', testid: 'versions-compare', tone: 'primary',
    visible: () => docOf(design.get()).variants.length > 1,
    run: () => { const d = docOf(design.get()); if (d.variants.length === 2) compareWith(d.variants.find((v) => v.id !== d.activeVariantId)!.id); else ui.set((u) => ({ comparePick: !u.comparePick })); },
    active: () => s().comparePick || !!s().compare,
  },
});

export type ActionId = keyof typeof ACTIONS;
export const actionIds = Object.keys(ACTIONS) as ActionId[];
export const action = (id: ActionId): ActionDef => ACTIONS[id];

/** whether an action belongs on screen now: its mode, the project's capability / module, its own condition */
export function actionShown(id: ActionId, st: Pick<UiState, 'mode'> = ui.get()): boolean {
  const a: ActionDef = ACTIONS[id];
  if (a.advanced && st.mode !== 'advanced') return false;
  if (a.capability && !hasCapability(a.capability)) return false;
  if (a.module && !hasModule(a.module)) return false;
  return a.visible ? a.visible() : true;
}

/** runs an action (shortcuts, back navigation, buttons): only when it is shown and enabled; returns whether it ran */
export function runAction(id: ActionId, arg?: number): boolean {
  const a: ActionDef = ACTIONS[id];
  if (!actionShown(id) || (a.enabled && !a.enabled())) return false;
  a.run(arg);
  return true;
}

/** the visible text of an action */
export const actionText = (id: ActionId): string => { const a: ActionDef = ACTIONS[id]; return a.text ? a.text() : t(a.label); };
