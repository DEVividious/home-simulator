// Time of day (the Look step, sun module): times of day (Morning / Noon / Afternoon / Sunset) and a day bar; in advanced mode the
// date and time fields, the 24-hour dial, the sun position (azimuth, elevation), sunrise / sunset and a north indicator that
// rotates with the camera, marked "approximate north" when the site orientation is not confirmed.
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { fmtTime, northApproximate, northEastLcs, siteGeo, sunAt, sunPresets, sunTimes, zoneLabel } from '../model/sun';
import { sceneApi } from '../scene/sceneApi';
import { onSceneFrame } from '../scene/renderLoop';
import { ui, useUi } from '../store/ui';
import { useLayout } from '../store/layout';
import { fmtNum, t } from '../../i18n';

type PresetKey = 'morning' | 'noon' | 'afternoon' | 'sunset';
const PRESET_KEYS: PresetKey[] = ['morning', 'noon', 'afternoon', 'sunset'];
/** [key, label, title] — computed at render time (UI language) */
const presetLabels = (): [PresetKey, string, string][] => PRESET_KEYS.map((k) => [k, t(`sunUi.${k}`), t(`sunUi.${k}Hint`)]);
const comma = (v: number, d = 0) => fmtNum(v, d);
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dirName = (az: number) => DIRS[Math.round(az / 45) % 8];

/** north arrow rotated with the camera's view direction (updated in the render loop, no React renders) */
export function NorthArrow({ size = 34 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const { north, east } = northEastLcs();
    const tick = () => {
      const c = sceneApi.camera as THREE.PerspectiveCamera | null, el = ref.current;
      if (c && el) {
        // view direction (LCS, horizontal) → geographic azimuth; the N arrow is rotated by −azimuth
        const e = c.matrixWorld.elements, fx = -e[8], fy = e[10];
        const az = (Math.atan2(fx * east[0] + fy * east[1], fx * north[0] + fy * north[1]) * 180) / Math.PI;
        el.style.transform = `rotate(${(-az).toFixed(1)}deg)`;
        el.dataset.heading = String(Math.round((az + 360) % 360));
      }
    };
    // after every rendered scene frame (the camera only changes then), instead of a permanent rAF loop
    tick();
    return onSceneFrame(tick);
  }, []);
  return (
    <div className="hm-north-rose" style={{ width: size, height: size }} data-testid="north-arrow" ref={ref}>
      <svg viewBox="0 0 40 40" width={size} height={size}><path d="M20 3 27 21 20 17 13 21Z" fill="#d6453a" /><path d="M20 37 27 21 20 25 13 21Z" fill="#9aa3b2" /></svg>
      <b>N</b>
    </div>
  );
}

// ------------------------------------------------------------------ 24-hour dial
const DIAL = 196, R = 78, C0 = DIAL / 2;
/** minutes → angle [rad] from the top, clockwise: 12:00 at the top, 18:00 on the right (west), 0:00 at the bottom,
 *  6:00 on the left (east) — like the sun's path seen by a person facing south */
