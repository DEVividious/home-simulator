// A solid as plain arrays: flat-shaded triangles (a vertex per corner of a face, not per triangle), the role of every triangle
// and the tag of the input it came from (ADR 0025). The kernel's mesh is read once; nothing of the WASM heap is kept. Where
// several planes meet in one point (a roof valley ending at the corner of two eaves) the kernel keeps two vertices a hair apart
// on the boundary of two inputs, joined by zero-area slivers: they are welded and the slivers dropped.
import type { Vec3 } from '../package/types.ts';
import { roleCode, roleOf, type Tag, type TagTable } from './tags.ts';
import type { Manifold } from './wasm.ts';

export interface SolidMesh {
  /** vertex positions and unit normals (project coordinates, z up) */
  positions: Float32Array;
  normals: Float32Array;
  /** triangles, counter-clockwise from outside */
  index: Uint32Array;
  /** per triangle: role code (tags.ts ROLES) and the index of its input in `tags` */
  role: Uint8Array;
  tag: Uint16Array;
  tags: Tag[];
}

/** vertices closer than this are one vertex [m] (inputs are snapped to 0.1 mm, so distinct vertices are farther apart) */
const WELD = 1e-5;

/** the representative of every vertex: the first vertex within WELD of it (a grid of WELD cells, neighbours checked) */
function weld(P: Float32Array, np: number): Uint32Array {
  const n = P.length / np, rep = new Uint32Array(n), cells = new Map<string, number[]>();
  for (let v = 0; v < n; v++) {
    const x = P[v * np], y = P[v * np + 1], z = P[v * np + 2], cx = Math.round(x / WELD), cy = Math.round(y / WELD), cz = Math.round(z / WELD);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      for (const w of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (Math.abs(P[w * np] - x) <= WELD && Math.abs(P[w * np + 1] - y) <= WELD && Math.abs(P[w * np + 2] - z) <= WELD) { found = w; break; }
    }
    if (found < 0) { found = v; const k = `${cx},${cy},${cz}`; cells.set(k, [...(cells.get(k) ?? []), v]); }
    rep[v] = found;
  }
  return rep;
}

/** the mesh of a solid; every triangle must come from a tagged input */
export function solidMesh(m: Manifold, table: TagTable): SolidMesh {
  const mesh = m.getMesh();
  const P = mesh.vertProperties, np = mesh.numProp, rep = weld(P, np), raw = mesh.triVerts;
  // triangles with their vertices welded; those that collapse are dropped (kept: their index in the kernel's mesh)
  const keptTri: number[] = [];
  for (let i = 0; i < raw.length / 3; i++) { const a = rep[raw[i * 3]], b = rep[raw[i * 3 + 1]], c = rep[raw[i * 3 + 2]]; if (a !== b && b !== c && a !== c) keptTri.push(i); }
  const T = new Uint32Array(keptTri.length * 3);
  keptTri.forEach((i, j) => { T[j * 3] = rep[raw[i * 3]]; T[j * 3 + 1] = rep[raw[i * 3 + 1]]; T[j * 3 + 2] = rep[raw[i * 3 + 2]]; });
  const nTri = keptTri.length;
  const runId = mesh.runOriginalID, runAt = mesh.runIndex, faceID = mesh.faceID;
  // tag of every triangle: one entry in `tags` per original that has triangles
  const tags: Tag[] = [], tagOf = new Map<number, number>(), rawTag = new Uint16Array(raw.length / 3);
  for (let r = 0; r < runId.length; r++) {
    const id = runId[r], tag = table.get(id);
    if (!tag) throw new Error(`solid: triangles of an untagged input (original ${id})`);
    let k = tagOf.get(id);
    if (k === undefined) { k = tags.length; tags.push(tag); tagOf.set(id, k); }
    rawTag.fill(k, runAt[r] / 3, runAt[r + 1] / 3);
  }
  const triTag = new Uint16Array(nTri);
  keptTri.forEach((i, j) => { triTag[j] = rawTag[i]; });
  // faces (input, face id): area-weighted normal; a vertex is shared only within one face
  const faceOf = new Map<number, number>(), triFace = new Uint32Array(nTri), fn: number[] = [];
  const nTags = Math.max(1, tags.length);
  for (let i = 0; i < nTri; i++) {
    const a = T[i * 3] * np, b = T[i * 3 + 1] * np, c = T[i * 3 + 2] * np;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const key = (faceID.length ? faceID[keptTri[i]] : i) * nTags + triTag[i];
    let f = faceOf.get(key);
    if (f === undefined) { f = fn.length / 3; faceOf.set(key, f); fn.push(0, 0, 0); }
    triFace[i] = f;
    fn[f * 3] += uy * vz - uz * vy; fn[f * 3 + 1] += uz * vx - ux * vz; fn[f * 3 + 2] += ux * vy - uy * vx;
  }
  for (let f = 0; f < fn.length / 3; f++) { const l = Math.hypot(fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]) || 1; fn[f * 3] /= l; fn[f * 3 + 1] /= l; fn[f * 3 + 2] /= l; }
  const nFaces = fn.length / 3, vertOf = new Map<number, number>(), pos: number[] = [], nor: number[] = [], index = new Uint32Array(nTri * 3);
  const role = new Uint8Array(nTri);
  for (let i = 0; i < nTri; i++) {
    const f = triFace[i], n: Vec3 = [fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]];
    role[i] = roleCode(roleOf(tags[triTag[i]], n));
    for (let k = 0; k < 3; k++) {
      const v = T[i * 3 + k], key = v * nFaces + f;
      let o = vertOf.get(key);
      if (o === undefined) { o = pos.length / 3; vertOf.set(key, o); pos.push(P[v * np], P[v * np + 1], P[v * np + 2]); nor.push(n[0], n[1], n[2]); }
      index[i * 3 + k] = o;
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), index, role, tag: triTag, tags };
}
