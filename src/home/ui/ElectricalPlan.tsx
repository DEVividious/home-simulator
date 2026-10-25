// The PLAN as a first-class view of the ELECTRICAL mode (inside the scene area, not a separate window): clear walls, doors,
// furniture as a light background, device symbols, room names (tap = FOCUS ON ROOM). The same vector drawing as in the PDF
// (plan/elPlan.ts). Gestures: one finger on the background pans the plan; two fingers / wheel zoom; pressing a device and
// moving DRAGS it between walls and rooms (the plan stays put — dragging takes precedence; the device keeps a fixed grip
// relative to the pointer); in placement mode the finger leads a preview offset ABOVE the finger. The location is computed by
// model/elPlacement.ts, the motion by store/elPlace.ts (transient state): pointer moves re-render only <PlaceOverlay>, not the whole plan.
import { useEffect, useMemo, useRef, useState } from 'react';
import { elFocusRoom } from '../actions';
import { DEVICES } from '../model/devices';
import { EL_LAYER_IDS, measure, type ElPoint } from '../model/electrical';
import { surfaceFromDrag, surfaceFromPlan, type PlanViewId } from '../model/elPlacement';
import { allRooms } from '../model/rooms';
import type { LevelId, Vec2 } from '../model/types';
import { buildPlan, shiftIntoView, symbolPrims, viewBounds, type Prim } from '../plan/elPlan';
import { furnitureOutlines } from '../plan/planData';
import { HIT_PX, planAim } from '../scene/electricalInput';
import { useDesign } from '../store/design';
import { beginMove, cancelPlace, commitPlace, currentWall, placeAt, placeNow, setPlaceDragging, usePlace } from '../store/elPlace';
import { useLayout } from '../store/layout';
import { ui, useUi } from '../store/ui';
import { useElPlan } from './ElectricalPanels';
import { Icon } from './icons';
import { t } from '../../i18n';

/** plan primitives → SVG (Y flipped: the plan has Y pointing up) */
export function PlanPrims({ prims }: { prims: Prim[] }) {
  return (
    <>
      {prims.map((p, i) => {
        if (p.k === 'circle') return <circle key={i} cx={p.c[0]} cy={-p.c[1]} r={p.r} fill={p.fill ?? 'none'} stroke={p.stroke ?? 'none'} strokeWidth={p.lw ?? 0} />;
        if (p.k === 'text') return <text key={i} x={p.at[0]} y={-p.at[1]} fontSize={p.size} textAnchor={p.anchor ?? 'start'} fill={p.color ?? '#111'} fontWeight={p.bold ? 700 : 400} className={p.halo ? 'halo' : undefined} style={p.halo ? { strokeWidth: p.size * 0.28 } : undefined}>{p.text}</text>;
        const d = p.pts.map((q) => `${q[0].toFixed(4)},${(-q[1]).toFixed(4)}`).join(' ');
        return p.close ? <polygon key={i} points={d} fill={p.fill ?? 'none'} stroke={p.stroke ?? 'none'} strokeWidth={p.lw ?? 0} strokeDasharray={p.dash?.join(' ')} strokeLinejoin="round" />
          : <polyline key={i} points={d} fill="none" stroke={p.stroke ?? 'none'} strokeWidth={p.lw ?? 0} strokeDasharray={p.dash?.join(' ')} strokeLinecap="round" strokeLinejoin="round" />;
      })}
    </>
  );
}

const LEVEL_COLOR = { ok: '#0d6efd', warn: '#e08a00', error: '#d43c2f' } as const;
export const planPerf = { stage: 0, overlay: 0, builds: 0 };
/** scale denominator rounded to steps of ×1.12 — the drawing is not rebuilt on every pixel of zooming */
const quant = (den: number) => 10 * 1.12 ** Math.round(Math.log(den / 10) / Math.log(1.12));

