// Mobile layout of the configurator (same code as desktop; see docs/MOBILE_UX.md):
//  • MobileNav — bottom section navigation (phone in landscape: vertical rail on the left),
//  • MobileSheet — bottom sheet with the context panel (collapsed / medium / expanded; landscape: panel on the right),
//  • FurnitureQuickBar — quick actions for the selected furniture item (rotate ±15° / ±90°, duplicate, delete),
//  • WalkPad — virtual walk joystick (look around: drag over the rest of the screen),
//  • useBackGuard — the system "back" closes in turn: dialog, sheet, selection, room / walk — before leaving the app.
import { useEffect, useRef, type ReactNode } from 'react';
import { deleteFurniture, duplicateSelected, goSection } from '../actions';
import { backStep } from '../backNav';
import { isWallMounted } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { MOUNT } from '../model/mountDrag';
import { mountedNow, nudgeMounted, nudgeMountedSide, rotateBy } from '../scene/interaction';
import { useArrangement } from '../store/design';
import { useDrag } from '../store/drag';
import { wake } from '../scene/renderLoop';
import { resetWalkInput, walkInput } from '../scene/walkInput';
import { isWalking, sections, ui, useUi, type Section, type UiState } from '../store/ui';
import { Icon } from './icons';
import { t } from '../../i18n';

const SECTION_ICON: Record<Section, string> = { building: 'house', interiors: 'interior', materials: 'brush', furniture: 'sofa', electrical: 'plug', variants: 'layers', expert: 'expert' };
const SHEET_ORDER: UiState['sheet'][] = ['collapsed', 'medium', 'expanded'];

