// The card of the selection (ADR 0040): only the PROPERTIES of the selected element — furniture (variant, dimensions, material,
// height, angle, warnings, its place on a wall), door (open / closed, angle), stairs (finishes), electrical device. The actions on
// furniture are in the object bar; the finishes of walls, floor and ceiling in Arrange › Colours. Technical data (project
// coordinates, ids, JSON) — advanced mode only.
import { hasStairs, stairFacts, stairs } from '../model/stairs';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { patchFurniture, previewVariantStairs, setDoor, setFurnitureVariant, setVariantGlazing, setVariantStairs } from '../actions';
import { displayName, elevationOf, isWallMounted, resolveDims, sizeLabel, variantOf as itemVariant } from '../catalog/furniture';
import { materialsFor, type Surface } from '../catalog/materials';
import { itemById } from '../catalog/providers';
import { furnitureThumbnail } from '../catalog/thumbnails';
import { furnitureWarnings, type FurnitureWarning } from '../model/collision';
import { round } from '@home-sim/core/model/geom2d';
import { furnitureById, updateFurniture } from '../model/interiors';
import { patchPlacement, storedMountWarnings } from '../model/mountedFurniture';
import { neighbours } from '../model/placement';
import { roomById } from '../model/rooms';
import { architectItemOf } from '../model/defaults';
import { finishLook, resolveStairs, STAIR_FINISHES, STAIR_LIMITS, STAIRS_PRESETS, stairsSummary, type BalustradeType, type HandrailPlace, type StairFinish, type StairFinishId } from '../model/stairsConfig';
import { doorById, doorTypeKey, openOf } from '../model/doors';
import { choiceOf, FRAME_COLORS, glazingGroups, type BarsChoice, type GlazingChoice, type TransomChoice } from '../model/glazing';
import { t as tr } from '../../i18n';
import { useDoors } from '../store/doors';
import { mountedNow } from '../scene/interaction';
import { previewArrangement, updateArrangement, useArrangement, useVariant } from '../store/design';
import { useDrag } from '../store/drag';
import { useUi } from '../store/ui';
import { materialThumbnail } from '../three/textures';
import { ActionButton, Slot } from './Action';
import { CardShell, TechnicalData } from './Card';
import { Block, ColorInput, Seg, Slider, Swatches, Tile } from './controls';
import { Icon } from './icons';
import { ElectricalInspector } from './ElectricalPanels';

function Panel({ title, sub, img, children, testid }: { title: ReactNode; sub?: ReactNode; img?: string | ReactNode; children: ReactNode; testid: string }) {
  return (
    <CardShell kind={testid}>
      <header className="hm-insp-head">
        {img && (typeof img === 'string' ? <img src={img} alt="" className="hm-insp-img" /> : <span className="hm-insp-img">{img}</span>)}
        <div><h2 data-testid="inspector-title">{title}</h2>{sub && <p>{sub}</p>}</div>
        <Slot place="card"><ActionButton id="card-close" className="hm-tool" /></Slot>
      </header>
      <div className="hm-insp-body">{children}</div>
    </CardShell>
  );
}

const Expert = ({ children }: { children: ReactNode }) => (useUi((s) => s.mode === 'advanced') ? <TechnicalData summary={tr('inspector.technicalData')}>{children}</TechnicalData> : null);

export function Warnings({ list }: { list: FurnitureWarning[] }) {
  if (!list.length) return <div className="hm-ok" data-testid="warnings-none"><Icon name="check" size={14} /> {tr('inspector.noCollisions')}</div>;
  return (
    <div className="hm-warns" data-testid="warnings">
      {list.map((w, i) => <div key={i} className={`hm-warn ${w.level}`} data-kind={w.kind}><Icon name={w.level === 'warn' ? 'warn' : 'info'} size={14} /> {w.text}</div>)}
    </div>
  );
}

// ------------------------------------------------------------------ furniture
/** furniture warnings: while dragging — live from the transient state (only this block subscribes, not the whole inspector,
 *  so pointer moves do not re-render the whole panel); after release — from the stored position */
