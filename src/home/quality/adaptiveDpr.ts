// Simple adaptation of the 3D canvas pixel density (docs/ANDROID_REAL_DEVICE_RESULTS.md §K).
// Rule: DPR first, never the profile — the user's choice (High / Balanced / Low) takes precedence, the adaptation moves only
// within the active profile's DPR range [min, max]. Measured only during activity (intervals between rendered frames; a gap
// longer than idleGapMs = idle — closes the window without a decision), so a scene at rest is not adapted.
//  • down: frame interval p95 > downP95Ms in `downWindows` consecutive measurement windows → DPR −step, then `cooldownMs` unchanged,
//  • up: p95 ≤ upP95Ms continuously for `upMs` of activity → DPR +step, unless that level failed within the last `retryMs`
//    (hysteresis: a level that had to be left is blocked for `retryMs`).
// Pure logic without React or three.js (tests: src/home/tests/quality.test.ts); used by HomeCanvas → AdaptiveDpr.

export interface AdaptiveDprOptions {
  min: number; max: number; step?: number;
  /** step-down threshold: frame interval p95 [ms] — default 20 (60 fps cannot be sustained); at 120 Hz frames of 8.3 and 16.7 ms are normal */
  downP95Ms?: number;
  /** step-up threshold: p95 [ms] — default 17.5 (stable 60 fps) */
  upP95Ms?: number;
  windowMs?: number; minFrames?: number; downWindows?: number; upMs?: number; cooldownMs?: number; retryMs?: number; idleGapMs?: number;
}
export interface AdaptiveDpr {
  /** called after every rendered frame; returns the new DPR when it should change, otherwise null */
  frame(now: number): number | null;
  readonly dpr: number;
  info(): { dpr: number; min: number; max: number; downs: number; ups: number; lastP95: number | null };
}

export function createAdaptiveDpr(o: AdaptiveDprOptions): AdaptiveDpr {
  const step = o.step ?? 0.25, down = o.downP95Ms ?? 20, up = o.upP95Ms ?? 17.5, windowMs = o.windowMs ?? 2000, minFrames = o.minFrames ?? 40;
  const downWindows = o.downWindows ?? 2, upMs = o.upMs ?? 20000, cooldownMs = o.cooldownMs ?? 5000, retryMs = o.retryMs ?? 120000, idleGap = o.idleGapMs ?? 250;
  const min = Math.min(o.min, o.max), max = o.max;
  let dpr = max, last = -1, samples: number[] = [], active = 0, bad = 0, good = 0, cooldownUntil = 0, downs = 0, ups = 0, lastP95: number | null = null;
  const blocked = new Map<number, number>();
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    get dpr() { return dpr; },
    info: () => ({ dpr, min, max, downs, ups, lastP95 }),
    frame(now) {
      if (max - min < 1e-6) return null;                              // fixed DPR (e.g. ?dpr= or a device with DPR ≤ min)
      if (last >= 0) {
        const dt = now - last;
        if (dt <= idleGap) { samples.push(dt); active += dt; } else { samples = []; active = 0; bad = 0; good = 0; }
      }
      last = now;
      if (active < windowMs || samples.length < minFrames) return null;
      const v = samples.sort((a, b) => a - b), p95 = v[Math.min(v.length - 1, Math.floor(v.length * 0.95))], span = active;
      samples = []; active = 0; lastP95 = round(p95);
      if (now < cooldownUntil) return null;
      if (p95 > down) {
        good = 0;
        if (++bad >= downWindows && dpr > min + 1e-6) {
          blocked.set(dpr, now + retryMs);
          dpr = round(Math.max(min, dpr - step)); bad = 0; downs++; cooldownUntil = now + cooldownMs;
          return dpr;
        }
        return null;
      }
      bad = 0;
      if (p95 > up) { good = 0; return null; }
      good += span;
      if (good < upMs || dpr >= max - 1e-6) return null;
      const next = round(Math.min(max, dpr + step));
      good = 0;
      if ((blocked.get(next) ?? 0) > now) return null;
      dpr = next; ups++; cooldownUntil = now + cooldownMs;
      return dpr;
    },
  };
}

/** on-device diagnostics: ?adaptDown=<ms> — step-down threshold (e.g. 5 forces repeated DPR step-downs); ?adapt=off — adaptation disabled */
export const adaptiveDebug: { off: boolean; downP95Ms?: number } = (() => {
  if (typeof window === 'undefined') return { off: false };
  const q = new URLSearchParams(window.location.search), d = Number(q.get('adaptDown'));
  return { off: q.get('adapt') === 'off', ...(d > 0 ? { downP95Ms: d } : {}) };
})();

/** active controller — diagnostics (__home3d.visual().adaptive reads the current state via info()) */
export const adaptiveInfo: { current: AdaptiveDpr | null } = { current: null };
