// Stair orientation (StairDef.orient): the canonical U-turn layout turned by multiples of 90° and mirrored onto the plan —
// the walking ramp, the parts, the walls and the geometry follow the turned outline. Base: the sample house stairs S1.
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { readProjectDir } from '../../project/node';
import { stairAllowed, stairFrame, stairPart, stairSteps, stairZ, type StairOrient } from '../model/stairs';
import type { UTurnStairDef } from '@home-sim/core/package/types';
import type { Vec2 } from '../model/types';
import { DEFAULT_STAIRS } from '../model/stairsConfig';
import { buildStairs } from '../three/stairGeometry';

const S0 = readProjectDir(path.resolve(__dirname, '..', '..', '..', 'projects', 'sample-house')).building.stairs![0] as UTurnStairDef;
const bb = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return [b.min.x, -b.max.z, b.max.x, -b.min.z]; };

/** the sample stairs turned / mirrored in place: the plan outline keeps its corner, its sides swap for 90° and 270° */
function oriented(o: StairOrient): UTurnStairDef {
  const [x0, y0, x1, y1] = S0.bbox, swap = o.rotate % 180 !== 0;
  return { ...S0, bbox: swap ? [x0, y0, x0 + (y1 - y0), y0 + (x1 - x0)] : S0.bbox, orient: o };
}
const ORIENTS: StairOrient[] = [0, 90, 180, 270].flatMap((rotate) => [false, true].map((mirror) => ({ rotate, mirror }) as StairOrient));
// canonical sample points: lower-flight entry, middle of each flight, landing
const Q: Vec2[] = [[1.8, 3.4], [1.8, 2.5], [0.8, 2.5], [1.0, 1.0], [0.8, 3.4]];

describe('stair orientation', () => {
  for (const o of ORIENTS) {
    const S = oriented(o), f = stairFrame(S), name = `rotate ${o.rotate}${o.mirror ? ' mirrored' : ''}`;
    it(`${name}: the plan maps back to the canonical frame; ramp and parts follow it`, () => {
      for (const q of Q) {
        const p = f.toWorld(q);
        expect(f.toLocal(p)[0]).toBeCloseTo(q[0], 9);
        expect(f.toLocal(p)[1]).toBeCloseTo(q[1], 9);
        expect(p[0]).toBeGreaterThanOrEqual(S.bbox[0] - 1e-9); expect(p[0]).toBeLessThanOrEqual(S.bbox[2] + 1e-9);
        expect(p[1]).toBeGreaterThanOrEqual(S.bbox[1] - 1e-9); expect(p[1]).toBeLessThanOrEqual(S.bbox[3] + 1e-9);
        expect(stairZ(p, S)).toBeCloseTo(stairZ(q, S0), 9);
        expect(stairPart(p, S)).toBe(stairPart(q, S0));
        expect(stairAllowed(p, 0.22, S)).toBe(stairAllowed(q, 0.22, S0));
      }
    });
    it(`${name}: schematic steps and the 3D stairs lie in the plan outline`, () => {
      for (const [x0, y0, x1, y1] of stairSteps(S)) expect(x0 >= S.bbox[0] - 1e-9 && y0 >= S.bbox[1] - 1e-9 && x1 <= S.bbox[2] + 1e-9 && y1 <= S.bbox[3] + 1e-9).toBe(true);
      const g = buildStairs(DEFAULT_STAIRS, S).concrete!, b = bb(g);
      for (let i = 0; i < 4; i++) expect(b[i]).toBeCloseTo(S.bbox[i], 2);
    });
  }
  it('up east: one starts at the smaller-X side walking +X on the north side and turns right; mirrored: south side, turns left', () => {
    const E = oriented({ rotate: 90, mirror: false }), [x0, y0, x1, y1] = E.bbox;
    expect(stairZ([x0 + 0.05, y1 - 0.3], E)).toBeCloseTo(0, 1);
    expect(stairZ([x1 - 0.2, y1 - 0.3], E)).toBe(E.landingZ);
    expect(stairZ([x0 + 0.05, y0 + 0.3], E)).toBeCloseTo(E.topZ, 1);
    const L = oriented({ rotate: 90, mirror: true });
    expect(stairZ([x0 + 0.05, y0 + 0.3], L)).toBeCloseTo(0, 1);
    expect(stairPart([x0 + 1.2, y0 + 0.3], L)).toBe('flight1');
    expect(stairZ([x0 + 0.05, y1 - 0.3], L)).toBeCloseTo(L.topZ, 1);
  });
  it('a mirrored stair keeps its faces outwards (normals point away from the box centre on the sides)', () => {
    const S = oriented({ rotate: 0, mirror: true }), g = buildStairs(DEFAULT_STAIRS, S).concrete!.toNonIndexed();
    const pos = g.getAttribute('position'), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const nor = g.getAttribute('normal');
    let agree = 0, total = 0;
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
      const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      n.fromBufferAttribute(nor, t);
      total++; if (face.dot(n) > 0.9) agree++;
    }
    expect(agree).toBe(total);
  });
});
