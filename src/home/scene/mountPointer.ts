// Bridge between the scene and the wall-mounted object engine (model/mountDrag.ts): screen pointer → camera ray in LCS (or a
// plan point in the top view) together with what the engine needs to limit the gain (metres per pixel) and to choose the
// visible surface (section, wall cutaway). Shared by wall-hung furniture and devices.
import * as THREE from 'three';
import { allLevels, roomById } from '../model/rooms';
import type { MountPointer } from '../model/mountDrag';
import type { Vec3 } from '../model/types';
import { ui } from '../store/ui';
import { visibleAt } from '../three/cutaway';
import { sceneApi } from './sceneApi';

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v3 = new THREE.Vector3();
const visible = (p: Vec3) => visibleAt(v3.set(p[0], p[2], -p[1]));

/** mount engine pointer for a screen point (null — outside the scene / scene not ready) */
export function mountPointerAt(clientX: number, clientY: number): MountPointer | null {
  const { camera, dom } = sceneApi;
  if (!camera || !dom) return null;
  const r = dom.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction, s = ui.get(), screen: [number, number] = [clientX, clientY];
  const walking = s.houseView === 'walk' && !s.roomId;
  const origin: Vec3 = [o.x, -o.z, o.y], dir: Vec3 = [d.x, -d.z, d.y];
  // level: the room's → the walk's (from eye height) → the view's
  const level = roomById(s.roomId)?.level ?? (walking ? ([...allLevels()].sort((a, b) => b.floorZ - a.floorZ).find((l) => origin[2] >= l.floorZ - 0.3) ?? allLevels()[0]).id : s.level);
  const ortho = camera as THREE.OrthographicCamera, persp = camera as THREE.PerspectiveCamera;
  if (ortho.isOrthographicCamera) {
    const mPerPx = (ortho.top - ortho.bottom) / ortho.zoom / r.height;
    // top view: a vertical ray does not cross the wall plane — the pointer is a plan point
    if (dir[2] < -0.98) return { kind: 'plan', q: [origin[0], origin[1]], mPerPx, screen, view: level };
    return { kind: 'ray', origin, dir, mPerPx, ortho: true, screen, level, visible };
  }
  return { kind: 'ray', origin, dir, mPerPx: (2 * Math.tan((persp.fov * Math.PI) / 360)) / r.height, screen, level, visible: walking ? undefined : visible, allLevels: walking };
}

/**
 * View stamp: scene rectangle + camera matrices. A stamp change between two pointer events means the same screen pixel points
 * at a different place in the world (a panel narrowed the scene, the camera moved, the phone rotated) — dragging must then
 * recompute the grab instead of moving the object.
 */
export function viewStamp(): string {
  const { camera, dom } = sceneApi;
  if (!camera || !dom) return '';
  // stamp resolution: rotation 0.002 (about 1 px at a typical distance), position 5 mm — numerical camera noise (e.g. fading
  // orbit damping) does not pass for a view change
  const r = dom.getBoundingClientRect(), m = camera.matrixWorld.elements, rot = (v: number) => Math.round(v * 500), pos = (v: number) => Math.round(v * 200);
  return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}|${camera.projectionMatrix.elements.map(rot).join(',')}|${[...m.slice(0, 12)].map(rot).join(',')},${[...m.slice(12, 15)].map(pos).join(',')}`;
}
