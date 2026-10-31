// Configurator RUNTIME SCENE: one Canvas, the scene derived from HOUSE DATA (building model, rooms) and USER DESIGN STATE
// (variant: openings, interiors) and the UI mode (exterior / level section / room). The scene has no project state of its
// own — only transient interaction (drag) and camera state.
import { addAfterEffect, Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useClearOfSceneButtons } from '../ui/clearOfSceneButtons';
import * as THREE from 'three';
import type { SceneData } from './sceneData';
import { resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { axes, obbPoint, pointInPolygon, round } from '@home-sim/core/model/geom2d';
import { furnitureById } from '../model/interiors';
import { roomById, roomsOfLevel, type HomeRoom } from '../model/rooms';
import type { Vec2, Vec3 } from '../model/types';
import { arrangementOf, design, useArrangement } from '../store/design';
import { useDrag } from '../store/drag';
import { createStore } from '../store/createStore';
import { enterRoom, isEditWalk, ui, useQualityProfile, useUi } from '../store/ui';
import { activeProfile, BATTERY_SAVER_FPS, type QualityProfile } from '../quality/profile';
import { adaptiveDebug, adaptiveInfo, createAdaptiveDpr } from '../quality/adaptiveDpr';
import { doorById, leafSegment } from '../model/doors';
import { doors } from '../store/doors';
import { doorMotion } from './doorRuntime';
import { seeUniforms } from '../three/seeThrough';
import { clipState, cutUniforms } from '../three/cutaway';
import { shellStatus } from '../three/coreShell';
import { CameraController } from './CameraController';
import { FurnitureLayer, knobAngle, ringRadius } from './FurnitureLayer';
import { HouseLayer } from './HouseLayer';
import { LabelLayer, LabelProjector, labelError, labelStore, setLabels } from './labels';
import { aliveNow, emitSceneFrame, forceContinuous, renderedFrames, setInvalidate, wake } from './renderLoop';
import { drag } from '../store/drag';
import { RoomCutaway, RoomFinishes, RoomPicks } from './RoomLayer';
import { ElectricalLayer } from './ElectricalLayer';
import { sceneApi, screenOf, wasClick } from './sceneApi';
import { sceneMode, type SceneMode } from './sceneMode';
import { NightWindows, SceneEnvironment, SceneLights, SkyDome, useSunLight } from './Lighting';
import { sunAt, sunDirLcs } from '../model/sun';
import { pbrQuality } from '../three/materials';
import { WalkController, WalkLamp } from './WalkLayer';
import { SplitRenderer } from './CompareRenderer';
import { useSides } from '../store/sides';
import { useLayout } from '../store/layout';
import { CompareOverlay } from '../ui/Compare';
import { walkHud, useWalkHud } from '../store/walk';
import { exitWalk } from '../store/ui';
import { fmtM, fmtNum, t } from '../../i18n';

const SKY = '#cfe0ee', INDOOR = '#eef1f5';

/** performance statistics (Expert mode and __home3d.renderInfo): FPS = frames actually rendered per second (0 when idle with
 *  on-demand rendering), CPU frame time (useFrame + gl.render) mean / p95 over the last 0.5 s */
export const perf = createStore({ fps: 0, frameMs: 0, frameMsP95: 0, calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0,
  dpr: 1, profile: '', backend: '', gpu: '', frameloop: 'demand', renderedFrames: 0 });
/** renderer backend and GPU (WEBGL_debug_renderer_info, when available) */
export function rendererInfo(gl: THREE.WebGLRenderer) {
  const ctx = gl.getContext(), ext = ctx.getExtension('WEBGL_debug_renderer_info');
  return { backend: gl.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1', gpu: String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER)) };
}

/** bridge to the DOM UI and E2E tests */
function SceneBridge() {
  const gl = useThree((s) => s.gl), camera = useThree((s) => s.camera);
  useEffect(() => {
    sceneApi.dom = gl.domElement;
    sceneApi.renderer = rendererInfo(gl);
    // while dragging over the scene, labels do not capture the cursor or change appearance
    const vp = gl.domElement.closest('.hm-viewport');
    const down = (e: PointerEvent) => { sceneApi.downAt = [e.clientX, e.clientY]; vp?.classList.add('hm-dragging'); };
    const up = (e: PointerEvent) => { sceneApi.upAt = [e.clientX, e.clientY]; vp?.classList.remove('hm-dragging'); };
    gl.domElement.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up);
    return () => { gl.domElement.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up); };
  }, [gl]);
  useEffect(() => { sceneApi.camera = camera; }, [camera]);
  const sceneRef = useRef<THREE.Scene | null>(null);
  /** sunlit LCS points — a ray towards the sun through shadow-casting objects (glass lets it through), like the shadow map */
  const sunlitAt = (pts: Vec3[]) => {
    const sc = sceneRef.current, u = ui.get().sun, p = sunAt(u.date, u.minutes);
    if (!sc || p.elevation <= 0) return pts.map(() => ({ lit: false, blocker: 'night' as string | null }));
    const d = sunDirLcs(p.azimuth, p.elevation), dir = new THREE.Vector3(d[0], d[2], -d[1]).normalize();
    const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
    const casters: THREE.Mesh[] = [];
    sc.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.castShadow && shown(m)) casters.push(m); });
    const rc = new THREE.Raycaster();
    return pts.map(([x, y, z]) => {
      rc.set(new THREE.Vector3(x, z, -y), dir); rc.near = 0.02; rc.far = 200;
      const hits: THREE.Intersection[] = [];
      for (const m of casters) THREE.Mesh.prototype.raycast.call(m, rc, hits);
      hits.sort((a, b) => a.distance - b.distance);
      return { lit: hits.length === 0, blocker: hits[0] ? `${hits[0].object.parent?.name ?? ''}/${hits[0].object.name}` : null, at: hits[0] ? [round(hits[0].point.x, 2), round(-hits[0].point.z, 2), round(hits[0].point.y, 2)] : null };
    });
  };
  useEffect(() => {
    const at = (p: Vec3) => screenOf(p);
    (window as unknown as Record<string, unknown>).__home3d = {
      screenOfFurniture(id: string, dz = 0.6) {
        const roomId = ui.get().roomId;
        const a = roomId ? arrangementOf(design.get(), roomId) : null, f = a && furnitureById(a, id), it = f && itemById(f.catalogId), room = roomById(roomId);
        if (!f || !it || !room) return null;
        const d = resolveDims(it, f);
        return at([f.x, f.y, room.floorZ + Math.min(d.h * dz, 1.2)]);
      },
      screenOfRing(id: string) {
        const roomId = ui.get().roomId, room = roomById(roomId);
        const f = room && furnitureById(arrangementOf(design.get(), room.id), id), it = f && itemById(f.catalogId);
        if (!f || !it || !room) return null;
        const d = resolveDims(it, f), r = ringRadius(d), a = (f.rot + knobAngle(room, f, d)) * Math.PI / 180;
        return at([f.x - Math.sin(a) * r, f.y + Math.cos(a) * r, room.floorZ + 0.012]);
      },
      screenOfRoom(id: string) { const r = roomById(id); return r ? at([r.center[0], r.center[1], r.floorZ + 0.02]) : null; },
      screenOfFloor(id: string, x: number, y: number) { const r = roomById(id); return r ? at([x, y, r.floorZ]) : null; },
      screenOfWall(wallId: string, h = 1.3, t = 0.5) {
        const r = roomById(wallId.split('-w')[0]), w = r?.walls.find((q) => q.id === wallId);
        if (!r || !w) return null;
        const s = w.length * t;
        return at([w.a[0] + w.dir[0] * s + w.inward[0] * 0.05, w.a[1] + w.dir[1] * s + w.inward[1] * 0.05, r.floorZ + h]);
      },
      camera() {
        const c = sceneApi.camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
        const r = gl.domElement.getBoundingClientRect();
        // camera and canvas (DOM) aspect — tests wait until the camera adapts to a new scene size (e.g. after opening a panel)
        const dir = c ? c.getWorldDirection(new THREE.Vector3()) : null;
        return c && dir ? { type: c.type, position: [c.position.x, -c.position.z, c.position.y].map((v) => round(v, 3)), dir: [round(dir.x, 4), round(-dir.z, 4), round(dir.y, 4)], fov: c.fov ?? null, zoom: c.zoom,
          aspect: c.isPerspectiveCamera ? round(c.aspect, 4) : round((c.right - c.left) / Math.max(1e-6, c.top - c.bottom), 4), canvasAspect: round(r.width / Math.max(1, r.height), 4) } : null;
      },
      cutaway: () => cutUniforms.uCutCount.value,
      /** generated shell: which one is shown (core solids, grid, model file), its state and cost (worker / main-thread ms, triangles);
       *  rebuild — builds the core shell again from a copy of the building block (budget measurements) */
      shell: (rebuild?: boolean) => { if (rebuild) shellStatus.set({ rebuilds: shellStatus.get().rebuilds + 1, status: 'loading' }); return { ...shellStatus.get() }; },
      /** see-through trees between the camera and the building: state; argument — force (tests compare the same frame with and without the effect) */
      seeThrough(force?: boolean) { if (force !== undefined) { seeUniforms.uSeeOn.value = force ? 1 : 0; wake(); } return { on: seeUniforms.uSeeOn.value > 0.5, patched: (() => { let n = 0; sceneRef.current?.getObjectByName('ENV_TREES')?.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m?.userData?.seeThrough) n++; }); return n; })() }; },
      /** doors: state, animated opening amount, leaf point on screen (tests) */
      doors() { return { show: doors.get().show, open: { ...doors.get().open }, motion: { ...doorMotion.angle } }; },
      /** LCS point → screen pixel (tests) */
      screenOfPoint: (x: number, y: number, z: number) => at([x, y, z]),
      screenOfDoor(id: string, t = 0, h = 1.3, along = 0.5) {
        const d = doorById(id), sg = d ? leafSegment(d, t) : null;
        return d && sg ? at([sg.a[0] + (sg.b[0] - sg.a[0]) * along, sg.a[1] + (sg.b[1] - sg.a[1]) * along, d.floorZ + h]) : null;
      },
      /** depth diagnostics (finishes z-fighting with the slab / wall when zoomed out): sets the camera distance to the target; returns the camera state */
      depthProbe(distance?: number) {
        const c = sceneApi.camera as THREE.PerspectiveCamera | null, t = sceneApi.target;
        if (!c?.isPerspectiveCamera || !t) return null;
        if (distance) c.position.sub(t).setLength(distance).add(t);
        wake();
        return { distance: round(c.position.distanceTo(t), 3), near: round(c.near, 4), far: c.far };
      },
      labelError,
      /** architecture section: [Z] or [] */
      clipping: () => (clipState.cutY === null ? [] : [round(clipState.cutY, 3)]),
      /** objects under a screen point (appearance diagnostics): node name, material, facade zone */
      pickAt(cx: number, cy: number, n = 4) {
        const sc = sceneRef.current, cam = sceneApi.camera, r = gl.domElement.getBoundingClientRect();
        if (!sc || !cam) return [];
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), cam);
        const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
        // also meshes with raycast disabled (openings, helpers) — the Mesh prototype method
        const hits: THREE.Intersection[] = [];
        sc.traverse((o) => { if ((o as THREE.Mesh).isMesh && shown(o)) THREE.Mesh.prototype.raycast.call(o as THREE.Mesh, rc, hits); });
        hits.sort((p, q) => p.distance - q.distance);
        return hits.slice(0, n).map((h) => {
          const z = (h.object as THREE.Mesh).geometry?.getAttribute('aZone');
          const m = (h.object as THREE.Mesh).material as THREE.Material | THREE.Material[];
          return { p: [round(h.point.x, 3), round(-h.point.z, 3), round(h.point.y, 4)], name: h.object.name, parent: h.object.parent?.name ?? '', material: Array.isArray(m) ? m.map((x) => x.name).join(',') : m?.name, zone: z && h.face ? z.getX(h.face.a) : null, d: round(h.distance, 2),
            n: h.face ? (() => { const v = h.face!.normal.clone().transformDirection(h.object.matrixWorld); return [round(v.x, 2), round(-v.z, 2), round(v.y, 2)]; })() : null };
        });
      },
      /** walk state (feet position, eye height, place) */
      walk: () => ({ ...walkHud.get(), mode: ui.get().houseView }),
      /** force a frame (tests) and the rendered frame counter (activity while idle) */
      invalidate: () => wake(),
      renderedFrames,
      /** render diagnostics (read-only): last frame (calls, triangles), GPU memory (geometries, textures, programs), scene
       *  (meshes, vertices, materials, transparent ones, textures with a memory estimate, lights, shadows) */
      renderInfo() {
        const sc = sceneRef.current, info = gl.info;
        const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
        let meshes = 0, visibleMeshes = 0, instanced = 0, instances = 0, vertices = 0, sceneTris = 0, casters = 0, receivers = 0;
        const mats = new Set<THREE.Material>(), texs = new Set<THREE.Texture>(), geos = new Set<THREE.BufferGeometry>(), lights: Record<string, number> = {}, shadowLights: { type: string; map: number }[] = [];
        sc?.traverse((o) => {
          const l = o as THREE.Light & { shadow?: THREE.LightShadow };
          if (l.isLight) { lights[l.type] = (lights[l.type] ?? 0) + 1; if (l.castShadow && shown(l) && l.intensity > 0) shadowLights.push({ type: l.type, map: l.shadow?.mapSize.x ?? 0 }); }
          const m = o as THREE.Mesh & THREE.InstancedMesh;
          if (!m.isMesh) return;
          meshes++;
          geos.add(m.geometry);
          if (!shown(m)) return;
          visibleMeshes++;
          const n = m.isInstancedMesh ? m.count : 1;
          if (m.isInstancedMesh) { instanced++; instances += m.count; }
          const pos = m.geometry.getAttribute('position');
          if (pos) { vertices += pos.count * n; sceneTris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3 * n; }
          if (m.castShadow) casters++;
          if (m.receiveShadow) receivers++;
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            mats.add(mat);
            for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) texs.add(v as THREE.Texture);
          }
        });
        if (sc?.environment) texs.add(sc.environment);
        let texBytes = 0;
        const texList = [...texs].map((t) => {
          const img = (t.image ?? {}) as { width?: number; height?: number }, w = img.width ?? 0, h = img.height ?? 0;
          const bytes = w * h * 4 * (t.generateMipmaps || (t as THREE.Texture & { isCubeTexture?: boolean }).mipmaps?.length ? 4 / 3 : 1);
          texBytes += bytes;
          return { name: t.name || t.constructor.name, w, h };
        });
        const transparent = [...mats].filter((m) => m.transparent).length;
        let geoBytes = 0;
        for (const g of geos) { for (const a of Object.values(g.attributes)) geoBytes += (a as THREE.BufferAttribute).array?.byteLength ?? 0; geoBytes += g.index?.array.byteLength ?? 0; }
        return {
          // backend, quality profile, render mode, rendered frames, the last monitor reading (Expert mode)
          renderer: { ...rendererInfo(gl), profile: activeProfile.current.id, frameloop: forceContinuous ? 'always' : 'demand', renderedFrames: renderedFrames(), monitor: perf.get() },
          frame: { calls: info.render.calls, triangles: info.render.triangles, lines: info.render.lines, points: info.render.points },
          memory: { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 },
          scene: { meshes, visibleMeshes, instancedMeshes: instanced, instances, vertices: Math.round(vertices), triangles: Math.round(sceneTris), materials: mats.size, transparentMaterials: transparent,
            geometries: geos.size, geometryMB: Math.round(geoBytes / 1048576 * 10) / 10, textures: texs.size, textureMB: Math.round(texBytes / 1048576 * 10) / 10, largestTextures: texList.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 5), castShadow: casters, receiveShadow: receivers },
          lights, shadowLights, shadowMapEnabled: gl.shadowMap.enabled, shadowType: gl.shadowMap.type,
          pixelRatio: gl.getPixelRatio(), canvas: [gl.domElement.width, gl.domElement.height],
        };
      },
            /** sun — date, time, azimuth / elevation, direction (LCS), intensity, shadows, shadow camera, IBL */
      sun() {
        const u = ui.get().sun, p = sunAt(u.date, u.minutes), l = sceneApi.sun, c = l?.shadow.camera as THREE.OrthographicCamera | undefined;
        const sc = sceneRef.current;
        return { date: u.date, minutes: u.minutes, az: round(p.azimuth, 2), el: round(p.elevation, 2), dir: sunDirLcs(p.azimuth, p.elevation).map((v) => round(v, 4)),
          intensity: l ? round(l.intensity, 3) : null, castShadow: sceneApi.sunCasting, castShadowFlag: !!l?.castShadow, shadowMap: gl.shadowMap.enabled, shadowAuto: gl.shadowMap.autoUpdate,
          shadowHalf: c ? c.right : null, mapSize: l ? l.shadow.mapSize.x : null, envIntensity: sc ? round(sc.environmentIntensity, 3) : null,
          lightDir: l ? (() => { const v = l.position.clone().sub(l.target.position).normalize(); return [round(v.x, 4), round(-v.z, 4), round(v.y, 4)]; })() : null };
      },
      /** whether an LCS point sees the sun — a ray towards the sun through shadow-casting objects (glass lets it through) */
      sunlit(x: number, y: number, z: number) { return sunlitAt([[x, y, z]])[0]; },
      /** sunlit share of a room floor (point grid every `step` m, 5 cm above the floor) */
      sunlitRoom(roomId: string, step = 0.25) {
        const r = roomById(roomId), api = (window as unknown as { __home3d: { sunlit: (x: number, y: number, z: number) => { lit: boolean } } }).__home3d;
        if (!r) return null;
        void api;
        const pts: Vec3[] = [];
        for (let x = r.bbox[0] + step / 2; x < r.bbox[2]; x += step) for (let y = r.bbox[1] + step / 2; y < r.bbox[3]; y += step) if (pointInPolygon([x, y], r.polygon, 0)) pts.push([x, y, r.floorZ + 0.05]);
        const lit = sunlitAt(pts).filter((q) => q.lit).length;
        return { n: pts.length, lit, fraction: pts.length ? round(lit / pts.length, 3) : 0 };
      },
      /** ceiling height (underside of the roof slope) at a room point — LCS Z */
      ceilingAt(roomId: string, x: number, y: number) { const r = roomById(roomId); return r ? round(r.floorZ + r.ceiling.heightAt(x, y), 3) : null; },
      /** image pixel at a screen point (drawing buffer) [r, g, b] */
      pixel(cx: number, cy: number) {
        const cv = gl.domElement, r = cv.getBoundingClientRect(), k = cv.width / r.width;
        const ctx = gl.getContext(), px = new Uint8Array(4);
        ctx.readPixels(Math.round((cx - r.left) * k), Math.round(cv.height - (cy - r.top) * k), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]];
      },
      /** terrain height at an LCS point (walk probe) */
      ground: (x: number, y: number) => sceneApi.ground(x, y),
      /** facade zones, IBL, shadows, tone mapping, glass */
      visual() {
        const sc = sceneRef.current;
        let transmission = 0, glass = 0;
        sc?.traverse((o: THREE.Object3D) => {
          const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
          if (m && /glass/i.test(m.name ?? '')) { glass++; if (m.transmission > 0) transmission++; }
        });
        return { environment: !!sc?.environment, shadows: gl.shadowMap.enabled, toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure, glass, transmission, quality: ui.get().quality, profile: activeProfile.current.id, dpr: gl.getPixelRatio(), dprRange: activeProfile.current.dpr, adaptive: adaptiveInfo.current?.info() ?? null, batterySaver: ui.get().batterySaver && ui.get().platform === 'mobile', transmissionScale: gl.transmissionResolutionScale, neutral: ui.get().neutralInterior };
      },
    };
  }, [gl]);
  const scene = useThree((s) => s.scene);
  sceneRef.current = scene;
  useEffect(() => { (window as unknown as { __homeScene?: THREE.Scene }).__homeScene = scene; }, [scene]);
  return null;
}

