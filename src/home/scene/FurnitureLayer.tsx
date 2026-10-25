// Furniture in the scene: shared geometries (cached by dimensions) and materials (cached by material) — moving furniture changes
// only its group transform; neither the building nor other furniture is rebuilt. Selection: outline + rotation ring; outline
// colour by warnings (collision / door / window / slope). GLB models (import) — lazily, with scale and pivot normalisation.
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Component, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { elevationOf, generatorOptions, isWallMounted, resolveDims, slotMaterials, type CatalogItem } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { furnitureWarnings, warningLevel } from '../model/collision';
import { pointInPolygon, rad } from '../model/geom2d';
import { storedMountWarnings } from '../model/mountedFurniture';
import { neighbours } from '../model/placement';
import { hasDefaultFurniture } from '../model/defaults';
import { roomById, allRooms, type HomeRoom } from '../model/rooms';
import type { Arrangement, Dims, FurniturePlacement, RoomInterior } from '../model/types';
import { activeArrangement } from '../model/interiors';
import { stableInterior, useArrangement, useDesign, variantOf } from '../store/design';
import { useDrag } from '../store/drag';
import { enterRoom, toast, ui, useUi } from '../store/ui';
import { t } from '../../i18n';
import { isCoarse } from '../store/layout';
import { furnitureGeometries, furnitureMovingGeometries } from '../three/furnitureGeometry';
import { toggleFurnitureOpen, useFurnitureOpen } from '../store/furnitureOpen';
import { partMotion } from '../catalog/generators';
import { isNearest, isNearestSolid, longPressFired, pressStart } from './press';
import { wake } from './renderLoop';
import { getMaterial } from '../three/materials';
import { startMove, startRotate } from './interaction';
import { sceneApi, wasClick } from './sceneApi';
import type { SceneMode } from './sceneMode';

const ACCENT = '#0d99ff', WARN = '#e5534b', INFO = '#d4a72c';

// ------------------------------------------------------------------ furniture model
function ParametricModel({ item, p, dims, ghost, openKey }: { item: CatalogItem; p: Pick<FurniturePlacement, 'variant' | 'materialId' | 'slots'>; dims: Dims; ghost?: THREE.Material; openKey?: string }) {
  const opts = useMemo(() => generatorOptions(item, p.variant), [item, p.variant]);
  const gen = item.runtimeModel.generator ?? 'box';
  const geoms = furnitureGeometries(gen, dims, opts), moving = furnitureMovingGeometries(gen, dims, opts);
  const mats = slotMaterials(item, p);
  const mesh = ([slot, g]: [string, THREE.BufferGeometry]) => <mesh key={slot} geometry={g} material={ghost ?? getMaterial(mats[slot] ?? item.defaultMaterial)} castShadow={!ghost && !item.flat} receiveShadow />;
  return <>
    {[...geoms].map(mesh)}
    {moving && <MovingParts openKey={openKey} pivot={moving.motion.pivot} angle={moving.motion.angle}>{[...moving.geoms].map(mesh)}</MovingParts>}
    {/* fixed touch area in the door opening (closed leaf position): the open leaf stands deeper — tapping the opening closes it */}
    {moving && openKey && !ghost && [...moving.geoms].filter(([slot]) => slot !== 'metal').map(([slot, g]) => <mesh key={`hit-${slot}`} geometry={g} material={LEAF_HIT} position={[moving.motion.pivot[0], 0, -moving.motion.pivot[1]]} name="FURNITURE_LEAF_HIT" />)}
  </>;
}

