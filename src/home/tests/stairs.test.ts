// Configurable stairs: finish stored in the project variant — validation, defaults, presets; geometry (cladding, risers,
// handrail, balustrade) within the stair outline; the room walk → building walk hand-over zone at the stairs.
// Stairs come from the project package: the sample house has U-turn stairs S1 (L0 → L1), the demo apartment has none.
import path from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { hasStairs, inStairBox, stairAllowed, stairArrivesAt, stairFacts, stairs, stairZ, type StairDef } from '../model/stairs';
import { DEFAULT_STAIRS, finishLook, isFinish, resolveStairs, STAIR_FINISHES, STAIRS_PRESETS, stairsErrors, stairsSummary, type StairsConfig } from '../model/stairsConfig';
import { variantExtrasErrors, type Variant } from '../model/variantData';
import { buildStairs, stairLayout } from '../three/stairGeometry';

const root = path.resolve(__dirname, '..', '..', '..');
const readProject = (id: string) => readProjectDir(path.join(root, 'projects', id));

const bb = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return { x: [b.min.x, b.max.x], z: [b.min.y, b.max.y], y: [-b.max.z, -b.min.z] }; };

describe('project without stairs (demo apartment)', () => {
  it('no stairs: nothing to walk on, no opening in any level', () => {
    expect(stairs()).toEqual([]);
    expect(hasStairs()).toBe(false);
    expect(stairArrivesAt('L1')).toBe(false);
    expect(inStairBox([1, 1], 0.25)).toBe(false);
    expect(stairZ([1, 1])).toBe(0);
    expect(stairAllowed([1, 1], 0.22)).toBe(false);
  });
});

