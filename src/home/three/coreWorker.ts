// Module worker of the generated shell (ADR 0026): loads the solid kernel (manifold-3d WASM, a bundled asset) on the first
// request, builds the level and roof solids of a package's building block with the core and sends back three.js arrays — the
// buffers are transferred, not copied. The main thread never loads the kernel (three/coreShell.ts).
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { building, type BuildingData } from '@home-sim/core/model/building';
import { shellMeshes } from '@home-sim/core/solid/levels';
import { loadGeometry } from '@home-sim/core/solid/wasm';
import { levelArrays, levelBuffers, type LevelArrays } from './coreMesh';

export interface CoreRequest { id: number; data: BuildingData }
export type CoreReply =
  | { id: number; ok: true; levels: LevelArrays[]; roofs: LevelArrays[]; triangles: number; ms: number; loadMs: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<CoreRequest>) => void) | null; postMessage: (m: CoreReply, transfer?: ArrayBuffer[]) => void };
let loadMs = 0;

ctx.onmessage = async ({ data: { id, data } }) => {
  try {
    const t0 = performance.now();
    const geo = await loadGeometry({ locateFile: () => new URL(wasmUrl, self.location.href).href });
    if (!loadMs) loadMs = performance.now() - t0;
    const t1 = performance.now(), shell = shellMeshes(geo, building(data)), levels = shell.levels.map(levelArrays), roofs = shell.roofs.map(levelArrays);
    ctx.postMessage({ id, ok: true, levels, roofs, triangles: shell.triangles, ms: performance.now() - t1, loadMs }, [...levels, ...roofs].flatMap(levelBuffers));
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: String((e as Error)?.message ?? e) });
  }
};
