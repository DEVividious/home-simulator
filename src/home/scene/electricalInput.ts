// 3D scene input of ELECTRICAL mode (3D and eye-level view). One set of pointer events on the canvas element (capture phase —
// before camera control and scene object events):
//  • devices are hit IN SCREEN SPACE (hit area ≥ 44 px on touch) — not by raycasting a small mesh;
//  • pressing a device + moving = DRAGGING (camera locked during the move — dragging takes priority over camera rotation);
//    a plain tap = selection; the ↕ handle above the selected device = height change;
//  • placement mode (new / copy / "Move"): mouse — the preview follows the cursor, a click places; finger — the preview follows
//    the finger and is shifted ABOVE it (does not hide the mounting spot), release places; in walk mode — a tap.
// The place under the pointer is computed by model/elPlacement.ts (camera ray → wall face / floor), move state — store/elPlace.ts.
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { planNow } from '../actions';
import { DEVICES } from '../model/devices';
import { layerOf, measure, type ElType } from '../model/electrical';
import { surfaceFromRay, type Surface, type WallRef } from '../model/elPlacement';
import { allLevels } from '../model/rooms';
import type { Vec3 } from '../model/types';
import { beginHeight, beginMove, cancelPlace, commitPlace, currentWall, dragTo, mountDragging, placeAt, placeNow, reanchorDrag, setPlaceDragging } from '../store/elPlace';
import { mountPointerAt, viewStamp } from './mountPointer';
import { ui } from '../store/ui';
import { visibleAt } from '../three/cutaway';
import { wake } from './renderLoop';
import { lockControls, sceneApi } from './sceneApi';

/** bridge between the 3D layer and input: ids of the devices currently drawn in the scene */
export const elScene = { shown: [] as string[] };

/** preview offset above the finger [px] and the distance over which it ramps up (start without a jump) */
export const FINGER_OFFSET = 56, FINGER_RAMP = 40;
export const fingerLift = (moved: number) => FINGER_OFFSET * Math.min(1, moved / FINGER_RAMP);
/**
 * Aim point in the plan [screen px]. EXISTING device: pointer + a fixed GRAB VECTOR (device point on the wall − press point) —
 * the device moves exactly as much as the pointer, equally in every direction, also under a finger. Without the grab the aim
 * was the pointer itself: the symbol lies deeper in the room, so near a corner 8 px of movement moved the device to the adjacent
 * wall, and the 56 px lift (meant for new devices) threw a socket from the room's top wall onto the facade.
 * NEW device / copy guided by a finger: preview lifted above the finger (the finger does not hide the mounting spot); mouse — under the cursor.
 */
export type PlanAim = { kind: 'device'; grab: [number, number] } | { kind: 'ghost'; touch: boolean; moved: number };
export const planAim = (pointer: [number, number], g: PlanAim): [number, number] =>
  (g.kind === 'device' ? [pointer[0] + g.grab[0], pointer[1] + g.grab[1]] : [pointer[0], pointer[1] - (g.touch ? fingerLift(g.moved) : 0)]);
