// USER DESIGN STATE — single source of truth: the project document (ConfiguratorDoc) with undo / redo history, stored in
// userdata/<id>/document.json on the PC (save server) and on the device (IndexedDB).
// Every user operation = commit(label, fn) = one history entry; dragging updates the scene locally and stores the state only
// on release (one entry). Every change is also written to the device copy.
import { normalizeDocMounted } from '../model/mountedFurniture';
import { projectId } from '../../project/active';
import { projectFile } from '../../project/registry';
import { defaultDoc, parseDoc, serializeDoc, type ConfiguratorDoc, type Variant } from '../../document/model';
import { adoptServer, fileBaseHash, loadDoc, onSyncStatus, peekServer, replaceUnreadable, resolveConflict, saveDoc, syncPending, syncStatus, writeLocal, type StorageTarget, type SyncStatus } from '../../document/store';
import { hashText } from '../../storage/project';
import { canRedo, canUndo, commit as hCommit, initHistory, redo as hRedo, redoLabel, undo as hUndo, undoLabel, type History } from '../../history/history';
import { setImportedAssets } from '../catalog/providers';
import { activeArrangement, defaultInterior, withActive, withInterior } from '../model/interiors';
import type { Arrangement, RoomInterior } from '../model/types';
import { derivedByKey } from '../../project/active';
import { createStore, useStore } from './createStore';
import { t } from '../../i18n';
// Undo / Redo keep the selection valid (selectionAfterJump): the UI store does not import the project store — no cycle
import { resolvePlan } from '../model/electrical';
import { allRooms } from '../model/rooms';
import { extrasOf } from '../model/variantData';
import { ui, type Selection } from './ui';

export const sameDoc = (a: ConfiguratorDoc, b: ConfiguratorDoc) => a === b || serializeDoc(a) === serializeDoc(b);

export interface DesignState {
  history: History<ConfiguratorDoc>;
  saved: string | null; // serialization of the last saved document
  loaded: boolean;
  target: StorageTarget;
  fileName: string;
  saving: boolean;
  /** live preview (slider while dragging) — outside the history; committing = one entry */
  draft: ConfiguratorDoc | null;
  /** change counter (for refreshes that depend on the document) */
  rev: number;
  /** save state relative to the project file — offline, pending changes, version conflict, device storage location */
  sync: SyncStatus;
}

export const design = createStore<DesignState>({ history: initHistory(defaultDoc()), saved: null, loaded: false, target: 'localStorage', fileName: '', saving: false, draft: null, rev: 0, sync: { offline: false, pending: false, conflict: false, device: null, problem: null } });
onSyncStatus((sync) => { const c = design.get().sync; if (c.offline !== sync.offline || c.pending !== sync.pending || c.conflict !== sync.conflict || c.device !== sync.device || c.problem !== sync.problem) design.set({ sync }); });

type Notify = (text: string, level?: 'info' | 'warn' | 'error') => void;
let notify: Notify = () => {};
export const setNotifier = (fn: Notify) => { notify = fn; };

export async function loadDesign() {
  const l = await loadDoc({ conflicts: 'ask' });
  // saved = the project file version (or the loaded document): changes made offline show as unsaved and reach the file on save
  // wall-mounted objects: the world position follows from the mounting record (source of truth) — recomputed after loading, not a user change
  design.set({ history: initHistory(normalizeDocMounted(l.doc)), saved: l.savedText, loaded: true, target: l.target, fileName: l.file ?? projectFile(projectId()), rev: design.get().rev + 1, sync: l.sync });
  if (l.warning) notify(l.warning, 'warn');
  if (l.target === 'localStorage' && l.sync.device) notify(t('design.offlineOpened'));
}

/** back to the tab: when the project file was changed by another tool (e.g. Window Editor) and there are no unsaved changes here — reload */
export async function refreshFromFile(): Promise<boolean> {
  const s = design.get();
  if (!s.loaded || s.saving || s.draft || s.target !== 'file' || isDirty(s)) return false;
  if (s.sync.pending || s.sync.conflict || s.sync.problem) return false;
  // Merely CHECKING the file does not change the sync state: the base version must not move before it is known whether the
  // file will be adopted — otherwise a change made right after returning to the tab would overwrite another save without a conflict.
  const peek = await peekServer().catch(() => null);
  if (!peek || peek.text === null) return false;
  const cur = design.get();
  if (peek.text === cur.saved || isDirty(cur) || cur.saving || cur.draft || cur.sync.pending || cur.sync.conflict) return false;
  let doc: ConfiguratorDoc;
  try { doc = parseDoc(peek.text); } catch { return false; }
  // adopting the file and replacing the document in the same step (no waiting in between)
  void adoptServer(peek.text);
  design.set({ history: initHistory(normalizeDocMounted(doc)), saved: peek.text, rev: cur.rev + 1, sync: syncStatus() });
  notify(t('design.reloadedFromOtherTool'));
  return true;
}

