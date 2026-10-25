// Import of GLB / glTF furniture models (groundwork for external catalogues): loading the file, analysis and normalisation —
// bbox, unit detection (m / cm / mm) and scale to metres, pivot (centre of the plan outline, bottom on the floor), rotation
// of the model's front, plan outline (convex hull), triangle count and warnings about heavy models, PNG thumbnail.
// The result (ImportedAsset) goes into the project; the model file — to assets/furniture/imported/ (Vite server endpoint).
import { uploadUserFile } from '../../storage/assets';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Dims, ImportedAsset, Vec2, Vec3 } from '../model/types';
import { fmtCm, fmtM, fmtNum, t } from '../../i18n';

export const TRI_WARN = 150_000;
export const TRI_HEAVY = 500_000;
export const MAX_BYTES = 50 << 20;

export interface GlbAnalysis {
  scene: THREE.Object3D;
  /** box in file units, glTF axes (y up) */
  min: Vec3;
  max: Vec3;
  triangles: number;
  meshes: number;
  materials: number;
  textures: number;
  maxTexture: number;
  unit: { scale: number; unit: 'm' | 'cm' | 'mm'; reason: string };
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;

export async function parseModel(buf: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buf, '');
  return gltf.scene;
}

/** analysis of the model scene (no modification) */
export function analyze(scene: THREE.Object3D): GlbAnalysis {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  let triangles = 0, meshes = 0, maxTexture = 0;
  const mats = new Set<THREE.Material>(), tex = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry, n = g.index ? g.index.count : g.getAttribute('position').count;
    triangles += Math.floor(n / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      mats.add(mat);
      for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) { tex.add(v as THREE.Texture); const img = (v as THREE.Texture).image as { width?: number; height?: number } | undefined; maxTexture = Math.max(maxTexture, img?.width ?? 0, img?.height ?? 0); }
    }
  });
  const size = box.getSize(new THREE.Vector3()), D = Math.max(size.x, size.y, size.z);
  // file units: furniture is about 0.25 … 6 m — the first scale (m → cm → mm) at which the largest dimension falls in that range
  let unit: GlbAnalysis['unit'] = { scale: 1, unit: 'm', reason: t('three.glbUnitMetres', { size: fmtNum(D, 2) }) };
  if (D > 6 && D / 100 >= 0.25 && D / 100 <= 6) unit = { scale: 0.01, unit: 'cm', reason: t('three.glbUnitCm', { size: fmtNum(D, 0) }) };
  else if (D > 6 && D / 1000 >= 0.25 && D / 1000 <= 6) unit = { scale: 0.001, unit: 'mm', reason: t('three.glbUnitMm', { size: fmtNum(D, 0) }) };
  return { scene, min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z], triangles, meshes, materials: mats.size, textures: tex.size, maxTexture, unit };
}

/** convex hull (monotone chain) */
export function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [], up: Vec2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/**
 * Normalisation: file point `offset` (centre of the plan outline, bottom) → (0, 0, 0); scale → metres; rotation about the vertical
 * → front of the item (local +y LCS = −Z three.js). Dimensions and outline after normalisation in the item frame (x — width, y — front).
 */
export function normalize(a: GlbAnalysis, scale: number, rotation: number): { dims: Dims; offset: Vec3; footprint: Vec2[] } {
  const offset: Vec3 = [(a.min[0] + a.max[0]) / 2, a.min[1], (a.min[2] + a.max[2]) / 2];
  const rad = (rotation * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const pts: Vec2[] = [];
  const v = new THREE.Vector3();
  a.scene.updateMatrixWorld(true);
  a.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 4000)); // vertex sample (outline)
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const x = (v.x - offset[0]) * scale, z = (v.z - offset[2]) * scale;
      // rotation about the three.js Y axis, then the item LCS: x = X, y = −Z
      const rx = x * c + z * s, rz = -x * s + z * c;
      pts.push([r4(rx), r4(-rz)]);
    }
  });
  const hull = convexHull(pts);
  const xs = hull.map((p) => p[0]), ys = hull.map((p) => p[1]);
  const dims: Dims = { w: r4(Math.max(...xs) - Math.min(...xs)), d: r4(Math.max(...ys) - Math.min(...ys)), h: r4((a.max[1] - a.min[1]) * scale) };
  return { dims, offset: offset.map(r4) as Vec3, footprint: hull };
}