const LEAF_HIT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true, opacity: 0, name: 'MAT_FurnitureLeafHit' });
const LEAF_S = 0.7;
/** smallest side of the hit area of a small wall-mounted object [m] */
const TOUCH_PROXY = 0.36;
const easeLeaf = (t: number) => t * t * (3 - 2 * t);
/** moving parts of furniture (built-in door leaf): rotation about the hinge axis; frames only while moving */
function MovingParts({ openKey, pivot, angle, children }: { openKey?: string; pivot: [number, number]; angle: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null), target = useFurnitureOpen(openKey) ? 1 : 0, cur = useRef(target);
  useEffect(() => { wake(); }, [target]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (cur.current !== target) { const d = Math.min(0.05, dt) / LEAF_S; cur.current = target > cur.current ? Math.min(target, cur.current + d) : Math.max(target, cur.current - d); wake(120); }
    const a = easeLeaf(cur.current) * rad(angle);
    if (g.rotation.y !== a) g.rotation.y = a;
  });
  return <group ref={ref} position={[pivot[0], 0, -pivot[1]]} name="FURNITURE_MOVING" userData={{ openKey }}>{children}</group>;
}

/** GLB model after normalisation: scale (file units → m), pivot (bounds centre, bottom on the floor), front rotation */
function GlbModel({ item, ghost }: { item: CatalogItem; ghost?: THREE.Material }) {
  const { scene } = useGLTF(item.runtimeModel.url!);
  const obj = useMemo(() => {
    const c = scene.clone(true);
    if (ghost) c.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = ghost; });
    return c;
  }, [scene, ghost]);
  const rm = item.runtimeModel, s = rm.scale ?? 1, o = rm.offset ?? [0, 0, 0];
  return (
    <group rotation-y={rad(rm.rotation ?? 0)}>
      <group scale={s} position={[-o[0] * s, -o[1] * s, -o[2] * s]}><primitive object={obj} /></group>
    </group>
  );
}

function PlaceholderBox({ dims }: { dims: Dims }) {
  return <mesh position={[0, dims.h / 2, 0]}><boxGeometry args={[dims.w, dims.h, dims.d]} /><meshStandardMaterial color="#c8ccd2" transparent opacity={0.6} /></mesh>;
}

/** model files the user already knows are missing: one message per file — not per furniture instance and not after every view change */
const reportedMissing = new Set<string>();
/**
 * Errors handled by the model boundary. The scene (react-three-fiber) reports EVERY caught error via `reportError` — as an
 * unhandled page exception (console, error collection tools, tests). A missing model file is handled here and shown to the
 * user as a message, so that report is suppressed; any other error passes through unchanged.
 */
const handledErrors = new WeakSet<object>();
export function swallowHandledModelError(e: { error?: unknown; preventDefault: () => void }) {
  if (typeof e.error === 'object' && e.error !== null && handledErrors.has(e.error)) e.preventDefault();
}
if (typeof window !== 'undefined') window.addEventListener('error', swallowHandledModelError);
interface ModelBoundaryProps { url: string; name: string; fallback: ReactNode; children?: ReactNode }
/**
 * Error boundary of a GLB model. An imported model file is not part of the project — a variant moved from another computer or
 * an offline phone without a copy of the model gives a 404, and `useGLTF` then throws during rendering. Without a boundary AT
 * THE MODEL the exception would unmount the whole scene on every app start (the project could not even be opened to delete the
 * furniture). Here: a placeholder solid with the furniture dimensions — the furniture stays in the scene and can be selected,
 * moved and deleted; the document does not change. A class component: only those catch rendering errors.
 */
