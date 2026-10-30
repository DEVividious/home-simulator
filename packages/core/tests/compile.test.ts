// The compiler without a furniture catalog (catalog: null) — what tools that need only the building (print export, plugin) use.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePlan, type CatalogItemInfo } from '@home-sim/core/authoring/compile';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const catalog = (read('data/furnitureCatalog.json') as { items: CatalogItemInfo[] }).items;

describe('compilePlan with catalog: null', () => {
  for (const id of ['demo-apartment', 'sample-house']) {
    it(`${id}: the building is the same as with the catalog`, () => {
      const plan = read(`projects/${id}/source/plan.json`);
      const withCat = compilePlan(plan, { catalog }), without = compilePlan(plan, { catalog: null });
      expect(without.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(without.project!.building).toEqual(withCat.project!.building);
      expect(without.project!.interiors.items.map((i) => i.key)).toEqual(withCat.project!.interiors.items.map((i) => i.key));
    });
  }

  it('does not reject unknown catalog items or variants', () => {
    const plan = {
      schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test',
      project: { id: 'test-flat', name: 'Test flat', buildingType: 'apartment' },
      levels: [{ id: 'L1', name: 'Flat', floorZ: 0, ceiling: 2.6 }],
      rooms: [{ id: 'R1', name: 'Living', level: 'L1', kind: 'living', rect: [0.3, 0.3, 4.3, 3.3] }],
      furniture: [{ room: 'R1', catalogId: 'not-in-any-catalog', variant: 'x', at: [2, 2] }],
    };
    expect(compilePlan(plan, { catalog }).issues.map((i) => i.code)).toContain('furniture.catalog');
    const r = compilePlan(plan, { catalog: null });
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.project!.interiors.items[0].catalogId).toBe('not-in-any-catalog');
  });
});
