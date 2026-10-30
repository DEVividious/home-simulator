// Hiding elements that obstruct the interior — without changing the building geometry:
// (1) horizontal section of the architecture (archPlane in the materials of the building model, joinery and surface finishes —
//     furniture, the plot and the surroundings are not clipped);
// (2) wall cutaway in 3D Room Mode: room walls facing the camera (camera on the outer side of the wall face) and a 3 m band
//     behind them disappear above a plinth; under a sloped roof also the roof slope above the room next to those walls (below
//     the section) — like a scale model with a wall removed. Fragments inside the cutaway boxes are discarded in the shader
//     (onBeforeCompile).
// Architecture raycasts are filtered the same way (a click hits what is visible). With no active cutaways the cost is ≈ 0.
import * as THREE from 'three';
import { allLevels, type HomeRoom } from '../model/rooms';

/** horizontal section of the architecture (three.js world: y ≤ constant is kept); no section — very high (no recompilation) */
export const archPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
export const ARCH_PLANES = [archPlane];

export const CUT_MAX = 12;
/** wall section colour (the cutting plane — scene/SectionCaps.tsx — and the plinths of cut-away walls) */
export const CAP_COLOR = '#4b5058';
export const cutUniforms = {
  uCutCount: { value: 0 },
  uCutBoxes: { value: Array.from({ length: CUT_MAX }, () => new THREE.Matrix4()) },
  /** floor level (world Y) for wall cutaways — the plinth below the cutaway is painted in the section colour; −1e6: no plinth (roof slope) */
  uCutFloor: { value: new Array<number>(CUT_MAX).fill(-1e6) },
  uCutCap: { value: new THREE.Color(CAP_COLOR) },
};

type PatchedMaterial = THREE.Material & { __cutaway?: boolean; isMeshStandardMaterial?: boolean; isMeshBasicMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean };

export function patchMaterial(mat: THREE.Material) {
  const m = mat as PatchedMaterial;
  if (m.__cutaway || !(m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
  m.__cutaway = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uCutCount = cutUniforms.uCutCount;
    shader.uniforms.uCutBoxes = cutUniforms.uCutBoxes;
    shader.uniforms.uCutFloor = cutUniforms.uCutFloor;
    shader.uniforms.uCutCap = cutUniforms.uCutCap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
	{ vec4 cw = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		cw = instanceMatrix * cw;
	#endif
		vCutWorld = ( modelMatrix * cw ).xyz; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCutWorld;
uniform int uCutCount;
uniform mat4 uCutBoxes[ ${CUT_MAX} ];
uniform float uCutFloor[ ${CUT_MAX} ];
uniform vec3 uCutCap;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	bool cutPlinth = false;
	// solid interiors exposed by a vertical wall cut (back-facing vertical faces of opaque materials) — in the section colour
	bool cutVertical = false;
	if ( uCutCount > 0 ) { vec3 cn = normalize( cross( dFdx( vCutWorld ), dFdy( vCutWorld ) ) ); cutVertical = abs( cn.y ) < 0.3; }
	#ifdef OPAQUE
	if ( cutVertical && ! gl_FrontFacing ) cutPlinth = true;
	#endif
	for ( int ci = 0; ci < ${CUT_MAX}; ci ++ ) {
		if ( ci >= uCutCount ) break;
		vec3 cq = ( uCutBoxes[ ci ] * vec4( vCutWorld, 1.0 ) ).xyz;
		if ( abs( cq.x ) < 1.0 && abs( cq.z ) < 1.0 ) {
			if ( abs( cq.y ) < 1.0 ) discard;
			// plinth below the cutaway: its SIDES (vertical faces) in the section colour; the top is closed by the stencil plane
			// (scene/SectionCaps.tsx). Horizontal surfaces (floors, slabs, roofs of lower parts) are unchanged.
			if ( cutVertical && cq.y <= - 1.0 && vCutWorld.y - uCutFloor[ ci ] > 0.0 ) cutPlinth = true;
		}
	}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
	if ( cutPlinth ) gl_FragColor.rgb = uCutCap;`);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${prevKey()}|cutaway5`;
  m.needsUpdate = true;
}

/** global horizontal section (three.js Y) — the same as renderer.clippingPlanes; null: none */
export const clipState = { cutY: null as number | null };

/**
 * Section for FURNITURE (three.js Y). Furniture is not clipped — in the top-down plan (architecture cut at 1.20 m) it is
 * visible in full, so it must also be pickable: otherwise a TV at 0.95–1.79 m, a mirror or a tall wardrobe could not be
 * selected or grabbed in the plan. The furniture filter has a different purpose — furniture on the level ABOVE must not
 * capture clicks — so it uses the section of the level cut by the current section (above lintels, below the ceiling), not
 * the plan section.
 */
export function furnitureCutY(): number | null {
  const cut = clipState.cutY;
  if (cut === null) return null;
  const level = [...allLevels()].reverse().find((l) => l.floorZ <= cut + 1e-6);
  return level ? Math.max(cut, level.floorZ + level.cutHeight) : cut;
}

const inv = new THREE.Vector3();
/** whether a point (three.js world) is visible: below the section and outside the cutaway boxes; `cutY` — a section other than the architecture one */
export function visibleAt(p: THREE.Vector3, boxes = true, cutY = clipState.cutY): boolean {
  if (cutY !== null && p.y > cutY + 1e-4) return false;
  if (!boxes) return true;
  for (let i = 0; i < cutUniforms.uCutCount.value; i++) {
    inv.copy(p).applyMatrix4(cutUniforms.uCutBoxes.value[i]);
    if (Math.abs(inv.x) < 1 && Math.abs(inv.y) < 1 && Math.abs(inv.z) < 1) return false;
  }
  return true;
}

type Patched = THREE.Mesh & { __clipRaycast?: boolean };
/** the raycast skips parts hidden by the section and the cutaway, and hidden meshes (three.js and the pointer events raycast
 *  invisible objects too — a roof hidden in a section must not catch the clicks on the rooms under it): a click hits what is
 *  visible; `boxes: false` — furniture (level section, no cutaways) */
export function patchRaycast(mesh: THREE.Mesh, boxes = true) {
  const m = mesh as Patched;
  if (m.__clipRaycast) return;
  m.__clipRaycast = true;
  const orig = mesh.raycast;
  mesh.raycast = function (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    for (let o: THREE.Object3D | null = this; o; o = o.parent) if (!o.visible) return;
    const tmp: THREE.Intersection[] = [];
    orig.call(this, raycaster, tmp);
    if (!tmp.length) return;
    const cut = boxes ? clipState.cutY : furnitureCutY();
    for (const h of tmp) if (visibleAt(h.point, boxes, cut)) intersects.push(h);
  };
}

/** furniture: raycast only below the LEVEL section (furniture on another level does not capture clicks) */
export function patchFurnitureTree(root: THREE.Object3D) {
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) patchRaycast(o as THREE.Mesh, false); });
}

