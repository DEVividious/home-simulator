// Generated shell from the core's solids (ADR 0024, 0026) — the main-thread side: one module worker (three/coreWorker.ts) builds
// the solids of a building block; its arrays arrive transferred, with the wall mass in plan of every level (model/shell.ts).
// Results are cached per building block. When the kernel cannot load or run, there is no shell: the scene shows the room
// finishes only and says why (scene/CoreShellLayer.tsx), the plan views draw the level footprints.
import type { BuildingData } from '@home-sim/core/model/building';
import { project } from '../../project/active';
import { hasGeneratedShell, setWallSections } from '../model/shell';
import { createStore } from '../store/createStore';
import type { LevelArrays } from './coreMesh';
import type { CoreReply, CoreRequest, PrintFile, PrintRequest } from './coreWorker';

export interface CoreShell { levels: LevelArrays[]; roofs: LevelArrays[]; triangles: number; ms: number; loadMs: number }

/** state of the generated shell for diagnostics and tests (__home3d.shell()): which shell is shown and what it cost */
export const shellStatus = createStore({
  kind: 'core' as 'core' | 'model', status: 'idle' as 'idle' | 'loading' | 'ready' | 'error', error: null as string | null,
  /** triangles of the level and roof solids; worker time of the solids and of loading the kernel; main-thread time of the geometries [ms] */
  triangles: 0, ms: 0, loadMs: 0, mainMs: 0,
  /** roof solids (one per level with roof parts) */
  roofs: 0,
  /** diagnostics: raising it rebuilds the shell from a copy of the building block (the whole path — worker, transfer, geometry) */
  rebuilds: 0,
});

/** a build that does not answer in this time counts as failed */
const TIMEOUT = 30000;
let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { resolve: (r: CoreReply & { ok: true }) => void; reject: (e: Error) => void }>();
const cache = new WeakMap<BuildingData, Promise<CoreShell>>();

function failAll(e: Error) {
  for (const p of pending.values()) p.reject(e);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./coreWorker.ts', import.meta.url), { type: 'module', name: 'home-sim-core' });
  w.onmessage = ({ data: r }: MessageEvent<CoreReply>) => {
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.ok) p.resolve(r);
    else p.reject(new Error(r.error));
  };
  w.onerror = (e) => { e.preventDefault(); failAll(new Error(`shell worker: ${e.message || 'failed to start'}`)); };
  worker = w;
  return w;
}

/** the generated shell of a building block (built once per block) */
export function coreShell(data: BuildingData): Promise<CoreShell> {
  let p = cache.get(data);
  if (p) return p;
  p = new Promise<CoreShell>((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { if (pending.delete(id)) reject(new Error('shell worker: no answer')); }, TIMEOUT);
    pending.set(id, { resolve: (r) => { clearTimeout(timer); if (r.kind !== 'print') { setWallSections(data, r.sections); resolve({ levels: r.levels, roofs: r.roofs, triangles: r.triangles, ms: r.ms, loadMs: r.loadMs }); } }, reject: (e) => { clearTimeout(timer); reject(e); } });
    try { getWorker().postMessage({ id, data } satisfies CoreRequest); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e as Error); }
  });
  cache.set(data, p);
  p.catch(() => cache.delete(data));
  return p;
}

/** the wall mass in plan of the active project: built with its shell (once per building block); resolves also when the kernel
 *  fails — the plan views then draw the level footprints */
export const wallSectionsReady = (): Promise<void> => (hasGeneratedShell() ? coreShell(project().building).then(() => {}, () => {}) : Promise.resolve());

/** the printable scale model of a building block, made in the worker (ADR 0044): its files and whether every part printed */
export function corePrint(data: BuildingData, print: PrintRequest): Promise<{ printable: boolean; scale: string | null; files: PrintFile[]; problems: string[] }> {
  return new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { if (pending.delete(id)) reject(new Error('print worker: no answer')); }, 4 * TIMEOUT);
    pending.set(id, { resolve: (r) => { clearTimeout(timer); if (r.kind === 'print') resolve(r); else reject(new Error('print worker: wrong answer')); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    try { getWorker().postMessage({ id, kind: 'print', data, print } satisfies CoreRequest); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e as Error); }
  });
}