/** device hit radius on screen [px]: finger 24 (48 px area), mouse 16 */
export const HIT_PX = { touch: 24, mouse: 16 };
/** ↕ height handle: distance above the device axis [m] */
export const HANDLE_UP = 0.17;

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v3 = new THREE.Vector3();
const vis = (p: Vec3) => visibleAt(v3.set(p[0], p[2], -p[1]));
const setRay = (x: number, y: number): boolean => {
  const { camera, dom } = sceneApi;
  if (!camera || !dom) return false;
  const r = dom.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return true;
};
/** place under a screen point for a device of a given type (placement engine; level from the camera position / view) */
export function surfaceAtScreen(x: number, y: number, type: ElType, cur: WallRef | null = null): Surface | null {
  if (!setRay(x, y)) return null;
  const o = ray.ray.origin, d = ray.ray.direction, s = ui.get(), walking = s.houseView === 'walk' && !s.roomId;
  const origin: Vec3 = [o.x, -o.z, o.y], dir: Vec3 = [d.x, -d.z, d.y];
  // walk: level from eye height (stairs); 3D: the view's level
  const level = walking ? ([...allLevels()].sort((a, b) => b.floorZ - a.floorZ).find((l) => origin[2] >= l.floorZ - 0.3) ?? allLevels()[0]).id : s.level;
  return surfaceFromRay({ level, origin, dir, visible: walking ? undefined : vis }, type, cur);
}
const project = (p: Vec3): [number, number] | null => {
  const { camera, dom } = sceneApi;
  if (!camera || !dom) return null;
  v3.set(p[0], p[2], -p[1]).project(camera);
  if (v3.z > 1 || v3.z < -1) return null;
  const r = dom.getBoundingClientRect();
  return [r.left + ((v3.x + 1) / 2) * r.width, r.top + ((1 - v3.y) / 2) * r.height];
};
/** device nearest to a screen point (within the hit radius) — among those drawn, from enabled layers */
export function deviceAtScreen(x: number, y: number, radius: number): string | null {
  const layers = ui.get().elLayers, shown = new Set(elScene.shown);
  let best: string | null = null, bd = radius;
  for (const p of planNow().points) {
    if (!shown.has(p.id) || !layers[layerOf(p.type)]) continue;
    const m = measure(p), s = m ? project(m.pos) : null;
    if (!s) continue;
    const d = Math.hypot(s[0] - x, s[1] - y);
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}
export function deviceScreen(id: string): [number, number] | null {
  const p = planNow().points.find((q) => q.id === id), m = p ? measure(p) : null;
  return m ? project(m.pos) : null;
}
/** ↕ handle of the selected wall device: screen position */
export function handleScreen(id: string): [number, number] | null {
  const p = planNow().points.find((q) => q.id === id), m = p ? measure(p) : null;
  return m && p!.orientation === 'wall' ? project([m.pos[0] + m.normal[0] * 0.01, m.pos[1] + m.normal[1] * 0.01, m.pos[2] + HANDLE_UP]) : null;
}

type Gesture =
  | { kind: 'device'; id: string; start: [number, number]; moved: boolean; touch: boolean }
  | { kind: 'height'; id: string; start: [number, number]; touch: boolean }
  | { kind: 'ghost'; start: [number, number]; moved: number; touch: boolean }
  | { kind: 'tap'; start: [number, number]; touch: boolean };

/** pointer handling in the scene (mounted in the electrical layer when section = Electrical and view ≠ plan) */
export function ElSceneInput({ active }: { active: boolean }) {
  const dom = useThree((s) => s.gl.domElement);
  useEffect(() => {
    if (!active) return;
    let g: Gesture | null = null, pointers = 0;
    const walking = () => { const s = ui.get(); return s.houseView === 'walk' && !s.roomId; };
    const eat = (e: Event) => { e.stopImmediatePropagation(); e.stopPropagation(); };
    let stamp = '';
    const aim = (e: PointerEvent, lift = 0) => {
      const s = placeNow();
      if (!s) return;
      const y = e.clientY - lift;
      if (mountDragging()) {
        // dragging an existing device along ITS wall (shared mount engine); a view change meanwhile → new grab, no movement
        const p = mountPointerAt(e.clientX, y), now = viewStamp();
        if (p) { if (now !== stamp) { stamp = now; reanchorDrag(p); } dragTo(p, [e.clientX, y], e.altKey); }
      } else placeAt(surfaceAtScreen(e.clientX, y, s.type, currentWall()), [e.clientX, y], e.altKey);
      wake();
    };
    const end = () => { if (g && g.kind !== 'tap') lockControls(false); g = null; };
    const onDown = (e: PointerEvent) => {
      pointers++;
      if (pointers > 1) {                                                     // second finger: camera gesture (pinch) — no device moving
        if (g?.kind === 'device' && g.moved) cancelPlace();
        if (g?.kind === 'ghost') setPlaceDragging(false);
        end(); return;
      }
      if (e.button !== 0) return;
      const touch = e.pointerType !== 'mouse', s = placeNow(), sel = ui.get().selection, start: [number, number] = [e.clientX, e.clientY];
      if (s) {
        // placement mode: the finger guides the preview (camera locked); mouse and walk — click / tap places
        if (touch && !walking()) { eat(e); lockControls(true); g = { kind: 'ghost', start, moved: 0, touch }; setPlaceDragging(true, true); aim(e); }
        else g = { kind: 'tap', start, touch };
        return;
      }
      if (sel?.kind === 'electrical') {
        // ↕ handle above the selected device: wins only when the pointer is closer to the handle than to the device itself
        const h = handleScreen(sel.id), dv = deviceScreen(sel.id);
        const dh = h ? Math.hypot(h[0] - e.clientX, h[1] - e.clientY) : Infinity, dd = dv ? Math.hypot(dv[0] - e.clientX, dv[1] - e.clientY) : Infinity;
        if (dh < (touch ? 26 : 18) && dh < dd) { eat(e); lockControls(true); g = { kind: 'height', id: sel.id, start, touch }; return; }
      }
      const id = deviceAtScreen(e.clientX, e.clientY, touch ? HIT_PX.touch : HIT_PX.mouse);
      if (id) { eat(e); lockControls(true); g = { kind: 'device', id, start, moved: false, touch }; }
      else g = { kind: 'tap', start, touch };
    };
    const onMove = (e: PointerEvent) => {
      if (!g) {
        // mouse without a button: preview in placement mode, cursor over a device
        if (e.pointerType === 'mouse' && !e.buttons && e.target === dom) { if (placeNow()) aim(e); else dom.style.cursor = deviceAtScreen(e.clientX, e.clientY, HIT_PX.mouse) ? 'grab' : ''; }
        return;
      }
      const moved = Math.hypot(e.clientX - g.start[0], e.clientY - g.start[1]);
      if (g.kind === 'device') {
        // grab computed when the drag threshold is crossed (the device does not jump under the pointer)
        if (!g.moved) { if (moved < (g.touch ? 8 : 4)) return; g.moved = true; stamp = viewStamp(); beginMove(g.id, { dragging: true, touch: g.touch, pointer: mountPointerAt(e.clientX, e.clientY) }); }
        aim(e);
      } else if (g.kind === 'height') {
        if (!placeNow()) { if (moved < 3) return; stamp = viewStamp(); beginHeight(g.id, g.touch, mountPointerAt(e.clientX, e.clientY)); }
        aim(e);
      } else if (g.kind === 'ghost') { g.moved = Math.max(g.moved, moved); aim(e, fingerLift(g.moved)); }
    };
    const onUp = (e: PointerEvent) => {
      pointers = Math.max(0, pointers - 1);
      const cur = g;
      if (!cur) return;
      const moved = Math.hypot(e.clientX - cur.start[0], e.clientY - cur.start[1]);
      end();
      if (cur.kind === 'device') {
        if (cur.moved) { commitPlace(); swallowClick(); }
        else { const s = ui.get(); ui.set(s.selection?.kind === 'electrical' && s.selection.id === cur.id ? { elMore: !s.elMore } : { selection: { kind: 'electrical', id: cur.id }, elMore: false }); swallowClick(); }
      } else if (cur.kind === 'height') { if (placeNow()) commitPlace(); swallowClick(); }
      else if (cur.kind === 'ghost') { commitPlace(); swallowClick(); }
      else if (placeNow() && moved <= (cur.touch ? 10 : 5)) { aim(e); commitPlace(); swallowClick(); }
      wake();
    };
    const onCancel = () => { pointers = Math.max(0, pointers - 1); if (g?.kind === 'device' && g.moved) cancelPlace(); if (g?.kind === 'ghost') setPlaceDragging(false); end(); };
    const onLeave = () => { const s = placeNow(); if (s && !s.dragging && s.mode !== 'move') placeAt(null, null); };
    // the click ending the gesture belongs to electrical mode (does not enter a room, open a door or deselect)
    let swallow = 0;
    const swallowClick = () => { swallow = performance.now(); };
    const onClick = (e: MouseEvent) => { if (performance.now() - swallow < 350) eat(e); };
    dom.addEventListener('pointerdown', onDown, true); dom.addEventListener('click', onClick, true); dom.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointermove', onMove, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', onCancel, true);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true); dom.removeEventListener('click', onClick, true); dom.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointermove', onMove, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onCancel, true);
      if (g && g.kind !== 'tap') lockControls(false);
      dom.style.cursor = '';
    };
  }, [active, dom]);
  return null;
}
export const deviceLabel = (t: ElType) => DEVICES[t].name;
