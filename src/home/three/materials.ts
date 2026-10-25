// three.js materials from the catalogue (shared, cached): colour, procedural texture at true scale
// (surface UV in metres → repeat = 1 / texture size), pattern rotation and offset from the user's layout.
import * as THREE from 'three';
import { activeProfile } from '../quality/profile';
import { materialById, patternRotation, textureExtent, type MaterialDef } from '../catalog/materials';
import type { FinishLayout } from '../model/types';
import { ARCH_PLANES } from './cutaway';
import { materialMaps, materialTexture } from './textures';

/** PBR quality (set from the graphics settings): normal / ORM maps only for "medium" and "high" */
export const pbrQuality = { maps: true };

export interface MatOptions { layout?: FinishLayout | null; color?: string | null; side?: THREE.Side; clipped?: boolean }

const cache = new Map<string, THREE.MeshStandardMaterial>();
const FALLBACK = '#cccccc';

/** texture with repeat / rotation / offset applied (the clone shares the image) */
function placedTexture(m: MaterialDef, o: MatOptions): THREE.Texture | null {
  const base = materialTexture(m, o.layout ? { ...o.layout, rotation: undefined, offset: undefined } : null, m.textureSet.type === 'solid' ? null : o.color && m.category === 'wall-paint' ? o.color : null);
  if (!base) return null;
  const t = base.clone();
  const [ew, eh] = textureExtent(m, o.layout);
  const off = o.layout?.offset ?? [0, 0];
  t.repeat.set(1 / ew, 1 / eh);
  t.rotation = (patternRotation(m, o.layout) * Math.PI) / 180;
  t.offset.set(off[0] / ew, off[1] / eh);
  t.needsUpdate = true;
  return t;
}

export function getMaterial(materialId: string | null | undefined, o: MatOptions = {}): THREE.MeshStandardMaterial {
  const key = `${materialId}|${JSON.stringify(o.layout ?? null)}|${o.color ?? ''}|${o.side ?? THREE.FrontSide}|${o.clipped ? 'c' : ''}|${pbrQuality.maps ? 'pbr' : 'flat'}|${activeProfile.current.textureMaxPx}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = materialById(materialId);
  const mat = new THREE.MeshStandardMaterial({ name: `MAT_${materialId}`, color: FALLBACK, roughness: 0.8, side: o.side ?? THREE.FrontSide, clippingPlanes: o.clipped ? ARCH_PLANES : null });
  if (m) {
    const tex = placedTexture(m, o);
    const color = o.color && (m.category === 'wall-paint' || m.textureSet.type === 'solid') ? o.color : m.baseColor;
    mat.color.set(tex ? '#ffffff' : color);
    mat.map = tex;
    mat.roughness = m.roughness; mat.metalness = m.metalness;
    // PBR: normal map and ORM (AO + roughness multiplier) from the pattern's height map, same repeats as the colour
    const maps = tex && pbrQuality.maps ? materialMaps(m, o.layout) : null;
    if (maps && tex) {
      const place = (t: THREE.Texture) => { const c = t.clone(); c.repeat.copy(tex.repeat); c.rotation = tex.rotation; c.offset.copy(tex.offset); c.center.copy(tex.center); c.needsUpdate = true; return c; };
      mat.normalMap = place(maps.normal); mat.normalScale.set(1, 1);
      const orm = place(maps.orm);
      mat.aoMap = orm; mat.aoMapIntensity = 0.85; mat.roughnessMap = orm;
    }
    if (m.emissive) { mat.emissive.set(m.emissive); mat.emissiveIntensity = m.emissiveIntensity ?? 0.3; }
    if (m.opacity !== undefined && m.opacity < 1) { mat.transparent = true; mat.opacity = m.opacity; mat.depthWrite = false; }
  }
  cache.set(key, mat);
  return mat;
}

/** preview colour of a material (lines, SVG thumbnails) */
export const materialColor = (id: string | null | undefined) => materialById(id)?.baseColor ?? FALLBACK;

export function materialCacheStats() { return { materials: cache.size }; }
