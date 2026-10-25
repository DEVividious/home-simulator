// PWA UI in the Home app: the update notice (switching only after the user's decision and after saving), the version choice on
// a conflict between the project file and the device, the "App and data" section in Settings (offline mode, installation,
// storage, backups).
import { useEffect, useState } from 'react';
import { fmtNum, t } from '../i18n';
import { chooseVersion, isDirty, replaceProjectFile, restoreBackup, useDesign } from '../home/store/design';
import { toast, ui } from '../home/store/ui';
import { Icon } from '../home/ui/icons';
import { requestPersistence, storageInfo } from '../storage/assets';
import { listBackups, type ProjectBackup } from '../storage/project';
import { applyUpdate, checkUpdate, promptInstall, usePwa } from './register';

const MB = (b: number | null) => (b === null ? '—' : b < 1048576 ? `${Math.round(b / 1024)} kB` : `${fmtNum(b / 1048576, b < 10485760 ? 1 : 0)} MB`);
const when = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** update banner: a new version is waiting; the button saves the project and only then switches */
export function PwaUpdateBanner() {
  const waiting = usePwa((s) => s.waiting), dirty = useDesign(isDirty);
  const [later, setLater] = useState(false), [busy, setBusy] = useState(false);
  if (!waiting || later) return null;
  return (
    <div className="hm-pwa-update" role="status" data-testid="pwa-update">
      <span><b>{t('pwa.updateReady')}</b> {dirty ? t('pwa.updateWillSave') : t('pwa.updateWillRestart')}</span>
      <button className="hm-btn" onClick={() => setLater(true)} data-testid="pwa-update-later">{t('pwa.later')}</button>
      <button className="hm-btn primary" disabled={busy} onClick={() => { setBusy(true); void applyUpdate(); }} data-testid="pwa-update-apply">{dirty ? t('pwa.saveAndUpdate') : t('pwa.update')}</button>
    </div>
  );
}

/** conflict: the project changed independently on the PC (file) and on this device — the user's choice, nothing is lost */
export function ProjectConflict() {
  const conflict = useDesign((s) => s.sync.conflict), file = useDesign((s) => s.fileName), problem = useDesign((s) => s.sync.problem);
  const [busy, setBusy] = useState(false), [left, setLeft] = useState<string | null>(null);
  // the project file exists but this app cannot read it (damaged, or with an entry it does not know) — it is not a "missing
  // file": nothing replaces it until the user chooses so; "Leave the file" hides the dialog until the next start
  if (problem && !conflict && left !== problem) return (
    <div className="hm-modal-bg" data-testid="project-unreadable">
      <div className="hm-modal" role="alertdialog" aria-label={t('pwa.unreadableTitle')}>
        <header><h2>{t('pwa.unreadableTitle')}</h2></header>
        <p>{t('pwa.unreadableIntro', { file })}</p>
        <p className="hm-muted" data-testid="project-unreadable-why">{problem}</p>
        <p>{t('pwa.unreadableFile')} <b>{t('pwa.unreadableNotChanged')}</b>{t('pwa.unreadableBody')}</p>
        <div className="hm-btn-row">
          <button className="hm-btn primary" disabled={busy} onClick={() => setLeft(problem)} data-testid="unreadable-keep">{t('pwa.unreadableKeep')}</button>
          <button className="hm-btn" disabled={busy} onClick={() => { setBusy(true); void replaceProjectFile().finally(() => setBusy(false)); }} data-testid="unreadable-replace">{t('pwa.unreadableReplace')}</button>
        </div>
        <p className="hm-muted">{t('pwa.unreadableNote')}</p>
      </div>
    </div>
  );
  if (!conflict) return null;
  const pick = (c: 'device' | 'server') => { setBusy(true); void chooseVersion(c).finally(() => setBusy(false)); };
  return (
    <div className="hm-modal-bg" data-testid="project-conflict">
      <div className="hm-modal" role="alertdialog" aria-label={t('pwa.conflictTitle')}>
        <header><h2>{t('pwa.conflictTitle')}</h2></header>
        <p>{t('pwa.conflictChanged')} <b>{t('pwa.conflictOnDevice')}</b> {t('pwa.conflictAndIndependently')} <b>{t('pwa.conflictInFile')}</b> {t('pwa.conflictBody', { file })}</p>
        <div className="hm-btn-row">
          <button className="hm-btn primary" disabled={busy} onClick={() => pick('device')} data-testid="conflict-device">{t('pwa.conflictKeepDevice')}</button>
          <button className="hm-btn" disabled={busy} onClick={() => pick('server')} data-testid="conflict-server">{t('pwa.conflictLoadFile')}</button>
        </div>
      </div>
    </div>
  );
}

