// Settings (⚙ in the top bar): for everyone — language (buttons, not a list), picture (Best · Balanced · Save battery),
// surroundings, advanced mode. Advanced mode adds the device and graphics data, snapping, eye height, the neutral interior,
// Files (the project and version files, restoring the project's furniture) and App and data (ADR 0038, 0041).
import { useRef, useState } from 'react';
import { hasCapability, hasModule } from '../../project/active';
import { AppDataSettings } from '../../pwa/PwaUi';
import { fmtM, LANGUAGES, lang, switchLang, t } from '../../i18n';
import { exportVariantFile, importVariantFile, resetFurnitureToProject, setMode } from '../actions';
import { describeGpu, detectPlatform } from '../quality/profile';
import { sceneApi } from '../scene/sceneApi';
import { importProject, save, useDesign } from '../store/design';
import { toast, ui, useQualityProfile, useUi } from '../store/ui';
import { Slot, useActionSlot } from './Action';
import { Block, Seg, Toggle } from './controls';
import { Icon } from './icons';
import { modalKeys } from './modalKeys';

function Language() {
  const a = useActionSlot('language');
  return (
    <div className="hm-field"><span>{a.label}</span>
      <div className="hm-seg wide" data-testid={a.testid} role="radiogroup" aria-label={a.label}>
        {LANGUAGES.map((l) => <button key={l.id} type="button" role="radio" aria-checked={lang() === l.id} className={lang() === l.id ? 'on' : ''} data-value={l.id}
          onClick={() => { if (l.id !== lang()) void save().finally(() => switchLang(l.id)); }}>{l.name}</button>)}
      </div>
    </div>
  );
}

type Picture = 'best' | 'balanced' | 'battery';
function PictureQuality() {
  const a = useActionSlot('picture');
  const quality = useUi((s) => s.quality), saver = useUi((s) => s.batterySaver);
  const value: Picture = saver || quality === 'low' ? 'battery' : quality === 'high' ? 'best' : 'balanced';
  const set = (v: Picture) => ui.set(v === 'best' ? { quality: 'high', batterySaver: false } : v === 'balanced' ? { quality: 'medium', batterySaver: false } : { quality: 'low', batterySaver: true });
  return <div className="hm-field"><span>{a.label}</span><Seg wide value={value} options={[['best', t('steps.pictureBest')], ['balanced', t('steps.pictureBalanced')], ['battery', t('steps.pictureBattery')]]} onChange={set} testid={a.testid} /></div>;
}

function Surroundings() {
  const a = useActionSlot('surroundings'), env = useUi((s) => s.environment);
  return a.shown ? <Toggle on={env} label={a.label} onChange={(v) => ui.set({ environment: v })} testid={a.testid} /> : null;
}

function AdvancedToggle() {
  const a = useActionSlot('advanced-toggle'), mode = useUi((s) => s.mode);
  return <Toggle on={mode === 'advanced'} label={a.label} hint={t('steps.advancedHint')} onChange={(v) => setMode(v ? 'advanced' : 'simple')} testid={a.testid} />;
}

/** the graphics card the browser renders the scene on (on a laptop with two GPUs — often the integrated one) */
function GpuInfo() {
  const r = sceneApi.renderer;
  if (!r) return null;
  const g = describeGpu(r.gpu);
  return <small className="hm-muted" data-testid="gpu-info" title={r.gpu}>{t('settings.gpu')} <b>{g.name}</b> · {r.backend}{g.software && <> · <b>{t('settings.gpuSoftware')}</b></>}</small>;
}

function Device() {
  const a = useActionSlot('device');
  const platformAuto = useUi((s) => s.platformAuto), profile = useQualityProfile();
  if (!a.shown) return null;
  return (
    <div className="hm-field"><span>{t('settings.device')}</span>
      <Seg value={platformAuto ? 'auto' : profile.platform} options={[['auto', t('settings.deviceAuto')], ['desktop', t('settings.deviceDesktop')], ['mobile', t('settings.deviceMobile')]]}
        onChange={(v) => ui.set(v === 'auto' ? { platformAuto: true, platform: detectPlatform() } : { platformAuto: false, platform: v })} testid={a.testid} />
      <small className="hm-muted" data-testid="quality-profile" data-profile={profile.id}>{t('settings.profile', { name: profile.label, dpr: profile.dpr[1] })}{profile.antialias ? '' : ` · ${t('settings.antialiasAfterReload')}`}</small>
      <GpuInfo />
    </div>
  );
}

function Neutral() {
  const a = useActionSlot('neutral-toggle'), on = useUi((s) => s.neutralInterior);
  return a.shown ? <Toggle on={on} label={t('settings.neutralInterior')} hint={t('settings.neutralInteriorHint')} onChange={(v) => ui.set({ neutralInterior: v })} testid={a.testid} /> : null;
}

