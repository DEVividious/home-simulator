// UI of the ELECTRICAL mode. Interaction model: PICK A DEVICE → PLACE IT ON A WALL → DRAG IT WHERE YOU WANT → DONE.
// The user never sees wall ids, coordinates or technical names.
//  • <ElWorkspace> (in the scene area): toolbar (+ Add · Layers · Snapping · Undo · Redo · Export), level / room and view
//    choice (Plan | 3D | eye level), device catalogue, layers, export, placement bar ("Add multiple" series), dimension
//    badge at the pointer, short tips on first entry, empty-room state;
//  • <ElCard>: card of the selected device — name, height [−] 30 cm [+], quick heights, Move / Duplicate / Delete,
//    "More" (type, description, smart home, circuit, notes). Desktop: right panel; phone: bottom card instead of the toolbar;
//  • <SectionElectrical>: left panel on desktop (rooms, device list, notes).
// Plan: ui/ElectricalPlan.tsx. Motion state: store/elPlace.ts. Catalogue: model/devices.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addElectrical, elFocusRoom, goSection, patchElectrical, planNow, removeElectrical, selectElectrical, setElectricalScope, setElHeight, setElLevel, setElView } from '../actions';
import { DEVICE_CATEGORIES, DEVICES, devicesIn, type DeviceDef } from '../model/devices';
import {
  BOARD_KINDS, byId, EL_LAYER_IDS, EL_LAYERS, EL_LIMITS, EL_STATUS, elRoom, layerOf, measure, parseHeightCm, PDF_GROUPS, pointShown, pointWarnings, PURPOSES, resolvePlan, retype, SMART_MODES,
  type BoardKind, type ElectricalPlan, type ElLayer, type ElPoint, type ElStatus, type ElType, type SmartMode,
} from '../model/electrical';
import { roomById } from '../model/rooms';
import { planViewName, planViews } from '../plan/elPlan';
import type { LevelId } from '../model/types';
import { extrasOf } from '../model/variantData';
import { exportElectricalCsv, exportElectricalJson, exportElectricalPdf } from '../pdf/exportElectrical';
import { replacedText } from '../pdf/pdfText';
import type { PdfGroup } from '../pdf/electricalPdf';
import { coordContext } from '../plan/planData';
import { cancelPreview, docOf, useDesign, variantOf } from '../store/design';
import { beginCopy, beginMove, beginNew, cancelPlace, setPlaceMulti, usePlace, usePlaceNote } from '../store/elPlace';
import { useLayout } from '../store/layout';
import { ui, useUi, type ElView } from '../store/ui';
import { Block, Seg, Slider, Toggle } from './controls';
import { ElPlanStage } from './ElectricalPlan';
import { CardShell, TechnicalData } from './Card';
import { LevelPlan } from './FloorPlan';
import { Icon } from './icons';
import { fmtNum, t } from '../../i18n';

export const useElPlan = (): ElectricalPlan => {
  const d = useDesign((s) => docOf(s).electrical), v = useDesign((s) => extrasOf(variantOf(s)).electrical);
  return useMemo(() => resolvePlan(d, v), [d, v]);
};
const cm = (v: number) => Math.round(v * 100);
const m2 = (v: number) => fmtNum(v, 2);
const roomName = (id: string) => { const r = roomById(id); return r ? r.label : id === 'EXT' ? t('electricalUi.outside') : id; };
const isWalking = (s: { houseView: string; roomId: string | null; roomView: string }) => (s.houseView === 'walk' && !s.roomId) || (!!s.roomId && s.roomView === 'walk');
/** default device of the "add the first socket" button */
const FIRST: ElType = 'socket-2';

// ------------------------------------------------------------------ layers, snapping, export
/** layer visibility; hiding the layer of the SELECTED device clears the selection — the card and Delete must not act on a
 *  device that is not visible */
export const setElLayers = (next: Record<ElLayer, boolean>) => ui.set((s) => ({ elLayers: next, ...(s.selection?.kind === 'electrical' && !pointShown(planNow(), s.selection.id, next) ? { selection: null, elMore: false } : {}) }));
export function LayerToggles() {
  const layers = useUi((s) => s.elLayers), all = EL_LAYER_IDS.every((l) => layers[l]), none = EL_LAYER_IDS.every((l) => !layers[l]);
  const set = (l: ElLayer, on: boolean) => setElLayers({ ...ui.get().elLayers, [l]: on });
  const setAll = (on: boolean) => setElLayers(Object.fromEntries(EL_LAYER_IDS.map((l) => [l, on])) as Record<ElLayer, boolean>);
  return (
    <div className="hm-el-layers" data-testid="el-layers">
      {EL_LAYER_IDS.map((l) => (
        <button key={l} className={`hm-el-chip${layers[l] ? ' on' : ''}`} style={{ '--c': EL_LAYERS[l].color } as React.CSSProperties} aria-pressed={layers[l]} onClick={() => set(l, !layers[l])} data-testid={`el-layer-${l}`}><i />{EL_LAYERS[l].name}</button>
      ))}
      <button className="hm-el-chip plain" onClick={() => setAll(none || !all ? true : false)} data-testid="el-layers-all">{all ? t('electricalUi.hideAll') : t('electricalUi.showAll')}</button>
    </div>
  );
}
const snaps = (): [number, string][] => [[0, t('electricalUi.snapOff')], [0.01, '1 cm'], [0.05, '5 cm'], [0.1, '10 cm']];
export function SnapSeg() {
  const snap = useUi((s) => s.elSnap);
  return <Seg value={snap} options={snaps()} onChange={(v) => ui.set({ elSnap: v })} testid="el-snap" />;
}

