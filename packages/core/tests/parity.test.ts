// Parity of the manifold shell with the grid shell it replaces (ADR 0024, 0026): per level the wall volume (±0.5 %), the section
// area at the cut height, the bounds (±1 mm), the window ids and the reveal depths — on both examples and the fixtures. The one
// intended difference: glazing with a polygonal outline is cut to its outline, where the grid cut its bounding rectangle.
import { beforeAll, describe, expect, it } from 'vitest';
import { building, roomsOfLevel, type Building } from '@home-sim/core/model/building';
import { gridLevelShell, gridShellBounds, type ShellQuad } from '@home-sim/core/model/gridShell';
import { levelSolid, shellBounds, shellMeshes } from '@home-sim/core/solid/levels';
import { scoped } from '@home-sim/core/solid/scope';
import { sectionAt } from '@home-sim/core/solid/slice';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { PACKAGES } from './packages';

/** volume enclosed by closed axis-aligned quads (divergence theorem) */
const quadVolume = (qs: ShellQuad[]) => qs.reduce((s, q) => {
  const [a, b, , d] = q.p, area = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  return s + ((a[0] * q.n[0] + a[1] * q.n[1] + a[2] * q.n[2]) * area) / 3;
}, 0);
/** area of the horizontal section of closed axis-aligned quads at height z (divergence theorem in plan) */
const quadSection = (qs: ShellQuad[], z: number) => qs.reduce((s, q) => {
  const zs = q.p.map((p) => p[2]);
  if (q.n[2] !== 0 || !(Math.min(...zs) < z && Math.max(...zs) > z)) return s;
  const [a, b] = q.p;
  return s + ((((a[0] + b[0]) / 2) * q.n[0] + ((a[1] + b[1]) / 2) * q.n[1]) * Math.hypot(b[0] - a[0], b[1] - a[1])) / 2;
}, 0);

/** the building with polygonal openings cut as their bounding rectangles — what the grid shell does */
function rectangular(b: Building): Building {
  const rooms = b.rooms.map((r) => ({ ...r, walls: r.walls.map((w) => ({ ...w, holes: w.holes.map((h) => ({ ...h, polygon: undefined })) })) }));
  return { ...b, rooms, roomById: new Map(rooms.map((r) => [r.id, r])), roomsByLevel: new Map(b.levels.map((l) => [l.id, rooms.filter((r) => r.level === l.id)])) };
}

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

describe('manifold shell vs grid shell', () => {
  for (const [id, data] of Object.entries(PACKAGES)) {
    describe(id, () => {
      it('wall volume per level within 0.5 %, the same section area at the cut height', () => {
        const b = building(data()), rect = rectangular(b);
        for (const l of b.levels) scoped((keep) => {
          const s = levelSolid(geo, keep, rect, l.id);
          if (!s) return;
          const grid = gridLevelShell(b, l.id);
          // walls: the solid inside the wall mass in plan, between the floor and the wall top
          const wallPlan = keep(keep(new geo.CrossSection(s.plan.footprint)).subtract(keep(new geo.CrossSection(roomsOfLevel(b, l.id).map((r) => r.polygon)))));
          const region = keep(keep(wallPlan.extrude(s.frame.wallTop - s.frame.floor)).translate([0, 0, s.frame.floor]));
          const vol = keep(s.solid.intersect(region)).volume(), want = quadVolume(grid.walls);
          expect(Math.abs(vol - want) / want, `${l.id}: ${vol} vs ${want}`).toBeLessThan(0.005);
          const z = l.floorZ + l.cutHeight;
          expect(sectionAt(keep, s.solid, z).area).toBeCloseTo(quadSection(grid.walls, z), 4);
        });
      });

      it('bounds within 1 mm; the pure bounds equal the solid bounds', () => {
        const b = building(data()), g = gridShellBounds(b), c = shellBounds(b), m = shellMeshes(geo, b);
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(c.min[k] - g.min[k])).toBeLessThan(1e-3);
          expect(Math.abs(c.max[k] - g.max[k])).toBeLessThan(1e-3);
          expect(Math.abs(Math.min(...m.levels.map((l) => l.bounds.min[k])) - c.min[k])).toBeLessThan(1e-3);
          expect(Math.abs(Math.max(...m.levels.map((l) => l.bounds.max[k])) - c.max[k])).toBeLessThan(1e-3);
        }
      });

      it('the same windows with the same reveal depths', () => {
        const b = building(data()), m = shellMeshes(geo, b);
        for (const l of m.levels) {
          const grid = gridLevelShell(b, l.level).windows;
          expect(l.windows.map((w) => w.id)).toEqual(grid.map((w) => w.id));
          for (const w of l.windows) {
            const g = grid.find((x) => x.id === w.id)!;
            expect(w.depth).toBeCloseTo(g.depth, 4);
            expect([w.a, w.dir, w.out, w.width, w.z0, w.z1].flat().map((v) => +v.toFixed(6))).toEqual([g.a, g.dir, g.out, g.width, g.z0, g.z1].flat().map((v) => +v.toFixed(6)));
          }
        }
      });
    });
  }

  it('glazing with a polygonal outline is cut to the outline: the solid keeps the rest of its bounding rectangle', () => {
    const b = building(PACKAGES['sloped-ceiling']());
    for (const l of b.levels) scoped((keep) => {
      const exact = levelSolid(geo, keep, b, l.id)!, boxed = levelSolid(geo, keep, rectangular(b), l.id)!;
      const polys = exact.cuts.filter((c) => !c.box);
      expect(polys.length).toBeGreaterThan(0);
      const area = (p: [number, number][]) => Math.abs(p.reduce((s, a, i) => { const q = p[(i + 1) % p.length]; return s + a[0] * q[1] - q[0] * a[1]; }, 0)) / 2;
      const kept = polys.reduce((s, c) => {
        const h = b.roomById.get(c.roomId)!.walls.find((w) => w.id === c.wallId)!.holes.find((x) => x.id === c.id)!;
        const r = boxed.cuts.find((x) => x.id === c.id && x.roomId === c.roomId)!;
        return s + ((h.t1 - h.t0) * (r.z1 - r.z0) - area(c.outline)) * c.depth;
      }, 0);
      expect(kept).toBeGreaterThan(0.01);
      expect(exact.solid.volume() - boxed.solid.volume()).toBeCloseTo(kept, 4);
    });
  });
});
