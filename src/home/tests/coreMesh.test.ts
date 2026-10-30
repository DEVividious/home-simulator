// The core's level solids as three.js arrays (three/coreMesh.ts): triangles sorted into a wall and a slab group by their surface
// role, project → three.js coordinates, UV in metres in the plane of each face, buffers ready to transfer.
import { beforeAll, describe, expect, it } from 'vitest';
import { shellMeshes } from '@home-sim/core/solid/levels';
import { ROLES } from '@home-sim/core/solid/tags';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { building } from '../model/building';
import { levelArrays, levelBuffers, MATERIAL_OF, meshGeometry } from '../three/coreMesh';

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

describe('core shell arrays', () => {
  it('two material groups covering every triangle once, each triangle in the group of its role', () => {
    for (const l of shellMeshes(geo, building()).levels) {
      const a = levelArrays(l), nTri = l.solid.index.length / 3;
      expect(a.solid.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
      expect(a.solid.groups[0].start).toBe(0);
      expect(a.solid.groups[0].count + a.solid.groups[1].count).toBe(nTri * 3);
      // the triangles of a group are the triangles of its roles (compared as multisets of vertex triples)
      const triples = (idx: Uint32Array, from: number, count: number) => { const out: string[] = []; for (let i = from; i < from + count; i += 3) out.push([...idx.subarray(i, i + 3)].join()); return out.sort(); };
      for (const g of a.solid.groups) {
        const want: string[] = [];
        for (let i = 0; i < nTri; i++) if (MATERIAL_OF[ROLES[l.solid.role[i]]] === g.materialIndex) want.push([...l.solid.index.subarray(i * 3, i * 3 + 3)].join());
        expect(triples(a.solid.index, g.start, g.count)).toEqual(want.sort());
      }
    }
  });

  it('project (x, y, z) → three.js (x, z, −y); UV in metres: plan on horizontal faces, (along, height) on walls', () => {
    const l = shellMeshes(geo, building()).levels[0], a = levelArrays(l), p = l.solid.positions, n = l.solid.normals;
    for (let v = 0; v < p.length / 3; v++) {
      expect([a.solid.position[v * 3], a.solid.position[v * 3 + 1], a.solid.position[v * 3 + 2]].map((x) => x + 0)).toEqual([p[v * 3], p[v * 3 + 2], -p[v * 3 + 1]].map((x) => x + 0));
      const uv = [a.solid.uv![v * 2], a.solid.uv![v * 2 + 1]];
      if (Math.abs(n[v * 3 + 2]) > 0.999) expect(uv).toEqual([p[v * 3], p[v * 3 + 1]]);
      else expect(uv[1]).toBeCloseTo(p[v * 3 + 2], 5);
    }
  });

  it('a BufferGeometry over the arrays with its groups; the buffers are distinct and transferable', () => {
    const l = shellMeshes(geo, building()).levels[0], a = levelArrays(l), g = meshGeometry(a.solid);
    expect(g.groups.length).toBe(2);
    expect(g.getAttribute('position').array).toBe(a.solid.position);
    expect(g.boundingBox!.min.y).toBeCloseTo(l.bounds.min[2], 4);
    const bufs = levelBuffers(a);
    expect(new Set(bufs).size).toBe(bufs.length);
    expect(bufs).not.toContain(l.solid.positions.buffer);
    g.dispose();
  });
});
