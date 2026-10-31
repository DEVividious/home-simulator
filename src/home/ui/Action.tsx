// Rendering of registry actions (ADR 0037): <Slot place> marks where a group of actions lives, <ActionButton id> renders one
// action there, useActionSlot(id) gives a control that is not a plain button (a picker, a toggle, chips) the action's state.
// In development a button rendered outside its place throws, and an action mounted twice at the same time warns — the
// registry's "one place" holds in the running app, not only in the audit.
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '../../i18n';
import { design } from '../store/design';
import { doors } from '../store/doors';
import { drag } from '../store/drag';
import { layout } from '../store/layout';
import { ui } from '../store/ui';
import { ACTIONS, actionShown, actionText, runAction, type ActionId, type Place } from './registry';
import { Icon } from './icons';

const SlotContext = createContext<Place | null>(null);

/** the place a group of actions is rendered in */
export function Slot({ place, children }: { place: Place; children: ReactNode }) {
  return <SlotContext.Provider value={place}>{children}</SlotContext.Provider>;
}

const STORES = [ui, design, doors, layout, drag];
const subscribe = (fn: () => void) => { const offs = STORES.map((s) => s.subscribe(fn)); return () => offs.forEach((o) => o()); };

export interface ActionState { shown: boolean; enabled: boolean; active: boolean; text: string; title: string }
const stateKey = (id: ActionId): string => {
  const a = ACTIONS[id] as (typeof ACTIONS)[ActionId] & { enabled?: () => boolean; active?: () => boolean; title?: () => string };
  const shown = actionShown(id);
  if (!shown) return '0';
  return JSON.stringify([1, a.enabled ? a.enabled() : true, a.active ? a.active() : false, actionText(id), a.title ? a.title() : '']);
};
/** the state of an action, re-rendered only when it changes */
export function useActionState(id: ActionId): ActionState {
  const key = useSyncExternalStore(subscribe, () => stateKey(id), () => stateKey(id));
  if (key === '0') return { shown: false, enabled: false, active: false, text: '', title: '' };
  const [, enabled, active, text, title] = JSON.parse(key) as [number, boolean, boolean, string, string];
  return { shown: true, enabled, active, text, title };
}

const mounted = new Map<ActionId, number>();
const DEV = import.meta.env?.DEV ?? false;
/** registers a mounted action (development checks: the right place, mounted once) */
function useMountCheck(id: ActionId) {
  const place = useContext(SlotContext), want = ACTIONS[id].place;
  if (DEV && place !== want) throw new Error(`action "${id}" belongs in the place "${want}", rendered in "${place ?? 'no place'}"`);
  useEffect(() => {
    if (!DEV) return;
    const n = (mounted.get(id) ?? 0) + 1;
    mounted.set(id, n);
    if (n > 1) console.warn(`action "${id}" is mounted ${n} times — one action, one place (ADR 0037)`);
    return () => { mounted.set(id, (mounted.get(id) ?? 1) - 1); };
  }, [id]);
}

/** a control that renders an action itself: its state, test id and runner */
export function useActionSlot(id: ActionId) {
  useMountCheck(id);
  const st = useActionState(id);
  return { ...st, testid: ACTIONS[id].testid, label: t(ACTIONS[id].label), run: (arg?: number) => runAction(id, arg) };
}

/** one action as a button: icon + label (undo / redo: icon with an aria-label), its test id, pressed and disabled states */
export function ActionButton({ id, className = '', size = 18, children }: { id: ActionId; className?: string; size?: number; children?: ReactNode }) {
  useMountCheck(id);
  const st = useActionState(id), a = ACTIONS[id] as (typeof ACTIONS)[ActionId] & { iconOnly?: boolean; value?: string; group?: string; tone?: string; icon?: string };
  if (!st.shown) return null;
  const cls = ['hm-act', className, st.active ? 'on' : '', a.tone ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} data-testid={a.testid} data-value={a.value} data-group={a.group} aria-pressed={a.value || st.active ? st.active : undefined}
      disabled={!st.enabled} title={st.title || undefined} aria-label={a.iconOnly ? st.text : undefined} onClick={() => runAction(id)}>
      {a.icon && <Icon name={a.icon} size={size} />}
      {!a.iconOnly && <span>{st.text}</span>}
      {children}
    </button>
  );
}
