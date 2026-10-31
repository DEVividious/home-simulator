// Mobile layout of the configurator (the same components as on a desktop — the steps, the scene bar and the object bar are
// placed by CSS):
//  • MobileSheet — bottom sheet with the step panel or the card (collapsed / medium / expanded; landscape: panel on the right),
//  • WalkPad — virtual walk joystick (look around: drag over the rest of the screen),
//  • useBackGuard — the system "back" closes in turn: dialog, sheet, selection, room / walk — before leaving the app.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { backStep } from '../backNav';
import { wake } from '../scene/renderLoop';
import { padInput, resetWalkInput, TAP_MS, walkInput } from '../scene/walkInput';
import { isWalking, sections, ui, useUi, type UiState } from '../store/ui';
import { Icon } from './icons';
import { t } from '../../i18n';

const SHEET_ORDER: UiState['sheet'][] = ['collapsed', 'medium', 'expanded'];

/** bottom sheet (context panel): drag the grip up / down (three states), or tap it to open half way / close */
export function MobileSheet({ children }: { children: ReactNode }) {
  const sheet = useUi((s) => s.sheet), section = useUi((s) => s.section);
  // a selection with a card (walls, floor and ceiling have none — they are chosen in Arrange › Colours)
  const selKind = useUi((s) => s.selection?.kind ?? null), hasSel = !!selKind && !['wall', 'floor', 'ceiling', 'room'].includes(selKind);
  const roomId = useUi((s) => s.roomId), walk = useUi((s) => s.houseView === 'walk' || s.roomView === 'walk');
  const drag = useRef<{ y: number; x: number; id: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  // automatic states: entering a room and walking collapse the sheet (the scene is visible); selecting a surface / element opens it
  // (in the Arrange step the sheet stays as it is: the furniture and colours of the room are in it)
  useEffect(() => { if (roomId && ui.get().section !== 'arrange') ui.set({ sheet: 'collapsed' }); }, [roomId]);
  useEffect(() => { if (walk) ui.set({ sheet: 'collapsed' }); }, [walk]);
  useEffect(() => {
    const sel = ui.get().selection;
    if (sel && sel.kind !== 'furniture' && sel.kind !== 'electrical' && ui.get().sheet === 'collapsed') ui.set({ sheet: 'medium' });
    body.current?.scrollTo({ top: 0 });
  }, [selKind, section]);
  const step = (d: number) => { const i = SHEET_ORDER.indexOf(ui.get().sheet); ui.set({ sheet: SHEET_ORDER[Math.max(0, Math.min(2, i + d))] }); };
  // walking in Look: the collapsed sheet says what it holds — the places to go to (people looked for them: usability issue B6)
  const label = hasSel ? t('mobile.selectedElement') : walk && section === 'look' ? t('steps.places') : (sections().find((s) => s.id === section)?.label ?? '');
  return (
    <section className="hm-sheet" data-state={sheet} data-testid="mobile-sheet">
      <header className="hm-sheet-grip" data-testid="sheet-grip"
        onPointerDown={(e) => { drag.current = { y: e.clientY, x: e.clientX, id: e.pointerId }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          if (!d || d.id !== e.pointerId) return;
          const landscape = window.innerWidth > window.innerHeight;
          const delta = landscape ? d.x - e.clientX : d.y - e.clientY;           // up (portrait) / left (landscape) = larger sheet
          // a tap opens half way or closes; only a drag opens the whole screen (a tap on the title used to: usability issue B5)
          if (Math.abs(delta) < 12) ui.set({ sheet: sheet === 'collapsed' ? 'medium' : 'collapsed' });
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

const PUSH_HINT_MS = 500, PUSH_HINT_KEEP_MS = 4000;

/** virtual walk joystick (bottom-left corner); look around by dragging over the rest of the scene */
export function WalkPad() {
  const on = useUi(isWalking);
  const knob = useRef<HTMLSpanElement>(null), st = useRef<{ id: number; cx: number; cy: number; r: number; t0: number } | null>(null);
  const later = useRef(0);
  // a finger held still in the middle does nothing: after a moment the pad says to push it (usability issue B10)
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(0), moved = useRef(false);
  useEffect(() => { if (!on) { resetWalkInput(); setHint(false); } return () => { window.clearTimeout(later.current); window.clearTimeout(hintTimer.current); resetWalkInput(); }; }, [on]);
  if (!on) return null;
  const set = (x: number, y: number) => {
    const s = st.current!;
    let dx = (x - s.cx) / s.r, dy = (y - s.cy) / s.r;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    Object.assign(walkInput, padInput(dx, dy));                                   // dead zone, quick start, the outer ring runs
    if (knob.current) knob.current.style.transform = `translate(${dx * s.r * 0.6}px, ${dy * s.r * 0.6}px)`;
    if (walkInput.f || walkInput.s) { moved.current = true; window.clearTimeout(hintTimer.current); setHint(false); }
    wake();
  };
  const press = () => {
    moved.current = false; window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => { if (!moved.current) setHint(true); }, PUSH_HINT_MS);
  };
  const lift = () => {
    window.clearTimeout(hintTimer.current);
    if (hint) hintTimer.current = window.setTimeout(() => setHint(false), PUSH_HINT_KEEP_MS);
  };
  const release = () => { resetWalkInput(); if (knob.current) knob.current.style.transform = ''; };
  // a short tap on the pad still walks a step at walking speed in its direction (like a short key press)
  const end = () => {
    const t0 = st.current?.t0 ?? 0, left = t0 + TAP_MS - performance.now(), m = Math.hypot(walkInput.f, walkInput.s);
    st.current = null; walkInput.run = false; window.clearTimeout(later.current); lift();
    if (left > 0 && m > 0) { walkInput.f /= m; walkInput.s /= m; }
    later.current = window.setTimeout(release, Math.max(0, left));
  };
  return (
    <div className="hm-walkpad" data-testid="walk-pad" aria-label={t('mobile.walking')}
      onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(); window.clearTimeout(later.current); st.current = { id: e.pointerId, cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2, t0: performance.now() }; e.currentTarget.setPointerCapture(e.pointerId); press(); set(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (st.current?.id === e.pointerId) set(e.clientX, e.clientY); }}
      onPointerUp={(e) => { if (st.current?.id === e.pointerId) end(); }} onPointerCancel={end}>
      <svg className="hm-walkpad-arrows" viewBox="0 0 100 100" aria-hidden>
        <path d="M42 14 50 6l8 8M42 86l8 8 8-8M14 42 6 50l8 8M86 42l8 8-8 8" />
      </svg>
      <span ref={knob} />
      {hint && <p className="hm-walkpad-hint" role="status" data-testid="walk-pad-hint">{t('mobile.padPush')}</p>}
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
