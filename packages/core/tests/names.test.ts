// Names in several languages (usability issue A3): plan.json `names` reach project.json, the compiler warns when a language is
// only partly translated, and localizePackage shows the package in one language without touching anything else.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { inLang, localizePackage } from '@home-sim/core/package/names';
import { ProjectSchema } from '@home-sim/core/package/schema';
import type { ProjectPackage } from '@home-sim/core/package/types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const plan = (extra: object = {}) => ({
  schema: 'home-simulator/plan', version: 1, units: 'm', source: 'test',
  project: { id: 'test-flat', name: 'Mieszkanie testowe', names: { en: 'Test flat' }, language: 'pl', buildingType: 'apartment' },
  levels: [{ id: 'L1', name: 'Mieszkanie', names: { en: 'Flat' }, floorZ: 0, ceiling: 2.6 }],
  rooms: [
    { id: 'R1', name: 'Salon', names: { en: 'Living room' }, level: 'L1', kind: 'living', rect: [0.3, 0.3, 4.3, 3.3] },
    { id: 'R2', name: 'Kuchnia', names: { en: 'Kitchen' }, level: 'L1', kind: 'kitchen', rect: [4.42, 0.3, 7.3, 3.3] },
  ],
  viewpoints: [{ id: 'vp', name: 'Okno', names: { en: 'Window' }, level: 'L1', at: [2, 1], look: [2, 3, 1.4], hint: 'od okna', hints: { en: 'from the window' } }],
  ...extra,
});

describe('names in several languages', () => {
  it('plan.json names reach project.json: project, levels, rooms, viewpoints (names and hints)', () => {
    const r = compilePlan(plan(), { catalog: null }), p = r.project!;
    expect(r.issues.filter((i) => i.code.startsWith('names.'))).toEqual([]);
    expect(p.manifest.names).toEqual({ en: 'Test flat' });
    expect(p.manifest.levels[0].names).toEqual({ en: 'Flat' });
    expect(p.building.rooms.rooms.map((x) => x.names?.en)).toEqual(['Living room', 'Kitchen']);
    expect(p.viewpoints![0]).toMatchObject({ names: { en: 'Window' }, hints: { en: 'from the window' } });
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });
  it('the compiler warns about a language only partly translated, and about names in the plan\'s own language', () => {
    const p = plan();
    delete (p.rooms[1] as { names?: object }).names;
    expect(compilePlan(p, { catalog: null }).issues.find((i) => i.code === 'names.missing')?.message).toMatch(/"en".*room "R2"/);
    const q = plan({ project: { id: 'test-flat', name: 'Mieszkanie testowe', names: { pl: 'Mieszkanie' }, language: 'pl', buildingType: 'apartment' } });
    expect(compilePlan(q, { catalog: null }).issues.map((i) => i.code)).toContain('names.language');
  });
  it('a bad language code is rejected', () => {
    const p = plan(); (p.rooms[0] as { names: object }).names = { English: 'Living room' };
    expect(compilePlan(p, { catalog: null }).issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('localizePackage: every name a person reads in the language, ids and geometry untouched', () => {
    const p = compilePlan(plan(), { catalog: null }).project! as ProjectPackage, en = localizePackage(p, 'en');
    expect(en.manifest.name).toBe('Test flat');
    expect(en.manifest.levels[0].name).toBe('Flat');
    expect(en.building.rooms.levels.L1.name).toBe('Flat');
    expect(en.building.rooms.rooms.map((r) => [r.id, r.name, r.label])).toEqual([['R1', 'Living room', 'Living room'], ['R2', 'Kitchen', 'Kitchen']]);
    expect(en.viewpoints![0]).toMatchObject({ id: 'vp', name: 'Window', hint: 'from the window' });
    expect(en.building.rooms.rooms[0].polygon).toBe(p.building.rooms.rooms[0].polygon);
    expect(localizePackage(p, 'pl')).toBe(p);                               // the package's own language: the same object
    expect(localizePackage(p, 'de')).toBe(p);                               // no names in that language
    expect(inLang('Salon', undefined, 'en')).toBe('Salon');
  });
  it('the examples carry Polish names for everything a person reads', () => {
    for (const id of ['sample-house', 'demo-apartment']) {
      const p = read(`projects/${id}/project.json`) as ProjectPackage;
      const all = [p.manifest.names, ...p.manifest.levels.map((l) => l.names), ...p.building.rooms.rooms.map((r) => r.names), ...(p.viewpoints ?? []).flatMap((v) => [v.names, v.hints])];
      expect(all.every((n) => !!n?.pl)).toBe(true);
    }
  });
});