/**
 * Frame scheduling for on-demand rendering (renderLoop.ts). App state change → wake(); in walk mode — continuous mode.
 * Every rendered frame notifies the camera-dependent DOM listeners (compass rose).
 */
function RenderScheduler({ continuous }: { continuous: boolean }) {
  const invalidate = useThree((s) => s.invalidate), setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => { setInvalidate(() => invalidate()); wake(3000); return () => setInvalidate(null); }, [invalidate]);
  useEffect(() => { setFrameloop(continuous || forceContinuous ? 'always' : 'demand'); wake(); }, [continuous, setFrameloop]);
  useEffect(() => {
    const w = () => wake();
    const offs = [design.subscribe(w), ui.subscribe(w), drag.subscribe(w), labelStore.subscribe(w)];
    return () => offs.forEach((f) => f());
  }, []);
  useFrame(() => { emitSceneFrame(); if (aliveNow()) invalidate(); });
  return null;
}

/**
 * Frame cap ("Battery saver"). Takes over scene drawing (useFrame with priority) and skips frames more frequent than 1/fps —
 * on a 120 Hz screen every other frame is drawn (half the GPU work), the rest of the frame logic (camera, walk) is unchanged.
 * A skipped frame requests the next one, so the latest change always reaches the screen. Mounted only when the mode is on
 * (default render path unchanged); the A/B comparison has its own drawing — the cap does not apply there.
 */
