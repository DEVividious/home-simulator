// App shell: top bar (section navigation, undo / redo, save, settings), bottom bar over the scene (camera presets,
// levels, room view), contextual hint, toasts, welcome screen, settings (Home / Expert mode),
// preview of the card dragged from the catalogue.
import { hasModule, project, projectId } from '../../project/active';
import { projectEntry, projectIds, switchProject } from '../../project/registry';
import { AppDataSettings } from '../../pwa/PwaUi';
import { fmtM, LANGUAGES, lang, switchLang, t } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { goPreset, goSection, setLevel, setRoomView } from '../actions';
import { allLevels, levelName, roomById } from '../model/rooms';
import type { LevelId } from '../model/types';
import { viewPresets } from '../model/views';
import { canRedo as hCanRedo, canUndo as hCanUndo, redoLabel, undoLabel } from '../../history/history';
import { arrangementOf, isDirty, redo, save, undo, useDesign, useVariant } from '../store/design';
import { useDrag } from '../store/drag';
import { exitRoom, exitWalk, isEditWalk, sections, ui, useUi, type Section , useQualityProfile } from '../store/ui';
import { describeGpu, detectPlatform } from '../quality/profile';
import { sceneApi } from '../scene/sceneApi';
import { takeScreenshot } from '../screenshot';
import { useClearOfSceneButtons } from './clearOfSceneButtons';
import { modalKeys } from './modalKeys';
import { Seg, Toggle } from './controls';
import { useLayout } from '../store/layout';
import { DoorsButton } from './DoorsToggle';
import { Icon } from './icons';
import { VIEW_OPTIONS, VIEW_OPTIONS_TOUCH } from './SectionInteriors';

const SECTION_ICON: Record<Section, string> = { building: 'house', interiors: 'interior', materials: 'brush', furniture: 'sofa', electrical: 'plug', variants: 'layers', expert: 'expert' };

export function TopBar() {
  const section = useUi((s) => s.section);
  const mode = useUi((s) => s.mode);
  const canUndo = useDesign((s) => hCanUndo(s.history)), canRedo = useDesign((s) => hCanRedo(s.history));
  const h = { undo: useDesign((s) => undoLabel(s.history)), redo: useDesign((s) => redoLabel(s.history)) };
  const dirty = useDesign(isDirty), saving = useDesign((s) => s.saving), target = useDesign((s) => s.target);
  // saved on the device only (offline / changes wait for the connection to the computer)
  const onDevice = useDesign((s) => s.sync.pending || (s.sync.offline && s.target === 'file'));
  const variant = useVariant();
  return (
    <header className="hm-top">
      <div className="hm-brand"><Icon name="house" size={22} /><span><b>{t(`shell.brand.${project().manifest.buildingType}`)}</b><small title={t('shell.activeVariant')}>{variant.name}</small></span></div>
      <nav className="hm-nav" data-testid="nav">
        {sections().map((s) => (
          <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => goSection(s.id)} data-testid={`nav-${s.id}`}>
            <Icon name={SECTION_ICON[s.id]} size={18} /><span>{s.label}</span>
          </button>
        ))}
        {mode === 'expert' && <button className={`expert${section === 'expert' ? ' on' : ''}`} onClick={() => ui.set({ section: 'expert' })} data-testid="nav-expert"><Icon name="expert" size={18} /><span>{t('shell.expert')}</span></button>}
      </nav>
      <div className="hm-top-right">
        <button className="hm-icon-btn" onClick={undo} disabled={!canUndo} title={h.undo ? t('shell.undoWhat', { what: h.undo }) : t('shell.undo')} data-testid="undo"><Icon name="undo" /></button>
        <button className="hm-icon-btn" onClick={redo} disabled={!canRedo} title={h.redo ? t('shell.redoWhat', { what: h.redo }) : t('shell.redo')} data-testid="redo"><Icon name="redo" /></button>
        <button className={`hm-save${dirty ? ' dirty' : ''}${!dirty && onDevice ? ' device' : ''}`} onClick={() => void save()} title={t('shell.saveTitle', { where: onDevice ? t('shell.saveWhereDevicePending') : target === 'file' ? t('shell.saveWhereFile') : t('shell.saveWhereDevice') })} data-testid="save" data-sync={onDevice ? 'device' : target === 'file' ? 'file' : 'local'}>
          <Icon name={dirty ? 'save' : 'check'} size={16} />{saving ? t('shell.saving') : dirty ? t('shell.save') : onDevice ? t('shell.onDevice') : t('shell.saved')}
        </button>
        <button className="hm-icon-btn" onClick={() => void takeScreenshot()} title={t('shell.screenshot')} data-testid="screenshot"><Icon name="camera" /></button>
        <button className="hm-icon-btn" onClick={() => ui.set({ settingsOpen: true })} title={t('shell.settings')} data-testid="settings"><Icon name="gear" /></button>
      </div>
    </header>
  );
}

