// Edit history (undo / redo) — immutable state snapshots. A drag creates ONE entry (commit on pointerUp); intermediate frames
// are a working state (draft) outside the history.

export interface Entry<T> {
  state: T;
  label: string; // what the operation that followed this state did (e.g. "move: armchair")
}

export interface History<T> {
  past: Entry<T>[];
  present: T;
  presentLabel: string; // label of the operation that led to present
  future: Entry<T>[];
}

export const HISTORY_LIMIT = 200;

export const initHistory = <T,>(state: T): History<T> => ({ past: [], present: state, presentLabel: '', future: [] });

/** the new state after an operation; an identical state (by the comparison) creates no entry */
export function commit<T>(h: History<T>, next: T, label: string, same: (a: T, b: T) => boolean = (a, b) => a === b): History<T> {
  if (same(h.present, next)) return h;
  const past = [...h.past, { state: h.present, label: h.presentLabel }];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, presentLabel: label, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev.state, presentLabel: prev.label, future: [{ state: h.present, label: h.presentLabel }, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const next = h.future[0];
  return { past: [...h.past, { state: h.present, label: h.presentLabel }], present: next.state, presentLabel: next.label, future: h.future.slice(1) };
}

export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;
/** labels for button tooltips */
export const undoLabel = <T,>(h: History<T>) => (h.past.length ? h.presentLabel : '');
export const redoLabel = <T,>(h: History<T>) => (h.future.length ? h.future[0].label : '');