function FrameCap({ fps }: { fps: number }) {
  const last = useRef(0);
  useFrame(({ gl, scene, camera, invalidate }) => {
    const now = performance.now();
    if (now - last.current < 1000 / fps - 3) { invalidate(); return; }
    last.current = now;
    gl.render(scene, camera);
  }, 1);
  return null;
}

/**
 * Adaptive canvas DPR on mobile devices (logic: quality/adaptiveDpr.ts). Only within the DPR range of the active profile — the
 * profile chosen by the user does not change. Computed from intervals between rendered frames, so no cost while idle.
 */
function AdaptiveDpr({ profile, enabled, onChange }: { profile: QualityProfile; enabled: boolean; onChange: (dpr: number | null) => void }) {
  const ctl = useMemo(() => {
    if (!enabled || !profile.adaptiveDpr || adaptiveDebug.off) return null;
    const max = Math.min(profile.dpr[1], Math.max(profile.dpr[0], window.devicePixelRatio || 1));
    return createAdaptiveDpr({ min: profile.dpr[0], max, ...(adaptiveDebug.downP95Ms ? { downP95Ms: adaptiveDebug.downP95Ms, upP95Ms: adaptiveDebug.downP95Ms * 0.8 } : {}) });
  }, [profile, enabled]);
  useEffect(() => { adaptiveInfo.current = ctl; onChange(null); return () => { adaptiveInfo.current = null; }; }, [ctl, onChange]);
  useFrame(() => {
    if (!ctl) return;
    const d = ctl.frame(performance.now());
    if (d !== null) { onChange(d); wake(); }
  });
  return null;
}

