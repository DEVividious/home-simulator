// Marker of the selected room surface: a band along the surface EDGE instead of a blue overlay on the whole surface (the overlay
// repainted the material the user was choosing: terracotta rgb(112, 69, 56) → rgb(100, 101, 107)).
// The band is computed from the surface mesh (wall with openings, floor, sloped ceiling) — the tests check a geometric property:
// the band lies on the surface, covers its edge (also around openings) and does not run along inner mesh seams.
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { fixtureDir } from '../../test/setup';
import { allRooms } from '../model/rooms';
import { boundaryBand, boundarySegments } from '../three/boundaryBand';
import { ceilingGeometry, floorGeometry, wallGeometry } from '../three/surfaces';

type P = [number, number, number];
/** non-indexed mesh from triangles */
const mesh = (tris: P[][]): THREE.BufferGeometry => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3)); return g; };
/** rectangle [x0, x1] × [y0, y1] in the plane z = 0 as two triangles */
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0): P[][] => [[[x0, y0, z], [x1, y0, z], [x1, y1, z]], [[x0, y0, z], [x1, y1, z], [x0, y1, z]]];
const trisOf = (g: THREE.BufferGeometry): THREE.Vector3[][] => { const p = g.getAttribute('position'), out: THREE.Vector3[][] = []; for (let i = 0; i < p.count; i += 3) out.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k))); return out; };
/** whether a point lies in any triangle of the mesh (with a tolerance) */
function inside(tris: THREE.Vector3[][], q: P, tol = 1e-6): boolean {
  const p = new THREE.Vector3(...q), b = new THREE.Vector3();
  return tris.some(([a, c, d]) => {
    const n = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(d, a));
    if (n.lengthSq() < 1e-16 || Math.abs(n.normalize().dot(new THREE.Vector3().subVectors(p, a))) > 1e-4) return false;
    THREE.Triangle.getBarycoord(p, a, c, d, b);
    return b.x >= -tol && b.y >= -tol && b.z >= -tol;
  });
}
const W = 0.05;

