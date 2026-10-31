// Selectors of the app's controls for the browser tests and the usability sessions — the one place that knows which test id a
// control has. A test asks for a control by what it does (`S.undo`, `S.step('arrange')`, `S.level('L1')`); when the UI moves a
// control, this file changes and the tests do not. Every value is a CSS selector (a comma list when the control may appear in
// more than one form, e.g. a desktop and a phone variant).

/** selector of a test id */
export const T = (id) => `[data-testid="${id}"]`;
/** selector of one of several test ids */
const any = (...ids) => ids.map(T).join(', ');

export const S = {
  // ---------------------------------------------------------------- top bar
  /** a step of the app: look | arrange | variants | electrical | expert */
  step: (id) => any(`step-${id}`),
  steps: T('steps'),
  undo: T('undo'),
  redo: T('redo'),
  /** the save status (autosave; clickable only when saving failed) — keeps its data-sync attribute */
  save: T('save'),
  settings: T('settings'),
  settingsModal: T('settings-modal'),
  settingsDone: T('settings-done'),
  help: T('help'),
  download: T('download'),
  downloadPicture: T('download-picture'),
  downloadPrint: T('download-print'),
  downloadProject: T('download-project'),
  /** a language button in Settings */
  language: (l) => `${T('language')} [data-value="${l}"]`,
  project: T('project-select'),
  advanced: T('advanced-toggle'),
  welcome: T('onboarding'),
  welcomeStart: T('onboarding-start'),

  // ---------------------------------------------------------------- scene bar (the only camera control)
  sceneBar: T('scene-bar'),
  /** Around | From above | Walk: the group and one of its buttons */
  viewGroup: T('view'),
  view: (v) => `${T('view')} [data-value="${v}"]`,
  levelGroup: T('level'),
  level: (id) => `${T('level')} [data-value="${id}"]`,
  doors: T('doors-toggle'),
  /** "← Ground floor · Kitchen" in a room, "← Back" in a walk */
  back: T('scene-back'),

  // ---------------------------------------------------------------- look
  place: (id) => T(`place-${id}`),
  places: T('places'),
  placeSave: T('place-save'),
  placeName: T('place-name'),

  // ---------------------------------------------------------------- arrange
  roomPick: (id) => T(`room-${id}`),
  roomPicker: T('room-picker'),
  arrangeTab: (tab) => `${T('arrange-tab')} [data-value="${tab}"]`,
  catalogCard: (id) => T(`cat-add-${id}`),
  catalogSearch: T('cat-search'),
  startFrom: (id) => T(`start-${id}`),
  surface: (s) => `${T('surface')} [data-value="${s}"]`,
  swatchOriginal: T('swatch-original'),
  palette: T('palette'),

  // ---------------------------------------------------------------- versions
  versions: T('version-list'),
  version: (name) => T(`variant-${name}`),
  versionNew: T('variant-new'),
  versionMore: (name) => T(`variant-more-${name}`),
  versionRename: T('variant-rename'),
  versionName: T('variant-name'),
  versionDelete: T('variant-delete'),
  versionReset: T('variant-reset'),
  compare: T('versions-compare'),
  compareExit: T('compare-exit'),

  // ---------------------------------------------------------------- selection: object bar and card
  objectBar: T('object-bar'),
  obj: (a) => T(`obj-${a}`),
  card: T('inspector'),
  cardClose: T('inspector-close'),
};
