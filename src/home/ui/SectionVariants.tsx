// VERSIONS step (ADR 0036, 0041): cards with a picture of each version of the design, "+ New version" (a copy of the current
// one), ⋯ on a card (rename, delete, start over) and "Compare" (two versions side by side; with more than two, the card to
// compare with is picked). Everything is saved automatically — switching versions keeps the view of the one left.
// Files (export / import of a version, the whole project) live in Settings › Files in advanced mode.
import { useEffect, useState } from 'react';
import { compareWith, deleteProjectVariant, liveThumbnail, renameVersion, resetVersion, switchVariant } from '../actions';
import { extrasOf, sameDesign } from '../model/variantData';
import { useDoc } from '../store/design';
import { ui, useUi } from '../store/ui';
import { t } from '../../i18n';
import { ActionButton, Slot } from './Action';
import { Block, NameInput } from './controls';
import { Icon } from './icons';

function VersionCard({ id, name, thumb, active, only, picking }: { id: string; name: string; thumb: string | null; active: boolean; only: boolean; picking: boolean }) {
  const [menu, setMenu] = useState<'menu' | 'rename' | 'delete' | 'reset' | null>(null);
  const open = () => { if (picking && !active) { ui.set({ comparePick: false }); compareWith(id); } else switchVariant(id); };
  return (
    <div className={`hm-version${active ? ' on' : ''}${picking && !active ? ' pick' : ''}`} data-item>
      <button type="button" className="hm-version-main" onClick={open} data-testid={`variant-${name}`} aria-current={active ? 'true' : undefined}>
        <span className="hm-version-thumb">{thumb ? <img src={thumb} alt="" data-testid={`variant-thumb-${name}`} /> : <Icon name="house" size={36} />}</span>
        <b>{name}</b>
      </button>
      <button type="button" className="hm-icon-btn hm-version-more" onClick={() => setMenu(menu ? null : 'menu')} aria-label={t('steps.more', { name })} data-testid={`variant-more-${name}`}><Icon name="more" size={18} /></button>
      {menu === 'menu' && (
        <div className="hm-version-menu" role="menu">
          <button type="button" onClick={() => setMenu('rename')} data-testid="variant-rename"><Icon name="brush" size={16} /> {t('steps.rename')}</button>
          <button type="button" onClick={() => setMenu('reset')} data-testid="variant-reset"><Icon name="undo" size={16} /> {t('steps.startOver')}</button>
          {!only && <button type="button" className="danger" onClick={() => setMenu('delete')} data-testid="variant-delete"><Icon name="trash" size={16} /> {t('steps.delete')}</button>}
        </div>
      )}
      {menu === 'rename' && <NameInput initial={name} button={t('steps.rename')} onSubmit={(n) => { renameVersion(id, n); setMenu(null); }} onCancel={() => setMenu(null)} testid="variant-name" />}
      {(menu === 'delete' || menu === 'reset') && (
        <div className="hm-confirm" data-testid="variant-confirm">
          <span>{menu === 'delete' ? t('steps.deleteAsk', { name }) : t('steps.startOverAsk')}</span>
          <button type="button" className="hm-btn primary" data-testid="variant-confirm-yes" onClick={() => { if (menu === 'delete') deleteProjectVariant(id); else resetVersion(id); setMenu(null); }}>{menu === 'delete' ? t('steps.delete') : t('steps.startOver')}</button>
          <button type="button" className="hm-btn ghost" onClick={() => setMenu(null)}>{t('steps.cancel')}</button>
        </div>
      )}
    </div>
  );
}

export function SectionVariants() {
  const doc = useDoc(), picking = useUi((s) => s.comparePick);
  // the active version's card shows the scene as it is now (taken when the step opens; stored when versions switch)
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => { const h = window.setTimeout(() => setLive(liveThumbnail()), 300); return () => window.clearTimeout(h); }, [doc.activeVariantId]);
  useEffect(() => () => ui.set({ comparePick: false }), []);
  // a new version starts as an exact copy: say that it needs a change before a comparison shows anything
  const active = doc.variants.find((v) => v.id === doc.activeVariantId);
  const copy = !!active && doc.variants.some((v) => v.id !== active.id && sameDesign(v, active));
  return (
    <div className="hm-section" data-testid="section-variants">
      <Block title={t('steps.versionsTitle')} testid="versions">
        {picking && <p className="hm-tip" data-testid="compare-pick">{t('steps.comparePick')}</p>}
        {!picking && copy && <p className="hm-tip" data-testid="versions-same">{t('steps.versionsSame')}</p>}
        <div className="hm-version-grid" data-testid="version-list">
          {doc.variants.map((v) => <VersionCard key={v.id} id={v.id} name={v.name} active={v.id === doc.activeVariantId} only={doc.variants.length === 1} picking={picking}
            thumb={(v.id === doc.activeVariantId ? live : null) ?? extrasOf(v).thumbnail ?? null} />)}
        </div>
        <Slot place="versions">
          <div className="hm-btn-row">
            <ActionButton id="variant-new" className="hm-btn" />
            <ActionButton id="versions-compare" className="hm-btn" />
          </div>
        </Slot>
      </Block>
    </div>
  );
}
