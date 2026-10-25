// Home Configurator — the app for a non-technical user: the 3D scene takes most of the screen, section navigation (Building,
// Interiors, Materials, Furniture, Electrical, Variants), the section panel on the left, the context panel of the selection on
// the right. Single sources of truth: PROJECT DATA (project package — rooms, doors, optional model files), USER DESIGN STATE
// (ConfiguratorDoc, design store), RUNTIME SCENE (derived). Home mode by default; Expert mode — in the settings.
// Architecture: docs/ARCHITECTURE.md
import { t } from '../i18n';
import { hasModule, project } from '../project/active';
import { allLevels, allRooms } from './model/rooms';
import { mountedNow } from './scene/interaction';
import { MountTip } from './ui/MountTip';
import { addElectrical, electricalScope, patchElectrical, planNow, removeElectrical, setElView } from './actions';
import { beginCopy, beginMove, beginNew, cancelPlace, commitPlace, placeAt, placeNow } from './store/elPlace';
import { surfaceFromPlan } from './model/elPlacement';
import { planRows } from './model/electrical';
import { exportElectricalPdf, type ExportPdfOptions } from './pdf/exportElectrical';
import { ElWorkspace, SectionElectrical } from './ui/ElectricalPanels';
import { planPerf } from './ui/ElectricalPlan';
import { furnitureOpen, isFurnitureOpen, toggleFurnitureOpen } from './store/furnitureOpen';
import { useEffect, useMemo } from 'react';
import { deleteFurniture, duplicateSelected, goPreset } from './actions';
import { resolveDims } from './catalog/furniture';
import { itemById } from './catalog/providers';
import { furnitureById } from './model/interiors';
import { nudge, rotateBy } from './scene/interaction';
import { HomeCanvas } from './scene/HomeCanvas';
import { sceneDataOf } from './scene/sceneData';
import { sceneApi } from './scene/sceneApi';
import { arrangementOf, design, docOf, interiorOfRoom, isDirty, loadDesign, redo, refreshFromFile, save, setNotifier, undo, useDesign, variantOf } from './store/design';
import { startAutosave } from './store/autosave';
import { drag } from './store/drag';
import { exitRoom, exitWalk, isWalking, toast, ui, useUi } from './store/ui';
import { ExpertPanel } from './ui/ExpertPanel';
import { Inspector } from './ui/Inspector';
import { SectionFurniture } from './ui/SectionFurniture';
import { SectionHouse } from './ui/SectionHouse';
import { SectionInteriors } from './ui/SectionInteriors';
import { SectionMaterials } from './ui/SectionMaterials';
import { SectionVariants } from './ui/SectionVariants';
import { SunPanel } from './ui/SunPanel';
import { BottomBar, CatalogGhost, Hint, MouseLegend, Onboarding, Settings, Toasts, TopBar } from './ui/Shell';
import { FurnitureQuickBar, MobileNav, MobileSheet, useBackGuard, WalkPad } from './ui/Mobile';
import { useLayout } from './store/layout';
import { DoorsButton } from './ui/DoorsToggle';
import { openDoor, setAllDoorsOpen, setShowDoors } from './store/doors';
import { ProjectConflict, PwaUpdateBanner } from '../pwa/PwaUi';
import { homeViewId } from './model/views';
import { buildingWords } from './model/wording';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { checkUpdate, pwa, setBeforeReload } from '../pwa/register';
import { listAssets, syncAssets } from '../storage/assets';
import { listBackups } from '../storage/project';
import { __syncDebug, flushLocal } from '../document/store';
import { syncNow } from './store/design';
import './home.css';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes((el as HTMLInputElement).type) || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** fields in which arrow keys have their own meaning (slider, radio group) */
const ownsArrows = (t: EventTarget | null) => { const el = t as HTMLInputElement | null; return !!el && el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'radio'); };

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); void save(); return; }
      if (typing(e.target)) return;
      // Undo / Redo are ignored while dragging: undoing the addition of the item being dragged would remove it from under the
      // pointer and leave a selection of a non-existent item (Esc and Delete have the same guard)
      const dragging = sceneApi.locked || !!drag.get().catalog;
      if (mod && k === 'z') { e.preventDefault(); if (dragging) return; if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); if (!dragging) redo(); return; }
      const s = ui.get(), sel = s.selection;
      if (e.key === 'Escape') {
        if (dragging) return;
        // the sun panel is a pinned tool (it stays open while working in the scene), so it closes last — unless the user is
        // working in it right now (focus in the panel). The VISIBLE panel is checked: the "expanded" state is a remembered
        // preference that must not change in modes without the panel (Electrical, Expert, screenshot).
        const sun = document.querySelector('.hm-sun-panel');
        if (s.settingsOpen) ui.set({ settingsOpen: false });
        else if (!s.onboardingDone) ui.set({ onboardingDone: true });
        else if (sun?.contains(document.activeElement)) ui.set({ sunPanel: false });
        else if (s.compare) ui.set({ compare: null });
        // the selection closes first — also in a home walk (Esc does not end the walk while something is selected)
        else if (sel) ui.set({ selection: null });
        // ELECTRICAL mode: Esc in the eye-level view returns to the mode's 3D view (like the system "back" on a phone) — the
        // generic walk exit would show the home from outside while the mode switch still says "eye level"
        else if (s.section === 'electrical' && s.elView === 'walk') setElView('3d');
        else if (s.houseView === 'walk' && !s.roomId) exitWalk();
        else if (s.roomId) exitRoom();
        else if (sun) ui.set({ sunPanel: false });
        return;
      }
      // room views 1 / 2 / 3 — not in ELECTRICAL mode: there the view is chosen by the Plan | 3D | eye level switch, and the key
      // would change the scene (room walk, top view) under a switch showing something else
      if (s.roomId && s.section !== 'electrical' && !mod && !e.altKey) {
        if (k === '1') { ui.set({ roomView: '3d' }); return; }
        if (k === '2') { ui.set({ roomView: 'top' }); return; }
        if (k === '3') { ui.set({ roomView: 'walk' }); return; }
      }
      // ELECTRICAL mode: Delete removes the selected device, Ctrl + D — a copy to drag
      if (sel?.kind === 'electrical' && s.section === 'electrical' && !sceneApi.locked) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeElectrical(sel.id); return; }
        if (mod && k === 'd') { e.preventDefault(); beginCopy(sel.id); return; }
      }
      if (sel?.kind !== 'furniture' || sceneApi.locked) return;
      const walk = isWalking(s);                                                // walk: arrows walk, they do not move the item
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteFurniture(sel.roomId, sel.id); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(sel.roomId, sel.id); return; }
      if (mod) return;
      if (k === 'q') { rotateBy(sel.roomId, sel.id, e.shiftKey ? 45 : 15); return; }
      if (k === 'e') { rotateBy(sel.roomId, sel.id, e.shiftKey ? -45 : -15); return; }
      if (k === 'r') { rotateBy(sel.roomId, sel.id, -90); return; }
      if (!walk && e.key.startsWith('Arrow')) {
        // arrows on a slider (or in a radio group) belong to it — they must not move the selected item
        if (ownsArrows(e.target)) return;
        e.preventDefault();
        const st = e.shiftKey ? 0.1 : 0.01;
        const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key] as [number, number];
        nudge(sel.roomId, sel.id, d[0], d[1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** autosave to the project file shortly after a change (the browser copy — always, on every change) */
function useAutosave() {
  const autosave = useUi((s) => s.autosave);
  useEffect(() => (autosave ? startAutosave() : undefined), [autosave]);
}

/**
 * Offline work: when the connection returns, files and changes saved on the device are sent to the PC (an attempt on the
 * "online" event, on returning to the app and every 30 s while something is waiting); the project is saved before an app update.
 */
function useOfflineSync() {
  useEffect(() => {
    setBeforeReload(() => { const s = design.get(); return s.loaded && isDirty(s) ? save({ silent: true }) : undefined; });
    let busy = false;
    const run = () => { const s = design.get(); if (busy || !s.loaded || (!s.sync.pending && !s.sync.offline)) return; busy = true; void syncAssets().then(() => syncNow()).finally(() => { busy = false; }); };
    const vis = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('online', run); window.addEventListener('focus', run); document.addEventListener('visibilitychange', vis);
    const t = window.setInterval(run, 30_000);
    return () => { window.removeEventListener('online', run); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', vis); window.clearInterval(t); setBeforeReload(() => {}); };
  }, []);
}

/** on returning to the tab: changes saved by the expert tools (the same project file) */
function useRefreshOnFocus() {
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') void refreshFromFile(); };
    window.addEventListener('focus', on);
    document.addEventListener('visibilitychange', on);
    return () => { window.removeEventListener('focus', on); document.removeEventListener('visibilitychange', on); };
  }, []);
}

/** read-out point for E2E tests (state, without technical data in the UI) */
function useTestHook() {
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__home = {
      /** doors: setting the state in tests — open(id, 0…1), show(true | false), all(0…1) */
      doors: { open: openDoor, show: setShowDoors, all: setAllDoorsOpen },
      /** moving furniture parts (doors of built-in units): view state */
      furnitureOpen: { get: isFurnitureOpen, toggle: toggleFurnitureOpen, all: () => furnitureOpen.get().open },
      /** electrical: the effective plan, adding a point, exports (PDF as base64 — without downloading a file) */
      electrical: {
        plan: planNow, scope: electricalScope, add: addElectrical, patch: patchElectrical, rows: () => planRows(planNow()),
        pdf: async (o: ExportPdfOptions) => { const r = await exportElectricalPdf(o, planNow(), false); if (!r) return null; const u = new Uint8Array(r.bytes); let b = ''; for (let i = 0; i < u.length; i += 0x8000) b += String.fromCharCode(...u.subarray(i, i + 0x8000)); return { name: r.name, pages: r.pages, size: u.length, base64: btoa(b) }; },
        lastExport: () => (window as unknown as { __homeExport?: unknown }).__homeExport ?? null,
        /** placing session (transient state), plan render counters */
        session: placeNow, begin: beginNew, move: beginMove, copy: beginCopy, commit: commitPlace, cancel: cancelPlace, remove: removeElectrical, planPerf: () => ({ ...planPerf }),
        /** performance measurement: a device at a plan position (the placing engine, like a tap on the plan) */
        placePlan: (view: string, q: [number, number], type: Parameters<typeof beginNew>[0]) => { beginNew(type, true); placeAt(surfaceFromPlan(view, q, type, null), null); const id = commitPlace(); cancelPlace(); return id; },
      },
      /** PWA / offline — state of the service worker, sync and device storage */
      pwa: { state: () => pwa.get(), sync: () => ({ ...design.get().sync, target: design.get().target, dirty: isDirty(design.get()) }), debug: __syncDebug, syncNow, flush: flushLocal, backups: async () => (await listBackups()).map((b) => ({ id: b.id, label: b.label, bytes: b.bytes })), assets: async () => (await listAssets()).map((a) => ({ url: a.url, bytes: a.bytes, pending: a.pending })), checkUpdate },
      state: () => {
        const u = ui.get(), d = design.get(), v = variantOf(d);
        const roomId = u.roomId;
        const a = roomId ? arrangementOf(d, roomId) : null;
        return {
          section: u.section, mode: u.mode, houseView: u.houseView, level: u.level, roomId, roomView: u.roomView, selection: u.selection,
          loaded: d.loaded, dirty: isDirty(d), past: d.history.past.length, future: d.history.future.length, undoLabel: d.history.presentLabel,
          variant: v.name, variants: docOf(d).variants.length,
          arrangement: a && {
            id: a.id, name: a.name, saved: !!a.saved, finishes: a.finishes,
            furniture: a.furniture.map((f) => { const it = itemById(f.catalogId); return { id: f.id, catalogId: f.catalogId, variant: f.variant ?? null, x: f.x, y: f.y, rot: f.rot, dims: it ? resolveDims(it, f) : null, materialId: f.materialId ?? null }; }),
          },
          arrangements: roomId ? interiorOfRoom(d, roomId).arrangements.map((x) => ({ id: x.id, name: x.name, n: x.furniture.length, saved: !!x.saved })) : [],
        };
      },
      furniture: (roomId: string, id: string) => furnitureById(arrangementOf(design.get(), roomId), id),
      /** project rooms and the position of a wall-mounted object on its mounting surface */
      rooms: () => allRooms().map((r) => r.id),
      project: () => ({ id: project().manifest.projectId, name: project().manifest.name, modules: project().manifest.modules, levels: allLevels().map((l) => l.id) }),
      mounted: (roomId: string, id: string) => { const m = mountedNow(roomId, id); return m && { surfaceId: m.surface.id, u: m.u, v: m.v, along: m.along, from: m.from, height: m.height, length: m.surface.length }; },
      drag: () => { const d = drag.get(); return { item: d.item, ghost: d.ghost, guides: d.guides.length, catalog: d.catalog && { ...d.catalog, thumb: undefined }, locked: sceneApi.locked, mount: d.mount, warnings: d.warnings.map((w) => w.kind) }; },
      ui: (patch: Record<string, unknown>) => ui.set(patch),
      /** variants (without thumbnails — only their presence and size), comparison, last screenshot */
      variants: () => {
        const d = docOf(design.get());
        return { active: d.activeVariantId, compare: ui.get().compare, list: d.variants.map((v) => ({ id: v.id, name: v.name, view: v.view ?? null, sun: v.sun ?? null, stairs: v.stairs ?? null, thumb: v.thumbnail ? v.thumbnail.length : 0, updatedAt: v.updatedAt ?? null, rooms: Object.keys(v.interiors ?? {}).length })) };
      },
      screenshot: () => (window as unknown as { __lastScreenshot?: unknown }).__lastScreenshot ?? null,
    };
  }, []);
}

