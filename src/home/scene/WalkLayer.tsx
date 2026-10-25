// Walk through the building and site:
//   • GroundProbe — terrain height and surface name at a point (raycast down the site model; 5 cm cache) →
//     sceneApi.ground / sceneApi.surface; FlatGround — a site without a terrain model is flat at site.groundLevel,
//   • StairsMesh — stairs from the building data with the variant finish (stairs.ts, stairsConfig.ts),
//   • WalkController — walking (WASD / arrows, Shift — faster, mouse look, wheel — step; eye height above the floor /
//     terrain, stairs, walking out through doors onto the site — WalkWorld).
import { walkInput } from './walkInput';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { t } from '../../i18n';
import { project } from '../../project/active';
import { shellFootprint } from '../model/shell';
import type { SceneData } from './sceneData';
import { finishLook, resolveStairs, type DeepPartial, type StairFinish, type StairsConfig } from '../model/stairsConfig';
import { buildStairs, type StairPart } from '../three/stairGeometry';
import { stairs, type StairDef } from '../model/stairs';
import { levelById } from '../model/rooms';
import { isNearest, longPressFired, pressStart } from './press';
import { lookAngles, viewpointById, viewpoints } from '../model/viewpoints';
import { walkInputVector } from '../model/walk';
import { WalkWorld, type WalkPose } from '../model/walkWorld';
import { ui, useUi } from '../store/ui';
import { walkHud } from '../store/walk';
import { lastWasClick, sceneApi } from './sceneApi';
import type { SceneMode } from './sceneMode';
import { useSunLight } from './Lighting';
import { SITE_KINDS } from '../three/siteStyle';

/** surface name of a terrain mesh: from its material kind (three/siteStyle.ts), otherwise "ground" */
const surfaceName = (m: THREE.Mesh): string => {
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
  const kind = mat ? SITE_KINDS[mat.name] : undefined;
  return t(`walk.surface.${kind ?? 'ground'}`);
};

/** terrain probe: height and surface name from the project's site model (projects with a site model only) */
export function GroundProbe({ url }: { url: string }) {
  const site = useGLTF(url);
  useEffect(() => {
    site.scene.updateMatrixWorld(true);
    const names = project().assets?.groundMeshes, meshes: THREE.Mesh[] = [];
    site.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && (!names || names.includes(o.name))) meshes.push(o as THREE.Mesh); });
    const rc = new THREE.Raycaster();
    rc.ray.direction.set(0, -1, 0);
    const cache = new Map<number, { z: number | null; s: string | null }>();
    const probe = (x: number, y: number) => {
      const k = Math.round(x * 20) * 100003 + Math.round(y * 20);
      let h = cache.get(k);
      if (h) return h;
      rc.ray.origin.set(x, 200, -y);
      const hits: THREE.Intersection[] = [];
      for (const m of meshes) THREE.Mesh.prototype.raycast.call(m, rc, hits);
      let best: THREE.Intersection | null = null;
      for (const q of hits) if (!best || q.point.y > best.point.y) best = q;
      h = { z: best ? best.point.y : null, s: best ? surfaceName(best.object as THREE.Mesh) : null };
      if (cache.size > 60000) cache.clear();
      cache.set(k, h);
      return h;
    };
    sceneApi.ground = (x, y) => probe(x, y).z;
    sceneApi.surface = (x, y) => probe(x, y).s;
    return () => { sceneApi.ground = () => null; sceneApi.surface = () => null; };
  }, [site.scene]);
  return null;
}

/** a site without a terrain model: flat ground at site.groundLevel inside the walkable area */
export function FlatGround() {
  useEffect(() => {
    const s = project().site;
    if (!s) return;
    const label = t('walk.surface.ground');
    sceneApi.ground = () => s.groundLevel;
    sceneApi.surface = () => label;
    return () => { sceneApi.ground = () => null; sceneApi.surface = () => null; };
  }, []);
  return null;
}

