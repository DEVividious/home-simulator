// Long press on a scene object (touch and mouse): in walk mode tapping a door = open / close, holding = configuration card.
// One timer at a time; finger movement beyond the tolerance (looking around) or an early release cancels the hold.
// After a long press fires, the following "click" is ignored (longPressFired).
export const LONG_PRESS_MS = 550;
const MOVE_TOL = 9;

let timer: number | null = null, fired = false, start: [number, number] = [0, 0];
const clear = () => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };

/** after a long press fires: the click ending that gesture is swallowed window-wide. A card opened by a long press changes the
 *  screen layout (on a phone the drawer narrows the scene) — without this, lifting the finger hit a button that slid under it
 *  (e.g. "‹ Building view" ended the walk). */
let swallow = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => { if (timer !== null && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > MOVE_TOL) clear(); }, { passive: true });
  const end = () => { clear(); if (swallow) window.setTimeout(() => { swallow = false; }, 400); };
  window.addEventListener('pointerup', end, { passive: true });
  window.addEventListener('pointercancel', end, { passive: true });
  window.addEventListener('click', (e) => { if (!swallow) return; swallow = false; e.stopPropagation(); e.preventDefault(); }, true);
}

/** start of an object press: after LONG_PRESS_MS without movement or release, calls onLong */
export function pressStart(e: { clientX: number; clientY: number }, onLong: () => void) {
  clear();
  fired = false;
  start = [e.clientX, e.clientY];
  timer = window.setTimeout(() => { timer = null; fired = true; swallow = true; onLong(); }, LONG_PRESS_MS);
}
/** whether the event concerns the NEAREST hit object (R3F delivers the event to every object on the ray — including those behind
 *  a wall or on the other side of the building; only the object actually visible under the finger acts) */
export function isNearest(e: { object: unknown; intersections: { object: unknown }[] }): boolean {
  // R3F also hits invisible objects (debug layers of the building model: bounding boxes, levels, opening outlines) — skipped;
  // the door hit area has an invisible material but a visible object
  const first = e.intersections.find((i) => shown(i.object as Obj));
  return !first || first.object === e.object;
}
type Obj = { visible: boolean; parent: Obj | null };
const shown = (o: Obj | null): boolean => !o || (o.visible && shown(o.parent));
type Mat = { transparent?: boolean; opacity?: number; transmission?: number };
/** glass: a material with transmission (high profile) or transparent with low opacity (other profiles) — what is behind it shows through */
const seeThrough = (o: { material?: Mat | Mat[] }): boolean => {
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  return !!m && ((m.transmission ?? 0) > 0 || (m.transparent === true && (m.opacity ?? 1) < 0.6));
};
/**
 * Like isNearest, but GLASS in front of the object does not hide it. Furniture seen through glazing — the room view camera
 * behind a wall with patio doors — is visible, so it can be grabbed and moved; a wall drawn in front of the furniture still
 * hides it (furniture behind it does not react — previously it could be grabbed "through the wall").
 */
export function isNearestSolid(e: { object: unknown; intersections: { object: unknown }[] }): boolean {
  const first = e.intersections.find((i) => shown(i.object as Obj) && !seeThrough(i.object as { material?: Mat | Mat[] }));
  return !first || first.object === e.object;
}

/** whether the last press ended as a long press (the click after it should be ignored) */
export const longPressFired = () => fired;