/** Settings → App and data */
export function AppDataSettings() {
  const s = usePwa((x) => x), sync = useDesign((x) => x.sync), target = useDesign((x) => x.target);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageInfo>> | null>(null), [backups, setBackups] = useState<ProjectBackup[] | null>(null);
  const refresh = () => { void storageInfo().then(setInfo); void listBackups().then(setBackups); };
  useEffect(refresh, []);
  const offlineText = !s.supported ? t('pwa.offlineUnsupported') : !s.enabled ? t('pwa.offlineDisabled') : s.ready ? t('pwa.offlineReady', { n: s.files }) : t('pwa.offlinePreparing');
  const projectText = sync.conflict ? t('pwa.projectConflict') : sync.problem ? t('pwa.projectUnreadable', { problem: sync.problem }) : sync.pending ? t('pwa.projectPending') : target === 'file' ? t('pwa.projectInFile') : t('pwa.projectOnDevice');
  return (
    <section className="hm-appdata" data-testid="app-data">
      <h3>{t('pwa.appData')}</h3>
      <dl className="hm-kv">
        <dt>{t('pwa.offlineMode')}</dt><dd data-testid="pwa-offline-state" data-ready={s.ready ? '1' : '0'}>{offlineText}</dd>
        <dt>{t('pwa.project')}</dt><dd data-testid="pwa-project-state" data-pending={sync.pending ? '1' : '0'}>{projectText}{sync.device === 'fallback' ? t('pwa.fallbackStorage') : ''}</dd>
        <dt>{t('pwa.version')}</dt><dd data-testid="pwa-build">{s.build ?? '—'}{s.standalone ? t('pwa.installedApp') : t('pwa.browserTab')}</dd>
        <dt>{t('pwa.storage')}</dt><dd data-testid="pwa-storage">{info ? `${t('pwa.storageUsage', { usage: MB(info.usage), quota: MB(info.quota) })}${info.assets ? `${t('pwa.ownFiles', { n: info.assets, size: MB(info.assetBytes) })}${info.pending ? t('pwa.toUpload', { n: info.pending }) : ''}` : ''}${info.persisted ? t('pwa.dataProtected') : ''}` : '…'}</dd>
      </dl>
      <div className="hm-btn-row">
        {s.canInstall && <button className="hm-btn" onClick={() => void promptInstall()} data-testid="pwa-install"><Icon name="download" size={15} /> {t('pwa.install')}</button>}
        {s.enabled && <button className="hm-btn" disabled={s.checking} onClick={() => void checkUpdate().then((u) => { if (!u) toast(t('pwa.upToDate')); })} data-testid="pwa-check">{s.checking ? t('pwa.checking') : t('pwa.checkUpdate')}</button>}
        {s.waiting && <button className="hm-btn primary" onClick={() => { ui.set({ settingsOpen: false }); void applyUpdate(); }} data-testid="pwa-apply">{t('pwa.updateNow')}</button>}
        {info && info.persisted === false && <button className="hm-btn" onClick={() => void requestPersistence().then((ok) => { toast(ok ? t('pwa.persistGranted') : t('pwa.persistDenied')); refresh(); })} data-testid="pwa-persist">{t('pwa.protectData')}</button>}
      </div>
      {!s.standalone && !s.canInstall && s.ready && <p className="hm-muted">{t('pwa.installHint')}</p>}
      {backups && backups.length > 0 && <>
        <h4>{t('pwa.backups')}</h4>
        <div className="hm-col" data-testid="pwa-backups">
          {backups.map((b) => (
            <div key={b.id} className="hm-row"><span className="hm-row-main"><span>{b.label}</span><small>{when(b.savedAt)} · {MB(b.bytes)}</small></span>
              <button className="hm-link" onClick={() => { const e = restoreBackup(b.text, b.label); toast(e ? t('pwa.restoreFailed', { error: e }) : t('pwa.restored'), e ? 'error' : 'info'); if (!e) ui.set({ settingsOpen: false }); }} data-testid="pwa-restore">{t('pwa.restore')}</button></div>
          ))}
        </div>
      </>}
    </section>
  );
}
