// Quality profiles: profile choice (platform × tier), platform detection, consistency with the performance budgets:
// DPR, glass, shadows, textures, vegetation.
import { describe, expect, it } from 'vitest';
import { BATTERY_SAVER_FPS, classifyMobileGpu, defaultTier, describeGpu, detectPlatform, FLAGSHIP_DPR_MAX, forDevice, PROFILES, profileFor, profileWithSaver } from '../quality/profile';
import { createAdaptiveDpr } from '../quality/adaptiveDpr';
import { t } from '../../i18n';

describe('quality profiles', () => {
  it('five profiles; every platform × tier combination has a profile', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(['DESKTOP_BALANCED', 'DESKTOP_HIGH', 'MOBILE_BALANCED', 'MOBILE_HIGH', 'MOBILE_LOW']);
    expect(profileFor('desktop', 'high').id).toBe('DESKTOP_HIGH');
    expect(profileFor('desktop', 'medium').id).toBe('DESKTOP_BALANCED');
    expect(profileFor('mobile', 'high').id).toBe('MOBILE_HIGH');
    expect(profileFor('mobile', 'medium').id).toBe('MOBILE_BALANCED');
    expect(profileFor('desktop', 'low').id).toBe('MOBILE_LOW');
    expect(profileFor('mobile', 'low').id).toBe('MOBILE_LOW');
  });
  it('budgets: max DPR (integrated GPU: DPR 2 = 30 ms), transmissive glass only on desktop high, no post-processing', () => {
    expect(PROFILES.DESKTOP_HIGH.dpr[1]).toBe(2);
    expect(PROFILES.DESKTOP_BALANCED.dpr[1]).toBeLessThanOrEqual(1.25);
    expect(PROFILES.MOBILE_HIGH.dpr[1]).toBeLessThanOrEqual(1.5);
    expect(PROFILES.MOBILE_BALANCED.dpr[1]).toBeLessThanOrEqual(1.25);
    expect(PROFILES.MOBILE_LOW.dpr[1]).toBeLessThanOrEqual(1);
    for (const p of Object.values(PROFILES)) {
      expect(p.glass === 'GLASS_HIGH').toBe(p.id === 'DESKTOP_HIGH');
      expect(p.postprocessing).toBe('none');
      expect(p.dpr[0]).toBeLessThanOrEqual(p.dpr[1]);
    }
    expect(PROFILES.DESKTOP_HIGH.transmissionScale).toBeLessThan(1); // transmission buffer ×0.5 (−2.8 ms on an integrated GPU)
  });
  it('mobile profiles: smaller textures, near vegetation zone, IBL ≤ 128; low — no shadows and no PBR maps', () => {
    for (const id of ['MOBILE_HIGH', 'MOBILE_BALANCED', 'MOBILE_LOW'] as const) {
      expect(PROFILES[id].textureMaxPx).toBeLessThanOrEqual(512);
      expect(PROFILES[id].vegetation).toBe('near');
      expect(PROFILES[id].envMapSize).toBeLessThanOrEqual(128);
    }
    expect(PROFILES.MOBILE_LOW.shadows).toBe(false);
    expect(PROFILES.MOBILE_LOW.pbrMaps).toBe(false);
    // consistent with the earlier quality levels: "medium" (desktop) — shadows, no transmission; "low" — no shadows
    expect(PROFILES.DESKTOP_BALANCED.shadows).toBe(true);
    expect(PROFILES.DESKTOP_BALANCED.glass).toBe('GLASS_MOBILE');
  });
  it('platform detection: Client Hints, user agent, iPadOS, touch-only pointer', () => {
    const nav = (ua: string, touch = 0, mobile?: boolean) => ({ userAgent: ua, maxTouchPoints: touch, userAgentData: mobile === undefined ? undefined : { mobile } });
    expect(detectPlatform(nav('Mozilla/5.0 (X11; Linux x86_64) Chrome/152'), false)).toBe('desktop');
    expect(detectPlatform(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/152 Mobile'), false)).toBe('mobile');
    expect(detectPlatform(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), false)).toBe('mobile');
    expect(detectPlatform(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), false)).toBe('mobile');
    expect(detectPlatform(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false)).toBe('desktop');
    expect(detectPlatform(nav('Mozilla/5.0 (X11; Linux x86_64)', 0, true), false)).toBe('mobile');
    expect(detectPlatform(nav('Mozilla/5.0 (Windows NT 10.0)', 10), true)).toBe('mobile');
    expect(defaultTier('desktop')).toBe('high');
    expect(defaultTier('mobile')).toBe('medium');
  });
  it('GPU name from the renderer string (ANGLE, Vulkan, Mesa) and software rendering detection', () => {
    expect(describeGpu('ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060 Laptop GPU/PCIe/SSE2, OpenGL ES 3.2)')).toEqual({ name: 'NVIDIA GeForce RTX 3060 Laptop GPU', software: false });
    expect(describeGpu('ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)').name).toBe('Intel Iris Xe Graphics (ADL GT2)');
    expect(describeGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)').software).toBe(true);
    expect(describeGpu('Adreno (TM) 740').name).toBe('Adreno 740');
    expect(describeGpu(null).name).toBe(t('quality.gpuUnknown'));
  });
});

