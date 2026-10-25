// Sun simulation: IANA time zones (offsets, DST switches, local → UTC), NOAA sun position, sunrise / sunset, the sun
// direction in project coordinates, times of day and scene lighting. Sample house: lat 50°, lon 8°, Europe/Berlin, +X east.
// The demo apartment has no sun data — the engine falls back to the device time zone.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateProject, project } from '../../project/active';
import { readProjectDir } from '../../project/node';
import {
  deviceTimeZone, fmtTime, localToUtc, northApproximate, northEastLcs, siteGeo, sunAt, sunDirLcs, sunPosition, sunPresets,
  sunTimes, tzOffsetMinutes, zoneLabel,
} from '../model/sun';
import { sunLight } from '../scene/Lighting';

const root = path.resolve(__dirname, '..', '..', '..');
const house = readProjectDir(path.join(root, 'projects', 'sample-house'));

describe('time zones (Intl)', () => {
  it('Europe/Berlin: DST starts on the last Sunday of March and ends on the last Sunday of October, at 01:00 UTC', () => {
    expect(tzOffsetMinutes('Europe/Berlin', Date.UTC(2026, 2, 29, 0, 59))).toBe(60);
    expect(tzOffsetMinutes('Europe/Berlin', Date.UTC(2026, 2, 29, 1, 0))).toBe(120);
    expect(tzOffsetMinutes('Europe/Berlin', Date.UTC(2026, 9, 25, 0, 59))).toBe(120);
    expect(tzOffsetMinutes('Europe/Berlin', Date.UTC(2026, 9, 25, 1, 0))).toBe(60);
  });
  it('America/New_York: DST from the second Sunday of March to the first Sunday of November, at 02:00 local time', () => {
    // 2026-03-08 02:00 EST = 07:00 UTC; 2026-11-01 02:00 EDT = 06:00 UTC
    expect(tzOffsetMinutes('America/New_York', Date.UTC(2026, 2, 8, 6, 59))).toBe(-300);
    expect(tzOffsetMinutes('America/New_York', Date.UTC(2026, 2, 8, 7, 0))).toBe(-240);
    expect(tzOffsetMinutes('America/New_York', Date.UTC(2026, 10, 1, 5, 59))).toBe(-240);
    expect(tzOffsetMinutes('America/New_York', Date.UTC(2026, 10, 1, 6, 0))).toBe(-300);
  });
  it('zones without DST and UTC keep a constant offset; an invalid zone falls back to UTC', () => {
    for (const t of [Date.UTC(2026, 0, 15), Date.UTC(2026, 6, 15)]) {
      expect(tzOffsetMinutes('UTC', t)).toBe(0);
      expect(tzOffsetMinutes('Asia/Kolkata', t)).toBe(330);
      expect(tzOffsetMinutes('Not/AZone', t)).toBe(0);
    }
  });
  it('local time → UTC in an explicit zone (summer, winter, across the switch day)', () => {
    expect(localToUtc('2026-06-21', 12 * 60, 'Europe/Berlin')).toBe(Date.UTC(2026, 5, 21, 10, 0));
    expect(localToUtc('2026-12-21', 12 * 60, 'Europe/Berlin')).toBe(Date.UTC(2026, 11, 21, 11, 0));
    expect(localToUtc('2026-06-21', 12 * 60, 'America/New_York')).toBe(Date.UTC(2026, 5, 21, 16, 0));
    expect(localToUtc('2026-12-21', 12 * 60, 'America/New_York')).toBe(Date.UTC(2026, 11, 21, 17, 0));
    expect(localToUtc('2026-07-01', 30, 'Asia/Kolkata')).toBe(Date.UTC(2026, 5, 30, 19, 0));
    // switch days: before the switch the old offset applies, after it the new one
    expect(localToUtc('2026-03-29', 60, 'Europe/Berlin')).toBe(Date.UTC(2026, 2, 29, 0, 0));
    expect(localToUtc('2026-03-29', 4 * 60, 'Europe/Berlin')).toBe(Date.UTC(2026, 2, 29, 2, 0));
    expect(localToUtc('2026-10-25', 5 * 60, 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 25, 4, 0));
  });
  it('zone label of a local moment', () => {
    expect(zoneLabel('2026-06-21', 720, 'Europe/Berlin')).toBe('UTC+02:00');
    expect(zoneLabel('2026-12-21', 720, 'Europe/Berlin')).toBe('UTC+01:00');
    expect(zoneLabel('2026-06-21', 720, 'America/New_York')).toBe('UTC−04:00');
    expect(zoneLabel('2026-06-21', 720, 'Asia/Kolkata')).toBe('UTC+05:30');
  });
});

