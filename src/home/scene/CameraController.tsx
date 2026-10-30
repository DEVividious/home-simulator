// Configurator camera: building view presets (the project's exterior views, interior section) with smooth transitions;
// Room Mode — 3D (orbit around the room), TOP VIEW (orthographic plan from above: pan and zoom, no rotation),
// WALK (human perspective: eyes at the eye height, mouse look, WASD / arrows / wheel movement, room bounds).
// Controls as in popular interior planners: left button on empty space — orbit around the room / building, right
// (or Shift + left, middle) — pan, wheel — zoom towards the cursor, double-click — new orbit centre;
// left button on furniture — move the furniture (camera control suspended: sceneApi.lockControls).
// Exterior presets avoid the surrounding trees (the camera does not land in tree crowns — direction and distance with a clear view).
import { walkInput } from './walkInput';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { wake } from './renderLoop';
import { DEFAULT_VIEW_DIR, exteriorViews, homeViewId, INTERIOR_VIEW_ID, viewById } from '../model/views';
import type { SceneBounds, SceneData } from './sceneData';
import { clampToPolygon, pointInPolygon } from '@home-sim/core/model/geom2d';
import { walkInputVector, walkNearestAllowed, walkRoomAt, walkStep } from '../model/walk';
import { inStairBox } from '../model/stairs';
import { nearExteriorDoor } from '../model/walkWorld';
import { WALK_SPEED } from './WalkLayer';
import { roomById, roomsOfLevel, type HomeRoom } from '../model/rooms';
import type { Vec3 } from '../model/types';
import { design, docOf } from '../store/design';
import { ui, useUi, type Selection } from '../store/ui';
import { floorHit, sceneApi } from './sceneApi';
import { cameraNear, levelFloor, type SceneMode } from './sceneMode';

const L = (p: Vec3) => new THREE.Vector3(p[0], p[2], -p[1]); // LCS → three.js
const FOV = { exterior: 40, room: 50, walk: 70 };

interface Goal { cam: 'persp' | 'ortho'; pos: THREE.Vector3; target: THREE.Vector3; fov?: number; zoom?: number }

/** centre and radius of the building bounds (LCS) */
function boundsSphere(b: SceneBounds) {
  const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  return { c, r };
}

/** distance from which a sphere of radius r fits in the frame */
function fitDist(r: number, fov: number, aspect: number) {
  const v = THREE.MathUtils.degToRad(fov), h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return r / Math.sin(Math.min(v, h) / 2);
}

/** view obstacle: a tree as a vertical cylinder (three.js: x, z — centre, y1 — top, r — crown radius) */
export interface Obstacle { x: number; z: number; y1: number; r: number }

/** view obstacles (trees as vertical cylinders): the surroundings model carries no tree data the engine reads, so a project
 *  frames its views without obstacles (known limitation: docs/KNOWN_LIMITATIONS.md) */
export function treeObstacles(_data: SceneData): Obstacle[] {
  return [];
}

/** distance from the target along a direction (three.js, unit) to the first obstacle (with a margin); maxD — when none */
export function clearDistance(target: THREE.Vector3, dir: THREE.Vector3, maxD: number, obstacles: Obstacle[], from = 2): number {
  const ex = target.x + dir.x * maxD, ez = target.z + dir.z * maxD;
  // obstacles in a band around the segment (pre-selection)
  const near = obstacles.filter((o) => {
    const vx = ex - target.x, vz = ez - target.z, L2 = vx * vx + vz * vz || 1;
    const u = Math.max(0, Math.min(1, ((o.x - target.x) * vx + (o.z - target.z) * vz) / L2));
    return Math.hypot(target.x + vx * u - o.x, target.z + vz * u - o.z) < o.r + 2;
  });
  for (let t = from; t <= maxD; t += 0.4) {
    const px = target.x + dir.x * t, py = target.y + dir.y * t, pz = target.z + dir.z * t;
    for (const o of near) if (py < o.y1 + 0.8 && Math.hypot(px - o.x, pz - o.z) < o.r + 0.8) return Math.max(from, t - 1.5);
  }
  return maxD;
}

