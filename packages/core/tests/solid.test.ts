// The manifold shell: closed level solids, a role for every triangle from the tag of its input (ADR 0025), WASM objects freed
// (ADR 0026), and the budget of the sample house.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { building } from '@home-sim/core/model/building';
import { levelSolid, shellMeshes } from '@home-sim/core/solid/levels';
import type { SolidMesh } from '@home-sim/core/solid/mesh';
import { liveObjects, scoped } from '@home-sim/core/solid/scope';
import { ROLES, type Role } from '@home-sim/core/solid/tags';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { PACKAGES, ROOT } from './packages';

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

const tri = (m: SolidMesh, i: number) => [0, 1, 2].map((k) => { const v = m.index[i * 3 + k]; return [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]; });
const normal = (m: SolidMesh, i: number) => { const v = m.index[i * 3]; return [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]]; };
const roleOfTri = (m: SolidMesh, i: number): Role => ROLES[m.role[i]];

describe('level solids', () => {
  for (const [id, data] of Object.entries(PACKAGES)) {
    it(`${id}: every level mesh is closed (each edge twice, in opposite directions) and every triangle has a role from its input`, () => {
      const b = building(data()), shell = shellMeshes(geo, b);
      expect(shell.levels.map((l) => l.level)).toEqual(b.levels.filter((l) => b.roomsByLevel.get(l.id)!.length).map((l) => l.id));
      for (const l of shell.levels) {
        const m = l.solid, nTri = m.index.length / 3, key = (p: number[]) => p.map((v) => v.toFixed(5)).join(',');
        const edges = new Map<string, number>();
        for (let i = 0; i < nTri; i++) {
          const p = tri(m, i).map(key);
          for (let k = 0; k < 3; k++) { const e = `${p[k]}>${p[(k + 1) % 3]}`; edges.set(e, (edges.get(e) ?? 0) + 1); }
        }
        for (const [e, n] of edges) {
          const [a, c] = e.split('>');
          expect(n, e).toBe(1);
          expect(edges.get(`${c}>${a}`), e).toBe(1);
        }
        for (let i = 0; i < nTri; i++) {
          const role = roleOfTri(m, i), tag = m.tags[m.tag[i]], n = normal(m, i), z = tri(m, i).map((p) => p[2]);
          expect(tag.level).toBe(l.level);
          if (role === 'elevation') expect(Math.abs(n[2])).toBeLessThan(0.5);
          if (role === 'room-floor') { expect(n[2]).toBeGreaterThan(0.99); expect(z.every((v) => Math.abs(v - b.roomById.get(tag.roomId!)!.floorZ) < 1e-4)).toBe(true); }
          if (role === 'room-ceiling') expect(n[2]).toBeLessThan(-0.99);
          if (role === 'reveal') expect(tag.holeId).toBeTruthy();
          if (role === 'shaft') expect(b.stairs.some((s) => s.toLevel === l.level)).toBe(true);
        }
        // the floor of every room and the elevation are there
        const roles = new Set([...m.role].map((r) => ROLES[r]));
        expect(roles.has('elevation') && roles.has('slab') && roles.has('room-wall') && roles.has('room-floor')).toBe(true);
        for (const r of b.roomsByLevel.get(l.level)!) expect([...m.role].some((code, i) => ROLES[code] === 'room-floor' && m.tags[m.tag[i]].roomId === r.id), r.id).toBe(true);
      }
    });
  }

  it('an opening shared by two rooms is cut once; the stair shaft opens the slab of the level it arrives at', () => {
    const b = building(PACKAGES['sample-house']());
    scoped((keep) => {
      const l1 = levelSolid(geo, keep, b, 'L1')!;
      const ids = l1.cuts.map((c) => c.id);
      expect(ids.filter((x) => x === 'D3')).toEqual(['D3']);
      const [x0, y0, x1, y1] = b.rooms.find((r) => r.stairOpening)!.stairOpening!;
      // a section through the slab of L1: the footprint minus the shaft; the ground slab has no shaft
      const footprint = keep(new geo.CrossSection(l1.plan.footprint)).area();
      expect(keep(l1.solid.slice(l1.frame.floor - 0.1)).area()).toBeCloseTo(footprint - (x1 - x0) * (y1 - y0), 4);
      expect(keep(levelSolid(geo, keep, b, 'L0')!.solid.slice(-0.1)).area()).toBeCloseTo(footprint, 4);
    });
  });

  it('window frames: four bars (five with a mullion) and a pane inside the wall thickness', () => {
    const b = building(PACKAGES['sample-house']()), shell = shellMeshes(geo, b);
    for (const l of shell.levels) {
      const bars = l.windows.reduce((n, w) => n + (w.width > 1.6 ? 5 : 4), 0);
      expect(l.frames.index.length).toBe(bars * 36);
      expect(l.glass.index.length).toBe(l.windows.length * 36);
      for (let v = 0; v < l.frames.normals.length; v += 3) expect(Math.hypot(l.frames.normals[v], l.frames.normals[v + 1], l.frames.normals[v + 2])).toBeCloseTo(1, 6);
    }
  });
});

describe('WASM objects and heap', () => {
  it('every object made during a build is freed (also when a build throws)', () => {
    const b = building(PACKAGES['two-storey-l']());
    for (const l of b.levels) scoped((keep) => { levelSolid(geo, keep, b, l.id); expect(liveObjects()).toBeGreaterThan(0); });
    expect(liveObjects()).toBe(0);
    expect(() => scoped((keep) => { keep(geo.Manifold.cube(1)); throw new Error('boom'); })).toThrow('boom');
    expect(liveObjects()).toBe(0);
  });

  it('the WASM heap does not grow over 20 rebuilds', async () => {
    const bytes = fs.readFileSync(path.join(ROOT, 'node_modules/manifold-3d/manifold.wasm'));
    let memory: { buffer: ArrayBuffer } | null = null;
    const own = await loadGeometry({
      instantiateWasm: (imports, done) => {
        void WebAssembly.instantiate(bytes, imports as WebAssembly.Imports).then(({ instance, module }) => {
          memory = Object.values(instance.exports).find((e) => e instanceof WebAssembly.Memory) as WebAssembly.Memory;
          done(instance, module);
        });
        return {};
      },
    });
    const sizes: number[] = [];
    for (let i = 0; i < 21; i++) {
      const b = building(PACKAGES['sample-house']());
      shellMeshes(own, b);
      sizes.push(memory!.buffer.byteLength);
    }
    expect(sizes.slice(1).every((s) => s === sizes[1]), sizes.join(' ')).toBe(true);
  });

  it('budget: the sample house solids in ≤ 150 ms and ≤ 60k triangles', () => {
    shellMeshes(geo, building(PACKAGES['sample-house']()));                     // warm-up
    const t0 = performance.now(), shell = shellMeshes(geo, building(PACKAGES['sample-house']())), ms = performance.now() - t0;
    expect(ms).toBeLessThan(150);
    expect(shell.triangles).toBeLessThan(60000);
  });
});
