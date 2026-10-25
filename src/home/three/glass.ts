// Windows and joinery materials: glass readable but not mirror-like, profiles semi-matt. High glass quality — transmission
// glass (the interior is visible, the sky reflects from the environment map, a slight tint of the glass colour); other
// qualities — semi-transparent glass (opacity 0.25–0.45). Applies to the generated shell and to building models whose
// material names contain "Window" (frames / mullions / transoms / glass) — MODEL CONVENTION (docs/PROJECT_PACKAGE_SPEC.md).
import * as THREE from 'three';
import type { GlassQuality } from '../quality/profile';

type Tuned = THREE.MeshStandardMaterial & { __tuned?: string; __orig?: { color: THREE.Color; opacity: number; roughness: number; metalness: number } };
const GLASS = /glass/i, HANDLE = /handle/i, FRAMEISH = /Window_(Frame|Mullion|Transom|Profile|Leaf)/i;

export function tuneJoinery(root: THREE.Object3D, glassQuality: GlassQuality | 'high' | 'medium' | 'low') {
  const quality = glassQuality === 'GLASS_HIGH' || glassQuality === 'high' ? 'high' : 'medium';
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mm of mats) {
      const m = mm as Tuned;
      if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial || !/Window|Glass/i.test(m.name)) continue;
      // shadow flags on every mesh (a material shared by many parts must not limit shadows to the first one)
      if (GLASS.test(m.name)) mesh.castShadow = false; else { mesh.castShadow = true; mesh.receiveShadow = true; }
      const key = `${quality}|${m.color.getHexString()}`;
      if (m.__tuned === key) continue;
      m.__orig ??= { color: m.color.clone(), opacity: m.opacity, roughness: m.roughness, metalness: m.metalness };
      const O = m.__orig;
      if (GLASS.test(m.name)) {
        const p = m as unknown as THREE.MeshPhysicalMaterial;
        if (quality === 'high' && p.isMeshPhysicalMaterial) {
          p.transmission = 1; p.transparent = false; p.opacity = 1; p.depthWrite = true; p.thickness = 0.008; p.ior = 1.5;
          p.roughness = 0.03; p.metalness = 0; p.specularIntensity = 1; p.envMapIntensity = 1;
          p.color.copy(O.color).lerp(new THREE.Color('#ffffff'), 0.72); // a slight tint of the glass
        } else {
          if (p.isMeshPhysicalMaterial) p.transmission = 0;
          p.transparent = true; p.depthWrite = false; p.opacity = Math.min(0.45, Math.max(0.25, O.opacity)); p.roughness = 0.04; p.metalness = 0; p.envMapIntensity = 1.4;
          p.color.copy(O.color);
        }
      } else if (HANDLE.test(m.name)) { m.metalness = 0.85; m.roughness = 0.28; }
      else if (FRAMEISH.test(m.name)) { m.metalness = Math.max(O.metalness, 0.3); m.roughness = Math.min(O.roughness, 0.48); }
      m.__tuned = key;
      m.needsUpdate = true;
    }
  });
}