/** vertical field of view at which a sphere r at distance d fits in the frame */
const fovFor = (r: number, d: number, aspect: number) => {
  const half = Math.asin(Math.min(0.99, r / d));
  const v = aspect >= 1 ? half * 2 : 2 * Math.atan(Math.tan(half) / aspect);
  return THREE.MathUtils.radToDeg(v);
};

/**
 * Camera goal for a building view: level section ("interior") or a project view — framing from a direction (avoiding trees)
 * or a shot computed by the project adapter. Unknown id — the project's start view.
 */
export function presetGoal(id: string, bounds: SceneBounds, aspect: number, level: SceneMode['level'], obstacles: Obstacle[] = []): Goal {
  const { c, r } = boundsSphere(bounds);
  const dirGoal = (dir: Vec3, k = 1.02, center: Vec3 = c, rad = r): Goal => {
    const t = L(center);
    const dist = fitDist(rad, FOV.exterior, aspect) * k;
    const base = new THREE.Vector3(dir[0], dir[2], -dir[1]).normalize();
    if (!obstacles.length) return { cam: 'persp', pos: t.clone().addScaledVector(base, dist), target: t, fov: FOV.exterior };
    // direction and distance with a clear view: rotation about the vertical ±48°, possibly higher; the nominal direction preferred
    let best: { d: THREE.Vector3; c: number; score: number } | null = null;
    for (const lift of [0, 0.25]) {
      for (const off of [0, 12, -12, 24, -24, 36, -36, 48, -48]) {
        const d = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(off));
        d.y += lift; d.normalize();
        const cd = clearDistance(t, d, dist, obstacles, rad * 0.8);
        const score = Math.min(cd, dist) / dist - Math.abs(off) * 0.003 - lift * 0.3;
        if (!best || score > best.score) best = { d, c: cd, score };
      }
    }
    const fov = best!.c >= dist ? FOV.exterior : Math.min(68, Math.max(FOV.exterior, fovFor(rad * 0.92, best!.c, aspect)));
    return { cam: 'persp', pos: t.clone().addScaledVector(best!.d, best!.c), target: t, fov };
  };
  if (id === INTERIOR_VIEW_ID) {
    // level section: oblique view from above onto the room outlines; a level without rooms (or outside the project) — building
    // bounds (min / max of an empty list is ±∞: the camera would get a NaN position and the scene would be dead until reload)
    const rooms = roomsOfLevel(level), boxes = rooms.length ? rooms.map((q) => q.bbox) : [[bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]]];
    const xs = boxes.flatMap((q) => [q[0], q[2]]), ys = boxes.flatMap((q) => [q[1], q[3]]);
    const z = levelFloor(level);
    const cc: Vec3 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, z];
    const rr = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
    return dirGoal([-0.62, -0.78, 1.45], 0.92, cc, rr);
  }
  const view = viewById(id) ?? viewById(homeViewId()) ?? exteriorViews()[0];
  // a view without a direction carries an explicit camera pose (project data)
  if (!view.dir && view.pose) return { cam: 'persp', pos: L(view.pose.position), target: L(view.pose.target), fov: view.pose.fov };
  return dirGoal(view.dir ?? DEFAULT_VIEW_DIR, view.fit);
}

