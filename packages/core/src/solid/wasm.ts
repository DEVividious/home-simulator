// The solid kernel: manifold-3d (WASM), loaded once per process (ADR 0024, 0026). This is the only module that imports the
// kernel at run time — everything else in solid/ receives the loaded module as an argument, so plain geometry (bounds,
// openings, frames) can be used without loading WASM. Node finds the binary next to the package by itself; a browser worker
// passes `locateFile` (the URL of the bundled asset); the plugin may pass the bytes (`wasmBinary`).
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

export type Geometry = ManifoldToplevel;
export type { CrossSection, Manifold } from 'manifold-3d';

export interface LoadOptions {
  /** the WASM bytes (no fetch, no file access) */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** URL or path of a file the kernel asks for (`manifold.wasm`) */
  locateFile?: (file: string) => string;
  /** custom instantiation (tests reach the WASM memory this way); such a kernel is never shared */
  instantiateWasm?: (imports: unknown, done: (instance: unknown, module?: unknown) => void) => unknown;
}

let shared: Promise<Geometry> | null = null;

/** the solid kernel, initialised; one shared instance unless a custom instantiation is asked for */
export function loadGeometry(o: LoadOptions = {}): Promise<Geometry> {
  const make = () => (Module as unknown as (cfg: LoadOptions) => Promise<Geometry>)({ ...o }).then((m) => { m.setup(); return m; });
  if (o.instantiateWasm) return make();
  if (!shared) shared = make().catch((e: unknown) => { shared = null; throw e; });
  return shared;
}