/** the document shown in the scene: the preview (while dragging a slider) or the state from the history */
export const docOf = (s: DesignState) => s.draft ?? s.history.present;
export const variantOf = (s: DesignState): Variant => { const d = docOf(s); return d.variants.find((v) => v.id === d.activeVariantId) ?? d.variants[0]; };

/** document change — one history entry; false when nothing changed */
export function commit(label: string, fn: (d: ConfiguratorDoc) => ConfiguratorDoc | null): boolean {
  const s = design.get(), cur = s.history.present, next = fn(cur);
  if (!next || next === cur || sameDoc(next, cur)) { if (s.draft) design.set({ draft: null, rev: s.rev + 1 }); return false; }
  design.set({ history: hCommit(s.history, next, label, sameDoc), draft: null, rev: s.rev + 1 });
  writeLocal(next);
  return true;
}

/** live preview: always computed from the history state (no entry); commit(label, fn) or cancelPreview() ends it */
export function preview(fn: (d: ConfiguratorDoc) => ConfiguratorDoc | null) {
  const s = design.get(), next = fn(s.history.present);
  design.set({ draft: next && next !== s.history.present ? next : null, rev: s.rev + 1 });
}
export const cancelPreview = () => { if (design.get().draft) design.set((s) => ({ draft: null, rev: s.rev + 1 })); };

/**
 * Selection after a history jump (Undo / Redo). The selection lives outside the document, so after undoing an addition or a
 * transfer it could point at an object that is no longer there: an empty side panel, with Delete / arrows / Ctrl+D hitting
 * nothing. Furniture moved back into another room stays selected where it is again; furniture or a device missing from the
 * document — selection cleared. Other kinds of selection do not depend on the history.
 */
function selectionAfterJump(s: DesignState, sel: Selection): Selection {
  if (sel?.kind === 'furniture') {
    const holds = (roomId: string) => arrangementOf(s, roomId).furniture.some((f) => f.id === sel.id);
    if (holds(sel.roomId)) return sel;
    const room = allRooms().find((r) => holds(r.id));
    return room ? { kind: 'furniture', roomId: room.id, id: sel.id } : null;
  }
  if (sel?.kind === 'electrical') return resolvePlan(docOf(s).electrical, extrasOf(variantOf(s)).electrical).points.some((p) => p.id === sel.id) ? sel : null;
  return sel;
}
const keepSelectionLive = () => { const sel = ui.get().selection, live = selectionAfterJump(design.get(), sel); if (live !== sel) ui.set({ selection: live }); };

export function undo() {
  const s = design.get();
  if (!canUndo(s.history)) return false;
  const label = undoLabel(s.history);
  design.set({ history: hUndo(s.history), draft: null, rev: s.rev + 1 });
  keepSelectionLive();
  writeLocal(design.get().history.present);
  notify(t('design.undone', { label: label || t('design.changeFallback') }));
  return true;
}
export function redo() {
  const s = design.get();
  if (!canRedo(s.history)) return false;
  const label = redoLabel(s.history);
  design.set({ history: hRedo(s.history), draft: null, rev: s.rev + 1 });
  keepSelectionLive();
  writeLocal(design.get().history.present);
  notify(t('design.redone', { label: label || t('design.changeFallback') }));
  return true;
}

/** project save (the project file via the server, or browser storage); silent — autosave without a success message */
export async function save(opts: { silent?: boolean } = {}): Promise<boolean> {
  const s = design.get(), d = s.history.present;
  design.set({ saving: true });
  const r = await saveDoc(d, s.target);
  design.set({ saving: false, sync: syncStatus(), ...(r.ok ? { saved: serializeDoc(d) } : {}) });
  if (!r.ok || !opts.silent) notify(r.ok ? (r.local ? r.message : t('design.saved')) : r.message, r.ok ? 'info' : 'error');
  return r.ok;
}