describe('project without sun data (demo apartment) → device time zone', () => {
  it('unknown site: device zone, +Y = north, orientation only assumed', () => {
    expect(project().sun).toBeUndefined();
    const g = siteGeo();
    expect(g.timeZone).toBe(deviceTimeZone());
    expect(g.confidence).toBe('assumed');
    expect(g.trueAzimuthX).toBe(90);
    expect(northApproximate()).toBe(true);
    expect(Math.abs(g.lon)).toBeLessThanOrEqual(180);
    // local time defaults to the device zone
    expect(localToUtc('2026-06-21', 720)).toBe(localToUtc('2026-06-21', 720, deviceTimeZone()));
  });
});

describe('sample house: position, orientation and sun', () => {
  beforeAll(() => { activateProject(house); });
  afterAll(() => { activateProject(readProjectDir(path.join(root, 'projects', 'demo-apartment'))); });

  it('position and time zone come from the package', () => {
    expect(siteGeo()).toMatchObject({ lat: 50, lon: 8, timeZone: 'Europe/Berlin', trueAzimuthX: 90, confidence: 'probable' });
    expect(northApproximate()).toBe(true);
    // local time defaults to the project zone
    expect(localToUtc('2026-06-21', 12 * 60)).toBe(Date.UTC(2026, 5, 21, 10, 0));
    expect(zoneLabel('2026-01-10', 600)).toBe('UTC+01:00');
  });
  it('north and east in project coordinates: +X east, +Y north (azimuth of +X = 90°)', () => {
    const { north, east } = northEastLcs();
    expect(north[0]).toBeCloseTo(0, 12); expect(north[1]).toBeCloseTo(1, 12);
    expect(east[0]).toBeCloseTo(1, 12); expect(east[1]).toBeCloseTo(0, 12);
    // east = north rotated clockwise (seen from above)
    expect(north[0] * east[1] - north[1] * east[0]).toBeCloseTo(-1, 12);
  });
  it('sun direction: azimuth 90° on the horizon = +X, 180° = −Y (south), 270° = −X, zenith = +Z; unit length', () => {
    const e = sunDirLcs(90, 0), s = sunDirLcs(180, 0), w = sunDirLcs(270, 0);
    expect(e[0]).toBeCloseTo(1, 9); expect(e[1]).toBeCloseTo(0, 9);
    expect(s[0]).toBeCloseTo(0, 9); expect(s[1]).toBeCloseTo(-1, 9);
    expect(w[0]).toBeCloseTo(-1, 9); expect(w[1]).toBeCloseTo(0, 9);
    expect(sunDirLcs(123, 90)[2]).toBeCloseTo(1, 9);
    expect(Math.hypot(...sunDirLcs(200, 30))).toBeCloseTo(1, 12);
  });
  it('solar noon: azimuth 180°, elevation = 90° − φ + δ (equinox ≈ 40°, summer solstice ≈ 63.4°, winter ≈ 16.6°)', () => {
    for (const [d, el] of [['2026-03-20', 40], ['2026-06-21', 63.45], ['2026-12-21', 16.6]] as const) {
      const t = sunTimes(d), p = sunAt(d, t.noon);
      expect(p.azimuth, d).toBeCloseTo(180, 0);
      expect(Math.abs(p.elevation - el), d).toBeLessThan(0.4);
      expect(Math.abs(p.elevationTrue - (90 - 50 + p.declination)), d).toBeLessThan(0.05);
    }
    // lon 8° is 7° west of the zone meridian (15° E): solar noon about 28 min after 12:00 standard time
    expect(Math.abs(sunTimes('2026-12-21').noon - (12 * 60 + 26))).toBeLessThan(4);
    expect(Math.abs(sunTimes('2026-06-21').noon - (13 * 60 + 30))).toBeLessThan(4);
  });
  it('21 June: sunrise ≈ 5:20, sunset ≈ 21:40 CEST, day ≈ 16 h 20 min; sun rises in the NE and sets in the NW', () => {
    const t = sunTimes('2026-06-21');
    expect(Math.abs(t.sunrise! - (5 * 60 + 20))).toBeLessThan(10);
    expect(Math.abs(t.sunset! - (21 * 60 + 40))).toBeLessThan(10);
    expect(Math.abs(t.sunset! - t.sunrise! - (16 * 60 + 22))).toBeLessThan(10);
    expect(sunAt('2026-06-21', t.sunrise!).azimuth).toBeGreaterThan(40); expect(sunAt('2026-06-21', t.sunrise!).azimuth).toBeLessThan(60);
    expect(sunAt('2026-06-21', t.sunset!).azimuth).toBeGreaterThan(300); expect(sunAt('2026-06-21', t.sunset!).azimuth).toBeLessThan(320);
  });
  it('21 December: sunrise ≈ 8:25, sunset ≈ 16:30 CET, day ≈ 8 h 05 min; sun rises in the SE and sets in the SW', () => {
    const t = sunTimes('2026-12-21');
    expect(Math.abs(t.sunrise! - (8 * 60 + 25))).toBeLessThan(10);
    expect(Math.abs(t.sunset! - (16 * 60 + 30))).toBeLessThan(10);
    expect(Math.abs(t.sunset! - t.sunrise! - (8 * 60 + 5))).toBeLessThan(10);
    expect(sunAt('2026-12-21', t.sunrise!).azimuth).toBeGreaterThan(115); expect(sunAt('2026-12-21', t.sunrise!).azimuth).toBeLessThan(140);
    expect(sunAt('2026-12-21', t.sunset!).azimuth).toBeGreaterThan(220); expect(sunAt('2026-12-21', t.sunset!).azimuth).toBeLessThan(245);
  });
  it('equinox: day ≈ 12 h 10 min (refraction and disc), sunrise close to geographic east', () => {
    const t = sunTimes('2026-03-20');
    expect(Math.abs(t.sunset! - t.sunrise! - 730)).toBeLessThan(10);
    expect(Math.abs(sunAt('2026-03-20', t.sunrise!).azimuth - 90)).toBeLessThan(2.5);
  });
  it('night: sun below the horizon; refraction lifts the sun near the horizon by about 0.5°', () => {
    expect(sunAt('2026-06-21', 60).elevation).toBeLessThan(-10);
    const p = sunPosition(localToUtc('2026-06-21', sunTimes('2026-06-21').sunset!));
    expect(p.elevation - p.elevationTrue).toBeGreaterThan(0.3); expect(p.elevation - p.elevationTrue).toBeLessThan(0.7);
  });
  it('sun direction in project coordinates: morning from the east (+X), noon from the south (−Y), evening from the west (−X)', () => {
    const at = (m: number) => { const p = sunAt('2026-06-21', m); return sunDirLcs(p.azimuth, p.elevation); };
    expect(at(8 * 60)[0]).toBeGreaterThan(0.5);
    const noon = at(sunTimes('2026-06-21').noon);
    expect(noon[1]).toBeLessThan(-0.4); expect(Math.abs(noon[0])).toBeLessThan(0.02); expect(noon[2]).toBeGreaterThan(0.85);
    expect(at(19 * 60)[0]).toBeLessThan(-0.5);
  });
  it('times of day: Morning < Noon < Afternoon < Sunset, rounded to 5 min; sun above the horizon', () => {
    for (const d of ['2026-03-20', '2026-06-21', '2026-12-21']) {
      const p = sunPresets(d);
      expect(p.morning).toBeLessThan(p.noon); expect(p.noon).toBeLessThan(p.afternoon); expect(p.afternoon).toBeLessThan(p.sunset);
      for (const v of Object.values(p)) { expect(v % 5).toBe(0); expect(sunAt(d, v).elevation, `${d} ${fmtTime(v)}`).toBeGreaterThan(0.5); }
    }
    expect(fmtTime(765)).toBe('12:45'); expect(fmtTime(59.7)).toBe('1:00');
  });
  it('scene lighting: night — no direct sun, day — full; golden hour — warmer light; noon light from the south and high', () => {
    const night = sunLight('2026-06-21', 23 * 60 + 30), noon = sunLight('2026-06-21', 13 * 60 + 30), dusk = sunLight('2026-06-21', 21 * 60 + 25);
    expect(night.direct).toBe(0); expect(night.daylight).toBeLessThan(0.1);
    expect(noon.direct).toBe(1); expect(noon.daylight).toBe(1);
    expect(dusk.light.b).toBeLessThan(noon.light.b);
    expect(noon.dir.y).toBeGreaterThan(0.85); // high (three.js: y up)
    expect(noon.dir.z).toBeGreaterThan(0.3); // three.js z = −Y of the project: the sun is south of the building
  });
});
