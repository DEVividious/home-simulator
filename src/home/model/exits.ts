// Ways out of the building in the walk (usability issue B8: walking inside, people did not see where the exit was, nor which
// glazing was a door): every exterior door and floor-level passable opening of the level at ground, as the walk model knows them
// (walkWorld.ts exteriorDoors) — the point on the floor just inside it, the way out and the height of its head. The scene draws
// a sign over each and an arrow on the floor; clicking either walks out (actions.ts walkOutside).
import { derived } from '../../project/active';
import { doorById } from './doors';
import { roomById } from './rooms';
import type { Vec2 } from './types';
import { exteriorDoors } from './walkWorld';

export interface Exit {
  /** door or opening id */
  id: string;
  kind: 'door' | 'glazing';
  roomId: string;
  /** the middle of the opening on the inner face of the wall, the outward direction (unit), the opening width */
  at: Vec2; out: Vec2; width: number;
  /** floor height of the room and the head of the opening above it [m] */
  floorZ: number; head: number;
}

export const exits = derived((): Exit[] => exteriorDoors().map((d) => {
  const room = roomById(d.roomId)!, mid = (d.t0 + d.t1) / 2, def = doorById(d.id), win = room.windows.find((w) => w.id === d.id);
  return {
    id: d.id, kind: def ? 'door' : 'glazing', roomId: d.roomId, at: [d.a[0] + d.dir[0] * mid, d.a[1] + d.dir[1] * mid], out: [-d.inward[0], -d.inward[1]],
    width: def ? def.opening.width : win ? win.t1 - win.t0 : d.t1 - d.t0, floorZ: room.floorZ, head: def ? def.opening.height : win?.head ?? 2.1,
  };
}));
export const exitById = (id: string): Exit | null => exits().find((e) => e.id === id) ?? null;
/** the point a walk out through an exit goes to: this far beyond the inner face of the wall [m] */
export const EXIT_WALK_OUT = 1.5;