function Snapping() {
  const a = useActionSlot('snap'), snap = useUi((s) => s.snap);
  if (!a.shown) return null;
  return <>
    <Toggle on={snap.enabled} label={t('settings.snap')} hint={t('settings.snapHint')} onChange={(v) => ui.set({ snap: { ...snap, enabled: v } })} testid={a.testid} />
    <div className="hm-field"><span>{t('settings.snapGrid')}</span><Seg value={snap.grid} options={[[0, t('settings.snapGridNone')], [0.05, '5 cm'], [0.1, '10 cm'], [0.25, '25 cm']]} onChange={(v) => ui.set({ snap: { ...snap, grid: v } })} testid="grid" /></div>
  </>;
}

function EyeHeight() {
  const a = useActionSlot('eye-height'), eye = useUi((s) => s.eyeHeight);
  return a.shown ? <div className="hm-field"><span>{t('settings.eyeHeight')}</span><Seg value={eye} options={[1.5, 1.6, 1.68, 1.8].map((x) => [x, fmtM(x)] as [number, string])} onChange={(v) => ui.set({ eyeHeight: v })} testid={a.testid} /></div> : null;
}

/** Files: loading a project file (downloading it is in the Download menu), a version file (export and import), the project's
 *  furniture back in every room */
function Files() {
  const a = useActionSlot('files');
  const active = useDesign((s) => (s.draft ?? s.history.present).activeVariantId), target = useDesign((s) => s.target), fileName = useDesign((s) => s.fileName);
  const projectRef = useRef<HTMLInputElement>(null), versionRef = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState(false);
  if (!a.shown) return null;
  return (
    <Block title={t('steps.files')} testid={a.testid}>
      <p className="hm-muted">{t('variantsUi.storage', { where: target === 'file' ? t('variantsUi.storageFile', { name: fileName }) : t('variantsUi.storageBrowser') })}</p>
      <div className="hm-btn-row">
        <button type="button" className="hm-btn" onClick={() => projectRef.current?.click()} data-testid="project-import"><Icon name="upload" size={16} /> {t('variantsUi.loadFile')}</button>
        <button type="button" className="hm-btn" onClick={() => exportVariantFile(active)} data-testid="variant-export"><Icon name="download" size={16} /> {t('variantsUi.exportVariant')}</button>
        <button type="button" className="hm-btn" onClick={() => versionRef.current?.click()} data-testid="variant-import"><Icon name="upload" size={16} /> {t('variantsUi.importVariant')}</button>
      </div>
      <input ref={projectRef} type="file" accept=".json,application/json" hidden data-testid="project-import-file"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const err = importProject(await f.text()); toast(err ? t('variantsUi.loadFailed', { error: err }) : t('variantsUi.loaded', { name: f.name }), err ? 'error' : 'info'); } e.target.value = ''; }} />
      <input ref={versionRef} type="file" accept=".json,application/json" hidden data-testid="variant-import-file"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) importVariantFile(await f.text()); e.target.value = ''; }} />
      {hasCapability('interiors') && (!ask
        ? <button type="button" className="hm-btn wide" onClick={() => setAsk(true)} data-testid="furniture-reset">{t('variantsUi.resetFurniture')}</button>
        : <div className="hm-confirm"><span>{t('variantsUi.resetFurnitureNote')}</span>
          <button type="button" className="hm-btn primary" onClick={() => { resetFurnitureToProject(); setAsk(false); }} data-testid="furniture-reset-confirm">{t('variantsUi.restoreFurniture')}</button>
          <button type="button" className="hm-btn ghost" onClick={() => setAsk(false)}>{t('variantsUi.cancel')}</button></div>)}
    </Block>
  );
}

function AppData() {
  const a = useActionSlot('app-data');
  return a.shown ? <AppDataSettings /> : null;
}

export function Settings() {
  const open = useUi((s) => s.settingsOpen), advanced = useUi((s) => s.mode === 'advanced');
  if (!open) return null;
  const close = () => ui.set({ settingsOpen: false });
  return (
    <div className="hm-modal-bg" onPointerDown={(e) => e.target === e.currentTarget && close()} data-testid="settings-modal">
      <div className="hm-modal" onKeyDown={modalKeys(close)}>
        <header><h2>{t('steps.settings')}</h2><button type="button" className="hm-icon-btn" onClick={close} aria-label={t('steps.close')}><Icon name="close" /></button></header>
        <Slot place="settings">
          <Language />
          <PictureQuality />
          {hasModule('environment') && <Surroundings />}
          <AdvancedToggle />
          {advanced && <section className="hm-advanced" data-testid="settings-advanced">
            <Device />
            <Neutral />
            <Snapping />
            <EyeHeight />
            <Files />
            <AppData />
          </section>}
        </Slot>
        <footer><button type="button" className="hm-btn primary" onClick={close} data-testid="settings-done">{t('steps.done')}</button></footer>
      </div>
    </div>
  );
}
