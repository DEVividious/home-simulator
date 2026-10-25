// Scene lighting (sun simulation):
//   • sun: direction from the sun position for the date and time (model/sun.ts: NOAA, site latitude / longitude and building
//     orientation from the project data), colour and intensity by elevation (dawn / golden hour / day / night),
//   • shadows: one directional light, 2048 px (high) / 1024 px (medium) map, PCF — no cascades; shadow camera fitted to the
//     mode (building and site ±26 m / interiors ±13 m — higher texel density); the map is updated only when the scene or the
//     sun changes (autoUpdate = false), not every frame,
//   • environment map (IBL) from a gradient sky with the sun → PMREM 256 px, recomputed once a time change has settled
//     (not on every slider move), intensity by the amount of daylight,
//   • sky dome (zenith → horizon, glow around the sun), fog in the horizon colour, ACES tone mapping.
// Interiors: the sun shines through the glass (glass casts no shadows), walls and roof cast shadows also with a section
// (clipShadows = false: the section hides the roof only in the image, not in the shadow map) and with the Room Mode wall cutaway.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SceneData } from './sceneData';
import { roomById } from '../model/rooms';
import { sunAt, sunDirLcs } from '../model/sun';
import { design } from '../store/design';
import { drag } from '../store/drag';
import { ui, useQualityProfile, useUi } from '../store/ui';
import { wake } from './renderLoop';
import type { QualityProfile } from '../quality/profile';
import { sceneApi } from './sceneApi';
import { useWalkHud, walkHud } from '../store/walk';
import type { SceneMode } from './sceneMode';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const C = (h: string) => new THREE.Color(h);
const PAL = {
  day: { zen: C('#86aad6'), hor: C('#dfe7ec'), light: C('#fff2df') },
  golden: { zen: C('#7f95bf'), hor: C('#f1c59c'), light: C('#ffb36e') },
  dusk: { zen: C('#3e4f78'), hor: C('#d99a7c') },
  // night: navy sky (not black) — silhouettes of trees and the building readable against the sky
  night: { zen: C('#16233d'), hor: C('#3a4866') },
};
const GROUND = C('#7a7866');

export interface SunLight {
  az: number;
  el: number;
  /** direction to the sun (three.js; with the sun below the horizon — just above the horizon, light faded out) */
  dir: THREE.Vector3;
  /** direct light share 0…1 (0 — sun below the horizon) */
  direct: number;
  /** amount of daylight (sky, IBL) 0…1 */
  daylight: number;
  light: THREE.Color;
  zen: THREE.Color;
  hor: THREE.Color;
}

/** lighting state for a date and time (minutes of local time) */
export function sunLight(date: string, minutes: number): SunLight {
  const p = sunAt(date, minutes), el = p.elevation;
  const d = sunDirLcs(p.azimuth, Math.max(el, 2));
  const dir = new THREE.Vector3(d[0], d[2], -d[1]).normalize();
  const direct = smooth(-0.6, 6, el), daylight = smooth(-9, 9, el);
  let zen: THREE.Color, hor: THREE.Color;
  if (el >= 0) { const t = smooth(0, 16, el); zen = PAL.golden.zen.clone().lerp(PAL.day.zen, t); hor = PAL.golden.hor.clone().lerp(PAL.day.hor, t); }
  else if (el >= -6) { const t = (el + 6) / 6; zen = PAL.dusk.zen.clone().lerp(PAL.golden.zen, t); hor = PAL.dusk.hor.clone().lerp(PAL.golden.hor, t); }
  else { const t = smooth(-14, -6, el); zen = PAL.night.zen.clone().lerp(PAL.dusk.zen, t); hor = PAL.night.hor.clone().lerp(PAL.dusk.hor, t); }
  const light = PAL.golden.light.clone().lerp(PAL.day.light, smooth(2, 22, el));
  return { az: p.azimuth, el, dir, direct, daylight, light, zen, hor };
}

export function useSunLight(): SunLight {
  const date = useUi((s) => s.sun.date), minutes = useUi((s) => s.sun.minutes);
  return useMemo(() => sunLight(date, minutes), [date, minutes]);
}

/** settled value (after `ms` without change) — expensive recomputation (PMREM) not on every slider move */
function useSettled<T>(v: T, ms: number): T {
  const [s, setS] = useState(v);
  useEffect(() => { const h = window.setTimeout(() => setS(v), ms); return () => window.clearTimeout(h); }, [v, ms]);
  return s;
}

