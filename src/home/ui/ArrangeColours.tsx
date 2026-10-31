// ARRANGE › Colours: Walls | Floor | Ceiling, the kinds of finish, the palette with "Original" first, the materials. The whole room
// by default; a click on a wall in the scene chooses that wall only ("Walls" goes back to the whole room). Advanced mode adds the
// whole-home scope, several chosen walls and the tile / board layout (ADR 0038).
import { useState } from 'react';
import { applyFinish, applyWallsHouse, HOUSE_WALL_ROOMS, previewFinish, previewWallsHouse } from '../actions';
import {
  categoriesFor, categoryName, editableLayout, effectiveTexture, isParquet, isPlanks, isTiled, LAYOUT_LIMITS, materialById, materialsFor, neutralFinish, type MaterialDef,
} from '../catalog/materials';
import { wallLabel, type HomeRoom } from '../model/rooms';
import type { FinishLayout, FinishRef } from '../model/types';
import { useArrangement } from '../store/design';
import { selectedWallIds, ui, useUi } from '../store/ui';
import { materialThumbnail } from '../three/textures';
import { fmtNum, t } from '../../i18n';
import { Slot, useActionSlot } from './Action';
import { Block, finishLabel, PAINT_COLORS, Seg, Slider, Swatches } from './controls';

type Kind = 'wall' | 'floor' | 'ceiling';
const SIZE_PRESETS: [number, number][] = [[0.3, 0.3], [0.3, 0.6], [0.6, 0.6], [0.6, 1.2], [0.8, 0.8], [1.2, 1.2], [0.2, 0.2], [0.1, 0.3]];
const patterns = (): [NonNullable<FinishLayout['pattern']>, string][] => [['straight', t('inspector.patternStraight')], ['half', t('inspector.patternHalf')], ['third', t('inspector.patternThird')], ['random', t('inspector.patternRandom')]];
const cmTxt = (s: [number, number]) => `${Math.round(s[0] * 100)} × ${Math.round(s[1] * 100)}`;

/** tile / board layout of the chosen material (advanced mode) */
function LayoutEditor({ m, f, onChange }: { m: MaterialDef; f: FinishRef; onChange: (layout: FinishLayout, label: string) => void }) {
  const keys = editableLayout(m), L = f.layout ?? {}, tx = effectiveTexture(m, L);
  if (!keys.length) return null;
  const set = (patch: Partial<FinishLayout>, label: string) => onChange({ ...L, ...patch }, label);
  const PATTERNS = patterns();
  return (
    <Block title={isTiled(m) ? t('inspector.layoutTiles') : isPlanks(m) ? t('inspector.layoutPlanks') : isParquet(m) ? t('inspector.layoutParquet') : t('inspector.layoutPattern')} testid="layout">
      {keys.includes('size') && (
        <div className="hm-field"><span>{t('inspector.tileSize')}</span>
          <div className="hm-chips small">
            {SIZE_PRESETS.map((s) => <button key={cmTxt(s)} className={Math.abs(tx.size[0] - s[0]) < 1e-6 && Math.abs(tx.size[1] - s[1]) < 1e-6 ? 'on' : ''} onClick={() => set({ size: s }, t('inspector.hist.tiles', { size: cmTxt(s) }))} data-testid={`tile-${cmTxt(s).replace(/ /g, '')}`}>{cmTxt(s)}</button>)}
          </div>
        </div>
      )}
      {keys.includes('grout') && <Slider label={t('inspector.grout')} value={tx.grout ?? 0} min={LAYOUT_LIMITS.grout[0]} max={LAYOUT_LIMITS.grout[1]} step={0.0005} unit="mm" k={1000} digits={1} onCommit={(v) => set({ grout: v }, t('inspector.hist.groutWidth'))} testid="grout" />}
      {keys.includes('boardWidth') && <Slider label={isParquet(m) ? t('inspector.stripWidth') : t('inspector.boardWidth')} value={tx.boardWidth!} min={LAYOUT_LIMITS.boardWidth[0]} max={LAYOUT_LIMITS.boardWidth[1]} step={0.005} onCommit={(v) => set({ boardWidth: v }, t('inspector.hist.boardWidth'))} testid="board-w" />}
      {keys.includes('boardLength') && <Slider label={isParquet(m) ? t('inspector.stripLength') : t('inspector.boardLength')} value={tx.boardLength!} min={LAYOUT_LIMITS.boardLength[0]} max={LAYOUT_LIMITS.boardLength[1]} step={0.01} onCommit={(v) => set({ boardLength: v }, t('inspector.hist.boardLength'))} testid="board-l" />}
      {keys.includes('pattern') && <div className="hm-field"><span>{t('inspector.rowOffset')}</span><Seg wide value={(tx.pattern ?? 'straight') as NonNullable<FinishLayout['pattern']>} options={PATTERNS} onChange={(v) => set({ pattern: v }, t('inspector.hist.boardPattern', { pattern: PATTERNS.find((p) => p[0] === v)![1] }))} testid="pattern" /></div>}
      {keys.includes('rotation') && <div className="hm-field"><span>{isPlanks(m) || isParquet(m) ? t('inspector.direction') : t('inspector.patternRotation')}</span><Seg wide value={L.rotation ?? 0} options={[[0, '0°'], [45, '45°'], [90, '90°']]} onChange={(v) => set({ rotation: v }, t('inspector.hist.patternRotation', { deg: v }))} testid="pattern-rot" /></div>}
      {keys.includes('offset') && <>
        <Slider label={t('inspector.offsetAlong')} value={L.offset?.[0] ?? 0} min={-1} max={1} step={0.01} onCommit={(v) => set({ offset: [v, L.offset?.[1] ?? 0] }, t('inspector.hist.patternOffset'))} testid="offset-x" />
        <Slider label={t('inspector.offsetAcross')} value={L.offset?.[1] ?? 0} min={-1} max={1} step={0.01} onCommit={(v) => set({ offset: [L.offset?.[0] ?? 0, v] }, t('inspector.hist.patternOffset'))} testid="offset-y" />
      </>}
      <p className="hm-muted">{t('inspector.realScale', { size: cmTxt(tx.size) })}{isTiled(m) ? ` · ${t('inspector.groutMm', { mm: fmtNum((tx.grout ?? 0) * 1000, 1) })}` : ''}.</p>
    </Block>
  );
}

