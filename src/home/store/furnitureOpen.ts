// Opening of moving furniture parts (e.g. a door leaf flush with built-in units) — VIEW state, like interior doors: it goes
// neither into the project nor into the Undo history. Key = the furniture item id in the arrangement.
import { createStore, useStore } from './createStore';

export const furnitureOpen = createStore<{ open: Record<string, boolean> }>({ open: {} });
export const useFurnitureOpen = (id: string | undefined) => useStore(furnitureOpen, (s) => (id ? !!s.open[id] : false));
export const isFurnitureOpen = (id: string) => !!furnitureOpen.get().open[id];
export const setFurnitureOpen = (id: string, open: boolean) => furnitureOpen.set((s) => ({ open: { ...s.open, [id]: open } }));
export const toggleFurnitureOpen = (id: string) => setFurnitureOpen(id, !isFurnitureOpen(id));