const angleOf = (m: number) => ((m - 720) / 1440) * 2 * Math.PI;
const pointOf = (m: number, r = R): [number, number] => { const a = angleOf(m); return [C0 + r * Math.sin(a), C0 - r * Math.cos(a)]; };
/** SVG arc along the rim from m0 to m1 (clockwise) */
function arc(m0: number, m1: number, r = R) {
  const span = ((m1 - m0 + 1440) % 1440) || 1440, [x0, y0] = pointOf(m0, r), [x1, y1] = pointOf(m0 + span, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${span > 720 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** round 24-hour dial for setting the time: drag the sun around the dial, mouse wheel, arrow keys (5 min steps, Shift — 1 h) */
export function SunDial({ date, minutes, sunrise, sunset, night, onChange }: { date: string; minutes: number; sunrise: number | null; sunset: number | null; night: boolean; onChange: (m: number) => void }) {
  const ref = useRef<SVGSVGElement>(null), drag = useRef(false);
  const norm = (m: number) => ((Math.round(m / 5) * 5) % 1440 + 1440) % 1440;
  const fromEvent = (e: { clientX: number; clientY: number }) => {
    const b = ref.current!.getBoundingClientRect(), k = DIAL / b.width;
    const x = (e.clientX - b.left) * k - C0, y = (e.clientY - b.top) * k - C0;
    const a = Math.atan2(x, -y); // from the top, clockwise
    return norm(720 + (a / (2 * Math.PI)) * 1440);
  };
  const step = (d: number) => onChange(norm(minutes + d));
  // mouse wheel — non-passive listener (preventDefault: the page does not scroll)
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = (e: WheelEvent) => { e.preventDefault(); stepRef.current((e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 60 : 5)); };
    el.addEventListener('wheel', w, { passive: false });
    return () => el.removeEventListener('wheel', w);
  }, []);
  const [hx, hy] = pointOf(minutes), [sx, sy] = pointOf(minutes, 44);
  return (
    <div className="hm-dial-wrap">
      <svg ref={ref} className="hm-dial" viewBox={`0 0 ${DIAL} ${DIAL}`} width={DIAL} height={DIAL} tabIndex={0} role="slider" aria-label={t('sunUi.dialAria')}
        aria-valuemin={0} aria-valuemax={1435} aria-valuenow={minutes} aria-valuetext={fmtTime(minutes)} data-testid="sun-dial" data-minutes={minutes}
        onPointerDown={(e) => { drag.current = true; ref.current?.setPointerCapture?.(e.pointerId); ref.current?.focus(); onChange(fromEvent(e)); }}
        onPointerMove={(e) => { if (drag.current) onChange(fromEvent(e)); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (d) { e.preventDefault(); e.stopPropagation(); step(d * (e.shiftKey ? 60 : 5)); }
        }}>
        <circle cx={C0} cy={C0} r={R} className="hm-dial-night" />
        {sunrise !== null && sunset !== null && <path d={arc(sunrise, sunset)} className="hm-dial-day" />}
        {Array.from({ length: 24 }, (_, h) => { const [x0, y0] = pointOf(h * 60, R - 13), [x1, y1] = pointOf(h * 60, R - (h % 6 ? 17 : 21)); return <line key={h} x1={x0} y1={y0} x2={x1} y2={y1} className={`hm-dial-tick${h % 6 ? '' : ' major'}`} />; })}
        {[0, 6, 12, 18].map((h) => { const [x, y] = pointOf(h * 60, R - 31); return <text key={h} x={x} y={y + 4} className="hm-dial-label">{h}</text>; })}
        {sunrise !== null && (() => { const [x0, y0] = pointOf(sunrise, R - 9), [x1, y1] = pointOf(sunrise, R + 9); return <line x1={x0} y1={y0} x2={x1} y2={y1} className="hm-dial-rise"><title>{t('sunUi.sunriseAt', { time: fmtTime(sunrise) })}</title></line>; })()}
        {sunset !== null && (() => { const [x0, y0] = pointOf(sunset, R - 9), [x1, y1] = pointOf(sunset, R + 9); return <line x1={x0} y1={y0} x2={x1} y2={y1} className="hm-dial-rise"><title>{t('sunUi.sunsetAt', { time: fmtTime(sunset) })}</title></line>; })()}
        <line x1={sx} y1={sy} x2={hx} y2={hy} className="hm-dial-hand" />
        <g transform={`translate(${hx} ${hy})`} className={`hm-dial-knob${night ? ' night' : ''}`} data-testid="sun-dial-knob">
          <circle r={13} />
          {night ? <path d="M3 -6 A6.5 6.5 0 1 0 4 6 A5 5 0 1 1 3 -6Z" /> : <g><circle r={5} />{Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return <line key={i} x1={Math.cos(a) * 7.5} y1={Math.sin(a) * 7.5} x2={Math.cos(a) * 10} y2={Math.sin(a) * 10} />; })}</g>}
        </g>
        <text x={C0} y={C0 + 2} className="hm-dial-time">{fmtTime(minutes)}</text>
        <text x={C0} y={C0 + 20} className="hm-dial-date">{date.slice(8, 10)}.{date.slice(5, 7)}.{date.slice(0, 4)}</text>
      </svg>
      <small className="hm-muted">{t('sunUi.dialHint')}</small>
    </div>
  );
}

/** phone: a 0–24 h day bar (the dial "unrolled" horizontally) — low, so the scene stays visible while changing the time;
 *  drag the sun with a finger, arrow keys in 5 min steps (Shift — 1 h) */
export function SunTrack({ minutes, sunrise, sunset, night, onChange }: { minutes: number; sunrise: number | null; sunset: number | null; night: boolean; onChange: (m: number) => void }) {
  const rail = useRef<HTMLDivElement>(null), drag = useRef(false);
  const fromEvent = (e: { clientX: number }) => {
    const b = rail.current!.getBoundingClientRect();
    return Math.min(1435, Math.round((Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * 1440) / 5) * 5);
  };
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  return (
    <div className="hm-track" tabIndex={0} role="slider" aria-label={t('sunUi.trackAria')} aria-valuemin={0} aria-valuemax={1435} aria-valuenow={minutes} aria-valuetext={fmtTime(minutes)}
      data-testid="sun-track" data-minutes={minutes}
      onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); onChange(fromEvent(e)); }}
      onPointerMove={(e) => { if (drag.current) onChange(fromEvent(e)); }}
      onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
        if (d) { e.preventDefault(); e.stopPropagation(); onChange(Math.min(1435, Math.max(0, minutes + d * (e.shiftKey ? 60 : 5)))); }
      }}>
      <div className="hm-track-rail" ref={rail} data-testid="sun-track-rail">
        {sunrise !== null && sunset !== null && <i className="hm-track-day" style={{ left: pct(sunrise), width: pct(sunset - sunrise) }} />}
        {[6, 12, 18].map((h) => <span key={h} className="hm-track-h" style={{ left: pct(h * 60) }}>{h}</span>)}
        <b className={`hm-track-knob${night ? ' night' : ''}`} style={{ left: pct(minutes) }} data-testid="sun-track-knob">
          <svg viewBox="-13 -13 26 26" width={26} height={26}>
            {night ? <path d="M3 -6 A6.5 6.5 0 1 0 4 6 A5 5 0 1 1 3 -6Z" /> : <g><circle r={5} />{Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return <line key={i} x1={Math.cos(a) * 7.5} y1={Math.sin(a) * 7.5} x2={Math.cos(a) * 10} y2={Math.sin(a) * 10} />; })}</g>}
          </svg>
        </b>
      </div>
    </div>
  );
}

