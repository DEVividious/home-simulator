// The roof (ADR 0027, 0028): the planes of every part type, unions of wings with their valleys, dormers, roof windows, chimneys,
// parapets — as model surfaces and as solids; the old attic formula as an oracle; the checks of the compiler.
import { beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { building, type BuildingData } from '@home-sim/core/model/building';
import { planeZ, surfaceAt, type Surface } from '@home-sim/core/model/roof';
import { levelSolid, shellBounds, shellMeshes } from '@home-sim/core/solid/levels';
import type { SolidMesh } from '@home-sim/core/solid/mesh';
import { roofSolid } from '@home-sim/core/solid/roofSolid';
import { scoped } from '@home-sim/core/solid/scope';
import { sectionAt } from '@home-sim/core/solid/slice';
import { ROLES } from '@home-sim/core/solid/tags';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { PACKAGES, planOf, ROOF_FIXTURES } from './packages';

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });

const tan = (d: number) => Math.tan((d * Math.PI) / 180), cos = (d: number) => Math.cos((d * Math.PI) / 180);
const roles = (m: SolidMesh) => new Set([...m.role].map((r) => ROLES[r]));
/** whether the mesh has a vertex within 1 mm of the point */
const hasVertex = (m: SolidMesh, p: number[]) => { for (let v = 0; v < m.positions.length; v += 3) if (Math.hypot(m.positions[v] - p[0], m.positions[v + 1] - p[1], m.positions[v + 2] - p[2]) < 1e-3) return true; return false; };
const inLoops = (q: [number, number], loops: [number, number][][]) => {
  let inside = false;
  for (const p of loops) for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > q[1]) !== (p[j][1] > q[1]) && q[0] < ((p[j][0] - p[i][0]) * (q[1] - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  return inside;
};
const compiled = (plan: unknown) => compilePlan(plan, { catalog: null });
const codes = (plan: unknown) => compiled(plan).issues.map((i) => `${i.level}:${i.code}`);

describe('roof solids of every fixture', () => {
  for (const id of ROOF_FIXTURES) {
    it(`${id}: compiles without errors; the pure bounds are the bounds of the level and roof meshes (±1 mm)`, () => {
      expect(compiled(planOf(id)).issues.filter((i) => i.level === 'error')).toEqual([]);
      const b = building(PACKAGES[id]()), pure = shellBounds(b), m = shellMeshes(geo, b), all = [...m.levels, ...m.roofs];
      expect(m.roofs.length).toBeGreaterThan(0);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(Math.min(...all.map((l) => l.bounds.min[k])) - pure.min[k])).toBeLessThan(1e-3);
        expect(Math.abs(Math.max(...all.map((l) => l.bounds.max[k])) - pure.max[k])).toBeLessThan(1e-3);
      }
      for (const r of m.roofs) expect(r.volume).toBeGreaterThan(0);
    });
  }
});