/** render statistics (Expert mode) — no cost in Home mode (measurement off) */
function PerfProbe() {
  const gl = useThree((s) => s.gl), frameloop = useThree((s) => s.frameloop);
  const on = useUi((s) => s.mode === 'advanced');
  const st = useMemo(() => ({ t0: 0, times: [] as number[], at: performance.now() }), []);
  useFrame(() => { st.t0 = performance.now(); }, -1000); // frame start (before the other useFrame callbacks)
  useEffect(() => (on ? addAfterEffect(() => { if (st.t0) st.times.push(performance.now() - st.t0); st.t0 = 0; }) : undefined), [on, st]);
  useEffect(() => {
    if (!on) return;
    const info = rendererInfo(gl);
    const h = window.setInterval(() => {
      const now = performance.now(), dt = now - st.at, t = [...st.times].sort((a, b) => a - b), i = gl.info;
      const r2 = (x: number) => Math.round(x * 100) / 100;
      perf.set({ fps: Math.round((t.length * 1000) / Math.max(1, dt)), frameMs: t.length ? r2(t.reduce((a, b) => a + b, 0) / t.length) : 0, frameMsP95: t.length ? r2(t[Math.min(t.length - 1, Math.floor(t.length * 0.95))]) : 0,
        calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0,
        dpr: gl.getPixelRatio(), profile: activeProfile.current.id, ...info, frameloop, renderedFrames: renderedFrames() });
      st.times = []; st.at = now;
    }, 500);
    return () => window.clearInterval(h);
  }, [on, gl, st, frameloop]);
  return null;
}