/** the surface the tab works on: the selection when it is a surface of this room; nothing chosen — the walls of the whole room */
function useSurface(room: HomeRoom): { kind: Kind; wallIds: string[]; one: boolean } {
  const sel = useUi((s) => s.selection), scope = useUi((s) => s.wallScope);
  const mine = sel && 'roomId' in sel && sel.roomId === room.id && (sel.kind === 'wall' || sel.kind === 'floor' || sel.kind === 'ceiling') ? sel : null;
  if (mine?.kind === 'wall' && scope === 'one') return { kind: 'wall', wallIds: selectedWallIds(mine), one: true };
  if (!mine || mine.kind === 'wall') return { kind: 'wall', wallIds: room.walls.map((w) => w.id), one: false };
  return { kind: mine.kind as Kind, wallIds: [], one: false };
}

function SurfacePick({ room, kind, one }: { room: HomeRoom; kind: Kind; one: boolean }) {
  const a = useActionSlot('surface');
  if (!a.shown) return null;
  // "Walls": the whole room (no single wall chosen); a wall alone is chosen by clicking it in the scene
  const pick = (k: Kind) => ui.set(k === 'wall' ? { selection: null, wallScope: ui.get().wallScope === 'house' ? 'house' : 'all' } : { selection: { kind: k, roomId: room.id } });
  const opts: [Kind, string, string][] = [['wall', t('steps.walls'), 'surface-walls'], ['floor', t('steps.floor'), 'surface-floor'], ['ceiling', t('steps.ceiling'), 'surface-ceiling']];
  return (
    <div className="hm-seg wide" data-testid={a.testid} role="radiogroup" aria-label={a.label}>
      {opts.map(([k, label, id]) => (
        <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} data-value={k} data-testid={id}
          onClick={() => pick(k)}>{k === 'wall' && one ? t('steps.thisWall') : label}</button>
      ))}
    </div>
  );
}