/** bottom section navigation: tapping the active section collapses / expands the sheet, another one opens its panel */
export function MobileNav() {
  const section = useUi((s) => s.section), mode = useUi((s) => s.mode);
  const go = (id: Section) => {
    const s = ui.get();
    if (id === s.section && !s.selection) { ui.set({ sheet: s.sheet === 'collapsed' ? 'medium' : 'collapsed' }); return; }
    if (id === 'expert') ui.set({ section: 'expert', selection: null }); else goSection(id);
    ui.set({ selection: null, sheet: 'medium' });
  };
  const items = [...sections(), ...(mode === 'expert' ? [{ id: 'expert' as Section, label: t('section.expert') }] : [])];
  return (
    <nav className="hm-mnav" data-testid="mobile-nav" aria-label={t('mobile.sections')}>
      {items.map((s) => (
        <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => go(s.id)} data-testid={`mnav-${s.id}`} aria-current={section === s.id ? 'page' : undefined}>
          <Icon name={SECTION_ICON[s.id]} size={22} /><span>{s.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** bottom sheet (context panel): drag the grip up / down, or tap it for the next state */
export function MobileSheet({ children }: { children: ReactNode }) {
  const sheet = useUi((s) => s.sheet), section = useUi((s) => s.section), hasSel = useUi((s) => !!s.selection);
  const roomId = useUi((s) => s.roomId), walk = useUi((s) => s.houseView === 'walk' || s.roomView === 'walk');
  const drag = useRef<{ y: number; x: number; id: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  // automatic states: entering a room and walking collapse the sheet (the scene is visible); selecting a surface / element opens it
  useEffect(() => { if (roomId) ui.set({ sheet: 'collapsed' }); }, [roomId]);
  useEffect(() => { if (walk) ui.set({ sheet: 'collapsed' }); }, [walk]);
  useEffect(() => {
    const sel = ui.get().selection;
    if (sel && sel.kind !== 'furniture' && sel.kind !== 'electrical' && ui.get().sheet === 'collapsed') ui.set({ sheet: 'medium' });
    body.current?.scrollTo({ top: 0 });
  }, [hasSel, section]);
  const step = (d: number) => { const i = SHEET_ORDER.indexOf(ui.get().sheet); ui.set({ sheet: SHEET_ORDER[Math.max(0, Math.min(2, i + d))] }); };
  const label = hasSel ? t('mobile.selectedElement') : (sections().find((s) => s.id === section)?.label ?? t('section.expert'));
  return (
    <section className="hm-sheet" data-state={sheet} data-testid="mobile-sheet">
      <header className="hm-sheet-grip" data-testid="sheet-grip"
        onPointerDown={(e) => { drag.current = { y: e.clientY, x: e.clientX, id: e.pointerId }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          if (!d || d.id !== e.pointerId) return;
          const landscape = window.innerWidth > window.innerHeight;
          const delta = landscape ? d.x - e.clientX : d.y - e.clientY;           // up (portrait) / left (landscape) = larger sheet
          if (Math.abs(delta) < 12) ui.set({ sheet: sheet === 'collapsed' ? 'medium' : sheet === 'medium' ? 'expanded' : 'collapsed' });
          else step(delta > 0 ? (Math.abs(delta) > 220 ? 2 : 1) : (Math.abs(delta) > 220 ? -2 : -1));
        }}
        onPointerCancel={() => { drag.current = null; }}>
        <i aria-hidden />
        <b>{label}</b>
        <button className="hm-icon-btn" aria-label={sheet === 'collapsed' ? t('mobile.expandPanel') : t('mobile.collapsePanel')} data-testid="sheet-toggle"
          onPointerDown={(e) => e.stopPropagation()} onClick={() => ui.set({ sheet: sheet === 'collapsed' ? 'medium' : 'collapsed' })}>
          <Icon name="back" size={18} />
        </button>
      </header>
      <div className="hm-sheet-body" ref={body} data-testid="sheet-body">{children}</div>
    </section>
  );
}

/** quick actions for the selected furniture item (above the sheet): rotate, duplicate, delete, done */
export function FurnitureQuickBar() {
  const sel = useUi((s) => (s.selection?.kind === 'furniture' ? s.selection : null));
  const walk = useUi(isWalking);                                                // walking: the joystick is in this spot
  if (!sel || walk) return null;
  const rot = (d: number) => rotateBy(sel.roomId, sel.id, d);
  return <QuickBar roomId={sel.roomId} id={sel.id} rot={rot} />;
}
/** wall-mounted object on a phone: 1 cm steps along the wall and vertically instead of rotation — the finger need not be pixel-precise */
function MountQuick({ roomId, id }: { roomId: string; id: string }) {
  useArrangement(roomId);
  const live = useDrag((s) => (s.mount && s.mount.id === id ? s.mount : null));
  // ◀ ▶ — in the direction seen ON SCREEN (the camera may look at the wall from behind, as in the default room view); ▲ ▼ — height
  const m = mountedNow(roomId, id), side = (dir: -1 | 1) => nudgeMountedSide(roomId, id, dir, MOUNT.nudgeFine), lift = (dv: number) => nudgeMounted(roomId, id, 0, dv);
  if (!m) return null;
  const cm = (v: number) => Math.round(v * 100);
  return <>
    <button onClick={() => side(-1)} data-testid="q-mount-left" aria-label={t('mobile.left1cm')}>◀<small>1 cm</small></button>
    <button onClick={() => side(1)} data-testid="q-mount-right" aria-label={t('mobile.right1cm')}>▶<small>1 cm</small></button>
    <button onClick={() => lift(MOUNT.nudgeFine)} data-testid="q-mount-up" aria-label={t('mobile.up1cm')}>▲<small>1 cm</small></button>
    <button onClick={() => lift(-MOUNT.nudgeFine)} data-testid="q-mount-down" aria-label={t('mobile.down1cm')}>▼<small>1 cm</small></button>
    <span className="hm-quick-read" data-testid="q-mount-read">{cm(live?.along ?? m.along)} · {cm(live?.height ?? m.height)} cm</span>
  </>;
}
function QuickBar({ roomId, id, rot }: { roomId: string; id: string; rot: (d: number) => void }) {
  const a = useArrangement(roomId), f = a.furniture.find((x) => x.id === id), hung = isWallMounted(f ? itemById(f.catalogId) : null);
  const sel = { roomId, id };
  return (
    <div className="hm-quick" data-testid="furniture-quick" role="toolbar" aria-label={t('mobile.selectedFurniture')}>
      {hung ? <MountQuick roomId={roomId} id={id} /> : <>
        <button onClick={() => rot(90)} data-testid="q-rot-l90" aria-label={t('mobile.rotLeft', { deg: 90 })}><Icon name="rotl" size={18} /><small>90°</small></button>
        <button onClick={() => rot(15)} data-testid="q-rot-l15" aria-label={t('mobile.rotLeft', { deg: 15 })}><Icon name="rotl" size={18} /><small>15°</small></button>
        <button onClick={() => rot(-15)} data-testid="q-rot-r15" aria-label={t('mobile.rotRight', { deg: 15 })}><Icon name="rotr" size={18} /><small>15°</small></button>
        <button onClick={() => rot(-90)} data-testid="q-rot-r90" aria-label={t('mobile.rotRight', { deg: 90 })}><Icon name="rotr" size={18} /><small>90°</small></button>
      </>}
      <span />
      <button onClick={() => duplicateSelected(sel.roomId, sel.id)} data-testid="q-duplicate" aria-label={t('mobile.duplicate')}><Icon name="copy" size={18} /></button>
      <button className="danger" onClick={() => deleteFurniture(sel.roomId, sel.id)} data-testid="q-delete" aria-label={t('mobile.delete')}><Icon name="trash" size={18} /></button>
      <button className="ok" onClick={() => ui.set({ selection: null })} data-testid="q-done" aria-label={t('mobile.done')}><Icon name="check" size={18} /></button>
    </div>
  );
}

/** virtual walk joystick (bottom-left corner); look around by dragging over the rest of the scene */
export function WalkPad() {
  const on = useUi(isWalking);
  const knob = useRef<HTMLSpanElement>(null), st = useRef<{ id: number; cx: number; cy: number; r: number } | null>(null);
  useEffect(() => { if (!on) resetWalkInput(); return resetWalkInput; }, [on]);
  if (!on) return null;
  const set = (x: number, y: number) => {
    const s = st.current!;
    let dx = (x - s.cx) / s.r, dy = (y - s.cy) / s.r;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);                         // dead zone
    walkInput.s = dz(dx); walkInput.f = dz(-dy);
    if (knob.current) knob.current.style.transform = `translate(${dx * s.r * 0.6}px, ${dy * s.r * 0.6}px)`;
    wake();
  };
  const end = () => { st.current = null; resetWalkInput(); if (knob.current) knob.current.style.transform = ''; };
  return (
    <div className="hm-walkpad" data-testid="walk-pad" aria-label={t('mobile.walking')}
      onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(); st.current = { id: e.pointerId, cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 }; e.currentTarget.setPointerCapture(e.pointerId); set(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (st.current?.id === e.pointerId) set(e.clientX, e.clientY); }}
      onPointerUp={(e) => { if (st.current?.id === e.pointerId) end(); }} onPointerCancel={end}>
      <span ref={knob} />
    </div>
  );
}

// ------------------------------------------------------------------ system "back" (closing order: src/home/backNav.ts)
/**
 * One extra browser history entry while there is something to close. "Back" pops that entry → we perform one closing
 * step and push the entry again; when nothing is left to close, back works normally (leaves the page).
 * Enabled only in the mobile layout — desktop navigation is unchanged.
 */
export function useBackGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let guarded = false;
    const arm = () => { if (!guarded && backStep(true)) { window.history.pushState({ hmGuard: true }, ''); guarded = true; } };
    const onPop = () => {
      if (!guarded) return;
      guarded = false;
      if (backStep()) arm(); else window.history.back();      // nothing to close: back goes to the previous page
    };
    arm();
    const off = ui.subscribe(arm);
    window.addEventListener('popstate', onPop);
    return () => { off(); window.removeEventListener('popstate', onPop); };
  }, [enabled]);
}
