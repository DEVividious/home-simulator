// Furniture as walk obstacles (usability issue B13): the footprint and height of every item of the active arrangement, for the
// walk's stop before what stands at eye height (model/walk.ts). Read on demand and cached per arrangement state.
import { obbCorners } from '@home-sim/core/model/geom2d';
import { elevationOf, resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { obbOf } from '../model/collision';
import { allRooms } from '../model/rooms';
import { setWalkObstacles, type WalkObstacle } from '../model/walk';
import { project } from '../../project/active';
import { arrangementOf, design, variantOf } from './design';

let key: unknown[] = [], cache: WalkObstacle[] = [];
function walkObstacles(): WalkObstacle[] {
  const s = design.get(), now = [variantOf(s).interiors, project(), s.draft];
  if (now.every((x, i) => x === key[i])) return cache;
  const out: WalkObstacle[] = [];
  for (const room of allRooms()) {
    for (const p of arrangementOf(s, room.id).furniture) {
      const item = itemById(p.catalogId);
      if (!item || item.flat || item.inDoorway) continue;
      const d = resolveDims(item, p), bottom = elevationOf(item, p);
      out.push({ level: room.level, corners: obbCorners(obbOf(p, d)), bottom, top: bottom + d.h });
    }
  }
  key = now; cache = out;
  return out;
}

setWalkObstacles(walkObstacles);
