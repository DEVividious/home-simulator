// State of the walk through the home and site for display (HUD) and tests — written by the walk controller a few times per
// second; the camera position lives in the scene (not in the project).
import type { Vec2 } from '../model/types';
import { createStore, useStore } from './createStore';

export interface WalkHud {
  on: boolean;
  /** feet position (LCS) and feet / eye height [m] */
  p: Vec2;
  z: number;
  eyeZ: number;
  /** view direction [rad] */
  yaw: number;
  pitch: number;
  /** place: "<level> — <room>", "Stairs", "Site — <area>" */
  place: string;
  kind: 'room' | 'stairs' | 'door' | 'site' | '';
  /** the room the user stands in (null — stairs, exterior door threshold, site) */
  roomId: string | null;
}

export const walkHud = createStore<WalkHud>({ on: false, p: [0, 0], z: 0, eyeZ: 0, yaw: 0, pitch: 0, place: '', kind: '', roomId: null });
export const useWalkHud = <T,>(sel: (s: WalkHud) => T) => useStore(walkHud, sel);
