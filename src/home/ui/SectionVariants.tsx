// VARIANTS section: complete building variants — cards with thumbnails; New variant, Save, Save as, Duplicate, Rename,
// Delete; variant export / import (JSON, schema validation); A/B comparison (split screen); room arrangements;
// project save and whole-project file. A variant covers joinery, facade, interiors, view (camera, FOV, surroundings) and sun.
import { hasCapability, hasModule, project } from '../../project/active';
import { buildingWords } from '../model/wording';
import { useRef, useState } from 'react';
import {
  deleteProjectVariant, duplicateProjectVariant, exitCompare, exportVariantFile, importVariantFile, newVariant, renameProjectVariant, saveVariant,
  saveVariantAs, startCompare, switchVariant,
} from '../actions';
import { roomById, allRooms } from '../model/rooms';
import { fmtTime } from '../model/sun';
import { extrasOf } from '../model/variantData';
import { takeScreenshot } from '../screenshot';
import { exportProject, importProject, save, useDesign, useDoc, variantOf } from '../store/design';
import { toast, useUi } from '../store/ui';
import { Block, NameInput } from './controls';
import { Icon } from './icons';
import { Arrangements } from './SectionInteriors';
import { resetFurnitureToProject, resetVariantToProject } from '../actions';
import { lang, t } from '../../i18n';

/** "Restore project settings" — two clicks (the change affects the whole variant), one history entry */
function ResetToProject() {
  const [ask, setAsk] = useState(false);
  return (
    <div className="hm-reset" data-testid="variant-reset-box">
      {!ask ? <button className="hm-btn wide" onClick={() => setAsk(true)} data-testid="variant-reset">{t('variantsUi.resetProject')}</button> : <>
        <p className="hm-muted">{project().manifest.resetNote ?? t('variantsUi.resetNoteDefault')} {t('variantsUi.resetWarn')}</p>
        <div className="hm-btn-row">
          <button className="hm-btn primary" onClick={() => { resetVariantToProject(); setAsk(false); }} data-testid="variant-reset-confirm">{t('variantsUi.restore')}</button>
          <button className="hm-btn ghost" onClick={() => setAsk(false)} data-testid="variant-reset-cancel">{t('variantsUi.cancel')}</button>
        </div>
      </>}
    </div>
  );
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : t('variantsUi.noViewSaved'));

/** "Restore project furniture" — furniture only, in all rooms at once; two clicks, one history entry */
function ResetFurniture() {
  const [ask, setAsk] = useState(false);
  if (!hasCapability('interiors')) return null;
  return (
    <div className="hm-reset" data-testid="furniture-reset-box">
      {!ask ? <button className="hm-btn wide" onClick={() => setAsk(true)} data-testid="furniture-reset">{t('variantsUi.resetFurniture')}</button> : <>
        <p className="hm-muted">{t('variantsUi.resetFurnitureNote')}</p>
        <div className="hm-btn-row">
          <button className="hm-btn primary" onClick={() => { resetFurnitureToProject(); setAsk(false); }} data-testid="furniture-reset-confirm">{t('variantsUi.restoreFurniture')}</button>
          <button className="hm-btn ghost" onClick={() => setAsk(false)} data-testid="furniture-reset-cancel">{t('variantsUi.cancel')}</button>
        </div>
      </>}
    </div>
  );
}