describe('part types', () => {
  it('gable along X over a flat ceiling: the roof volume is its extent × the thickness across the slope (analytic)', () => {
    const b = building(PACKAGES['roof-gable-x']()), r = shellMeshes(geo, b).roofs[0];
    // extent: the walls 10 × 7 m grown by the verge 0.3 (gable ends) and the eaves 0.5; 0.30 m thick at 35°
    expect(Math.abs(r.volume / ((10.6 * 8) * (0.3 / cos(35))) - 1)).toBeLessThan(1e-6);   // the planes are stored to 1e-6
    // the default knee: the ceiling + the slab; the ridge in the middle
    const U: Surface = { pieces: b.roof!.pieces, which: 'region' };
    expect(surfaceAt(U, 5, 0)!.z).toBeCloseTo(2.85, 4);
    expect(surfaceAt(U, 5, 3.5)!.z).toBeCloseTo(2.85 + 3.5 * tan(35), 4);
    // the rooms keep their flat ceilings: the roof is above them everywhere
    for (const room of b.rooms) expect(room.ceiling.kind).toBe('flat');
  });

  it('gable along Y with a knee wall: the attic ceilings follow the slope up to the flat top', () => {
    const b = building(PACKAGES['roof-gable-y']()), a2 = b.roomById.get('A2')!;
    expect(a2.ceiling.kind).toBe('roof');
    // knee 1.0 at the outer face (x = 0), 40°: at the inner face (x = 0.3) 1.0 + 0.3·tan 40; the flat top 2.5 in the middle
    expect(a2.ceiling.heightAt(0.3, 10)).toBeCloseTo(1 + 0.3 * tan(40), 4);
    expect(a2.ceiling.heightAt(4, 10)).toBeCloseTo(2.5, 6);
  });

  it('hip: four planes, the ridge shortened by the steeper ends', () => {
    const b = building(PACKAGES['roof-hip']()), r = shellMeshes(geo, b).roofs[0], th = 0.3;
    // the ends (40°) reach the ridge height (4.5·tan 30 above the eaves) at 4.5·tan 30 / tan 40 from the outer faces
    const zr = 2.95 + 4.5 * tan(30), e = (4.5 * tan(30)) / tan(40);
    const top = (x: number, y: number) => surfaceAt({ pieces: b.roof!.pieces, which: 'cover', lift: th }, x, y)!.z;
    expect(top(e, 4.5)).toBeCloseTo(zr + th / cos(30), 3);
    expect(top(e / 2, 4.5)).toBeLessThan(zr);
    // the ridge of the underside ends where the end planes reach it
    expect(hasVertex(r.solid, [e, 4.5, zr])).toBe(true);
    expect(hasVertex(r.solid, [12 - e, 4.5, zr])).toBe(true);
  });

  it('shed: one plane from the low eaves to the high side', () => {
    const b = building(PACKAGES['roof-shed']()), U: Surface = { pieces: b.roof!.pieces, which: 'region' };
    expect(surfaceAt(U, 4, 0)!.z).toBeCloseTo(2.85, 4);
    expect(surfaceAt(U, 4, 6)!.z).toBeCloseTo(2.85 + 6 * tan(12), 4);
  });

  it('flat with a parapet: a flat covering (its own role) and a parapet ring up to the covering + parapet', () => {
    const b = building(PACKAGES['roof-flat']()), r = shellMeshes(geo, b).roofs[0];
    expect(r.bounds.max[2]).toBeCloseTo(2.8 + 0.3 + 0.6, 4);
    expect(roles(r.solid).has('roof-flat')).toBe(true);
    expect(roles(r.solid).has('roof')).toBe(false);
    // the parapet stands on the walls of the L-shaped outline (outer faces)
    expect([...r.solid.role].some((code, i) => ROLES[code] === 'elevation' && r.solid.tags[r.solid.tag[i]].kind === 'parapet')).toBe(true);
    expect(b.roof!.json.parts[0].polygon).toHaveLength(6);
  });
});

describe('wings: unions with valleys', () => {
  it('L gable: the wing runs into the main roof up to its ridge; the valleys run from the inner eaves corner and from the outer corner to where the lower ridge meets the main slope', () => {
    const b = building(PACKAGES['roof-l-gable']()), r = shellMeshes(geo, b).roofs[0], th = 0.3, k = tan(40), zK = 2.85;
    const wing = b.roof!.json.parts.find((p) => p.id === 'wing')!;
    expect(wing.extent).toEqual([[-0.5, 8, 6.5, 14.3], [-0.3, 4, 6.5, 8]]);       // no verge at the joined end; the strip to the main ridge (y = 4)
    const top: Surface = { pieces: b.roof!.pieces, which: 'cover', lift: th }, T = (x: number, y: number) => surfaceAt(top, x, y)!;
    // the inner valley: y = x + 2 (main north plane = wing east plane); the outer one: x + y = 8
    for (const x of [3.5, 4.5, 5.5]) {
      expect(T(x, x + 2 - 0.05).plane).not.toBe(T(x, x + 2 + 0.05).plane);
      expect(T(x, x + 2).z).toBeCloseTo(zK + (6 - x) * k + th / cos(40), 4);
    }
    for (const x of [0.5, 1.5, 2.5]) expect(T(x, 8 - x - 0.05).plane).not.toBe(T(x, 8 - x + 0.05).plane);
    // the valley foot is the corner of the two eaves lines; the lower ridge meets the main slope at (3, 5)
    expect(hasVertex(r.solid, [6.5, 8.5, zK - 0.5 * k + th / cos(40)])).toBe(true);
    expect(hasVertex(r.solid, [3, 5, zK + 3 * k + th / cos(40)])).toBe(true);
    expect(roles(r.solid).has('roof')).toBe(true);
  });

  it('T hip: the wing loses its hip at the joined end and runs to the main ridge; one closed roof', () => {
    const b = building(PACKAGES['roof-t-hip']()), wing = b.roof!.json.parts.find((p) => p.id === 'wing')!;
    expect(wing.planes).toHaveLength(3);
    expect(wing.extent).toEqual([[3.5, 8, 10.5, 14.5], [3.5, 4, 10.5, 8]]);
    scoped((keep) => {
      const r = roofSolid(geo, keep, b, 'G', -2, 20)!;
      expect(r.solid.decompose().length).toBe(1);
      expect(r.solid.genus()).toBe(0);
      for (const part of r.solid.decompose()) keep(part);
    });
    expect(hasVertex(shellMeshes(geo, b).roofs[0].solid, [10.5, 8.5, 2.85 - 0.5 * tan(35)])).toBe(true);
  });
});