/** flat ground plane drawn for a site without a terrain model */
export function FlatGroundMesh() {
  const s = project().site;
  const geo = useMemo(() => {
    if (!s) return null;
    const xs = s.boundary.map((q) => q[0]), ys = s.boundary.map((q) => q[1]);
    const [x0, y0, x1, y1] = s.walkBounds ?? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0).rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, s.groundLevel - 0.01, -(y0 + y1) / 2);
    return g;
  }, [s]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return <mesh name="SITE_FlatGround" geometry={geo} receiveShadow raycast={() => null}><meshStandardMaterial color="#6f9a4a" roughness={1} /></mesh>;
}

const GLASS_MAT = new THREE.MeshStandardMaterial({ color: '#cfe3ea', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false, name: 'MAT_Stairs_Glass' });
const stairMats = new Map<string, THREE.MeshStandardMaterial>();
/** stair finish material (shared for the same palette entry / colour) */
function stairMaterial(f: StairFinish): THREE.MeshStandardMaterial {
  let m = stairMats.get(f);
  if (!m) { const l = finishLook(f); m = new THREE.MeshStandardMaterial({ color: l.color, roughness: l.roughness, metalness: l.metalness, name: `MAT_Stairs_${f}` }); stairMats.set(f, m); }
  return m;
}
/**
 * Stairs: concrete structure from the building data + finish from the variant (cladding, handrail, balustrade — model/stairsConfig.ts).
 * Not part of the building model file. Click / tap selects the stairs (finish card); in walk mode — long press.
 */
export function StairsMesh(props: { config?: DeepPartial<StairsConfig> | null; walking?: boolean; selected?: boolean }) {
  // stairs from the project data: each as a separate solid on the floor of the level it starts from; a project without stairs — nothing
  return <>{stairs().map((def) => <group key={def.id} position={[0, levelById(def.fromLevel)?.floorZ ?? 0, 0]}><StairMesh def={def} {...props} /></group>)}</>;
}
function StairMesh({ def, config, walking = false, selected = false }: { def: StairDef; config?: DeepPartial<StairsConfig> | null; walking?: boolean; selected?: boolean }) {
  const key = JSON.stringify(config ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => resolveStairs(config), [key]);
  const geo = useMemo(() => buildStairs(c, def), [c, def]);
  useEffect(() => () => Object.values(geo).forEach((g) => g?.dispose()), [geo]);
  const mat: Record<StairPart, THREE.Material> = {
    concrete: stairMaterial('concrete'), tread: stairMaterial(c.tread), riser: stairMaterial(c.riser === 'none' ? 'concrete' : c.riser),
    rail: stairMaterial(c.handrail.finish), balustrade: stairMaterial(c.balustrade.finish), glass: GLASS_MAT,
  };
  const select = () => ui.set({ selection: { kind: 'stairs' } });
  return (
    <group name="HOME_STAIRS" userData={{ stairs: true, selected }}
      onPointerDown={(e) => { if (walking && isNearest(e)) { e.stopPropagation(); pressStart(e.nativeEvent, select); } }}
      onClick={(e) => { if (!isNearest(e)) return; if (longPressFired()) { e.stopPropagation(); return; } if (walking || !lastWasClick()) return; e.stopPropagation(); const s0 = ui.get().selection; ui.set({ selection: s0?.kind === 'stairs' ? null : { kind: 'stairs' } }); }}>
      {(Object.keys(geo) as StairPart[]).map((k) => (
        <mesh key={k} geometry={geo[k]} material={mat[k]} castShadow={k !== 'glass'} receiveShadow name={k === 'concrete' ? 'HOME_STAIRS_SCHEMATIC' : `HOME_STAIRS_${k}`} renderOrder={k === 'glass' ? 2 : 0} />
      ))}
    </group>
  );
}

