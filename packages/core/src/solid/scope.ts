// WASM objects (Manifold, CrossSection) are not garbage-collected: every one made during a build is registered in a scope and
// deleted when the scope ends, so the kernel heap stays flat over any number of rebuilds (ADR 0026). Only plain data (typed
// arrays, numbers, polygons) leaves a scope.

export interface Deletable { delete(): void }
/** registers a WASM object for deletion at the end of the scope (once, however often it is passed) and returns it */
export type Keep = <T extends Deletable>(x: T) => T;

let live = 0;
/** WASM objects registered in scopes that have not ended yet (0 between builds) */
export const liveObjects = (): number => live;

/** runs `fn` with a scope; every object passed to `keep` is deleted afterwards, also when `fn` throws */
export function scoped<T>(fn: (keep: Keep) => T): T {
  const owned = new Set<Deletable>();
  const keep: Keep = (x) => { if (!owned.has(x)) { owned.add(x); live++; } return x; };
  try {
    return fn(keep);
  } finally {
    for (const x of owned) x.delete();
    live -= owned.size;
  }
}
