// Graphics quality profiles.
// A single source of rendering settings: scene components and texture generators read profile fields — no "if (mobile)"
// conditions scattered across the app. The profile is a device setting (UI state in localStorage), NOT part of the project / variant.
// Choice: platform (desktop / mobile, detected automatically, can be overridden) × tier (High / Balanced / Low).
import { t } from '../../i18n';

export type ProfileId = 'DESKTOP_HIGH' | 'DESKTOP_BALANCED' | 'MOBILE_HIGH' | 'MOBILE_BALANCED' | 'MOBILE_LOW';
export type Platform = 'desktop' | 'mobile';
/** tier chosen by the user (names match the existing ?quality=high|medium|low) */
export type Tier = 'high' | 'medium' | 'low';
/** glass: GLASS_HIGH — physical transmission (an extra scene pass), GLASS_MOBILE — transparency + IBL reflection */
export type GlassQuality = 'GLASS_HIGH' | 'GLASS_MOBILE';

export interface QualityProfile {
  id: ProfileId;
  label: string;
  platform: Platform;
  tier: Tier;
  /** pixel density of the 3D canvas: [min, max] — clamps window.devicePixelRatio (the HTML UI stays native) */
  dpr: [number, number];
  /** MSAA antialiasing (on context creation — a change takes effect after reload) */
  antialias: boolean;
  glass: GlassQuality;
  /** transmission buffer scale (GLASS_HIGH): 1 = full canvas resolution */
  transmissionScale: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowType: 'pcfsoft' | 'pcf';
  /** surroundings: full — everything; reduced — without distant elements (accuracy class "distant") */
  environment: 'full' | 'reduced';
  /** vegetation: all — all trees and shrubs; near — the near zone only */
  vegetation: 'all' | 'near';
  /** reflections: PMREM environment map [px] (the only reflections in the scene — no SSR / probes) */
  envMapSize: 256 | 128 | 64;
  /** procedural textures: max side [px] and PBR maps (normals + ORM) */
  textureMaxPx: 1024 | 512 | 256;
  pbrMaps: boolean;
  anisotropy: number;
  /** DPR adaptation at runtime (within `dpr`) — mobile profiles only; desktop has a fixed DPR */
  adaptiveDpr: boolean;
  /** post-processing — none in all profiles (no cost of extra passes) */
  postprocessing: 'none';
  /** mesh LOD — not implemented (optional) */
  lod: 'none';
}

export const PROFILES: Record<ProfileId, QualityProfile> = {
  DESKTOP_HIGH: {
    id: 'DESKTOP_HIGH', get label() { return t('quality.desktopHigh'); }, platform: 'desktop', tier: 'high', dpr: [1, 2], antialias: true,
    glass: 'GLASS_HIGH', transmissionScale: 0.5, shadows: true, shadowMapSize: 2048, shadowType: 'pcfsoft',
    environment: 'full', vegetation: 'all', envMapSize: 256, textureMaxPx: 1024, pbrMaps: true, anisotropy: 4, adaptiveDpr: false, postprocessing: 'none', lod: 'none',
  },
  DESKTOP_BALANCED: {
    id: 'DESKTOP_BALANCED', get label() { return t('quality.desktopBalanced'); }, platform: 'desktop', tier: 'medium', dpr: [1, 1.25], antialias: true,
    glass: 'GLASS_MOBILE', transmissionScale: 1, shadows: true, shadowMapSize: 1024, shadowType: 'pcf',
    environment: 'full', vegetation: 'all', envMapSize: 256, textureMaxPx: 1024, pbrMaps: true, anisotropy: 4, adaptiveDpr: false, postprocessing: 'none', lod: 'none',
  },
  MOBILE_HIGH: {
    id: 'MOBILE_HIGH', get label() { return t('quality.mobileHigh'); }, platform: 'mobile', tier: 'high', dpr: [1, 1.5], antialias: true,
    glass: 'GLASS_MOBILE', transmissionScale: 1, shadows: true, shadowMapSize: 1024, shadowType: 'pcf',
    environment: 'full', vegetation: 'near', envMapSize: 128, textureMaxPx: 512, pbrMaps: true, anisotropy: 2, adaptiveDpr: true, postprocessing: 'none', lod: 'none',
  },
  MOBILE_BALANCED: {
    id: 'MOBILE_BALANCED', get label() { return t('quality.mobileBalanced'); }, platform: 'mobile', tier: 'medium', dpr: [1, 1.25], antialias: true,
    glass: 'GLASS_MOBILE', transmissionScale: 1, shadows: true, shadowMapSize: 1024, shadowType: 'pcf',
    environment: 'reduced', vegetation: 'near', envMapSize: 128, textureMaxPx: 512, pbrMaps: false, anisotropy: 1, adaptiveDpr: true, postprocessing: 'none', lod: 'none',
  },
  MOBILE_LOW: {
    id: 'MOBILE_LOW', get label() { return t('quality.mobileLow'); }, platform: 'mobile', tier: 'low', dpr: [0.75, 1], antialias: false,
    glass: 'GLASS_MOBILE', transmissionScale: 1, shadows: false, shadowMapSize: 1024, shadowType: 'pcf',
    environment: 'reduced', vegetation: 'near', envMapSize: 64, textureMaxPx: 256, pbrMaps: false, anisotropy: 1, adaptiveDpr: true, postprocessing: 'none', lod: 'none',
  },
};