function FurnitureWarnings({ roomId, id }: { roomId: string; id: string }) {
  const a = useArrangement(roomId);
  const live = useDrag((s) => (s.item && s.item.id === id ? s.warnings : null));
  const stored = useMemo(() => {
    const p = furnitureById(a, id), item = p ? itemById(p.catalogId) : null, room = roomById(roomId);
    if (!p || !item || !room) return [];
    // wall-mounted item: the same mounting rules as while dragging (window, door, another wall item, wall end, ceiling)
    return storedMountWarnings(roomId, item, p, a.furniture) ?? furnitureWarnings(room, item, p, resolveDims(item, p), neighbours(a.furniture.filter((f) => f.id !== id)));
  }, [a, id, roomId]);
  return <Warnings list={live ?? stored} />;
}

/** where a wall-mounted item is: the distance from the wall corner and the height of its bottom edge (moved by dragging or with the
 *  object bar's nudges) */
function MountPlace({ roomId, id }: { roomId: string; id: string }) {
  useArrangement(roomId);
  const live = useDrag((s) => (s.mount && s.mount.id === id ? s.mount : null));
  const m = mountedNow(roomId, id);
  if (!m) return <p className="hm-muted" data-testid="mount-detached">{tr('inspector.mountDetached')}</p>;
  const along = live?.along ?? m.along, from = live?.from ?? m.from, height = live?.height ?? m.height, cm = (v: number) => Math.round(v * 100);
  return (
    <Block title={tr('inspector.onWall')} testid="mount">
      <dl className="hm-facts">
        <dt>{from === 'left' ? tr('inspector.fromLeftCorner') : tr('inspector.fromRightCorner')}</dt><dd data-testid="mount-along">{cm(along)} cm</dd>
        <dt>{tr('inspector.bottomHeight')}</dt><dd data-testid="mount-height">{cm(height)} cm</dd>
      </dl>
    </Block>
  );
}