export function ArrangeColours({ room }: { room: HomeRoom }) {
  const a = useArrangement(room.id);
  const { kind, wallIds, one } = useSurface(room);
  const scope = useUi((s) => s.wallScope), advanced = useUi((s) => s.mode === 'advanced');
  const recent = useUi((s) => s.recentColors), neutralOn = useUi((s) => s.neutralInterior);
  const wall = kind === 'wall' ? room.walls.find((w) => w.id === wallIds[0]) ?? room.walls[0] : null;
  const cur: FinishRef | null = kind === 'wall' ? a.finishes.walls[wall!.id] ?? null : kind === 'floor' ? a.finishes.floor : a.finishes.ceiling;
  const curMat = cur ? materialById(cur.materialId) : null;
  const cats = categoriesFor(kind);
  const [catPick, setCat] = useState<string | null>(null);
  const cat = catPick && cats.some((c) => c.id === catPick) ? catPick : curMat?.category && cats.some((c) => c.id === curMat.category) ? curMat.category : cats[0]?.id;
  const target = kind === 'floor' ? { kind: 'floor' as const } : kind === 'ceiling' ? { kind: 'ceiling' as const } : { kind: 'walls' as const, wallIds };
  const house = kind === 'wall' && !one && scope === 'house' && advanced;
  const apply = (ref: FinishRef | null, label?: string) => (house ? applyWallsHouse(ref, label) : applyFinish(room, target, ref, label));
  const mats = materialsFor(kind, [cat]);
  const isPaint = cat === 'wall-paint';
  const paintBase = curMat && curMat.category === cat ? curMat.id : mats[0]?.id;
  const what = kind === 'floor' ? t('steps.floor') : kind === 'ceiling' ? t('steps.ceiling') : one ? t('steps.thisWall') : t('steps.walls');
  const original = (
    <button type="button" className={`hm-sw hm-sw-original${cur ? '' : ' on'}`} onClick={() => apply(null, t('inspector.hist.resetFinish', { what: what.toLowerCase() }))} data-testid="swatch-original" title={t('steps.original')}>
      <span>{t('steps.original')}</span>
    </button>
  );
  const toggleWall = (id: string) => {
    const has = wallIds.includes(id), next = has ? wallIds.filter((x) => x !== id) : [...wallIds, id];
    if (next.length) ui.set({ selection: { kind: 'wall', roomId: room.id, wallId: next[next.length - 1], wallIds: next }, wallScope: 'one' });
  };
  return (
    <div className="hm-colours" data-testid="colours">
      <Slot place="arrange.colours"><SurfacePick room={room} kind={kind} one={one} /></Slot>
      <div className="hm-current" data-testid="finish-current">{t('inspector.now')} <b>{curMat ? finishLabel(curMat.name, cur?.color) : neutralOn ? t('inspector.neutralFinish', { name: materialById(neutralFinish(room.kind, kind).materialId)?.name ?? '' }) : t('steps.original')}</b>{cur?.color && <i style={{ background: cur.color }} />}</div>
      {advanced && kind === 'wall' && (
        <Block title={t('inspector.pickWalls')} testid="wall-options">
          <Seg wide value={scope} options={[['one', wallIds.length > 1 ? t('inspector.scopeSelected', { n: wallIds.length }) : t('inspector.scopeOne')], ['all', t('inspector.scopeRoom')], ['house', t('inspector.scopeHome')]]} onChange={(v) => ui.set({ wallScope: v })} testid="wall-scope" />
          {scope === 'one' && <div className="hm-chips small" data-testid="wall-pick">
            {room.walls.map((w) => <button key={w.id} className={wallIds.includes(w.id) ? 'on' : ''} title={wallLabel(w)} onClick={() => toggleWall(w.id)} data-testid={`wall-pick-${w.index}`}>{w.index}</button>)}
          </div>}
          {scope === 'house' && <p className="hm-muted">{t('inspector.wholeHomeRooms', { n: HOUSE_WALL_ROOMS().length })}</p>}
        </Block>
      )}
      <div className="hm-chips row" data-testid="mat-cats">
        {cats.map((c) => <button key={c.id} type="button" className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)} data-testid={`mcat-${c.id}`}>{categoryName(c.id)}</button>)}
      </div>
      {isPaint && (
        <div className="hm-palette" data-testid="palette">
          {original}
          <Swatches value={cur?.color ?? (curMat?.category === cat ? curMat?.baseColor : null)} colors={PAINT_COLORS} recent={recent} testid="paint-colors"
            onPreview={(hex) => { const ref = { materialId: paintBase, color: hex }; if (house) previewWallsHouse(ref); else previewFinish(room, target, ref); }}
            onChange={(hex, name) => apply({ materialId: paintBase, color: hex }, t('inspector.hist.paint', { what: what.toLowerCase(), color: name }))} />
        </div>
      )}
      <div className="hm-mats" data-testid="materials">
        {!isPaint && original}
        {mats.map((m) => (
          <button key={m.id} type="button" className={`hm-mat${cur?.materialId === m.id && !cur?.color ? ' on' : ''}`} title={m.name} onClick={() => apply({ materialId: m.id, color: null, layout: null })} data-testid={`mat-${m.id}`}>
            <img src={materialThumbnail(m, 64)} alt="" /><span>{m.name}</span>
          </button>
        ))}
      </div>
      {advanced && cur && curMat && <LayoutEditor m={curMat} f={cur} onChange={(layout, label) => apply({ ...cur, layout }, label)} />}
    </div>
  );
}