/** room labels in the level section (click = enter the room) */
function RoomLabels({ mode }: { mode: SceneMode }) {
  const hover = useUi((s) => s.hoverRoom);
  // mobile layout: labels of all rooms would cover the section (and capture pinches) — only the label of the room selected by a
  // tap remains; room names are on the plan and in the drawer list
  const mobile = useLayout((s) => s.mobile), selRoom = useUi((s) => (s.selection?.kind === 'room' ? s.selection.roomId : null));
  useEffect(() => {
    if (mode.kind !== 'level') { setLabels('rooms', []); return; }
    setLabels('rooms', roomsOfLevel(mode.level).filter((r) => !mobile || r.id === selRoom).map((r) => ({
      id: `room-${r.id}`, kind: 'room', pos: [r.center[0], r.center[1], r.floorZ + 0.1] as Vec3, active: hover === r.id, testid: `room-label-${r.id}`,
      text: <><b>{r.label}</b><span>{fmtNum(r.area, 1)} m²</span></>,
      onClick: () => enterRoom(r.id, r.level),
    })));
  }, [mode.kind, mode.level, hover, mobile, selRoom]);
  useEffect(() => () => setLabels('rooms', []), []);
  return null;
}

/** distance from a point along a direction to the room outline */
function rayToPolygon(p: Vec2, d: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], e: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const ap: Vec2 = [a[0] - p[0], a[1] - p[1]];
    const t = (ap[0] * e[1] - ap[1] * e[0]) / den, s = (ap[0] * d[1] - ap[1] * d[0]) / den;
    if (t > -1e-6 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, Math.max(0, t));
  }
  return best;
}

