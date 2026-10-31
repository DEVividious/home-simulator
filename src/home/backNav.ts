// System "back" on a phone: what to close first before the user leaves the app. One call = one
// step; returns false when there is nothing left to close. Steps that have an action in the registry run it (ADR 0037).
// Order: dialog (settings, welcome, menu) → expanded sheet → selection (card) → sheet → comparison → walk → room → level section.
import { homeViewId } from './model/views';
import { elFocusRoom, exitCompare, goSection, setElView } from './actions';
import { cancelPlace, placeNow } from './store/elPlace';
import { exitWalk, ui } from './store/ui';
import { runAction } from './ui/registry';

export function backStep(dry = false): boolean {
  const s = ui.get();
  const act = (fn: () => void) => { if (!dry) fn(); return true; };
  // ELECTRICAL mode: placing → panel → selection → eye-level view → room → leaving the mode (to the Home section)
  if (s.section === 'electrical' && !s.compare) {
    if (placeNow()) return act(cancelPlace);
    if (s.elPanel) return act(() => ui.set({ elPanel: null }));
    if (s.settingsOpen) return act(() => ui.set({ settingsOpen: false }));
    if (s.selection) return act(() => ui.set({ selection: null, elMore: false }));
    if (s.elView === 'walk') return act(() => setElView('3d'));
    if (s.roomId) return act(() => elFocusRoom(null));
    return act(() => goSection('look'));
  }
  if (s.settingsOpen) return act(() => ui.set({ settingsOpen: false }));
  if (!s.onboardingDone) return act(() => ui.set({ onboardingDone: true }));
  if (s.menu) return act(() => ui.set({ menu: null }));
  if (s.sheet === 'expanded') return act(() => ui.set({ sheet: 'medium' }));
  if (s.selection) return act(() => runAction('card-close'));
  if (s.sheet === 'medium') return act(() => ui.set({ sheet: 'collapsed' }));
  if (s.compare) return act(exitCompare);
  if (s.roomId && s.roomView === 'walk') return act(() => runAction('view-around'));
  if (s.houseView === 'walk' && !s.roomId) return act(exitWalk);
  if (s.roomId) return act(() => runAction('scene-back'));
  if (s.houseView === 'interior') return act(() => ui.set({ houseView: 'exterior', camera: { preset: homeViewId(), n: s.camera.n + 1 } }));
  return false;
}