function LeftPanel() {
  const section = useUi((s) => s.section);
  return (
    <aside className="hm-side" data-testid="side">
      {section === 'building' && <SectionHouse />}
      {section === 'interiors' && <SectionInteriors />}
      {section === 'materials' && <SectionMaterials />}
      {section === 'furniture' && <SectionFurniture />}
      {section === 'electrical' && <SectionElectrical />}
      {section === 'variants' && <SectionVariants />}
      {section === 'expert' && <ExpertPanel />}
    </aside>
  );
}

/** error boundary escape: the exterior building view without selection, comparison and open dialogs — nothing of the view in which the error occurred */
function toHomeView() {
  ui.set({ selection: null, compare: null, settingsOpen: false, section: 'building' });
  goPreset(homeViewId());
}

/** the app inside an error boundary: an exception while rendering a panel or the scene does not leave a blank page (ui/ErrorBoundary.tsx) */
export default function HomeApp() {
  return <ErrorBoundary homeLabel={t('app.backToBuilding', { building: buildingWords().gen })} onHome={toHomeView}><Home /></ErrorBoundary>;
}

function Home() {
  // scene data: the project's model files or — when the project has none — the outline of the shell generated from the rooms
  const data = useMemo(() => sceneDataOf(), []);
  const loaded = useDesignLoaded();
  const mode = useUi((s) => s.mode), sunOn = hasModule('sun');
  // ELECTRICAL mode has its own UI in the scene area (the rest of the home configurator is hidden meanwhile)
  const el = useUi((s) => s.section === 'electrical' && !s.compare), elView = useUi((s) => s.elView);
  // mobile layout (phone) — the same set of panels, arranged differently: full-width scene, panel in the bottom drawer
  const mobile = useLayout((s) => s.mobile), landscape = useLayout((s) => s.landscape), coarse = useLayout((s) => s.coarse);
  useBackGuard(mobile);
  useShortcuts();
  useAutosave();
  useRefreshOnFocus();
  useOfflineSync();
  useTestHook();
  if (!loaded) return <div className="hm-status" data-testid="loading"><div className="hm-spinner" />{t('app.loadingProject')}</div>;
  return (
    <div className={`hm hm-${mode}`} data-testid="home-app" data-layout={mobile ? 'mobile' : 'desktop'} data-orient={landscape ? 'landscape' : 'portrait'} data-pointer={coarse ? 'coarse' : 'fine'} data-el={el ? elView : undefined}>
      <TopBar />
      <div className="hm-body">
        {!mobile && <LeftPanel />}
        <main className="hm-stage">
          <HomeCanvas data={data} />
          {el ? <ElWorkspace /> : <>
            {/* sun panel — only for a project with a geographic location (sun module) */}
            {mode === 'home' && sunOn && <SunPanel />}
            {/* Expert mode or a project without the sun panel: the doors switch in the same place */}
            {(mode !== 'home' || !sunOn) && mobile && <div className="hm-sun"><div className="hm-sun-bar"><DoorsButton /></div></div>}
            <Hint />
            <MountTip />
            <MouseLegend />
            <BottomBar />
            {mobile && <FurnitureQuickBar />}
          </>}
          {coarse && <WalkPad />}
          <Toasts />
        </main>
        {mobile ? (el ? null : <MobileSheet><Inspector /><LeftPanel /></MobileSheet>) : <Inspector />}
      </div>
      {mobile && <MobileNav />}
      <Settings />
      <Onboarding />
      <PwaUpdateBanner />
      <ProjectConflict />
      <CatalogGhost />
    </div>
  );
}

let loading: Promise<void> | null = null;
function useDesignLoaded() {
  const loaded = useDesign((s) => s.loaded);
  useEffect(() => {
    setNotifier(toast);
    if (!loading) loading = loadDesign().catch((e) => toast(t('app.loadFailed', { message: (e as Error).message }), 'error'));
  }, []);
  return loaded;
}