describe('surface edge band (selection marker)', () => {
  it('rectangle: band of width w at every edge, full corners, free centre, nothing outside the surface', () => {
    const src = mesh(rect(0, 0, 2, 1)), band = trisOf(boundaryBand(src, W)), surf = trisOf(src);
    expect(boundarySegments(src)).toHaveLength(4);
    for (const q of [[0.02, 0.5], [1.98, 0.5], [1, 0.02], [1, 0.98], [0.03, 0.03], [1.97, 0.97], [0.049, 0.5]] as [number, number][]) expect(inside(band, [q[0], q[1], 0]), `edge ${q}`).toBe(true);
    for (const q of [[1, 0.5], [0.08, 0.5], [1, 0.1], [0.5, 0.5], [0.051, 0.3]] as [number, number][]) expect(inside(band, [q[0], q[1], 0]), `centre ${q}`).toBe(false);
    // the diagonal splitting the rectangle into two triangles is a mesh seam, not an edge
    expect(inside(band, [1, 0.5, 0])).toBe(false); expect(inside(band, [0.6, 0.3, 0])).toBe(false);
    for (const t of band) for (const v of t) expect(inside(surf, [v.x, v.y, v.z], 1e-4), `vertex ${v.toArray()}`).toBe(true);
  });
  it('wall with a window made of vertical strips (T seams as in wallGeometry): band around the opening, no lines along the seams', () => {
    // 4.0 × 2.5 m, window [1.5, 2.5] × [0.9, 2.1]: left and right strips full height, in the middle a strip below and above the window
    const src = mesh([...rect(0, 0, 1.5, 2.5), ...rect(1.5, 0, 2.5, 0.9), ...rect(1.5, 2.1, 2.5, 2.5), ...rect(2.5, 0, 4, 2.5)]), band = trisOf(boundaryBand(src, W)), surf = trisOf(src);
    const at = (x: number, y: number) => inside(band, [x, y, 0]);
    // outer outline and the opening edges (on the wall side)
    for (const [x, y] of [[0.02, 1.2], [3.98, 1.2], [2, 0.02], [2, 2.48], [1.48, 1.5], [2.52, 1.5], [2, 0.88], [2, 2.12]]) expect(at(x, y), `edge (${x}, ${y})`).toBe(true);
    // opening corners are concave for the wall — the corner square belongs to the band too (no notches)
    for (const [x, y] of [[1.47, 2.13], [2.53, 2.13], [1.47, 0.87], [2.53, 0.87]]) expect(at(x, y), `opening corner (${x}, ${y})`).toBe(true);
    // seams of the strips above and below the window (x = 1.5 and x = 2.5 outside the opening) are not edges
    for (const [x, y] of [[1.48, 0.4], [1.52, 0.4], [2.48, 0.4], [2.52, 0.4], [1.48, 2.3], [1.52, 2.3], [2.52, 2.3], [1.5, 0.45]]) expect(at(x, y), `seam (${x}, ${y})`).toBe(false);
    // wall interior and opening interior
    for (const [x, y] of [[0.75, 1.25], [3.2, 1.25], [2, 0.45], [2, 1.5], [1.6, 1.0]]) expect(at(x, y), `interior (${x}, ${y})`).toBe(false);
    for (const t of band) for (const v of t) expect(inside(surf, [v.x, v.y, v.z], 1e-4), `vertex ${v.toArray()}`).toBe(true);
    // edge: 4 outline edges + 4 opening edges (a strip edge next to the opening counts only over the opening height)
    const len = boundarySegments(src).reduce((s, e) => s + e.a.distanceTo(e.b), 0);
    expect(len).toBeCloseTo(2 * (4 + 2.5) + 2 * (1 + 1.2), 6);
  });
  it('door down to the floor: the bottom edge band is interrupted in the opening, the band runs around the opening', () => {
    const src = mesh([...rect(0, 0, 1, 2.5), ...rect(1, 2.0, 1.9, 2.5), ...rect(1.9, 0, 3, 2.5)]), band = trisOf(boundaryBand(src, W));
    const at = (x: number, y: number) => inside(band, [x, y, 0]);
    expect([at(0.5, 0.02), at(2.5, 0.02), at(0.98, 1), at(1.92, 1), at(1.45, 2.02)]).toEqual([true, true, true, true, true]);
    expect([at(1.45, 0.02), at(1.45, 1), at(0.98, 2.2), at(0.5, 1.2)]).toEqual([false, false, false, false]);
  });
  it('sloped ceiling (two planes): band only on the perimeter, the fold is not an edge, the band lies on both planes', () => {
    // flat part y ∈ [0, 2] at z = 2.6 and a slope y ∈ [2, 3] falling to z = 1.76 (40°); x ∈ [0, 3]
    const z = (y: number) => (y <= 2 ? 2.6 : 2.6 - (y - 2) * 0.84), q = (x0: number, y0: number, x1: number, y1: number): P[][] => [[[x0, y0, z(y0)], [x1, y0, z(y0)], [x1, y1, z(y1)]], [[x0, y0, z(y0)], [x1, y1, z(y1)], [x0, y1, z(y1)]]];
    const src = mesh([...q(0, 0, 3, 2), ...q(0, 2, 1.2, 3), ...q(1.2, 2, 3, 3)]), band = trisOf(boundaryBand(src, W)), surf = trisOf(src);
    const at = (x: number, y: number) => inside(band, [x, y, z(y)], 1e-6);
    expect([at(1.5, 0.02), at(0.02, 1), at(2.98, 2.5), at(1.5, 2.98), at(0.02, 2.5)]).toEqual([true, true, true, true, true]);
    expect([at(1.5, 1.98), at(1.5, 2.02), at(1.2, 2.5), at(1.5, 1)]).toEqual([false, false, false, false]);
    for (const t of band) for (const v of t) expect(inside(surf, [v.x, v.y, v.z], 1e-4)).toBe(true);
  });
  it('empty or degenerate mesh: empty band, no exception', () => {
    expect(boundaryBand(mesh([]), W).getAttribute('position').count).toBe(0);
    expect(boundaryBand(mesh([[[0, 0, 0], [1, 0, 0], [2, 0, 0]]]), W).getAttribute('position').count).toBe(0);
  });
  // demo apartment (active), sample house (two levels, stair opening in the landing floor), sloped-ceiling fixture (ceiling strips, polygonal glazing)
  const root = path.resolve(__dirname, '..', '..', '..');
  for (const [name, dir] of [['demo-apartment', null], ['sample-house', path.join(root, 'projects', 'sample-house')], ['sloped-ceiling', fixtureDir('sloped-ceiling')]] as const) {
    it(`project surfaces of ${name} (every wall, floor and ceiling of every room): band not empty, on the surface, no NaN, in reasonable time`, () => {
      const run = () => {
        const t0 = performance.now(); let n = 0, total = 0;
        for (const room of allRooms()) {
          for (const [id, src] of [...room.walls.map((w) => [w.id, wallGeometry(room, w)] as const), [`${room.id} floor`, floorGeometry(room)] as const, [`${room.id} ceiling`, ceilingGeometry(room)] as const]) {
            total++;
            if (!src.getAttribute('position').count) continue;                          // wall entirely taken by an opening
            const g = boundaryBand(src, W), p = g.getAttribute('position'), surf = trisOf(src);
            expect(p.count, id).toBeGreaterThan(0); expect(p.count % 3, id).toBe(0);
            expect([...(p.array as Float32Array)].every(Number.isFinite), id).toBe(true);
            // band vertices on the surface (every eighth checked — meshes have hundreds of triangles)
            for (let i = 0; i < p.count; i += 8) expect(inside(surf, [p.getX(i), p.getY(i), p.getZ(i)], 2e-3), `${id} vertex ${i}`).toBe(true);
            n++;
          }
        }
        // rectangular rooms: 4 walls + floor + ceiling each, none of them empty
        expect(n).toBe(total);
        expect(total).toBe(allRooms().length * 6);
        expect(performance.now() - t0).toBeLessThan(8000);
      };
      if (dir) withProject(readProjectDir(dir), run); else run();
    });
  }
});
