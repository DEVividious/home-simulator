// Surface roles from manifold original ids (ADR 0025). Every input solid of a boolean is registered with `asOriginal()` and gets
// a tag: what it is (the level mass, a slab, a room void, an opening cutter, a stair shaft) and whose (level, room, opening).
// After `getMesh()` each triangle run carries the original id of its input; the tag and the triangle normal give the role.
// Nothing is guessed from positions.
import type { LevelId, Vec3 } from '../package/types.ts';
import type { Manifold } from './wasm.ts';

/** what an input solid is */
export type TagKind = 'mass' | 'slab' | 'room' | 'opening' | 'shaft';

export interface Tag {
  kind: TagKind;
  level: LevelId;
  roomId?: string;
  /** opening id (door, window, passage) of an opening cutter */
  holeId?: string;
  wallId?: string;
  stairId?: string;
}

/** surface roles; the index is the role code stored per triangle */
export const ROLES = ['elevation', 'slab', 'room-wall', 'room-floor', 'room-ceiling', 'reveal', 'shaft'] as const;
export type Role = (typeof ROLES)[number];
export const roleCode = (r: Role): number => ROLES.indexOf(r);

/** a face is horizontal when its normal is within ~60° of vertical; room faces facing down are ceilings */
const UP = 0.5, DOWN = -0.02;

/** role of a triangle of an input solid with the given (outward, unit) normal */
export function roleOf(tag: Tag, n: Vec3): Role {
  switch (tag.kind) {
    case 'mass': return Math.abs(n[2]) < UP ? 'elevation' : 'slab';
    case 'slab': return 'slab';
    case 'room': return n[2] > UP ? 'room-floor' : n[2] < DOWN ? 'room-ceiling' : 'room-wall';
    case 'opening': return 'reveal';
    case 'shaft': return 'shaft';
  }
}

/** original id → tag, for one boolean */
export class TagTable {
  readonly byId = new Map<number, Tag>();
  /** marks a solid as an original and records its tag; returns the original (a new object — the caller keeps it in a scope) */
  original(m: Manifold, tag: Tag): Manifold {
    const o = m.asOriginal();
    this.byId.set(o.originalID(), tag);
    return o;
  }
  get(id: number): Tag | undefined { return this.byId.get(id); }
}