describe('the old attic ceilings', () => {
  it('a package written before the roof: its attic ceilings and the derived roof underside are the old formula (±1 mm)', () => {
    const data = PACKAGES['sloped-ceiling']() as BuildingData, b = building(data);
    expect(b.roof?.fromAttic).toBe(true);
    for (const json of data.rooms.rooms) {
      const room = b.roomById.get(json.id)!, c = json.ceiling, [x0, y0, x1, y1] = room.bbox;
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
        const x = x0 + ((x1 - x0) * i) / 10, y = y0 + ((y1 - y0) * j) / 10;
        const zr = c.z_at_ridge! - c.slope! * Math.abs(c.ridge_y !== undefined ? y - c.ridge_y : x - c.ridge_x!);
        expect(Math.abs(room.ceiling.heightAt(x, y) - (Math.min(c.flat_z!, zr) - json.floor_z))).toBeLessThan(1e-3);
        expect(Math.abs(surfaceAt({ pieces: b.roof!.pieces, which: 'inner' }, x, y)!.z - zr)).toBeLessThan(1e-3);
      }
    }
  });

  it('a level mixing attic and flat ceilings gets no roof (its attic rooms keep their own planes)', () => {
    const b = building(PACKAGES['mount-lab']()), attic = b.rooms.find((r) => r.ceiling.kind === 'roof')!;
    expect(b.roof).toBe(null);
    expect(attic.ceiling.range()[0]).toBeLessThan(attic.ceiling.range()[1]);
  });
});

