// The default walk start (usability issue B6): just inside the entrance door, facing into the home — not outside a closed
// front door. The entrance is a door to the outside on the lowest floor, from a hall when there is one. Walking into a closed
// door opens it.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { openDoorAhead } from '../actions';
import { allDoors, doorCenter, isOperable, openOf } from '../model/doors';
import { doors, openDoor } from '../store/doors';
import { roomAt } from '../model/rooms';
import { entranceStart } from '../model/viewpoints';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const forward = (yaw: number) => [-Math.sin(yaw), Math.cos(yaw)];

describe('walk: the default start just inside the entrance', () => {
  for (const id of ['sample-house', 'demo-apartment']) {
    it(`${id}: inside the room behind the door to the outside, 0.9 m in, facing into the room`, () => {
      withProject(readProjectDir(path.join(ROOT, 'projects', id)), () => {
        const s = entranceStart()!, door = allDoors().find((d) => d.rooms.includes('exterior'))!, inside = door.rooms.find((r) => r !== 'exterior');
        expect(s).not.toBeNull();
        expect(roomAt(door.level, s.p)?.id ?? null).toBe(inside);
        const c = doorCenter(door), f = forward(s.yaw), away = [s.p[0] - c[0], s.p[1] - c[1]];
        expect(Math.hypot(away[0], away[1])).toBeGreaterThan(0.9);
        expect(f[0] * away[0] + f[1] * away[1]).toBeGreaterThan(0);              // looking away from the door, into the home
      });
    });
  }
});

describe('walk: walking into a closed door opens it (usability issue B6)', () => {
  it('a closed door just ahead in the direction of the blocked step opens; a wall ahead, or a door behind, does not', () => {
    withProject(readProjectDir(path.join(ROOT, 'projects', 'sample-house')), () => {
      const d = allDoors().find((x) => !x.rooms.includes('exterior') && isOperable(x.id))!, c = doorCenter(d);
      const ax = d.opening.along === 'X' ? 1 : 0, n: [number, number] = ax === 0 ? [1, 0] : [0, 1];
      const before: [number, number] = [c[0] - n[0] * 0.5, c[1] - n[1] * 0.5];
      openDoor(d.id, 0);
      expect(openDoorAhead(d.level, before, [-n[0], -n[1]])).toBe(false);           // walking away from it
      expect(openDoorAhead(d.level, [before[0] + n[1] * 3, before[1] + n[0] * 3], n)).toBe(false); // a wall ahead, the door 3 m aside
      expect(openOf(doors.get(), d.id)).toBe(0);
      expect(openDoorAhead(d.level, before, n)).toBe(true);
      expect(openOf(doors.get(), d.id)).toBe(1);
      openDoor(d.id, 0);
    });
  });
});