describe('sample house stairs', () => {
  let S: StairDef;
  beforeAll(() => { activateProject(readProject('sample-house')); S = stairs()[0]; });
  afterAll(() => { activateProject(readProject('demo-apartment')); });

  describe('stairs configuration stored in the variant', () => {
    it('no record = as built (concrete, no cladding, handrails or balustrades); a partial record is completed with defaults', () => {
      expect(resolveStairs(undefined)).toEqual(DEFAULT_STAIRS);
      expect(resolveStairs(null)).toEqual(DEFAULT_STAIRS);
      const c = resolveStairs({ tread: 'oak', treadThickness: 0.04, handrail: { place: 'outer' } });
      expect(c.tread).toBe('oak'); expect(c.handrail).toEqual({ ...DEFAULT_STAIRS.handrail, place: 'outer' }); expect(c.balustrade).toEqual(DEFAULT_STAIRS.balustrade);
      expect(stairsSummary(DEFAULT_STAIRS)).toBe('concrete (no cladding) · no handrail · no balustrade');
      expect(stairsSummary(c)).toBe('treads: natural oak · handrail: outer side / on the wall · no balustrade');
    });
    it('validation: palette or #rrggbb colour, dimension ranges, types; valid presets pass', () => {
      for (const p of STAIRS_PRESETS) expect(stairsErrors(p.config), p.id).toEqual([]);
      expect(stairsErrors({ tread: '#a1b2c3', riser: 'none', handrail: { finish: '#000000' } })).toEqual([]);
      expect(isFinish('oak')).toBe(true); expect(isFinish('#12345')).toBe(false); expect(isFinish('mahogany')).toBe(false);
      const e = stairsErrors({ tread: 'mahogany', riser: 7, treadThickness: 0.2, nosing: -1, handrail: { place: 'ceiling', height: 2, profile: 'oval', finish: 'x' }, balustrade: { type: 'mesh', height: 0.5, finish: 5 } } as never).join(' | ');
      for (const re of [/stairs\.tread/, /stairs\.riser/, /treadThickness/, /nosing/, /handrail\.place/, /handrail\.height/, /handrail\.profile/, /handrail\.finish/, /balustrade\.type/, /balustrade\.height/, /balustrade\.finish/]) expect(e).toMatch(re);
      expect(stairsErrors('wood')).toHaveLength(1);
      // variant field: the same rules in the project document validation
      expect(variantExtrasErrors({ stairs: STAIRS_PRESETS[1].config } as unknown as Variant)).toEqual([]);
      expect(variantExtrasErrors({ stairs: { tread: 'mahogany' } } as unknown as Variant).join()).toMatch(/stairs\.tread/);
      expect(finishLook('#abcdef').color).toBe('#abcdef'); expect(finishLook('#abcdef').name).toBe('colour #abcdef');
      expect(finishLook('walnut').name).toBe(STAIR_FINISHES.walnut.name);
      expect(STAIRS_PRESETS.map((p) => p.name)).toContain('Concrete — as built');
    });
    it('structure description on the stairs card comes from the project stair data: number and size of steps, landing level', () => {
      expect(stairFacts(S)).toBe('Reinforced concrete structure: 2 flights × 9 steps (16.4 × 27 cm), landing +1.475 — this is building data');
      // other stairs — other numbers (centimetres without trailing zeros, level with 2–3 decimals)
      expect(stairFacts({ ...S, risers: 8, riser: 0.18, tread: 0.27, landingZ: 1.44 })).toBe('Reinforced concrete structure: 2 flights × 8 steps (18 × 27 cm), landing +1.44 — this is building data');
    });
  });

  describe('stair geometry by configuration', () => {
    const topStep = () => S.landingZ + S.riser * (S.risers - 1);
    it('as built: concrete only — steps and landing within the stair outline, top step just below the upper floor', () => {
      const [x0, y0, x1, y1] = S.bbox;
      const g = buildStairs(DEFAULT_STAIRS);
      expect(Object.keys(g)).toEqual(['concrete']);
      const b = bb(g.concrete!);
      expect(b.x[0]).toBeCloseTo(x0, 6); expect(b.x[1]).toBeCloseTo(x1, 6); expect(b.y[0]).toBeCloseTo(y0, 6); expect(b.y[1]).toBeCloseTo(y1, 6);
      expect(b.z[0]).toBeCloseTo(0, 6); expect(b.z[1]).toBeCloseTo(topStep(), 6);
      expect(topStep()).toBeCloseTo(S.topZ - S.riser, 2);
    });
    it('cladding: treads at the height of the concrete steps (concrete lower by the cladding thickness), nosing towards the flight entry', () => {
      const y1 = S.bbox[3];
      const c: StairsConfig = { ...STAIRS_PRESETS[1].config };
      const g = buildStairs(c), t = bb(g.tread!), k = bb(g.concrete!);
      expect(t.z[1]).toBeCloseTo(topStep(), 6);                            // top surface of the highest tread
      expect(k.z[1]).toBeCloseTo(topStep() - c.treadThickness, 6);
      expect(t.y[1]).toBeCloseTo(y1 + c.nosing, 6);                        // nosing of the first step of the lower flight
      expect(g.riser).toBeTruthy(); expect(bb(g.riser!).z[1]).toBeCloseTo(S.topZ, 6); // last riser up to the upper floor
      expect(buildStairs({ ...c, riser: 'none' }).riser).toBeUndefined();
    });
    it('handrail: above the nosing line at the given height; outer — along the outer side of both flights, inner — at the partition', () => {
      const [x0, , x1, y1] = S.bbox;
      const L = stairLayout();
      expect(L.nose1(y1)).toBeCloseTo(S.riser, 6); expect(L.nose1(L.le)).toBeCloseTo(S.landingZ, 2);
      expect(L.nose2(L.le)).toBeCloseTo(S.landingZ + S.riser, 6); expect(L.nose2(y1)).toBeCloseTo(S.topZ, 2);
      const outer = bb(buildStairs({ ...DEFAULT_STAIRS, handrail: { place: 'outer', height: 0.9, profile: 'round', finish: 'oak' } }).rail!);
      expect(outer.x[0]).toBeLessThan(x0 + 0.12); expect(outer.x[1]).toBeGreaterThan(x1 - 0.12);
      expect(outer.z[1]).toBeCloseTo(S.topZ + 0.9, 1);
      const inner = bb(buildStairs({ ...DEFAULT_STAIRS, handrail: { place: 'inner', height: 1.0, profile: 'rect', finish: 'black' } }).rail!);
      expect(inner.x[0]).toBeGreaterThan(S.split - 0.2); expect(inner.x[1]).toBeLessThan(S.split + 0.2);
      expect(buildStairs(DEFAULT_STAIRS).rail).toBeUndefined();
    });
    it('balustrade: glass → separate glass mesh + handrail; bars and solid → one mesh; guard rail at the opening on the upper floor', () => {
      const glass = buildStairs({ ...DEFAULT_STAIRS, balustrade: { type: 'glass', height: 1.0, finish: 'steel' } });
      expect(glass.glass).toBeTruthy(); expect(glass.balustrade).toBeTruthy();
      expect(bb(glass.glass!).z[1]).toBeCloseTo(S.topZ + 1.0, 6);
      const bars = buildStairs({ ...DEFAULT_STAIRS, balustrade: { type: 'bars', height: 0.9, finish: 'black' } });
      expect(bars.glass).toBeUndefined(); expect(bb(bars.balustrade!).z[1]).toBeGreaterThan(S.topZ + 0.88);
      const solid = buildStairs({ ...DEFAULT_STAIRS, balustrade: { type: 'solid', height: 1.2, finish: 'white' } });
      expect(bb(solid.balustrade!).x[0]).toBeGreaterThanOrEqual(S.split - 0.2);
      // every configuration: at most 6 meshes (draw calls) and no NaN values
      for (const p of STAIRS_PRESETS) {
        const g = buildStairs(p.config);
        expect(Object.keys(g).length).toBeLessThanOrEqual(6);
        for (const m of Object.values(g)) expect(Array.from(m!.getAttribute('position').array as Float32Array).every(Number.isFinite)).toBe(true);
      }
    });
  });

  describe('room walk → building walk (stairs)', () => {
    it('hand-over zone: 25 cm in front of the stair outline on every level', () => {
      const y1 = S.bbox[3];
      expect(stairArrivesAt('L1')).toBe(true); expect(stairArrivesAt('L0')).toBe(false);
      expect(inStairBox([1.8, y1 + 0.2], 0.25)).toBe(true);
      expect(inStairBox([1.8, y1 + 0.3], 0.25)).toBe(false);
      expect(inStairBox([5.0, 2.0], 0.25)).toBe(false);
    });
  });
});
