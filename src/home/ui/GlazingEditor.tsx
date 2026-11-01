// The drawing of a gable window in its card, seen from outside: its parts, the partition between them and its bars in the frame
// colour. A bar is dragged to move it (the scene follows at once, the variant gets it when the drag ends — one undo step); a
// horizontal bar across one pane can be dragged into another pane. Below: add a vertical or a horizontal bar, and for the
// picked bar its exact position, whole width / one pane and removing it. A change saves the vertical or the horizontal bars as
// placed ones (model/glazing.ts — fractions of the glazing, so "All" gives every window the same layout).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t as tr } from '../../i18n';
import { BAR_GAP, DOOR_TRANSOM, layoutOf, paneAt, placedOf, type GlazingShape, type Layout, type PlacedRow, type ResolvedChoice } from '../model/glazing';
import { glazingDraft } from '../store/glazingDraft';
import { Seg, Slider } from './controls';

type Pick = { kind: 'col' | 'row'; i: number } | null;
const PAD = 0.12, BAR = 0.06, HIT = 0.3, SNAP = 0.03;

export function GlazingEditor({ g, c, onSave }: { g: GlazingShape; c: ResolvedChoice; onSave: (placed: { cols?: number[]; rows?: PlacedRow[] }, what: string) => void }) {
  const saved = layoutOf(g, c), [draft, setDraft] = useState<Layout | null>(null), [pick, setPick] = useState<Pick>(null);
  const svg = useRef<SVGSVGElement>(null), drag = useRef<{ kind: 'col' | 'row'; i: number; moved: boolean } | null>(null);
  const L = draft ?? saved, W = g.s1 - g.s0, H = g.z1 - g.z0;
  useEffect(() => () => glazingDraft.set({ group: null, layout: null }), []);
  useEffect(() => { setPick(null); }, [g.group]);
  const sel = pick && (pick.kind === 'col' ? pick.i < L.cols.length : pick.i < L.rows.length) ? pick : null;

  // drawing coordinates: x from the left edge as seen from outside, y down from the top
  const X = (a: number) => (g.flip ? g.s1 - a : a - g.s0), Y = (z: number) => g.z1 - z, A = (x: number) => (g.flip ? g.s1 - x : g.s0 + x);
  const preview = (l: Layout | null) => { setDraft(l); glazingDraft.set({ group: l ? g.group : null, layout: l }); };
  // saved, the vertical bars are kept in order: the picked one keeps the pick
  const save = (l: Layout, what: string, picked: Pick = sel) => {
    // only what changed becomes placed bars: moving a vertical bar leaves the quick choice of the horizontal one in force
    const now = placedOf(g, l), was = placedOf(g, saved), same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const patch = { ...(same(now.cols, was.cols) ? {} : { cols: now.cols }), ...(same(now.rows, was.rows) ? {} : { rows: now.rows }) };
    if (Object.keys(patch).length) onSave(patch, what);
    preview(null);
    if (picked?.kind === 'col') { const a = l.cols[picked.i]; setPick({ kind: 'col', i: [...l.cols].sort((x, y) => x - y).indexOf(a) }); } else setPick(picked);
  };
  const clampA = (a: number) => Math.min(g.s1 - BAR_GAP, Math.max(g.s0 + BAR_GAP, a)), clampZ = (z: number) => Math.min(g.z1 - BAR_GAP, Math.max(g.z0 + BAR_GAP, z));
  const snapA = (a: number) => { const m = (g.s0 + g.s1) / 2; return Math.abs(a - m) < SNAP ? m : A(Math.round(X(a) * 100) / 100); };
  const snapZ = (z: number) => { for (const s of [g.floorZ + DOOR_TRANSOM, (g.z0 + g.z1) / 2]) if (Math.abs(z - s) < SNAP) return s; return g.floorZ + Math.round((z - g.floorZ) * 100) / 100; };
  const mid = (r: Layout['rows'][number]) => ((r.s0 ?? g.s0) + (r.s1 ?? g.s1)) / 2;
  // a horizontal bar across one pane keeps to its pane: bounded again by the vertical bars `cols`
  const withCols = (l: Layout, cols: number[]): Layout => ({ cols, rows: l.rows.map((r) => { if (r.s0 === undefined) return r; const [s0, s1] = paneAt(g, cols, mid(r)); return { ...r, s0, s1 }; }) });
  const moveCol = (l: Layout, i: number, a: number) => withCols(l, l.cols.map((x, k) => (k === i ? a : x)));
  const moveRow = (l: Layout, i: number, z: number, a?: number): Layout => ({
    cols: l.cols, rows: l.rows.map((r, k) => { if (k !== i) return r; if (r.s0 === undefined || a === undefined) return { ...r, z }; const [s0, s1] = paneAt(g, l.cols, a); return { z, s0, s1 }; }),
  });

  const at = (e: ReactPointerEvent) => { const m = svg.current!.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return { a: A(p.x), z: g.z1 - p.y }; };
  const down = (kind: 'col' | 'row', i: number) => (e: ReactPointerEvent) => {
    e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { kind, i, moved: false }; setPick({ kind, i });
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = at(e), base = draft ?? saved;
    d.moved = true;
    preview(d.kind === 'col' ? moveCol(base, d.i, snapA(clampA(p.a))) : moveRow(base, d.i, snapZ(clampZ(p.z)), clampA(p.a)));
  };
  const up = () => { const d = drag.current; drag.current = null; if (d?.moved && draft) save(draft, tr('glazing.moved')); };

  // adding: a vertical bar in the middle of the widest pane, a horizontal one across the whole width in the tallest gap
  const addCol = () => {
    const cuts = [g.s0, ...L.cols, ...g.gaps, g.s1].sort((a, b) => a - b);
    let k = 0; for (let i = 1; i + 1 < cuts.length; i++) if (cuts[i + 1] - cuts[i] > cuts[k + 1] - cuts[k]) k = i;
    if (cuts[k + 1] - cuts[k] < 2 * BAR_GAP) return;
    const l = { ...L, cols: [...L.cols, snapA((cuts[k] + cuts[k + 1]) / 2)] };
    save(l, tr('glazing.added'), { kind: 'col', i: l.cols.length - 1 });
  };
  const addRow = () => {
    const zs = [g.z0, ...L.rows.filter((r) => r.s0 === undefined).map((r) => r.z), g.z1].sort((a, b) => a - b);
    let k = 0; for (let i = 1; i + 1 < zs.length; i++) if (zs[i + 1] - zs[i] > zs[k + 1] - zs[k]) k = i;
    if (zs[k + 1] - zs[k] < 2 * BAR_GAP) return;
    const l = { ...L, rows: [...L.rows, { z: snapZ((zs[k] + zs[k + 1]) / 2) }] };
    save(l, tr('glazing.added'), { kind: 'row', i: l.rows.length - 1 });
  };
  const remove = () => {
    if (!sel) return;
    const l = sel.kind === 'col' ? withCols(L, L.cols.filter((_, k) => k !== sel.i)) : { ...L, rows: L.rows.filter((_, k) => k !== sel.i) };
    save(l, tr('glazing.removed'), null);
  };
  // one pane: the widest one (then dragged sideways into another)
  const span = (i: number, whole: boolean) => {
    const cuts = [g.s0, ...L.cols, ...g.gaps, g.s1].sort((a, b) => a - b);
    let k = 0; for (let j = 1; j + 1 < cuts.length; j++) if (cuts[j + 1] - cuts[j] > cuts[k + 1] - cuts[k]) k = j;
    save({ ...L, rows: L.rows.map((x, j) => (j === i ? (whole ? { z: x.z } : { z: x.z, s0: cuts[k], s1: cuts[k + 1] }) : x)) }, tr('glazing.moved'));
  };

  const clip = `gl-clip-${g.group.replace(/[^\w-]/g, '_')}`;
  const bar = (kind: 'col' | 'row', i: number, x1: number, y1: number, x2: number, y2: number) => {
    const on = sel?.kind === kind && sel.i === i;
    return (
      <g key={`${kind}${i}`} data-bar={`${kind}-${i}`}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? 'var(--hm-accent)' : c.color} strokeWidth={on ? BAR * 1.4 : BAR} clipPath={`url(#${clip})`} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={HIT} style={{ cursor: kind === 'col' ? 'ew-resize' : 'ns-resize' }} clipPath={`url(#${clip})`}
          onPointerDown={down(kind, i)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </g>
    );
  };
  const poly = (p: [number, number][]) => p.map(([a, z]) => `${X(a)},${Y(z)}`).join(' ');
  const selRow = sel?.kind === 'row' ? L.rows[sel.i] : null;

  return (
    <div className="hm-glazing-editor" data-testid="window-editor">
      <svg ref={svg} viewBox={`${-PAD} ${-PAD} ${W + 2 * PAD} ${H + 2 * PAD}`} preserveAspectRatio="xMidYMid meet" onPointerDown={() => setPick(null)} data-testid="window-drawing"
        data-cols={L.cols.length} data-rows={L.rows.length}>
        <defs><clipPath id={clip}>{g.parts.map((p) => <polygon key={p.id} points={poly(p.poly)} />)}</clipPath></defs>
        {g.parts.map((p) => <polygon key={p.id} points={poly(p.poly)} className="hm-glazing-glass" stroke={c.color} strokeWidth={BAR * 2} strokeLinejoin="round" clipPath={`url(#${clip})`} />)}
        {L.cols.map((a, i) => bar('col', i, X(a), 0, X(a), H))}
        {L.rows.map((r, i) => { const x0 = X(r.s0 ?? g.s0), x1 = X(r.s1 ?? g.s1); return bar('row', i, Math.min(x0, x1), Y(r.z), Math.max(x0, x1), Y(r.z)); })}
      </svg>
      <div className="hm-glazing-tools">
        <button className="hm-btn" onClick={addCol} data-testid="window-add-col">{tr('glazing.addVertical')}</button>
        <button className="hm-btn" onClick={addRow} data-testid="window-add-row">{tr('glazing.addHorizontal')}</button>
      </div>
      {sel && sel.kind === 'col' && (
        <Slider label={tr('glazing.fromLeft')} value={X(L.cols[sel.i])} min={BAR_GAP} max={W - BAR_GAP} step={0.01} testid="window-bar-pos"
          onPreview={(x) => preview(moveCol(L, sel.i, A(x)))} onCommit={(x) => save(moveCol(L, sel.i, A(x)), tr('glazing.moved'))} />
      )}
      {selRow && sel && (
        <>
          <Slider label={tr('glazing.aboveFloor')} value={selRow.z - g.floorZ} min={g.z0 - g.floorZ + BAR_GAP} max={g.z1 - g.floorZ - BAR_GAP} step={0.01} testid="window-bar-pos"
            onPreview={(h) => preview(moveRow(L, sel.i, g.floorZ + h))} onCommit={(h) => save(moveRow(L, sel.i, g.floorZ + h), tr('glazing.moved'))} />
          <Seg wide value={selRow.s0 === undefined ? 'whole' : 'pane'} options={[['whole', tr('glazing.wholeWidth')], ['pane', tr('glazing.onePane')]]} onChange={(x) => span(sel.i, x === 'whole')} testid="window-bar-span" />
        </>
      )}
      {sel && <button className="hm-btn wide" onClick={remove} data-testid="window-bar-remove">{tr('glazing.remove')}</button>}
      <p className="hm-hint">{tr(sel ? 'glazing.hintPicked' : 'glazing.hint')}</p>
    </div>
  );
}