function FurnitureInspector({ roomId, id }: { roomId: string; id: string }) {
  const a = useArrangement(roomId);
  const p = furnitureById(a, id), item = p ? itemById(p.catalogId) : null, room = roomById(roomId);
  const mode = useUi((s) => s.mode);
  if (!p || !item || !room) return null;
  const dims = resolveDims(item, p);
  const name = displayName(item, p);
  const hung = isWallMounted(item);
  const arch = architectItemOf(p.id);
  const surface: Surface = item.category === 'decor' && item.id === 'rug' ? 'rug' : 'furniture';
  const mats = item.materialCategories.length ? materialsFor(surface, item.materialCategories) : [];
  const mainMat = p.materialId ?? item.materialSlots[item.mainSlot] ?? item.defaultMaterial;
  const setDims = (k: 'w' | 'd' | 'h', v: number, commit: boolean) => {
    const fn = (x: typeof a) => patchPlacement(roomId, x, id, { dims: { ...(p.dims ?? {}), [k]: round(v, 3) } });
    if (commit) updateArrangement(roomId, tr('inspector.hist.dimension', { name }), fn); else previewArrangement(roomId, fn);
  };
  return (
    <Panel testid="furniture" title={name} sub={sizeLabel(dims)} img={furnitureThumbnail(item, p.variant, p.materialId)}>
      {arch && (
        <div className="hm-arch-badge" data-testid="architect-badge">
          <Icon name="info" size={16} />
          <span><b>{tr('inspector.fromArchitect')}</b> ({arch.source.split(' ')[0]}) — {arch.basis === 'dimensioned' ? tr('inspector.archDimensioned') : arch.basis === 'drawn' ? tr('inspector.archDrawn') : tr('inspector.archAssumed')}. {tr('inspector.archEditable')}</span>
        </div>
      )}
      {hung && <MountPlace roomId={roomId} id={id} />}
      <FurnitureWarnings roomId={roomId} id={id} />
      {!!item.variants?.length && (
        <Block title={item.id === 'rug' ? tr('inspector.size') : tr('inspector.variant')} testid="variants">
          <div className="hm-tiles">
            {item.variants.map((v) => <Tile key={v.id} img={furnitureThumbnail(item, v.id, p.materialId)} title={v.name} active={itemVariant(item, p.variant)?.id === v.id} onClick={() => setFurnitureVariant(roomId, id, v.id)} testid={`variant-${v.id}`} />)}
          </div>
        </Block>
      )}
      {item.parametric && Object.keys(item.parametric).length > 0 && (
        <Block title={tr('inspector.dimensions')} testid="dims">
          {(['w', 'd', 'h'] as const).map((k) => {
            const rg = item.parametric?.[k];
            if (!rg) return null;
            return <Slider key={k} label={{ w: tr('inspector.width'), d: tr('inspector.depth'), h: tr('inspector.height') }[k]} value={dims[k]} min={rg[0]} max={rg[1]} step={rg[2]} testid={`dim-${k}`}
              onPreview={(v) => setDims(k, v, false)} onCommit={(v) => setDims(k, v, true)} />;
          })}
        </Block>
      )}
      {mats.length > 0 && (
        <Block title={surface === 'rug' ? tr('inspector.rugMaterial') : tr('inspector.material')} testid="furniture-materials">
          <div className="hm-mats">
            {mats.map((m) => (
              <button key={m.id} className={`hm-mat${mainMat === m.id ? ' on' : ''}`} title={m.name} onClick={() => patchFurniture(roomId, id, tr('inspector.hist.material', { name, material: m.name }), { materialId: m.id })} data-testid={`fmat-${m.id}`}>
                <img src={materialThumbnail(m, 64)} alt="" /><span>{m.name}</span>
              </button>
            ))}
          </div>
        </Block>
      )}
      {item.elevation && !hung && (
        <Block title={tr('inspector.mounting')} testid="elevation">
          <Slider label={tr('inspector.heightFromFloor')} value={elevationOf(item, p)} min={item.elevation[0]} max={item.elevation[1]} step={item.elevation[2]} testid="elev"
            onPreview={(v) => previewArrangement(roomId, (x) => updateFurniture(x, id, { elevation: round(v, 3) }))}
            onCommit={(v) => patchFurniture(roomId, id, tr('inspector.hist.elevation', { name }), { elevation: round(v, 3) })} />
        </Block>
      )}
      {(item.extraSlots ?? []).map((xs) => {
        const curM = p.slots?.[xs.slot] ?? item.materialSlots[xs.slot];
        return (
          <Block key={xs.slot} title={xs.label} testid={`slot-${xs.slot}`}>
            <div className="hm-mats">
              {materialsFor('furniture', xs.categories).map((m) => (
                <button key={m.id} className={`hm-mat${curM === m.id ? ' on' : ''}`} title={m.name} data-testid={`smat-${xs.slot}-${m.id}`}
                  onClick={() => patchFurniture(roomId, id, tr('inspector.hist.slot', { slot: xs.label.toLowerCase(), name, material: m.name }), { slots: { ...(p.slots ?? {}), [xs.slot]: m.id } })}>
                  <img src={materialThumbnail(m, 64)} alt="" /><span>{m.name}</span>
                </button>
              ))}
            </div>
          </Block>
        );
      })}
      {!hung && <Block title={tr('inspector.rotation')}>
        <Slider label={tr('inspector.angle')} value={p.rot} min={0} max={359} step={1} unit="°" k={1} testid="rot"
          onCommit={(v) => patchFurniture(roomId, id, tr('inspector.hist.rotation', { name }), { rot: round(v, 1) })} />
      </Block>}
      {mode === 'advanced' && (
        <Expert>
          <dl className="hm-kv"><dt>id</dt><dd>{p.id}</dd><dt>{tr('inspector.kv.catalog')}</dt><dd>{p.catalogId}{p.variant ? ` / ${p.variant}` : ''}</dd>
            <dt>X, Y (LCS)</dt><dd>{p.x.toFixed(3)}, {p.y.toFixed(3)} m</dd><dt>{tr('inspector.kv.rotation')}</dt><dd>{p.rot.toFixed(1)}°</dd><dt>{tr('inspector.kv.source')}</dt><dd>{item.source}</dd><dt>{tr('inspector.kv.license')}</dt><dd>{item.license}</dd></dl>
          <textarea readOnly className="hm-json" rows={8} value={JSON.stringify(p, null, 1)} />
        </Expert>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ doors and model elements
function HouseInspector({ name, data, point }: { name: string; data: Record<string, unknown>; point: [number, number, number] }) {
  return (
    <Panel testid="house" title={name} sub={tr('inspector.modelElement')} img={<Icon name="expert" size={26} />}>
      <dl className="hm-kv">{Object.entries(data).filter(([, v]) => typeof v !== 'object').map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}
        <dt>{tr('inspector.kv.point')}</dt><dd>{point.map((x) => x.toFixed(3)).join(' / ')}</dd></dl>
      <textarea readOnly className="hm-json" rows={10} value={JSON.stringify(data, null, 1)} />
    </Panel>
  );
}

/** finish picker: palette (wood, concrete, steel, colours) + any colour */
function FinishPicker({ value, onChange, onPreview, none, testid }: { value: StairFinish | 'none'; onChange: (f: StairFinish | 'none') => void; onPreview: (f: StairFinish) => void; none?: string; testid: string }) {
  const custom = typeof value === 'string' && value.startsWith('#');
  return (
    <div className="hm-finish" data-testid={testid}>
      {none && <button className={`hm-finish-item${value === 'none' ? ' on' : ''}`} onClick={() => onChange('none')} data-value="none"><i className="none" />{none}</button>}
      {(Object.keys(STAIR_FINISHES) as StairFinishId[]).map((id) => (
        <button key={id} className={`hm-finish-item${value === id ? ' on' : ''}`} onClick={() => onChange(id)} data-value={id}><i style={{ background: STAIR_FINISHES[id].color }} />{STAIR_FINISHES[id].name}</button>
      ))}
      <label className={`hm-finish-item${custom ? ' on' : ''}`} title={tr('inspector.anyColor')}>
        <ColorInput value={custom ? value : '#c49a6c'} onPreview={(hex) => onPreview(hex as StairFinish)} onCommit={(hex) => onChange(hex as StairFinish)} testid={`${testid}-custom`} />
        <i style={{ background: custom ? value : 'conic-gradient(#e44, #ee4, #4c4, #4cc, #44e, #e4e, #e44)' }} />{tr('inspector.customColor')}
      </label>
    </div>
  );
}

/** stairs card: finishes of the concrete structure — cladding, handrail, balustrade; ready-made sets; stored in the variant */
function StairsInspector() {
  const v = useVariant() ;
  const c = resolveStairs(v.stairs);
  const preset = STAIRS_PRESETS.find((p) => JSON.stringify(p.config) === JSON.stringify(c));
  const L = STAIR_LIMITS;
  return (
    <Panel testid="stairs" title={tr('inspector.stairs')} sub={stairsSummary(c)} img={<Icon name="interior" size={26} />}>
      <p className="hm-note">{stairFacts(stairs()[0])}. {tr('inspector.stairsIntro')}</p>
      <Block title={tr('inspector.stairsPresets')}>
        <div className="hm-col" data-testid="stairs-presets">
          {STAIRS_PRESETS.map((p) => (
            <button key={p.id} className={`hm-preset${preset?.id === p.id ? ' on' : ''}`} onClick={() => setVariantStairs(p.id === 'concrete' ? null : p.config, tr('inspector.hist.stairs', { what: p.name }))} data-testid={`stairs-preset-${p.id}`}>
              <span className="hm-preset-dots"><i style={{ background: finishLook(p.config.tread).color }} /><i style={{ background: finishLook(p.config.riser === 'none' ? 'concrete' : p.config.riser).color }} /><i style={{ background: finishLook(p.config.handrail.finish).color }} /></span>
              <span><b>{p.name}</b><small>{p.hint}</small></span>
            </button>
          ))}
        </div>
      </Block>
      <Block title={tr('inspector.treads')}>
        <Slider label={tr('inspector.claddingThickness')} value={c.treadThickness} min={L.treadThickness[0]} max={L.treadThickness[1]} step={L.treadThickness[2]} digits={1} onCommit={(x) => setVariantStairs({ treadThickness: x, ...(x > 0 && c.tread === 'concrete' ? { tread: 'oak' } : {}) }, tr('inspector.hist.stairs', { what: tr('inspector.hist.claddingThickness') }))} testid="stairs-thickness" hint={tr('inspector.bareConcrete')} />
        {c.treadThickness > 0 && <>
          <FinishPicker value={c.tread} onPreview={(f) => previewVariantStairs({ tread: f })} onChange={(f) => f !== 'none' && setVariantStairs({ tread: f }, tr('inspector.hist.stairs', { what: tr('inspector.hist.treadCladding') }))} testid="stairs-tread" />
          <Slider label={tr('inspector.nosing')} value={c.nosing} min={L.nosing[0]} max={L.nosing[1]} step={L.nosing[2]} digits={1} onCommit={(x) => setVariantStairs({ nosing: x }, tr('inspector.hist.stairs', { what: tr('inspector.hist.nosing') }))} testid="stairs-nosing" />
        </>}
      </Block>
      <Block title={tr('inspector.risers')}>
        <FinishPicker value={c.riser} none={tr('inspector.noCladding')} onPreview={(f) => previewVariantStairs({ riser: f })} onChange={(f) => setVariantStairs({ riser: f }, tr('inspector.hist.stairs', { what: tr('inspector.hist.risers') }))} testid="stairs-riser" />
      </Block>
      <Block title={tr('inspector.handrail')}>
        <Seg wide value={c.handrail.place} options={[['none', tr('inspector.none')], ['outer', tr('inspector.railOuter')], ['inner', tr('inspector.railInner')], ['both', tr('inspector.railBoth')]] as [HandrailPlace, string][]} onChange={(x) => setVariantStairs({ handrail: { place: x } }, tr('inspector.hist.stairs', { what: tr('inspector.hist.handrail') }))} testid="stairs-rail-place" />
        {c.handrail.place !== 'none' && <>
          <Seg wide value={c.handrail.profile} options={[['round', tr('inspector.railRound')], ['rect', tr('inspector.railRect')]] as ['round' | 'rect', string][]} onChange={(x) => setVariantStairs({ handrail: { profile: x } }, tr('inspector.hist.stairs', { what: tr('inspector.hist.railProfile') }))} testid="stairs-rail-profile" />
          <Slider label={tr('inspector.heightAboveSteps')} value={c.handrail.height} min={L.handrail[0]} max={L.handrail[1]} step={L.handrail[2]} onCommit={(x) => setVariantStairs({ handrail: { height: x } }, tr('inspector.hist.stairs', { what: tr('inspector.hist.railHeight') }))} testid="stairs-rail-height" />
          <FinishPicker value={c.handrail.finish} onPreview={(f) => previewVariantStairs({ handrail: { finish: f } })} onChange={(f) => f !== 'none' && setVariantStairs({ handrail: { finish: f } }, tr('inspector.hist.stairs', { what: tr('inspector.hist.railFinish') }))} testid="stairs-rail-finish" />
        </>}
      </Block>
      <Block title={tr('inspector.balustrade')}>
        <Seg wide value={c.balustrade.type} options={[['none', tr('inspector.none')], ['bars', tr('inspector.balBars')], ['glass', tr('inspector.balGlass')], ['solid', tr('inspector.balSolid')]] as [BalustradeType, string][]} onChange={(x) => setVariantStairs({ balustrade: { type: x } }, tr('inspector.hist.stairs', { what: tr('inspector.hist.balustrade') }))} testid="stairs-bal-type" />
        {c.balustrade.type !== 'none' && <>
          <Slider label={tr('inspector.height')} value={c.balustrade.height} min={L.balustrade[0]} max={L.balustrade[1]} step={L.balustrade[2]} onCommit={(x) => setVariantStairs({ balustrade: { height: x } }, tr('inspector.hist.stairs', { what: tr('inspector.hist.balHeight') }))} testid="stairs-bal-height" />
          <FinishPicker value={c.balustrade.finish} onPreview={(f) => previewVariantStairs({ balustrade: { finish: f } })} onChange={(f) => f !== 'none' && setVariantStairs({ balustrade: { finish: f } }, tr('inspector.hist.stairs', { what: tr('inspector.hist.balFinish') }))} testid="stairs-bal-finish" />
          <p className="hm-note">{tr('inspector.balustradeNote')}{stairs()[0]?.note ? ` (${stairs()[0].note})` : ''}.</p>
        </>}
      </Block>
      <Expert><pre className="hm-json" data-testid="stairs-json">{JSON.stringify(v.stairs ?? null, null, 1)}</pre></Expert>
    </Panel>
  );
}

/** gable window card: the frame colour and how the glazing is divided — for this window (every part of a glazing split by a
 *  partition) or for every gable window */
function WindowInspector({ id }: { id: string }) {
  const v = useVariant(), all = glazingGroups(), w = all.find((x) => x.ids.includes(id)), [every, setEvery] = useState(true);
  if (!w) return null;
  const c = choiceOf(v.glazing, id), ids = every ? all.flatMap((x) => x.ids) : w.ids, room = w.roomIds.map((r) => roomById(r)?.label ?? r).join(' + ');
  const set = (patch: GlazingChoice, what: string) => setVariantGlazing(ids, patch, tr('inspector.hist.glazing', { what }));
  const colors = FRAME_COLORS.map((f) => ({ hex: f.hex, name: tr(`glazing.color.${f.key}`) }));
  // "as drawn" only for a window the project divides; otherwise "none" stands for it
  const drawn = w.drawn, bars: BarsChoice = !drawn && c.bars === 'project' ? 0 : c.bars;
  const barOptions: [BarsChoice, string][] = [...(drawn ? [['project', tr('glazing.asDrawn')] as [BarsChoice, string]] : []), [0, tr('glazing.none')], [1, tr('glazing.panes', { n: 2 })], [2, tr('glazing.panes', { n: 3 })], [3, tr('glazing.panes', { n: 4 })]];
  return (
    <Panel testid="window" title={tr('inspector.window')} sub={room} img={<Icon name="interior" size={26} />}>
      {all.length > 1 && <Seg wide value={every ? 'all' : 'one'} options={[['one', tr('glazing.thisOne')], ['all', tr('glazing.everyOne', { n: all.length })]]} onChange={(x) => setEvery(x === 'all')} testid="window-which" />}
      <Block title={tr('glazing.frameColor')}>
        <Swatches value={c.color} colors={colors} allowCustom={false} onChange={(hex, name) => set({ color: hex }, name)} testid="window-color" />
      </Block>
      <Block title={tr('glazing.division')}>
        <Seg wide value={bars} options={barOptions} onChange={(x) => set({ bars: x }, tr('glazing.division').toLowerCase())} testid="window-bars" />
      </Block>
      <Block title={tr('glazing.crossBar')}>
        <Seg wide value={c.transom} options={[['none', tr('glazing.none')], ['door', tr('glazing.doorHeight')], ['half', tr('glazing.halfWay')]] as [TransomChoice, string][]} onChange={(x) => set({ transom: x }, tr('glazing.crossBar').toLowerCase())} testid="window-transom" />
      </Block>
      <p className="hm-note">{tr('glazing.note')}</p>
    </Panel>
  );
}

/** door card: open / close, opening angle or slide, hinge side, opening direction */
function DoorInspector({ id }: { id: string }) {
  const d = doorById(id), t = useDoors((s) => openOf(s, id)), show = useDoors((s) => s.show);
  if (!d) return null;
  const name = (r: string) => (r === 'exterior' ? tr('inspector.outside') : roomById(r)?.label ?? r);
  const open = t >= 0.5, deg = Math.round((d.openAngle ?? 0) * t);
  return (
    <Panel testid="door" title={tr('inspector.door')} sub={`${name(d.rooms[0])} ↔ ${name(d.rooms[1])}`} img={<Icon name="door" size={26} />}>
      <div className="hm-door-actions" data-testid="door-actions">
        <button className={`hm-btn wide${open ? '' : ' primary'}`} disabled={t >= 1} onClick={() => setDoor(id, 1)} data-testid="door-open">{tr('inspector.open')}</button>
        <button className={`hm-btn wide${open ? ' primary' : ''}`} disabled={t <= 0} onClick={() => setDoor(id, 0)} data-testid="door-close">{tr('inspector.closeDoor')}</button>
      </div>
      <div className="hm-current" data-testid="door-state">{tr('inspector.now')} <b>{t <= 0 ? tr('inspector.doorClosed') : t >= 1 ? tr('inspector.doorOpen') : d.hinge ? tr('inspector.doorAjar', { deg }) : tr(d.lift ? 'inspector.doorRaised' : 'inspector.doorSlid', { pct: Math.round(t * 100) })}</b></div>
      {d.hinge
        ? <Slider label={tr('inspector.openingAngle')} value={deg} min={0} max={d.openAngle ?? 90} step={5} unit="°" k={1} onPreview={(v) => setDoor(id, v / (d.openAngle ?? 90))} onCommit={(v) => setDoor(id, v / (d.openAngle ?? 90))} testid="door-angle" />
        : <Slider label={tr(d.lift ? 'inspector.liftOpen' : 'inspector.slideOpen')} value={Math.round(t * 100)} min={0} max={100} step={5} unit="%" k={1} onPreview={(v) => setDoor(id, v / 100)} onCommit={(v) => setDoor(id, v / 100)} testid="door-angle" />}
      {!show && <p className="hm-note" data-testid="door-hidden-note">{tr('inspector.doorsHidden')}</p>}
      <Block title={tr('inspector.fromProject')}>
        <dl className="hm-facts" data-testid="door-facts">
          <dt>{tr('inspector.type')}</dt><dd>{tr(doorTypeKey(d.type))}{d.flush ? ` · ${tr('inspector.flush')}` : ''}</dd>
          <dt>{tr('inspector.leaf')}</dt><dd>{Math.round(d.leafWidth * 100)} × {Math.round(d.height * 100)} cm</dd>
          {d.hingeSide && <><dt>{tr('inspector.hinges')}</dt><dd>{tr(d.hingeSide === 'left' ? 'inspector.hingesLeft' : 'inspector.hingesRight', { from: name(d.swingInto ?? '') })}</dd></>}
          {d.swingInto && <><dt>{tr('inspector.opensInto')}</dt><dd>{name(d.swingInto)}</dd></>}
          {d.slide && <><dt>{tr('inspector.leaf')}</dt><dd>{tr('inspector.pocket')}</dd></>}
        </dl>
        <p className="hm-note">{tr('inspector.doorSourceNote', { source: d.source[0] ? ` (${d.source[0]})` : '' })}</p>
      </Block>
      <Expert><pre className="hm-json" data-testid="door-json">{JSON.stringify(d, null, 1)}</pre></Expert>
    </Panel>
  );
}

export function Inspector() {
  const sel = useUi((s) => s.selection);
  const mode = useUi((s) => s.mode);
  if (!sel) return null;
  switch (sel.kind) {
    case 'furniture': return <FurnitureInspector key={sel.id} roomId={sel.roomId} id={sel.id} />;
    // walls, floor, ceiling: their finishes are in Arrange › Colours; a room has no card
    case 'wall': case 'floor': case 'ceiling': case 'room': return null;
    // cards of module elements (stairs) — only in a project that has the module: the selection may come from a saved state
    case 'house': return mode === 'advanced' ? <HouseInspector name={sel.name} data={sel.data} point={sel.point} /> : null;
    case 'door': return <DoorInspector key={sel.id} id={sel.id} />;
    case 'window': return <WindowInspector key={sel.id} id={sel.id} />;
    case 'stairs': return hasStairs() ? <StairsInspector /> : null;
    case 'electrical': return <ElectricalInspector key={sel.id} id={sel.id} />;
  }
}