// Phone GPU class (a general rule from measurements on a physical flagship phone) and DPR adaptation
describe('mobile device class and DPR adaptation', () => {
  const S24U = 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)';
  it('flagship = the measured Adreno 750 and stronger successors (830+); the rest — standard until measured', () => {
    expect(classifyMobileGpu(S24U, 8)).toBe('flagship');
    expect(classifyMobileGpu('ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)', 8)).toBe('flagship');
    expect(classifyMobileGpu('ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', 8)).toBe('standard'); // not measured
    expect(classifyMobileGpu('ANGLE (Qualcomm, Adreno (TM) 735, OpenGL ES 3.2)', 8)).toBe('standard');
    expect(classifyMobileGpu('ANGLE (Qualcomm, Adreno (TM) 810, OpenGL ES 3.2)', 8)).toBe('standard'); // mid-range 8xx series
    expect(classifyMobileGpu('ANGLE (ARM, Mali-G715, OpenGL ES 3.2)', 8)).toBe('standard');
    expect(classifyMobileGpu(S24U, 4)).toBe('standard');                                               // not enough memory
    expect(classifyMobileGpu(S24U, null)).toBe('flagship');                                            // the browser does not report memory
    expect(classifyMobileGpu(null)).toBe('standard');
  });
  it('default tier: flagship — high, standard — balanced; desktop unchanged', () => {
    expect(defaultTier('mobile', 'flagship')).toBe('high');
    expect(defaultTier('mobile', 'standard')).toBe('medium');
    expect(defaultTier('desktop', 'flagship')).toBe('high');
  });
  it('max DPR 2.0 only for MOBILE_HIGH on a flagship; stable reference; other profiles unchanged', () => {
    const p = forDevice(PROFILES.MOBILE_HIGH, 'flagship');
    expect(p.dpr).toEqual([1, FLAGSHIP_DPR_MAX]);
    expect(forDevice(PROFILES.MOBILE_HIGH, 'flagship')).toBe(p);
    expect(forDevice(PROFILES.MOBILE_HIGH, 'standard')).toBe(PROFILES.MOBILE_HIGH);
    expect(forDevice(PROFILES.MOBILE_BALANCED, 'flagship')).toBe(PROFILES.MOBILE_BALANCED);
    expect(forDevice(PROFILES.DESKTOP_HIGH, 'flagship')).toBe(PROFILES.DESKTOP_HIGH);
    expect(PROFILES.MOBILE_HIGH.dpr[1]).toBe(1.5);                                                      // base profile untouched
    expect([PROFILES.DESKTOP_HIGH, PROFILES.DESKTOP_BALANCED].every((x) => !x.adaptiveDpr)).toBe(true);
    expect([PROFILES.MOBILE_HIGH, PROFILES.MOBILE_BALANCED, PROFILES.MOBILE_LOW].every((x) => x.adaptiveDpr)).toBe(true);
  });

  it('"Battery saver": alias of MOBILE_BALANCED + 60 fps on a phone; "Low" and desktop unchanged', () => {
    expect(profileWithSaver('mobile', 'high', true)).toBe(PROFILES.MOBILE_BALANCED);
    expect(profileWithSaver('mobile', 'medium', true)).toBe(PROFILES.MOBILE_BALANCED);
    expect(profileWithSaver('mobile', 'low', true)).toBe(PROFILES.MOBILE_LOW);
    expect(profileWithSaver('mobile', 'high', false)).toBe(PROFILES.MOBILE_HIGH);
    expect(profileWithSaver('desktop', 'high', true)).toBe(PROFILES.DESKTOP_HIGH);
    expect(forDevice(profileWithSaver('mobile', 'high', true), 'flagship').dpr[1]).toBe(1.25);   // DPR limited on a flagship too
    expect(BATTERY_SAVER_FPS).toBe(60);
  });

  /** frame stream with a constant interval dt for ms milliseconds; returns the DPR changes */
  const run = (c: ReturnType<typeof createAdaptiveDpr>, t0: number, ms: number, dt: number) => {
    const out: number[] = [];
    let t = t0;
    for (; t < t0 + ms; t += dt) { const d = c.frame(t); if (d !== null) out.push(d); }
    return { out, t };
  };
  it('steady 60 or 120 fps: DPR stays at the profile maximum', () => {
    const c = createAdaptiveDpr({ min: 1, max: 2 });
    expect(run(c, 0, 60000, 16.7).out).toEqual([]);
    expect(run(c, 100000, 60000, 8.3).out).toEqual([]);
    expect(c.dpr).toBe(2);
  });
  it('budget exceeded (33 ms): one step down after 2 windows, then a cooldown, never below the minimum', () => {
    const c = createAdaptiveDpr({ min: 1, max: 2 });
    const a = run(c, 0, 4500, 33.3);
    expect(a.out).toEqual([1.75]);                                    // 2 windows of 2 s
    const b = run(c, a.t, 4000, 33.3);
    expect(b.out).toEqual([]);                                        // 5 s cooldown after a change
    const d = run(c, b.t, 60000, 33.3);
    expect(d.out).toEqual([1.5, 1.25, 1]);
    expect(c.dpr).toBe(1);
    expect(run(c, d.t, 30000, 33.3).out).toEqual([]);                 // profile minimum — the profile does not change
  });
  it('a single hitch (shader compilation) does not change DPR', () => {
    const c = createAdaptiveDpr({ min: 1, max: 2 });
    let t = 0;
    const out: number[] = [];
    for (let i = 0; i < 2000; i++) { t += i % 200 === 50 ? 90 : 8.3; const d = c.frame(t); if (d !== null) out.push(d); }
    expect(out).toEqual([]);
  });
  it('hysteresis: stepping back up only after a long headroom, and the level that failed is blocked', () => {
    const c = createAdaptiveDpr({ min: 1, max: 2 });
    const a = run(c, 0, 4500, 33.3);
    expect(c.dpr).toBe(1.75);
    const b = run(c, a.t, 15000, 16.7);
    expect(b.out).toEqual([]);                                        // 15 s of headroom is not enough (20 s required)
    const d = run(c, b.t, 40000, 16.7);
    expect(d.out).toEqual([]);                                        // 2.0 blocked for 120 s after stepping down
    const e = run(c, d.t, 90000, 16.7);
    expect(e.out).toEqual([2]);                                       // after the block expires and 20 s of headroom
  });
  it('idle: gaps between frames are not counted (no adaptation at rest)', () => {
    const c = createAdaptiveDpr({ min: 1, max: 2 });
    let t = 0;
    const out: number[] = [];
    for (let i = 0; i < 400; i++) { t += 700; const d = c.frame(t); if (d !== null) out.push(d); }   // settling frames every 0.7 s
    expect(out).toEqual([]);
    expect(c.info().lastP95).toBeNull();
  });
  it('fixed DPR (min = max, e.g. ?dpr=) — controller inactive', () => {
    const c = createAdaptiveDpr({ min: 1.5, max: 1.5 });
    expect(run(c, 0, 20000, 40).out).toEqual([]);
  });
});
