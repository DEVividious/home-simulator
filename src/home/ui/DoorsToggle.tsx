// "Show doors": a switch shown above the scene (next to the sun) in interiors and while walking, in Home and Expert mode,
// plus the same switch in the panels (Building, Interiors, Expert). Off: door leaves hidden (openings and frames stay), no
// leaf collisions while walking. Doors are not removed from the data — this is view state (store/doors.ts).
import { setAllDoorsOpen, setShowDoors, useDoors } from '../store/doors';
import { useUi } from '../store/ui';
import { Toggle } from './controls';
import { Icon } from './icons';
import { t } from '../../i18n';

/** whether the scene shows interiors (level cutaway, room, walk) — where interior doors are visible */
export const useInteriorView = () => useUi((s) => (!!s.roomId || s.houseView !== 'exterior'));

/** button above the scene: "Doors" on / off */
export function DoorsButton() {
  const show = useDoors((s) => s.show), inside = useInteriorView();
  if (!inside) return null;
  return (
    <button className={`hm-doors-btn${show ? ' on' : ''}`} onClick={() => setShowDoors(!show)} aria-pressed={show} data-testid="doors-toggle" data-on={show ? '1' : '0'}
      title={show ? t('doorsUi.visibleTitle') : t('doorsUi.hiddenTitle')}>
      <Icon name="door" size={17} /><b>{t('doorsUi.doors')}</b><small>{show ? t('doorsUi.visible') : t('doorsUi.hidden')}</small>
    </button>
  );
}

/** panel row: "Show doors" + quick "open / close all" */
export function DoorsPanelToggle({ testid = 'doors-panel-toggle' }: { testid?: string }) {
  const show = useDoors((s) => s.show), n = useDoors((s) => Object.keys(s.open).length);
  return (
    <>
      <Toggle on={show} label={t('doorsUi.showDoors')} hint={t('doorsUi.showDoorsHint')} onChange={setShowDoors} testid={testid} />
      {show && (
        <div className="hm-door-all">
          <button className="hm-link" onClick={() => setAllDoorsOpen(1)} data-testid="doors-open-all">{t('doorsUi.openAll')}</button>
          <button className="hm-link" onClick={() => setAllDoorsOpen(0)} disabled={n === 0} data-testid="doors-close-all">{t('doorsUi.closeAll')}</button>
        </div>
      )}
    </>
  );
}
