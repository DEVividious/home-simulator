// Data of the current project needed by the electrical plan: furniture outlines (light plan background) and the coordination
// context (open door leaves, built-ins, sanitary fittings).
import { displayName, elevationOf, resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { obbOf } from '../model/collision';
import { allDoors, leafSegment } from '../model/doors';
import type { CoordContext } from '../model/electrical';
import { obbCorners } from '../model/geom2d';
import { allRooms } from '../model/rooms';
import type { LevelId, Vec2 } from '../model/types';
import { arrangementOf, design, type DesignState } from '../store/design';

function furnitureOf(s: DesignState, level?: LevelId): CoordContext['furniture'] {
  const out: CoordContext['furniture'] = [];
  for (const r of allRooms()) {
    if (level && r.level !== level) continue;
    for (const f of arrangementOf(s, r.id).furniture) {
      const it = itemById(f.catalogId);
      if (!it || it.flat) continue;
      const d = resolveDims(it, f), z0 = elevationOf(it, f);
      out.push({ roomId: r.id, corners: obbCorners(obbOf(f, d)), z0, z1: z0 + d.h, name: displayName(it, f), sanitary: it.category === 'bathroom', builtIn: it.category === 'kitchen' || it.category === 'storage' || d.h >= 1.8 });
    }
  }
  return out;
}
/** furniture outlines of a level (plan background) */
export const furnitureOutlines = (level: LevelId, s: DesignState = design.get()): Vec2[][] => furnitureOf(s, level).map((f) => f.corners);
/** context for coordination warnings: door leaves in the open position and room furnishings */
export function coordContext(s: DesignState = design.get()): CoordContext {
  const doorLeaves = allDoors().filter((d) => d.hinge).map((d) => { const l = leafSegment(d, 1); return l ? { roomIds: d.rooms as string[], a: l.a, b: l.b, name: d.id } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
  return { doorLeaves, furniture: furnitureOf(s) };
}
