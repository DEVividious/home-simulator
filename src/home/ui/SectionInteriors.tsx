// INTERIORS section: (1) outside a room — levels, plan and room list (click = enter the room);
// (2) inside a room — view (3D / top / walk), arrangements (save as, copy as, list), layout proposals
// (office / guest room / hybrid — furniture only, room geometry unchanged), furniture in the room.
import { useState } from 'react';
import { displayName, sizeLabel, resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { furnitureThumbnail } from '../catalog/thumbnails';
import {
  applyArchitectLayout, applyKitchen, applyScenario, clearRoom, deleteArr, deleteFurniture, duplicateArrangementAs, enterRoom, exitRoom, goSection, loadArr, newArr, renameArr,
  saveArrangementAs, setLevel, setRoomView, exitCompare, startRoomCompare,
} from '../actions';
import { SCENARIOS } from '../model/placement';
import { allLevels, levelName, roomById, roomsOfLevel, type HomeRoom } from '../model/rooms';
import { architectFurniture, hasArchitectLayout, isArchitectId, kitchenBuiltIn } from '../model/defaults';
import { hasStairs } from '../model/stairs';
import { project } from '../../project/active';
import type { LevelId, RoomView } from '../model/types';
import { interiorOfRoom, useArrangement, useDesign, variantOf } from '../store/design';
import { ui, useUi } from '../store/ui';
import { Block, Empty, NameInput, Seg } from './controls';
import { DoorsPanelToggle } from './DoorsToggle';
import { LevelPlan } from './FloorPlan';
import { Icon, ROOM_ICON } from './icons';
import { fmtM, fmtNum, t } from '../../i18n';

const m2 = (x: number) => `${fmtNum(x, 1)} m²`;

export function roomHeightText(r: HomeRoom) {
  if (r.ceiling.kind === 'flat') return t('interiorsUi.heightFlat', { h: fmtM(r.ceiling.heightAt(r.center[0], r.center[1])) });
  return t('interiorsUi.heightSloped', { h: fmtM(r.ceiling.range()[1]) });
}

/** phone: three large, unambiguous room modes (a function: labels follow the UI language) */
export const VIEW_OPTIONS_TOUCH = (): [RoomView, React.ReactNode, string][] => [
  ['3d', <><Icon name="cube" size={18} /> 3D</>, t('interiorsUi.view3dTitleTouch')],
  ['top', <><Icon name="top" size={18} /> {t('interiorsUi.viewPlan')}</>, t('interiorsUi.viewTopTitle')],
  ['walk', <><Icon name="walk" size={18} /> {t('interiorsUi.viewWalk')}</>, t('interiorsUi.viewWalkTitleTouch')],
];
export const VIEW_OPTIONS = (): [RoomView, React.ReactNode, string][] => [
  ['3d', <><Icon name="cube" size={16} /> 3D</>, t('interiorsUi.view3dTitle')],
  ['top', <><Icon name="top" size={16} /> {t('interiorsUi.viewTop')}</>, t('interiorsUi.viewTopTitle')],
  ['walk', <><Icon name="walk" size={16} /> {t('interiorsUi.viewWalk')}</>, t('interiorsUi.viewWalkTitle', { h: fmtM(1.68) })],
];

export function LevelView({ tip: tipProp }: { tip?: string }) {
  const tip = tipProp ?? t('interiorsUi.levelTip');
  const level = useUi((s) => s.level);
  const hover = useUi((s) => s.hoverRoom);
  const interiors = useDesign((s) => variantOf(s).interiors);
  const rooms = roomsOfLevel(level).slice().sort((a, b) => b.area - a.area);
  const count = (id: string) => { const ri = interiors?.[id]; const a = ri?.arrangements.find((x) => x.id === ri.activeArrangementId); return a?.furniture.length ?? 0; };
  return (
    <>
      {allLevels().length > 1 && <Seg wide value={level} options={allLevels().map((l) => [l.id, l.name] as [LevelId, string])} onChange={setLevel} testid="level-switch" />}
      <div className="hm-tip" data-testid="tip-rooms"><Icon name="info" size={16} /> {tip}</div>
      <LevelPlan level={level} onRoom={(r) => enterRoom(r.id, r.level)} />
      <DoorsPanelToggle testid="doors-toggle-level" />
      {/* stair finishes — only in a project that has stairs */}
      {hasStairs() && <button className="hm-btn wide" onClick={() => ui.set({ selection: { kind: 'stairs' } })} data-testid="stairs-open"><Icon name="interior" size={18} /> {t('interiorsUi.stairsOpen')}</button>}
      <div className="hm-list" data-testid="room-list">
        {rooms.map((r) => (
          <button key={r.id} className={`hm-room${hover === r.id ? ' on' : ''}`} data-testid={`room-${r.id}`}
            onPointerEnter={() => ui.set({ hoverRoom: r.id })} onPointerLeave={() => ui.get().hoverRoom === r.id && ui.set({ hoverRoom: null })}
            onClick={() => enterRoom(r.id, r.level)}>
            <span className="hm-room-ico"><Icon name={ROOM_ICON[r.kind] ?? 'interior'} size={20} /></span>
            <span className="hm-room-txt"><b>{r.label}</b><small>{m2(r.area)}{count(r.id) ? ` · ${t('interiorsUi.furnitureCount', { n: count(r.id) })}` : ''}</small></span>
            <span className="hm-room-go">›</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function Arrangements({ room }: { room: HomeRoom }) {
  const ri = useDesign((s) => interiorOfRoom(s, room.id));
  const [mode, setMode] = useState<'save' | 'copy' | { rename: string } | null>(null);
  const active = ri.arrangements.find((a) => a.id === ri.activeArrangementId) ?? ri.arrangements[0];
  return (
    <Block title={t('interiorsUi.arrangement')} testid="arrangements">
      <div className="hm-arr-head">
        <div><b data-testid="arr-active">{active.name}</b><small>{active.saved ? t('interiorsUi.arrSaved') : t('interiorsUi.arrDraft')}</small></div>
      </div>
      {mode === 'save' && <NameInput initial={active.saved ? active.name : ''} placeholder={t('interiorsUi.arrNamePlaceholderA')} button={t('interiorsUi.save')} onSubmit={(n) => { saveArrangementAs(room.id, n); setMode(null); }} onCancel={() => setMode(null)} testid="arr-save-name" />}
      {mode === 'copy' && <NameInput initial="" placeholder={t('interiorsUi.arrNamePlaceholderB')} button={t('interiorsUi.copy')} onSubmit={(n) => { duplicateArrangementAs(room.id, n); setMode(null); }} onCancel={() => setMode(null)} testid="arr-copy-name" />}
      {mode && typeof mode === 'object' && <NameInput initial={ri.arrangements.find((a) => a.id === mode.rename)?.name} button={t('interiorsUi.rename')} onSubmit={(n) => { renameArr(room.id, mode.rename, n); setMode(null); }} onCancel={() => setMode(null)} testid="arr-rename-name" />}
      {!mode && (
        <div className="hm-btn-row">
          <button className="hm-btn" onClick={() => setMode('save')} data-testid="arr-save"><Icon name="save" size={16} /> {t('interiorsUi.saveAs')}</button>
          <button className="hm-btn" onClick={() => setMode('copy')} data-testid="arr-copy"><Icon name="copy" size={16} /> {t('interiorsUi.copyAs')}</button>
          <button className="hm-btn ghost" onClick={() => newArr(room.id, t('interiorsUi.newArrangementName'))} data-testid="arr-new" title={t('interiorsUi.emptyArrangement')}><Icon name="plus" size={16} /></button>
        </div>
      )}
      {ri.arrangements.length > 1 && <RoomCompare room={room} />}
      {ri.arrangements.length > 1 && (
        <div className="hm-list" data-testid="arr-list">
          {ri.arrangements.map((a) => (
            <div key={a.id} className={`hm-row${a.id === active.id ? ' on' : ''}`}>
              <button className="hm-row-main" onClick={() => loadArr(room.id, a.id)} data-testid={`arr-${a.name}`}>
                <span className="hm-radio" />{a.name}<small>{t('interiorsUi.furnitureCount', { n: a.furniture.length })}</small>
              </button>
              <button className="hm-icon-btn" title={t('interiorsUi.renameTitle')} onClick={() => setMode({ rename: a.id })} data-testid={`arr-rename-${a.name}`}>✎</button>
              <button className="hm-icon-btn" title={t('interiorsUi.deleteArrangement')} onClick={() => deleteArr(room.id, a.id)} data-testid={`arr-delete-${a.name}`}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

/** comparison of two arrangements of a room (e.g. Office A vs Office B) — split screen */
function RoomCompare({ room }: { room: HomeRoom }) {
  const ri = useDesign((s) => interiorOfRoom(s, room.id));
  const cmp = useUi((s) => (s.compare?.kind === 'room' && s.compare.roomId === room.id ? s.compare : null));
  const list = ri.arrangements;
  const [a, setA] = useState(list[0].id), [b, setB] = useState(list[1]?.id ?? list[0].id);
  const ok = (id: string) => list.some((x) => x.id === id);
  const A = ok(a) ? a : list[0].id, B = ok(b) && b !== A ? b : (list.find((x) => x.id !== A) ?? list[0]).id;
  return (
    <div className="hm-compare-pick" data-testid="arr-compare">
      <b>A</b><select value={A} onChange={(e) => setA(e.target.value)} data-testid="arr-compare-a">{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <b className="b">B</b><select value={B} onChange={(e) => setB(e.target.value)} data-testid="arr-compare-b">{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <span />
      {cmp ? <button className="hm-btn" onClick={exitCompare} data-testid="arr-compare-exit">{t('interiorsUi.compareEnd')}</button>
        : <button className="hm-btn" onClick={() => startRoomCompare(room.id, A, B)} data-testid="arr-compare-start">⇆ {t('interiorsUi.compareStart')}</button>}
    </div>
  );
}

/** furnishings from the project plans: what is in the current arrangement; restoring the project layout as a new arrangement */
function ArchitectLayout({ room }: { room: HomeRoom }) {
  const a = useArrangement(room.id);
  if (!hasArchitectLayout(room.id)) return null;
  const total = architectFurniture(room.id).length, inArr = a.furniture.filter((f) => isArchitectId(f.id)).length;
  // built-in kitchen to insert: a room tagged "kitchen" whose project layout has a kitchen group
  const kitchen = room.tags.includes('kitchen') && kitchenBuiltIn(room).length > 0;
  return (
    <Block title={t('interiorsUi.projectFurnishings')} testid="architect-layout">
      <p className="hm-muted" data-testid="architect-count">
        {project().interiors.notes?.[room.id] ?? t('interiorsUi.projectFurnishingsDefault')}
        {' '}{t('interiorsUi.inArrangement')} <b>{t('interiorsUi.inArrangementCount', { n: inArr, total })}</b> {t('interiorsUi.inArrangementRest')}
      </p>
      <div className="hm-col">
        <button className="hm-btn wide" onClick={() => applyArchitectLayout(room.id)} data-testid="architect-apply"><Icon name="interior" size={18} /> {t('interiorsUi.applyProjectLayout')}</button>
        {kitchen && <button className="hm-btn wide" onClick={() => applyKitchen(room.id)} data-testid="kitchen-builtin"><Icon name="kitchen" size={18} /> {t('interiorsUi.insertKitchen')}</button>}
      </div>
    </Block>
  );
}

function Proposals({ room }: { room: HomeRoom }) {
  const kind = room.kind;
  if (!['office', 'bed', 'room'].includes(kind) || room.area < 7) return null;
  return (
    <Block title={t('interiorsUi.proposals')} testid="proposals">
      <p className="hm-muted">{t('interiorsUi.proposalsHint')}</p>
      <div className="hm-proposals">
        {SCENARIOS.map((s) => (
          <button key={s.id} className="hm-proposal" onClick={() => applyScenario(room.id, s.id)} data-testid={`scenario-${s.id}`} title={s.description}>
            <Icon name={s.id === 'office' ? 'desk' : s.id === 'guest' ? 'bed' : 'sofa'} size={22} /><b>{s.label}</b>
          </button>
        ))}
      </div>
    </Block>
  );
}


function FurnitureList({ room }: { room: HomeRoom }) {
  const ri = useDesign((s) => interiorOfRoom(s, room.id));
  const a = ri.arrangements.find((x) => x.id === ri.activeArrangementId) ?? ri.arrangements[0];
  const sel = useUi((s) => (s.selection?.kind === 'furniture' ? s.selection.id : null));
  return (
    <Block title={t('interiorsUi.furnitureInRoom', { n: a.furniture.length })} right={<button className="hm-link" onClick={() => goSection('furniture')} data-testid="add-furniture"><Icon name="plus" size={14} /> {t('interiorsUi.add')}</button>}>
      {!a.furniture.length && <Empty icon={<Icon name="sofa" size={28} />} title={t('interiorsUi.emptyRoomTitle')} testid="empty-room">{t('interiorsUi.emptyRoomText')}</Empty>}
      <div className="hm-list">
        {a.furniture.map((f) => {
          const it = itemById(f.catalogId);
          if (!it) return null;
          return (
            <div key={f.id} className={`hm-row${sel === f.id ? ' on' : ''}`}>
              <button className="hm-row-main" onClick={() => ui.set({ selection: { kind: 'furniture', roomId: room.id, id: f.id } })} data-testid={`furn-${f.catalogId}`}>
                <img src={furnitureThumbnail(it, f.variant, f.materialId)} alt="" className="hm-row-img" />{displayName(it, f)}<small>{sizeLabel(resolveDims(it, f))}</small>
              </button>
              <button className="hm-icon-btn" title={t('interiorsUi.delete')} onClick={() => deleteFurniture(room.id, f.id)}><Icon name="trash" size={14} /></button>
            </div>
          );
        })}
      </div>
      {a.furniture.length > 1 && <button className="hm-link danger" onClick={() => clearRoom(room.id)} data-testid="clear-room">{t('interiorsUi.clearRoom')}</button>}
    </Block>
  );
}

export function RoomHeader({ room }: { room: HomeRoom }) {
  const view = useUi((s) => s.roomView);
  return (
    <div className="hm-room-head">
      <button className="hm-back" onClick={exitRoom} data-testid="exit-room"><Icon name="back" size={16} /> {levelName(room.level)}</button>
      <h2 data-testid="room-title">{room.label}</h2>
      <p className="hm-muted">{m2(room.area)} · {roomHeightText(room)}</p>
      <Seg wide value={view} options={VIEW_OPTIONS()} onChange={setRoomView} testid="room-view" />
      {view !== 'walk' && (
        <button className="hm-btn wide" onClick={() => setRoomView('walk')} title={t('interiorsUi.walkInsideTitle')} data-testid="walk-inside-room">
          <Icon name="walk" size={16} /> {t('interiorsUi.walkInside')}
        </button>
      )}
    </div>
  );
}

export function SectionInteriors() {
  const room = roomById(useUi((s) => s.roomId));
  return (
    <div className="hm-section" data-testid="section-interiors">
      {!room ? <LevelView /> : (
        <>
          <RoomHeader room={room} />
          <Arrangements room={room} />
          <Proposals room={room} />
          <ArchitectLayout room={room} />
          <FurnitureList room={room} />
        </>
      )}
    </div>
  );
}