/**
 * "Battery saver" (phone / tablet): a simple alias — the MOBILE_BALANCED profile (DPR max 1.25) + a 60 fps cap
 * (BATTERY_SAVER_FPS; 120 Hz screens then draw every other frame). The "Low" tier stays MOBILE_LOW. No effect on desktop.
 */
export const BATTERY_SAVER_FPS = 60;
export function profileWithSaver(platform: Platform, tier: Tier, saver: boolean): QualityProfile {
  return saver && platform === 'mobile' && tier !== 'low' ? PROFILES.MOBILE_BALANCED : profileFor(platform, tier);
}

/** profile for a platform and tier; "low" — one power-saving profile for both platforms (MOBILE_LOW) */
export function profileFor(platform: Platform, tier: Tier): QualityProfile {
  if (tier === 'low') return PROFILES.MOBILE_LOW;
  if (platform === 'mobile') return tier === 'high' ? PROFILES.MOBILE_HIGH : PROFILES.MOBILE_BALANCED;
  return tier === 'high' ? PROFILES.DESKTOP_HIGH : PROFILES.DESKTOP_BALANCED;
}

/**
 * Safe device classification (no benchmark): Client Hints `mobile`, user agent (Android / iPhone / iPad / Mobile),
 * iPadOS as a Mac with a touch screen, a touch-only pointer (no precise pointer — mouse / touchpad).
 */
export function detectPlatform(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { userAgentData?: { mobile?: boolean } } = navigator,
  coarseOnly: boolean = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches): Platform {
  if (nav.userAgentData?.mobile) return 'mobile';
  const ua = nav.userAgent ?? '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return 'mobile';
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return 'mobile'; // iPadOS "desktop website" mode
  return coarseOnly ? 'mobile' : 'desktop';
}

/**
 * GPU class of a phone / tablet from the WebGL renderer string (a general rule, no phone model names).
 * 'flagship' covers only chips MEASURED on a physical device and their stronger successors:
 *  • Adreno 750 (Snapdragon 8 Gen 3 — Galaxy S24 Ultra: 100–117 fps in MOBILE_HIGH, no drop at the native DPR 2.81),
 *  • Adreno 830 and newer flagship-class 8xx (8 Elite) — stronger than the measured one.
 * Others (including Adreno 740 of the Galaxy S23 Ultra — not yet measured, mid-range Adreno 7xx / 810 / 825, Mali, Xclipse,
 * PowerVR) stay in the 'standard' class until measured. Device memory ≥ 8 GB is required when the browser reports it.
 */
