// Site and surroundings materials (no geometry change): patterns computed in the shader in world coordinates [m] — grass
// (colour variation over a few metres), 60 × 30 cm concrete pavers with 5 mm joints, 14 cm deck boards, gravel, asphalt,
// dirt road, forest floor. GLB materials are modified in place (onBeforeCompile).
// MODEL CONVENTION: a site / environment GLB opts in by naming its materials with the keys of SITE_KINDS (docs/PROJECT_PACKAGE_SPEC.md).
import * as THREE from 'three';

type Kind = 'grass' | 'paver' | 'deck' | 'gravel' | 'asphalt' | 'dirtroad' | 'forestfloor';

/** GLB material name → surface kind */
export const SITE_KINDS: Record<string, Kind> = {
  MAT_Terrain_Design: 'grass', MAT_Terrain_Design_Approximation: 'grass', MAT_Terrain_Existing: 'grass', MAT_Terrain_Existing_Approximation: 'grass',
  MAT_Paving_Driveway: 'paver', MAT_Paving_Terrace: 'deck', MAT_Gravel: 'gravel', MAT_Road_Approximation: 'asphalt',
  MAT_Env_Ground_Meadow: 'grass', MAT_Env_Ground_Forest: 'forestfloor', MAT_Env_Ground_Far: 'grass', MAT_Env_Road: 'asphalt',
  MAT_Road_Dirt: 'dirtroad', MAT_Forest_Floor: 'forestfloor',
};
const kindOf = (name: string): Kind | undefined => SITE_KINDS[name];
/** forest floor colour: litter (brown / olive) with patches of sparse grass */
const forestColor = () => `mix(mix(${lin('#5b5236')}, ${lin('#6c6a40')}, stNoise(q * 0.7)), ${lin('#4f6a30')}, smoothstep(0.55, 0.85, stNoise(q * 0.23 + 7.)) * 0.55) * (0.86 + 0.24 * mix(0.5, stNoise(q * 11.), stFade(q, 0.3)))`;

