// Generated shell from the core's solids (ADR 0024, 0026) — the main-thread side: one module worker (three/coreWorker.ts) builds
// the solids of a building block; its arrays arrive transferred. Results are cached per building block. `?shell=grid` forces the
// grid shell, which is also the fallback when the kernel fails (for one release).
import type { BuildingData } from '@home-sim/core/model/building';
import { createStore } from '../store/createStore';
import type { LevelArrays } from './coreMesh';
import type { CoreReply, CoreRequest } from './coreWorker';

export type ShellKind = 'core' | 'grid';
/** the shell the URL asks for: ?shell=grid — the grid shell */
export const requestedShell = (): ShellKind => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('shell') === 'grid' ? 'grid' : 'core');

export interface CoreShell { levels: LevelArrays[]; roofs: LevelArrays[]; triangles: number; ms: number; loadMs: number }

/** state of the generated shell for diagnostics and tests (__home3d.shell()): which shell is shown and what it cost */
export const shellStatus = createStore({
  kind: 'core' as ShellKind | 'model', status: 'idle' as 'idle' | 'loading' | 'ready' | 'error', error: null as string | null,
  /** triangles of the level and roof solids; worker time of the solids and of loading the kernel; main-thread time of the geometries [ms] */
  triangles: 0, ms: 0, loadMs: 0, mainMs: 0,
  /** roof solids (one per level with roof parts) */
  roofs: 0,
  /** diagnostics: raising it rebuilds the shell from a copy of the building block (the whole path — worker, transfer, geometry) */
  rebuilds: 0,
});

/** a build that does not answer in this time counts as failed (the grid shell is shown) */
const TIMEOUT = 30000;
let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { resolve: (s: CoreShell) => void; reject: (e: Error) => void }>();
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
    if (r.ok) p.resolve({ levels: r.levels, roofs: r.roofs, triangles: r.triangles, ms: r.ms, loadMs: r.loadMs });
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
    pending.set(id, { resolve: (s) => { clearTimeout(timer); resolve(s); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    try { getWorker().postMessage({ id, data } satisfies CoreRequest); } catch (e) { pending.delete(id); clearTimeout(timer); reject(e as Error); }
  });
  cache.set(data, p);
  p.catch(() => cache.delete(data));
  return p;
}