export function BottomBar() {
  const roomId = useUi((s) => s.roomId), view = useUi((s) => s.roomView), houseView = useUi((s) => s.houseView), level = useUi((s) => s.level);
  const mobile = useLayout((s) => s.mobile);
  const room = roomById(roomId);
  const editWalk = useUi(isEditWalk);                                           // walk started in a room: exiting returns to the room
  if (houseView === 'walk' && !room) {
    return (
      <div className="hm-bottom" data-testid="bottom-walk">
        <button className="hm-pill" onClick={exitWalk} data-testid="bottom-walk-exit"><Icon name="back" size={16} /> {editWalk ? t('shell.roomView') : t(`shell.buildingView.${project().manifest.buildingType}`)}</button>
        <span className="hm-bottom-title">{t('shell.walk')}</span>
        {!mobile && <DoorsButton />}
      </div>
    );
  }
  if (room) {
    return (
      <div className="hm-bottom" data-testid="bottom-room">
        <button className="hm-pill" onClick={exitRoom} data-testid="bottom-exit"><Icon name="back" size={16} /> {levelName(room.level)}</button>
        <span className="hm-bottom-title">{room.label}</span>
        <Seg value={view} options={mobile ? VIEW_OPTIONS_TOUCH() : VIEW_OPTIONS()} onChange={setRoomView} testid="bottom-view" />
        {!mobile && <DoorsButton />}
      </div>
    );
  }
  const compact = houseView === 'interior';
  return (
    <div className="hm-bottom" data-testid="bottom-house">
      <div className={`hm-bottom-presets${compact ? ' compact' : ''}`}>
        {viewPresets().map((p) => (
          <button key={p.id} className={`hm-pill${p.id === 'interior' && houseView === 'interior' ? ' on' : ''}`} onClick={() => goPreset(p.id)} title={`${p.label} — ${p.hint}`} data-testid={`cam-${p.id}`}>
            <Icon name={p.icon} size={16} /><span>{p.label}</span>
          </button>
        ))}
      </div>
      {houseView === 'interior' && allLevels().length > 1 && <Seg value={level} options={allLevels().map((l) => [l.id, l.name] as [LevelId, string])} onChange={setLevel} testid="bottom-level" />}
      {!mobile && <DoorsButton />}
    </div>
  );
}