const MEASURE = new THREE.LineBasicMaterial({ color: '#2f6fed', depthTest: false, transparent: true });
/** dimensions from the selected furniture to the walls (cm) — also while dragging */
function MeasureLayer({ room, view }: { room: HomeRoom; view: SceneMode['roomView'] }) {
  const sel = useUi((s) => (s.selection?.kind === 'furniture' && s.selection.roomId === room.id ? s.selection.id : null));
  const a = useArrangement(room.id);
  const draft = useDrag((s) => (s.item && s.item.id === sel ? s.item : null));
  const f = sel ? furnitureById(a, sel) : null, it = f && itemById(f.catalogId);
  const segs = useMemo(() => {
    if (!f || !it || view === 'walk') return [];
    const d = resolveDims(it, f), x = draft?.x ?? f.x, y = draft?.y ?? f.y, rot = draft?.rot ?? f.rot;
    const o = { c: [x, y] as Vec2, hw: d.w / 2, hd: d.d / 2, rot }, { ux, uy } = axes(rot);
    const out: { a: Vec2; b: Vec2; len: number; key: string }[] = [];
    for (const [key, dir, u, v] of [['r', ux, 1, 0], ['l', [-ux[0], -ux[1]], -1, 0], ['f', uy, 0, 1], ['b', [-uy[0], -uy[1]], 0, -1]] as [string, Vec2, number, number][]) {
      const p = obbPoint(o, u * o.hw, v * o.hd), t = rayToPolygon(p, dir, room.polygon);
      if (!Number.isFinite(t) || t > 6) continue;
      out.push({ a: p, b: [p[0] + dir[0] * t, p[1] + dir[1] * t], len: t, key });
    }
    return out;
  }, [f, it, draft, room, view]);
  useEffect(() => {
    setLabels('measure', segs.filter((s) => s.len >= 0.005).map((s) => ({
      id: `m-${s.key}`, kind: 'dim', pos: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, room.floorZ + 0.03] as Vec3,
      text: `${s.len < 0.1 ? fmtNum(Math.round(s.len * 1000) / 10, 1) : Math.round(s.len * 100)} cm`, testid: `measure-${s.key}`,
    })));
  }, [segs, room]);
  useEffect(() => () => setLabels('measure', []), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs.flatMap((s) => [s.a[0], room.floorZ + 0.02, -s.a[1], s.b[0], room.floorZ + 0.02, -s.b[1]]), 3));
    return g;
  }, [segs, room]);
  useEffect(() => () => geo.dispose(), [geo]);
  return segs.length ? <lineSegments geometry={geo} material={MEASURE} renderOrder={12} raycast={() => {}} /> : null;
}