/** room camera: 3D (oblique from above), TOP (plan), WALK (start at the door, looking inside) */
export function roomGoal(room: HomeRoom, view: SceneMode['roomView'], aspect: number, size: { width: number; height: number }, eye: number): Goal & { yaw?: number } {
  const [x0, y0, x1, y1] = room.bbox, w = x1 - x0, h = y1 - y0;
  const center = L([room.center[0], room.center[1], room.floorZ + 0.5]);
  if (view === 'top') {
    const zoom = Math.min(size.width / (w + 1.4), size.height / (h + 1.4));
    return { cam: 'ortho', pos: L([room.center[0], room.center[1], room.floorZ + 40]), target: L([room.center[0], room.center[1], room.floorZ]), zoom };
  }
  if (view === 'walk') {
    const door = room.doors.find((d) => !d.passage) ?? room.doors[0];
    let p: [number, number] = [room.center[0], room.center[1]];
    if (door) {
      const wall = room.walls.find((q) => q.id === door.wallId)!;
      p = [door.center[0] + wall.inward[0] * 0.45, door.center[1] + wall.inward[1] * 0.45];
      if (!pointInPolygon(p, room.polygon, -1)) p = clampToPolygon(p, room.polygon, 0.3);
    }
    p = walkNearestAllowed(room.level, room, p, eye);
    const dx = room.center[0] - p[0], dy = room.center[1] - p[1];
    const yaw = Math.atan2(-dx, dy);
    return { cam: 'persp', pos: L([p[0], p[1], room.floorZ + eye]), target: L([room.center[0], room.center[1], room.floorZ + eye - 0.25]), fov: FOV.walk, yaw };
  }
  const r = Math.hypot(w, h) / 2 + 0.8;
  const d = new THREE.Vector3(-0.5, 1.45, 0.72).normalize(); // three.js: from the −X, −Y LCS side, from above (about 60°)
  const dist = Math.max(6, fitDist(r, FOV.room, aspect) * 1.12);
  return { cam: 'persp', pos: center.clone().addScaledVector(d, dist), target: center, fov: FOV.room };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** selection kept when the walk moves into another room: furniture (belongs to its own room, not the room underfoot);
 *  wall / floor / ceiling refer to the room the user left — deselected */
const keepInWalk = (s: Selection): Selection => (s?.kind === 'furniture' ? s : null);

export function CameraController({ data, mode }: { data: SceneData; mode: SceneMode }) {
  const gl = useThree((s) => s.gl), size = useThree((s) => s.size), set = useThree((s) => s.set), cur = useThree((s) => s.camera);
  const [persp] = useState(() => cur as THREE.PerspectiveCamera);
  const ortho = useMemo(() => { const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400); c.up.set(0, 0, -1); (c as unknown as { manual: boolean }).manual = true; return c; }, []);
  // controls created in an effect (not in useMemo): in StrictMode React mounts the component twice — the useMemo instance
  // would be detached by the cleanup and a second, orphaned one (target at (0,0,0)) would take over the mouse
  const [controls, setControls] = useState<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(persp, gl.domElement);
    c.enableDamping = false; c.screenSpacePanning = true; c.zoomToCursor = true;
    // on-demand rendering — camera movement (rotate, pan, zoom) requests frames
    const onChange = () => wake(300);
    c.addEventListener('change', onChange);
    setControls(c);
    // control hook for tests and comparison screenshots: orbit camera at a given position, LCS coordinates
    (window as unknown as Record<string, unknown>).__homeOrbit = {
      set: (position: [number, number, number], target: [number, number, number]) => {
        persp.position.set(position[0], position[2], -position[1]); c.target.set(target[0], target[2], -target[1]); c.update(); wake(300);
      },
    };
    return () => { c.removeEventListener('change', onChange); c.dispose(); setControls(null); };
  }, [persp, gl]);
  const obstacles = useMemo(() => treeObstacles(data), [data]);
  const cmd = useUi((s) => s.camera);
  const eye = useUi((s) => s.eyeHeight);
  const anim = useRef<{ from: Goal; to: Goal; t0: number; dur: number } | null>(null);
  const walk = useRef({ yaw: 0, pitch: -0.05, keys: new Set<string>(), push: 0 });
  const isWalk = mode.kind === 'room' && mode.roomView === 'walk';
  const isTop = mode.kind === 'room' && mode.roomView === 'top';
  // building and site walk / photo matching — the camera is driven by WalkController / PhotoMatchController (WalkLayer.tsx)
  const free = mode.kind === 'walk';
  const room = roomById(mode.roomId);

  // orthographic: frame in pixels (zoom = pixels per metre)
  useEffect(() => {
    ortho.left = -size.width / 2; ortho.right = size.width / 2; ortho.top = size.height / 2; ortho.bottom = -size.height / 2;
    ortho.updateProjectionMatrix();
  }, [ortho, size]);

  // controls by mode
  useEffect(() => {
    if (!controls) return;
    const cam = isTop ? ortho : persp;
    if (cur !== cam) set({ camera: cam });
    controls.object = cam;
    controls.enabled = !isWalk && !free && !sceneApi.locked;
    controls.enableRotate = !isTop;
    // as in planners: left — rotate (top view: pan), right and Shift + left — pan, middle — pan
    controls.mouseButtons = isTop ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN } : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    controls.touches = isTop ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.rotateSpeed = mode.kind === 'room' ? 0.7 : 0.9;
    controls.minDistance = mode.kind === 'room' ? 1.2 : 3;
    controls.maxDistance = mode.kind === 'exterior' ? (mode.environment ? 600 : 220) : mode.kind === 'level' ? 90 : 35;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(mode.kind === 'exterior' ? 89 : 84);
    controls.minZoom = 12; controls.maxZoom = 900;
    if (!free) {
      persp.far = mode.environment ? 6000 : 900;
      persp.near = mode.kind === 'room' ? 0.05 : 0.1;
      persp.updateProjectionMatrix();
    }
    sceneApi.camera = cam;
    sceneApi.target = free ? null : controls.target;
    sceneApi.dom = gl.domElement;
    sceneApi.onLock = (on) => { controls.enabled = !on && !isWalk && !free; };
  }, [isTop, isWalk, free, mode, ortho, persp, controls, set, cur, gl]);

  // the orbit centre does not escape the room / building while panning
  useEffect(() => {
    if (!controls) return;
    const clampTarget = () => {
      const t = controls.target;
      let box: [number, number, number, number, number, number] | null = null;
      if (room && !isWalk) box = [room.bbox[0] - 1.5, room.bbox[1] - 1.5, room.bbox[2] + 1.5, room.bbox[3] + 1.5, room.floorZ - 0.2, room.floorZ + 3];
      else if (mode.kind === 'level') { const b = data.bounds; box = [b.min[0] - 4, b.min[1] - 4, b.max[0] + 4, b.max[1] + 4, b.min[2], b.max[2]]; }
      if (!box) return;
      const X = THREE.MathUtils.clamp(t.x, box[0], box[2]), Y = THREE.MathUtils.clamp(-t.z, box[1], box[3]), Z = THREE.MathUtils.clamp(t.y, box[4], box[5]);
      if (X !== t.x || Y !== -t.z || Z !== t.y) {
        // move the camera together with the target (no view rotation)
        const dx = X - t.x, dy = Z - t.y, dz = -Y - t.z;
        t.set(X, Z, -Y);
        controls.object.position.x += dx; controls.object.position.y += dy; controls.object.position.z += dz;
      }
    };
    controls.addEventListener('change', clampTarget);
    return () => controls.removeEventListener('change', clampTarget);
  }, [controls, room, isWalk, mode.kind, data]);

  // double-click: new orbit centre at the floor point under the cursor (smoothly, without changing the view direction)
  useEffect(() => {
    if (!controls || isWalk || free) return;
    const dom = gl.domElement;
    const dbl = (e: MouseEvent) => {
      const z = room ? room.floorZ : mode.kind === 'level' ? levelFloor(mode.level) : 0;
      const q = floorHit(e.clientX, e.clientY, z);
      if (!q) return;
      const to = new THREE.Vector3(q[0], z + (room ? 0.5 : 1), -q[1]);
      const cam = controls.object as THREE.PerspectiveCamera;
      const pos = cam.position.clone().add(to.clone().sub(controls.target));
      anim.current = { from: { cam: isTop ? 'ortho' : 'persp', pos: cam.position.clone(), target: controls.target.clone(), fov: persp.fov, zoom: ortho.zoom },
        to: { cam: isTop ? 'ortho' : 'persp', pos, target: to, fov: persp.fov, zoom: ortho.zoom }, t0: performance.now(), dur: 400 };
    };
    dom.addEventListener('dblclick', dbl);
    return () => dom.removeEventListener('dblclick', dbl);
  }, [controls, gl, isWalk, free, isTop, room, mode.kind, mode.level, persp, ortho]);

  // camera goal: a request (preset / bookmark) or a mode change (room, room view, level)
  const modeKey = `${mode.kind}|${mode.roomId}|${mode.roomView}|${mode.level}`;
  useEffect(() => {
    if (!controls) return;
    if (free) { anim.current = null; return; }
    // the walk went through a door into another room: the camera stays where it is
    if (sceneApi.walkHandoff) { sceneApi.walkHandoff = false; if (isWalk) return; }
    const aspect = size.width / Math.max(size.height, 1);
    let goal: (Goal & { yaw?: number }) | null = null;
    if (cmd.preset === 'pose' && cmd.pose) goal = { cam: 'persp', pos: L(cmd.pose.position), target: L(cmd.pose.target), fov: cmd.pose.fov };
    if (cmd.preset === 'bookmark') {
      const b = docOf(design.get()).bookmarks?.find((x) => x.id === cmd.bookmarkId);
      if (b) goal = { cam: 'persp', pos: L(b.position), target: L(b.target), fov: b.fov };
    }
    if (!goal && room) goal = roomGoal(room, mode.roomView, aspect, size, eye);
    if (!goal) goal = presetGoal(mode.kind === 'level' ? INTERIOR_VIEW_ID : cmd.preset === 'room' || cmd.preset === 'bookmark' || cmd.preset === 'pose' ? homeViewId() : cmd.preset, data.bounds, aspect, mode.level, mode.environment ? obstacles : []);
    if (goal.yaw !== undefined) { walk.current.yaw = goal.yaw; walk.current.pitch = -0.12; }
    const cam = goal.cam === 'ortho' ? ortho : persp;
    const from: Goal = { cam: goal.cam, pos: cam.position.clone(), target: controls.target.clone(), fov: persp.fov, zoom: ortho.zoom };
    // first frame and transitions between camera types — no animation
    const instant = ui.get().camera.n === 0 && !anim.current && from.pos.lengthSq() < 1e-6 || goal.cam === 'ortho' && cur !== ortho || isWalk;
    if (goal.cam === 'ortho' && cur !== ortho) { ortho.position.copy(goal.pos); ortho.zoom = goal.zoom!; }
    anim.current = { from: instant ? goal : from, to: goal, t0: performance.now(), dur: instant ? 1 : 650 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.n, modeKey, controls]);

  // The near plane grows with camera distance (2% of the distance to the target, from the mode's base value up to 4 m). With a
  // fixed 0.1 m a 24-bit depth buffer resolves only 2–5 mm at 60–90 m, while floor and wall finishes lie 3 mm in front of the
  // slab / wall (SURFACE_OFFSET) — zoomed out they "flickered" with white patches on every camera move (measured on a phone).
  useFrame(() => {
    if (!controls || free || controls.object !== persp) return;
    const near = cameraNear(persp.position.distanceTo(controls.target), mode.kind === 'room' ? 0.05 : 0.1);
    if (Math.abs(near - persp.near) > persp.near * 0.02) { persp.near = near; persp.updateProjectionMatrix(); }
  });

  // camera transition
  useFrame(() => {
    const a = anim.current;
    if (!a || !controls || free) return;
    wake(120); // camera transition in progress — more frames
    const t = Math.min(1, (performance.now() - a.t0) / a.dur), k = ease(t);
    if (a.to.cam === 'ortho') {
      ortho.position.lerpVectors(a.from.pos, a.to.pos, k);
      controls.target.lerpVectors(a.from.target, a.to.target, k);
      ortho.zoom = THREE.MathUtils.lerp(a.from.zoom ?? a.to.zoom!, a.to.zoom!, k);
      ortho.updateProjectionMatrix();
      ortho.lookAt(controls.target);
    } else {
      persp.position.lerpVectors(a.from.pos, a.to.pos, k);
      controls.target.lerpVectors(a.from.target, a.to.target, k);
      if (a.to.fov) { persp.fov = THREE.MathUtils.lerp(a.from.fov ?? a.to.fov, a.to.fov, k); persp.updateProjectionMatrix(); }
      if (!isWalk) persp.lookAt(controls.target);
    }
    if (t >= 1) { anim.current = null; if (!isWalk) controls.update(); }
  });
  useEffect(() => {
    if (!controls) return;
    const stop = () => { anim.current = null; };
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);

  // ------------------------------------------------------------------ walk
  useEffect(() => {
    if (!isWalk) return;
    const dom = gl.domElement, w = walk.current;
    let look: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null;   // one pointer (the joystick is the second finger)
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    const down = (e: PointerEvent) => { if (!look && (e.button === 0 || e.button === 2)) look = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: w.yaw, pitch: w.pitch }; };
    const move = (e: PointerEvent) => {
      if (!look || e.pointerId !== look.id || sceneApi.locked) return;
      w.yaw = look.yaw - (e.clientX - look.x) * 0.0045;
      w.pitch = THREE.MathUtils.clamp(look.pitch - (e.clientY - look.y) * 0.0045, -1.25, 1.25);
    };
    const up = (e: PointerEvent) => { if (look && e.pointerId === look.id) look = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); w.push += -Math.sign(e.deltaY) * 0.4; };
    const kd = (e: KeyboardEvent) => { if (!typing(e) && !e.ctrlKey && !e.metaKey) w.keys.add(e.code); };
    const ku = (e: KeyboardEvent) => { w.keys.delete(e.code); };
    const blur = () => w.keys.clear();
    dom.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    return () => {
      dom.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', wheel); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      w.keys.clear();
    };
  }, [isWalk, gl]);

  useFrame((_, dt) => {
    if (!isWalk || !room || !controls) return;
    const w = walk.current;
    if (!anim.current) {
      const k = w.keys, sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? WALK_SPEED.run : WALK_SPEED.walk) * Math.min(dt, 0.25);
      // input vector clamped to the unit circle (as in the building walk — WalkLayer): the same speed diagonally as straight ahead
      const [f, s] = walkInputVector((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + walkInput.f,
        (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + walkInput.s);
      const push = w.push * Math.min(1, dt * 8); w.push -= push;
      const fx = -Math.sin(w.yaw), fy = Math.cos(w.yaw); // view direction in LCS
      const mx = (f * sp + push) * fx + s * sp * fy, my = (f * sp + push) * fy - s * sp * fx;
      if (mx || my) {
        // movement over the whole level: walls block (sliding along the wall), doors and passages lead to adjacent rooms
        const p = walkStep(room.level, [persp.position.x, -persp.position.z], mx, my, eye);
        persp.position.set(p[0], persp.position.y, -p[1]);
        // The room walk knows only one level. At the stairs and at exits to the outside it turns smoothly into the building walk
        // (same place and view direction) — stairs, exterior doors and the site then work as in the walk from the Home section.
        if (inStairBox(p, 0.25) || nearExteriorDoor(p, room.level)) {
          // The room editing context is kept (walkGo.from): furniture and room surfaces still react, ending the walk returns to the room.
          ui.set((u) => ({ roomId: null, houseView: 'walk', roomView: '3d', selection: keepInWalk(u.selection), hoverRoom: null,
            walkGo: { pose: { p, z: room.floorZ, yaw: w.yaw, pitch: w.pitch }, from: { roomId: room.id, level: room.level }, n: Date.now() } }));
          return;
        }
        const now = walkRoomAt(room.level, p);
        if (now && now.id !== room.id) {
          sceneApi.walkHandoff = true;
          ui.set((u) => ({ roomId: now.id, selection: keepInWalk(u.selection), hoverRoom: null }));
        }
      }
      persp.position.y = room.floorZ + eye;
    }
    persp.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
    controls.target.set(persp.position.x - Math.sin(w.yaw), persp.position.y + Math.tan(w.pitch), persp.position.z - Math.cos(w.yaw));
  });

  return null;
}