/** sky scene for PMREM: gradient + sun glow (direction matching the directional light). One scene per session — a time change
 *  updates only the uniforms (a new material would mean a new shader program and new geometry on every change) */
let skyCache: { scene: THREE.Scene; mat: THREE.ShaderMaterial } | null = null;
function skyScene(sun: SunLight): THREE.Scene {
  if (skyCache) {
    const u = skyCache.mat.uniforms;
    u.zen.value = sun.zen; u.hor.value = sun.hor; u.gnd.value = GROUND.clone().multiplyScalar(0.25 + 0.75 * sun.daylight); u.sun.value = sun.dir; u.k.value = sun.direct;
    return skyCache.scene;
  }
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { zen: { value: sun.zen }, hor: { value: sun.hor }, gnd: { value: GROUND.clone().multiplyScalar(0.25 + 0.75 * sun.daylight) }, sun: { value: sun.dir }, k: { value: sun.direct } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 zen, hor, gnd, sun; uniform float k; varying vec3 vD;
      void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(hor, zen, pow(y, 0.6)) : mix(hor * 0.8, gnd, pow(-y, 0.4));
        float s = max(dot(vD, sun), 0.0); c += vec3(1.0, 0.92, 0.78) * (pow(s, 600.0) * 40.0 + pow(s, 12.0) * 0.35) * k;
        gl_FragColor = vec4(c, 1.0); }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
  skyCache = { scene: s, mat };
  return s;
}

/** one PMREM generator per renderer — creating and disposing it on every time change compiles 2 shader programs after each
 *  release of the clock dial (a noticeable stutter on a phone) */
const pmremOf = new WeakMap<THREE.WebGLRenderer, THREE.PMREMGenerator>();
const pmrem = (gl: THREE.WebGLRenderer) => { let g = pmremOf.get(gl); if (!g) { g = new THREE.PMREMGenerator(gl); pmremOf.set(gl, g); } return g; };

/** IBL: environment map from the sky (recomputed once the time has settled), intensity by mode and daylight */
export function SceneEnvironment({ mode }: { mode: SceneMode }) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  const date = useUi((s) => s.sun.date), minutes = useUi((s) => s.sun.minutes);
  const size = useQualityProfile().envMapSize;
  const key = useSettled(`${date}|${minutes}`, 220);
  const env = useMemo(() => {
    const [d, m] = key.split('|');
    const sky = skyScene(sunLight(d, Number(m)));
    return pmrem(gl).fromScene(sky, 0.02, 0.1, 100, { size }); // the sky scene is shared — not disposed
  }, [gl, key, size]);
  useEffect(() => () => env.dispose(), [env]);
  const sun = useSunLight();
  const indoor = mode.kind === 'room' && mode.roomView !== 'walk' || mode.kind === 'level';
  useEffect(() => {
    scene.environment = env.texture;
    // IBL has no shadows — weaker indoors so sun patches from the windows stay readable
    const base = mode.kind === 'walk' ? 0.7 : mode.kind === 'room' && mode.roomView === 'walk' ? 0.5 : indoor ? 0.45 : 0.9;
    // night: IBL from the navy sky — at least 35 % (night sky light), not black
    scene.environmentIntensity = base * Math.max(0.35, sun.daylight);
    return () => { scene.environment = null; };
  }, [scene, env, indoor, mode.kind, mode.roomView, sun.daylight]);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    const base = mode.kind === 'exterior' ? 1.0 : mode.kind === 'walk' ? 1.04 : 1.08;
    gl.toneMappingExposure = base * (1 + 0.6 * (1 - sun.daylight)); // night: brighter (eye adaptation — readability), but still night
  }, [gl, mode.kind, sun.daylight]);
  return null;
}

/** sky dome (exterior / walk) — gradient and sun glow by time of day, outside the fog */
export function SkyDome() {
  const sun = useSunLight();
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sun: { value: new THREE.Vector3(0, 1, 0) }, k: { value: 1 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 zen, hor, sun; uniform float k; varying vec3 vD;
      void main(){ float y = max(vD.y, 0.0); vec3 c = mix(hor, zen, pow(y, 0.55)); float s = max(dot(vD, sun), 0.0);
        c += vec3(1., .95, .85) * (pow(s, 40.0) * 0.25 + pow(s, 900.0) * 6.0) * k;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), []);
  useEffect(() => {
    mat.uniforms.zen.value.copy(sun.zen); mat.uniforms.hor.value.copy(sun.hor); mat.uniforms.sun.value.copy(sun.dir); mat.uniforms.k.value = sun.direct;
  }, [mat, sun]);
  useEffect(() => () => mat.dispose(), [mat]);
  const cam = useThree((s) => s.camera), ref = useRef<THREE.Mesh>(null);
  useFrame(() => { if (ref.current) ref.current.position.copy(cam.position); });
  return <mesh ref={ref} material={mat} renderOrder={-10} frustumCulled={false} raycast={() => {}}><sphereGeometry args={[1000, 32, 16]} /></mesh>;
}

