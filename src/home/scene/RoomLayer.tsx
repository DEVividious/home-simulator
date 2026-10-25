// Rooms in the scene: (1) level section — pickable room floors (highlight, click = enter the room); (2) finishes chosen by the
// user (walls, floor, ceiling) — thin layers in front of the building model faces; (3) in Room Mode — clickable walls / floor /
// ceiling (selection → materials panel). Room geometry is constant (cached).
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { neutralFinish } from '../catalog/materials';
import { roomById, roomsOfLevel, allRooms, type HomeRoom } from '../model/rooms';
import type { Arrangement, FinishRef, LevelId, RoomInterior } from '../model/types';
import { stableInterior, useDesign, variantOf } from '../store/design';
import { clickSurface, enterRoom, selectedWallIds, ui, useUi , qualityProfile } from '../store/ui';
import { boundaryBand } from '../three/boundaryBand';
import { ARCH_PLANES, nearWalls, patchFurnitureTree, patchMaterial, patchTree, setCutaway } from '../three/cutaway';
import { tuneJoinery } from '../three/glass';
import { getMaterial } from '../three/materials';
import { ceilingGeometry, floorGeometry, outlineBand, revealGeometry, wallGeometry } from '../three/surfaces';
import { sceneApi, wasClick } from './sceneApi';
import { cutHeight, type SceneMode } from './sceneMode';

