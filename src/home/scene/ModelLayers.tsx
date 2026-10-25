// File-based models of a project (assets.model / site / environment — GLB). The engine does not interpret the model
// beyond a few conventions (docs/PROJECT_PACKAGE_SPEC.md § assets):
//   • the building model is wrapped in a group named HOUSE (section caps, cut-away); meshes cut by a level section are chosen
//     by name prefixes (assets.sectionCaps), node extras.confidence colours the model in expert mode;
//   • site / environment material names from SITE_KINDS get procedural surfaces (three/siteStyle.ts);
//   • an environment node named ENV_TREES holds trees that turn see-through between the camera and the building.
// Coordinates: glTF (x, y up, z) = project (x, z, −y).
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { applySiteStyle } from '../three/siteStyle';

export interface Picked {
  name: string;
  userData: Record<string, unknown>;
  point: [number, number, number]; // project coordinates
  /** objects hit FURTHER along the same ray, nearest first — hidden behind the picked solid (e.g. a room floor behind a wall) */
  behind: THREE.Object3D[];
}

export const CONFIDENCE_COLORS = { confirmed: '#2e9d57', probable: '#e0a800', unknown: '#d6336c', assumed: '#d6336c' } as const;
export const gltfToLcs = ([x, y, z]: readonly number[]): [number, number, number] => [x, -z, y];

/**
 * Hidden objects (itself or an ancestor with visible = false) take no part in picking: the three.js / R3F raycaster also hits
 * invisible meshes. The guard wraps the raycast method of every model object once and composes with other guards of that
 * method (section and wall cut-away: home/three/cutaway.ts).
 */
const guarded = new WeakSet<THREE.Object3D>();
function guardHiddenRaycast(root: THREE.Object3D) {
  root.traverse((o) => {
    if (guarded.has(o)) return;
    guarded.add(o);
    const orig = o.raycast;
    o.raycast = function (this: THREE.Object3D, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
      for (let a: THREE.Object3D | null = this; a; a = a.parent) if (!a.visible) return;
      orig.call(this, raycaster, intersects);
    };
  });
}

export interface ModelSettings { section: number | null; wireframe: boolean; confidence: boolean }

/** building model (GLB): horizontal section, wireframe, colours by data confidence, object picking */
export function ModelLayer({ url, settings, onPick }: { url: string; settings: ModelSettings; onPick: (p: Picked | null) => void }) {
  const { scene } = useGLTF(url);
  useMemo(() => guardHiddenRaycast(scene), [scene]);
  const confMats = useMemo(() => {
    const m = new Map<string, THREE.MeshStandardMaterial>();
    for (const [k, c] of Object.entries(CONFIDENCE_COLORS)) m.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, name: `CONF_${k}` }));
    return m;
  }, []);
  useEffect(() => () => confMats.forEach((m) => m.dispose()), [confMats]);
  const original = useMemo(() => {
    const m = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) m.set(o as THREE.Mesh, (o as THREE.Mesh).material); });
    return m;
  }, [scene]);
  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);

  useEffect(() => {
    clip.constant = settings.section ?? 1e6;
    const planes = [clip]; // always one plane (no section — moved far away): a constant plane count in shaders
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let conf: string | undefined;
      for (let a: THREE.Object3D | null = mesh; a && !conf; a = a.parent) conf = (a.userData as { confidence?: string }).confidence;
      mesh.material = settings.confidence ? confMats.get(conf ?? 'confirmed') ?? original.get(mesh)! : original.get(mesh)!;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        mat.clippingPlanes = planes;
        (mat as THREE.MeshStandardMaterial).wireframe = settings.wireframe;
        mat.side = settings.section === null ? THREE.FrontSide : THREE.DoubleSide; // section: inside of cut solids visible
        mat.needsUpdate = true;
      }
    });
  }, [scene, settings, clip, confMats, original]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    for (let a: THREE.Object3D | null = e.object; a; a = a.parent) if (!a.visible) return;
    e.stopPropagation();
    const o = e.object;
    const behind = [...new Set(e.intersections.filter((i) => i.distance > e.distance).map((i) => i.object))];
    onPick({ name: o.name, userData: o.userData, point: gltfToLcs([e.point.x, e.point.y, e.point.z]), behind });
  };

  return <group name="HOUSE"><primitive object={scene} onClick={handleClick} onPointerMissed={() => onPick(null)} /></group>;
}

/** terrain model (GLB) of the site: procedural surfaces, never picks clicks */
export function SiteLayer({ url, wireframe }: { url: string; wireframe: boolean }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => { const r = scene.clone(true); applySiteStyle(r); return r; }, [scene]);
  useEffect(() => {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'wireframe' in m) m.wireframe = wireframe;
      o.raycast = () => {};
    });
  }, [root, wireframe]);
  return <group name="SITE_MODEL"><primitive object={root} /></group>;
}

/** surroundings model (GLB): trees, neighbours, roads; hidden (but kept mounted) when the surroundings are off */
export function EnvironmentLayer({ url, visible, wireframe }: { url: string; visible: boolean; wireframe: boolean }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => { const r = scene.clone(true); applySiteStyle(r); return r; }, [scene]);
  useEffect(() => {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'wireframe' in m) m.wireframe = wireframe;
      o.raycast = () => {};
    });
  }, [root, wireframe]);
  return <group name="ENVIRONMENT_LAYER" visible={visible}><primitive object={root} /></group>;
}

/** plot boundary drawn on the ground (expert mode) */
export function BoundaryLine({ boundary, z }: { boundary: [number, number][]; z: number }) {
  const geo = useMemo(() => {
    const pts = [...boundary, boundary[0]].map(([x, y]) => new THREE.Vector3(x, z + 0.03, -y));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [boundary, z]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <lineLoop name="SITE_Boundary" geometry={geo} raycast={() => null}><lineBasicMaterial color="#d93a26" /></lineLoop>;
}