/** contextual hint above the scene */
export function Hint() {
  const section = useUi((s) => s.section), roomId = useUi((s) => s.roomId), view = useUi((s) => s.roomView), houseView = useUi((s) => s.houseView);
  const sel = useUi((s) => s.selection?.kind ?? null);
  // empty room = the EFFECTIVE arrangement has no furniture (project furniture applies before anything is written to the
  // document — otherwise a room furnished from the project would count as empty)
  const empty = useDesign((s) => !!roomId && arrangementOf(s, roomId).furniture.length === 0);
  const [hidden, setHidden] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const touch = useLayout((s) => s.coarse), portrait = useLayout((s) => !s.landscape);
  let text: string | null = null;
  // walk: the selected furniture item is what moves — a hint on what to do with the selection
  const walkSel = sel === 'furniture' ? (touch ? t('shell.hint.walkSelTouch') : t('shell.hint.walkSel')) : null;
  if (touch) {
    // short help for touch (no "left button", "wheel" or keys)
    if (roomId) {
      if (view === 'walk') text = walkSel ?? t('shell.hint.touchWalk');
      else if (section === 'materials') text = t('shell.hint.touchMaterials');
      else if (empty && section === 'furniture') text = t('shell.hint.touchEmptyFurniture');
      else if (sel === 'furniture') text = t('shell.hint.touchSelFurniture');
      else if (view === 'top') text = t('shell.hint.touchTop');
      else text = t('shell.hint.touchRoom');
    } else if (houseView === 'walk') text = walkSel ?? (portrait ? t('shell.hint.touchWalkPortrait') : t('shell.hint.touchWalk'));
    else if (houseView === 'interior') text = t('shell.hint.touchInterior');
    else text = t('shell.hint.touchOverview');
  } else if (roomId) {
    if (view === 'walk') text = walkSel ?? t('shell.hint.walk');
    else if (section === 'materials') text = t('shell.hint.materials');
    else if (empty && section === 'furniture') text = t('shell.hint.emptyFurniture');
    else if (empty) text = t('shell.hint.emptyRoom');
    else if (sel === 'furniture') text = t('shell.hint.selFurniture');
    else if (view === 'top') text = t('shell.hint.top');
  } else if (houseView === 'walk') text = null; // the walk bar (also the hint for the selected furniture)
  else if (houseView === 'interior') text = t('shell.hint.interior');
  else text = t('shell.hint.overview');
  const shown = text && !hidden.includes(text) ? text : null;
  useClearOfSceneButtons(ref, shown);
  if (!shown) return null;
  return (
    <div ref={ref} className="hm-hintchip" data-testid="hint">
      <Icon name="info" size={16} /><span>{text}</span>
      <button onClick={() => setHidden((h) => [...h, text!])} aria-label={t('shell.hideHint')}><Icon name="close" size={14} /></button>
    </div>
  );
}

/** persistent mouse-controls legend (bottom-left corner of the scene) — depends on the view */
export function MouseLegend() {
  const roomId = useUi((s) => s.roomId), view = useUi((s) => s.roomView);
  const free = useUi((s) => s.houseView === 'walk' && !s.roomId); // walk — its own hints
  const [open, setOpen] = useState(true);
  const touch = useLayout((s) => s.coarse);
  if (free || touch) return null;                             // touch: short help in the contextual hint (Hint), no mouse legend
  const rows: [string, string][] = roomId && view === 'walk'
    ? [[t('shell.legend.drag'), t('shell.legend.lookAround')], [t('shell.legend.wasd'), t('shell.legend.walk')], ['Shift', t('shell.legend.faster')], [t('shell.legend.wheel'), t('shell.legend.step')], [t('shell.legend.clickFurniture'), t('shell.legend.select')], [t('shell.legend.dragSelected'), t('shell.legend.moveFurniture')]]
    : roomId && view === 'top'
      ? [[t('shell.legend.dragEmpty'), t('shell.legend.pan')], [t('shell.legend.wheel'), t('shell.legend.zoom')], [t('shell.legend.dragFurniture'), t('shell.legend.moveFurniture')], [t('shell.legend.doubleClick'), t('shell.legend.center')]]
      : [[t('shell.legend.leftButton'), t('shell.legend.orbit')], [t('shell.legend.rightOrShift'), t('shell.legend.pan')], [t('shell.legend.wheel'), t('shell.legend.zoom')], [t('shell.legend.doubleClick'), t('shell.legend.orbitCenter')],
        ...(roomId ? [[t('shell.legend.dragFurniture'), t('shell.legend.moveFurniture')] as [string, string]] : [])];
  if (!open) return <button className="hm-legend-btn" onClick={() => setOpen(true)} title={t('shell.legend.mouseControls')} data-testid="legend-open"><Icon name="info" size={16} /></button>;
  return (
    <div className="hm-legend" data-testid="mouse-legend">
      <header><b>{t('shell.legend.title')}</b><button onClick={() => setOpen(false)} aria-label={t('shell.hide')}><Icon name="close" size={12} /></button></header>
      {rows.map(([k, v]) => <div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}
    </div>
  );
}

export function Toasts() {
  const toast = useUi((s) => s.toast);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast.n);
    const h = window.setTimeout(() => setShown((n) => (n === toast.n ? null : n)), toast.level === 'error' ? 6000 : 3200);
    return () => window.clearTimeout(h);
  }, [toast]);
  if (!toast || shown !== toast.n) return null;
  return <div className={`hm-toast ${toast.level}`} role="status" data-testid="toast">{toast.text}</div>;
}

