// ARRANGE step (ADR 0036): without a room — choose one (big buttons per level and the plan of the level shown); in a room —
// Furniture | Colours. Furniture: search, up to eight category chips, the catalogue cards (click or tap adds at a free spot, drag
// places), "Start from", "In this room", "Add your own…". Room arrangements only in advanced mode (ADR 0042).
import { useMemo, useState } from 'react';
import { FURNITURE_CATEGORIES, displayName, inCategory, resolveDims, sizeLabel, type CatalogItem } from '../catalog/furniture';
import { catalogItems, itemById } from '../catalog/providers';
import { furnitureThumbnail } from '../catalog/thumbnails';
import {
  deleteArr, duplicateArrangementAs, enterRoom, exitCompare, loadArr, newArr, renameArr, saveArrangementAs, startRoomCompare,
} from '../actions';
import { allLevels, roomById, roomsOfLevel, type HomeRoom } from '../model/rooms';
import { hasStairs } from '../model/stairs';
import { addToRoom, startCatalogDrag } from '../scene/interaction';
import { interiorOfRoom, useArrangement, useDesign, useDoc } from '../store/design';
import { toast, ui, useUi } from '../store/ui';
import { fmtNum, t } from '../../i18n';
import { ActionButton, Slot, useActionSlot } from './Action';
import { ArrangeColours } from './ArrangeColours';
import { Block, Empty, NameInput, Seg } from './controls';
import { LevelPlan } from './FloorPlan';
import { Icon, ROOM_ICON } from './icons';
import { ImportDialog } from './ImportDialog';

const m2 = (x: number) => `${fmtNum(x, 1)} m²`;
const CAT_ICON: Record<string, string> = { living: 'sofa', dining: 'desk', kitchen: 'kitchen', bedroom: 'bed', office: 'desk', bathroom: 'bath', storage: 'box', garage: 'garage', decor: 'plant', imported: 'upload' };
/** the catalogue chips that fit a room first (at most eight chips with "All") */
const RELEVANT: Record<string, string[]> = {
  living: ['living', 'dining', 'kitchen', 'decor', 'storage', 'office'], kitchen: ['kitchen', 'dining', 'storage', 'decor'], bed: ['bedroom', 'storage', 'decor', 'office'],
  office: ['office', 'storage', 'decor', 'living'], bath: ['bathroom', 'storage', 'decor'], garage: ['garage', 'storage'], hall: ['storage', 'decor', 'living'],
};

// ------------------------------------------------------------------ no room yet: choose one
function RoomButton({ r }: { r: HomeRoom }) {
  return (
    <button type="button" className="hm-room-big" data-item data-testid={`room-${r.id}`} onClick={() => enterRoom(r.id, r.level)}
      onPointerEnter={() => ui.set({ hoverRoom: r.id })} onPointerLeave={() => ui.get().hoverRoom === r.id && ui.set({ hoverRoom: null })}>
      <Icon name={ROOM_ICON[r.kind] ?? 'interior'} size={24} /><b>{r.label}</b><small>{m2(r.area)}</small>
    </button>
  );
}
function RoomPicker() {
  const level = useUi((s) => s.level);
  const levels = allLevels(), few = levels.length <= 2;
  // one or two levels: the rooms of every level (no level change needed first); more: the level shown (chips in the scene bar)
  const shown = few ? levels : levels.filter((l) => l.id === level);
  return (
    <div className="hm-room-picker" data-testid="room-picker">
      {shown.map((l, i) => (
        <Block key={l.id} title={levels.length > 1 ? l.name : t('steps.pickRoom')} testid={`rooms-${l.id}`}>
          <div className="hm-room-grid">
            {[...roomsOfLevel(l.id)].sort((a, b) => b.area - a.area).map((r) => <RoomButton key={r.id} r={r} />)}
            {/* the stairs' finishes (a card) — only in a project with stairs */}
            {i === 0 && hasStairs() && <button type="button" className="hm-room-big" data-item data-testid="stairs-open" onClick={() => ui.set({ selection: { kind: 'stairs' } })}><Icon name="interior" size={24} /><b>{t('steps.stairs')}</b></button>}
          </div>
        </Block>
      ))}
      <Block title={t('steps.plan')} testid="room-plan"><LevelPlan level={level} onRoom={(r) => enterRoom(r.id, r.level)} /></Block>
    </div>
  );
}

