// Context panel of the selected element (right side): furniture (rotate, duplicate, delete, variant, dimensions, material,
// warnings), wall / floor / ceiling (material, colour, tile and board layout), room, door, stairs, electrical device.
// Home mode shows only user settings; technical data (project coordinates, ids, JSON) — Expert mode only.
import { hasStairs, stairFacts, stairs } from '../model/stairs';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  applyFinish, applyWallsHouse, HOUSE_WALL_ROOMS, deleteFurniture, duplicateSelected, enterRoom, patchFurniture,
  previewFinish, previewVariantStairs, previewWallsHouse, setDoor, setFurnitureVariant, setVariantStairs,
} from '../actions';
import { displayName, elevationOf, isWallMounted, resolveDims, sizeLabel, variantOf as itemVariant } from '../catalog/furniture';
import { MOUNT } from '../model/mountDrag';
import {
  categoriesFor, categoryName, editableLayout, effectiveTexture, isParquet, isPlanks, isTiled, neutralFinish, LAYOUT_LIMITS, materialById, materialsFor, type MaterialDef, type Surface,
} from '../catalog/materials';
import { itemById } from '../catalog/providers';
import { furnitureThumbnail } from '../catalog/thumbnails';
import { furnitureWarnings, type FurnitureWarning } from '../model/collision';
import { round } from '../model/geom2d';
import { furnitureById, updateFurniture } from '../model/interiors';
import { patchPlacement, storedMountWarnings } from '../model/mountedFurniture';
import { neighbours } from '../model/placement';
import { roomById, type HomeRoom } from '../model/rooms';
import type { FinishLayout, FinishRef } from '../model/types';
import { architectItemOf } from '../model/defaults';
import { finishLook, resolveStairs, STAIR_FINISHES, STAIR_LIMITS, STAIRS_PRESETS, stairsSummary, type BalustradeType, type HandrailPlace, type StairFinish, type StairFinishId } from '../model/stairsConfig';
import { doorById, doorTypeKey, openOf } from '../model/doors';
import { fmtNum, t as tr } from '../../i18n';
import { setShowDoors, useDoors } from '../store/doors';
import { mountedNow, nudgeMounted, nudgeMountedSide, rotateBy } from '../scene/interaction';
import { cancelPreview, previewArrangement, updateArrangement, useArrangement, useVariant } from '../store/design';
import { useDrag } from '../store/drag';
import { selectedWallIds, ui, useUi } from '../store/ui';
import { materialThumbnail } from '../three/textures';
import { Block, ColorInput, finishLabel, PAINT_COLORS, Seg, Slider, Swatches, Tile } from './controls';
import { Icon } from './icons';
import { roomHeightText } from './SectionInteriors';
import { ElectricalInspector } from './ElectricalPanels';

function Panel({ title, sub, img, children, testid }: { title: ReactNode; sub?: ReactNode; img?: string | ReactNode; children: ReactNode; testid: string }) {
  return (
    <aside className="hm-inspector" data-testid="inspector" data-kind={testid}>
      <header className="hm-insp-head">
        {img && (typeof img === 'string' ? <img src={img} alt="" className="hm-insp-img" /> : <span className="hm-insp-img">{img}</span>)}
        <div><h2 data-testid="inspector-title">{title}</h2>{sub && <p>{sub}</p>}</div>
        <button className="hm-icon-btn" onClick={() => { cancelPreview(); ui.set({ selection: null }); }} aria-label={tr('inspector.close')} data-testid="inspector-close"><Icon name="close" /></button>
      </header>
      <div className="hm-insp-body">{children}</div>
    </aside>
  );
}

const Expert = ({ children }: { children: ReactNode }) => (useUi((s) => s.mode === 'expert') ? <details className="hm-expert-box" data-testid="expert-details"><summary>{tr('inspector.technicalData')}</summary>{children}</details> : null);

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

/**
 * Position of a wall-mounted item: distance from the wall corner and height of its bottom edge, with 1 cm / 5 cm step buttons —
 * precise placement without aiming the pointer (phone, steep camera angles). Each press = one history entry.
 */
