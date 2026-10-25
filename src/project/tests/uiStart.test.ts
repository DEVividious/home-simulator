// Initial UI state (store/ui.ts) per project, URL and device memory.
//   • Device preferences are shared by projects, but surroundings and the sun belong to project modules. A project without the
//     module neither reads them from the device or the URL ("surroundings off", default light) nor saves them: they stay as
//     a project that has the module set them.
//   • Deep links (?section=…&room=…) — only a section the project has and a room it knows; the start level and view follow the
//     room or the project's default view.
// The store computes its initial state on import, so every case loads it again — with the project, URL and device memory
// substituted before the import.
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readProjectDir } from '../node';
import type { ProjectPackage } from '../types';

const root = path.resolve(__dirname, '..', '..', '..');
const demo = readProjectDir(path.join(root, 'projects', 'demo-apartment'));
const house = readProjectDir(path.join(root, 'projects', 'sample-house'));
/** the sample house with a surroundings model as well (module environment) — every module that has a UI preference */
const houseWithSurroundings: ProjectPackage = { ...house, manifest: { ...house.manifest, modules: [...house.manifest.modules, 'environment'] }, assets: { ...house.assets, environment: 'model/surroundings.glb' } };

const LS = 'home-simulator.ui.v1';
/** preferences saved in a project with every module: surroundings on, sun panel expanded, expert mode */
const ALL_PREFS = { environment: true, sunPanel: true, mode: 'expert', eyeHeight: 1.5 };

async function boot(pkg: ProjectPackage, search: string, stored: Record<string, unknown> | null) {
  vi.resetModules();
  const mem = new Map<string, string>(stored ? [[LS, JSON.stringify(stored)]] : []), replaced: string[] = [];
  vi.stubGlobal('window', {
    location: { search, href: `http://localhost/${search}` }, history: { replaceState: (_s: unknown, _t: string, u: URL | string) => { replaced.push(String(u)); } },
    localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } },
  });
  (await import('../active')).activateProject(pkg);
  const { ui, todayIso } = await import('../../home/store/ui');
  return { ui, today: todayIso(), replaced, prefs: () => JSON.parse(mem.get(LS) ?? '{}') as Record<string, unknown> };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('surroundings and sun: initial state and saved preferences follow the project modules', () => {
  it('project with the environment and sun modules: device preferences and the URL apply, changes are saved', async () => {
    const a = await boot(houseWithSurroundings, '?date=2026-12-21&time=23:30', ALL_PREFS);
    expect(a.ui.get()).toMatchObject({ environment: true, sunPanel: true, sun: { date: '2026-12-21', minutes: 1410 }, mode: 'expert', eyeHeight: 1.5 });
    a.ui.set({ environment: false, sunPanel: false });
    expect(a.prefs()).toMatchObject({ environment: false, sunPanel: false, mode: 'expert' });
    const b = await boot(houseWithSurroundings, '?env=off&sun=open', { environment: true, sunPanel: false });
    expect(b.ui.get()).toMatchObject({ environment: false, sunPanel: true, sun: { date: b.today, minutes: 840 } });
  });

  it('sample house (sun, no surroundings model): the sun follows the URL, surroundings are off and their preference is kept', async () => {
    const a = await boot(house, '?date=2026-06-21&time=08:15&sun=open', ALL_PREFS);
    expect(a.ui.get()).toMatchObject({ environment: false, sunPanel: true, sun: { date: '2026-06-21', minutes: 495 } });
    a.ui.set({ sunPanel: false, environment: false });
    expect(a.prefs()).toMatchObject({ environment: true, sunPanel: false });
  });

  it('demo apartment (no modules): surroundings off, default light and the sun panel closed — whatever the preferences and URL say', async () => {
    const a = await boot(demo, '?date=2026-12-21&time=23:30&sun=open', ALL_PREFS);
    expect(a.ui.get()).toMatchObject({ environment: false, sunPanel: false, sun: { date: a.today, minutes: 840 } });
    // preferences that do not belong to a module work as usual
    expect(a.ui.get()).toMatchObject({ mode: 'expert', eyeHeight: 1.5 });
  });

  it('the apartment does not save preferences of modules it lacks: the values from the other project stay (also when the state is forced)', async () => {
    const a = await boot(demo, '', ALL_PREFS);
    a.ui.set({ mode: 'home', eyeHeight: 1.8 });
    expect(a.prefs()).toMatchObject({ environment: true, sunPanel: true, mode: 'home', eyeHeight: 1.8 });
    a.ui.set({ environment: true, sunPanel: true }); a.ui.set({ environment: false, sunPanel: false });
    expect(a.prefs()).toMatchObject({ environment: true, sunPanel: true });
    // a device without these preferences (first start in the apartment): the apartment does not create them
    const b = await boot(demo, '', null);
    b.ui.set({ mode: 'expert' });
    expect(b.prefs()).toMatchObject({ mode: 'expert' });
    expect(b.prefs()).not.toHaveProperty('environment'); expect(b.prefs()).not.toHaveProperty('sunPanel');
  });
});

