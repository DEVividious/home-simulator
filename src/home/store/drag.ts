// Transient scene interaction state (outside the project and history): the furniture item being dragged / rotated (preview
// until mouse release), snap lines, the preview of an item dragged from the catalogue, the drag pointer over the UI.
// Per-frame changes are subscribed only by the dragged item and the guide layer — the rest of the UI does not re-render.
import type { FurnitureWarning } from '../model/collision';
import type { MountGuide } from '../model/mountDrag';
import type { SnapGuide } from '../model/snapping';
import { createStore, useStore } from './createStore';

export interface ItemDraft { roomId: string; id: string; x: number; y: number; rot: number; mode: 'move' | 'rotate'; /** wall-mounted object: bottom height while dragging */ elevation?: number }
/** wall-mounted object while dragging: surface, position on it, read-out for the user, alignment guides */
export interface MountDraft {
  id: string;
  surfaceId: string;
  u: number; v: number;
  /** distance of the object axis from the nearer wall corner and which corner it is (looking from the room), bottom height [m] */
  along: number; from: 'left' | 'right'; height: number;
  guides: MountGuide[];
  /** the surface the object will move to when the pointer goes further (hint) */
  candidate: string | null;
  /** pointer position on screen (dimension badge) */
  screen: [number, number];
  touch: boolean;
}
export interface Ghost { roomId: string; catalogId: string; variant: string | null; x: number; y: number; rot: number; /** wall-mounted object: bottom height on the wall under the pointer (the catalogue default limited to the wall) */ elevation?: number; warnings: FurnitureWarning[] }
export interface CatalogPointer { catalogId: string; variant: string | null; name: string; thumb: string; x: number; y: number; started: boolean }

export interface DragState {
  item: ItemDraft | null;
  guides: SnapGuide[];
  ghost: Ghost | null;
  catalog: CatalogPointer | null;
  /** furniture warnings while dragging (live) */
  warnings: FurnitureWarning[];
  mount: MountDraft | null;
}

export const drag = createStore<DragState>({ item: null, guides: [], ghost: null, catalog: null, warnings: [], mount: null });
export const useDrag = <T,>(sel: (s: DragState) => T) => useStore(drag, sel);