// ------------------------------------------------------------------ furniture
/** the last press on a catalogue card came from touch */
let touchCard = false;
function ItemCard({ item }: { item: CatalogItem }) {
  const variants = item.variants ?? [];
  const [variant, setVariant] = useState<string | null>(item.defaultVariant ?? variants[0]?.id ?? null);
  const thumb = furnitureThumbnail(item, variant);
  return (
    <div className="hm-item" data-testid={`cat-${item.id}`}>
      <button type="button" className="hm-item-main" title={t('furnitureUi.cardTitle')}
        onPointerDown={(e) => {
          // touch: the catalogue scrolls with a finger and a tap adds; a mouse press starts a drag (a click without moving adds)
          touchCard = e.pointerType === 'touch';
          if (touchCard) return;
          e.preventDefault(); startCatalogDrag(e.nativeEvent, item, variant, thumb);
        }}
        onClick={(e) => {
          // the pointer type also from the click itself: on a busy phone the browser may skip pointerdown but deliver the click
          if (!touchCard && (e.nativeEvent as PointerEvent).pointerType !== 'touch') return;
          const roomId = ui.get().roomId;
          if (roomId) { addToRoom(roomId, item, variant); ui.set({ sheet: 'collapsed' }); } else toast(t('furnitureUi.enterRoomFirst'), 'warn');
        }} data-testid={`cat-add-${item.id}`}>
        <span className="hm-item-img"><img src={thumb} alt="" draggable={false} /></span>
        <b>{item.name}</b>
        <small>{sizeLabel(resolveDims(item, { variant, dims: null }))}</small>
      </button>
      {variants.length > 1 && (
        <select className="hm-item-var" value={variant ?? ''} onChange={(e) => setVariant(e.target.value)} data-testid={`cat-var-${item.id}`} aria-label={t('furnitureUi.variant')}>
          {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
    </div>
  );
}

function Catalogue({ room }: { room: HomeRoom }) {
  const doc = useDoc();
  const [cat, setCat] = useState<string>('all'), [q, setQ] = useState('');
  const importing = useUi((s) => s.importOpen);
  const items = useMemo(() => catalogItems(doc.importedAssets ?? []), [doc.importedAssets]);
  const order = RELEVANT[room.kind] ?? [];
  const cats = [...FURNITURE_CATEGORIES].sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99)).slice(0, 7);
  const chips = [...cats, ...(items.some((i) => i.provider === 'imported') ? [{ id: 'imported', name: t('furnitureUi.myModels') }] : [])].slice(0, 7);
  const list = items.filter((i) => (cat === 'all' || (cat === 'imported' ? i.provider === 'imported' : inCategory(i, cat))) && (!q || `${i.name} ${i.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Block testid="catalogue">
      <label className="hm-search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('steps.search')} onKeyDown={(e) => e.stopPropagation()} data-testid="cat-search" /></label>
      <div className="hm-chips" data-testid="cat-chips">
        <button type="button" className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')} data-testid="chip-all">{t('furnitureUi.all')}</button>
        {chips.map((c) => <button key={c.id} type="button" className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)} data-testid={`chip-${c.id}`}><Icon name={CAT_ICON[c.id] ?? 'box'} size={14} /> {c.name}</button>)}
      </div>
      {!list.length && <Empty icon={<Icon name="search" size={28} />} title={t('furnitureUi.nothingFound')} />}
      <div className="hm-items">{list.map((i) => <ItemCard key={i.id} item={i} />)}</div>
      <ActionButton id="add-own" className="hm-btn wide" />
      {importing && <ImportDialog onClose={() => ui.set({ importOpen: false })} />}
    </Block>
  );
}

function InThisRoom({ room }: { room: HomeRoom }) {
  const a = useArrangement(room.id);
  const sel = useUi((s) => (s.selection?.kind === 'furniture' ? s.selection.id : null));
  return (
    <Block title={t('steps.inThisRoom', { n: a.furniture.length })} testid="room-furniture">
      {!a.furniture.length && <p className="hm-muted" data-testid="empty-room">{t('steps.emptyRoom')}</p>}
      <div className="hm-list">
        {a.furniture.map((f) => {
          const it = itemById(f.catalogId);
          if (!it) return null;
          return (
            <button key={f.id} type="button" className={`hm-row hm-row-main${sel === f.id ? ' on' : ''}`} data-testid={`furn-${f.id}`}
              onClick={() => ui.set({ selection: sel === f.id ? null : { kind: 'furniture', roomId: room.id, id: f.id } })}>
              <img src={furnitureThumbnail(it, f.variant, f.materialId)} alt="" className="hm-row-img" />{displayName(it, f)}
            </button>
          );
        })}
      </div>
    </Block>
  );
}

// ------------------------------------------------------------------ advanced: room arrangements (ADR 0042)
function Arrangements({ room }: { room: HomeRoom }) {
  const ri = useDesign((s) => interiorOfRoom(s, room.id));
  const cmp = useUi((s) => (s.compare?.kind === 'room' && s.compare.roomId === room.id ? s.compare : null));
  const [mode, setMode] = useState<'save' | 'copy' | { rename: string } | null>(null);
  const active = ri.arrangements.find((a) => a.id === ri.activeArrangementId) ?? ri.arrangements[0];
  const other = ri.arrangements.find((a) => a.id !== active.id);
  return (
    <Block title={t('interiorsUi.arrangement')} testid="arrangements">
      <div className="hm-arr-head"><b data-testid="arr-active">{active.name}</b><small>{active.saved ? t('interiorsUi.arrSaved') : t('interiorsUi.arrDraft')}</small></div>
      {mode === 'save' && <NameInput initial={active.saved ? active.name : ''} placeholder={t('interiorsUi.arrNamePlaceholderA')} button={t('interiorsUi.save')} onSubmit={(n) => { saveArrangementAs(room.id, n); setMode(null); }} onCancel={() => setMode(null)} testid="arr-save-name" />}
      {mode === 'copy' && <NameInput placeholder={t('interiorsUi.arrNamePlaceholderB')} button={t('interiorsUi.copy')} onSubmit={(n) => { duplicateArrangementAs(room.id, n); setMode(null); }} onCancel={() => setMode(null)} testid="arr-copy-name" />}
      {mode && typeof mode === 'object' && <NameInput initial={ri.arrangements.find((a) => a.id === mode.rename)?.name} button={t('interiorsUi.rename')} onSubmit={(n) => { renameArr(room.id, mode.rename, n); setMode(null); }} onCancel={() => setMode(null)} testid="arr-rename-name" />}
      {!mode && (
        <div className="hm-btn-row">
          <button className="hm-btn" onClick={() => setMode('save')} data-testid="arr-save"><Icon name="save" size={16} /> {t('interiorsUi.saveAs')}</button>
          <button className="hm-btn" onClick={() => setMode('copy')} data-testid="arr-copy"><Icon name="copy" size={16} /> {t('interiorsUi.copyAs')}</button>
          <button className="hm-btn ghost" onClick={() => newArr(room.id, t('interiorsUi.newArrangementName'))} data-testid="arr-new" title={t('interiorsUi.emptyArrangement')}><Icon name="plus" size={16} /></button>
          {other && (cmp ? <button className="hm-btn" onClick={exitCompare} data-testid="arr-compare-exit">{t('interiorsUi.compareEnd')}</button>
            : <button className="hm-btn" onClick={() => startRoomCompare(room.id, active.id, other.id)} data-testid="arr-compare-start">⇆ {t('interiorsUi.compareStart')}</button>)}
        </div>
      )}
      {ri.arrangements.length > 1 && (
        <div className="hm-list" data-testid="arr-list">
          {ri.arrangements.map((a) => (
            <div key={a.id} className={`hm-row${a.id === active.id ? ' on' : ''}`}>
              <button className="hm-row-main" onClick={() => loadArr(room.id, a.id)} data-testid={`arr-${a.name}`}><span className="hm-radio" />{a.name}<small>{t('interiorsUi.furnitureCount', { n: a.furniture.length })}</small></button>
              <button className="hm-icon-btn" title={t('interiorsUi.renameTitle')} onClick={() => setMode({ rename: a.id })} data-testid={`arr-rename-${a.name}`}>✎</button>
              <button className="hm-icon-btn" title={t('interiorsUi.deleteArrangement')} onClick={() => deleteArr(room.id, a.id)} data-testid={`arr-delete-${a.name}`}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

function Tabs() {
  const a = useActionSlot('arrange-tab');
  const tab = useUi((s) => s.arrangeTab);
  if (!a.shown) return null;
  return <Seg wide value={tab} options={[['furniture', <><Icon name="sofa" size={16} /> {t('steps.furniture')}</>], ['colours', <><Icon name="brush" size={16} /> {t('steps.colours')}</>]]}
    onChange={(v) => ui.set({ arrangeTab: v, selection: null })} testid={a.testid} />;
}

function Furniture({ room }: { room: HomeRoom }) {
  const advanced = useUi((s) => s.mode === 'advanced');
  return <>
    <Slot place="arrange.furniture">
      <Catalogue room={room} />
      <Block title={t('steps.startFrom')} testid="start-from">
        <div className="hm-start-grid">
          <ActionButton id="start-plan" className="hm-btn" />
          <ActionButton id="start-office" className="hm-btn" />
          <ActionButton id="start-guest" className="hm-btn" />
          <ActionButton id="start-empty" className="hm-btn" />
        </div>
      </Block>
    </Slot>
    <InThisRoom room={room} />
    {advanced && <Arrangements room={room} />}
  </>;
}

export function SectionArrange() {
  const roomId = useUi((s) => s.roomId), tab = useUi((s) => s.arrangeTab);
  const room = roomById(roomId);
  return (
    <div className="hm-section" data-testid="section-arrange">
      {!room ? <RoomPicker /> : <>
        <Slot place="arrange"><Tabs /></Slot>
        {tab === 'colours' ? <ArrangeColours room={room} /> : <Furniture room={room} />}
      </>}
    </div>
  );
}
