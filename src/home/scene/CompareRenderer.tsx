// A/B comparison — split screen in one Canvas: left half — side A, right half — side B.
// Same camera (aspect of half the frame), same lights, shadows, sky and surroundings; before each half only the variant data is
// switched: visibility of the SIDE_A / SIDE_B groups (openings, finishes, furniture) and facade materials (uniforms). Each side
// has its own shadow map (shadows of that variant's openings and furniture), updated only on change. Scene pointer events are
// disabled — the comparison is for viewing (camera rotate / zoom acts on both halves at once).
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Side } from '../store/sides';
import { sceneApi } from './sceneApi';

/** single — mobile layout: only the given side is drawn over the whole canvas (A ↔ B via a toggle, same camera) */
export function SplitRenderer({ sides, single = null }: { sides: Side[]; single?: Side['id'] | null }) {
  const setEvents = useThree((s) => s.setEvents), camera = useThree((s) => s.camera), size = useThree((s) => s.size);
  const sizeRef = useRef(size); sizeRef.current = size;
  useEffect(() => { setEvents({ enabled: false }); return () => setEvents({ enabled: true }); }, [setEvents]);
  // a separate shadow map per side — updated only on change (project, sun, periodic refresh from SceneLights), not before each
  // half in every frame (that would mean 2 shadow passes per frame even while merely rotating the camera)
  const maps = useRef<Partial<Record<Side['id'], THREE.WebGLRenderTarget>>>({});
  useEffect(() => () => {
    const l = sceneApi.sun, m = maps.current;
    if (l && m.A) l.shadow.map = m.A;
    for (const [k, rt] of Object.entries(m)) if (rt && !(k === 'A' && l)) rt.dispose();
    maps.current = {};
  }, []);
  // when the comparison ends — full camera aspect
  useEffect(() => () => {
    const c = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera, { width, height } = sizeRef.current;
    if (c.isPerspectiveCamera) c.aspect = width / Math.max(1, height);
    else { c.left = -width / 2; c.right = width / 2; }
    c.updateProjectionMatrix();
  }, [camera]);
  useFrame((state) => {
    const { gl, scene } = state, cam = state.camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    const w = state.size.width, h = state.size.height, half = single ? w : Math.floor(w / 2);
    const A = scene.getObjectsByProperty('name', 'SIDE_A'), B = scene.getObjectsByProperty('name', 'SIDE_B');
    if (cam.isPerspectiveCamera) cam.aspect = half / Math.max(1, h);
    else { cam.left = -half / 2; cam.right = half / 2; }
    cam.updateProjectionMatrix();
    gl.setScissorTest(true);
    const light = sceneApi.sun, dirty = gl.shadowMap.needsUpdate; // requested by SceneLights (priority 0 — runs before this code)
    if (light?.shadow.map && !maps.current.A && !maps.current.B) maps.current.A = light.shadow.map; // the map from before the comparison — side A
    (single ? sides.filter((x) => x.id === single) : sides).forEach((sd, i) => {
      for (const o of A) o.visible = sd.id === 'A';
      for (const o of B) o.visible = sd.id === 'B';
      if (gl.shadowMap.enabled && light) {
        const rt = maps.current[sd.id], ok = rt && rt.width === light.shadow.mapSize.x;
        (light.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = ok ? rt! : null; // none → three creates a new one
        if (rt && !ok) rt.dispose();
        gl.shadowMap.needsUpdate = dirty || !ok;
      }
      const x = single || i === 0 ? 0 : half, ww = single ? w : i === 0 ? half : w - half;
      gl.setViewport(x, 0, ww, h); gl.setScissor(x, 0, ww, h);
      gl.render(scene, cam);
      if (light?.shadow.map) maps.current[sd.id] = light.shadow.map;
    });
    gl.setScissorTest(false);
    gl.setViewport(0, 0, w, h);
    for (const o of A) o.visible = true;
  }, 1);
  // side / mode change: new frame (on-demand rendering)
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [single, invalidate]);
  return null;
}