export function ElExport() {
  const [format, setFormat] = useState<'a4' | 'a3'>('a4');
  const [groups, setGroups] = useState<PdfGroup[]>(['all']);
  const [furniture, setFurniture] = useState(false);
  const [busy, setBusy] = useState(false);
  // label characters missing from the print font: the notice stays under the button (the post-export toast disappears after a moment)
  const [replaced, setReplaced] = useState('');
  const toggle = (g: PdfGroup) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  const order: PdfGroup[] = ['power', 'lighting', 'data', 'smart', 'all'];
  const run = async () => { setBusy(true); const r = await exportElectricalPdf({ format, groups: order.filter((g) => groups.includes(g)), furniture }); setReplaced(r ? replacedText(r.replaced) : ''); setBusy(false); };
  return (
    <div className="hm-el-export" data-testid="el-export">
      <button className="hm-btn primary wide" disabled={busy || !groups.length} onClick={() => void run()} data-testid="el-export-pdf"><Icon name="download" size={16} /> {busy ? t('electricalUi.creatingPdf') : t('electricalUi.downloadPdf')}</button>
      {replaced && <div className="hm-el-warn" data-testid="el-export-replaced">{replaced}</div>}
      <label className="hm-field"><span>{t('electricalUi.pdfFormat')}</span><Seg value={format} options={[['a4', 'A4'], ['a3', 'A3']]} onChange={setFormat} testid="el-pdf-format" /></label>
      <label className="hm-field"><span>{t('electricalUi.pdfPages')}</span>
        <div className="hm-el-chips" data-testid="el-pdf-groups">
          {order.map((g) => <button key={g} className={`hm-el-chip plain${groups.includes(g) ? ' on' : ''}`} aria-pressed={groups.includes(g)} onClick={() => toggle(g)} data-testid={`el-pdf-group-${g}`}>{PDF_GROUPS[g].name}</button>)}
        </div></label>
      <Toggle on={furniture} label={t('electricalUi.furnitureBackground')} onChange={setFurniture} testid="el-pdf-furniture" />
      <div className="hm-btn-row">
        <button className="hm-btn" onClick={() => exportElectricalJson()} data-testid="el-export-json"><Icon name="download" size={14} /> {t('electricalUi.exportJson')}</button>
        <button className="hm-btn" onClick={() => exportElectricalCsv()} data-testid="el-export-csv"><Icon name="download" size={14} /> {t('electricalUi.exportCsv')}</button>
      </div>
      <p className="hm-muted">{t('electricalUi.exportNote')}</p>
    </div>
  );
}

