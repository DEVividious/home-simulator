// App shell around the scene: the one-sentence hint (ADR 0043), toasts, the welcome screen (three pictures, one sentence each;
// "?" in the top bar shows it again) and the preview of the card dragged from the catalogue.
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { arrangementOf, useDesign } from '../store/design';
import { useDrag } from '../store/drag';
import { useLayout } from '../store/layout';
import { ui, useUi } from '../store/ui';
import { useClearOfSceneButtons } from './clearOfSceneButtons';
import { Icon } from './icons';

/** the hint above the scene: one sentence for where the user is (mouse or touch words), dismissable */
export function Hint() {
  const section = useUi((s) => s.section), tab = useUi((s) => s.arrangeTab), roomId = useUi((s) => s.roomId), view = useUi((s) => s.roomView), houseView = useUi((s) => s.houseView);
  const sel = useUi((s) => s.selection?.kind ?? null);
  // empty room = the EFFECTIVE arrangement has no furniture (project furniture applies before anything is written to the document)
  const empty = useDesign((s) => !!roomId && arrangementOf(s, roomId).furniture.length === 0);
  const [hidden, setHidden] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const touch = useLayout((s) => s.coarse);
  const k = (key: string) => t(`steps.hint.${key}${touch ? 'Touch' : ''}`);
  let text: string | null;
  if (section === 'electrical' || section === 'expert') text = null;
  else if (houseView === 'walk' && !roomId) text = null;              // the walk bar carries the sentence, next to the place
  else if (sel === 'furniture') text = k('selected');
  else if (roomId && view === 'walk') text = k('walk');
  else if (roomId && section === 'arrange' && tab === 'colours') text = k('colours');
  else if (roomId && empty) text = k('empty');
  else if (roomId) text = k('room');
  else if (houseView === 'interior') text = k('level');
  else text = k('outside');
  const shown = text && !hidden.includes(text) ? text : null;
  useClearOfSceneButtons(ref, shown);
  if (!shown) return null;
  return (
    <div ref={ref} className="hm-hintchip" data-testid="hint">
      <Icon name="info" size={16} /><span>{shown}</span>
      <button type="button" onClick={() => setHidden((h) => [...h, shown])} aria-label={t('steps.hideHint')}><Icon name="close" size={14} /></button>
    </div>
  );
}

export function Toasts() {
  const toast = useUi((s) => s.toast);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast.n);
    const h = window.setTimeout(() => setShown((n) => (n === toast.n ? null : n)), toast.ms ?? (toast.level === 'error' ? 6000 : 3200));
    return () => window.clearTimeout(h);
  }, [toast]);
  if (!toast || shown !== toast.n) return null;
  return <div className={`hm-toast ${toast.level}`} role="status" data-testid="toast">{toast.text}</div>;
}

/** the welcome screen: three pictures, one sentence each — the three steps */
export function Onboarding() {
  const done = useUi((s) => s.onboardingDone);
  if (done) return null;
  const close = () => ui.set({ onboardingDone: true });
  const steps: [string, string][] = [['eye', t('steps.welcome.look')], ['sofa', t('steps.welcome.arrange')], ['layers', t('steps.welcome.versions')]];
  return (
    <div className="hm-modal-bg" data-testid="onboarding">
      <div className="hm-modal hm-welcome">
        <h2>{t('steps.welcome.title')}</h2>
        <ol className="hm-welcome-steps">
          {steps.map(([icon, text], i) => <li key={icon} data-testid={`welcome-${i + 1}`}><span className="hm-welcome-pic"><Icon name={icon} size={44} /></span><span>{text}</span></li>)}
        </ol>
        <button type="button" className="hm-btn primary wide" onClick={close} data-testid="onboarding-start">{t('steps.welcome.start')}</button>
      </div>
    </div>
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