/**
 * Preview from the transient state (model): highlighted wall, dimension from the corner, alignment lines, the symbol at the
 * current location (colour = location rating), crosshair above the finger. Only this re-renders while the pointer moves.
 */
function PlaceOverlay({ den, view }: { den: number; view: PlanViewId }) {
  const s = usePlace((x) => x);
  planPerf.overlay++;
  if (!s?.at) return null;
  const mm = (v: number) => (v * den) / 1000, at = s.at, lv = s.live ? s.check.level : 'error', color = LEVEL_COLOR[lv];
  const m = measure({ ...at, type: s.type } as ElPoint);
  if (!m || (view !== 'SITE' && m.room.level !== view && !m.room.exterior)) return null;
  const sym = symbolPrims({ ...at, id: '', type: s.type, modules: ({ 'socket-2': 2, 'socket-3': 3 } as Record<string, number>)[s.type] ?? 1, label: '', smartHome: 'none', source: 'user', status: 'planned' } as ElPoint, [m.pos[0], m.pos[1]], m.normal, mm(4.2), mm(0.42), color);
  const info = s.info, P = (q: Vec2) => `${q[0]},${-q[1]}`;
  const guide = s.guides.find((g) => g.kind === 'along'), run = info?.run;
  let gl: [Vec2, Vec2] | null = null;
  if (guide && run && m.run) { const b = m.run.b, d = m.run.dir, n = m.run.inward, c: Vec2 = [b[0] - d[0] * guide.value, b[1] - d[1] * guide.value]; gl = [c, [c[0] + n[0] * mm(14), c[1] + n[1] * mm(14)]]; }
  return (
    <g className="hm-elstage-place" data-testid="el-place-overlay" data-level={lv} data-room={at.roomId} data-wall={at.wallId ?? ''} pointerEvents="none">
      {run && <polyline points={`${P(run[0])} ${P(run[1])}`} stroke={color} strokeOpacity={0.35} strokeWidth={mm(1.6)} strokeLinecap="round" fill="none" data-testid="el-active-wall" />}
      {info?.dim && m.run && (() => { const n = m.run.inward, o = mm(1.6), a: Vec2 = [info.dim![0][0] + n[0] * o, info.dim![0][1] + n[1] * o], b: Vec2 = [info.dim![1][0] + n[0] * o, info.dim![1][1] + n[1] * o]; return <polyline points={`${P(a)} ${P(b)}`} stroke={color} strokeWidth={mm(0.3)} strokeDasharray={`${mm(1)} ${mm(0.8)}`} fill="none" />; })()}
      {gl && <polyline points={`${P(gl[0])} ${P(gl[1])}`} stroke="#0d6efd" strokeWidth={mm(0.3)} fill="none" data-testid="el-guide-along" />}
      <circle cx={sym.center[0]} cy={-sym.center[1]} r={sym.r * 1.7} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={mm(0.3)} />
      <PlanPrims prims={sym.prims} />
      {s.touch && s.dragging && <g stroke={color} strokeWidth={mm(0.25)}><line x1={m.pos[0] - mm(3)} y1={-m.pos[1]} x2={m.pos[0] + mm(3)} y2={-m.pos[1]} /><line x1={m.pos[0]} y1={-m.pos[1] - mm(3)} x2={m.pos[0]} y2={-m.pos[1] + mm(3)} /></g>}
    </g>
  );
}

type Gesture =
  | { kind: 'pan'; start: [number, number]; c0: Vec2; moved: boolean; room: string | null }
  /** grab — grip vector [px]: symbol centre − press location (the pointer holds the symbol where it grabbed it);
   *  off — offset of the symbol from the mounting point on the wall [m] (the symbol is drawn inside the room; ceiling: 0) */
  | { kind: 'device'; id: string; start: [number, number]; moved: boolean; touch: boolean; grab: [number, number]; off: number }
  | { kind: 'ghost'; start: [number, number]; moved: number; touch: boolean }
  | { kind: 'pinch'; d0: number; z0: number; mid: Vec2 };
