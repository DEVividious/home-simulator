// On-demand rendering (R3F frameloop="demand"). A still scene renders no frames (continuous rendering produced 60 identical
// frames/s — 24% of the main thread on desktop, 85% on an emulated phone). A frame is rendered when:
//  • state changes (project, UI, dragging, photo matching, labels) — store subscriptions in RenderScheduler,
//  • the camera moves (controls 'change' event), a camera transition or an animation is running (wake() from useFrame),
//  • R3F detects a change itself (mounting objects, prop changes, canvas size),
//  • walk mode is active (continuous mode — setFrameloop('always')).
// After any activity: a short keep-alive (600 ms by default) and trailing frames after 250 ms / 0.7 s / 2.1 s — delayed
// updates (IBL after 220 ms, periodic shadow refresh every 2 s, material patches every 0.5 s) get their frame.
// Diagnostics: ?frameloop=always — continuous rendering (measuring the cost of a single frame in the benchmark).

let invalidateFn: (() => void) | null = null;
let aliveUntil = 0;
let trailing: number[] = [];
const frameListeners = new Set<() => void>();
let rendered = 0;

/** continuous rendering forced by the diagnostic parameter */
export const forceContinuous = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('frameloop') === 'always';

/** request frames for at least `ms` (animation, interaction, state change) + trailing frames */
export function wake(ms = 600) {
  const now = performance.now();
  aliveUntil = Math.max(aliveUntil, now + ms);
  invalidateFn?.();
  for (const t of trailing) clearTimeout(t);
  trailing = [250, 700, 2100].map((d) => window.setTimeout(() => invalidateFn?.(), ms + d));
}

/** whether the keep-alive is active (called in a frame: render another frame) */
export function aliveNow() { return performance.now() < aliveUntil; }

export function setInvalidate(fn: (() => void) | null) { invalidateFn = fn; }

/** callback after every rendered frame (camera-dependent DOM elements — e.g. the compass rose), instead of a separate rAF loop */
export function onSceneFrame(fn: () => void) { frameListeners.add(fn); return () => { frameListeners.delete(fn); }; }
export function emitSceneFrame() { rendered++; frameListeners.forEach((f) => f()); }

/** number of frames rendered since start (diagnostics: activity while idle) */
export const renderedFrames = () => rendered;