export function SectionVariants() {
  const doc = useDoc(), words = buildingWords();
  const interiors = useDesign((s) => variantOf(s).interiors);
  const roomId = useUi((s) => s.roomId), compare = useUi((s) => s.compare);
  const target = useDesign((s) => s.target), fileName = useDesign((s) => s.fileName);
  const [naming, setNaming] = useState<'new' | 'saveAs' | 'rename' | null>(null);
  const [room, setRoom] = useState<string>(roomId ?? Object.keys(interiors ?? {})[0] ?? allRooms()[0]?.id ?? '');
  const fileRef = useRef<HTMLInputElement>(null), varFileRef = useRef<HTMLInputElement>(null);
  const active = doc.variants.find((v) => v.id === doc.activeVariantId)!;
  const other = doc.variants.find((v) => v.id !== active.id);
  const [cmpA, setCmpA] = useState(active.id), [cmpB, setCmpB] = useState(other?.id ?? active.id);
  const has = (id: string) => doc.variants.some((v) => v.id === id);
  const A = has(cmpA) ? cmpA : active.id, B = has(cmpB) && cmpB !== A ? cmpB : (doc.variants.find((v) => v.id !== A) ?? active).id;
  const roomsWithContent = allRooms().filter((r) => interiors?.[r.id] || r.id === roomId || r.id === room);
  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportProject()], { type: 'application/json' }));
    a.download = `project-${project().manifest.projectId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const importJson = async (f: File) => {
    const e = importProject(await f.text());
    toast(e ? t('variantsUi.loadFailed', { error: e }) : t('variantsUi.loaded', { name: f.name }), e ? 'error' : 'info');
  };
  const r = roomById(room);
  const ax = extrasOf(active);
  // time of day and surroundings belong to project modules: a project without them does not store them in variants — and the section does not mention them
  const sun = hasModule('sun'), env = hasModule('environment');
  return (
    <div className="hm-section" data-testid="section-variants">
      <Block title={t('variantsUi.title', { building: words.gen })}>
        <p className="hm-muted">{t(sun ? 'variantsUi.introSun' : 'variantsUi.intro', { building: words.gen })}</p>
        <div className="hm-variant-grid" data-testid="variant-list">
          {doc.variants.map((v) => {
            const x = extrasOf(v), rooms = Object.keys(v.interiors ?? {}).length;
            return (
              <button key={v.id} className={`hm-variant-card${v.id === active.id ? ' on' : ''}`} onClick={() => switchVariant(v.id)} data-testid={`variant-${v.name}`}>
                <div className="hm-variant-thumb">{x.thumbnail ? <img src={x.thumbnail} alt="" data-testid={`variant-thumb-${v.name}`} /> : <span>{t('variantsUi.noThumb')}</span>}</div>
                <span><b>{v.name}</b><small>{t('variantsUi.roomsFurnished', { n: rooms })}{sun ? ` · ${x.sun ? `${x.sun.date.slice(8)}.${x.sun.date.slice(5, 7)} ${fmtTime(x.sun.minutes)}` : t('variantsUi.noTimeOfDay')}` : ''}</small><small>{when(x.updatedAt)}</small></span>
              </button>
            );
          })}
        </div>
        {naming === 'new' && <NameInput placeholder={t('variantsUi.newPlaceholder')} button={t('variantsUi.create')} onSubmit={(n) => { newVariant(n); setNaming(null); }} onCancel={() => setNaming(null)} testid="variant-new-name" />}
        {naming === 'saveAs' && <NameInput initial={t('variantsUi.copyName', { name: active.name })} button={t('variantsUi.save')} onSubmit={(n) => { void saveVariantAs(n); setNaming(null); }} onCancel={() => setNaming(null)} testid="variant-saveas-name" />}
        {naming === 'rename' && <NameInput initial={active.name} button={t('variantsUi.renameApply')} onSubmit={(n) => { renameProjectVariant(n); setNaming(null); }} onCancel={() => setNaming(null)} testid="variant-name" />}
        {!naming && (
          <div className="hm-variant-actions">
            <button className="hm-btn" onClick={() => setNaming('new')} data-testid="variant-new"><Icon name="plus" size={14} /> {t('variantsUi.new')}</button>
            <button className="hm-btn primary" onClick={() => void saveVariant()} title={t(sun ? 'variantsUi.saveTitleSun' : 'variantsUi.saveTitle')} data-testid="variant-save"><Icon name="save" size={14} /> {t('variantsUi.save')}</button>
            <button className="hm-btn" onClick={() => setNaming('saveAs')} data-testid="variant-saveas">{t('variantsUi.saveAs')}</button>
            <button className="hm-btn" onClick={duplicateProjectVariant} data-testid="variant-duplicate"><Icon name="copy" size={14} /> {t('variantsUi.duplicate')}</button>
            <button className="hm-btn" onClick={() => setNaming('rename')} data-testid="variant-rename">{t('variantsUi.rename')}</button>
            <button className="hm-btn" disabled={doc.variants.length <= 1} onClick={() => deleteProjectVariant(active.id)} data-testid="variant-delete"><Icon name="trash" size={14} /> {t('variantsUi.delete')}</button>
          </div>
        )}
        <ResetFurniture />
        <ResetToProject />
        <p className="hm-muted">{t('variantsUi.active')} <b>{active.name}</b>{ax.view ? ` · ${t(sun ? 'variantsUi.savedViewSun' : 'variantsUi.savedView')}` : ''}. {t('variantsUi.saveExplain', { env: env ? t('variantsUi.saveExplainEnv') : '', sun: sun ? t('variantsUi.saveExplainSun') : '' })}</p>
        <div className="hm-variant-actions">
          <button className="hm-btn" onClick={() => exportVariantFile(active.id)} data-testid="variant-export"><Icon name="download" size={14} /> {t('variantsUi.exportVariant')}</button>
          <button className="hm-btn" onClick={() => varFileRef.current?.click()} data-testid="variant-import"><Icon name="upload" size={14} /> {t('variantsUi.importVariant')}</button>
          <button className="hm-btn" onClick={() => void takeScreenshot()} data-testid="variant-shot"><Icon name="camera" size={14} /> {t('variantsUi.screenshot')}</button>
        </div>
        <input ref={varFileRef} type="file" accept=".json,application/json" hidden data-testid="variant-import-file"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) importVariantFile(await f.text()); e.target.value = ''; }} />
      </Block>
      <Block title={t('variantsUi.compareTitle')}>
        {doc.variants.length < 2 ? <p className="hm-muted">{t('variantsUi.compareNeedTwo', { building: words.gen })}</p> : (
          <div className="hm-compare-pick" data-testid="variant-compare">
            <b>A</b><select value={A} onChange={(e) => setCmpA(e.target.value)} data-testid="compare-a">{doc.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <b className="b">B</b><select value={B} onChange={(e) => setCmpB(e.target.value)} data-testid="compare-b">{doc.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <span />
            {compare ? <button className="hm-btn" onClick={exitCompare} data-testid="compare-stop">{t('variantsUi.compareStop')}</button>
              : <button className="hm-btn primary" onClick={() => startCompare(A, B)} data-testid="compare-start">{t('variantsUi.compareStart')}</button>}
          </div>
        )}
        <p className="hm-muted">{t(env ? 'variantsUi.compareNoteEnv' : 'variantsUi.compareNote')}</p>
      </Block>
      <Block title={t('variantsUi.arrTitle')}>
        <label className="hm-field"><span>{t('variantsUi.room')}</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)} data-testid="arr-room">
            {(roomsWithContent.length ? roomsWithContent : allRooms()).map((q) => <option key={q.id} value={q.id}>{q.label} ({q.id})</option>)}
            {allRooms().filter((q) => !roomsWithContent.includes(q)).map((q) => <option key={q.id} value={q.id}>{q.label} ({q.id})</option>)}
          </select>
        </label>
      </Block>
      {r && <Arrangements room={r} />}
      <Block title={t('variantsUi.projectTitle')}>
        <p className="hm-muted">{t('variantsUi.storage', { where: target === 'file' ? t('variantsUi.storageFile', { name: fileName }) : t('variantsUi.storageBrowser') })}</p>
        <div className="hm-btn-row">
          <button className="hm-btn primary" onClick={() => void save()} data-testid="project-save"><Icon name="save" size={16} /> {t('variantsUi.saveProject')}</button>
          <button className="hm-btn" onClick={exportJson} data-testid="project-export"><Icon name="download" size={16} /> {t('variantsUi.downloadFile')}</button>
          <button className="hm-btn" onClick={() => fileRef.current?.click()} data-testid="project-import"><Icon name="upload" size={16} /> {t('variantsUi.loadFile')}</button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
      </Block>
    </div>
  );
}
