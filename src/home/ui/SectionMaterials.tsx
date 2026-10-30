// MATERIALS section: pick a room surface (floor, walls — from the plan or the list, ceiling) — material, colour and pattern
// are chosen in the right-hand panel (inspector). Overview: what is already changed in the active arrangement.
import { materialById, neutralFinish } from '../catalog/materials';
import { roomById, wallLabel, type HomeRoom } from '../model/rooms';
import type { FinishRef } from '../model/types';
import { arrangementOf, useDesign } from '../store/design';
import { selectedWallIds, ui, useUi } from '../store/ui';
import { Block, finishLabel } from './controls';
import { RoomPlan } from './FloorPlan';
import { Icon } from './icons';
import { LevelView, RoomHeader } from './SectionInteriors';
import { t } from '../../i18n';

/** surface finish; without a user choice — neutral (preview) or from the project */
function FinishChip({ f, fallback, neutral }: { f: FinishRef | null | undefined; fallback: string; neutral?: FinishRef | null }) {
  const m = f ? materialById(f.materialId) : null, n = !m && neutral ? materialById(neutral.materialId) : null;
  return (
    <span className="hm-finish">
      <i style={{ background: f?.color ?? m?.baseColor ?? n?.baseColor ?? '#e9e7e2' }} />
      {m ? finishLabel(m.name, f?.color) : n ? t('materialsUi.neutral', { name: n.name }) : fallback}
    </span>
  );
}

function RoomMaterials({ room }: { room: HomeRoom }) {
  const a = useDesign((s) => arrangementOf(s, room.id));
  const sel = useUi((s) => s.selection);
  const neutralOn = useUi((s) => s.neutralInterior), kind = room.kind;
  const nf = (surface: 'wall' | 'floor' | 'ceiling') => (neutralOn ? neutralFinish(kind, surface) : null);
  const selWalls = sel?.kind === 'wall' && sel.roomId === room.id ? selectedWallIds(sel) : [];
  const pickWall = (id: string, add: boolean) => {
    if (add && selWalls.length) {
      const next = selWalls.includes(id) ? selWalls.filter((x) => x !== id) : [...selWalls, id];
      ui.set(next.length ? { selection: { kind: 'wall', roomId: room.id, wallId: next[next.length - 1], wallIds: next }, wallScope: 'one' } : { selection: null });
    } else ui.set({ selection: { kind: 'wall', roomId: room.id, wallId: id }, wallScope: 'one' });
  };
  const pick = (s: NonNullable<typeof sel>) => ui.set({ selection: s });
  const changed = Object.keys(a.finishes.walls).length;
  return (
    <>
      <RoomHeader room={room} />
      <div className="hm-tip" data-testid="tip-walls"><Icon name="brush" size={16} /> {t('materialsUi.tipWalls')}</div>
      <Block title={t('materialsUi.surfaces')}>
        <div className="hm-surfaces">
          <button className={`hm-surface${sel?.kind === 'floor' ? ' on' : ''}`} onClick={() => pick({ kind: 'floor', roomId: room.id })} data-testid="surface-floor">
            <b>{t('materialsUi.floor')}</b><FinishChip f={a.finishes.floor} fallback={t('materialsUi.floorFromProject')} neutral={nf('floor')} />
          </button>
          <button className={`hm-surface${sel?.kind === 'wall' ? ' on' : ''}`} onClick={() => { ui.set({ wallScope: 'all' }); pick({ kind: 'wall', roomId: room.id, wallId: room.walls[0].id }); }} data-testid="surface-walls">
            <b>{t('materialsUi.walls')}</b><span className="hm-finish">{changed ? t('materialsUi.wallsChanged', { n: changed, total: room.walls.length }) : neutralOn ? t('materialsUi.neutral', { name: materialById(neutralFinish(kind, 'wall').materialId)?.name ?? '' }) : t('materialsUi.plasterFromProject')}</span>
          </button>
          <button className={`hm-surface${sel?.kind === 'ceiling' ? ' on' : ''}`} onClick={() => pick({ kind: 'ceiling', roomId: room.id })} data-testid="surface-ceiling">
            <b>{t('materialsUi.ceiling')}</b><FinishChip f={a.finishes.ceiling} fallback={t('materialsUi.ceilingFromProject')} neutral={nf('ceiling')} />
          </button>
        </div>
      </Block>
      <Block title={t('materialsUi.roomWalls')}>
        <RoomPlan room={room} arrangement={a} selectedWall={selWalls} testid="materials-plan"
          onWall={pickWall} onFloor={() => pick({ kind: 'floor', roomId: room.id })} />
        <p className="hm-muted">{t('materialsUi.multiSelect')}</p>
        <div className="hm-list">
          {room.walls.map((w) => (
            <button key={w.id} className={`hm-row hm-row-main${selWalls.includes(w.id) ? ' on' : ''}`} onClick={(e) => pickWall(w.id, e.ctrlKey || e.metaKey || e.shiftKey)} data-testid={`wall-${w.index}`}>
              <span>{wallLabel(w)}</span><FinishChip f={a.finishes.walls[w.id]} fallback={t('materialsUi.plaster')} neutral={nf('wall')} />
            </button>
          ))}
        </div>
      </Block>
    </>
  );
}

export function SectionMaterials() {
  const room = roomById(useUi((s) => s.roomId));
  return (
    <div className="hm-section" data-testid="section-materials">
      {room ? <RoomMaterials room={room} /> : <LevelView tip={t('materialsUi.enterRoom')} />}
    </div>
  );
}
