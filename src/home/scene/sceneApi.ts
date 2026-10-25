// Bridge between the R3F scene and the DOM UI (dragging from the catalogue, furniture dragging listened to on the window, E2E tests):
// the current camera and canvas element, camera control lock while dragging, projecting the cursor onto the floor plane.
import * as THREE from 'three';
import type { Vec2, Vec3 } from '../model/types';

export const sceneApi = {
  camera: null as THREE.Camera | null,
  /** point the camera orbits around (target) */
  target: null as THREE.Vector3 | null,
  dom: null as HTMLCanvasElement | null,
  /** furniture drag / rotation — camera control (orbit, walk) suspended */
  locked: false,
  onLock: (_locked: boolean) => {},
  /** cursor position at the last press (tells a click from a camera rotation) */
  downAt: [0, 0] as [number, number],
  /** cursor position at the last button release */
  upAt: [0, 0] as [number, number],
  /** the walk moved into another room — room change without resetting the camera */
  walkHandoff: false,
  /** terrain / surface height at an LCS point (downward raycast onto the site model) and the surface name */
  ground: (_x: number, _y: number): number | null => null,
  surface: (_x: number, _y: number): string | null => null,
  /** sun light (directional, with shadows) */
  sun: null as THREE.DirectionalLight | null,
  /** whether the sun actually casts shadows (a profile with shadows and the sun above the horizon → shadow map updated); the
   *  light's castShadow flag stays on permanently (no material recompilation at sunset) */
  sunCasting: false,
  /** renderer and GPU (WEBGL_debug_renderer_info) — Settings, performance monitor */
  renderer: null as { backend: string; gpu: string } | null,
};

export function lockControls(on: boolean) {
  sceneApi.locked = on;
  sceneApi.onLock(on);
}

/** whether the event was a click (no camera drag) */
export const wasClick = (clientX: number, clientY: number, tol = 5) => Math.hypot(clientX - sceneApi.downAt[0], clientY - sceneApi.downAt[1]) <= tol;
/** whether the last button release was a click (not a camera rotation) */
export const lastWasClick = () => wasClick(sceneApi.upAt[0], sceneApi.upAt[1]);

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

/** whether a screen point lies over the scene */
export function overCanvas(clientX: number, clientY: number): boolean {
  const r = sceneApi.dom?.getBoundingClientRect();
  return !!r && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** LCS point (X, Y) on the horizontal plane Z = z under the cursor (null: outside the scene / parallel ray) */
export function floorHit(clientX: number, clientY: number, z: number): Vec2 | null {
  const { camera, dom } = sceneApi;
  if (!camera || !dom || !overCanvas(clientX, clientY)) return null;
  const r = dom.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane.constant = -z;
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  return [hit.x, -hit.z];
}

const v = new THREE.Vector3();
/** LCS point → screen pixel (null: behind the camera) */
export function screenOf(p: Vec3): [number, number] | null {
  const { camera, dom } = sceneApi;
  if (!camera || !dom) return null;
  v.set(p[0], p[2], -p[1]).project(camera);
  if (v.z > 1 || v.z < -1) return null;
  const r = dom.getBoundingClientRect();
  return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
}