/** walk bar: the place and one sentence on how to walk (the hint of the walk, ADR 0043); advanced mode adds the feet level and
 *  every key; on a desktop the exit */
function WalkHudBar() {
  const place = useWalkHud((s) => s.place), z = useWalkHud((s) => s.z), on = useWalkHud((s) => s.on);
  const touch = useLayout((s) => s.coarse);
  const advanced = useUi((s) => s.mode === 'advanced');
  const selFurniture = useUi((s) => s.selection?.kind === 'furniture');
  const ref = useRef<HTMLDivElement>(null);
  useClearOfSceneButtons(ref, `${on}-${touch}-${advanced}`);
  if (!on) return null;
  const hint = t(`steps.hint.${selFurniture ? 'selected' : 'walk'}${touch ? 'Touch' : ''}`);
  // touch: the place and the sentence (the joystick and exit are under the thumbs at the bottom of the screen)
  if (touch) return <div ref={ref} className="hm-walk-hud touch" data-testid="walk-hud"><b data-testid="walk-place">{place}</b><span className="hm-muted" data-testid="walk-help">{hint}</span></div>;
  return (
    <div ref={ref} className="hm-walk-hud" data-testid="walk-hud">
      <b data-testid="walk-place">{place}</b>
      {advanced && <span>{t('walkHud.feetLevel', { z: fmtM(Math.round(z * 100) / 100, 2) })}</span>}
      {/* selected furniture: what can be done with it (in walk mode the selected furniture is moved) */}
      <span className="hm-muted" data-testid="walk-help">{advanced ? (selFurniture ? t('walkHud.helpSelected') : t('walkHud.help')) : hint}</span>
      <button className="hm-btn" onClick={exitWalk} data-testid="walk-exit">{t('walkHud.exit')}</button>
    </div>
  );
}

/** background and fog: horizon colour from the sun (a separate component — a time change re-renders only it, not the whole HomeCanvas) */
function Backdrop({ environment, indoor }: { environment: boolean; indoor: string }) {
  const hor = useSunLight().hor;
  const sky = `#${hor.getHexString()}`;
  return <>
    <color attach="background" args={[environment ? sky : indoor]} />
    {/* fog always in the scene (without surroundings — beyond the view range): removing the fog changes the program variant of
        every material — entering Interiors would compile dozens of shader programs */}
    <fog attach="fog" args={[sky, environment ? 450 : 1e7, environment ? 5200 : 2e7]} />
  </>;
}

