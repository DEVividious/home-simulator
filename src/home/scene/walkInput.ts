// Walk input shared by both walk controllers (building and site: WalkLayer; room: CameraController), read every frame:
//  • the virtual joystick on touch (analog, f — forward (+) / back (−), s — right (+) / left (−), range −1…1; the outer ring runs),
//  • the keys — a short tap still walks a short step (a quick press used to move a few centimetres and looked like nothing),
//  • a walk to a target — a door clicked from too far away is walked up to and then opened.
import type { Vec2 } from '../model/types';

/** a walk to a point: stop within `reach` of it, then `done`; `fail` when the way is blocked */
export interface WalkTarget { p: Vec2; reach: number; done: () => void; fail: () => void }
export const walkInput = { f: 0, s: 0, run: false, to: null as WalkTarget | null };
export const resetWalkInput = () => { walkInput.f = 0; walkInput.s = 0; walkInput.run = false; };

/** a key tap shorter than this still walks this long — one tap ≈ 0.7 m at walking speed [ms] */
export const TAP_MS = 350;
/** keys of a walk controller: held now, and until when a tapped key still counts as held */
export interface WalkKeys { held: Set<string>; until: Map<string, number> }
export const walkKeys = (): WalkKeys => ({ held: new Set(), until: new Map() });
export function keyDown(k: WalkKeys, code: string, now: number, repeat = false) { k.held.add(code); if (!repeat) k.until.set(code, now + TAP_MS); }
export const keyUp = (k: WalkKeys, code: string) => { k.held.delete(code); };
export const keyClear = (k: WalkKeys) => { k.held.clear(); k.until.clear(); };
const down = (k: WalkKeys, now: number, ...codes: string[]) => codes.some((c) => k.held.has(c) || (k.until.get(c) ?? 0) > now);
/** the keys as walk input: forward / side (±1 each) and whether Shift runs */
export function keyInput(k: WalkKeys, now: number): { f: number; s: number; run: boolean } {
  return {
    f: (down(k, now, 'KeyW', 'ArrowUp') ? 1 : 0) - (down(k, now, 'KeyS', 'ArrowDown') ? 1 : 0),
    s: (down(k, now, 'KeyD', 'ArrowRight') ? 1 : 0) - (down(k, now, 'KeyA', 'ArrowLeft') ? 1 : 0),
    run: k.held.has('ShiftLeft') || k.held.has('ShiftRight'),
  };
}

/** joystick: dead zone, the speed just past it, the ring that runs (fractions of the pad radius) */
export const PAD = { dead: 0.12, start: 0.4, run: 0.9 };
/** joystick deflection (pad radius = 1; dy > 0 = down the screen) → walk input: past the dead zone it starts at 40 % of the
 *  walking speed (not at a crawl) and reaches full speed at the outer ring, where it runs */
export function padInput(dx: number, dy: number): { f: number; s: number; run: boolean } {
  const m = Math.hypot(dx, dy);
  if (!Number.isFinite(m) || m < PAD.dead) return { f: 0, s: 0, run: false };
  const g = Math.min(1, PAD.start + ((1 - PAD.start) * (Math.min(m, 1) - PAD.dead)) / (PAD.run - PAD.dead));
  return { f: (-dy / m) * g, s: (dx / m) * g, run: m >= PAD.run };
}

/**
 * One frame of a walk to a target: the step (mx, my) towards it (at most `step`, ending at `reach`), the view turned towards it,
 * and whether it is reached. Yaw as in the walk controllers: forward = (−sin yaw, cos yaw).
 */
export function approach(from: Vec2, yaw: number, to: Pick<WalkTarget, 'p' | 'reach'>, step: number, dt: number): { mx: number; my: number; yaw: number; arrived: boolean } {
  const dx = to.p[0] - from[0], dy = to.p[1] - from[1], d = Math.hypot(dx, dy);
  const turn = Math.atan2(Math.sin(Math.atan2(-dx, dy) - yaw), Math.cos(Math.atan2(-dx, dy) - yaw));
  const ny = d > 1e-6 ? yaw + turn * Math.min(1, dt * 6) : yaw;
  if (d <= to.reach) return { mx: 0, my: 0, yaw: ny, arrived: true };
  const l = Math.min(step, d - to.reach);
  return { mx: (dx / d) * l, my: (dy / d) * l, yaw: ny, arrived: false };
}