/** minimum distance of the selected device from the edge of the plan area on a phone [px] (symbol with its ring fully visible) */
const KEEP_PX = 32;

export function ElPlanStage() {
  const plan = useElPlan(), level = useUi((s) => s.level), site = useUi((s) => s.elSite), layersOn = useUi((s) => s.elLayers), furnitureOn = useUi((s) => s.elPlanFurniture), labels = useUi((s) => s.elLabels);
  const roomId = useUi((s) => s.roomId), sel = useUi((s) => (s.selection?.kind === 'electrical' ? s.selection.id : null));
  const placing = usePlace((s) => !!s), moving = usePlace((s) => (s && (s.mode === 'move' || s.mode === 'height') ? s.id : null));
  const rev = useDesign((s) => s.rev), coarse = useLayout((s) => s.coarse), mobile = useLayout((s) => s.mobile);
  const view: PlanViewId = site ? 'SITE' : level;
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<Vec2 | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<[number, number]>([800, 600]);
  planPerf.stage++;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width > 10 && r.height > 10) setBox([r.width, r.height]); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const layers = useMemo(() => EL_LAYER_IDS.filter((l) => layersOn[l]), [layersOn]);
  const base = useMemo(() => viewBounds(view, []), [view]);
  // FOCUS ON ROOM / WHOLE BUILDING: frame from the room outline (with a margin) or the whole plan
  useEffect(() => {
    const r = allRooms().find((x) => x.id === roomId);
    if (!r || site || r.level !== level) { setZoom(1); setCenter(null); return; }
    const bw = base[2] - base[0], bh = base[3] - base[1], ar = box[0] / box[1], w = Math.max(bw, bh * ar), h = w / ar;
    const rw = r.bbox[2] - r.bbox[0] + 1.4, rh = r.bbox[3] - r.bbox[1] + 1.4;
    setZoom(Math.max(1, Math.min(10, Math.min(w / rw, h / rh))));
    setCenter([(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2]);
  }, [roomId, site, level, base]); // eslint-disable-line react-hooks/exhaustive-deps
  // view area: fixed per level (does not jump when points are added), fitted to the screen aspect ratio, with zoom;
  // c — frame centre chosen by the user (focused room, pan, zoom)
  const frame = useMemo(() => {
    const bw = base[2] - base[0], bh = base[3] - base[1], ar = box[0] / box[1];
    let w = bw, h = bh;
    if (w / h < ar) w = h * ar; else h = w / ar;
    return { w: w / zoom, h: h / zoom, c: center ?? ([(base[0] + base[2]) / 2, (base[1] + base[3]) / 2] as Vec2) };
  }, [base, box, zoom, center]);
  // "paper" sizes of symbols: about 5 px per mm of paper (symbol about 21 px), independent of zoom
  const den = useMemo(() => quant(Math.max(10, Math.min(1500, (frame.w * 1000) / Math.max(60, box[0] / 5)))), [frame.w, box]);
  const furniture = useMemo(() => (furnitureOn && view !== 'SITE' ? furnitureOutlines(view as LevelId) : undefined), [furnitureOn, view, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  // fewer labels when zoomed out: full labels only up close, ids disappear in a whole-level view with many points
  const shownLabels = labels === 'full' && den > 130 ? 'id' : labels !== 'none' && den > 230 && plan.points.length > 25 ? 'none' : labels;
  const drawing = useMemo(() => { planPerf.builds++; return buildPlan({ view, plan, layers, den, furniture, labels: shownLabels, roomNames: false, allExterior: true }); }, [view, plan, layers, den, furniture, shownLabels]);
  const rooms = useMemo(() => (view === 'SITE' ? [] : allRooms().filter((r) => r.level === view)), [view]);
  const px = frame.w / box[0];                                                 // model metres per screen pixel
  const selPt = sel ? drawing.points.find((p) => p.id === sel) : null;
  // Phone: the selected device's card takes part of the plan area (portrait — the bottom, landscape — the right side). WHILE
  // SELECTED the frame is shifted only as much as needed to keep the device in the smaller area; `center` stays, so after the card
  // closes the plan returns to the frame from before the selection (writing the shift into `center` would leave half of the
  // focused room off-screen, and in landscape would shift the plan vertically although the card sits beside it). Computed when
  // the selection or the area size changes — not when the device or the frame moves: the plan does not run away from the finger.
  const lift = useMemo<Vec2>(() => {
    if (!mobile || !selPt) return [0, 0];
    const sx = ((selPt.center[0] - (frame.c[0] - frame.w / 2)) / frame.w) * box[0], sy = ((frame.c[1] + frame.h / 2 - selPt.center[1]) / frame.h) * box[1];
    return [shiftIntoView(sx, box[0], KEEP_PX, KEEP_PX) * px, -shiftIntoView(sy, box[1], KEEP_PX, KEEP_PX) * px];
  }, [sel, mobile, box]); // eslint-disable-line react-hooks/exhaustive-deps
  const vb = { x0: frame.c[0] + lift[0] - frame.w / 2, y0: frame.c[1] + lift[1] - frame.h / 2, w: frame.w, h: frame.h };

  const toModel = (x: number, y: number): Vec2 | null => {
    const el = svg.current, m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return [p.x, -p.y];
  };
  const g = useRef<Gesture | null>(null), pts = useRef(new Map<number, [number, number]>());
  /**
   * Location under the aim point (x, y) [px]; tip — where the dimension badge goes (by default at the aim point).
   * hold — an EXISTING device being dragged: the pointer holds the symbol offset `hold` metres from the wall (surfaceFromDrag);
   * without hold — picking a location (new device, copy, "Move"): the location exactly under the aim point.
   */
  const aim = (x: number, y: number, alt: boolean, tip: [number, number] = [x, y], hold: number | null = null) => {
    const s = placeNow(), q = toModel(x, y);
    if (!s) return;
    const surface = !q ? null : hold === null ? surfaceFromPlan(view, q, s.type, currentWall()) : surfaceFromDrag(view, q, s.type, currentWall(), hold);
    // site plan: a ceiling device / ground point can only be placed outside the building
    placeAt(surface, tip, alt, view === 'SITE' && DEVICES[s.type].mountType !== 'WALL' ? t('planUi.pickOutsideBuilding') : undefined);
  };
  /** device grip: vector from the press location to the symbol centre [px] and the symbol offset from the mounting point [m] */
  const grabOf = (id: string, at: [number, number]): { grab: [number, number]; off: number } => {
    const p = drawing.points.find((x) => x.id === id), m = svg.current?.getScreenCTM();
    if (!p || !m) return { grab: [0, 0], off: 0 };
    const c = new DOMPoint(p.center[0], -p.center[1]).matrixTransform(m);
    return { grab: [c.x - at[0], c.y - at[1]], off: Math.hypot(p.center[0] - p.at[0], p.center[1] - p.at[1]) };
  };
  /** the device nearest to the screen point within the hit radius (finger 24 px, mouse 16 px) — not the "topmost" one */
  const deviceAt = (x: number, y: number, touch: boolean): string | null => {
    const q = toModel(x, y);
    if (!q) return null;
    let best: string | null = null, bd = Infinity;
    for (const p of drawing.points) { const d = Math.hypot(p.center[0] - q[0], p.center[1] - q[1]); if (d < bd && d <= Math.max(p.r * 1.3, (touch ? HIT_PX.touch : HIT_PX.mouse) * px)) { bd = d; best = p.id; } }
    return best;
  };
  const zoomTo = (z: number, at?: Vec2) => {
    const nz = Math.max(1, Math.min(14, z));
    if (at && nz !== zoom) { const c: Vec2 = [vb.x0 + vb.w / 2, vb.y0 + vb.h / 2], f = zoom / nz; setCenter([at[0] + (c[0] - at[0]) * f - lift[0], at[1] + (c[1] - at[1]) * f - lift[1]]); }
    if (nz === 1 && !roomId) setCenter(null);
    setZoom(nz);
  };
  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    const touch = e.pointerType !== 'mouse', start: [number, number] = [e.clientX, e.clientY];
    if (pts.current.size === 2) {
      // second finger: pinch (zoom) — an interrupted drag returns to the state before the move
      const cur = g.current;
      if (cur?.kind === 'device' && cur.moved) cancelPlace();
      if (cur?.kind === 'ghost') setPlaceDragging(false);
      const [a, b] = [...pts.current.values()], mid = toModel((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      g.current = mid ? { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: zoom, mid } : null;
      return;
    }
    if (e.button !== 0) return;
    const s = placeNow(), id = s ? null : deviceAt(e.clientX, e.clientY, touch);
    if (s) { g.current = { kind: 'ghost', start, moved: 0, touch }; setPlaceDragging(true, touch); aim(e.clientX, e.clientY, e.altKey); }
    else if (id) g.current = { kind: 'device', id, start, moved: false, touch, ...grabOf(id, start) };
    else g.current = { kind: 'pan', start, c0: frame.c, moved: false, room: (e.target as Element).closest?.('[data-room]')?.getAttribute('data-room') ?? null };
  };
  const move = (e: React.PointerEvent) => {
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    const cur = g.current;
    if (!cur) { if (e.pointerType === 'mouse' && !e.buttons) { if (placeNow()) aim(e.clientX, e.clientY, e.altKey); else (e.currentTarget as SVGSVGElement).style.cursor = deviceAt(e.clientX, e.clientY, false) ? 'grab' : ''; } return; }
    if (cur.kind === 'pinch') {
      if (pts.current.size < 2) return;
      const [a, b] = [...pts.current.values()];
      zoomTo(cur.z0 * (Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, cur.d0)), cur.mid);
      return;
    }
    const moved = Math.hypot(e.clientX - cur.start[0], e.clientY - cur.start[1]);
    if (cur.kind === 'pan') {
      if (!cur.moved && moved < 6) return;
      cur.moved = true;
      setCenter([cur.c0[0] - (e.clientX - cur.start[0]) * px, cur.c0[1] + (e.clientY - cur.start[1]) * px]);
    } else if (cur.kind === 'device') {
      if (!cur.moved) { if (moved < (cur.touch ? 8 : 4)) return; cur.moved = true; beginMove(cur.id, { dragging: true, touch: cur.touch }); }
      // existing device: fixed grip (the pointer holds the symbol), no lift above the finger; on a phone the dimension badge
      // is always above the finger (so the finger does not cover it)
      const a = planAim([e.clientX, e.clientY], cur);
      aim(a[0], a[1], e.altKey, cur.touch ? [a[0], Math.min(a[1], e.clientY - 28)] : a, cur.off);
    } else { cur.moved = Math.max(cur.moved, moved); const a = planAim([e.clientX, e.clientY], cur); aim(a[0], a[1], e.altKey); }
  };
  const up = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    const cur = g.current;
    if (cur?.kind === 'pinch') { if (pts.current.size < 2) g.current = null; return; }
    g.current = null;
    if (!cur) return;
    if (cur.kind === 'device') {
      if (cur.moved) commitPlace();
      else { const s = ui.get(); ui.set(s.selection?.kind === 'electrical' && s.selection.id === cur.id ? { elMore: !s.elMore } : { selection: { kind: 'electrical', id: cur.id }, elMore: false }); }
    } else if (cur.kind === 'ghost') commitPlace();
    else if (!cur.moved) {
      // background tap: with a selection — deselect; without — the tapped room becomes the working room (FOCUS ON ROOM)
      if (ui.get().selection) ui.set({ selection: null, elMore: false });
      else if (cur.room && cur.room !== ui.get().roomId) elFocusRoom(cur.room);
    }
  };
  const cancel = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); const cur = g.current; g.current = null; if (cur?.kind === 'device' && cur.moved) cancelPlace(); if (cur?.kind === 'ghost') setPlaceDragging(false); };
  const hitR = (r: number) => Math.max(r * 1.5, (coarse ? HIT_PX.touch : HIT_PX.mouse) * px);
  return (
    <div className="hm-elstage" data-testid="el-stage" data-view={view} data-zoom={zoom.toFixed(2)}>
      <svg ref={svg} className={`hm-elstage-svg${placing ? ' placing' : ''}`} viewBox={`${vb.x0} ${-(vb.y0 + vb.h)} ${vb.w} ${vb.h}`} data-testid="el-plan-svg" data-view={view} data-den={Math.round(den)}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={() => { const s = placeNow(); if (s && !s.dragging && s.mode !== 'move' && !g.current) placeAt(null, null); }}
        onWheel={(e) => { const q = toModel(e.clientX, e.clientY); zoomTo(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), q ?? undefined); }}>
        <rect x={vb.x0} y={-(vb.y0 + vb.h)} width={vb.w} height={vb.h} fill="#f3f4f1" />
        <PlanPrims prims={drawing.prims} />
        <g data-testid="el-plan-rooms">
          {rooms.map((r) => {
            // the name fits inside the room (shrunk down to 9 px) or disappears — the room stays tappable anyway (FOCUS ON ROOM)
            const name = r.label, on = r.id === roomId, fit = (r.bbox[2] - r.bbox[0] - 0.25) / (name.length * 0.58), size = Math.min(13.5 * px, fit), show = size >= 9 * px;
            return (
              <g key={r.id} className={`hm-elstage-room${on ? ' on' : ''}`} data-room={r.id} data-testid={`el-room-${r.id}`}>
                <polygon points={r.polygon.map((q) => `${q[0]},${-q[1]}`).join(' ')} />
                {show && <text x={r.center[0]} y={-r.center[1] + size * 0.36} fontSize={size} textAnchor="middle">{name}</text>}
              </g>
            );
          })}
        </g>
        <g data-testid="el-plan-symbols">
          {drawing.points.map((pt) => (
            <g key={pt.id} className={`hm-el-sym${sel === pt.id ? ' on' : ''}${moving === pt.id ? ' moving' : ''}`} data-el-id={pt.id} data-testid={`el-sym-${pt.id}`} data-type={pt.type}>
              <PlanPrims prims={drawing.symbols.filter((s) => s.id === pt.id)} />
              <circle cx={pt.center[0]} cy={-pt.center[1]} r={hitR(pt.r)} className="hit" />
            </g>
          ))}
          <PlanPrims prims={drawing.symbols.filter((s) => !s.id)} />
        </g>
        {selPt && moving !== selPt.id && <circle cx={selPt.center[0]} cy={-selPt.center[1]} r={selPt.r * 1.75} className="hm-elstage-sel" strokeWidth={(den * 0.45) / 1000} data-testid="el-sel-ring" />}
        <PlaceOverlay den={den} view={view} />
      </svg>
      <div className="hm-elstage-zoom">
        <button className="hm-icon-btn" onClick={() => zoomTo(zoom * 1.4)} aria-label={t('planUi.zoomIn')} data-testid="el-zoom-in"><Icon name="plus" /></button>
        <button className="hm-icon-btn" onClick={() => zoomTo(zoom / 1.4)} aria-label={t('planUi.zoomOut')} data-testid="el-zoom-out"><Icon name="minus" /></button>
        <button className="hm-icon-btn" onClick={() => { if (roomId) elFocusRoom(null); setZoom(1); setCenter(null); }} aria-label={t('planUi.fitAll')} title={t('planUi.fitAll')} data-testid="el-zoom-fit"><Icon name="fit" /></button>
      </div>
    </div>
  );
}
