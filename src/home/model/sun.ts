// Sun position (pure TS, testable without a browser).
//   • Project position and orientation come from the package (project().sun, module `sun`): latitude / longitude [°],
//     azimuth of the project's +X axis from geographic north, IANA time zone.
//   • Sun: NOAA algorithm (Meeus; about 0.01° accuracy for 1900–2100) — azimuth from north clockwise, elevation corrected
//     for refraction; sunrise / sunset: centre of the disc at −0.833°.
//   • Local time: any IANA time zone via Intl (DST rules come from the platform's time zone database).
import { project } from '../../project/active';
import type { Vec3 } from './types';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** project position and orientation — sun simulation input (project module `sun`) */
export interface SunSite {
  lat: number; lon: number;
  /** azimuth of the project's +X axis from grid north and the meridian convergence [°] */
  gridAzimuthX: number; convergence: number;
  /** geographic azimuth of the +X axis = grid + convergence */
  trueAzimuthX: number;
  /** orientation confidence; 'confirmed' removes the "approximate north" badge */
  confidence: string;
  /** estimated uncertainty of north [°] */
  uncertaintyDeg: number;
  /** IANA time zone, e.g. "Europe/Berlin", "America/New_York" */
  timeZone: string;
  /** place name shown in the sun panel */
  placeName?: string;
}

/** time zone of the device (fallback when a project has no sun data) */
export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const offsetFormats = new Map<string, Intl.DateTimeFormat>();
/** offset of local time from UTC [min] in the given IANA time zone at instant t (UTC, ms) */
export function tzOffsetMinutes(timeZone: string, t: number): number {
  let f = offsetFormats.get(timeZone);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }); } catch { f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', timeZoneName: 'longOffset' }); }
    offsetFormats.set(timeZone, f);
  }
  const name = f.formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** project without position data (e.g. an apartment without a plot): device time zone, longitude matching its offset,
 *  +Y = north — used only to light the scene */
function unknownSite(): SunSite {
  const timeZone = deviceTimeZone(), lon = Math.max(-180, Math.min(180, tzOffsetMinutes(timeZone, Date.now()) / 4));
  return { lat: 50, lon, gridAzimuthX: 90, convergence: 0, trueAzimuthX: 90, confidence: 'assumed', uncertaintyDeg: 180, timeZone };
}
let fallback: SunSite | null = null;
/** project position and orientation (from the package: project().sun) */
export const siteGeo = (): SunSite => project().sun ?? (fallback ??= unknownSite());
export const northApproximate = () => siteGeo().confidence !== 'confirmed';

/** geographic directions in project coordinates (horizontal, unit): north and east */
export function northEastLcs(azX = siteGeo().trueAzimuthX): { north: [number, number]; east: [number, number] } {
  const A = rad(azX);
  return { north: [Math.cos(A), Math.sin(A)], east: [Math.sin(A), -Math.cos(A)] };
}