/** sets the horizontal section (Z in LCS) or turns it off */
export function setSection(cutZ: number | null) {
  clipState.cutY = cutZ;
  archPlane.constant = cutZ ?? 1e6;
}

/**
 * Attaches the cutaway and the section to the materials and raycasts of objects in the tree (new objects — on the next call).
 * Section: only materials without their own planes (the building model and joinery with a clipZ parameter set them themselves).
 */
export function patchTree(root: THREE.Object3D, skip?: THREE.Object3D | null) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    patchRaycast(mesh);
    let own = false;
    for (let a: THREE.Object3D | null = mesh; a && skip; a = a.parent) if (a === skip) { own = true; break; }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      patchMaterial(m);
      if (!own && !m.clippingPlanes?.length) { m.clippingPlanes = ARCH_PLANES; m.needsUpdate = true; }
    }
  });
}

/** cutaway parameters: plinth that remains [m above the floor], band behind the wall [m], margin beyond the corners [m] */
export const CUTAWAY = { keep: 0.08, depth: 3.0, corner: 0.6, top: 4.5 };

const tmp = new THREE.Matrix4();
/** room walls between the camera and the interior (camera on the outer side of the wall face, view not from above) */
export function nearWalls(room: HomeRoom, cam: THREE.Vector3): HomeRoom['walls'] {
  const cx = cam.x, cy = -cam.z;
  return room.walls.filter((w) => (cx - w.a[0]) * w.inward[0] + (cy - w.a[1]) * w.inward[1] < -0.05);
}

interface CutBox { w: HomeRoom['walls'][number]; d0: number; d1: number; z0: number; z1: number; floor?: number }

/** cutaway boxes for walls near the camera (under a sloped roof — also the band of roof slope above the room next to the wall) */
export function cutBoxes(room: HomeRoom, walls: HomeRoom['walls'], cutHeight = 2.3): CutBox[] {
  const { keep, depth, top } = CUTAWAY, out: CutBox[] = [];
  for (const w of walls) {
    out.push({ w, d0: -0.01, d1: depth, z0: room.floorZ + keep, z1: room.floorZ + top, floor: room.floorZ });
    if (room.ceiling.kind !== 'flat') {
      // roof slope above the room next to a knee wall: from the wall face to where the ceiling reaches the section height
      const mx = w.a[0] + w.dir[0] * w.length / 2, my = w.a[1] + w.dir[1] * w.length / 2;
      const at = (d: number) => room.ceiling.heightAt(mx + w.inward[0] * d, my + w.inward[1] * d), h0 = at(0.01);
      if (h0 < cutHeight - 0.05) {
        let s = 0.01;
        while (s < 8 && at(s) < cutHeight) s += 0.05;
        out.push({ w, d0: -(s + 0.3), d1: 0.02, z0: room.floorZ + Math.max(0.3, h0 - 0.4), z1: room.floorZ + top });
      }
    }
  }
  return out.slice(0, CUT_MAX);
}

/** sets the cutaway boxes for the walls (three.js world); [] — off */
export function setCutaway(room: HomeRoom | null, walls: HomeRoom['walls'], cutHeight = 2.3) {
  const list = room ? cutBoxes(room, walls, cutHeight) : [];
  cutUniforms.uCutCount.value = list.length;
  list.forEach(({ w, d0, d1, z0, z1, floor }, i) => {
    cutUniforms.uCutFloor.value[i] = floor ?? -1e6;
    const half = w.length / 2 + CUTAWAY.corner;
    // band from d0 to d1 along the outward normal (negative — into the room)
    const out: [number, number] = [-w.inward[0], -w.inward[1]];
    const mx = w.a[0] + w.dir[0] * (w.length / 2) + out[0] * ((d0 + d1) / 2);
    const my = w.a[1] + w.dir[1] * (w.length / 2) + out[1] * ((d0 + d1) / 2);
    const hd = (d1 - d0) / 2, hz = (z1 - z0) / 2;
    // box axes in the three.js frame (x = X, y = Z, z = −Y), scaled to half-extents
    tmp.makeBasis(
      new THREE.Vector3(w.dir[0] * half, 0, -w.dir[1] * half),
      new THREE.Vector3(0, hz, 0),
      new THREE.Vector3(out[0] * hd, 0, -out[1] * hd),
    ).setPosition(mx, z0 + hz, -my);
    cutUniforms.uCutBoxes.value[i].copy(tmp).invert();
  });
}