export class ModelBoundary extends Component<ModelBoundaryProps, { failed: boolean; url: string }> {
  state = { failed: false, url: this.props.url };
  static getDerivedStateFromError(error: unknown) { if (typeof error === 'object' && error !== null) handledErrors.add(error); return { failed: true }; }
  /** a different model at the same scene place (choosing another 3D model): retry loading */
  static getDerivedStateFromProps(p: ModelBoundaryProps, s: { failed: boolean; url: string }) { return p.url === s.url ? null : { failed: false, url: p.url }; }
  componentDidCatch(error: unknown) {
    if (reportedMissing.has(this.props.url)) return;
    reportedMissing.add(this.props.url);
    // the cause stays in the console as a warning (diagnostics) — the "unhandled exception" report is suppressed above
    console.warn(`Model ${this.props.url} ("${this.props.name}") failed to load — using a placeholder solid.`, error);
    toast(t('scene.modelLoadFailed', { name: this.props.name }), 'warn');
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function FurnitureModel({ item, p, dims, ghost, openKey }: { item: CatalogItem; p: Pick<FurniturePlacement, 'variant' | 'materialId' | 'slots'>; dims: Dims; ghost?: THREE.Material; openKey?: string }) {
  if (item.runtimeModel.type === 'glb' && item.runtimeModel.url) {
    const box = <PlaceholderBox dims={dims} />;
    return <ModelBoundary url={item.runtimeModel.url} name={item.name} fallback={box}><Suspense fallback={box}><GlbModel item={item} ghost={ghost} /></Suspense></ModelBoundary>;
  }
  return <ParametricModel item={item} p={p} dims={dims} ghost={ghost} openKey={openKey} />;
}

// ------------------------------------------------------------------ selection
const edgeCache = new Map<string, THREE.BufferGeometry>();
function boxEdges(d: Dims) {
  const k = `${d.w.toFixed(3)}|${d.d.toFixed(3)}|${d.h.toFixed(3)}`;
  let g = edgeCache.get(k);
  if (!g) { const b = new THREE.BoxGeometry(d.w + 0.02, d.h + 0.02, d.d + 0.02); g = new THREE.EdgesGeometry(b); b.dispose(); edgeCache.set(k, g); }
  return g;
}
const lineMats = new Map<string, THREE.LineBasicMaterial>();
const lineMat = (c: string) => { let m = lineMats.get(c); if (!m) { m = new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true }); lineMats.set(c, m); } return m; };

function SelectionBox({ dims, color }: { dims: Dims; color: string }) {
  return <lineSegments geometry={boxEdges(dims)} material={lineMat(color)} position={[0, dims.h / 2, 0]} renderOrder={10} raycast={() => {}} />;
}

const ringMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
const knobMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, depthTest: false });
const knobRim = new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide, depthTest: false });

export const ringRadius = (dims: Pick<Dims, 'w' | 'd'>) => Math.hypot(dims.w, dims.d) / 2 + 0.16;

/** ring knob angle in the furniture frame [°]: at the front, or — when the front falls outside the room — at the side or back */
export function knobAngle(room: HomeRoom, p: Pick<FurniturePlacement, 'x' | 'y' | 'rot'>, dims: Pick<Dims, 'w' | 'd'>): number {
  const r = ringRadius(dims);
  for (const a of [0, -90, 90, 180]) {
    const t = rad(p.rot + a), q: [number, number] = [p.x - Math.sin(t) * r, p.y + Math.cos(t) * r];
    if (pointInPolygon(q, room.polygon, -1)) return a;
  }
  return 0;
}

/** world metres per screen pixel at point p (perspective: depends on distance; orthographic: constant) */
function worldPerPixel(cam: THREE.Camera, p: THREE.Vector3, viewH: number): number {
  const o = cam as THREE.OrthographicCamera, pc = cam as THREE.PerspectiveCamera;
  if (o.isOrthographicCamera) return (o.top - o.bottom) / o.zoom / Math.max(1, viewH);
  const depth = Math.max(0.1, _v.copy(p).sub(cam.position).dot(cam.getWorldDirection(_d)));
  return (2 * Math.tan((pc.fov * Math.PI) / 360) * depth) / Math.max(1, viewH);
}
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _hit = new THREE.Vector3(), _plane = new THREE.Plane(), UP = new THREE.Vector3(0, 1, 0);
/** rotation handle sizes on touch [screen px]: grab band outside the ring, knob radius, line width */
const TOUCH_RING = { bandPx: 32, innerPx: 12, knobPx: 11, linePx: 2.2 };