// ------------------------------------------------------------------ geometries (constant — rooms do not change during a session)
const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.computeBoundingSphere(); geoCache.set(key, g); }
  return g;
}
// wall finish together with the window reveals, floor together with the sill up to the window frame (three/surfaces.ts → revealGeometry)
export const wallGeo = (room: HomeRoom, wallId: string) => cached(`w|${wallId}`, () => { const w = room.walls.find((x) => x.id === wallId)!, g = wallGeometry(room, w), r = revealGeometry(room, w).jambs; return r ? mergeGeometries([g, r], false) ?? g : g; });
export const floorGeo = (room: HomeRoom) => cached(`f|${room.id}`, () => { const g = floorGeometry(room), sills = room.walls.map((w) => revealGeometry(room, w).sill).filter((x): x is THREE.BufferGeometry => !!x); return sills.length ? mergeGeometries([g, ...sills], false) ?? g : g; });
export const ceilingGeo = (room: HomeRoom) => cached(`c|${room.id}`, () => ceilingGeometry(room));
const pickFloorGeo = (room: HomeRoom) => cached(`p|${room.id}`, () => floorGeometry(room, 0.02));
const bandGeo = (room: HomeRoom) => cached(`b|${room.id}`, () => outlineBand(room));
const BAND = new THREE.MeshBasicMaterial({ color: '#2f6fed', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

// ------------------------------------------------------------------ helper materials
/** invisible but hit by rays (pointing at surfaces without a chosen finish) */
const PICK = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
const highlight = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const HOVER = highlight('#0d99ff', 0.16);
/**
 * Marker of the SELECTED surface: an accent-coloured band along its edge (wall outline including openings, floor perimeter,
 * ceiling perimeter). A semi-transparent blue overlay over the whole surface would recolour, with the materials panel open, what
 * the user is choosing (terracotta rgb(112, 69, 56) looked like rgb(100, 101, 107)). The surface interior stays untouched.
 * 8 cm band: wider than the room band (BAND, 5 cm, semi-transparent) — a selected floor differs from an unselected one. The
 * material has section and wall cutaway applied (like the finishes): the band of a wall cut away in front of the camera vanishes with it.
 */
const MARK_W = 0.08;
const MARK = new THREE.MeshBasicMaterial({ color: '#2f6fed', depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, clippingPlanes: ARCH_PLANES, name: 'MAT_Surface_Selected' });
patchMaterial(MARK);
/** surface edge band (cached like the finish geometries); computed from the finish alone — without the reveals and sills merged into the mesh */
const markGeo = (key: string, surface: () => THREE.BufferGeometry) => cached(`m|${key}`, () => { const src = surface(), g = boundaryBand(src, MARK_W); src.dispose(); return g; });
const ROOM_HOVER = highlight('#0d99ff', 0.22);
const ROOM_SEL = highlight('#0d99ff', 0.34);

const finishMat = (f: FinishRef) => getMaterial(f.materialId, { layout: f.layout, color: f.color, side: THREE.FrontSide, clipped: true });

// ------------------------------------------------------------------ level section: room picking
export function RoomPicks({ level }: { level: LevelId }) {
  const hover = useUi((s) => s.hoverRoom);
  const sel = useUi((s) => (s.selection?.kind === 'room' ? s.selection.roomId : null));
  const rooms = useMemo(() => roomsOfLevel(level), [level]);
  return (
    <group name="HOME_ROOM_PICKS">
      {rooms.map((r) => (
        <mesh key={r.id} geometry={pickFloorGeo(r)} material={r.id === hover ? ROOM_HOVER : r.id === sel ? ROOM_SEL : PICK} userData={{ room: r.id }}
          onPointerMove={(e) => {
            e.stopPropagation();
            // rotating / panning the view (button pressed) — no highlighting of rooms under the cursor
            if (e.nativeEvent.buttons) { if (ui.get().hoverRoom) ui.set({ hoverRoom: null }); return; }
            if (ui.get().hoverRoom !== r.id) ui.set({ hoverRoom: r.id }); document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => { if (ui.get().hoverRoom === r.id) ui.set({ hoverRoom: null }); document.body.style.cursor = ''; }}
          onClick={(e) => { if (!wasClick(e.nativeEvent.clientX, e.nativeEvent.clientY)) return; e.stopPropagation(); document.body.style.cursor = ''; enterRoom(r.id, r.level); }} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ finishes and room surface picking
type Hover = { kind: 'wall'; id: string } | { kind: 'floor' } | { kind: 'ceiling' } | null;

/** finish key (grouping walls with the same material) */
const finKey = (f: FinishRef) => `${f.materialId}|${f.color ?? ''}|${JSON.stringify(f.layout ?? null)}`;
const mergedCache = new Map<string, THREE.BufferGeometry>();
/** room walls with the same finish merged into one mesh (rooms not being edited — fewer draw calls) */
function mergedWalls(room: HomeRoom, ids: string[]) {
  const key = `${room.id}|${ids.join(',')}`;
  let g = mergedCache.get(key);
  if (!g) { g = mergeGeometries(ids.map((id) => wallGeo(room, id))) ?? wallGeo(room, ids[0]); g.computeBoundingSphere(); mergedCache.set(key, g); }
  return g;
}

const RoomSurfaces = memo(function RoomSurfaces({ room, arrangement, interactive, ceiling, neutral }: { room: HomeRoom; arrangement: Arrangement; interactive: boolean; ceiling: boolean; neutral: boolean }) {
  const [hover, setHover] = useState<Hover>(null);
  const selection = useUi((s) => (interactive ? s.selection : null));
  const fin = arrangement.finishes;
  const kind = room.kind;
  // the user's finish, otherwise the neutral one (preview) when enabled
  const wallFin = (id: string): FinishRef | null => fin.walls[id] ?? (neutral ? neutralFinish(kind, 'wall') : null);
  const floorFin = fin.floor ?? (neutral ? neutralFinish(kind, 'floor') : null);
  const ceilFin = fin.ceiling ?? (neutral ? neutralFinish(kind, 'ceiling') : null);
  useEffect(() => { if (!interactive) setHover(null); }, [interactive]);
  const handlers = (h: Exclude<Hover, null>) => interactive ? {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (!sceneApi.locked && !e.nativeEvent.buttons) setHover(h); },
    onPointerOut: () => setHover((x) => (JSON.stringify(x) === JSON.stringify(h) ? null : x)),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!wasClick(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
      e.stopPropagation();
      // ELECTRICAL mode: adding and moving are handled by scene/electricalInput.ts; clicking an empty surface deselects
      if (ui.get().section === 'electrical') { if (ui.get().selection) ui.set({ selection: null, elMore: false }); return; }
      clickSurface(room.id, h.kind === 'wall' ? { kind: 'wall', wallId: h.id } : { kind: h.kind }, { add: e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey });
    },
  } : {};
  const isSel = (h: Exclude<Hover, null>) => !!selection && 'roomId' in selection && selection.roomId === room.id && selection.kind === h.kind && (h.kind !== 'wall' || selectedWallIds(selection).includes(h.id));
  const isHover = (h: Exclude<Hover, null>) => !!hover && hover.kind === h.kind && (h.kind !== 'wall' || (hover.kind === 'wall' && hover.id === h.id));
  // selected: edge band (no surface tint — also under the cursor); hovered: a light overlay that disappears when the cursor leaves
  const overlay = (h: Exclude<Hover, null>, geo: THREE.BufferGeometry, mark: () => THREE.BufferGeometry) => {
    if (isSel(h)) { const m = mark(); return m.getAttribute('position').count ? <mesh geometry={m} material={MARK} raycast={() => {}} renderOrder={2} name={`ROOM_SELECTED_${h.kind}`} /> : null; }
    return isHover(h) ? <mesh geometry={geo} material={HOVER} raycast={() => {}} renderOrder={2} /> : null;
  };

  const floorH = { kind: 'floor' } as const, ceilH = { kind: 'ceiling' } as const;
  // room not being edited: walls merged by finish
  const groups = useMemo(() => {
    if (interactive) return [];
    const m = new Map<string, { f: FinishRef; ids: string[] }>();
    for (const w of room.walls) { const f = wallFin(w.id); if (!f) continue; const k = finKey(f); const g = m.get(k) ?? { f, ids: [] }; g.ids.push(w.id); m.set(k, g); }
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, room, fin.walls, neutral]);
  return (
    <group name={`ROOM_${room.id}`} userData={{ room: room.id }}>
      {interactive ? room.walls.map((w) => {
        const f = wallFin(w.id), h = { kind: 'wall', id: w.id } as const;
        const geo = wallGeo(room, w.id);
        return (
          <group key={w.id}>
            <mesh geometry={geo} material={f ? finishMat(f) : PICK} userData={{ wall: w.id }} {...handlers(h)} receiveShadow />
            {overlay(h, geo, () => markGeo(`w|${w.id}`, () => wallGeometry(room, w)))}
          </group>
        );
      }) : groups.map((g) => <mesh key={finKey(g.f)} geometry={mergedWalls(room, g.ids)} material={finishMat(g.f)} raycast={() => {}} receiveShadow />)}
      {(floorFin || interactive) && (
        <group>
          <mesh geometry={floorGeo(room)} material={floorFin ? finishMat(floorFin) : PICK} userData={{ floor: room.id }} {...handlers(floorH)} raycast={interactive ? undefined : () => {}} receiveShadow />
          {interactive && overlay(floorH, floorGeo(room), () => markGeo(`f|${room.id}`, () => floorGeometry(room)))}
        </group>
      )}
      {(ceilFin || (interactive && ceiling)) && (
        <group>
          <mesh geometry={ceilingGeo(room)} material={ceilFin ? finishMat(ceilFin) : PICK} userData={{ ceiling: room.id }} {...(ceiling && interactive ? handlers(ceilH) : {})} raycast={ceiling && interactive ? undefined : () => {}} />
          {interactive && ceiling && overlay(ceilH, ceilingGeo(room), () => markGeo(`c|${room.id}`, () => ceilingGeometry(room)))}
        </group>
      )}
    </group>
  );
});

/** merged finish part: finish, level, component geometries (walls / floors / ceilings of different rooms) */
interface MergedPart { level: LevelId; f: FinishRef; geos: THREE.BufferGeometry[] }

/**
 * Finishes of rooms NOT being edited, merged across rooms — one mesh per (level × finish).
 * These surfaces are not clickable (raycast disabled — picking applies only to the edited room, and choosing a room in the
 * section goes through RoomPicks), so merging needs no room / wall identification. Geometry (coordinates, UVs in metres) unchanged.
 * Unmerged, every room would cost 3 draw calls (× 2 with the glass transmission pass).
 * Split by level — in the section and in a room the other level is hidden (Room Mode: only what is visible).
 */
function MergedFinishes({ parts, levelVisible }: { parts: MergedPart[]; levelVisible: (l: LevelId) => boolean }) {
  const meshes = useMemo(() => parts.map((p) => {
    const g = p.geos.length === 1 ? p.geos[0].clone() : mergeGeometries(p.geos, false) ?? p.geos[0].clone();
    g.computeBoundingSphere();
    return { level: p.level, f: p.f, g };
  }), [parts]);
  useEffect(() => () => meshes.forEach((m) => m.g.dispose()), [meshes]);
  return <>{meshes.map((m) => (
    <mesh key={`${m.level}|${finKey(m.f)}`} name={`FINISH_${m.level}`} geometry={m.g} material={finishMat(m.f)} raycast={() => {}} receiveShadow visible={levelVisible(m.level)} />
  ))}</>;
}

/** finishes of all rooms with a saved interior (active arrangements) + the current room in Room Mode (interactive) */
export function RoomFinishes({ mode, interiors: given, interactive = true }: { mode: SceneMode; interiors?: Record<string, RoomInterior>; interactive?: boolean }) {
  const stored = useDesign((s) => variantOf(s).interiors);
  const interiors = given ?? stored;
  const neutral = useUi((s) => s.neutralInterior);
  const ids = useMemo(() => {
    if (neutral) return allRooms().map((r) => r.id); // neutral interiors: all rooms (also the view through windows)
    const set = new Set(Object.keys(interiors ?? {}));
    if (mode.roomId) set.add(mode.roomId);
    return [...set].filter((id) => roomById(id));
  }, [interiors, mode.roomId, neutral]);
  const group = useRef<THREE.Group>(null);
  useEffect(() => { if (group.current) patchTree(group.current); }); // finishes: cutaway + section
  const cur = roomById(mode.roomId);
  const editId = interactive ? mode.roomId : null;
  const arrOf = (id: string) => { const ri = stableInterior(interiors, id); return ri.arrangements.find((x) => x.id === ri.activeArrangementId) ?? ri.arrangements[0]; };
  // rooms not being edited → parts to merge (level × finish); recomputed only when the finishes / room list change
  const sig = ids.filter((id) => id !== editId).map((id) => `${id}:${JSON.stringify(arrOf(id).finishes)}`).join(';') + `|${neutral}`;
  const parts = useMemo(() => {
    const m = new Map<string, MergedPart>();
    const add = (level: LevelId, f: FinishRef | null | undefined, g: THREE.BufferGeometry) => {
      if (!f) return;
      const k = `${level}|${finKey(f)}`, e = m.get(k) ?? { level, f, geos: [] };
      e.geos.push(g); m.set(k, e);
    };
    for (const id of ids) {
      if (id === editId) continue;
      const room = roomById(id)!, fin = arrOf(id).finishes, kind = room.kind;
      for (const w of room.walls) add(room.level, fin.walls[w.id] ?? (neutral ? neutralFinish(kind, 'wall') : null), wallGeo(room, w.id));
      add(room.level, fin.floor ?? (neutral ? neutralFinish(kind, 'floor') : null), floorGeo(room));
      add(room.level, fin.ceiling ?? (neutral ? neutralFinish(kind, 'ceiling') : null), ceilingGeo(room));
    }
    return [...m.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, editId]);
  // Room Mode / section: the other level is invisible (above the section or below the floor) — not drawn
  const levelVisible = (l: LevelId) => mode.kind === 'exterior' || mode.kind === 'walk' || l === mode.level;
  return (
    <group ref={group} name="HOME_FINISHES">
      {interactive && cur && mode.roomView !== 'walk' && <mesh geometry={bandGeo(cur)} material={BAND} raycast={() => {}} renderOrder={3} name="ROOM_OUTLINE" />}
      <MergedFinishes parts={parts} levelVisible={levelVisible} />
      {editId && cur && <RoomSurfaces key={editId} room={cur} arrangement={arrOf(editId)} interactive ceiling={mode.roomView === 'walk'} neutral={neutral} />}
    </group>
  );
}

/** cutaway of walls hiding the current room (Room Mode 3D) — updated every frame from the camera position */
export function RoomCutaway({ mode }: { mode: SceneMode }) {
  const scene = useThree((s) => s.scene);
  const room = mode.kind === 'room' && mode.roomView === '3d' ? roomById(mode.roomId) : null;
  const n = useRef(-1e9);
  useEffect(() => { if (!room) setCutaway(null, []); }, [room]);
  useEffect(() => () => setCutaway(null, []), []);
  useFrame(({ camera }) => {
    // new architecture materials (e.g. after changing openings) — attach cutaway and tune glass every 0.5 s (by time, not frames)
    const now = performance.now();
    if (now - n.current > 500) {
      n.current = now;
      const arch = scene.getObjectByName('HOME_ARCH');
      if (arch) { patchTree(arch, arch.getObjectByName('HOUSE')); tuneJoinery(arch, qualityProfile().glass); }
      // furniture — also both sides of the A/B comparison
      for (const furn of scene.getObjectsByProperty('name', 'HOME_FURNITURE')) patchFurnitureTree(furn);
    }
    if (room) setCutaway(room, nearWalls(room, camera.position), cutHeight(room.level));
  });
  return null;
}
