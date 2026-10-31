// A/B comparison — split-screen overlay: side labels, divider line, swap sides, exit (a picture: Download › Picture).
// Mobile layout: one side full-screen with an A ↔ B switch (same camera), no double rendering.
import { exitCompare, swapCompare } from '../actions';
import { sameDesign } from '../model/variantData';
import type { Side } from '../store/sides';
import { ui, useUi } from '../store/ui';
import { t } from '../../i18n';

export function CompareOverlay({ sides, single = null }: { sides: Side[]; single?: Side['id'] | null }) {
  const kind = useUi((s) => s.compare?.kind);
  // two versions that are still the same: nothing to see yet — say so instead of showing two equal houses silently
  const same = kind === 'variants' && sides.length === 2 && sameDesign(sides[0].variant, sides[1].variant)
    ? <b className="hm-compare-same" data-testid="compare-same">{t('compareUi.same')}</b> : null;
  if (single) {
    const cur = sides.find((s) => s.id === single) ?? sides[0];
    return (
      <div className="hm-compare single" data-testid="compare" data-side={cur.id}>
        <div className={`hm-compare-label side-${cur.id}`} data-testid={`compare-label-${cur.id}`}><b>{cur.id}</b><span>{cur.label}</span></div>
        <div className="hm-compare-bar" data-testid="compare-bar">
          {same}
          <div className="hm-compare-ab" role="group" aria-label={t('compareUi.shownVariant')} data-testid="compare-ab">
            {sides.map((sd) => (
              <button key={sd.id} className={`side-${sd.id}${sd.id === cur.id ? ' on' : ''}`} onClick={() => ui.set({ compareSide: sd.id })} data-testid={`compare-show-${sd.id}`} aria-pressed={sd.id === cur.id}>{sd.id}</button>
            ))}
          </div>
          <button className="hm-btn primary" onClick={exitCompare} data-testid="compare-exit">{t('compareUi.exit')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="hm-compare" data-testid="compare">
      <div className="hm-compare-split" />
      {sides.map((sd) => (
        <div key={sd.id} className={`hm-compare-label side-${sd.id}`} data-testid={`compare-label-${sd.id}`}>
          <b>{sd.id}</b><span>{sd.label}</span>
        </div>
      ))}
      <div className="hm-compare-bar" data-testid="compare-bar">
        {same ?? <span>{kind === 'room' ? t('compareUi.arrangements') : t('compareUi.variants')} · {t('compareUi.sameView')}</span>}
        <button className="hm-btn" onClick={swapCompare} data-testid="compare-swap" title={t('compareUi.swapTitle')}>{t('compareUi.swap')}</button>
        <button className="hm-btn primary" onClick={exitCompare} data-testid="compare-exit">{t('compareUi.exit')}</button>
      </div>
    </div>
  );
}