export type GpuClass = 'flagship' | 'standard';
export function classifyMobileGpu(renderer: string | null | undefined, deviceMemoryGB?: number | null): GpuClass {
  if (typeof deviceMemoryGB === 'number' && deviceMemoryGB < 8) return 'standard';
  const m = /Adreno \(TM\) (\d{3})/i.exec(renderer ?? '');
  if (!m) return 'standard';
  const n = Number(m[1]);
  return n === 750 || (n >= 830 && n < 900) ? 'flagship' : 'standard';
}

/** WebGL renderer string without creating a scene (temporary context, released immediately); null when unavailable */
export function webglRendererString(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const r = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  } catch { return null; }
}

/** device class determined once at start-up (src/home/store/ui.ts) — mobile platform only */
export const deviceClass: { gpu: GpuClass; renderer: string | null } = { gpu: 'standard', renderer: null };

/** max canvas DPR in MOBILE_HIGH for the 'flagship' class (measured on S24 Ultra: 2.0 = crisp profiles and slats at no performance cost) */
export const FLAGSHIP_DPR_MAX = 2;
const forDev = new Map<ProfileId, QualityProfile>();
/** profile adjusted for the device class (stable reference per profile — selectors compare with Object.is) */
export function forDevice(p: QualityProfile, gpu: GpuClass = deviceClass.gpu): QualityProfile {
  if (gpu !== 'flagship' || p.id !== 'MOBILE_HIGH') return p;
  let r = forDev.get(p.id);
  if (!r) { r = { ...p, dpr: [p.dpr[0], FLAGSHIP_DPR_MAX] }; forDev.set(p.id, r); }
  return r;
}

/** default tier on first launch: desktop — high; phone / tablet — balanced, the 'flagship' class — high */
export const defaultTier = (p: Platform, gpu: GpuClass = 'standard'): Tier => (p === 'mobile' ? (gpu === 'flagship' ? 'high' : 'medium') : 'high');

/**
 * Active profile — module state read by texture / material generators outside React.
 * Set synchronously by HomeCanvas before the scene layers render.
 */
export const activeProfile: { current: QualityProfile } = { current: PROFILES.DESKTOP_HIGH };

/**
 * Diagnostics (benchmark, glass comparison): ?glass=GLASS_HIGH|GLASS_MOBILE, ?tscale=0.25–1 override profile fields;
 * ?dpr=0.5–3 — a fixed canvas pixel density (DPR calibration on a device).
 * The result is memoised per profile — a stable reference (store selectors compare with Object.is).
 */
const dbg: Partial<QualityProfile> = (() => {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search), o: Partial<QualityProfile> = {};
  const g = q.get('glass'); if (g === 'GLASS_HIGH' || g === 'GLASS_MOBILE') o.glass = g;
  const ts = Number(q.get('tscale')); if (ts >= 0.1 && ts <= 1) o.transmissionScale = ts;
  const d = Number(q.get('dpr')); if (d >= 0.5 && d <= 3) o.dpr = [d, d];
  return o;
})();
const withDbg = new Map<ProfileId, QualityProfile>();
export function withDebug(p: QualityProfile): QualityProfile {
  if (!Object.keys(dbg).length) return p;
  let r = withDbg.get(p.id);
  if (!r) { r = { ...p, ...dbg }; withDbg.set(p.id, r); }
  return r;
}

/**
 * Readable graphics card name from the WebGL renderer string, e.g. "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060 Laptop
 * GPU/PCIe/SSE2, OpenGL ES 3.2)" → "NVIDIA GeForce RTX 3060 Laptop GPU"; software — software rendering (SwiftShader, llvmpipe — very slow).
 */
export function describeGpu(raw: string | null | undefined): { name: string; software: boolean } {
  const r = (raw ?? '').trim();
  const software = /swiftshader|llvmpipe|softpipe|lavapipe|software/i.test(r);
  const m = r.match(/^ANGLE \(([^,]*),\s*(.*?),\s*[^,]*\)$/);
  let name = m ? m[2] : r;
  name = name.replace(/\/PCIe\/SSE2$/, '').replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/^Vulkan [\d.]+ \((.*)\)$/, '$1').replace(/^Mesa /, '').replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim();
  return { name: name || t('quality.gpuUnknown'), software };
}