const lin = (hex: string) => { const c = new THREE.Color(hex); // already linear (ColorManagement)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

const COMMON = /* glsl */ `
varying vec3 vStPos;
float stHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float stNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(stHash(i), stHash(i + vec2(1., 0.)), u.x), mix(stHash(i + vec2(0., 1.)), stHash(i + vec2(1., 1.)), u.x), u.y); }
// fades the pattern out when a pixel covers a large part of the module (from afar — average colour instead of moiré)
float stFade(vec2 q, float module) { return 1.0 - smoothstep(0.25, 0.8, max(fwidth(q.x), fwidth(q.y)) / module); }
// coverage of a gap (width g, period P, gap around x = k·P) in a pixel of width fw — box filter from the integral of the
// periodic pattern: no moiré or "dots" from afar, sharp up close
float stGapI(float t, float P, float g) { return floor(t / P) * g + min(mod(t, P), g); }
float stGap(float x, float P, float g, float fw) {
  fw = max(fw, 1e-4); float t = x + g * 0.5;
  return clamp((stGapI(t + fw * 0.5, P, g) - stGapI(t - fw * 0.5, P, g)) / fw, 0.0, 1.0);
}
float stFbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * stNoise(p); p *= 2.07; a *= .5; } return s; }
// mask of a rectangle [x0, y0, x1, y1] with a soft, irregular edge of width s
float stBox(vec2 q, vec4 b, float s) { vec2 d = min(q - b.xy, b.zw - q); return smoothstep(0.0, s, min(d.x, d.y) + (stNoise(q * 0.55) - 0.5) * s * 1.6); }
`;

function body(kind: Kind, approx: boolean): string {
  const q = 'vec2 q = vec2(vStPos.x, -vStPos.z);';
  switch (kind) {
    case 'grass': return `${q}
      float n = stNoise(q * 0.18) * 0.65 + stNoise(q * 0.41) * 0.35, d = stNoise(q * 1.7), f = stNoise(q * 9.);
      vec3 c = mix(${lin('#4a7a2c')}, ${lin('#64903e')}, n);
      c = mix(c, ${lin('#7d8e4c')}, smoothstep(0.62, 0.9, d) * 0.5);
      c *= 0.92 + 0.14 * mix(0.5, f, stFade(q, 0.4));
      ${approx ? 'c = mix(c, vec3(dot(c, vec3(0.33))), 0.12);' : ''}
      diffuseColor.rgb = c; stRough = 1.0;`;
    case 'forestfloor': return `${q}
      diffuseColor.rgb = ${forestColor()}; stRough = 1.0;`;
    case 'dirtroad': return `${q}
      float n = mix(0.5, stNoise(q * 38.), stFade(q, 0.06)), m = stFbm(q * 0.45), w = stNoise(q * 2.3);
      vec3 c = mix(${lin('#8a8377')}, ${lin('#6f685d')}, smoothstep(0.35, 0.75, m));
      c = mix(c, ${lin('#9a968d')}, smoothstep(0.6, 0.9, w) * 0.5);
      diffuseColor.rgb = c * (0.82 + 0.3 * n); stRough = 1.0;`;
    case 'paver': return `${q}
      vec2 S = vec2(0.6, 0.3); float row = floor(q.y / S.y); float x = q.x / S.x + 0.5 * mod(row, 2.);
      vec2 cell = vec2(floor(x), row);
      float h = (1. - stGap(q.y, S.y, 0.005, fwidth(q.y) * 1.5)) * (1. - stGap(x * S.x, S.x, 0.005, fwidth(q.x) * 1.5));
      vec3 c = ${lin('#b9b8b3')} * (0.94 + 0.1 * stHash(cell)) * (0.95 + 0.08 * stFbm(q * 6.));
      c = mix(${lin('#b9b8b3')}, c, stFade(q, 0.6));
      diffuseColor.rgb = mix(${lin('#77756f')}, c, h); stRough = mix(0.95, 0.82, h);`;
    case 'deck': return `${q}
      float bw = 0.14, gap = 0.006; float r = floor(q.y / bw); float L = 2.4 + 1.2 * stHash(vec2(r, 3.));
      float x = q.x / L + stHash(vec2(r, 7.)); vec2 cell = vec2(floor(x), r);
      float ends = 1. - stGap(x * L, L, 0.004, fwidth(q.x) * 1.5);
      float h = (1. - stGap(q.y, bw, gap, fwidth(q.y) * 1.5)) * ends;
      float fd = stFade(q, 0.14);
      vec3 c = ${lin('#9b8a77')} * (0.88 + 0.2 * mix(0.5, stHash(cell), fd)) * (0.92 + 0.12 * mix(0.5, stNoise(vec2(q.x * 3., q.y * 60.)), stFade(q, 0.02)));
      diffuseColor.rgb = mix(${lin('#3a332c')}, c, h); stRough = 0.8;`;
    case 'gravel': return `${q}
      float n = mix(0.5, stNoise(q * 45.), stFade(q, 0.05)), m = stNoise(q * 13.);
      diffuseColor.rgb = ${lin('#bdb5a6')} * (0.8 + 0.3 * n) * (0.92 + 0.12 * m); stRough = 1.0;`;
    case 'asphalt': return `${q}
      float n = mix(0.5, stNoise(q * 70.), stFade(q, 0.03)), m = stFbm(q * 0.6);
      diffuseColor.rgb = ${lin('#4a4b4e')} * (0.85 + 0.25 * n) * (0.92 + 0.14 * m); stRough = 0.92;`;
  }
}

/** applies the style to the materials of a site / surroundings scene (once per material) */
export function applySiteStyle(root: THREE.Object3D) {
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.receiveShadow = true;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const m = mat as THREE.MeshStandardMaterial & { __siteStyled?: boolean };
      const kind = kindOf(m.name);
      if (!kind || m.__siteStyled || done.has(m)) continue;
      done.add(m); m.__siteStyled = true;
      const approx = /Approximation|Far/.test(m.name) && kind === 'grass';
      m.color.set('#ffffff'); m.metalness = 0;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, r) => {
        prev?.call(m, shader, r);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vStPos;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vStPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${COMMON}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n  float stRough = 0.9;\n  { ${body(kind, approx)} }`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = stRough;');
      };
      const key = m.customProgramCacheKey.bind(m);
      m.customProgramCacheKey = () => `${key()}|site-${kind}${approx ? '-a' : ''}`;
      m.needsUpdate = true;
    }
  });
}
