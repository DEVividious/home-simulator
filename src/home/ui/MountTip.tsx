// Badge next to the pointer while dragging a wall-mounted object: distance from the wall corner, height, alignment
// and warning. Drawn ABOVE the object (near the top edge of the scene — beside it), so neither finger nor cursor covers it.
import { itemById } from '../catalog/providers';
import { displayName } from '../catalog/furniture';
import { furnitureById } from '../model/interiors';
import { roomById } from '../model/rooms';
import { surfaceById } from '../model/mount';
import { arrangementOf, design } from '../store/design';
import { useDrag } from '../store/drag';
import { fmtNum, t } from '../../i18n';

const m2 = (v: number) => fmtNum(v, 2);
/** alignment reason → label (UI language) */
const why = (k: string): string | undefined => ({ object: t('mountTip.alignObject'), opening: t('mountTip.alignOpening'), center: t('mountTip.alignCenter'), start: t('mountTip.alignStart') } as Record<string, string>)[k];

export function MountTip() {
  const m = useDrag((s) => s.mount), warn = useDrag((s) => (s.mount ? s.warnings.find((w) => w.level === 'warn') ?? null : null));
  if (!m) return null;
  const s = surfaceById(m.surfaceId), room = s ? roomById(s.spaceId) : null;
  const f = s ? furnitureById(arrangementOf(design.get(), s.spaceId), m.id) ?? null : null, item = f ? itemById(f.catalogId) : null;
  const stage = document.querySelector('.hm-stage')?.getBoundingClientRect(), x = m.screen[0] - (stage?.left ?? 0), y = m.screen[1] - (stage?.top ?? 0), w = stage?.width ?? 400;
  const above = y > 190, left = x > w / 2;
  const style = above ? { left: Math.max(96, Math.min(w - 96, x)), top: y - (m.touch ? 64 : 34) } : { left: x + (left ? -34 : 34), top: Math.max(70, y) };
  const guide = m.guides.find((g) => g.why !== 'start') ?? m.guides[0];
  return (
    <div className={`hm-el-tip ${warn ? 'warn' : 'ok'}${above ? '' : ` side${left ? ' left' : ''}`}`} style={style} data-testid="mount-tip" data-surface={m.surfaceId} data-candidate={m.candidate ?? ''}>
      {item && f && <b>{displayName(item, f)}</b>}
      {room && <span>{room.label}</span>}
      <span data-testid="mount-tip-along">↔ {m2(m.along)} m <small>{m.from === 'left' ? t('mountTip.fromLeft') : t('mountTip.fromRight')}</small></span>
      <span data-testid="mount-tip-height">↕ {m2(m.height)} m</span>
      {guide && <em data-testid="mount-tip-align">{why(guide.why)}</em>}
      {m.candidate && <em data-testid="mount-tip-candidate">{t('mountTip.dragFurther')}</em>}
      {warn && <em className="msg" data-testid="mount-tip-msg">{warn.text}</em>}
    </div>
  );
}
