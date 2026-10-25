// Transparency of trees between the camera and the building (exterior view): when the camera stands in bushes or behind trees,
// fragments of crowns and trunks inside the camera → building view cone are "thinned out" (screen-door pattern, no alpha
// blending — no sorting and no transparency cost), so the building is visible through the trees. Outside the cone trees are
// untouched; tree shadows remain.
// Cone: apex at the camera, axis to the building centre, radius R at the building (building outline with a margin) — i.e.
// exactly what hides the building on screen. Tree materials come from the viewer component (Environment) — patched via
// onBeforeCompile, without changing its code. The same rule in TS (tests) and GLSL.
import * as THREE from 'three';

export const SEE_THROUGH = {
  /** building centre (three.js: x, height, −y LCS) and cone radius at the building [m] — set from the project bounds
   *  (setSeeThroughTarget) */
  focus: new THREE.Vector3(0, 3, 0),
  radius: 10,
  /** fraction of the radius within which trees are thinned out the most; beyond it a smooth transition to full opacity */
  core: 0.6,
  /** tree opacity on the view axis (0…1) */
  minKeep: 0.14,
};

export const seeUniforms = {
  uSeeOn: { value: 0 },
  uSeeFocus: { value: SEE_THROUGH.focus.clone() },
  uSeeRadius: { value: SEE_THROUGH.radius },
  uSeeCore: { value: SEE_THROUGH.core },
  uSeeMin: { value: SEE_THROUGH.minKeep },
};

/** aims the cone at a building: bounds in LCS (x, y, z up); radius = half the plan diagonal + 10 % */
export function setSeeThroughTarget(b: { min: [number, number, number]; max: [number, number, number] }) {
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  SEE_THROUGH.focus.set(cx, cz, -cy);
  SEE_THROUGH.radius = Math.max(3, 0.55 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]));
  seeUniforms.uSeeFocus.value.copy(SEE_THROUGH.focus);
  seeUniforms.uSeeRadius.value = SEE_THROUGH.radius;
}

/** opacity of a tree fragment at p (three.js world) for camera cam: 1 — unchanged, minKeep — on the view axis to the building */
export function seeThroughKeep(cam: THREE.Vector3, p: THREE.Vector3, o = SEE_THROUGH): number {
  const ab = o.focus.clone().sub(cam), t = p.clone().sub(cam).dot(ab) / ab.lengthSq();
  if (t <= 0 || t >= 1) return 1;                                     // behind the camera or beyond the building
  const d = p.distanceTo(cam.clone().addScaledVector(ab, t)), r = Math.max(1e-6, t * o.radius);
  const k = THREE.MathUtils.smoothstep(d, r * o.core, r);
  return o.minKeep + (1 - o.minKeep) * k;
}

const KEY = 'home-see-through-1';
type Patched = THREE.Material & { userData: { seeThrough?: boolean } };

/** patches a tree material (once): discards fragments in the camera → building cone using a 4 × 4 Bayer pattern */
export function patchSeeThrough(mat: THREE.Material): boolean {
  const m = mat as Patched;
  if (m.userData.seeThrough) return false;
  m.userData.seeThrough = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    Object.assign(shader.uniforms, seeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeeWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 seeP = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      seeP = instanceMatrix * seeP;
    #endif
    vSeeWorld = ( modelMatrix * seeP ).xyz;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSeeWorld;
uniform float uSeeOn; uniform vec3 uSeeFocus; uniform float uSeeRadius; uniform float uSeeCore; uniform float uSeeMin;
float seeBayer( vec2 p ) {
  ivec2 q = ivec2( mod( p, 4.0 ) );
  int i = q.x + q.y * 4;
  float m[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  return ( m[i] + 0.5 ) / 16.0;
}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if ( uSeeOn > 0.5 ) {
    vec3 seeAB = uSeeFocus - cameraPosition;
    float seeT = dot( vSeeWorld - cameraPosition, seeAB ) / dot( seeAB, seeAB );
    if ( seeT > 0.0 && seeT < 1.0 ) {
      float seeD = length( vSeeWorld - ( cameraPosition + seeAB * seeT ) ), seeR = max( 1e-6, seeT * uSeeRadius );
      float seeKeep = mix( uSeeMin, 1.0, smoothstep( seeR * uSeeCore, seeR, seeD ) );
      if ( seeKeep < seeBayer( gl_FragCoord.xy ) ) discard;
    }
  }`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}|${KEY}`;
  m.needsUpdate = true;
  return true;
}

/** patches all tree and shrub materials of the surroundings (ENV_Trees_* meshes); returns the number of new patches */
export function patchTreeMaterials(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.name.startsWith('ENV_Trees_')) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m && patchSeeThrough(m)) n++;
  });
  return n;
}
