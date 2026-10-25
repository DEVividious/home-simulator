// Minimal state store with selector subscriptions (useSyncExternalStore) — no dependencies. A component re-renders only when
// the selected part of the state changes (Object.is comparison). The 3D scene subscribes narrowly (e.g. one furniture item).
import { useSyncExternalStore } from 'react';

export interface Store<S> {
  get: () => S;
  set: (patch: Partial<S> | ((s: S) => Partial<S>)) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      const p = typeof patch === 'function' ? patch(state) : patch;
      if (!p || Object.keys(p).every((k) => Object.is((state as Record<string, unknown>)[k], (p as Record<string, unknown>)[k]))) return;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** selects a part of the state; the selector must return stable references (parts of the state, not new objects) */
export function useStore<S, T>(store: Store<S>, selector: (s: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