/** "Time of day" in the Look step: four times of day and the day bar (the dial on a large screen); the date, the sun's position
 *  and the north arrow in advanced mode only (ADR 0038) */
export function TimeOfDay() {
  const mobile = useLayout((s) => s.mobile), advanced = useUi((s) => s.mode === 'advanced');
  const date = useUi((s) => s.sun.date), minutes = useUi((s) => s.sun.minutes);
  const pos = useMemo(() => sunAt(date, minutes), [date, minutes]);
  const times = useMemo(() => sunTimes(date), [date]);
  const presets = useMemo(() => sunPresets(date), [date]);
  const set = (patch: Partial<{ date: string; minutes: number }>) => ui.set((s) => ({ sun: { ...s.sun, ...patch } }));
  const approx = northApproximate();
  const up = pos.elevation > -0.833;
  return (
    <div className="hm-time" data-testid="sun">
      <div className="hm-sun-presets" data-testid="sun-presets">
        {presetLabels().map(([k, label, title]) => (
          <button key={k} type="button" className={`hm-pill${Math.abs(presets[k] - minutes) < 3 ? ' on' : ''}`} onClick={() => set({ minutes: presets[k] })} title={`${title} (${fmtTime(presets[k])})`} data-testid={`sun-${k}`}>{label}</button>
        ))}
      </div>
      {mobile || !advanced
        ? <div className="hm-time-track"><b data-testid="sun-time">{fmtTime(minutes)}</b><SunTrack minutes={minutes} sunrise={times.sunrise} sunset={times.sunset} night={!up} onChange={(m) => set({ minutes: m })} /></div>
        : <SunDial date={date} minutes={minutes} sunrise={times.sunrise} sunset={times.sunset} night={!up} onChange={(m) => set({ minutes: m })} />}
      {advanced && (
        <div className="hm-sun-advanced" data-testid="sun-panel">
          <div className="hm-sun-row">
            <label><span>{t('sunUi.date')}</span><input type="date" value={date} onChange={(e) => { if (e.target.value) set({ date: e.target.value }); }} data-testid="sun-date" /></label>
            <label><span>{t('sunUi.time')}</span><input type="time" step={300} value={fmtTime(minutes).padStart(5, '0')} onChange={(e) => { const m = /^(\d{1,2}):(\d{2})/.exec(e.target.value); if (m) set({ minutes: Number(m[1]) * 60 + Number(m[2]) }); }} data-testid="sun-time-input" /></label>
            <div className="hm-north" title={approx ? t('sunUi.northApproxTitle', { confidence: siteGeo().confidence, deg: siteGeo().uncertaintyDeg }) : t('sunUi.north')}>
              <NorthArrow />
              {approx && <span className="hm-approx" data-testid="north-approx">{t('sunUi.approxNorth')}<small>{t('sunUi.approxNorthSub')}</small></span>}
            </div>
          </div>
          <p className="hm-sun-info" data-testid="sun-info">
            {up ? <>{t('sunUi.sunLabel')} <b>{dirName(pos.azimuth)}</b> ({t('sunUi.azimuth', { deg: comma(pos.azimuth) })}), {t('sunUi.elevation')} <b>{comma(pos.elevation, 1)}°</b></> : <>{t('sunUi.belowHorizon', { deg: comma(pos.elevation, 1) })}</>}
            <br />{t('sunUi.sunriseLabel')} {times.sunrise !== null ? fmtTime(times.sunrise) : '—'} · {t('sunUi.solarNoon')} {fmtTime(times.noon)} · {t('sunUi.sunsetLabel')} {times.sunset !== null ? fmtTime(times.sunset) : '—'} ({zoneLabel(date, minutes)})
          </p>
          <p className="hm-muted hm-sun-geo">{siteGeo().placeName ? `${siteGeo().placeName} ` : ''}{comma(siteGeo().lat, 3)}° N, {comma(siteGeo().lon, 3)}° E · {t('sunUi.buildingAxis', { deg: comma(siteGeo().trueAzimuthX, 1) })}{approx ? ` ${t('sunUi.axisApprox', { deg: siteGeo().uncertaintyDeg })}` : ''}</p>
        </div>
      )}
    </div>
  );
}
