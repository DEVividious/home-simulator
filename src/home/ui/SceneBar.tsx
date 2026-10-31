// The scene bar — the only camera control (ADR 0039): Around | From above | Walk (the same words outside and in a room), the
// level chips, "Hide doors" / "Show doors" and, in a room, "← Ground floor · Kitchen". The object bar (ADR 0040) — the actions on the
// selected piece of furniture: turn, copy, delete, done; for an object on a wall the four 1 cm nudges instead of turning.
import { setLevel } from '../actions';
import { allLevels } from '../model/rooms';
import { isWalking, useUi } from '../store/ui';
import { useLayout } from '../store/layout';
import { useArrangement } from '../store/design';
import { useDrag } from '../store/drag';
import { mountedNow } from '../scene/interaction';
import { ActionButton, Slot, useActionSlot } from './Action';

/** level chips: the level section of a level ("doll's house"); the chip of the level shown inside is active */
function LevelChips() {
  const a = useActionSlot('level');
  const level = useUi((s) => s.level), inside = useUi((s) => !!s.roomId || s.houseView === 'interior'), inRoom = useUi((s) => !!s.roomId);
  // in a room the back chip names the level ("← Ground floor · Kitchen")
  if (!a.shown || inRoom) return null;
  return (
    <div className="hm-chips-bar" data-testid={a.testid} role="radiogroup" aria-label={a.label} data-group="level">
      {allLevels().map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={inside && level === l.id} className={inside && level === l.id ? 'on' : ''} data-value={l.id} onClick={() => setLevel(l.id)}>{l.name}</button>
      ))}
    </div>
  );
}

export function SceneBar() {
  return (
    <div className="hm-scenebar" data-testid="scene-bar" data-bar="scene">
      <Slot place="scenebar">
        <ActionButton id="scene-back" className="hm-pill back" />
        <div className="hm-seg" data-testid="view" role="radiogroup" data-group="view">
          <ActionButton id="view-around" />
          <ActionButton id="view-above" />
          <ActionButton id="view-walk" />
        </div>
        <LevelChips />
        <ActionButton id="doors-toggle" className="hm-pill" />
      </Slot>
    </div>
  );
}

/** the readout of an object on a wall while it is nudged: from the corner · height [cm] */
function MountRead({ roomId, id }: { roomId: string; id: string }) {
  useArrangement(roomId);
  const live = useDrag((s) => (s.mount && s.mount.id === id ? s.mount : null));
  const m = mountedNow(roomId, id);
  if (!m) return null;
  const cm = (v: number) => Math.round(v * 100);
  return <span className="hm-quick-read" data-testid="obj-read">{cm(live?.along ?? m.along)} · {cm(live?.height ?? m.height)} cm</span>;
}

export function ObjectBar() {
  const sel = useUi((s) => (s.selection?.kind === 'furniture' ? s.selection : null));
  const walking = useUi(isWalking), touch = useLayout((s) => s.coarse);
  if (!sel || (walking && touch)) return null;                              // walking on a phone: the joystick is in this spot
  return (
    <div className="hm-objectbar" data-testid="object-bar" role="toolbar" data-bar="object">
      <Slot place="objectbar">
        <ActionButton id="obj-rotate-left" />
        <ActionButton id="obj-rotate-right" />
        <span className="hm-dpad" data-group="move">
          <ActionButton id="obj-left" />
          <ActionButton id="obj-right" />
          <ActionButton id="obj-up" />
          <ActionButton id="obj-down" />
          <MountRead roomId={sel.roomId} id={sel.id} />
        </span>
        <ActionButton id="obj-copy" />
        <ActionButton id="obj-delete" />
        <ActionButton id="obj-done" />
      </Slot>
    </div>
  );
}