function MountControls({ roomId, id }: { roomId: string; id: string }) {
  useArrangement(roomId);
  const live = useDrag((s) => (s.mount && s.mount.id === id ? s.mount : null));
  const m = mountedNow(roomId, id);
  if (!m) return <p className="hm-muted" data-testid="mount-detached">{tr('inspector.mountDetached')}</p>;
  const along = live?.along ?? m.along, from = live?.from ?? m.from, height = live?.height ?? m.height, cm = (v: number) => Math.round(v * 100);
  // ◀ ▶ — in the direction seen ON SCREEN (like the arrow keys): the camera may look at the wall from behind; the readout is relative to the room
  const btn = (run: () => void, label: string, testid: string) => <button onClick={run} data-testid={testid} aria-label={label} title={label}>{label}</button>;
  const side = (dir: -1 | 1, by: number, label: string, testid: string) => btn(() => nudgeMountedSide(roomId, id, dir, by), label, testid);
  const step = (dv: number, label: string, testid: string) => btn(() => nudgeMounted(roomId, id, 0, dv), label, testid);
  return (
    <Block title={tr('inspector.onWall')} testid="mount">
      <div className="hm-mount-row" data-testid="mount-along-row">
        <span>{from === 'left' ? tr('inspector.fromLeftCorner') : tr('inspector.fromRightCorner')}</span>
        <div className="hm-stepper">
          {side(-1, MOUNT.nudge, '◀ 5', 'mount-left-5')}{side(-1, MOUNT.nudgeFine, '◀ 1', 'mount-left-1')}
          <b data-testid="mount-along">{cm(along)} cm</b>
          {side(1, MOUNT.nudgeFine, '1 ▶', 'mount-right-1')}{side(1, MOUNT.nudge, '5 ▶', 'mount-right-5')}
        </div>
      </div>
      <div className="hm-mount-row" data-testid="mount-height-row">
        <span>{tr('inspector.bottomHeight')}</span>
        <div className="hm-stepper">
          {step(-MOUNT.nudge, '▼ 5', 'mount-down-5')}{step(-MOUNT.nudgeFine, '▼ 1', 'mount-down-1')}
          <b data-testid="mount-height">{cm(height)} cm</b>
          {step(MOUNT.nudgeFine, '1 ▲', 'mount-up-1')}{step(MOUNT.nudge, '5 ▲', 'mount-up-5')}
        </div>
      </div>
      <p className="hm-muted">{tr('inspector.mountHelp')} <kbd>Alt</kbd> {tr('inspector.mountHelpKeys')}</p>
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
      {/* actions follow what the item can do: free-standing furniture — rotation; wall-mounted item — position on the wall (no rotation) */}
      <div className={`hm-actions${hung ? ' hung' : ''}`} data-testid="furniture-actions">
        {!hung && <>
          <button onClick={() => rotateBy(roomId, id, 15)} title={tr('inspector.rotLeft')} data-testid="rot-left"><Icon name="rotl" /> 15°</button>
          <button onClick={() => rotateBy(roomId, id, -15)} title={tr('inspector.rotRight')} data-testid="rot-right"><Icon name="rotr" /> 15°</button>
          <button onClick={() => rotateBy(roomId, id, -45)} title={tr('inspector.rot45')} data-testid="rot-45">45°</button>
          <button onClick={() => rotateBy(roomId, id, -90)} title={tr('inspector.rot90')} data-testid="rot-90">90°</button>
        </>}
        <button onClick={() => duplicateSelected(roomId, id)} title={tr('inspector.duplicateTitle')} data-testid="duplicate"><Icon name="copy" /> {tr('inspector.duplicate')}</button>
        <button className="danger" onClick={() => deleteFurniture(roomId, id)} title={tr('inspector.deleteTitle')} data-testid="delete"><Icon name="trash" /> {tr('inspector.delete')}</button>
      </div>
      {hung ? <MountControls roomId={roomId} id={id} />
        : <p className="hm-muted">{tr('inspector.dragHelp')} <kbd>Alt</kbd> {tr('inspector.dragHelpAlt')}</p>}
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
      <Block title={tr('inspector.rotation')}>
        <Slider label={tr('inspector.angle')} value={p.rot} min={0} max={359} step={1} unit="°" k={1} testid="rot"
          onCommit={(v) => patchFurniture(roomId, id, tr('inspector.hist.rotation', { name }), { rot: round(v, 1) })} />
      </Block>
      {mode === 'expert' && (
        <Expert>
          <dl className="hm-kv"><dt>id</dt><dd>{p.id}</dd><dt>{tr('inspector.kv.catalog')}</dt><dd>{p.catalogId}{p.variant ? ` / ${p.variant}` : ''}</dd>
            <dt>X, Y (LCS)</dt><dd>{p.x.toFixed(3)}, {p.y.toFixed(3)} m</dd><dt>{tr('inspector.kv.rotation')}</dt><dd>{p.rot.toFixed(1)}°</dd><dt>{tr('inspector.kv.source')}</dt><dd>{item.source}</dd><dt>{tr('inspector.kv.license')}</dt><dd>{item.license}</dd></dl>
          <textarea readOnly className="hm-json" rows={8} value={JSON.stringify(p, null, 1)} />
        </Expert>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ surfaces
const SIZE_PRESETS: [number, number][] = [[0.3, 0.3], [0.3, 0.6], [0.6, 0.6], [0.6, 1.2], [0.8, 0.8], [1.2, 1.2], [0.2, 0.2], [0.1, 0.3]];
const patterns = (): [NonNullable<FinishLayout['pattern']>, string][] => [['straight', tr('inspector.patternStraight')], ['half', tr('inspector.patternHalf')], ['third', tr('inspector.patternThird')], ['random', tr('inspector.patternRandom')]];
const cmTxt = (s: [number, number]) => `${Math.round(s[0] * 100)} × ${Math.round(s[1] * 100)}`;

function LayoutEditor({ m, f, onChange }: { m: MaterialDef; f: FinishRef; onChange: (layout: FinishLayout, label: string, commit: boolean) => void }) {
  const keys = editableLayout(m), L = f.layout ?? {}, t = effectiveTexture(m, L);
  if (!keys.length) return null;
  const set = (patch: Partial<FinishLayout>, label: string, commit = true) => onChange({ ...L, ...patch }, label, commit);
  const PATTERNS = patterns();
  return (
    <Block title={isTiled(m) ? tr('inspector.layoutTiles') : isPlanks(m) ? tr('inspector.layoutPlanks') : isParquet(m) ? tr('inspector.layoutParquet') : tr('inspector.layoutPattern')} testid="layout">
      {keys.includes('size') && (
        <div className="hm-field"><span>{tr('inspector.tileSize')}</span>
          <div className="hm-chips small">
            {SIZE_PRESETS.map((s) => <button key={cmTxt(s)} className={Math.abs(t.size[0] - s[0]) < 1e-6 && Math.abs(t.size[1] - s[1]) < 1e-6 ? 'on' : ''} onClick={() => set({ size: s }, tr('inspector.hist.tiles', { size: cmTxt(s) }))} data-testid={`tile-${cmTxt(s).replace(/ /g, '')}`}>{cmTxt(s)}</button>)}
          </div>
        </div>
      )}
      {keys.includes('grout') && <Slider label={tr('inspector.grout')} value={t.grout ?? 0} min={LAYOUT_LIMITS.grout[0]} max={LAYOUT_LIMITS.grout[1]} step={0.0005} unit="mm" k={1000} digits={1} onCommit={(v) => set({ grout: v }, tr('inspector.hist.groutWidth'))} testid="grout" />}
 {keys.includes('boardWidth') && <Slider label={isParquet(m) ? tr('inspector.stripWidth') : tr('inspector.boardWidth')} value={t.boardWidth!} min={LAYOUT_LIMITS.boardWidth[0]} max={LAYOUT_LIMITS.boardWidth[1]} step={0.005} onCommit={(v) => set({ boardWidth: v }, tr('inspector.hist.boardWidth'))} testid="board-w" />}
 {keys.includes('boardLength') && <Slider label={isParquet(m) ? tr('inspector.stripLength') : tr('inspector.boardLength')} value={t.boardLength!} min={LAYOUT_LIMITS.boardLength[0]} max={LAYOUT_LIMITS.boardLength[1]} step={0.01} onCommit={(v) => set({ boardLength: v }, tr('inspector.hist.boardLength'))} testid="board-l" />}
      {keys.includes('pattern') && <div className="hm-field"><span>{tr('inspector.rowOffset')}</span><Seg wide value={(t.pattern ?? 'straight') as NonNullable<FinishLayout['pattern']>} options={PATTERNS} onChange={(v) => set({ pattern: v }, tr('inspector.hist.boardPattern', { pattern: PATTERNS.find((p) => p[0] === v)![1] }))} testid="pattern" /></div>}
      {keys.includes('rotation') && <div className="hm-field"><span>{isPlanks(m) || isParquet(m) ? tr('inspector.direction') : tr('inspector.patternRotation')}</span><Seg wide value={L.rotation ?? 0} options={[[0, '0°'], [45, '45°'], [90, '90°']]} onChange={(v) => set({ rotation: v }, tr('inspector.hist.patternRotation', { deg: v }))} testid="pattern-rot" /></div>}
      {keys.includes('offset') && (
        <>
          <Slider label={tr('inspector.offsetAlong')} value={L.offset?.[0] ?? 0} min={-1} max={1} step={0.01} onCommit={(v) => set({ offset: [v, L.offset?.[1] ?? 0] }, tr('inspector.hist.patternOffset'))} testid="offset-x" />
          <Slider label={tr('inspector.offsetAcross')} value={L.offset?.[1] ?? 0} min={-1} max={1} step={0.01} onCommit={(v) => set({ offset: [L.offset?.[0] ?? 0, v] }, tr('inspector.hist.patternOffset'))} testid="offset-y" />
        </>
      )}
      <p className="hm-muted">{tr('inspector.realScale', { size: cmTxt(t.size) })}{isTiled(m) ? ` · ${tr('inspector.groutMm', { mm: fmtNum((t.grout ?? 0) * 1000, 1) })}` : ''}.</p>
    </Block>
  );
}

function SurfaceInspector({ room, kind, wallId }: { room: HomeRoom; kind: 'wall' | 'floor' | 'ceiling'; wallId?: string }) {
  const a = useArrangement(room.id);
  const scope = useUi((s) => s.wallScope);
  const selIds = useUi((s) => selectedWallIds(s.selection).join(','));
  const wallIds = kind === 'wall' ? (selIds ? selIds.split(',') : [wallId!]) : [];
  const recent = useUi((s) => s.recentColors);
  const neutralOn = useUi((s) => s.neutralInterior);
  const wall = kind === 'wall' ? room.walls.find((w) => w.id === wallId) ?? room.walls[0] : null;
  const cur: FinishRef | null = kind === 'wall' ? a.finishes.walls[wall!.id] ?? null : kind === 'floor' ? a.finishes.floor : a.finishes.ceiling;
  const curMat = cur ? materialById(cur.materialId) : null;
  const cats = categoriesFor(kind);
  const [cat, setCat] = useState<string>(curMat?.category && cats.some((c) => c.id === curMat.category) ? curMat.category : cats[0]?.id);
  const target = kind === 'floor' ? { kind: 'floor' as const } : kind === 'ceiling' ? { kind: 'ceiling' as const } : scope === 'all' ? { kind: 'walls' as const, wallIds: room.walls.map((w) => w.id) } : { kind: 'walls' as const, wallIds };
  const apply = (ref: FinishRef | null, label?: string) => (kind === 'wall' && scope === 'house' ? applyWallsHouse(ref, label) : applyFinish(room, target, ref, label));
  const toggleWall = (id: string) => {
    const has = wallIds.includes(id), next = has ? wallIds.filter((x) => x !== id) : [...wallIds, id];
    if (next.length) ui.set({ selection: { kind: 'wall', roomId: room.id, wallId: next[next.length - 1], wallIds: next }, wallScope: 'one' });
  };
  const mats = materialsFor(kind, [cat]);
  const isPaint = cat === 'wall-paint';
  const paintBase = curMat && curMat.category === cat ? curMat.id : mats[0]?.id;
  const nSel = wallIds.length;
  const title = kind === 'floor' ? tr('inspector.floor') : kind === 'ceiling' ? tr('inspector.ceiling') : scope === 'house' ? tr('inspector.wallsWholeHome') : scope === 'all' ? tr('inspector.allWalls') : nSel > 1 ? tr('inspector.wallsN', { n: nSel }) : tr('inspector.wallN', { n: wall!.index });
  const sub = kind === 'wall'
    ? (scope === 'house' ? tr('inspector.wholeHomeRooms', { n: HOUSE_WALL_ROOMS().length }) : scope === 'all' ? tr('inspector.wallsCount', { n: room.walls.length, room: room.label })
      : nSel > 1 ? room.walls.filter((w) => wallIds.includes(w.id)).map((w) => w.index).join(', ') + ` · ${room.label}` : wall!.label.replace(/^[^·]+ · /, ''))
    : `${room.label} · ${fmtNum(room.area, 1)} m²`;
  return (
    <Panel testid={kind} title={title} sub={sub} img={<Icon name={kind === 'floor' ? 'grid' : kind === 'ceiling' ? 'top' : 'brush'} size={26} />}>
      {kind === 'wall' && (
        <>
          <Seg wide value={scope} options={[['one', nSel > 1 ? tr('inspector.scopeSelected', { n: nSel }) : tr('inspector.scopeOne')], ['all', tr('inspector.scopeRoom')], ['house', tr('inspector.scopeHome')]]} onChange={(v) => ui.set({ wallScope: v })} testid="wall-scope" />
          {scope === 'one' && (
            <div className="hm-field">
              <span>{tr('inspector.pickWalls')} <small className="hm-muted">{tr('inspector.pickWallsHint')}</small></span>
              <div className="hm-chips small" data-testid="wall-pick">
                {room.walls.map((w) => <button key={w.id} className={wallIds.includes(w.id) ? 'on' : ''} title={w.label} onClick={() => toggleWall(w.id)} data-testid={`wall-pick-${w.index}`}>{w.index}</button>)}
              </div>
            </div>
          )}
        </>
      )}
      <div className="hm-current" data-testid="finish-current">{tr('inspector.now')} <b>{curMat ? finishLabel(curMat.name, cur?.color) : neutralOn ? tr('inspector.neutralFinish', { name: materialById(neutralFinish(room.kind, kind).materialId)?.name ?? '' }) : kind === 'floor' ? tr('inspector.projectFinish') : tr('inspector.projectPaint')}</b>{cur?.color && <i style={{ background: cur.color }} />}</div>
      <div className="hm-chips" data-testid="mat-cats">
        {cats.map((c) => <button key={c.id} className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)} data-testid={`mcat-${c.id}`}>{categoryName(c.id)}</button>)}
      </div>
      {isPaint && (
        <Block title={tr('inspector.moreColors')} testid="paint">
          <Swatches value={cur?.color ?? (curMat?.category === cat ? curMat?.baseColor : null)} colors={PAINT_COLORS} recent={recent} testid="paint-colors"
            onPreview={(hex) => { const ref = { materialId: paintBase, color: hex }; if (kind === 'wall' && scope === 'house') previewWallsHouse(ref); else previewFinish(room, target, ref); }}
            onChange={(hex, name) => apply({ materialId: paintBase, color: hex }, tr('inspector.hist.paint', { what: title.toLowerCase(), color: name }))} />
        </Block>
      )}
      <div className="hm-mats" data-testid="materials">
        {mats.map((m) => (
          <button key={m.id} className={`hm-mat${cur?.materialId === m.id ? ' on' : ''}`} title={m.name} onClick={() => apply({ materialId: m.id, color: null, layout: null })} data-testid={`mat-${m.id}`}>
            <img src={materialThumbnail(m, 64)} alt="" /><span>{m.name}</span>
          </button>
        ))}
      </div>
      {cur && curMat && (
        <LayoutEditor m={curMat} f={cur} onChange={(layout, label, commit) => { if (commit) apply({ ...cur, layout }, label); }} />
      )}
      {cur && <button className="hm-link danger" onClick={() => apply(null, tr('inspector.hist.resetFinish', { what: title.toLowerCase() }))} data-testid="finish-reset">{tr('inspector.resetFinish')}</button>}
      <Expert>
        <dl className="hm-kv"><dt>{tr('inspector.kv.room')}</dt><dd>{room.id}</dd>{wall && <><dt>{tr('inspector.kv.wall')}</dt><dd>{wall.id} · {wall.length.toFixed(3)} m</dd></>}<dt>{tr('inspector.kv.material')}</dt><dd>{cur?.materialId ?? '—'}</dd>
          <dt>{tr('inspector.kv.scale')}</dt><dd>{curMat ? `${curMat.physicalSize.join(' × ')} m` : '—'}</dd></dl>
      </Expert>
    </Panel>
  );
}

// ------------------------------------------------------------------ room
function RoomInspector({ room }: { room: HomeRoom }) {
  return (
    <Panel testid="room" title={room.label} sub={`${fmtNum(room.area, 1)} m² · ${roomHeightText(room)}`} img={<Icon name="interior" size={26} />}>
      <button className="hm-btn primary wide" onClick={() => enterRoom(room.id, room.level)} data-testid="enter-room">{tr('inspector.enterRoom')}</button>
      <p className="hm-muted">{tr('inspector.roomOpenings', { windows: room.windows.length, doors: room.doors.length })}</p>
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
      <div className="hm-current" data-testid="door-state">{tr('inspector.now')} <b>{t <= 0 ? tr('inspector.doorClosed') : t >= 1 ? tr('inspector.doorOpen') : d.hinge ? tr('inspector.doorAjar', { deg }) : tr('inspector.doorSlid', { pct: Math.round(t * 100) })}</b></div>
      {d.hinge
        ? <Slider label={tr('inspector.openingAngle')} value={deg} min={0} max={d.openAngle ?? 90} step={5} unit="°" k={1} onPreview={(v) => setDoor(id, v / (d.openAngle ?? 90))} onCommit={(v) => setDoor(id, v / (d.openAngle ?? 90))} testid="door-angle" />
        : <Slider label={tr('inspector.slideOpen')} value={Math.round(t * 100)} min={0} max={100} step={5} unit="%" k={1} onPreview={(v) => setDoor(id, v / 100)} onCommit={(v) => setDoor(id, v / 100)} testid="door-angle" />}
      {!show && <p className="hm-note" data-testid="door-hidden-note">{tr('inspector.doorsHidden')} <button className="hm-link" onClick={() => setShowDoors(true)}>{tr('inspector.showDoors')}</button></p>}
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
    case 'wall': case 'floor': case 'ceiling': {
      const room = roomById(sel.roomId);
      return room ? <SurfaceInspector key={`${sel.kind}-${sel.roomId}`} room={room} kind={sel.kind} wallId={sel.kind === 'wall' ? sel.wallId : undefined} /> : null;
    }
    case 'room': { const room = roomById(sel.roomId); return room ? <RoomInspector room={room} /> : null; }
    // cards of module elements (stairs) — only in a project that has the module: the selection may come from a saved state
    case 'house': return mode === 'expert' ? <HouseInspector name={sel.name} data={sel.data} point={sel.point} /> : null;
    case 'door': return <DoorInspector key={sel.id} id={sel.id} />;
    case 'stairs': return hasStairs() ? <StairsInspector /> : null;
    case 'electrical': return <ElectricalInspector key={sel.id} id={sel.id} />;
  }
}