describe('dormers, roof windows, chimneys', () => {
  const b = () => building(PACKAGES['roof-gable-y']());

  it('a dormer in the wall plane: its window is an ordinary room window; the room rises into the dormer', () => {
    const B = b(), a1 = B.roomById.get('A1')!;
    expect(a1.windows.map((w) => w.id)).toContain('W3');
    expect(a1.walls.find((w) => w.holes.some((h) => h.id === 'W3'))!.a[0]).toBeCloseTo(0.3, 6);
    // inside the dormer the ceiling is its gable (2.3 at the cheeks, rising), next to it the main slope
    expect(a1.ceiling.heightAt(0.5, 2.5)).toBeGreaterThan(2.3);
    expect(a1.ceiling.heightAt(0.5, 4.5)).toBeCloseTo(1 + 0.5 * tan(40), 4);
    scoped((keep) => {
      const s = levelSolid(geo, keep, B, 'A')!, z = 2.85 + 2.2, sec = sectionAt(keep, s.solid, z).polygons;
      expect(inLoops([0.15, 2.0], sec)).toBe(true);           // the dormer front wall stands above the knee wall
      expect(inLoops([0.15, 4.5], sec)).toBe(false);          // the knee wall next to it is lower
      expect(s.cuts.some((c) => c.id === 'W3')).toBe(true);
    });
  });

  it('a dormer set back from the wall: a cutter through its front and a frame; it disappears into the roof at the ridge', () => {
    const B = b(), d = B.roof!.json.dormers!.find((x) => x.id === 'DS')!;
    expect(d.front).toBe('E');
    expect(d.rect[0]).toBe(4);                                // carried back to the ridge
    expect(d.window).toMatchObject({ id: 'W4', roomId: 'A2' });
    scoped((keep) => {
      const s = levelSolid(geo, keep, B, 'A')!, cut = s.cuts.find((c) => c.id === 'W4')!, w = s.windows.find((x) => x.id === 'W4')!;
      expect(cut.wallId).toBe('DS-front');
      expect(w.out).toEqual([1, 0]);
      expect(w.depth).toBeCloseTo(0.25, 6);
    });
    const m = shellMeshes(geo, B).levels.find((l) => l.level === 'A')!;
    expect([...m.solid.role].some((code, i) => ROLES[code] === 'reveal' && m.solid.tags[m.solid.tag[i]].holeId === 'W4')).toBe(true);
  });

  it('roof windows: openings through the roof perpendicular to it, frames in the slope, holes in the ceiling', () => {
    const B = b(), r = shellMeshes(geo, B).roofs[0], a1 = B.roomById.get('A1')!;
    expect(r.windows.map((w) => w.id).sort()).toEqual(['RW1', 'RW2']);
    const holes = new Set([...r.solid.role].flatMap((code, i) => (ROLES[code] === 'reveal' ? [r.solid.tags[r.solid.tag[i]].holeId] : [])));
    expect([...holes].sort()).toEqual(['RW1', 'RW2']);
    expect(r.frames.index.length).toBe(2 * 4 * 36);
    for (const w of r.windows) {
      expect(Math.hypot(...w.frame.n)).toBeCloseTo(1, 9);
      expect(w.frame.n[2]).toBeCloseTo(cos(40), 5);
      expect(w.frame.width).toBeCloseTo(1.2, 6);              // along the eaves
      expect(w.frame.height).toBeCloseTo(1.0 / cos(40), 5);   // 1.0 m in plan up the slope
    }
    const area = (p: number[][]) => Math.abs(p.reduce((s, q, i) => { const n = p[(i + 1) % p.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
    expect(a1.ceiling.facets().reduce((s, f) => s + area(f.polygon), 0)).toBeCloseTo(a1.area - 1.0 * 1.2, 3);
  });

  it('a chimney: in the levels it stands in and through the roof up to its top', () => {
    const m = shellMeshes(geo, b());
    expect(m.roofs[0].bounds.max[2]).toBeCloseTo(8, 6);
    expect(roles(m.roofs[0].solid).has('chimney')).toBe(true);
    for (const l of m.levels) expect(roles(l.solid).has('chimney'), l.level).toBe(true);
  });
});

describe('the section of a level under the roof', () => {
  it('cuts the walls that reach the section height, never the rooms under the slopes (the roof is a separate solid)', () => {
    const B = building(PACKAGES['roof-gable-y']()), l = B.levelById.get('A')!;
    scoped((keep) => {
      const s = levelSolid(geo, keep, B, 'A')!, sec = sectionAt(keep, s.solid, l.floorZ + l.cutHeight).polygons;
      expect(inLoops([4, 0.15], sec)).toBe(true);               // the gable wall is cut
      expect(inLoops([0.15, 4.5], sec)).toBe(false);            // the knee wall stays below the cut
      expect(inLoops([0.6, 4.5], sec)).toBe(false);             // the room under the slope is open from above
      expect(inLoops([7.4, 4.5], sec)).toBe(false);
    });
  });
});

describe('compiler checks', () => {
  const box = (roof: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test', project: { id: 'roof-check', name: 'Roof check', buildingType: 'house' },
    levels: [{ id: 'G', name: 'Ground', floorZ: 0, ceiling: 2.6 }],
    rooms: [{ id: 'R', name: 'Room', level: 'G', kind: 'living', rect: [0.3, 0.3, 9.7, 7.7] }],
    roof, ...extra,
  });
  const gable = (p: Record<string, unknown> = {}) => ({ parts: [{ id: 'main', level: 'G', type: 'gable', pitch: 40, knee: 1.2, ...p }] });

  it('a sound roof has no issues', () => expect(codes(box(gable()))).toEqual([]));
  it('pitch: 5–75° for pitched parts, 0–5° for flat ones', () => {
    expect(codes(box(gable({ pitch: 80 })))).toContain('error:schema');
    expect(codes(box(gable({ pitch: 3 })))).toContain('error:roof.pitch');
    expect(codes(box({ parts: [{ id: 'f', level: 'G', type: 'flat', pitch: 8 }] }))).toContain('error:roof.pitch');
  });
  it('a window head or a door above the roof plane at its wall is an error', () => {
    expect(codes(box(gable(), { windows: [{ id: 'W', room: 'R', at: [5, 0.3], width: 1, sill: 0.9, head: 2.1 }] }))).toContain('error:window.roof');
    expect(codes(box(gable(), { windows: [{ id: 'W', room: 'R', at: [0.3, 4], width: 1, sill: 0.9, head: 2.1 }] }))).not.toContain('error:window.roof');   // the gable wall
    expect(codes(box(gable(), { doors: [{ id: 'D', between: ['R', 'exterior'], at: [5, 0.15], width: 1 }] }))).toContain('error:door.roof');
  });
  it('a roof window across the ridge or on the flat top is an error', () => {
    expect(codes(box(gable(), { roofWindows: [{ id: 'RW', room: 'R', rect: [2, 3.5, 3, 4.5] }] }))).toContain('error:roofWindow.plane');
    expect(codes(box(gable(), { roofWindows: [{ id: 'RW', room: 'R', rect: [2, 2.5, 3, 3.5] }] }))).toContain('error:roofWindow.plane');   // the flat top
    expect(codes(box(gable(), { roofWindows: [{ id: 'RW', room: 'R', rect: [2, 0.5, 3, 1.4] }] }))).not.toContain('error:roofWindow.plane');
  });
  it('a dormer across a hip or too high for the roof is an error', () => {
    const hip = { parts: [{ id: 'main', level: 'G', type: 'hip', pitch: 40, knee: 1.2 }] };
    expect(codes(box({ ...hip, dormers: [{ id: 'DD', part: 'main', type: 'gable', rect: [0, 0, 2, 2], front: 2.2, pitch: 30 }] }))).toContain('error:dormer.plane');
    expect(codes(box({ ...gable(), dormers: [{ id: 'DD', part: 'main', type: 'gable', rect: [3, 0, 7, 2], front: 2.6, pitch: 60 }] }))).toContain('error:dormer.high');
  });
  it('walls under no roof part, or a level standing on a roof part, are errors', () => {
    expect(codes(box(gable({ rect: [0, 0, 6, 8] })))).toContain('error:roof.cover');
    const two = { levels: [{ id: 'G', name: 'Ground', floorZ: 0, ceiling: 2.6 }, { id: 'U', name: 'Upper', floorZ: 2.85, ceiling: 2.5 }], rooms: [{ id: 'R', name: 'Room', level: 'G', kind: 'living', rect: [0.3, 0.3, 9.7, 7.7] }, { id: 'S', name: 'Upper room', level: 'U', kind: 'bed', rect: [0.3, 0.3, 9.7, 7.7] }] };
    expect(codes(box(gable(), two))).toContain('error:roof.levelAbove');
  });
  it('warnings: a hip whose ends meet before the ridge, eaves of joined wings at different heights, the ridge height from the drawings, a slope that disagrees', () => {
    expect(codes(box({ parts: [{ id: 'main', level: 'G', type: 'hip', pitch: 40, pitchEnds: 15, knee: 1.2 }] }))).toContain('warning:roof.hip');
    const l = planOf('roof-l-gable') as { roof: { parts: Record<string, unknown>[] } };
    l.roof.parts[1].knee = 2.3;
    expect(codes(l)).toContain('warning:roof.eaves');
    expect(codes(box({ ...gable(), ridgeHeight: 9 }))).toContain('warning:roof.ridgeHeight');
    expect(codes(box({ ...gable(), ridgeHeight: 1.2 + 4 * tan(40) + 0.3 / cos(40) }))).not.toContain('warning:roof.ridgeHeight');
    const sloped = box(gable(), { levels: [{ id: 'G', name: 'Ground', floorZ: 0, ceiling: 2.5, slope: { ridge: 'X', lines: [{ at: 0.3, height: 1.8 }], pitch: 40 } }] });
    expect(codes(sloped)).toContain('warning:roof.slope');
  });
  it('furniture under the slope is checked against the roof', () => {
    const plan = box(gable(), { furniture: [{ room: 'R', catalogId: 'wardrobe', at: [5, 0.8], rot: 0, dims: { w: 1, d: 0.6, h: 2.2 } }] });
    expect(codes(plan)).toContain('warning:furniture.ceiling');
  });
  it('a level slope without a roof block becomes a gable part with the planes of the old ceilings', () => {
    const r = compiled(box(undefined as never, { levels: [{ id: 'G', name: 'Attic', floorZ: 0, ceiling: 2.5, slope: { ridge: 'X', lines: [{ at: 0.3, height: 1.4 }], pitch: 45 } }] }));
    const part = r.project!.building.roof!.parts[0], B = building(r.project!.building);
    expect(part).toMatchObject({ id: 'slope-G', type: 'gable', ridge: 'X', rect: [0, 0, 10, 8] });
    expect(planeZ({ gx: 0, gy: 0, z0: 0 }, 0, 0)).toBe(0);
    expect(B.roomById.get('R')!.ceiling.heightAt(5, 0.3)).toBeCloseTo(1.4, 4);
    expect(B.roomById.get('R')!.ceiling.heightAt(5, 4)).toBeCloseTo(2.5, 6);
  });
});