const L3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
/** walking speed [m/s] — tuned after testing on a phone (the same for building and room walks) */
export const WALK_SPEED = { walk: 2.0, run: 4.58 };
/** walk field of view [°] — when the walk request (viewpoint, bookmark, check view) gives none; same as the room walk */
export const WALK_FOV = 70;

/** building and site walk (scene mode 'walk') */
export function WalkController({ data, mode }: { data: SceneData; mode: SceneMode }) {
  const gl = useThree((s) => s.gl), camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const on = mode.kind === 'walk';
  const go = useUi((s) => s.walkGo);
  const userEye = useUi((s) => s.eyeHeight), eye = go.eye ?? userEye;
  const world = useMemo(() => {
    // building outline and walkable terrain from the project package; a project without a site — shell outline, no walking outside
    const site = project().site;
    const footprint = site?.footprint ?? shellFootprint(), bx = site?.boundary.map((q) => q[0]) ?? [], by = site?.boundary.map((q) => q[1]) ?? [];
    const bounds = site?.walkBounds ?? (site ? [Math.min(...bx), Math.min(...by), Math.max(...bx), Math.max(...by)] as [number, number, number, number] : [0, 0, 0, 0] as [number, number, number, number]);
    return new WalkWorld({ footprint, bounds, ground: (x, y) => sceneApi.ground(x, y), obstacles: [] });
  }, [data]);
  // probe for E2E tests: height / reachability of a point in the walk model
  useEffect(() => { (window as unknown as { __walkProbe?: unknown }).__walkProbe = (x: number, y: number, z: number) => world.heightAt([x, y], z, eye); }, [world, eye]);
  const st = useRef({ pose: null as WalkPose | null, yaw: 0, pitch: 0, eyeZ: 0, fov: WALK_FOV, keys: new Set<string>(), push: 0, hudAt: 0, pending: true });

  // start: viewpoint / pose from the request (settled in the walk model once the terrain has loaded)
  useEffect(() => { st.current.pending = true; }, [go.n, on]);

  useEffect(() => {
    if (!on) { walkHud.set({ on: false, place: '', kind: '', roomId: null }); return; }
    const dom = gl.domElement, w = st.current;
    // looking around tracks ONE pointer (pointerId) — a second finger on the joystick does not rotate the view
    let look: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null;
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    const down = (e: PointerEvent) => { if (!look && (e.button === 0 || e.button === 2)) look = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: w.yaw, pitch: w.pitch }; };
    const move = (e: PointerEvent) => {
      // dragging furniture / a device (sceneApi.locked) suspends looking around — as in the room walk
      if (!look || e.pointerId !== look.id || sceneApi.locked) return;
      w.yaw = look.yaw - (e.clientX - look.x) * 0.0045;
      w.pitch = THREE.MathUtils.clamp(look.pitch - (e.clientY - look.y) * 0.0045, -1.3, 1.3);
    };
    const up = (e: PointerEvent) => { if (look && e.pointerId === look.id) look = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); w.push += -Math.sign(e.deltaY) * 0.5; };
    const kd = (e: KeyboardEvent) => { if (!typing(e) && !e.ctrlKey && !e.metaKey) w.keys.add(e.code); };
    const ku = (e: KeyboardEvent) => { w.keys.delete(e.code); };
    const blur = () => w.keys.clear();
    const ctx = (e: MouseEvent) => e.preventDefault();
    dom.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    dom.addEventListener('contextmenu', ctx);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    return () => {
      dom.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', wheel); dom.removeEventListener('contextmenu', ctx); window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      w.keys.clear();
    };
  }, [on, gl]);

  useFrame((_, dtRaw) => {
    if (!on) return;
    const w = st.current, dt = Math.min(dtRaw, 0.25);
    if (w.pending) {
      // settle the start (the terrain must be loaded — the probe returns a height)
      const g = ui.get().walkGo, vp = viewpointById(g.viewpointId) ?? (g.pose ? null : w.pose ? null : viewpoints()[0]);
      let pose: WalkPose | null = null;
      if (vp) {
        const zHint = vp.level === 'SITE' ? sceneApi.ground(vp.p[0], vp.p[1]) : levelById(vp.level)?.floorZ ?? 0;
        if (zHint === null) return; // terrain not loaded yet
        pose = world.settle(vp.p, zHint, eye);
        const a = lookAngles(pose?.p ?? vp.p, vp.look, eye);
        w.yaw = a.yaw; w.pitch = a.pitch;
        w.fov = vp.fov;
      } else if (g.pose) {
        pose = world.settle(g.pose.p, g.pose.z, eye);
        w.yaw = g.pose.yaw; w.pitch = g.pose.pitch;
        w.fov = g.fov ?? WALK_FOV;
      } else pose = w.pose;
      w.pending = false;
      if (pose) { w.pose = pose; w.eyeZ = pose.z + eye; }
      // the field of view always belongs to the walk: resuming and starting from a given place do not inherit the previous view's
      // angle (building view 40°, room 50°) — otherwise a walk bookmark and the eye-level view would open "zoomed in"
      camera.fov = w.fov;
      camera.near = 0.05; camera.far = mode.environment ? 6000 : 900; camera.updateProjectionMatrix();
      sceneApi.target = null;
    }
    if (!w.pose) return;
    const k = w.keys, sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? WALK_SPEED.run : WALK_SPEED.walk) * dt;
    // keys + touch joystick (analog, −1…1); vector clamped to the unit circle — the same speed diagonally as straight ahead
    const [f, s] = walkInputVector((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + walkInput.f,
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + walkInput.s);
    const push = w.push * Math.min(1, dt * 8); w.push -= push;
    const fx = -Math.sin(w.yaw), fy = Math.cos(w.yaw);
    const mx = (f * sp + push) * fx + s * sp * fy, my = (f * sp + push) * fy - s * sp * fx;
    if (mx || my) w.pose = world.step(w.pose, mx, my, eye);
    // the eyes follow the feet smoothly (steps, terrace kerb)
    const target = w.pose.z + eye;
    w.eyeZ += (target - w.eyeZ) * Math.min(1, dt * 12);
    if (Math.abs(target - w.eyeZ) > 1.5) w.eyeZ = target;
    camera.position.copy(L3(w.pose.p[0], w.pose.p[1], w.eyeZ));
    camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    const now = performance.now();
    if (now - w.hudAt > 150) {
      w.hudAt = now;
      const place = world.placeAt(w.pose, eye, sceneApi.surface(w.pose.p[0], w.pose.p[1]));
      walkHud.set({ on: true, p: [w.pose.p[0], w.pose.p[1]], z: w.pose.z, eyeZ: w.eyeZ, yaw: w.yaw, pitch: w.pitch, place: place.label, kind: place.kind, roomId: place.kind === 'room' ? place.room.id : null });
      if (place.kind === 'room' && ui.get().level !== place.level) ui.set({ level: place.level });
    }
  });
  return null;
}

/** walk lamp: soft light at the camera indoors (ceilings and walls out of the sun are not black) */
export function WalkLamp({ mode }: { mode: SceneMode }) {
  const camera = useThree((s) => s.camera), light = useRef<THREE.PointLight>(null);
  const night = 1 - useSunLight().daylight;
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const kind = walkHud.get().kind, indoor = mode.kind === 'walk' && (kind === 'room' || kind === 'stairs' || kind === 'door');
    // stronger and warmer after dark (room lighting)
    l.intensity += ((indoor ? 3.2 + 2.3 * night : 0) - l.intensity) * 0.2;
    l.color.set(night > 0.5 ? '#ffe2bd' : '#fff3e4');
    l.position.set(camera.position.x, camera.position.y + 0.6, camera.position.z);
  });
  return <pointLight ref={light} intensity={0} distance={9} decay={1.3} color="#fff3e4" />;
}