export function HomeCanvas({ data }: { data: SceneData }) {
  const houseView = useUi((s) => s.houseView), level = useUi((s) => s.level), roomId = useUi((s) => s.roomId), roomView = useUi((s) => s.roomView), env = useUi((s) => s.environment);
  const compare = useUi((s) => !!s.compare);
  const sides = useSides();
  // walk started in a room: the room underfoot stays the edited room — walls and floor react as in the room walk
  const walkRoomId = useWalkHud((s) => s.roomId), editWalk = useUi(isEditWalk);
  const mode = useMemo(() => sceneMode({ houseView, level, roomId, roomView, environment: env, walkRoomId: editWalk ? walkRoomId : null }), [houseView, level, roomId, roomView, env, editWalk, walkRoomId]);
  const view = useRef<HTMLDivElement>(null);
  const room = roomById(mode.roomId);
  const bg0 = mode.environment ? SKY : INDOOR;
  // quality profile — set before rendering the scene layers (texture / material generators read it outside React)
  const profile = useQualityProfile();
  activeProfile.current = profile;
  pbrQuality.maps = profile.pbrMaps;
  // adaptive DPR (mobile profiles) — null = the profile range (R3F clamps devicePixelRatio to [min, max])
  const mobile = useUi((s) => s.platform === 'mobile');
  const [adaptDpr, setAdaptDpr] = useState<number | null>(null);
  const saver = useUi((s) => s.batterySaver) && mobile;
  // A ↔ B comparison in the mobile layout — one side at a time (half the draw calls, full frame)
  const single = useUi((s) => s.compareSide);
  const mobileLayout = useLayout((s) => s.mobile);
  return (
    <div className="hm-viewport" data-testid="viewport" data-mode={mode.kind} data-view={mode.roomView} data-compare={compare ? 'on' : undefined} ref={view}>
      <div className="hm-canvas-frame" data-testid="canvas-frame">
      <Canvas className="hm-canvas" frameloop={forceContinuous ? 'always' : 'demand'} dpr={adaptDpr ?? profile.dpr} shadows={profile.shadows} camera={{ fov: 40, near: 0.1, far: 6000, position: [-30, 18, 20] }}
        gl={{ antialias: profile.antialias, localClippingEnabled: true, preserveDrawingBuffer: true, stencil: true }}
        onPointerMissed={(e) => { if (wasClick(e.clientX, e.clientY) && !sceneApi.locked) ui.set({ selection: null }); }}>
        <SceneBridge />
        <AdaptiveDpr profile={profile} enabled={mobile} onChange={setAdaptDpr} />
        {saver && !compare && <FrameCap fps={BATTERY_SAVER_FPS} />}
        <RenderScheduler continuous={mode.kind === 'walk' || (mode.kind === 'room' && mode.roomView === 'walk')} />
        <Backdrop environment={mode.environment} indoor={bg0} />
        <SceneEnvironment mode={mode} />
        <SceneLights mode={mode} data={data} profile={profile} />
        <NightWindows mode={mode} />
        {/* sky dome always mounted, hidden indoors (remounting = a new material and shader compilation) */}
        <group visible={mode.environment}><SkyDome /></group>
        <Suspense fallback={null}>
          <HouseLayer data={data} mode={mode} />
        </Suspense>
        {compare ? sides.map((sd) => <group key={sd.id} name={`SIDE_${sd.id}`}><RoomFinishes mode={mode} interiors={sd.interiors} interactive={false} /></group>)
          : <group name="SIDE_A"><RoomFinishes mode={mode} /></group>}
        {mode.kind === 'level' && <RoomPicks level={mode.level} />}
        {compare ? sides.map((sd) => <group key={sd.id} name={`SIDE_${sd.id}`}><FurnitureLayer mode={mode} interiors={sd.interiors} interactive={false} /></group>)
          : <group name="SIDE_A"><FurnitureLayer mode={mode} /></group>}
        {compare && sides.length === 2 && <SplitRenderer sides={sides} single={mobileLayout ? single : null} />}
        {/* electrical / smart home points (Electrical section) */}
        <ElectricalLayer mode={mode} />
        <RoomCutaway mode={mode} />
        <CameraController data={data} mode={mode} />
        <WalkController data={data} mode={mode} />
        <WalkLamp mode={mode} />
        {room && <MeasureLayer room={room} view={mode.roomView} />}
        <RoomLabels mode={mode} />
        <LabelProjector />
        <PerfProbe />
      </Canvas>
      </div>
      {compare && sides.length === 2 && <CompareOverlay sides={sides} single={mobileLayout ? single : null} />}
      <WalkHudBar />
      <LabelLayer />
    </div>
  );
}
