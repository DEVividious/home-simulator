// Door state: "Show doors" and the degree of opening of every door — view state (like the camera), not part of the project:
// stored in the browser preferences, not in the project file. Door definitions (model/doors.ts) stay untouched.
// The store sets the door gate in the walk model (a closed leaf blocks the passage; hidden leaves — no collision).
// Diagnostics / tests: ?doors=open (all open) | closed | hidden (leaves hidden).
import { defaultDoorState, doorPassable, parseDoorState, serializeDoorState, setAllDoors, setDoorOpen, toggleDoor, type DoorState } from '../model/doors';
import { setDoorGate } from '../model/walk';
import { scopedKey } from '../../project/registry';
import { createStore, useStore } from './createStore';

// door ids belong to the project — the opening state is stored separately for each project
const LS = scopedKey('home-simulator.doors.v1');
function initial(): DoorState {
  if (typeof window === 'undefined') return defaultDoorState();
  const q = new URLSearchParams(window.location.search).get('doors');
  if (q === 'open') return setAllDoors(defaultDoorState(), 1);
  if (q === 'closed') return defaultDoorState();
  if (q === 'hidden') return { ...defaultDoorState(), show: false };
  try { return parseDoorState(window.localStorage.getItem(LS)); } catch { return defaultDoorState(); }
}

export const doors = createStore<DoorState>(initial());
export const useDoors = <T,>(sel: (s: DoorState) => T) => useStore(doors, sel);

setDoorGate((id) => doorPassable(doors.get(), id));
doors.subscribe(() => { try { window.localStorage.setItem(LS, serializeDoorState(doors.get())); } catch { /* private mode */ } });

export const setShowDoors = (show: boolean) => { if (doors.get().show !== show) doors.set({ ...doors.get(), show }); };
export const openDoor = (id: string, t: number) => { const n = setDoorOpen(doors.get(), id, t); if (n !== doors.get()) doors.set(n); };
export const toggleDoorOpen = (id: string) => doors.set(toggleDoor(doors.get(), id));
export const setAllDoorsOpen = (t: number) => { const n = setAllDoors(doors.get(), t); if (n !== doors.get()) doors.set(n); };