export function Onboarding() {
  const done = useUi((s) => s.onboardingDone);
  const touch = useLayout((s) => s.coarse);
  if (done) return null;
  const close = () => ui.set({ onboardingDone: true }), bt = project().manifest.buildingType;
  return (
    <div className="hm-modal-bg" data-testid="onboarding">
      <div className="hm-modal hm-welcome">
        <h2>{t(`shell.welcome.title.${bt}`)}</h2>
        <p>{t(`shell.welcome.intro.${bt}`)}</p>
        <ol>
          <li><Icon name="house" /><span><b>{t(`shell.welcome.look.${bt}`)}</b>{touch ? t('shell.welcome.lookTouch') : t('shell.welcome.lookMouse')}</span></li>
          <li><Icon name="interior" /><span><b>{t('shell.welcome.enter')}</b>{touch ? t('shell.welcome.enterTouch') : t('shell.welcome.enterMouse')}</span></li>
          <li><Icon name="sofa" /><span><b>{t('shell.welcome.furnish')}</b>{touch ? t('shell.welcome.furnishTouch') : t('shell.welcome.furnishMouse')}</span></li>
        </ol>
        <button className="hm-btn primary wide" onClick={close} data-testid="onboarding-start">{t('shell.welcome.start')}</button>
      </div>
    </div>
  );
}

/** the graphics card the browser renders the scene on (on a laptop with two GPUs — often the integrated one) */
function GpuInfo() {
  const r = sceneApi.renderer;
  if (!r) return null;
  const g = describeGpu(r.gpu);
  return <small className="hm-muted" data-testid="gpu-info" title={r.gpu}>{t('settings.gpu')} <b>{g.name}</b> · {r.backend}
    {g.software && <> · <b>{t('settings.gpuSoftware')}</b></>}</small>;
}