/** rotation ring around the selected furniture (knob at the front, or wherever it fits inside the room) */
function RotationRing({ dims, knob, onDown }: { dims: Dims; knob: number; onDown: (e: ThreeEvent<PointerEvent>) => void }) {
  const r = ringRadius(dims);
  const k = rad(knob);
  // on touch the ring has a fixed SCREEN size (grab band ≥ 26 px, knob ≥ 11 px) — with the whole room in view on a phone a
  // ±9 cm band was about ±2 px. The scale (m / px) is computed per frame, rounded to ×1.19 steps (rare geometry rebuilds).
  const coarse = isCoarse();
  const group = useRef<THREE.Group>(null);
  const viewH = useThree((s) => s.size.height);
  const [wpp, setWpp] = useState(0);
  const wppRef = useRef(0);
  useFrame(({ camera }) => {
    if (!coarse || !group.current) return;
    const w = worldPerPixel(camera, group.current.getWorldPosition(_c), viewH);
    wppRef.current = w;
    const q = Math.pow(2, Math.round(Math.log2(w) * 4) / 4);
    if (q !== wpp) setWpp(q);
  });
  const line = coarse && wpp ? Math.max(0.018, (TOUCH_RING.linePx * wpp) / 2) : 0.018;
  const kr = coarse && wpp ? Math.max(0.1, TOUCH_RING.knobPx * wpp) : 0.1;
  const ring = useMemo(() => new THREE.RingGeometry(r - line, r + line, 72).rotateX(-Math.PI / 2), [r, line]);
  const hit = useMemo(() => new THREE.RingGeometry(r - 0.09, r + 0.09, 48).rotateX(-Math.PI / 2), [r]);
  const knobGeo = useMemo(() => new THREE.CircleGeometry(kr * 0.75, 24).rotateX(-Math.PI / 2), [kr]);
  const rim = useMemo(() => new THREE.CircleGeometry(kr, 24).rotateX(-Math.PI / 2), [kr]);
  // dispose the ring geometry on radius change / unmount (selecting other furniture)
  useEffect(() => () => { ring.dispose(); hit.dispose(); }, [ring, hit]);
  useEffect(() => () => { knobGeo.dispose(); rim.dispose(); }, [knobGeo, rim]);
  // touch hit: ray intersection with the ring plane; band from −9 cm (as for the mouse — the inside belongs to the furniture) to
  // +bandPx outside; the ring takes priority over neighbouring furniture in this band (it is drawn above them)
  const raycast = useMemo(() => (!coarse ? undefined : function touchRing(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    this.getWorldPosition(_c);
    _plane.setFromNormalAndCoplanarPoint(UP, _c);
    if (!raycaster.ray.intersectPlane(_plane, _hit)) return;
    // grab band: 12 px inwards (no less than 9 cm as for the mouse, no more than 1/4 of the radius — the centre belongs to the furniture) and 32 px outwards
    const d = _hit.distanceTo(_c), w = wppRef.current || 0, out = Math.max(0.09, TOUCH_RING.bandPx * w), inn = Math.min(r * 0.25, Math.max(0.09, TOUCH_RING.innerPx * w));
    if (d < r - inn || d > r + out) return;
    intersects.push({ distance: raycaster.ray.origin.distanceTo(_hit) * 1e-3, point: _hit.clone(), object: this });
  }), [coarse, r]);
  return (
    <group position={[0, 0.012, 0]} name="ROTATION_RING" ref={group}>
      <mesh geometry={ring} material={ringMat} renderOrder={11} raycast={() => {}} />
      {/* knob (local +y = −Z in three.js; rotated about the vertical by the knob angle) */}
      <mesh geometry={rim} material={knobRim} position={[-Math.sin(k) * r, 0.001, -Math.cos(k) * r]} renderOrder={12} raycast={() => {}} />
      <mesh geometry={knobGeo} material={knobMat} position={[-Math.sin(k) * r, 0.002, -Math.cos(k) * r]} renderOrder={13} raycast={() => {}} />
      <mesh geometry={hit} visible={false} onPointerDown={onDown} userData={{ handle: 'rotate' }} {...(raycast ? { raycast } : {})}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'grab'; }} onPointerOut={() => { document.body.style.cursor = ''; }} />
    </group>
  );
}

