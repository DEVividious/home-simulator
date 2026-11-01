// Generated shell — the three.js materials of its walls, slabs, roof covering, window frames and panes (the geometry comes from the
// core's solids: three/coreMesh.ts). The materials get the horizontal architecture section and the wall cutaway patch
// (three/cutaway.ts), like a building model loaded from a file. Scene layer: scene/CoreShellLayer.tsx.
import * as THREE from 'three';
import { ARCH_PLANES, patchMaterial } from './cutaway';

const mat = (color: string, roughness: number, name: string) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness, name });
  m.clippingPlanes = ARCH_PLANES;
  patchMaterial(m);
  return m;
};
export const SHELL_WALL = mat('#ebe8e1', 0.92, 'MAT_Shell_Wall');
export const SHELL_SLAB = mat('#c9c6bf', 0.95, 'MAT_Shell_Slab');
export const SHELL_FRAME = mat('#4a4e55', 0.55, 'MAT_Window_Frame_Shell');
const frames = new Map<string, THREE.MeshStandardMaterial>();
/** the frame material of a gable window in the colour the user chose (shared per colour; selected — lit blue like a chosen door) */
export function frameMaterial(hex: string, selected = false): THREE.MeshStandardMaterial {
  const k = `${hex}${selected ? ':on' : ''}`;
  let m = frames.get(k);
  if (!m) {
    m = mat(hex, 0.55, `MAT_Window_Frame_${hex.slice(1)}${selected ? '_Selected' : ''}`);
    if (selected) { m.emissive.set('#2f6fed'); m.emissiveIntensity = 0.35; }
    frames.set(k, m);
  }
  return m;
}
/** roof covering of the generated shell (tiles / sheet — a muted clay red) */
export const SHELL_ROOF = mat('#8c5246', 0.85, 'MAT_Shell_Roof');
export const SHELL_GLASS = (() => {
  const m = new THREE.MeshPhysicalMaterial({ color: '#bcd4de', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, name: 'MAT_Window_Glass_Shell' });
  m.clippingPlanes = ARCH_PLANES;
  patchMaterial(m);
  return m;
})();
