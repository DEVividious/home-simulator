// FURNITURE section: catalogue (categories, search, thumbnails rendered from geometry). A card can be dragged into the room
// (floor preview with snapping) or clicked — the item is placed in a free spot. User GLB / glTF models: "My models".
import { useMemo, useState } from 'react';
import { FURNITURE_CATEGORIES, inCategory, resolveDims, sizeLabel, type CatalogItem } from '../catalog/furniture';
import { catalogItems } from '../catalog/providers';
import { furnitureThumbnail } from '../catalog/thumbnails';
import { roomById } from '../model/rooms';
import { addToRoom, startCatalogDrag } from '../scene/interaction';
import { useDoc } from '../store/design';
import { toast, ui, useUi } from '../store/ui';
import { useLayout } from '../store/layout';
import { Empty } from './controls';
import { Icon } from './icons';
import { ImportDialog } from './ImportDialog';
import { RoomHeader } from './SectionInteriors';
import { t } from '../../i18n';

const CAT_ICON: Record<string, string> = { living: 'sofa', dining: 'desk', kitchen: 'kitchen', bedroom: 'bed', office: 'desk', bathroom: 'bath', storage: 'box', garage: 'garage', decor: 'plant', imported: 'upload' };

/** the last press on a catalogue card came from touch */
let touchCard = false;

function ItemCard({ item }: { item: CatalogItem }) {
  const variants = item.variants ?? [];
  const [variant, setVariant] = useState<string | null>(item.defaultVariant ?? variants[0]?.id ?? null);
  const thumb = furnitureThumbnail(item, variant);
  const dims = resolveDims(item, { variant, dims: null });
  return (
    <div className="hm-item" data-testid={`cat-${item.id}`}>
      <button className="hm-item-main" title={t('furnitureUi.cardTitle')}
        onPointerDown={(e) => {
          // touch: the catalogue list scrolls with a finger; tapping a card (click) adds the item in a free spot in the room
          touchCard = e.pointerType === 'touch';
          if (touchCard) return;
          e.preventDefault(); startCatalogDrag(e.nativeEvent, item, variant, thumb);
        }}
        onClick={(e) => {
          // pointer type also from the click itself: on a phone with a busy main thread the browser may skip pointerdown,
          // while the click (from the tap gesture) still arrives — without this, tapping a card would do nothing
          if (!touchCard && (e.nativeEvent as PointerEvent).pointerType !== 'touch') return;
          const roomId = ui.get().roomId;
          if (roomId) { addToRoom(roomId, item, variant); ui.set({ sheet: 'collapsed' }); }
          else toast(t('furnitureUi.enterRoomFirst'), 'warn');
        }} data-testid={`cat-add-${item.id}`}>
        <span className="hm-item-img"><img src={thumb} alt="" draggable={false} /></span>
        <b>{item.name}</b>
        <small>{sizeLabel(dims)}</small>
      </button>
      {variants.length > 1 && (
        <select className="hm-item-var" value={variant ?? ''} onChange={(e) => setVariant(e.target.value)} data-testid={`cat-var-${item.id}`} aria-label={t('furnitureUi.variant')}>
          {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
    </div>
  );
}

export function SectionFurniture() {
  const room = roomById(useUi((s) => s.roomId));
  const doc = useDoc();
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const touch = useLayout((s) => s.coarse);
  const items = useMemo(() => catalogItems(doc.importedAssets ?? []), [doc.importedAssets]);
  const cats = [...FURNITURE_CATEGORIES, ...(items.some((i) => i.provider === 'imported') ? [{ id: 'imported', name: t('furnitureUi.myModels'), icon: 'upload' }] : [])];
  const list = items.filter((i) => (cat === 'all' || (cat === 'imported' ? i.provider === 'imported' : inCategory(i, cat))) && (!q || `${i.name} ${i.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="hm-section" data-testid="section-furniture">
      {room ? <RoomHeader room={room} /> : (
        <div className="hm-tip warn" data-testid="tip-enter-room"><Icon name="info" size={16} /> {t('furnitureUi.tipEnterRoom')}</div>
      )}
      {room && <div className="hm-tip" data-testid="tip-drag"><Icon name="info" size={16} /> {touch ? t('furnitureUi.tipTouch') : t('furnitureUi.tipDrag')}</div>}
      <label className="hm-search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('furnitureUi.searchPlaceholder')} onKeyDown={(e) => e.stopPropagation()} data-testid="cat-search" /></label>
      <div className="hm-chips" data-testid="cat-chips">
        <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>{t('furnitureUi.all')}</button>
        {cats.map((c) => <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)} data-testid={`chip-${c.id}`}><Icon name={CAT_ICON[c.id] ?? 'box'} size={14} /> {c.name}</button>)}
      </div>
      {!list.length && <Empty icon={<Icon name="search" size={28} />} title={t('furnitureUi.nothingFound')}>{t('furnitureUi.nothingFoundHint')}</Empty>}
      <div className="hm-items">{list.map((i) => <ItemCard key={i.id} item={i} />)}</div>
      <div className="hm-import">
        <button className="hm-btn" onClick={() => setImporting(true)} data-testid="import-open"><Icon name="upload" size={16} /> {t('furnitureUi.importOwn')}</button>
        <small className="hm-muted">{t('furnitureUi.importNote')}</small>
      </div>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