/** the last press on furniture came from touch (the click event does not always carry pointerType) */
let touchDown = false;

// ------------------------------------------------------------------ furniture item
/**
 * Furniture in the scene. `walk` — walk mode (room or building). Pointer rules:
 *  • outside walk mode: the mouse drags furniture at once, touch — only selected furniture; the furniture of the room the user
 *    entered is editable;
 *  • in walk mode: the furniture VISIBLE under the pointer reacts — in any room (not the one behind a wall); click / tap selects,
 *    the SELECTED furniture is dragged, and dragging over unselected furniture looks around. In a human perspective furniture
 *    fills the frame — grabbing at once would rearrange the furnishings on every look around. A click never moves the camera
 *    or changes the room.
 */
/** ELECTRICAL mode: the pointer in the scene belongs to the devices (scene/electricalInput.ts) — furniture is background and does not react */
const inert = () => ui.get().section === 'electrical';
const FurnitureItem = memo(function FurnitureItem({ room, p, selected, level, interactive, gizmo, walk }: {
  room: HomeRoom; p: FurniturePlacement; selected: boolean; level: 'warn' | 'info' | null; interactive: boolean; gizmo: boolean; walk: boolean;
}) {
  const draft = useDrag((s) => (s.item && s.item.id === p.id ? s.item : null));
  const live = useDrag((s) => (s.item && s.item.id === p.id ? warningLevel(s.warnings) : null));
  const item = itemById(p.catalogId);
  const dims = useMemo(() => (item ? resolveDims(item, p) : null), [item, p]);
  // the same model element when the position changes (drag preview on every move) — React does not re-render the model
  const model = useMemo(() => (item && dims ? <FurnitureModel item={item} p={p} dims={dims} openKey={p.id} /> : null), [item, p, dims]);
  // furniture with a moving part (a built-in cabinet door): in walk mode tap = open / close, long press = select (card)
  const openable = useMemo(() => !!(item && dims && item.runtimeModel.generator && partMotion(item.runtimeModel.generator, dims, generatorOptions(item, p.variant))), [item, dims, p.variant]);
  if (!item || !dims) return null;
  // wall-mounted object: the position follows from the wall — no rotation ring
  const wallHung = isWallMounted(item);
  const x = draft?.x ?? p.x, y = draft?.y ?? p.y, rot = draft?.rot ?? p.rot;
  const lv = draft ? live : level;
  const select = () => ui.set({ selection: { kind: 'furniture', roomId: room.id, id: p.id } });
  const down = (e: ThreeEvent<PointerEvent>) => {
    // another drag is in progress (camera lock): a further pointer — a second finger — neither starts nor selects anything
    if (e.button !== 0 || inert() || sceneApi.locked) return;
    if (walk) {
      if (!interactive || !isNearest(e)) return;
      e.stopPropagation();
      // furniture with a moving part (built-in door): tap = open / close, long press = select (card)
      if (openable) pressStart(e.nativeEvent, select);
      if (selected) startMove(e.nativeEvent, room.id, p.id, e.point.y);
      return;
    }
    // outside walk mode too, the furniture VISIBLE under the pointer reacts: the building shell does not handle presses, so
    // furniture behind a DRAWN wall would be grabbed "through the wall" — selected on release and moved when dragged (a metre,
    // a history entry), although the user saw and pointed at the wall. Glass does not hide: furniture seen through glazing
    // (camera behind a wall with patio doors) can still be grabbed
    if (!isNearestSolid(e)) return;
    e.stopPropagation();
    if (!interactive) return;
    // touch: a tap selects (in click), only SELECTED furniture moves; dragging over unselected furniture rotates / pans the
    // camera as over empty space (no accidental moves while looking around the room)
    touchDown = e.nativeEvent.pointerType === 'touch';
    if (touchDown && !selected) return;
    // selection happens after the pointer is released (interaction.ts): opening the panel on press would resize the scene under
    // the pressed pointer and shift the dragged furniture; e.point — the grabbed furniture point (grab plane height)
    startMove(e.nativeEvent, room.id, p.id, e.point.y);
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (inert()) return;                                                        // the click passes to the surface behind the furniture (deselecting the device)
    if (walk) {
      if (!interactive || !isNearest(e)) return;
      e.stopPropagation();
      if (longPressFired() || !wasClick(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
      // built-in doors open like ordinary doors (long press = card); other furniture — selection, the walk continues
      if (openable) toggleFurnitureOpen(p.id); else select();
      return;
    }
    e.stopPropagation();
    if (interactive && touchDown && wasClick(e.nativeEvent.clientX, e.nativeEvent.clientY)) { ui.set({ selection: { kind: 'furniture', roomId: room.id, id: p.id } }); return; }
    if (interactive || !wasClick(e.nativeEvent.clientX, e.nativeEvent.clientY)) return;
    // furniture in another room (level section): enter the room and select
    enterRoom(room.id, room.level);
    ui.set({ selection: { kind: 'furniture', roomId: room.id, id: p.id } });
  };
  return (
    <group position={[x, (draft ? roomById(draft.roomId)?.floorZ ?? room.floorZ : room.floorZ) + (draft?.elevation ?? elevationOf(item, p)), -y]} rotation-y={rad(rot)} name={`FURNITURE_${p.id}`} userData={{ furniture: p.id, room: room.id }}
      onPointerDown={down} onClick={click}
      onPointerOver={(e) => { if (inert() || (walk && !isNearest(e))) return; e.stopPropagation(); if (!sceneApi.locked) document.body.style.cursor = (walk ? selected : interactive) ? 'move' : 'pointer'; }}
      onPointerOut={() => { if (!sceneApi.locked) document.body.style.cursor = ''; }}>
      {model}
      {/* small wall-mounted object (sconce, shelf): a larger hit area — the finger need not aim at a dozen pixels */}
      {wallHung && interactive && Math.min(dims.w, dims.h) < TOUCH_PROXY && <mesh position={[0, dims.h / 2, 0]} material={LEAF_HIT} name="FURNITURE_HIT_PROXY"><boxGeometry args={[Math.max(dims.w, TOUCH_PROXY), Math.max(dims.h, TOUCH_PROXY), dims.d + 0.04]} /></mesh>}
      {(selected || draft) && <SelectionBox dims={dims} color={lv === 'warn' ? WARN : lv === 'info' && !selected ? INFO : ACCENT} />}
      {selected && gizmo && !wallHung && <RotationRing dims={dims} knob={knobAngle(room, { x, y, rot }, dims)} onDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); startRotate(e.nativeEvent, room.id, p.id); }} />}
    </group>
  );
});

