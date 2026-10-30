// Surface roles from manifold original ids (ADR 0025). Every input solid of a boolean is registered with `asOriginal()` and gets
// a tag: what it is (the level mass, a slab, a room void, an opening cutter, a stair shaft; on the roof a wing, the space under
// the roof, a chimney, a parapet, a roof window cutter) and whose (level, room, opening, wing).
// After `getMesh()` each triangle run carries the original id of its input; the tag and the triangle normal give the role.
// Nothing is guessed from positions.
import type { LevelId, Vec3 } from '../package/types.ts';
import type { Manifold } from './wasm.ts';

/** what an input solid is */
export type TagKind = 'mass' | 'slab' | 'room' | 'opening' | 'shaft' | 'roof' | 'roof-space' | 'chimney' | 'parapet' | 'roof-window';

export interface Tag {
  kind: TagKind;
  level: LevelId;
  roomId?: string;
  /** opening id (door, window, passage) of an opening cutter */
  holeId?: string;
  wallId?: string;
  stairId?: string;
  /** roof part or dormer of a roof input */
  wingId?: string;
  /** a flat roof part (its covering is a membrane or gravel, not tiles) */
  flat?: boolean;
  chimneyId?: string;
}

/** surface roles; the index is the role code stored per triangle */
export const ROLES = ['elevation', 'slab', 'room-wall', 'room-floor', 'room-ceiling', 'reveal', 'shaft', 'roof', 'roof-flat', 'eaves', 'roof-underside', 'chimney'] as const;
export type Role = (typeof ROLES)[number];
export const roleCode = (r: Role): number => ROLES.indexOf(r);

/** a face is horizontal when its normal is within ~60° of vertical; room faces facing down are ceilings; a roof face is the
 *  covering when it faces up at all (pitches up to 75°: n[2] ≥ 0.26) */
const UP = 0.5, DOWN = -0.02, COVER = 0.1;

/** role of a triangle of an input solid with the given (outward, unit) normal */
export function roleOf(tag: Tag, n: Vec3): Role {
  switch (tag.kind) {
    case 'mass': return Math.abs(n[2]) < UP ? 'elevation' : 'slab';
    case 'slab': return 'slab';
    case 'room': return n[2] > UP ? 'room-floor' : n[2] < DOWN ? 'room-ceiling' : 'room-wall';
    case 'opening': return 'reveal';
    case 'shaft': return 'shaft';
    // the roof: its top is the covering, its edges are the fascia and the verges; its underside (the space below it) is the
    // ceiling of the rooms and the soffit of the eaves
    case 'roof': return n[2] > COVER ? (tag.flat ? 'roof-flat' : 'roof') : 'eaves';
    case 'roof-space': return n[2] < DOWN ? 'roof-underside' : n[2] > UP ? 'slab' : 'eaves';
    case 'chimney': return 'chimney';
    case 'parapet': return Math.abs(n[2]) < UP ? 'elevation' : 'slab';
    case 'roof-window': return 'reveal';
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
