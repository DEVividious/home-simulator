// "What is visible under the pointer" for a GROUP of scene objects (base openings, exterior openings): determined on press,
// read on click (the opening click handler receives only the element id, no event).
// R3F calls the group's press handler once for EVERY mesh hit by the ray (frame, sash, glass, a window deeper in the room).
// A result overwritten on each call belonged to the last, farthest mesh — a window ignored clicks where the ray crossed two of
// its meshes. The press result (one browser event) therefore accumulates all calls: true when any mesh of the group is the
// nearest visible solid. Tests: tests/pressNearest.test.ts.
import { isNearest } from './press';

type Hit = { object: unknown; intersections: { object: unknown }[]; nativeEvent: unknown };
export interface PressNearest {
  /** press handler call for one mesh of the group; returns whether THIS mesh is the nearest visible solid under the pointer */
  mark(e: Hit): boolean;
  /** whether, on the last press, the nearest visible solid under the pointer belonged to the group */
  readonly current: boolean;
}

export function pressNearest(): PressNearest {
  let press: unknown = null, hit = true;
  return {
    mark(e) {
      const near = isNearest(e);
      if (press !== e.nativeEvent) { press = e.nativeEvent; hit = false; }
      if (near) hit = true;
      return near;
    },
    get current() { return hit; },
  };
}