// ------------------------------------------------------------------ device catalogue (+ ADD)
function Catalog() {
  const multi = useUi((s) => s.elMulti);
  return (
    <div className="hm-el-catalog" data-testid="el-catalog">
      {DEVICE_CATEGORIES.map((c) => (
        <section key={c.id} data-testid={`el-cat-${c.id}`}>
          <h4><Icon name={c.icon} size={15} /> {c.name}</h4>
          <div className="hm-el-tiles">
            {devicesIn(c.id).map((d) => (
              <button key={d.id} className="hm-el-tile" onClick={() => beginNew(d.id)} data-testid={`el-device-${d.id}`}>
                <span className="hm-el-tile-ico" style={{ color: EL_LAYERS[layerOf(d.id)].color }}><Icon name={d.icon} size={22} /></span>
                <span>{d.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="hm-el-catalog-foot"><Toggle on={multi} label={t('electricalUi.addMultiple')} hint={t('electricalUi.addMultipleHint')} onChange={setPlaceMulti} testid="el-multi" /></div>
    </div>
  );
}

/** toolbar pop-up panel: desktop — a small window by the toolbar; phone — a bottom sheet */
function Panel({ title, children, testid }: { title: string; children: ReactNode; testid: string }) {
  const close = () => ui.set({ elPanel: null });
  return (
    <>
      <div className="hm-el-scrim" onClick={close} data-testid="el-panel-scrim" />
      <div className="hm-el-panel" role="dialog" aria-label={title} data-testid={testid}>
        <header><b>{title}</b><button className="hm-icon-btn" onClick={close} aria-label={t('electricalUi.close')} data-testid="el-panel-close"><Icon name="close" /></button></header>
        <div className="hm-el-panel-body">{children}</div>
      </div>
    </>
  );
}
function Panels() {
  const panel = useUi((s) => s.elPanel), labels = useUi((s) => s.elLabels), furniture = useUi((s) => s.elPlanFurniture);
  const scope = useDesign((s) => (extrasOf(variantOf(s)).electrical ? 'variant' : 'global')), variantName = useDesign((s) => variantOf(s).name);
  const [more, setMore] = useState(false);
  if (panel === 'catalog') return <Panel title={t('electricalUi.addDevice')} testid="el-panel-catalog"><Catalog /></Panel>;
  if (panel === 'layers') return (
    <Panel title={t('electricalUi.layers')} testid="el-panel-layers">
      <LayerToggles />
      <label className="hm-field"><span>{t('electricalUi.planLabels')}</span><Seg wide value={labels} options={[['none', t('electricalUi.labelsNone')], ['id', t('electricalUi.labelsId')], ['full', t('electricalUi.labelsFull')]]} onChange={(v) => ui.set({ elLabels: v })} testid="el-labels" /></label>
      <Toggle on={furniture} label={t('electricalUi.furnitureBackground')} onChange={(v) => ui.set({ elPlanFurniture: v })} testid="el-plan-furniture" />
      <label className="hm-field"><span>{t('electricalUi.snapWhileMoving')}</span><SnapSeg /></label>
    </Panel>
  );
  if (panel === 'export') return (
    <Panel title={t('electricalUi.export')} testid="el-panel-export">
      <ElExport />
      <button className="hm-link" onClick={() => setMore((v) => !v)} data-testid="el-export-more">{more ? t('electricalUi.less') : t('electricalUi.moreSettings')}</button>
      {more && <div className="hm-el-export" data-testid="el-scope">
        <label className="hm-field"><span>{t('electricalUi.planScope')}</span><Seg wide value={scope} options={[['global', t('electricalUi.scopeGlobal')], ['variant', t('electricalUi.scopeVariant')]]} onChange={setElectricalScope} testid="el-scope-seg" /></label>
        <p className="hm-muted">{scope === 'global' ? t('electricalUi.scopeGlobalNote') : t('electricalUi.scopeVariantNote', { name: variantName })}</p>
        <button className="hm-btn wide" onClick={() => { const n = proposeKitchenPoints(); ui.set((u) => ({ elPanel: null, toast: { text: n ? t('electricalUi.kitchenAdded', { n }) : t('electricalUi.kitchenAlready'), level: 'info', n: (u.toast?.n ?? 0) + 1 } })); }} data-testid="el-kitchen-propose">{t('electricalUi.kitchenPropose')}</button>
      </div>}
    </Panel>
  );
  return null;
}

// ------------------------------------------------------------------ toolbar / placement bar
function Toolbar() {
  // undo / redo are in the top bar and snapping in Layers — one place each (ADR 0037)
  const panel = useUi((s) => s.elPanel);
  const open = (p: 'catalog' | 'layers' | 'export') => ui.set((s) => ({ elPanel: s.elPanel === p ? null : p }));
  return (
    <div className="hm-el-toolbar" data-testid="el-toolbar" role="toolbar" aria-label={t('electricalUi.toolbar')}>
      <button className={`hm-el-add${panel === 'catalog' ? ' on' : ''}`} onClick={() => open('catalog')} data-testid="el-add"><Icon name="plus" size={20} /><span>{t('electricalUi.add')}</span></button>
      <button className={`hm-el-tb${panel === 'layers' ? ' on' : ''}`} onClick={() => open('layers')} data-testid="el-tb-layers"><Icon name="layers" size={20} /><span>{t('electricalUi.layers')}</span></button>
      <button className={`hm-el-tb${panel === 'export' ? ' on' : ''}`} onClick={() => open('export')} data-testid="el-tb-export"><Icon name="download" size={20} /><span>{t('electricalUi.export')}</span></button>
    </div>
  );
}
/** placement-mode bar: what is being placed, "Add multiple" series, ✓ Done / Cancel */
function PlaceBar() {
  const mode = usePlace((s) => s?.mode ?? null), type = usePlace((s) => s?.type ?? null), multi = usePlace((s) => !!s?.multi), placed = usePlace((s) => s?.placed ?? 0), dragging = usePlace((s) => !!s?.dragging);
  const touch = useLayout((s) => s.coarse), walking = useUi(isWalking);
  if (!mode || !type || mode === 'height' || (mode === 'move' && dragging)) return null;
  const d = DEVICES[type], ceiling = d.mountType === 'CEILING';
  const how = mode === 'move' ? t('electricalUi.howMove') : ceiling ? (touch ? t('electricalUi.howCeilingTouch') : t('electricalUi.howCeiling')) : touch && !walking ? t('electricalUi.howWallTouchDrag') : touch ? t('electricalUi.howWallTouch') : t('electricalUi.howWall');
  return (
    <div className="hm-el-placebar" data-testid="el-placebar" data-mode={mode}>
      <span className="hm-el-placebar-ico" style={{ color: EL_LAYERS[layerOf(type)].color }}><Icon name={d.icon} size={20} /></span>
      <span className="hm-el-placebar-txt"><b data-testid="el-placebar-name">{mode === 'copy' ? t('electricalUi.copyOf', { name: d.name }) : d.name}</b><small>{multi && placed ? `${t('electricalUi.placedCount', { n: placed })} · ${how}` : how}</small></span>
      {mode === 'new' && <button className={`hm-el-multi${multi ? ' on' : ''}`} onClick={() => setPlaceMulti(!multi)} aria-pressed={multi} aria-label={t('electricalUi.addMultiple')} data-testid="el-placebar-multi"><span className="long">{t('electricalUi.addMultiple')}</span><span className="short">{t('electricalUi.multipleShort')}</span></button>}
      <button className={`hm-btn${multi ? ' primary' : ''}`} onClick={cancelPlace} data-testid="el-placebar-done">{multi ? <><Icon name="check" size={16} /> {t('electricalUi.done')}</> : t('electricalUi.cancel')}</button>
    </div>
  );
}

// ------------------------------------------------------------------ level / room / view
function TopChips() {
  const level = useUi((s) => s.level), site = useUi((s) => s.elSite), roomId = useUi((s) => s.roomId), view = useUi((s) => s.elView);
  const room = roomById(roomId);
  return (
    <div className="hm-el-top" data-testid="el-top">
      {/* one row: a focused room replaces the level choice ("Whole home" returns to the whole level) */}
      {room && view !== 'walk'
        ? <button className="hm-el-roomchip" onClick={() => elFocusRoom(null)} data-testid="el-whole-house"><Icon name="back" size={15} /><b>{room.label}</b><span>{t('electricalUi.wholeHome')}</span></button>
        : <Seg value={site ? 'SITE' : level} options={planViews().map((v) => [v, planViewName(v)] as [LevelId | 'SITE', string])} onChange={setElLevel} testid="el-level" />}
      <Seg value={view} options={[['2d', t('electricalUi.viewPlan')], ['3d', '3D'], ['walk', <Icon key="w" name="walk" size={17} />, t('electricalUi.viewEyeLevel')]] as [ElView, ReactNode, string?][]} onChange={setElView} testid="el-view" />
    </div>
  );
}

// ------------------------------------------------------------------ dimension badge at the pointer, short notices
function PlaceTip() {
  const s = usePlace((x) => x), note = usePlaceNote();
  const show = !!s && !!s.at && !!s.info && (s.dragging || s.mode === 'new' || s.mode === 'copy' || s.mode === 'height') && !!s.screen;
  return (
    <>
      {show && s && s.info && s.screen && (() => {
        // no location: hint from the session (wall device — wall, ceiling device — room, site plan — outside the building)
        const lv = s.live ? s.check.level : 'error', msg = s.check.messages[0] ?? (s.live ? undefined : t('electricalUi.dragOntoWall')), g = s.guides.find((x) => x.kind === 'height');
        const stage = document.querySelector('.hm-stage')?.getBoundingClientRect(), x = s.screen[0] - (stage?.left ?? 0), y = s.screen[1] - (stage?.top ?? 0), w = stage?.width ?? 400;
        // above the pointer; near the top edge of the scene — to the side (so it covers neither the mounting spot nor the top bar)
        const above = y > 190, left = x > w / 2;
        const style = above ? { left: Math.max(96, Math.min(w - 96, x)), top: y - (s.touch ? 44 : 30) } : { left: x + (left ? -34 : 34), top: Math.max(70, y) };
        return (
          <div className={`hm-el-tip ${lv}${above ? '' : ` side${left ? ' left' : ''}`}`} style={style} data-testid="el-place-tip" data-level={lv}>
            <b>{DEVICES[s.type].name}</b>
            <span>{s.info.place}</span>
            {s.info.along !== null && <span data-testid="el-tip-along">↔ {m2(s.info.along)} m <small>{s.info.from === 'left' ? t('electricalUi.fromLeftCorner') : t('electricalUi.fromRightCorner')}</small></span>}
            {s.info.height !== null && <span data-testid="el-tip-height">↕ {m2(s.info.height)} m</span>}
            {g && <em data-testid="el-tip-align">{t('electricalUi.alignedTo', { cm: cm(g.value) })}</em>}
            {msg && <em className="msg" data-testid="el-tip-msg">{msg}</em>}
          </div>
        );
      })()}
      {note && <div className={`hm-el-note ${note.level}`} key={note.n} data-testid="el-note">{note.text}</div>}
    </>
  );
}

// ------------------------------------------------------------------ first entry, empty room
function Tips() {
  const done = useUi((s) => s.elTipsDone), touch = useLayout((s) => s.coarse);
  if (done) return null;
  return (
    <div className="hm-el-tips" data-testid="el-tips">
      <ol>
        <li><b>+ {t('electricalUi.add')}</b> — {touch ? t('electricalUi.tip1Touch') : t('electricalUi.tip1')}</li>
        <li>{t('electricalUi.tip2')}</li>
        <li>{touch ? t('electricalUi.tip3Touch') : t('electricalUi.tip3')}</li>
      </ol>
      <button className="hm-btn primary" onClick={() => ui.set({ elTipsDone: true })} data-testid="el-tips-ok">{t('electricalUi.gotIt')}</button>
    </div>
  );
}
function EmptyRoom() {
  const plan = useElPlan(), roomId = useUi((s) => s.roomId), busy = usePlace((s) => !!s), sel = useUi((s) => !!s.selection), panel = useUi((s) => !!s.elPanel), tips = useUi((s) => !s.elTipsDone);
  const room = roomById(roomId);
  if (!room || busy || sel || panel || tips || plan.points.some((p) => p.roomId === room.id)) return null;
  return (
    <div className="hm-el-empty" data-testid="el-empty">
      <span>{t('electricalUi.noPointsInRoom')}</span>
      <button className="hm-btn primary" onClick={() => beginNew(FIRST, false)} data-testid="el-empty-add"><Icon name="plus" size={16} /> {t('electricalUi.addFirstSocket')}</button>
    </div>
  );
}

// ------------------------------------------------------------------ selected device card
function TextField({ label, value, onCommit, testid, list, placeholder }: { label: ReactNode; value: string; onCommit: (v: string) => void; testid: string; list?: readonly string[]; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="hm-field"><span>{label}</span>
      <input className="hm-input" value={v} placeholder={placeholder} list={list ? `${testid}-list` : undefined} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onCommit(v.trim()); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-testid={testid} />
      {list && <datalist id={`${testid}-list`}>{list.map((x) => <option key={x} value={x} />)}</datalist>}
    </label>
  );
}
/** height: [−] value [+]; tapping the value lets you type an exact number [cm] */
function HeightStepper({ p }: { p: ElPoint }) {
  const snap = useUi((s) => s.elSnap), step = snap >= 0.05 ? 0.05 : 0.01;
  const [txt, setTxt] = useState<string | null>(null);
  // Esc discards the typed text: the blur commits with the text from before Esc, so the discard flag lives in a ref;
  // an empty field or non-numeric text does not change the height (parseHeightCm → null)
  const drop = useRef(false);
  const commit = () => { const v = drop.current || txt === null ? null : parseHeightCm(txt); drop.current = false; setTxt(null); if (v !== null) setElHeight(p.id, v); };
  const nudge = (k: number) => setElHeight(p.id, Math.round((p.heightAFFL + k * step) / step) * step);
  return (
    <div className="hm-el-height" data-testid="el-height">
      <button className="hm-el-step" onClick={() => nudge(-1)} aria-label={t('electricalUi.lower')} data-testid="el-height-minus"><Icon name="minus" size={20} /></button>
      <label className="hm-el-height-val"><input value={txt ?? String(cm(p.heightAFFL))} inputMode="numeric" aria-label={t('electricalUi.heightAria')} data-testid="el-height-value"
        onFocus={(e) => { setTxt(String(cm(p.heightAFFL))); e.target.select(); }} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { drop.current = true; (e.target as HTMLInputElement).blur(); } }} /><i>cm</i></label>
      <button className="hm-el-step" onClick={() => nudge(1)} aria-label={t('electricalUi.higher')} data-testid="el-height-plus"><Icon name="plus" size={20} /></button>
    </div>
  );
}
/** details ("More"): type, description, smart home, circuit, notes — used less often, they do not get in the way of basic work */
function MoreForm({ p }: { p: ElPoint }) {
  const expert = useUi((s) => s.mode === 'advanced');
  const d = DEVICES[p.type], set = (patch: Partial<ElPoint>, label: string) => patchElectrical(p.id, patch, `${d.short}: ${label}`);
  const same = DEVICE_CATEGORIES.flatMap((c) => devicesIn(c.id)).filter((x) => x.mountType === d.mountType || p.orientation === 'free');
  const m = measure(p);
  return (
    <div className="hm-el-form" data-testid="el-form" data-id={p.id}>
      <label className="hm-field"><span>{t('electricalUi.type')}</span>
        <select className="hm-select" value={p.type} onChange={(e) => set(retype(p, e.target.value as ElType), t('electricalUi.hist.type'))} data-testid="el-type">
          {DEVICE_CATEGORIES.map((c) => { const list = same.filter((x) => x.category === c.id); return list.length ? <optgroup key={c.id} label={c.name}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup> : null; })}
        </select></label>
      {p.type !== 'board' && d.mountType === 'WALL' && <label className="hm-field"><span>{t('electricalUi.modules')}</span><Seg value={p.modules} options={[[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']] as [number, string][]} onChange={(v) => set({ modules: v }, t('electricalUi.hist.quantity'))} testid="el-modules" /></label>}
      <TextField label={t('electricalUi.label')} value={p.label} onCommit={(v) => set({ label: v }, t('electricalUi.hist.label'))} testid="el-label" placeholder={t('electricalUi.labelPlaceholder')} />
      <TextField label={t('electricalUi.purpose')} value={p.purpose ?? ''} onCommit={(v) => set({ purpose: v || undefined }, t('electricalUi.hist.purpose'))} testid="el-purpose" list={PURPOSES} placeholder={t('electricalUi.purposePlaceholder')} />
      <label className="hm-field"><span>Smart Home</span>
        <select className="hm-select" value={p.smartHome} onChange={(e) => set({ smartHome: e.target.value as SmartMode }, t('electricalUi.hist.smartHome'))} data-testid="el-smart">
          {(Object.keys(SMART_MODES) as SmartMode[]).map((k) => <option key={k} value={k}>{SMART_MODES[k]}</option>)}
        </select></label>
      <TextField label={t('electricalUi.circuit')} value={p.circuitLabel ?? ''} onCommit={(v) => set({ circuitLabel: v || undefined }, t('electricalUi.hist.circuit'))} testid="el-circuit" placeholder={t('electricalUi.circuitPlaceholder')} />
      <TextField label={t('electricalUi.notes')} value={p.notes ?? ''} onCommit={(v) => set({ notes: v || undefined }, t('electricalUi.hist.notes'))} testid="el-notes" />
      {p.type === 'board' && <>
        <label className="hm-field"><span>{t('electricalUi.boardKind')}</span>
          <select className="hm-select" value={p.boardKind ?? 'unspecified'} onChange={(e) => set({ boardKind: e.target.value as BoardKind }, t('electricalUi.hist.kind'))} data-testid="el-board-kind">
            {(Object.keys(BOARD_KINDS) as BoardKind[]).map((k) => <option key={k} value={k}>{BOARD_KINDS[k]}</option>)}
          </select></label>
        <Slider label={t('electricalUi.boardWidth')} value={p.width ?? 0.6} min={EL_LIMITS.width[0]} max={EL_LIMITS.width[1]} step={EL_LIMITS.width[2]} onCommit={(v) => set({ width: v }, t('electricalUi.hist.width'))} testid="el-board-width" />
      </>}
      <label className="hm-field"><span>{t('electricalUi.status')}</span>
        <select className="hm-select" value={p.status} onChange={(e) => set({ status: e.target.value as ElStatus }, t('electricalUi.hist.status'))} data-testid="el-status">
          {(Object.keys(EL_STATUS) as ElStatus[]).map((k) => <option key={k} value={k}>{EL_STATUS[k]}</option>)}
        </select></label>
      {p.source !== 'user' && <p className="hm-muted" data-testid="el-source">{t('electricalUi.source', { source: p.source })}</p>}
      <p className="hm-muted" data-testid="el-ref">{t('electricalUi.printRef', { id: p.id })}</p>
      {expert && m && <TechnicalData summary={t('electricalUi.technicalData')}>
        <pre className="hm-json" data-testid="el-json">{JSON.stringify({ ...p, lcs: { x: +m.pos[0].toFixed(3), y: +m.pos[1].toFixed(3), z: +m.pos[2].toFixed(3) }, fromLeft: m.fromLeft, fromRight: m.fromRight }, null, 1)}</pre></TechnicalData>}
    </div>
  );
}
/** device card: name, location, height, Move / Duplicate / Delete; "More" — details */
export function ElCard({ id }: { id: string }) {
  const plan = useElPlan(), p = plan.points.find((x) => x.id === id), more = useUi((s) => s.elMore);
  const ctx = useMemo(() => coordContext(), [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  const d: DeviceDef = DEVICES[p.type], m = measure(p), room = elRoom(p.roomId), warns = pointWarnings(p, ctx);
  // location and distance from the corner are separate parts: in a narrow card the distance wraps to the second line as a whole (no clipping)
  const place = !room ? '' : room.exterior ? t('electricalUi.outside') : roomName(room.id);
  const detail = !room ? '' : m?.fromLeft != null ? t(m.fromLeft <= m.fromRight! ? 'electricalUi.mFromLeftCorner' : 'electricalUi.mFromRightCorner', { m: m2(Math.min(m.fromLeft, m.fromRight!)) }) : p.orientation === 'ceiling' ? t('electricalUi.ceiling') : room.exterior ? '' : t('electricalUi.floor');
  return (
    <div className="hm-el-card" data-testid="el-card" data-id={id} data-more={more ? '1' : '0'}>
      <header>
        <span className="hm-el-card-ico" style={{ color: EL_LAYERS[layerOf(p.type)].color }}><Icon name={d.icon} size={22} /></span>
        <div><b data-testid="el-card-title">{d.name}</b><small data-testid="el-card-where"><span>{place}</span>{detail && <> · <span>{detail}</span></>}</small></div>
        <button className={`hm-el-morebtn${more ? ' on' : ''}`} onClick={() => ui.set({ elMore: !more })} aria-expanded={more} data-testid="el-more"><span>{more ? t('electricalUi.less') : t('electricalUi.more')}</span><Icon name="chevron" size={16} className={more ? 'up' : ''} /></button>
        <button className="hm-icon-btn" onClick={() => { cancelPreview(); ui.set({ selection: null, elMore: false }); }} aria-label={t('electricalUi.close')} data-testid="el-card-close"><Icon name="close" /></button>
      </header>
      {p.orientation !== 'ceiling' && <div className="hm-el-card-row">
        <span className="hm-el-card-label">{t('electricalUi.height')}</span>
        <HeightStepper p={p} />
      </div>}
      {p.orientation !== 'ceiling' && d.heightPresets.length > 0 && <div className="hm-el-presets" data-testid="el-height-presets">
        {d.heightPresets.map((h) => <button key={h.label} className={`hm-el-chip plain${Math.abs(p.heightAFFL - h.height) < 0.005 ? ' on' : ''}`} onClick={() => setElHeight(id, h.height)} data-testid={`el-height-${cm(h.height)}`}>{h.label}</button>)}
      </div>}
      <div className="hm-el-actions">
        <button className="hm-el-act" onClick={() => beginMove(id)} data-testid="el-move"><Icon name="move" size={20} /><span>{t('electricalUi.move')}</span></button>
        <button className="hm-el-act" onClick={() => beginCopy(id)} data-testid="el-duplicate"><Icon name="copy" size={20} /><span>{t('electricalUi.duplicate')}</span></button>
        <button className="hm-el-act danger" onClick={() => removeElectrical(id)} data-testid="el-delete"><Icon name="trash" size={20} /><span>{t('electricalUi.delete')}</span></button>
      </div>
      {warns.length > 0 && <div className="hm-el-warn" data-testid="el-point-warnings">{warns.map((w, i) => <div key={i}><Icon name="warn" size={14} /> {friendlyWarning(w.kind)}</div>)}</div>}
      {more && <MoreForm p={p} />}
    </div>
  );
}
const friendlyWarning = (k: string) => (k === 'door' ? t('electricalUi.warnDoor') : k === 'furniture' ? t('electricalUi.warnFurniture') : k === 'sanitary' ? t('electricalUi.warnSanitary') : t('electricalUi.warnOpening'));

/** right panel on desktop */
export function ElectricalInspector({ id }: { id: string }) {
  const mobile = useLayout((s) => s.mobile), exists = useElPlan().points.some((p) => p.id === id);
  // phone: the card lives in the scene area (ElWorkspace); a selection of a point that no longer exists (undone add): no empty panel
  if (mobile || !exists) return null;
  return <CardShell kind="electrical" className="hm-el-inspector"><ElCard id={id} /></CardShell>;
}

// ------------------------------------------------------------------ workspace (in the scene)
export function ElWorkspace() {
  const view = useUi((s) => s.elView), mobile = useLayout((s) => s.mobile);
  const sel = useUi((s) => (s.selection?.kind === 'electrical' ? s.selection.id : null));
  const placing = usePlace((s) => !!s && !(s.mode === 'move' && s.dragging) && s.mode !== 'height'), busy = usePlace((s) => !!s);
  // Esc: abort placement / close the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (busy) { e.stopImmediatePropagation(); cancelPlace(); } else if (ui.get().elPanel) { e.stopImmediatePropagation(); ui.set({ elPanel: null }); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy]);
  useEffect(() => () => cancelPlace(), []);
  // the card also stays while the selected device is dragged (no layout jump under the finger)
  const dragMove = usePlace((s) => !!s && ((s.mode === 'move' && s.dragging) || s.mode === 'height'));
  const exists = useElPlan().points.some((p) => p.id === sel);
  const card = mobile && sel && exists && (!busy || dragMove);
  // phone: the scene (plan and 3D) ends above the card — the selected device does not hide under it
  const sheet = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>('.hm'), el = sheet.current;
    if (!root) return;
    if (!card || !el) { root.style.removeProperty('--el-card'); return; }
    const set = () => root.style.setProperty('--el-card', `${Math.round(Math.min(el.getBoundingClientRect().height, window.innerHeight * 0.42))}px`);
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--el-card'); };
  }, [card, sel]);
  return (
    <div className="hm-el" data-testid="el-workspace" data-view={view} data-placing={placing ? '1' : '0'}>
      {view === '2d' && <ElPlanStage />}
      <TopChips />
      <PlaceTip />
      <Tips />
      <EmptyRoom />
      <div className="hm-el-dock">
        {placing ? <PlaceBar /> : card ? <div className="hm-el-sheet" data-testid="el-sheet" ref={sheet}><ElCard id={sel} /></div> : <Toolbar />}
      </div>
      <Panels />
    </div>
  );
}

// ------------------------------------------------------------------ left panel (desktop)
export function SectionElectrical() {
  const plan = useElPlan(), level = useUi((s) => s.level), site = useUi((s) => s.elSite), roomId = useUi((s) => s.roomId), sel = useUi((s) => (s.selection?.kind === 'electrical' ? s.selection.id : null));
  const ctx = useMemo(() => coordContext(), [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const warnings = useMemo(() => plan.points.flatMap((p) => pointWarnings(p, ctx)), [plan, ctx]);
  const room = roomById(roomId);
  const shown = [...(room ? plan.points.filter((p) => p.roomId === room.id) : plan.points)].sort(byId);
  return (
    <div className="hm-section" data-testid="section-electrical">
      <Block title={t('electricalUi.sideTitle')}>
        <p className="hm-muted">{t('electricalUi.sideIntro')}</p>
      </Block>
      <Block title={t('electricalUi.room')}>
        {!site && <LevelPlan level={level} onRoom={(r) => elFocusRoom(r.id)} />}
        <p className="hm-muted">{room ? t('electricalUi.selectedRoom', { room: room.label }) : t('electricalUi.clickRoomToZoom')}</p>
      </Block>
      <Block title={room ? t('electricalUi.roomDevices', { room: room.label, n: shown.length }) : t('electricalUi.allDevices', { n: shown.length })} testid="el-list">
        {shown.length === 0 && <div className="hm-el-side-empty" data-testid="el-list-empty">
          <p className="hm-muted">{room ? t('electricalUi.noPointsInRoomDot') : t('electricalUi.noPoints')}</p>
          <button className="hm-btn" onClick={() => beginNew(FIRST, false)} data-testid="el-list-add"><Icon name="plus" size={15} /> {t('electricalUi.addFirstSocket')}</button>
        </div>}
        <div className="hm-col">{shown.map((p) => <PointRow key={p.id} p={p} on={sel === p.id} room={!room} warn={warnings.some((w) => w.id === p.id)} />)}</div>
      </Block>
      {warnings.length > 0 && <Block title={t('electricalUi.toCheck', { n: new Set(warnings.map((w) => w.id)).size })} testid="el-warnings">
        <div className="hm-warnlist">{warnings.map((w, i) => { const p = plan.points.find((x) => x.id === w.id); return <button key={i} className="hm-row-main" onClick={() => selectElectrical(w.id)}><Icon name="warn" size={14} /><span>{p ? DEVICES[p.type].short : ''}{p ? ` (${roomName(p.roomId)})` : ''}: {friendlyWarning(w.kind).toLowerCase()}</span></button>; })}</div>
        <p className="hm-muted">{t('electricalUi.hintsOnly')}</p>
      </Block>}
    </div>
  );
}
function PointRow({ p, on, warn, room }: { p: ElPoint; on: boolean; warn?: boolean; room: boolean }) {
  const d = DEVICES[p.type];
  return (
    <div className={`hm-row${on ? ' on' : ''}`}>
      <button className="hm-row-main" onClick={() => { const r = roomById(p.roomId); if (r && ui.get().level !== r.level) setElLevel(r.level); ui.set({ selection: on ? null : { kind: 'electrical', id: p.id }, elMore: false }); }} data-testid={`el-row-${p.id}`}>
        <i className="hm-dot" style={{ background: EL_LAYERS[d.category === 'sockets' ? layerOf(p.type) : layerOf(p.type)].color }} />
        <span>{p.label && p.label.toLowerCase().startsWith(d.name.toLowerCase()) ? p.label : `${d.name}${p.label ? ` — ${p.label}` : ''}`}{warn ? ' ⚠' : ''}</span>
        <small>{room ? `${roomName(p.roomId)} · ` : ''}{p.orientation === 'ceiling' ? t('electricalUi.ceiling') : `${cm(p.heightAFFL)} cm`}</small>
      </button>
    </div>
  );
}

/** project kitchen: proposed sockets for appliances (to be confirmed — no power ratings or protection) */
export function proposeKitchenPoints(): number {
  const ctx = coordContext(), plan = planNow();
  // appliances are recognised by the furniture name (in the UI language: patterns and purposes come from the dictionary)
  const map: [RegExp, string, ElType, number][] = (['fridge', 'oven', 'hob', 'dishwasher'] as const)
    .map((k) => [new RegExp(t(`electricalUi.kitchen.${k}.match`), 'i'), t(`electricalUi.kitchen.${k}`), 'socket-1', 0.3] as [RegExp, string, ElType, number]);
  let n = 0;
  for (const f of ctx.furniture) {
    const hit = map.find(([re]) => re.test(f.name));
    if (!hit) continue;
    const room = elRoom(f.roomId);
    if (!room || plan.points.some((p) => p.roomId === f.roomId && p.purpose === hit[1])) continue;
    const c: [number, number] = [f.corners.reduce((s, q) => s + q[0], 0) / 4, f.corners.reduce((s, q) => s + q[1], 0) / 4];
    let best = { wall: room.walls[0], t: 0, d: Infinity };
    for (const w of room.walls) { const t = Math.max(0, Math.min(w.length, (c[0] - w.a[0]) * w.dir[0] + (c[1] - w.a[1]) * w.dir[1])), d = Math.hypot(c[0] - w.a[0] - w.dir[0] * t, c[1] - w.a[1] - w.dir[1] * t); if (d < best.d) best = { wall: w, t, d }; }
    const extra = { purpose: hit[1], status: 'proposed' as ElStatus, source: t('electricalUi.kitchenSource'), notes: t('electricalUi.kitchenNotes') };
    if (best.d <= 0.9) addElectrical(hit[2], { roomId: f.roomId, wallId: best.wall.id, positionAlongWall: Math.round(best.t * 100) / 100, heightAFFL: hit[3], orientation: 'wall' }, extra);
    else addElectrical(hit[2], { roomId: f.roomId, wallId: null, positionAlongWall: 0, heightAFFL: 0.1, orientation: 'free', x: Math.round(c[0] * 100) / 100, y: Math.round(c[1] * 100) / 100 }, { ...extra, notes: `${extra.notes} ${t('electricalUi.kitchenNotesFloor')}` });
    n++;
  }
  ui.set({ selection: null });
  return n;
}
/** leaving the mode (phone: the "back" button at whole-building level) */
export const leaveElectrical = () => goSection('look');
