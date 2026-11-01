// The bars of a gable window while the user drags one in its card (transient): the scene draws them at once, the variant gets
// them when the drag ends (one undo step).
import type { Layout } from '../model/glazing';
import { createStore, useStore } from './createStore';

export const glazingDraft = createStore<{ group: string | null; layout: Layout | null }>({ group: null, layout: null });
/** the dragged layout of a glazing, or null */
export const useGlazingDraft = (group: string) => useStore(glazingDraft, (s) => (s.group === group ? s.layout : null));