/** when the connection returns: changes saved on the device go to the project file (or a version conflict is detected) */
export async function syncNow(): Promise<void> {
  const s = design.get();
  if (!s.loaded || s.saving || (!s.sync.pending && !s.sync.offline)) return;
  const r = await syncPending();
  // the delivered content is from now on the saved version — otherwise, after a previously rejected save, the state would stay "unsaved" although the file already has it
  const text = r === 'synced' ? serializeDoc(design.get().history.present) : null;
  design.set({ sync: syncStatus(), ...(text !== null && hashText(text) === fileBaseHash() ? { saved: text } : {}), ...(r === 'synced' && s.target !== 'file' ? { target: 'file' as StorageTarget } : {}) });
  if (r === 'synced') notify(t('design.deviceChangesSynced'));
}
/** version choice on a conflict: 'device' — the device version stays (the save will overwrite the file), 'server' — load the file version */
export async function chooseVersion(choice: 'device' | 'server'): Promise<void> {
  const doc = await resolveConflict(choice);
  if (doc) { const text = serializeDoc(doc); design.set({ history: initHistory(doc), saved: text, draft: null, rev: design.get().rev + 1, sync: syncStatus() }); notify(t('design.keptFileVersion')); return; }
  design.set({ sync: syncStatus() });
  await save({ silent: true });
  notify(t('design.keptDeviceVersion'));
}
/** a project file the app cannot read: deliberately replacing it with the project open on this device (a copy of the file is kept aside) */
export async function replaceProjectFile(): Promise<void> {
  const d = design.get().history.present;
  design.set({ saving: true });
  const r = await replaceUnreadable(d);
  design.set({ saving: false, sync: syncStatus(), ...(r.ok ? { saved: serializeDoc(d), target: 'file' as StorageTarget } : {}) });
  notify(r.ok ? (r.backup ? t('design.fileReplacedBackup', { backup: r.backup }) : t('design.fileReplaced')) : r.message, r.ok ? 'info' : 'error');
}
/** restoring a backup as a regular change (Undo returns to the state before) */
export function restoreBackup(text: string, label: string): string | null {
  try { const d = parseDoc(text); commit(t('history.restoreBackup', { label }), () => d); return null; } catch (e) { return (e as Error).message; }
}

export const isDirty = (s: DesignState) => s.saved !== null && s.saved !== serializeDoc(s.history.present);
export const exportProject = () => serializeDoc(design.get().history.present);
export function importProject(text: string): string | null {
  try {
    const d = parseDoc(text);
    commit(t('history.importProject'), () => d);
    return null;
  } catch (e) { return (e as Error).message; }
}

// ------------------------------------------------------------------ domain helper operations
export const withActiveVariant = (d: ConfiguratorDoc, fn: (v: Variant) => Variant): ConfiguratorDoc => {
  const v = d.variants.find((x) => x.id === d.activeVariantId)!, n = fn(v);
  return n === v ? d : { ...d, variants: d.variants.map((x) => (x.id === v.id ? n : x)) };
};

/** change of a room interior in the active variant */
export const updateInterior = (roomId: string, label: string, fn: (ri: RoomInterior) => RoomInterior) =>
  commit(label, (d) => withActiveVariant(d, (v) => { const i = withInterior(v.interiors ?? {}, roomId, fn); return i === v.interiors ? v : { ...v, interiors: i }; }));

/** the document after a change of the room's active arrangement (pure function — commit or preview) */
export const withArrangementDoc = (d: ConfiguratorDoc, roomId: string, fn: (a: Arrangement) => Arrangement): ConfiguratorDoc =>
  withActiveVariant(d, (v) => { const i = withInterior(v.interiors ?? {}, roomId, (ri) => withActive(ri, fn)); return i === v.interiors ? v : { ...v, interiors: i }; });

/** change of the room's active arrangement */
export const updateArrangement = (roomId: string, label: string, fn: (a: Arrangement) => Arrangement) => commit(label, (d) => withArrangementDoc(d, roomId, fn));
/** preview of an arrangement change (slider) — no history entry */
export const previewArrangement = (roomId: string, fn: (a: Arrangement) => Arrangement) => preview((d) => withArrangementDoc(d, roomId, fn));

export const updateVariant = (label: string, fn: (v: Variant) => Variant) => commit(label, (d) => withActiveVariant(d, fn));

// ------------------------------------------------------------------ selectors (stable references)
export const useDesign = <T,>(sel: (s: DesignState) => T) => useStore(design, sel);
export const useVariant = () => useDesign(variantOf);
export const useDoc = () => useDesign(docOf);
export function useRoomInterior(roomId: string | null): RoomInterior | null {
  const interiors = useDesign((s) => variantOf(s).interiors);
  return roomId ? interiors?.[roomId] ?? null : null;
}
// a room without a stored interior: a constant (cached) default arrangement — selectors return stable references
const defaultInteriorOf = derivedByKey((roomId: string): RoomInterior => defaultInterior(roomId));
export function stableInterior(interiors: Record<string, RoomInterior> | undefined, roomId: string): RoomInterior {
  return interiors?.[roomId] ?? defaultInteriorOf(roomId);
}
/** the room's active arrangement (the default one when the room has no interior yet) */
export function arrangementOf(s: DesignState, roomId: string): Arrangement {
  return activeArrangement(stableInterior(variantOf(s).interiors, roomId));
}
export const interiorOfRoom = (s: DesignState, roomId: string) => stableInterior(variantOf(s).interiors, roomId);
export const useArrangement = (roomId: string) => useDesign((s) => arrangementOf(s, roomId));

// registry of imported models (catalogue items) — always in line with the document
design.subscribe(() => setImportedAssets(docOf(design.get()).importedAssets ?? []));