const RoomFurniture = memo(function RoomFurniture({ roomId, interactive, gizmo, walk, arrangement, visible = true }: { roomId: string; interactive: boolean; gizmo: boolean; walk: boolean; arrangement?: Arrangement; visible?: boolean }) {
  const stored = useArrangement(roomId);
  // A/B comparison: the comparison side's arrangement instead of the active one
  const a = arrangement ?? stored;
  const room = roomById(roomId)!;
  const selId = useUi((s) => (s.selection?.kind === 'furniture' && s.selection.roomId === roomId ? s.selection.id : null));
  // furniture warning level (recomputed only when the arrangement changes)
  const levels = useMemo(() => {
    const nb = neighbours(a.furniture), m = new Map<string, 'warn' | 'info' | null>();
    // wall-mounted object on a wall: mounting rules (the same as during a drag); other furniture — standing furniture rules
    for (const n of nb) m.set(n.id, warningLevel(storedMountWarnings(room.id, n.item, n.placement, a.furniture) ?? furnitureWarnings(room, n.item, n.placement, n.dims, nb.filter((o) => o.id !== n.id))));
    return m;
  }, [a, room]);
  return (
    <group name={`FURNITURE_ROOM_${roomId}`} visible={visible}>
      {a.furniture.map((p) => <FurnitureItem key={p.id} room={room} p={p} selected={selId === p.id} level={levels.get(p.id) ?? null} interactive={interactive} gizmo={gizmo} walk={walk} />)}
    </group>
  );
});

