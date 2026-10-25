// AUTOSAVE to the project file shortly after a change (the working copy on the device is written always, on every change —
// store/design.ts). Kept separate from HomeApp so that it can be tested without the UI.
import { sceneApi } from '../scene/sceneApi';
import { design, isDirty, save } from './design';

/** autosave delay after the last change [ms] */
export const AUTOSAVE = { delayMs: 1800 };

/** starts autosave; returns a function that stops it */
export function startAutosave(): () => void {
  let h: ReturnType<typeof setTimeout> | null = null;
  // The document whose save was REFUSED (server error, file too large, no space on the device). The end of a save itself changes
  // the state, so without this memory a refused save would trigger the next one — the same document would go to the server every
  // 1.8 s, each time with an error message. After a refusal: the next attempt on the next document change or a manual "Save"; the
  // change waits on the device (pending) and the sync loop (HomeApp, every 30 s) retries it quietly — once delivered, autosave
  // settles the state.
  let refused: unknown = null;
  const off = design.subscribe(() => {
    if (h) clearTimeout(h);
    h = setTimeout(() => {
      const s = design.get(), d = s.history.present;
      if (!s.loaded || s.saving || s.draft || !isDirty(s) || sceneApi.locked || (d === refused && s.sync.pending)) return;
      void save({ silent: true }).then((ok) => { refused = ok ? null : d; });
    }, AUTOSAVE.delayMs);
  });
  return () => { off(); if (h) clearTimeout(h); };
}
