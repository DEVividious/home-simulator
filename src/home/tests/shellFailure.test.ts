// When the solid kernel cannot build the shell (no module workers, the WASM cannot load, a solid the kernel rejects, no answer):
// there is no fallback shell any more (ADR 0026) — the build is rejected with the cause and not cached (the next build tries
// again), the scene shows only the room finishes, the status carries the cause, a message in the user's language says so, and the electrical
// plan draws the level's footprint as the wall mass. When the solids arrive, the plan draws the section of each level solid.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { shellMeshes } from '@home-sim/core/solid/levels';
import { loadGeometry, type Geometry } from '@home-sim/core/solid/wasm';
import { outerOutline } from '@home-sim/core/model/outline';
import { project } from '../../project/active';
import { t } from '../../i18n';
import { building } from '../model/building';
import { EL_LAYER_IDS, resolvePlan } from '../model/electrical';
import { roomsOfLevel } from '../model/rooms';
import { setWallSections, shellSpec, wallSection, wallSectionsRev, type WallSections } from '../model/shell';
import { buildPlan, massPrims, type Prim } from '../plan/elPlan';
import { shellFailed } from '../scene/CoreShellLayer';
import { coreShell, shellStatus, wallSectionsReady } from '../three/coreShell';
import type { CoreReply, CoreRequest } from '../three/coreWorker';
import { ui } from '../store/ui';

const WALL = '#7d838c';
const drawing = (view: string) => buildPlan({ view, plan: resolvePlan(undefined, undefined), layers: EL_LAYER_IDS, den: 100 });
const wallPolys = (view: string) => drawing(view).prims
  .filter((p): p is Extract<Prim, { k: 'poly' }> => p.k === 'poly' && (p.fill === WALL || (p.fill === '#ffffff' && !p.stroke)));

/** a stand-in for the module worker: answers every request with `reply` */
let reply: (req: CoreRequest) => CoreReply;
class StubWorker {
  onmessage: ((e: MessageEvent<CoreReply>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(req: CoreRequest) { queueMicrotask(() => this.onmessage?.({ data: reply(req) } as MessageEvent<CoreReply>)); }
  terminate() {}
}

let geo: Geometry;
beforeAll(async () => { geo = await loadGeometry(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => ui.set({ toast: null }));

describe('the solid kernel cannot build the shell', () => {
  it('no module workers (an old browser): the build is rejected with the cause; the plan has no section and waits for nothing', async () => {
    expect(typeof Worker).toBe('undefined');
    const data = structuredClone(project().building);
    await expect(coreShell(data)).rejects.toThrow(/Worker/);
    expect(wallSection('L1')).toBeNull();
    await expect(wallSectionsReady()).resolves.toBeUndefined();
  });

  it('the kernel fails in the worker (the WASM cannot load, a solid it rejects): rejected with its message, not cached', async () => {
    vi.stubGlobal('Worker', StubWorker);
    reply = (r) => ({ id: r.id, ok: false, error: 'solid of level L1: NotManifold' });
    const data = structuredClone(project().building);
    const first = coreShell(data);
    await expect(first).rejects.toThrow('solid of level L1: NotManifold');
    // a failed build is forgotten: the next one asks the worker again
    reply = (r) => ({ id: r.id, ok: true, levels: [], roofs: [], sections: { L1: [] }, triangles: 0, ms: 1, loadMs: 1 });
    const second = coreShell(data);
    expect(second).not.toBe(first);
    await expect(second).resolves.toMatchObject({ triangles: 0 });
  });

  it('after a failure: the status carries the cause, a message says the walls cannot be built (in Polish too), a warning in the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    shellStatus.set({ kind: 'core', status: 'loading', error: null });
    shellFailed(new Error('WebAssembly.instantiate(): expected magic word'));
    expect(shellStatus.get()).toMatchObject({ kind: 'core', status: 'error', error: 'WebAssembly.instantiate(): expected magic word' });
    const msg = ui.get().toast!;
    expect(msg.level).toBe('error');
    expect(msg.text).toBe(t('scene.wallsFailed', { error: 'WebAssembly.instantiate(): expected magic word' }));
    expect(msg.text).toContain('expected magic word');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/solid kernel failed .*no shell/));
  });

  it('without the section the electrical plan draws the footprint of the level as the wall mass (the rooms white over it)', () => {
    expect(drawing('L1').walls).toBe('footprint');
    const polys = wallPolys('L1');
    expect(polys.filter((p) => p.fill === WALL)).toHaveLength(1);
    expect(polys[0].pts).toEqual(outerOutline(roomsOfLevel('L1').map((r) => r.polygon), shellSpec().exteriorWall));
  });
});

describe('the solids arrive', () => {
  it('the worker sends the section of every level with the solids; the plan draws exactly its loops, the larger first', async () => {
    const data = project().building, m = shellMeshes(geo, building()), sections: WallSections = Object.fromEntries(m.levels.map((l) => [l.level, l.section]));
    vi.stubGlobal('Worker', StubWorker);
    reply = (r) => ({ id: r.id, ok: true, levels: [], roofs: [], sections, triangles: m.triangles, ms: 1, loadMs: 1 });
    const rev = wallSectionsRev.get().n;
    await coreShell(data);
    expect(wallSectionsRev.get().n).toBe(rev + 1);
    expect(wallSection('L1')).toBe(sections.L1);
    await expect(wallSectionsReady()).resolves.toBeUndefined();
    const mass = massPrims(sections.L1);
    expect(mass.map((p) => (p as { fill: string }).fill)).toEqual([WALL, '#ffffff', '#ffffff', '#ffffff', '#ffffff']);   // the outline, the four rooms
    expect(drawing('L1').walls).toBe('section');
    const drawn = wallPolys('L1').slice(0, mass.length);
    expect(drawn).toEqual(mass);
  });

  it('a section set for another building block (an older one) is not used', () => {
    setWallSections(structuredClone(project().building), { L1: [] });
    expect(wallSection('L1')!.length).toBeGreaterThan(0);
  });
});
