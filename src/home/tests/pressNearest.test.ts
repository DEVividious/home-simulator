// "What is visible under the pointer" for a GROUP of objects (an object with several meshes, e.g. a window: frame, sash, glass).
// R3F calls the group's press handler once for EVERY mesh hit by the ray, nearest first (frame, sash, glass, a window deeper in
// the room). The "is it us under the pointer" result was stored on every call — so it was left by the last, farthest mesh and
// clicking the object failed wherever the ray crossed two of its meshes.
import { describe, expect, it } from 'vitest';
import { pressNearest } from '../scene/pressNearest';

type Obj = { name: string; visible: boolean; parent: Obj | null };
const obj = (name: string, visible = true, parent: Obj | null = null): Obj => ({ name, visible, parent });
/** press: the ray hits the objects `ray` in order; the group handler is called for the meshes `own` in the given order */
function press(n: ReturnType<typeof pressNearest>, ray: Obj[], own: Obj[]) {
  const nativeEvent = {}, intersections = ray.map((object) => ({ object }));
  return own.map((object) => n.mark({ object, intersections, nativeEvent }));
}
const frame = obj('frame'), sash = obj('sash'), glass = obj('glass'), wall = obj('wall'), far = obj('window deeper in the room');

describe('the nearest visible mesh under the pointer belongs to the group (one press = several handler calls)', () => {
  it('ray through the frame, sash and glass of the same window: the window is under the pointer (was: result overwritten by a farther mesh)', () => {
    const n = pressNearest();
    expect(press(n, [frame, sash, glass, wall], [frame, sash, glass])).toEqual([true, false, false]);   // result for each mesh separately
    expect(n.current).toBe(true);
  });
  it('a window deeper in the room seen through the glass: the first mesh of the group still counts', () => {
    const n = pressNearest();
    press(n, [glass, wall, far], [glass, far]);
    expect(n.current).toBe(true);
  });
  it('a visible mesh outside the group (a wall) stands in front of the window: the window is not visible — none of its meshes is nearest', () => {
    const n = pressNearest();
    expect(press(n, [wall, frame, sash], [frame, sash])).toEqual([false, false]);
    expect(n.current).toBe(false);
  });
  it('a hidden object in front of the window (a disabled helper layer) does not occlude', () => {
    const n = pressNearest(), layer = obj('DEBUG layer', false);
    press(n, [obj('opening outline', true, layer), frame, sash], [frame, sash]);
    expect(n.current).toBe(true);
  });
  it('every press is evaluated afresh', () => {
    const n = pressNearest();
    press(n, [frame, sash], [frame, sash]); expect(n.current).toBe(true);
    press(n, [wall, frame, sash], [frame, sash]); expect(n.current).toBe(false);
    press(n, [glass, sash], [glass, sash]); expect(n.current).toBe(true);
  });
  it('the result does not depend on the order of handler calls', () => {
    const n = pressNearest();
    press(n, [frame, sash, glass], [glass, sash, frame]);
    expect(n.current).toBe(true);
  });
});