// ------------------------------------------------------------------ catalogue furniture preview and snap guides
const ghostOk = new THREE.MeshStandardMaterial({ color: ACCENT, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshStandardMaterial({ color: WARN, transparent: true, opacity: 0.45, depthWrite: false });

function Ghost() {
  const g = useDrag((s) => s.ghost);
  if (!g) return null;
  const item = itemById(g.catalogId), room = roomById(g.roomId);
  if (!item || !room) return null;
  const p = { variant: g.variant, materialId: null };
  const dims = resolveDims(item, p);
  const bad = g.warnings.some((w) => w.level === 'warn');
  return (
    <group position={[g.x, room.floorZ + (g.elevation ?? item.defaultElevation ?? 0), -g.y]} rotation-y={rad(g.rot)} name="CATALOG_GHOST">
      <group raycast={() => {}}><FurnitureModel item={item} p={p} dims={dims} ghost={bad ? ghostBad : ghostOk} /></group>
      <SelectionBox dims={dims} color={bad ? WARN : ACCENT} />
    </group>
  );
}

const GUIDE_COLORS = { wall: '#0d99ff', corner: '#8250df', align: '#e36209', grid: '#8c959f' } as const;
function Guides({ z }: { z: number }) {
  const guides = useDrag((s) => s.guides);
  const geo = useMemo(() => {
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    for (const g of guides) {
      c.set(GUIDE_COLORS[g.kind]);
      pos.push(g.a[0], z + 0.015, -g.a[1], g.b[0], z + 0.015, -g.b[1]);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    b.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return b;
  }, [guides, z]);
  // snap guides change on every drag move — the previous geometry is disposed (otherwise it would leak)
  useEffect(() => () => geo.dispose(), [geo]);
  if (!guides.length) return null;
  return <lineSegments geometry={geo} renderOrder={12} raycast={() => {}}><lineBasicMaterial vertexColors depthTest={false} transparent /></lineSegments>;
}

// ------------------------------------------------------------------ furniture layer
export function FurnitureLayer({ mode, interiors: given, interactive: canEdit = true }: { mode: SceneMode; interiors?: Record<string, RoomInterior>; interactive?: boolean }) {
  const stored = useDesign((s) => variantOf(s).interiors);
  const interiors = given ?? stored;
  const ids = useMemo(() => {
    const set = new Set(Object.entries(interiors ?? {}).filter(([, ri]) => ri.arrangements.some((a) => a.id === ri.activeArrangementId && a.furniture.length)).map(([id]) => id));
    for (const r of allRooms()) if (!interiors?.[r.id] && hasDefaultFurniture(r.id)) set.add(r.id); // default furnishings from the project data
    if (mode.roomId) set.add(mode.roomId);
    return [...set].filter((id) => roomById(id));
  }, [interiors, mode.roomId]);
  const room = roomById(mode.roomId);
  // in the section and in a room the furniture of other levels is hidden (the section does not clip it — it would be drawn above
  // the section or below the floor); exterior view, building walk and photos — all
  const levelVisible = (l: string) => mode.kind === 'exterior' || mode.kind === 'walk' || l === mode.level;
  // walk (room and building): the furniture of every room reacts to the pointer — visibility under the pointer decides which
  const walking = mode.kind === 'walk' || (mode.kind === 'room' && mode.roomView === 'walk');
  return (
    <group name="HOME_FURNITURE">
      {ids.map((id) => <RoomFurniture key={id} roomId={id} interactive={canEdit && (walking || mode.roomId === id)} gizmo={canEdit && mode.roomId === id && mode.roomView !== 'walk'} walk={walking}
        arrangement={given ? activeArrangement(stableInterior(given, id)) : undefined} visible={levelVisible(roomById(id)!.level)} />)}
      {canEdit && <Ghost />}
      {canEdit && room && <Guides z={room.floorZ} />}
    </group>
  );
}