describe('start view: the project default view and deep links', () => {
  it('without a link: the level and view from the project manifest', async () => {
    expect((await boot(demo, '', null)).ui.get()).toMatchObject({ section: 'building', level: 'L1', roomId: null, houseView: 'interior' });
    expect((await boot(house, '', null)).ui.get()).toMatchObject({ section: 'building', level: 'L0', roomId: null, houseView: 'exterior' });
  });

  it('?section=…&room=…: a known room opens on its level; the parameters are removed from the URL', async () => {
    const a = await boot(house, '?section=interiors&room=BR1', null);
    expect(a.ui.get()).toMatchObject({ section: 'interiors', roomId: 'BR1', level: 'L1', houseView: 'interior' });
    expect(a.replaced).toEqual(['http://localhost/']);
    expect((await boot(demo, '?room=R3', null)).ui.get()).toMatchObject({ roomId: 'R3', level: 'L1', houseView: 'interior' });
  });

  it('a room or section the project does not have: no room, the first section', async () => {
    expect((await boot(demo, '?section=interiors&room=BR1', null)).ui.get()).toMatchObject({ section: 'interiors', roomId: null, level: 'L1' });
    expect((await boot(demo, '?section=garden', null)).ui.get().section).toBe('building');
    const limited: ProjectPackage = { ...demo, manifest: { ...demo.manifest, capabilities: ['interiors'] } };
    expect((await boot(limited, '?section=electrical', null)).ui.get().section).toBe('building');
    expect((await boot(limited, '?section=furniture', null)).ui.get().section).toBe('furniture');
  });

  it('?mode=expert and ?onboarding=off override the saved preferences', async () => {
    const a = await boot(demo, '?mode=expert&onboarding=off', { mode: 'home', onboardingDone: false });
    expect(a.ui.get()).toMatchObject({ mode: 'expert', onboardingDone: true, elTipsDone: true });
  });
});

describe('URL: Electrical mode view', () => {
  it('?elview=2d|3d chooses the view; otherwise the last one used; a walk is never resumed', async () => {
    expect((await boot(demo, '?elview=3d', null)).ui.get().elView).toBe('3d');
    expect((await boot(demo, '?elview=2d', { elView: '3d' })).ui.get().elView).toBe('2d');
    expect((await boot(demo, '', { elView: '3d' })).ui.get().elView).toBe('3d');
    expect((await boot(demo, '', null)).ui.get().elView).toBe('2d');
    const a = await boot(demo, '', null);
    a.ui.set({ elView: 'walk' });
    expect(a.prefs().elView).toBe('3d');
    expect((await boot(demo, '', { elView: 'walk' })).ui.get().elView).toBe('2d');
  });
});
