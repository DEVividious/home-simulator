// The mount record as the source of truth after loading a document (docs/adr/0003): the world position of a wall object is
// recomputed from { wallId, u, height }; stale x / y in the file do not move the object relative to the wall.
// Data: demo apartment — the TV of the project layout hangs on the living-room north wall R1-w3 (y = 3.90, run from the corner
// x = 8.70 towards x = 2.52, length 6.18 m, ceiling 2.60 m; door D3 at u 4.60…5.50). Knee walls and a partition end shorter than a
// TV: the fixture src/test/fixtures/mount-lab (room AR under a sloped ceiling, room LR with a 0.115 m face).
import { describe, expect, it } from 'vitest';
import { itemById } from '../catalog/providers';
import { defaultFurniture } from '../model/defaults';
import { mountSurfaces, surfaceOfWall } from '../model/mount';
import { boxRect, checkMount, type MountRect } from '../model/mountDrag';
import { duplicateSpot, furnitureBox, mountedAt, mountedDrop, mountedPatch, mountedRects, mountWarnings, normalizeDocMounted, normalizeMounted, patchPlacement, storedMountWarnings } from '../model/mountedFurniture';
import { findFreeSpot } from '../model/placement';
import { allRooms, roomById } from '../model/rooms';
import type { Arrangement, FurniturePlacement, RoomInterior } from '../model/types';
import { withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { fixtureDir } from '../../test/setup';

const ROOM = 'R1';
const lab = readProjectDir(fixtureDir('mount-lab'));
const inLab = <T,>(fn: () => T): T => withProject(lab, fn);
const tvOf = () => defaultFurniture(ROOM).find((f) => f.catalogId === 'tv-wall')!;
const tvWall = () => surfaceOfWall(ROOM, tvOf().mount!.wallId)!;
const docWith = (furniture: Arrangement['furniture']) => {
  const a: Arrangement = { id: 'a1', name: 'A', furniture, finishes: { walls: {}, floor: null, ceiling: null } };
  const ri: RoomInterior = { activeArrangementId: 'a1', arrangements: [a] };
  return { variants: [{ id: 'v1', interiors: { [ROOM]: ri } }, { id: 'v2' }] };
};
/** wall object on surface `s` at (u, v) — record and position as after a drag */
const hang = (id: string, catalogId: string, variant: string | null, s: ReturnType<typeof tvWall>, u: number, v: number): FurniturePlacement => {
  const base: FurniturePlacement = { id, catalogId, variant, x: 0, y: 0, rot: 0 };
  return { ...base, ...mountedPatch(s, furnitureBox(itemById(catalogId)!, base), u, v) };
};

describe('loading a document: wall objects from the mount record', () => {
  it('TV of the project layout: mount record and position from the package data (x = 6.30; wall face 3.90 − gap − half the depth)', () => {
    const tv = tvOf();
    expect(tv.mount).toEqual({ wallId: 'R1-w3', u: 2.4, height: 1 });
    expect(tv.x).toBeCloseTo(6.3, 6);
    expect(tv.y).toBeCloseTo(3.9 - 0.005 - 0.025, 6);
    expect(tv.rot).toBe(180);
  });

  it('stale x / y / rot / height in the file — after loading the object returns to the place from the mount record', () => {
    const tv = tvOf();
    const stale = { ...tv, x: tv.x + 0.5, y: tv.y - 0.2, rot: 90, elevation: 0.2 };
    const out = normalizeMounted(ROOM, [stale]);
    expect(out[0].mount).toEqual(tv.mount);
    expect(out[0].x).toBeCloseTo(6.3, 6);
    expect(out[0].y).toBeCloseTo(3.87, 6);
    expect(out[0].rot).toBe(tv.rot);
    expect(out[0].elevation).toBeCloseTo(tv.mount!.height, 9);
  });

  // A record pointing at a wall that does not exist (changed project data, document from another package version) used to be removed
  // silently — an object hanging on a real wall lost its record. Now it is first re-hung by its position.
  it('a record pointing at a missing wall, the object hanging on a real wall — the record is repaired from the position, position unchanged', () => {
    const tv = tvOf(), orphan = { ...tv, mount: { ...tv.mount!, wallId: 'no-such-wall' } };
    const out = normalizeMounted(ROOM, [orphan])[0];
    expect(out.mount).toEqual(tv.mount);                                             // the real wall, the same place and height
    expect(out.x).toBeCloseTo(tv.x, 6);
    expect(out.y).toBeCloseTo(tv.y, 6);
    expect(out.rot).toBeCloseTo(tv.rot, 6);
    expect(out.elevation!).toBeCloseTo(tv.elevation!, 6);
    expect(normalizeMounted(ROOM, [out])[0]).toBe(out);                               // a second load changes nothing
  });

  it('a record pointing at a missing wall, the object in the middle of the room (no wall in reach) — record removed, position unchanged', () => {
    const tv = tvOf(), far = { ...tv, x: 5.5, y: 2.0, mount: { ...tv.mount!, wallId: 'no-such-wall' } };
    const out = normalizeMounted(ROOM, [far])[0];
    expect(out.mount).toBeUndefined();
    expect([out.x, out.y, out.rot, out.elevation]).toEqual([5.5, 2.0, tv.rot, tv.elevation]);
  });

  it('a free-standing item with a stray mount record — record removed, position unchanged', () => {
    const sofa = defaultFurniture(ROOM).find((f) => !itemById(f.catalogId)?.mount)!, stray = { ...sofa, mount: { ...tvOf().mount! } };
    const out = normalizeMounted(ROOM, [stray])[0];
    expect(out.mount).toBeUndefined();
    expect([out.x, out.y, out.rot]).toEqual([sofa.x, sofa.y, sofa.rot]);
  });

  it('changing the depth of a wall object (dimension or variant) recomputes its centre — the back stays at the wall', () => {
    // a 90 × 22 × 20 shelf above the TV, on its axis (x = 6.30; wall face y = 3.90): centre = face − 5 mm gap − half the depth
    const tv = tvOf();
    const shelf = { id: 'shelf', catalogId: 'wall-shelf', x: 6.3, y: 3.9 - 0.005 - 0.11, rot: 180, elevation: 2.0, mount: { ...tv.mount!, height: 2.0 } };
    const a: Arrangement = { id: 'a1', name: 'A', furniture: [shelf], finishes: { walls: {}, floor: null, ceiling: null } };
    const deeper = patchPlacement(ROOM, a, 'shelf', { dims: { d: 0.34 } }).furniture[0];
    expect(deeper.dims).toEqual({ d: 0.34 });
    expect(deeper.y).toBeCloseTo(3.9 - 0.005 - 0.17, 6);              // −6 cm: half the depth increase, away from the wall
    expect(deeper.x).toBeCloseTo(6.3, 6);
    expect(deeper.mount).toEqual(shelf.mount);
    // a change unrelated to the box (material) recomputes nothing
    const same = patchPlacement(ROOM, a, 'shelf', { materialId: 'wood-walnut' }).furniture[0];
    expect([same.x, same.y]).toEqual([shelf.x, shelf.y]);
  });

  it('an unchanged document returns the same object (loading does not make the project "unsaved")', () => {
    const doc = docWith(defaultFurniture(ROOM));
    expect(normalizeDocMounted(doc)).toBe(doc);
    const tv = tvOf(), stale = docWith([{ ...tv, x: tv.x - 1 }]);
    const fixed = normalizeDocMounted(stale);
    expect(fixed).not.toBe(stale);
    expect(fixed.variants[1]).toBe(stale.variants[1]);                 // the variant without interiors untouched
    expect(fixed.variants[0].interiors![ROOM].arrangements[0].furniture[0].x).toBeCloseTo(6.3, 6);
  });
});

// ------------------------------------------------------------------ the object stays on the wall
// The mount record gives the object axis. A larger variant or a typed dimension changes the box, not the record — an object at a
// corner stuck out past the wall (TV 55″ → 85″: 335 mm), and a tall mirror variant under the ceiling went 800 mm above it. The same bounds
// (object entirely on the wall, above the floor and below the ceiling) apply when a document is loaded.
describe('box change and document load: the object entirely on the wall and below the ceiling', () => {
  const arr = (furniture: FurniturePlacement[]): Arrangement => ({ id: 'a1', name: 'A', furniture, finishes: { walls: {}, floor: null, ceiling: null } });
  const where = (f: FurniturePlacement) => mountedAt(ROOM, itemById(f.catalogId)!, f)!;

  it('test data: a 6.18 m wall with a 2.60 m ceiling, the run starting at the corner x = 8.70', () => {
    const S = tvWall();
    expect(S.length).toBeCloseTo(6.18, 6);
    expect(S.heightAt(S.length / 2)).toBeCloseTo(2.6, 6);
    expect(S.a).toEqual([8.7, 3.9]);
  });

  it('55″ TV pushed to the corner (u = 0.615) → 85″ variant: u = 0.95, edge in the corner, height unchanged (was: 335 mm past the corner)', () => {
    const tv = hang('tv', 'tv-wall', '55', tvWall(), 0.615, 0.95);
    const big = patchPlacement(ROOM, arr([tv]), 'tv', { variant: '85', dims: null }).furniture[0], at = where(big);
    expect(at.u).toBeCloseTo(0.95, 6);
    expect(at.u - 1.9 / 2).toBeGreaterThanOrEqual(-1e-9);
    expect(at.v).toBe(0.95);
    expect(big.elevation).toBe(0.95);
    expect(big.x + 0.95).toBeCloseTo(8.7, 4);                                         // TV edge = room corner
    // the mount record points at the same place as the position (the source of truth after loading)
    expect(normalizeMounted(ROOM, [big])[0]).toBe(big);
    // a smaller variant at the same place does not move the object
    const small = patchPlacement(ROOM, arr([big]), 'tv', { variant: '55', dims: null }).furniture[0];
    expect(where(small).u).toBeCloseTo(0.95, 6);
  });

  it('mirror in the corner (u = 0.40), width typed as 200 cm → u = 1.00 (was: 600 mm past the corner)', () => {
    const m = hang('mirror', 'mirror', 'rect', tvWall(), 0.4, 1.1);
    const wide = patchPlacement(ROOM, arr([m]), 'mirror', { dims: { w: 2.0 } }).furniture[0], at = where(wide);
    expect(at.u).toBeCloseTo(1.0, 6);
    expect(at.v).toBe(1.1);
  });

  it('mirror under the ceiling (underside 1.70 m, top 2.60 m) → "tall 60 × 170" variant: underside 0.90 m (was: 800 mm above the ceiling)', () => {
    const m = hang('mirror', 'mirror', 'rect', tvWall(), 3.0, 1.7);
    const tall = patchPlacement(ROOM, arr([m]), 'mirror', { variant: 'tall', dims: null }).furniture[0], at = where(tall);
    expect(at.v).toBeCloseTo(0.9, 6);
    expect(tall.elevation).toBeCloseTo(0.9, 6);
    expect(tall.mount!.height).toBeCloseTo(0.9, 6);
    expect(at.u).toBeCloseTo(3.0, 6);
  });

  it('loading: record { u: 99, height: 3.5 } (shelf 90 × 20) → the object entirely on the wall and below the ceiling, record corrected', () => {
    const L = tvWall().length;
    const shelf: FurniturePlacement = { id: 'shelf', catalogId: 'wall-shelf', x: 2.52, y: 3.785, rot: 180, elevation: 3.5, mount: { wallId: tvOf().mount!.wallId, u: 99, height: 3.5 } };
    const out = normalizeMounted(ROOM, [shelf])[0], at = where(out);
    expect(at.u).toBeCloseTo(L - 0.45, 6);
    expect(at.v).toBeCloseTo(2.6 - 0.2, 6);
    expect(out.elevation).toBeCloseTo(2.4, 6);
    expect(out.x - 0.45).toBeCloseTo(2.52, 4);                                        // the far end of the run is the corner x = 2.52
    expect(out.mount!.height).toBeCloseTo(2.4, 6);
    // a second load changes nothing
    expect(normalizeMounted(ROOM, [out])[0]).toBe(out);
  });

  it('objects pushed right to the bound (corner, ceiling) are not touched — a document without differences stays the same object', () => {
    const S = tvWall();
    const list = [hang('tv', 'tv-wall', '55', S, 0.615, 0.95), hang('mirror', 'mirror', 'rect', S, 0.4, 1.7), hang('shelf', 'wall-shelf', null, S, 3.2, 0)];
    expect(normalizeMounted(ROOM, list)).toBe(list);
    const doc = docWith(list);
    expect(normalizeDocMounted(doc)).toBe(doc);
  });
});

// ------------------------------------------------------------------ a new wall object from the catalog on a low wall
// The preview of the dragged card was drawn at the catalog default height, and the dropped object got a mount record with that
// height — on a 1.55 m knee wall a TV ended at 1.79 m, and the first 4 px move dropped it by 243 mm.
describe('a new wall object from the catalog: the default height clamped to the wall', () => {
  const KNEE_ROOM = 'AR';
  /** knee wall: the lowest wall of the fixture room under the sloped ceiling */
  const knee = () => mountSurfaces(KNEE_ROOM).reduce((a, b) => (b.heightAt(b.length / 2) < a.heightAt(a.length / 2) ? b : a));
  const CASES: [string, string | null, number, number][] = [['tv-wall', '65', 0.84, 0.95], ['mirror', 'rect', 0.9, 1.1], ['wall-lamp', null, 0.3, 1.6]];

  it('test data: a knee wall of about 1.55 m (the catalog default heights do not fit)', () => inLab(() => {
    const TOP = knee().heightAt(1.9);
    expect(TOP).toBeGreaterThan(1.5);
    expect(TOP).toBeLessThan(1.6);
    for (const [id, , h, def] of CASES) { expect(itemById(id)!.defaultElevation).toBe(def); expect(def + h).toBeGreaterThan(TOP); }
  }));

  it.each(CASES)('%s on the knee wall: the object top below the slope, no slope warning; the created object hangs exactly where the preview was', (id, variant, h) => inLab(() => {
    const KNEE = knee(), TOP = KNEE.heightAt(1.9);
    const item = itemById(id)!, d = mountedDrop(KNEE, item, { variant }, 1.9, []), bottom = d.patch.elevation!;
    expect(bottom + h).toBeLessThanOrEqual(TOP + 1e-4);
    expect(bottom).toBeCloseTo(TOP - h, 3);                                           // pushed up under the slope, not lower
    expect(d.patch.mount!.height).toBe(bottom);
    expect(d.warnings.map((w) => w.kind)).toEqual([]);
    const f: FurniturePlacement = { id: 'new', catalogId: id, variant, ...d.patch };
    expect(normalizeMounted(KNEE_ROOM, [f])[0]).toBe(f);                              // loading / the first move "drops" nothing
    const at = mountedAt(KNEE_ROOM, item, f)!;
    expect(at.surface.id).toBe(KNEE.id);
    expect(at.u).toBeCloseTo(1.9, 6);
    expect(at.v).toBe(bottom);
  }));

  it('on a full-height wall: the catalog default height; at the wall end the object entirely on the wall', () => {
    const S = tvWall(), tv = itemById('tv-wall')!;
    expect(mountedDrop(S, tv, { variant: '65' }, 3.0, []).patch).toMatchObject({ elevation: 0.95, mount: { height: 0.95 } });
    const end = mountedDrop(S, tv, { variant: '65' }, S.length + 3, []).patch;
    expect(mountedAt(ROOM, tv, { id: 'n', catalogId: 'tv-wall', variant: '65', ...end })!.u).toBeCloseTo(S.length - 0.725, 6);
  });

  it('preview warnings are computed for the place the object will hang at (another object on the wall)', () => {
    const S = tvWall(), tv = itemById('tv-wall')!;
    const d = mountedDrop(S, tv, { variant: '65' }, 3.0, [{ id: 'other', name: 'Mirror', u0: 2.6, u1: 3.4, v0: 1.1, v1: 2.0 }]);
    expect(d.warnings.map((w) => w.kind)).toEqual(['overlap']);
  });
});

// ------------------------------------------------------------------ copy of a wall object
// Ctrl+D computed the copy spot only relative to the original — successive copies landed exactly on top of each other, and on a full
// wall a copy was placed on another TV.
describe('copy of a wall object: a spot on the wall without overlapping', () => {
  const TVBOX = furnitureBox(itemById('tv-wall')!, { variant: '65' }), W = 1.45;
  const rect = (id: string, u: number, v: number, box = TVBOX): MountRect => ({ id, name: 'TV', ...boxRect(box, u, v) });
  /** successive Ctrl+D: the copy becomes selected, so the next copy is made from it; a refusal (null) keeps the selection */
  const repeat = (u0: number, v: number, n: number) => {
    const S = tvWall(), all = [rect('tv0', u0, v)], us = [u0], refused: number[] = [];
    let cur = u0;
    for (let i = 1; i <= n; i++) {
      const spot = duplicateSpot(S, TVBOX, cur, v, all);
      if (!spot) { refused.push(i); continue; }
      expect(spot.v).toBe(v);
      all.push(rect(`tv${i}`, spot.u, v)); us.push(spot.u); cur = spot.u;
    }
    return { us, refused, all };
  };
  const pairwise = (us: number[]) => Math.min(...us.flatMap((a, i) => us.slice(i + 1).map((b) => Math.abs(a - b))));

  it('4 successive copies of a 1.45 m TV on the 6.18 m wall (from the corner): axes pairwise at least the object width apart; when there is no room — a refusal instead of a copy on another object', () => {
    const S = tvWall(), { us, refused, all } = repeat(S.length - W / 2, 0.95, 4);
    expect(us.length).toBeGreaterThanOrEqual(3);                                     // the original + at least two copies
    expect(pairwise(us)).toBeGreaterThanOrEqual(W - 1e-9);                           // was: 0 (copies on top of each other)
    expect(us.length + refused.length).toBe(5);
    expect(refused.length).toBeGreaterThan(0);                                       // 5 × 1.45 m does not fit on 6.18 m
    for (const u of us) { expect(u - W / 2).toBeGreaterThanOrEqual(-1e-9); expect(u + W / 2).toBeLessThanOrEqual(S.length + 1e-9); }
    // no pair of objects reports an overlap
    for (const r of all) expect(checkMount(S, TVBOX, (r.u0 + r.u1) / 2, r.v0, all.filter((o) => o !== r)).filter((w) => w.kind === 'overlap')).toEqual([]);
  });

  it('the first copy goes next to the original (10 cm gap), at the same height', () => {
    // the original in the corner at the start of the run (u = W / 2): the only side with room is +u, clear of door D3
    const S = tvWall(), spot = duplicateSpot(S, TVBOX, W / 2, 1.2, [rect('tv0', W / 2, 1.2)])!;
    expect(spot.u).toBeCloseTo(W / 2 + (W + 0.1), 6);
    expect(spot.v).toBe(1.2);
  });

  it('the copy avoids a door opening when the wall has a spot without warnings; an occupied spot next to it is skipped', () => {
    const S = tvWall(), door = S.holes.find((h) => h.kind === 'door')!;              // door D3: u 4.60…5.50
    const u0 = door.u0 - W / 2 - 0.05, spot = duplicateSpot(S, TVBOX, u0, 0.95, [rect('tv0', u0, 0.95)])!;
    expect(checkMount(S, TVBOX, spot.u, spot.v, [rect('tv0', u0, 0.95)])).toEqual([]);   // neither the door nor another object
    expect(Math.abs(spot.u - u0)).toBeGreaterThanOrEqual(W);
    // another object already hangs next to the original: the copy goes farther, not onto it
    const mirror: MountRect = { id: 'mirror', name: 'Mirror', u0: u0 - W / 2 - 0.85, u1: u0 - W / 2 - 0.05, v0: 1.1, v1: 2.0 };
    const next = duplicateSpot(S, TVBOX, u0, 0.95, [rect('tv0', u0, 0.95), mirror])!;
    expect(next.u + W / 2 <= mirror.u0 + 1e-9 || next.u - W / 2 >= mirror.u1 - 1e-9).toBe(true);
  });

  it('a wall shorter than two objects: no room', () => {
    const short = allRooms().flatMap((r) => mountSurfaces(r.id)).find((x) => x.length > W && x.length < 2 * W)!;   // e.g. a 2.10 m hallway wall
    expect(short).toBeTruthy();
    expect(duplicateSpot(short, TVBOX, short.length / 2, 0.95, [rect('tv0', short.length / 2, 0.95)])).toBeNull();
    const full = repeat(tvWall().length - W / 2, 0.95, 8);
    expect(duplicateSpot(tvWall(), TVBOX, full.us[full.us.length - 1], 0.95, full.all)).toBeNull();
  });
});

// ------------------------------------------------------------------ "free spot" for a wall object
// Clicking a catalog card searched for a spot with the rules of FREE-STANDING furniture: glazing was only information, so a mirror,
// a shelf or a wall cabinet landed on a window.
describe('free spot for a wall object (clicking a catalog card)', () => {
  const issues = (p: FurniturePlacement, list: FurniturePlacement[]) => {
    const item = itemById(p.catalogId)!, at = mountedAt(ROOM, item, p);
    return at ? checkMount(at.surface, at.box, at.u, at.v, mountedRects(ROOM, list, at.surface, p.id)).map((w) => `${w.kind}${w.withId ? `:${w.withId}` : ''}`) : ['not on a wall'];
  };

  it.each(['mirror', 'wall-shelf', 'kitchen-wall', 'tv-wall', 'wall-lamp'])('%s in the furnished living room: on a wall, off windows and doors, not overlapping other wall objects', (id) => {
    const room = roomById(ROOM)!, furniture = defaultFurniture(ROOM);
    const p = findFreeSpot(room, itemById(id)!, { id: 'new' }, furniture);
    expect(issues(p, furniture)).toEqual([]);
    expect(p.mount).toBeTruthy();                                                    // the record comes with a mount record right away
    expect(normalizeMounted(ROOM, [p])[0]).toBe(p);
  });

  it.each(['mirror', 'wall-shelf', 'kitchen-wall'])('%s: the free spot keeps 5 cm from window edges, other objects and the wall end (not flush with a reveal)', (id) => {
    const room = roomById(ROOM)!, furniture = defaultFurniture(ROOM);
    const p = findFreeSpot(room, itemById(id)!, { id: 'new' }, furniture), item = itemById(id)!, at = mountedAt(ROOM, item, p)!;
    const wide = { ...at.box, w: at.box.w + 0.1 };
    expect(checkMount(at.surface, wide, at.u, at.v, mountedRects(ROOM, furniture, at.surface, p.id)).map((w) => `${w.kind}${w.withId ? `:${w.withId}` : ''}`)).toEqual([]);
  });

  it('empty living room: the mirror nearest the room centre hangs on a solid wall part, not on a window', () => {
    const p = findFreeSpot(roomById(ROOM)!, itemById('mirror')!, { id: 'new' }, []);
    expect(issues(p, [])).toEqual([]);
  });

  it('objects added one after another by clicking do not land on each other', () => {
    const room = roomById(ROOM)!, list = [...defaultFurniture(ROOM)];
    for (let i = 0; i < 4; i++) { const p = findFreeSpot(room, itemById('mirror')!, { id: `mirror-${i}` }, list); expect(issues(p, list)).toEqual([]); list.push(p); }
  });

  it('a given spot (near): the nearest free spot on the wall at that point', () => {
    const S = tvWall(), q: [number, number] = [S.a[0] + S.dir[0] * 3.0 + S.normal[0] * 0.3, S.a[1] + S.dir[1] * 3.0 + S.normal[1] * 0.3];
    const p = findFreeSpot(roomById(ROOM)!, itemById('wall-lamp')!, { id: 'new' }, [], q);
    const at = mountedAt(ROOM, itemById('wall-lamp')!, p)!;
    expect(at.surface.id).toBe(S.id);
    expect(at.u).toBeCloseTo(3.0, 1);
  });

  it('free-standing furniture: unchanged (a desk in the bedroom by a wall, without a mount record)', () => {
    const p = findFreeSpot(roomById('R2')!, itemById('desk')!, {}, []);
    expect(p.mount).toBeUndefined();
  });
});

// ------------------------------------------------------------------ warnings after release = warnings while dragging
// While dragging, a wall object was assessed by the mounting rules ("Overlaps a window" — a warning), and after release by the
// free-standing rules (the same place: only information; an object above the ceiling or wider than the wall — nothing).
describe('warnings of a stored wall object: the same rules as while dragging', () => {
  const kinds = (w: { kind: string; level: string }[] | null) => (w ?? []).map((x) => `${x.kind}/${x.level}`);
  const stored = (p: FurniturePlacement, list: FurniturePlacement[] = [p], roomId = ROOM) => storedMountWarnings(roomId, itemById(p.catalogId)!, p, list);

  it('mirror over window W2 (east wall): a "window" warning (was: only information) — identical to the drag warnings', () => {
    const E = surfaceOfWall(ROOM, 'R1-w2')!, win = E.holes.find((h) => h.kind === 'window')!;
    const m = hang('mirror', 'mirror', 'rect', E, (win.u0 + win.u1) / 2, 1.1);
    expect(kinds(stored(m))).toEqual(['window/warn']);
    expect(stored(m)).toEqual(mountWarnings(E, furnitureBox(itemById('mirror')!, m), (win.u0 + win.u1) / 2, 1.1, []));
  });

  it('a TV on a face shorter than itself (0.115 m): "outside the wall" (was: no warning)', () => inLab(() => {
    const short = mountSurfaces('LR').reduce((a, b) => (b.length < a.length ? b : a));
    expect(short.length).toBeLessThan(0.5);
    expect(kinds(stored(hang('tv', 'tv-wall', '65', short, short.length / 2, 0.95), undefined, 'LR'))).toEqual(['outside/warn']);
  }));

  it('an object above the ceiling: "slope / ceiling" (was: no warning)', () => {
    expect(kinds(stored(hang('mirror', 'mirror', 'tall', tvWall(), 3.2, 1.7)))).toEqual(['slope/warn']);   // top 3.40 m under a 2.60 m ceiling
  });

  it('two wall objects on top of each other: "overlaps" naming the other object; an object on a solid wall: no warnings', () => {
    const S = tvWall();
    const a = hang('a', 'tv-wall', '65', S, 2.4, 0.95), b = hang('b', 'mirror', 'rect', S, 2.7, 1.2), c = hang('c', 'wall-lamp', null, S, 1.0, 1.6);
    expect(stored(a, [a, b, c])).toMatchObject([{ kind: 'overlap', level: 'warn', others: ['b'] }]);
    expect(stored(c, [a, b, c])).toEqual([]);
  });

  it('free-standing furniture and a wall object moved away from the wall: null (assessed by the free-standing rules)', () => {
    const sofa = defaultFurniture(ROOM).find((f) => f.catalogId !== 'tv-wall' && !itemById(f.catalogId)?.mount)!;
    expect(stored(sofa)).toBeNull();
    expect(stored({ id: 'tv', catalogId: 'tv-wall', variant: '65', x: 5.5, y: 2.0, rot: 0, elevation: 1.2 })).toBeNull();
  });
});
