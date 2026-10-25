// Section caps for cut walls (after testing on a phone — "flickering between rooms, as if inside the walls").
// The level section cuts the walls at the section height and from above the INSIDE of the wall solids was visible: the inner
// faces of adjacent solids lie in the same plane and z-fought (stripes flashing for one frame on every camera move). Now cut
// walls and chimneys are closed with a uniform cut plane, as in an architectural drawing:
//   1) back faces of the solids increment the stencil buffer, front faces decrement it (no colour or depth) — inside a solid ≠ 0,
//   2) a plane at the cut height is drawn only where the stencil ≠ 0.
// Only the wall and chimney meshes of the current level (a few meshes × 2 passes). The stencil and plane pass materials get the
// same cutaway patch as the architecture (walls hidden in Room Mode leave no floating "caps").
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { project } from '../../project/active';
import { archPlane, CAP_COLOR, CUTAWAY, cutUniforms, patchMaterial } from '../three/cutaway';
import { roomById } from '../model/rooms';
export { CAP_COLOR };
import type { SceneMode } from './sceneMode';
import { wake } from './renderLoop';

/** shell meshes cut by the section of a given level: by the model naming convention of the project package (assets.sectionCaps)
 *  or the marker of the generated shell (userData.capLevel — scene/ShellLayer.tsx) */
export function capSources(level: string) {
  const prefixes = project().assets?.sectionCaps?.[level] ?? [];
  return (o: THREE.Object3D) => (o.userData as { capLevel?: string }).capLevel === level || prefixes.some((p) => o.name.startsWith(p));
}

const stencil = (side: THREE.Side, op: THREE.StencilOp, name: string) => {
  const m = new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false, name });
  m.stencilWrite = true; m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilFail = op; m.stencilZFail = op; m.stencilZPass = op;
  m.clippingPlanes = [archPlane];
  patchMaterial(m);
  return m;
};
const BACK = stencil(THREE.BackSide, THREE.IncrementWrapStencilOp, 'MAT_SectionCap_Back');
const FRONT = stencil(THREE.FrontSide, THREE.DecrementWrapStencilOp, 'MAT_SectionCap_Front');
const CAP = (() => {
  const m = new THREE.MeshBasicMaterial({ color: CAP_COLOR, name: 'MAT_SectionCap' });
  m.stencilWrite = true; m.stencilRef = 0; m.stencilFunc = THREE.NotEqualStencilFunc;
  m.stencilFail = THREE.ReplaceStencilOp; m.stencilZFail = THREE.ReplaceStencilOp; m.stencilZPass = THREE.ReplaceStencilOp;
  patchMaterial(m);
  return m;
})();
const PLANE = new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2);
// Plinths of cut-away walls (Room Mode 3D): wall solids are kept up to 8 cm above the floor and were open at the top — inside,
// the coplanar faces of adjacent solids showed (flickering room edges on a phone). A second cap with the same method at plinth
// height: stencil computed from solids clipped by the plinth plane (no cutaway patch), the plane just below the top.
const plinthPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const plinthStencil = (side: THREE.Side, op: THREE.StencilOp, name: string) => {
  const m = new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false, name });
  m.stencilWrite = true; m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilFail = op; m.stencilZFail = op; m.stencilZPass = op;
  m.clippingPlanes = [plinthPlane];
  return m;
};
const P_BACK = plinthStencil(THREE.BackSide, THREE.IncrementWrapStencilOp, 'MAT_PlinthCap_Back');
const P_FRONT = plinthStencil(THREE.FrontSide, THREE.DecrementWrapStencilOp, 'MAT_PlinthCap_Front');
const P_CAP = (() => {
  const m = new THREE.MeshBasicMaterial({ color: CAP_COLOR, name: 'MAT_PlinthCap' });
  m.stencilWrite = true; m.stencilRef = 0; m.stencilFunc = THREE.NotEqualStencilFunc;
  m.stencilFail = THREE.ReplaceStencilOp; m.stencilZFail = THREE.ReplaceStencilOp; m.stencilZPass = THREE.ReplaceStencilOp;
  return m;
})();
const PLANE_P = new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2);
/** solids other than walls that the room cutaway on a given level opens at the top (mesh names of the project package model) */
export function plinthExtra(level: string) {
  const names = project().assets?.plinthExtra?.[level] ?? [];
  return (name: string) => names.includes(name);
}
const box = new THREE.Box3(), one = new THREE.Box3(), centre = new THREE.Vector3(), size = new THREE.Vector3();
/** cap plane over the cut solids: centre of their bounds, size with a margin (base geometry 80 × 80 m) */
function coverSources(plane: THREE.Mesh, src: THREE.Mesh[], y: number) {
  box.makeEmpty();
  for (const m of src) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(one.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
  }
  box.getCenter(centre); box.getSize(size);
  const k = Math.max(1, (Math.max(size.x, size.z) + 8) / 80);
  plane.position.set(centre.x, y, centre.z); plane.scale.set(k, 1, k);
}
const noRay = () => {};

