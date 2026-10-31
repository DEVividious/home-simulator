// LOOK step (ADR 0036): "Places" — the project's views the scene bar does not already give, the walk starts at the project's
// viewpoints, my saved views and "Save view"; "Time of day" (sun module). Moving the camera otherwise is the scene bar's job.
import { hasCapability, hasModule } from '../../project/active';
import { deleteBookmark, goPlace } from '../actions';
import { viewpoints } from '../model/viewpoints';
import { placeViews } from '../model/views';
import { useDoc } from '../store/design';
import { t } from '../../i18n';
import { ActionButton, Slot } from './Action';
import { Block } from './controls';
import { Icon } from './icons';
import { TimeOfDay } from './SunPanel';

function Place({ id, icon, name, hint, onDelete }: { id: string; icon: string; name: string; hint?: string; onDelete?: () => void }) {
  return (
    <div className="hm-place" data-item>
      <button type="button" className="hm-place-go" onClick={() => goPlace(id)} title={hint} data-testid={`place-${id}`}><Icon name={icon} size={20} /><b>{name}</b></button>
      {onDelete && <button type="button" className="hm-icon-btn" onClick={onDelete} aria-label={t('steps.deleteView', { name })} data-testid={`place-delete-${id}`}><Icon name="close" size={14} /></button>}
    </div>
  );
}

export function SectionLook() {
  const doc = useDoc();
  const walk = hasCapability('walk');
  return (
    <div className="hm-section" data-testid="section-look">
      <Block title={t('steps.places')} testid="places">
        <div className="hm-places">
          {placeViews().map((v) => <Place key={v.id} id={v.id} icon={v.icon} name={v.label} hint={v.hint} />)}
          {walk && viewpoints().map((v) => <Place key={v.id} id={v.id} icon="walk" name={v.name} hint={v.hint} />)}
          {(doc.bookmarks ?? []).map((b) => <Place key={b.id} id={b.id} icon="camera" name={b.name} onDelete={() => deleteBookmark(b.id)} />)}
        </div>
        <Slot place="look"><ActionButton id="place-save" className="hm-btn wide" /></Slot>
      </Block>
      {hasModule('sun') && <Block title={t('steps.timeOfDay')} testid="time-of-day"><TimeOfDay /></Block>}
    </div>
  );
}