/** sun with shadows + diffuse light (complementing IBL) */
export function SceneLights({ mode, data, profile }: { mode: SceneMode; data: SceneData; profile: QualityProfile }) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const sun = useSunLight();
  const b = data.bounds;
  const center = useMemo(() => new THREE.Vector3((b.min[0] + b.max[0]) / 2, 0, -(b.min[1] + b.max[1]) / 2), [b]);
  const shadows = profile.shadows, size = profile.shadowMapSize, soft = profile.shadowType === 'pcfsoft';
  const casting = shadows && sun.direct > 0.001;
  sceneApi.sunCasting = casting;
  // shadow camera: interiors — the building only (±13 m, about 1.3 cm / texel at 2048 px); exterior — building and site (±26 m)
  const interior = mode.kind === 'level' || mode.kind === 'room';
  // a building larger than the default range — the shadow camera grows with its outline
  const span = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2;
  const half = interior ? Math.max(13, span + 2) : Math.max(26, span * 2);
  // the shadow map does not depend on the camera — updated only on scene changes: project (furniture, openings, finishes),
  // dragging, mode / section, time (UI state); additionally every 2 s (model loading, editors)
  const shadowDirty = useRef(true), shadowAt = useRef(0);
  useEffect(() => {
    const mark = () => { shadowDirty.current = true; };
    const offs = [design.subscribe(mark), drag.subscribe(mark), ui.subscribe(mark)];
    return () => offs.forEach((f) => f());
  }, []);
  useFrame(() => {
    if (!casting) return;
    const now = performance.now();
    if (shadowDirty.current || drag.get().item || now - shadowAt.current > 2000) {
      gl.shadowMap.needsUpdate = true; shadowDirty.current = false; shadowAt.current = now;
    }
  });
  useEffect(() => { shadowDirty.current = true; }, [mode]);
  const windowView = useUi((s) => s.houseView === 'walk' && !!s.walkGo.windowView);
  useEffect(() => {
    gl.shadowMap.enabled = shadows;
    gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true;
    gl.shadowMap.type = soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // GLASS_HIGH glass: transmission buffer at the profile scale (full resolution = about 40% of GPU time on Iris Xe)
    if (!windowView) gl.transmissionResolutionScale = profile.transmissionScale;
    // toggling shadows requires rebuilding the material programs
    scene.traverse((o) => { const m = (o as THREE.Mesh).material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.needsUpdate = true; }); });
  }, [gl, scene, shadows, soft, profile.transmissionScale]); // eslint-disable-line react-hooks/exhaustive-deps
  // WINDOW VIEW CHECK: the view THROUGH the glass must be sharp (judging neighbours, trees, the horizon) → full-resolution
  // transmission buffer during the check view; on leaving, the profile scale returns
  useEffect(() => { gl.transmissionResolutionScale = windowView ? 1 : profile.transmissionScale; wake(); }, [gl, windowView, profile.transmissionScale]);
  useEffect(() => { sceneApi.sun = sunRef.current; return () => { sceneApi.sun = null; }; }, []);
  useEffect(() => {
    const l = sunRef.current;
    if (!l) return;
    l.shadow.mapSize.set(size, size); l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03; l.shadow.radius = 3;
    l.shadow.map?.dispose(); (l.shadow as unknown as { map: null }).map = null;
    gl.shadowMap.needsUpdate = true;
  }, [size, gl]);
  useEffect(() => {
    const l = sunRef.current;
    if (!l) return;
    l.target.position.copy(center); l.target.updateMatrixWorld();
    l.position.copy(center).addScaledVector(sun.dir, 60);
    const c = l.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 20; c.far = 110; c.updateProjectionMatrix();
    gl.shadowMap.needsUpdate = true;
  }, [center, sun.dir, half, gl]);
  const room = mode.kind === 'room' ? roomById(mode.roomId) : null;
  const walk = mode.kind === 'room' && mode.roomView === 'walk';
  const outdoor = mode.kind === 'exterior' || mode.kind === 'walk';
  const d = sun.daylight, night = 1 - d;
  // interior (section, room, building walk): warm light after dark — artificial lighting instead of the night sky
  const walkKind = useWalkHud((s) => s.kind);
  const indoorNow = !outdoor || (mode.kind === 'walk' && (walkKind === 'room' || walkKind === 'stairs' || walkKind === 'door'));
  const nightSky = indoorNow ? C('#ffe2c2') : C('#9fb3d9'), nightGround = indoorNow ? C('#8a7764') : C('#3c414e');
  // sun intensity: fading near the horizon (longer path through the atmosphere), full from about 30° elevation
  // auxiliary light: interior fill (section / room outside walk mode) and / or moonlight (after dark)
  const fill = !outdoor && !walk, moon = night > 0.02 ? 0.55 * night : 0, fillI = fill ? 0.22 + 0.6 * night : 0;
  const auxIntensity = fillI + moon;
  const auxColor = (fill ? C('#ffffff').lerp(C('#ffd9a8'), night) : C('#b9c7ee')).lerp(C('#b9c7ee'), fill && auxIntensity > 0 ? moon / auxIntensity : 0);
  const intensity = 3.0 * sun.direct * (0.55 + 0.45 * Math.min(1, Math.sin(THREE.MathUtils.degToRad(Math.max(0, sun.el))) / 0.5));
  return (
    <>
      {/* a fixed set of lights — lights not needed at the moment get intensity 0 instead of being unmounted; the sun always casts
          shadows when the profile has shadows (after sunset intensity 0, the shadow map is not updated). Changing the number of
          lights or of shadow-casting lights forces recompiling all materials (a stutter of several seconds at sunset). */}
      <directionalLight ref={sunRef} castShadow={shadows} intensity={intensity} color={sun.light} />
      {/* sky light: bright by day, cool navy at night — the scene is never black */}
      <hemisphereLight color={sun.zen.clone().lerp(C('#dfeaf5'), 0.5 * d).lerp(nightSky, (indoorNow ? 0.85 : 0.6) * night)} groundColor={C('#7b7363').lerp(nightGround, night)}
        intensity={(outdoor ? 0.35 : 0.4) * d + (indoorNow ? 0.7 : 0.75) * night} />
      {/* one auxiliary light instead of two conditionally mounted ones — outside after dark moonlight (cool, from above, no shadows);
          in the section / room a soft fill from above (weaker by day — sun patches from the windows readable, warmer and stronger
          after dark, with moonlight added). A constant number of lights = no shader compilation on mode / time changes */}
      <directionalLight position={fill ? [center.x + 3, 40, center.z + 6] : [center.x - 20, 60, center.z - 25]} intensity={auxIntensity} color={auxColor} />
      {/* point light only in the room walk — a point light with intensity 0 still costs (≈ +1 ms GPU on Iris Xe); entering the walk
          (a rare mode change, continuous rendering) compiles the programs once */}
      {room && walk && <pointLight position={[room.center[0], room.floorZ + 2.2, -room.center[1]]} intensity={1.8 + 2.2 * (1 - d)} distance={10} decay={1.4} color="#fff3e2" />}
    </>
  );
}

const GLOW = new THREE.Color('#ffc274');
/**
 * After dark the windows glow warmly (indoor lighting seen from outside): glass emission by the amount of darkness — in the
 * building view, on photos and in the site walk; from inside (indoor walk, room, section) the glass has no glow.
 * Checked every 0.5 s (openings may be rebuilt in the editors).
 */
export function NightWindows({ mode }: { mode: SceneMode }) {
  const scene = useThree((s) => s.scene);
  const sun = useSunLight();
  const last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current < 500) return;
    last.current = now;
    const outside = mode.kind === 'exterior' || (mode.kind === 'walk' && walkHud.get().kind === 'site');
    const k = outside ? smooth(0.15, 0.85, 1 - sun.daylight) * 0.45 : 0;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || !/glass/i.test(m.name ?? '')) return;
      if (Math.abs(m.emissiveIntensity - k) < 1e-3 && (k === 0 || m.emissive.equals(GLOW))) return;
      m.emissive.copy(GLOW); m.emissiveIntensity = k;
    });
  });
  return null;
}
