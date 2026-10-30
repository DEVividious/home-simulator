// Generated shell (model/shell.ts) — three.js geometry and materials: a mesh from the shell's surface quads, window frames
// and panes in the wall openings. The materials get the horizontal architecture section and the wall cutaway patch
// (three/cutaway.ts), like a building model loaded from a file. Scene layer: scene/ShellLayer.tsx.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelShell, ShellQuad, ShellWindow } from '../model/shell';
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
/** roof covering of the generated shell (tiles / sheet — a muted clay red) */
export const SHELL_ROOF = mat('#8c5246', 0.85, 'MAT_Shell_Roof');
export const SHELL_GLASS = (() => {
  const m = new THREE.MeshPhysicalMaterial({ color: '#bcd4de', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, name: 'MAT_Window_Glass_Shell' });
  m.clippingPlanes = ARCH_PLANES;
  patchMaterial(m);
  return m;
})();

/** mesh from the shell quads (LCS → three.js: x, z, −y); UV in metres */
export function quadsGeometry(quads: ShellQuad[]): THREE.BufferGeometry {
  const pos = new Float32Array(quads.length * 12), nor = new Float32Array(quads.length * 12), uv = new Float32Array(quads.length * 8), idx: number[] = [];
  quads.forEach((q, i) => {
    q.p.forEach((p, k) => {
      pos.set([p[0], p[2], -p[1]], i * 12 + k * 3);
      nor.set([q.n[0], q.n[2], -q.n[1]], i * 12 + k * 3);
      // vertical: along the wall and height; horizontal: plan
      uv.set(Math.abs(q.n[2]) > 0.5 ? [p[0], p[1]] : [Math.abs(q.n[0]) > 0.5 ? p[1] : p[0], p[2]], i * 8 + k * 2);
    });
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

const FRAME_W = 0.06, FRAME_D = 0.07, GLASS_D = 0.024, MULLION_OVER = 1.6;
/** box in the window frame (u along the wall, d into the wall from the room face, z) → three.js */
function bar(w: ShellWindow, u0: number, u1: number, d0: number, d1: number, z0: number, z1: number): THREE.BufferGeometry {
  const at = (u: number, d: number) => [w.a[0] + w.dir[0] * u + w.out[0] * d, w.a[1] + w.dir[1] * u + w.out[1] * d];
  const p = at(u0, d0), q = at(u1, d1);
  const g = new THREE.BoxGeometry(Math.abs(q[0] - p[0]), z1 - z0, Math.abs(q[1] - p[1]));
  g.translate((p[0] + q[0]) / 2, (z0 + z1) / 2, -(p[1] + q[1]) / 2);
  return g;
}
/** window frame and pane in the middle of the wall thickness; wider windows get a mullion in the middle */
function windowParts(w: ShellWindow): { frame: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[] } {
  const d0 = Math.max(0, (w.depth - FRAME_D) / 2), d1 = d0 + Math.min(FRAME_D, w.depth), f = Math.min(FRAME_W, w.width / 4, (w.z1 - w.z0) / 4);
  const frame = [bar(w, 0, w.width, d0, d1, w.z0, w.z0 + f), bar(w, 0, w.width, d0, d1, w.z1 - f, w.z1), bar(w, 0, f, d0, d1, w.z0 + f, w.z1 - f), bar(w, w.width - f, w.width, d0, d1, w.z0 + f, w.z1 - f)];
  if (w.width > MULLION_OVER) frame.push(bar(w, w.width / 2 - f / 2, w.width / 2 + f / 2, d0, d1, w.z0 + f, w.z1 - f));
  const g0 = (d0 + d1) / 2 - GLASS_D / 2;
  return { frame, glass: [bar(w, f, w.width - f, g0, g0 + GLASS_D, w.z0 + f, w.z1 - f)] };
}

export interface ShellGeometry { walls: THREE.BufferGeometry; floor: THREE.BufferGeometry; top: THREE.BufferGeometry | null; frames: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null }
/** shell geometries of one level: walls, slabs, window frames and panes (merged — one draw call each) */
export function shellGeometry(shell: LevelShell): ShellGeometry {
  const parts = shell.windows.map(windowParts);
  const merge = (list: THREE.BufferGeometry[]) => { const g = list.length ? mergeGeometries(list) : null; list.forEach((x) => x.dispose()); return g; };
  return {
    walls: quadsGeometry(shell.walls), floor: quadsGeometry(shell.floor), top: shell.top.length ? quadsGeometry(shell.top) : null,
    frames: merge(parts.flatMap((p) => p.frame)), glass: merge(parts.flatMap((p) => p.glass)),
  };
}