export function warningsFor(a: GlbAnalysis, dims: Dims, bytes: number): string[] {
  const w: string[] = [];
  if (a.triangles > TRI_HEAVY) w.push(t('three.glbVeryHeavy', { tris: fmtNum(a.triangles, 0), max: fmtNum(TRI_WARN, 0) }));
  else if (a.triangles > TRI_WARN) w.push(t('three.glbHeavy', { tris: fmtNum(a.triangles, 0), max: fmtNum(TRI_WARN, 0) }));
  if (a.maxTexture > 4096) w.push(t('three.glbLargeTextures', { px: a.maxTexture }));
  if (bytes > 20 << 20) w.push(t('three.glbLargeFile', { mb: fmtNum(bytes / 1048576, 1) }));
  const D = Math.max(dims.w, dims.d, dims.h);
  if (D > 5) w.push(t('three.glbTooLarge', { size: fmtM(D) }));
  if (D < 0.03) w.push(t('three.glbTooSmall', { size: fmtCm(D, 1) }));
  if (!a.meshes) w.push(t('three.glbNoMeshes'));
  return w;
}

/** PNG thumbnail (separate, temporary renderer) */
export function renderThumbnail(a: GlbAnalysis, scale: number, rotation: number, size = 256): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(size, size);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f98', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(-2, 4, 3); scene.add(sun);
    const n = normalize(a, scale, rotation);
    const outer = new THREE.Group(), inner = new THREE.Group();
    outer.rotation.y = (rotation * Math.PI) / 180;
    inner.scale.setScalar(scale);
    inner.position.set(-n.offset[0] * scale, -n.offset[1] * scale, -n.offset[2] * scale);
    inner.add(a.scene.clone(true));
    outer.add(inner);
    scene.add(outer);
    const box = new THREE.Box3().setFromObject(outer), sph = box.getBoundingSphere(new THREE.Sphere());
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    cam.position.copy(sph.center).add(new THREE.Vector3(0.6, 0.55, -1).normalize().multiplyScalar(sph.radius / Math.sin((15 * Math.PI) / 180)));
    cam.lookAt(sph.center);
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export const IMPORT_API = '/__api/furniture-import';

/**
 * Saves a model file / thumbnail: to the server (assets/furniture/imported/, assets/thumbnails/imported/) with a copy on the device;
 * offline — only on the device (IndexedDB), uploaded once the connection is back (storage/assets.ts).
 */
export async function upload(kind: 'model' | 'thumb', file: string, body: Blob): Promise<{ ok: boolean; file?: string; error?: string; offline?: boolean }> {
  const url = `/user-assets/${kind === 'model' ? 'furniture' : 'thumbnails'}/imported/${file}`;
  const r = await uploadUserFile(`${IMPORT_API}?kind=${kind}&file=${encodeURIComponent(file)}`, url, body);
  return r.ok ? { ok: true, file: r.file ?? file, offline: r.offline } : { ok: false, error: r.error };
}

export function makeAsset(id: string, name: string, category: string, file: string, bytes: number, a: GlbAnalysis, scale: number, rotation: number, thumbnail: string | null): ImportedAsset {
  const n = normalize(a, scale, rotation);
  return {
    id, name: name.trim() || 'Model', file, bytes, triangles: a.triangles, dims: n.dims, scale, offset: n.offset, footprint: n.footprint,
    rotation, thumbnail, category, warnings: warningsFor(a, n.dims, bytes), createdAt: new Date().toISOString(),
  };
}