export function SectionCaps({ mode }: { mode: SceneMode }) {
  const scene = useThree((s) => s.scene), gl = useThree((s) => s.gl);
  const group = useMemo(() => { const g = new THREE.Group(); g.name = 'HOME_SECTION_CAPS'; return g; }, []);
  const state = useRef({ key: '', at: -1e9 });
  const cut = mode.cutZ, level = mode.level;
  // plinths: only a room in 3D view (where the cutaway of hiding walls applies)
  const plinthRoom = mode.kind === 'room' && mode.roomView === '3d' ? mode.roomId : null;
  useEffect(() => { state.current.key = ''; wake(); }, [cut, level, plinthRoom]);
  useFrame(() => {
    const pl = group.getObjectByName('CAP_PLINTH');
    if (pl) pl.visible = cutUniforms.uCutCount.value > 0;                    // no cut-away walls — no extra passes
    const st = state.current, now = performance.now(), key = cut === null ? 'off' : `${level}|${cut}|${plinthRoom ?? ''}`;
    if (st.key === key || now - st.at < 300) return;
    st.at = now;
    group.clear();
    if (cut === null) { st.key = key; return; }
    const house = scene.getObjectByName('HOUSE');
    if (!house) return;                                                     // model still loading
    const want = capSources(level), src: THREE.Mesh[] = [];
    house.traverse((o) => { if ((o as THREE.Mesh).isMesh && want(o)) src.push(o as THREE.Mesh); });
    if (!src.length) return;
    for (const m of src) {
      m.updateWorldMatrix(true, false);
      for (const mat of [BACK, FRONT]) {
        const h = new THREE.Mesh(m.geometry, mat);
        h.name = `CAP_STENCIL_${m.name}`; h.matrixAutoUpdate = false; h.matrix.copy(m.matrixWorld); h.renderOrder = 1; h.raycast = noRay; h.frustumCulled = false;
        group.add(h);
      }
    }
    // just below the cut plane (the cut plane itself would clip it); after drawing — clear the stencil buffer
    const cap = new THREE.Mesh(PLANE, CAP);
    cap.name = 'CAP_PLANE'; coverSources(cap, src, cut - 0.001); cap.renderOrder = 1.1; cap.raycast = noRay;
    // the glass transmission pass draws opaque objects into its own buffer WITHOUT a stencil — there the plane would cover
    // everything below it (glass would show a dark sheet): the plane is not drawn outside the main frame buffer
    cap.onBeforeRender = (r) => { PLANE.setDrawRange(0, r.getRenderTarget() ? 0 : Infinity); };
    cap.onAfterRender = (r) => { if (!r.getRenderTarget()) r.clearStencil(); };
    group.add(cap);
    const room = roomById(plinthRoom);
    if (room) {
      // the cutaway may also open solids other than walls (e.g. flat roof layers and a parapet whose underside lies in the ceiling plane)
      const psrc = [...src];
      const extra = plinthExtra(level);
      house.traverse((o) => { if ((o as THREE.Mesh).isMesh && extra(o.name)) psrc.push(o as THREE.Mesh); });
      const y = room.floorZ + CUTAWAY.keep, pg = new THREE.Group();
      pg.name = 'CAP_PLINTH'; pg.visible = cutUniforms.uCutCount.value > 0;
      plinthPlane.constant = y;
      for (const m of psrc) for (const mat of [P_BACK, P_FRONT]) {
        m.updateWorldMatrix(true, false);
        const h = new THREE.Mesh(m.geometry, mat);
        h.name = `CAP_PLINTH_STENCIL_${m.name}`; h.matrixAutoUpdate = false; h.matrix.copy(m.matrixWorld); h.renderOrder = 1.2; h.raycast = noRay; h.frustumCulled = false;
        pg.add(h);
      }
      const pc = new THREE.Mesh(PLANE_P, P_CAP);
      pc.name = 'CAP_PLINTH_PLANE'; coverSources(pc, psrc, y - 0.0005); pc.renderOrder = 1.3; pc.raycast = noRay;
      pc.onBeforeRender = (r) => { PLANE_P.setDrawRange(0, r.getRenderTarget() ? 0 : Infinity); };
      pc.onAfterRender = (r) => { if (!r.getRenderTarget()) r.clearStencil(); };
      pg.add(pc);
      group.add(pg);
    }
    st.key = key;
    wake();
  });
  useEffect(() => () => { group.clear(); }, [group]);
  // without a stencil buffer (context without stencil) caps do not work — then nothing is drawn
  const ok = gl.getContextAttributes()?.stencil !== false;
  return ok ? <primitive object={group} /> : null;
}