export function Settings() {
  const open = useUi((s) => s.settingsOpen);
  const mode = useUi((s) => s.mode), env = useUi((s) => s.environment), snap = useUi((s) => s.snap), autosave = useUi((s) => s.autosave), eye = useUi((s) => s.eyeHeight);
  const quality = useUi((s) => s.quality), neutralInterior = useUi((s) => s.neutralInterior);
  const platformAuto = useUi((s) => s.platformAuto), profile = useQualityProfile(), saver = useUi((s) => s.batterySaver);
  if (!open) return null;
  const close = () => ui.set({ settingsOpen: false });
  return (
    <div className="hm-modal-bg" onPointerDown={(e) => e.target === e.currentTarget && close()} data-testid="settings-modal">
      <div className="hm-modal" onKeyDown={modalKeys(close)}>
        <header><h2>{t('settings.title')}</h2><button className="hm-icon-btn" onClick={close} aria-label={t('settings.close')}><Icon name="close" /></button></header>
        <Toggle on={mode === 'expert'} label={t('settings.expertMode')} hint={t('settings.expertModeHint')} onChange={(v) => ui.set({ mode: v ? 'expert' : 'home', section: !v && ui.get().section === 'expert' ? 'building' : ui.get().section })} testid="expert-toggle" />
        {hasModule('environment') && <Toggle on={env} label={t('settings.environment')} hint={t('settings.environmentHint')} onChange={(v) => ui.set({ environment: v })} />}
        <Toggle on={snap.enabled} label={t('settings.snap')} hint={t('settings.snapHint')} onChange={(v) => ui.set({ snap: { ...snap, enabled: v } })} testid="snap-toggle" />
        <div className="hm-field"><span>{t('settings.snapGrid')}</span><Seg value={snap.grid} options={[[0, t('settings.snapGridNone')], [0.05, '5 cm'], [0.1, '10 cm'], [0.25, '25 cm']]} onChange={(v) => ui.set({ snap: { ...snap, grid: v } })} testid="grid" /></div>
        <div className="hm-field"><span>{t('settings.quality')}</span><Seg value={quality} options={[['high', t('settings.qualityHigh')], ['medium', t('settings.qualityMedium')], ['low', t('settings.qualityLow')]]} onChange={(v) => ui.set({ quality: v })} testid="quality" />
          <small className="hm-muted">{t('settings.qualityHint')}</small></div>
        <div className="hm-field"><span>{t('settings.device')}</span><Seg value={platformAuto ? 'auto' : profile.platform} options={[['auto', t('settings.deviceAuto')], ['desktop', t('settings.deviceDesktop')], ['mobile', t('settings.deviceMobile')]]}
          onChange={(v) => ui.set(v === 'auto' ? { platformAuto: true, platform: detectPlatform() } : { platformAuto: false, platform: v })} testid="platform" />
          <small className="hm-muted" data-testid="quality-profile" data-profile={profile.id}>{t('settings.profile', { name: profile.label, dpr: profile.dpr[1] })}{profile.antialias ? '' : ` · ${t('settings.antialiasAfterReload')}`}</small>
          <GpuInfo /></div>
        {profile.platform === 'mobile' && <Toggle on={saver} label={t('settings.batterySaver')} hint={t('settings.batterySaverHint')} onChange={(v) => ui.set({ batterySaver: v })} testid="battery-saver" />}
        <Toggle on={neutralInterior} label={t('settings.neutralInterior')} hint={t('settings.neutralInteriorHint')} onChange={(v) => ui.set({ neutralInterior: v })} testid="neutral-toggle" />
        <Toggle on={autosave} label={t('settings.autosave')} hint={t('settings.autosaveHint')} onChange={(v) => ui.set({ autosave: v })} />
        <div className="hm-field"><span>{t('settings.eyeHeight')}</span><Seg value={eye} options={[1.5, 1.6, 1.68, 1.8].map((x) => [x, fmtM(x)] as [number, string])} onChange={(v) => ui.set({ eyeHeight: v })} /></div>
        <button className="hm-link" onClick={() => { ui.set({ onboardingDone: false, settingsOpen: false }); }}>{t('settings.showWelcome')}</button>
        <AppDataSettings />
        <LanguageSwitch />
        <ProjectSwitch />
        <footer>
          <button className="hm-btn primary" onClick={close} data-testid="settings-done">{t('settings.done')}</button>
        </footer>
      </div>
    </div>
  );
}

/** UI language: stored on the device, the page reloads (labels derived per project may be cached) */
function LanguageSwitch() {
  return (
    <label className="hm-field" data-testid="language-switch">
      <span>{t('settings.language')}</span>
      <select value={lang()} data-testid="language-select" onChange={(e) => { const l = e.target.value; void save().finally(() => switchLang(l)); }}>
        {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
}

/** project (building) choice: every project has its own saved state — switching saves the current one and reloads the page.
 *  Shown when more than one project is installed (projects/ directory; ?project=<id> opens one directly) */
function ProjectSwitch() {
  const ids = projectIds(), cur = projectId();
  if (ids.length < 2) return null;
  return (
    <label className="hm-field" data-testid="project-switch">
      <span>{t('settings.project')}</span>
      <select value={cur} data-testid="project-select" onChange={(e) => { const id = e.target.value; void save().finally(() => switchProject(id)); }}>
        {ids.map((id) => <option key={id} value={id}>{projectEntry(id)?.name ?? id}</option>)}
      </select>
      <small className="hm-muted">{t('settings.projectHint')}</small>
    </label>
  );
}

/** card dragged from the catalogue (follows the cursor) */
export function CatalogGhost() {
  const c = useDrag((s) => s.catalog);
  const placed = useDrag((s) => !!s.ghost);
  if (!c || !c.started) return null;
  return (
    <div className={`hm-dragchip${placed ? ' placed' : ''}`} style={{ transform: `translate(${c.x + 14}px, ${c.y + 14}px)` }} data-testid="drag-chip">
      <img src={c.thumb} alt="" /><span>{c.name}</span>{!placed && <small>{t('shell.dropInRoom')}</small>}
    </div>
  );
}