// ------------------------------------------------------------------ local time
/** date "YYYY-MM-DD" + minutes after local midnight → UTC instant [ms] in the given time zone */
export function localToUtc(date: string, minutes: number, timeZone: string = siteGeo().timeZone): number {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000;
  // two iterations settle the offset also next to a DST switch
  let t = naive - tzOffsetMinutes(timeZone, naive) * 60_000;
  t = naive - tzOffsetMinutes(timeZone, t) * 60_000;
  return t;
}
/** label of the local time offset at that moment, e.g. "UTC+02:00" */
export function zoneLabel(date: string, minutes: number, timeZone: string = siteGeo().timeZone): string {
  const off = tzOffsetMinutes(timeZone, localToUtc(date, minutes, timeZone)), a = Math.abs(off);
  return `UTC${off < 0 ? '−' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ sun (NOAA)
export interface SunPosition { azimuth: number; elevation: number; /** geometric elevation (without refraction) */ elevationTrue: number; declination: number; eqTime: number }

export function sunPosition(utcMs: number, lat = siteGeo().lat, lon = siteGeo().lon): SunPosition {
  const jd = utcMs / 86_400_000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C, omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const yv = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(yv * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * yv * Math.sin(rad(M)) * Math.cos(2 * rad(L0))
    - 0.5 * yv * yv * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  const d = new Date(utcMs), minUtc = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  let tst = (minUtc + eqTime + 4 * lon) % 1440;
  if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const cosZ = Math.sin(rad(lat)) * Math.sin(rad(decl)) + Math.cos(rad(lat)) * Math.cos(rad(decl)) * Math.cos(rad(ha));
  const zen = deg(Math.acos(Math.min(1, Math.max(-1, cosZ))));
  const elTrue = 90 - zen;
  // azimuth from north, clockwise
  const az = (deg(Math.atan2(Math.sin(rad(ha)), Math.cos(rad(ha)) * Math.sin(rad(lat)) - Math.tan(rad(decl)) * Math.cos(rad(lat)))) + 180 + 360) % 360;
  // atmospheric refraction (NOAA)
  let refr = 0;
  if (elTrue <= 85) {
    const te = Math.tan(rad(elTrue));
    if (elTrue > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elTrue > -0.575) refr = 1735 + elTrue * (-518.2 + elTrue * (103.4 + elTrue * (-12.79 + elTrue * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  return { azimuth: az, elevation: elTrue + refr, elevationTrue: elTrue, declination: decl, eqTime };
}

/** sun position for a date and local time (minutes after midnight) */
export const sunAt = (date: string, minutes: number) => sunPosition(localToUtc(date, minutes));

/** direction to the sun in LCS (unit, Z up) */
export function sunDirLcs(az: number, el: number, azX = siteGeo().trueAzimuthX): Vec3 {
  const { north, east } = northEastLcs(azX), ce = Math.cos(rad(el)), sa = Math.sin(rad(az)), ca = Math.cos(rad(az));
  return [ce * (sa * east[0] + ca * north[0]), ce * (sa * east[1] + ca * north[1]), Math.sin(rad(el))];
}

/** sunrise, solar noon, sunset [min after local midnight] — disc centre elevation −0.833° (bisection) */
export function sunTimes(date: string): { sunrise: number | null; noon: number; sunset: number | null } {
  const el = (m: number) => sunPosition(localToUtc(date, m)).elevationTrue;
  // solar noon: maximum elevation (search every 10 min + refinement)
  let noon = 0, best = -Infinity;
  for (let m = 0; m <= 1440; m += 10) { const e = el(m); if (e > best) { best = e; noon = m; } }
  for (let step = 5; step > 0.05; step /= 2) for (const m of [noon - step, noon + step]) { const e = el(m); if (e > best) { best = e; noon = m; } }
  const H = -0.833;
  const cross = (a: number, b: number): number | null => {
    if ((el(a) - H) * (el(b) - H) > 0) return null;
    for (let i = 0; i < 40; i++) { const mid = (a + b) / 2; if ((el(a) - H) * (el(mid) - H) <= 0) b = mid; else a = mid; }
    return (a + b) / 2;
  };
  return { sunrise: cross(0, noon), noon, sunset: cross(noon, 1440) };
}

/** times of day (buttons): Morning — halfway from sunrise to solar noon, Noon — solar noon, Afternoon — halfway from
 *  solar noon to sunset, Sunset — 15 min before sunset (sun about 2° above the horizon — light and shadows still visible) */
export function sunPresets(date: string): Record<'morning' | 'noon' | 'afternoon' | 'sunset', number> {
  const t = sunTimes(date), sr = t.sunrise ?? t.noon - 240, ss = t.sunset ?? t.noon + 240;
  const r5 = (m: number) => Math.round(m / 5) * 5;
  return { morning: r5((sr + t.noon) / 2), noon: r5(t.noon), afternoon: r5((t.noon + ss) / 2), sunset: r5(ss - 15) };
}

export const fmtTime = (m: number) => { const r = Math.round(m); return `${Math.floor(r / 60) % 24}:${String(r % 60).padStart(2, '0')}`; };
