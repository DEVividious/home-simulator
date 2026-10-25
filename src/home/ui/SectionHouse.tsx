// BUILDING section: building overview — quick views (camera presets), levels with rooms, surroundings, saved views.
import { useState } from 'react';
import { addBookmark, deleteBookmark, goPreset, goSection, openBookmark, setLevel } from '../actions';
import { viewpoints } from '../model/viewpoints';
import { hasCapability, hasModule, project } from '../../project/active';
import { hasStairs } from '../model/stairs';
import { buildingWords } from '../model/wording';
import { allLevels, roomsOfLevel } from '../model/rooms';
import type { LevelId } from '../model/types';
import { viewPresets } from '../model/views';
import { useDoc } from '../store/design';
import { startWalk, ui, useUi } from '../store/ui';
import { Block, NameInput, Toggle } from './controls';
import { DoorsPanelToggle } from './DoorsToggle';
import { Icon } from './icons';
import { fmtNum, t } from '../../i18n';

const m2 = (x: number) => `${fmtNum(x, 1)} m²`;

export function SectionHouse() {
  const env = useUi((s) => s.environment);
  const doc = useDoc();
  const [naming, setNaming] = useState(false);
  const lv = (id: LevelId) => { const r = roomsOfLevel(id); return { n: r.length, area: r.reduce((s, q) => s + q.area, 0) }; };
  const levels = allLevels().map((l) => ({ ...l, ...lv(l.id) })), manifest = project().manifest, words = buildingWords();
  const total = levels.reduce((s, l) => ({ n: s.n + l.n, area: s.area + l.area }), { n: 0, area: 0 });
  return (
    <div className="hm-section" data-testid="section-building">
      <div className="hm-hero">
        <h2>{words.your}</h2>
        <p>{manifest.description ?? manifest.name}</p>
        <div className="hm-stats">
          <div><b>{m2(total.area)}</b><small>{t('houseUi.statArea')}</small></div>
          <div><b>{total.n}</b><small>{t('houseUi.statRooms')}</small></div>
          <div><b>{levels.length}</b><small>{levels.length === 1 ? t('houseUi.levelsOne') : levels.length < 5 ? t('houseUi.levelsFew') : t('houseUi.levelsMany')}</small></div>
        </div>
      </div>
      <Block title={t('houseUi.explore', { building: words.noun })}>
        <div className="hm-presets" data-testid="presets">
          {viewPresets().map((p) => (
            <button key={p.id} className="hm-preset" onClick={() => goPreset(p.id)} data-testid={`preset-${p.id}`} title={p.hint}>
              <span className="hm-preset-ico"><Icon name={p.icon} size={20} /></span><b>{p.label}</b><small>{p.hint}</small>
            </button>
          ))}
        </div>
      </Block>
      {hasCapability('walk') && <Block title={t('houseUi.walkTitle', { scope: words.walk })}>
        <button className="hm-btn primary wide" onClick={() => startWalk()} data-testid="walk-start"><Icon name="walk" size={16} /> {t('houseUi.startWalk')}</button>
        <p className="hm-muted">{t('houseUi.walkHint', { stairs: hasStairs() ? t('houseUi.walkHintStairs') : '', site: hasModule('site') ? t('houseUi.walkHintSite') : '' })}</p>
        <div className="hm-viewpoints" data-testid="viewpoints">
          {viewpoints().map((v) => (
            <button key={v.id} onClick={() => startWalk({ viewpointId: v.id })} title={`${v.en} — ${v.hint}`} data-testid={v.id}>
              <b>{v.name}</b><small>{v.hint}</small>
            </button>
          ))}
        </div>
      </Block>}
      <Block title={t('houseUi.levels')}>
        <div className="hm-levels">
          {levels.map((s) => (
            <button key={s.id} className="hm-level-card" onClick={() => { setLevel(s.id); goSection('interiors'); }} data-testid={`level-${s.id}`}>
              <b>{s.name}</b><small>{t('houseUi.levelRooms', { n: s.n, area: m2(s.area) })}</small><span>{t('houseUi.enter')}</span>
            </button>
          ))}
        </div>
      </Block>
      <Block title={t('houseUi.interiorDoors')} testid="doors-block">
        <DoorsPanelToggle testid="doors-toggle-house" />
      </Block>
      {hasModule('environment') && <Block title={t('houseUi.surroundings')}>
        <Toggle on={env} label={t('houseUi.showSurroundings')} hint={t('houseUi.surroundingsHint')} onChange={(v) => ui.set({ environment: v })} testid="env-toggle" />
      </Block>}
      <Block title={t('houseUi.savedViews')} right={!naming && <button className="hm-link" onClick={() => setNaming(true)} data-testid="bookmark-add"><Icon name="plus" size={14} /> {t('houseUi.saveThisView')}</button>}>
        {naming && <NameInput placeholder={t('houseUi.viewPlaceholder')} onSubmit={(n) => { addBookmark(n); setNaming(false); }} onCancel={() => setNaming(false)} testid="bookmark-name" />}
        {!(doc.bookmarks ?? []).length && !naming && <p className="hm-muted">{t('houseUi.savedViewsEmpty')}</p>}
        <div className="hm-list">
          {(doc.bookmarks ?? []).map((b) => (
            <div key={b.id} className="hm-row">
              <button className="hm-row-main" onClick={() => openBookmark(b)} data-testid={`bookmark-${b.name}`}><Icon name="camera" size={16} /> {b.name}</button>
              <button className="hm-icon-btn" title={t('houseUi.deleteView')} onClick={() => deleteBookmark(b.id)}><Icon name="close" size={14} /></button>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}
