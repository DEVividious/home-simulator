// Generated shell from the core's solids (packages/core/src/solid) — three.js arrays and geometry. The arrays are made in the
// worker (three/coreWorker.ts) and transferred; the main thread only wraps them in a BufferGeometry. One geometry per level and
// one per roof, with a material group per material (walls, slabs, roof covering) chosen by the surface role of every triangle
// (ADR 0025); UV in metres in the plane of each face (a sloped face in its own coordinates). Coordinates: project (x, y, z up) →
// three.js (x, z, −y).
import * as THREE from 'three';
import type { LevelMeshes } from '@home-sim/core/solid/levels';
import type { SolidMesh } from '@home-sim/core/solid/mesh';
import type { PlainMesh } from '@home-sim/core/solid/frames';
import { ROLES, type Role } from '@home-sim/core/solid/tags';

/** material of a surface role: 0 — wall, 1 — slab (and the soffits and fascias of the roof, a flat roof), 2 — pitched roof covering */
export const MATERIAL_OF: Record<Role, 0 | 1 | 2> = {
  elevation: 0, 'room-wall': 0, reveal: 0, chimney: 0, slab: 1, 'room-floor': 1, 'room-ceiling': 1, shaft: 1, eaves: 1, 'roof-underside': 1, 'roof-flat': 1, roof: 2,
};

export interface MeshArrays { position: Float32Array; normal: Float32Array; uv: Float32Array | null; index: Uint32Array; groups: { start: number; count: number; materialIndex: number }[] }
/** the arrays of a level solid or of a roof solid (with its windows) */
export interface LevelArrays { level: string; solid: MeshArrays; frames: MeshArrays | null; glass: MeshArrays | null }

/** project → three.js coordinates, in place */
function toThree(a: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i += 3) { const y = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = -y; }
  return a;
}

/** UV in metres in the plane of the face: plan (x, y) for horizontal faces, (along, up) otherwise */
function uvOf(pos: Float32Array, nor: Float32Array): Float32Array {
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
    if (Math.abs(nz) > 0.999) { uv[v * 2] = x; uv[v * 2 + 1] = y; continue; }
    const l = Math.hypot(nx, ny), hx = -ny / l, hy = nx / l;                        // horizontal direction in the face
    const sx = -nz * hy, sy = nz * hx, sz = nx * hy - ny * hx;                       // up the face: n × h
    uv[v * 2] = x * hx + y * hy; uv[v * 2 + 1] = x * sx + y * sy + z * sz;
  }
  return uv;
}

/** the level solid: triangles sorted by material (one group per material), UV from the project coordinates */
function solidArrays(m: SolidMesh): MeshArrays {
  const nTri = m.index.length / 3, mat = (i: number) => MATERIAL_OF[ROLES[m.role[i]]];
  const index = new Uint32Array(m.index.length), groups: MeshArrays['groups'] = [];
  let k = 0;
  for (const want of [0, 1, 2]) {
    const start = k;
    for (let i = 0; i < nTri; i++) if (mat(i) === want) { index.set(m.index.subarray(i * 3, i * 3 + 3), k); k += 3; }
    if (k > start) groups.push({ start, count: k - start, materialIndex: want });
  }
  const uv = uvOf(m.positions, m.normals);
  return { position: toThree(m.positions.slice()), normal: toThree(m.normals.slice()), uv, index, groups };
}

const plainArrays = (m: PlainMesh): MeshArrays | null => (m.index.length ? { position: toThree(m.positions.slice()), normal: toThree(m.normals.slice()), uv: null, index: m.index.slice(), groups: [] } : null);

/** three.js arrays of one level or roof (worker side) */
export const levelArrays = (l: Pick<LevelMeshes, 'level' | 'solid' | 'frames' | 'glass'>): LevelArrays => ({ level: l.level, solid: solidArrays(l.solid), frames: plainArrays(l.frames), glass: plainArrays(l.glass) });

/** the buffers of a level, for transferring them out of the worker */
export const levelBuffers = (l: LevelArrays): ArrayBuffer[] =>
  [l.solid, l.frames, l.glass].flatMap((a) => (a ? [a.position, a.normal, a.index, ...(a.uv ? [a.uv] : [])].map((x) => x.buffer as ArrayBuffer) : []));

/** BufferGeometry over the arrays (no copy) */
export function meshGeometry(a: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  if (a.uv) g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  for (const gr of a.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
