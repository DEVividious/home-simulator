// The top bar (ADR 0036, 0041, 0044): the house name (▾ a project switch when more than one is installed), the steps Look ·
// Arrange · Versions (+ Electrical and Expert in advanced mode), undo / redo, the save status, the Download menu, help and the
// settings. On a phone the steps sit at the bottom of the screen (the same component, placed by CSS).
import { project, projectId } from '../../project/active';
import { projectEntry, projectIds, switchProject } from '../../project/registry';
import { useEffect, useRef } from 'react';
import { save, useDesign } from '../store/design';
import { ui, useUi } from '../store/ui';
import { ActionButton, Slot, useActionSlot } from './Action';
import { Icon } from './icons';
import { t } from '../../i18n';

/** the house name; with more than one project installed it is a picker (switching saves first and reloads the page) */
function Brand() {
  const ids = projectIds(), cur = projectId(), name = project().manifest.name;
  return (
    <div className="hm-brand">
      <Icon name="house" size={22} />
      {ids.length > 1 ? <ProjectPicker ids={ids} cur={cur} /> : <b className="hm-brand-name">{name}</b>}
    </div>
  );
}
function ProjectPicker({ ids, cur }: { ids: string[]; cur: string }) {
  const a = useActionSlot('project');
  return (
    <label className="hm-brand-pick">
      <select value={cur} data-testid={a.testid} aria-label={a.label} onChange={(e) => { const id = e.target.value; void save().finally(() => switchProject(id)); }}>
        {ids.map((id) => <option key={id} value={id}>{projectEntry(id)?.name ?? id}</option>)}
      </select>
      <Icon name="chevron" size={14} />
    </label>
  );
}

/** the save status: "Saved ✓ / Saving… / On this phone"; a button only when the design is not in the file yet (ADR 0041) */
function SaveStatus() {
  const a = useActionSlot('save');
  const target = useDesign((s) => s.target), onDevice = useDesign((s) => s.sync.pending || (s.sync.offline && s.target === 'file'));
  if (!a.shown) return null;
  return (
    <button type="button" className={`hm-save${a.text === t('steps.save.failed') ? ' failed' : ''}${onDevice ? ' device' : ''}`} disabled={!a.enabled} onClick={() => a.run()}
      data-testid={a.testid} data-sync={onDevice ? 'device' : target === 'file' ? 'file' : 'local'}>
      <Icon name={a.text === t('steps.save.failed') ? 'warn' : 'check'} size={16} /><span>{a.text}</span>
    </button>
  );
}

/** the Download menu: Picture, Print model, Project file (advanced) */
function DownloadMenu() {
  const open = useUi((s) => s.menu === 'download');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) ui.set({ menu: null }); };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  return (
    <div className={`hm-menu${open ? ' open' : ''}`} ref={ref} role="menu" data-testid="download-menu" hidden={!open}>
      <Slot place="menu.download">
        <ActionButton id="download-picture" size={20} />
        <ActionButton id="download-print" size={20} />
        <ActionButton id="download-project" size={20} />
      </Slot>
    </div>
  );
}

export function TopBar() {
  return (
    <header className="hm-top">
      <Slot place="topbar">
        <Brand />
        <nav className="hm-steps" data-testid="steps" data-bar="steps">
          <ActionButton id="step-look" size={20} />
          <ActionButton id="step-arrange" size={20} />
          <ActionButton id="step-variants" size={20} />
          <ActionButton id="step-electrical" size={20} />
          <ActionButton id="step-expert" size={20} />
        </nav>
        <div className="hm-tools" data-bar="tools">
          <ActionButton id="undo" className="hm-icon-btn" />
          <ActionButton id="redo" className="hm-icon-btn" />
          <SaveStatus />
          <div className="hm-menu-wrap">
            <ActionButton id="download" className="hm-tool" />
            <DownloadMenu />
          </div>
          <ActionButton id="help" className="hm-tool" />
          <ActionButton id="settings" className="hm-tool" />
        </div>
      </Slot>
    </header>
  );
}
