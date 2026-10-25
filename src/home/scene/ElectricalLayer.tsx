// Electrical / smart home devices in the 3D scene. Appearance: three/electricalGeometry.ts. Instanced drawing: one mesh per
// shape kind (multi-gang frames = one instance per module) — a few hundred devices take a dozen or so draw calls. Devices are
// visible in every section (they are part of the building); editing only in ELECTRICAL mode.
// Hit testing and dragging: scene/electricalInput.ts (screen space). The preview of a moved / new device, the active wall
// highlight, alignment guides and the ↕ handle are drawn by <PlacePreview> from transient state (store/elPlace.ts) — only it
// changes during the move; the meshes of the other devices are rebuilt only after committing.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { elRoom, EXT, layerOf, measure, resolvePlan, type ElPoint, type Placement } from '../model/electrical';
import { extrasOf } from '../model/variantData';
import { docOf, useDesign, variantOf } from '../store/design';
import { useUi } from '../store/ui';
import { boardGeometry, boardHeight, elShapeGeometry, GANG, isGanged, shapeExtent, shapeOf, type ElShape } from '../three/electricalGeometry';
import { placementOnLevel, runOf } from '../model/elPlacement';
import type { LevelId } from '../model/types';
import { usePlace } from '../store/elPlace';
import { ElSceneInput, elScene, HANDLE_UP } from './electricalInput';
import { wake } from './renderLoop';
import { sceneApi } from './sceneApi';
import type { SceneMode } from './sceneMode';

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0.05, name: 'MAT_Electrical' });
const SEL = new THREE.MeshBasicMaterial({ color: '#0d6efd', name: 'MAT_Electrical_Selected' });
/** preview of a moved / new device: always visible (no depth test — "x-ray" through walls and furniture) */
const GHOST = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, name: 'MAT_Electrical_Ghost' });
const LEVEL_COLOR = { ok: '#0d6efd', warn: '#e08a00', error: '#d43c2f' } as const;
const halo = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
const HALO = { ok: halo(LEVEL_COLOR.ok, 0.55), warn: halo(LEVEL_COLOR.warn, 0.6), error: halo(LEVEL_COLOR.error, 0.6) };
const WALL_HL = new THREE.MeshBasicMaterial({ color: '#0d6efd', transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: 'MAT_Electrical_Wall' });
const GUIDE = new THREE.MeshBasicMaterial({ color: '#0d6efd', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
const HANDLE = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, depthTest: false, depthWrite: false, name: 'MAT_Electrical_Handle' });
const QUAD = new THREE.PlaneGeometry(1, 1);
/** ↕ handle: a blue disc with two white arrows (in the wall plane) */
const HANDLE_GEO = (() => {
  const disc = new THREE.CircleGeometry(0.042, 28), up = new THREE.BufferGeometry(), col = (g: THREE.BufferGeometry, c: string) => { const k = new THREE.Color(c), n = g.getAttribute('position').count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([k.r, k.g, k.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  up.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.03, 0.001, -0.017, 0.008, 0.001, 0.017, 0.008, 0.001, 0, -0.03, 0.001, 0.017, -0.008, 0.001, -0.017, -0.008, 0.001], 3));
  const d = disc.toNonIndexed(); d.deleteAttribute('normal'); d.deleteAttribute('uv');
  const out = new THREE.BufferGeometry(), a = col(d, '#0d6efd'), b = col(up, '#ffffff');
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a.getAttribute('position').array as Float32Array, ...b.getAttribute('position').array as Float32Array]), 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array([...a.getAttribute('color').array as Float32Array, ...b.getAttribute('color').array as Float32Array]), 3));
  return out;
})();
const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3(), S = new THREE.Vector3(), B = new THREE.Matrix4();

/** point frame in the scene (three.js): basis (X along the wall / Y up / Z into the room) and anchor point; null — point without a place */
function frame(p: Pick<ElPoint, 'roomId' | 'wallId' | 'positionAlongWall' | 'heightAFFL' | 'orientation' | 'x' | 'y'>, out: THREE.Matrix4): { h: number } | null {
  const m = measure(p as ElPoint);
  if (!m) return null;
  if (m.wall) {
    X.set(m.wall.dir[0], 0, -m.wall.dir[1]); Y.set(0, 1, 0); Z.set(m.normal[0], 0, -m.normal[1]);
    out.makeBasis(X, Y, Z).setPosition(P.set(m.pos[0], m.pos[2], -m.pos[1]).addScaledVector(Z, 0.004));
    return { h: 0 };
  }
  if (p.orientation === 'ceiling') { out.makeBasis(X.set(1, 0, 0), Y.set(0, 0, 1), Z.set(0, -1, 0)).setPosition(m.pos[0], m.pos[2] - 0.002, -m.pos[1]); return { h: 0 }; }
  const g = m.room.exterior ? sceneApi.ground(m.pos[0], m.pos[1]) ?? elRoom(EXT)!.floorZ : m.room.floorZ, h = Math.max(0.12, p.heightAFFL);
  out.makeBasis(X.set(1, 0, 0), Y.set(0, 0, -1), Z.set(0, 1, 0)).setPosition(m.pos[0], g, -m.pos[1]);
  return { h };
}
const shapeOfPoint = (p: Pick<ElPoint, 'type' | 'orientation'>): ElShape => shapeOf(p.type, p.orientation);

/** instance matrices of a point: [shape, matrix][] (multi-gang frame — one per module) and the hit area / selection frame matrix */
function instancesOf(p: ElPoint): { shape: ElShape; mats: THREE.Matrix4[]; base: THREE.Matrix4; sel: THREE.Matrix4 } | null {
  const base = new THREE.Matrix4(), f = frame(p, base);
  if (!f) return null;
  const shape = shapeOfPoint(p), [w, h] = shapeExtent(shape, p.modules, p.width), mats: THREE.Matrix4[] = [];
  const bh = shape === 'board' ? boardHeight(p.width ?? 0.6) : h;
  if (shape === 'post') mats.push(base.clone().scale(S.set(1, 1, f.h)));
  else if (isGanged(shape) && p.modules > 1) for (let i = 0; i < p.modules; i++) mats.push(base.clone().multiply(B.makeTranslation((i - (p.modules - 1) / 2) * GANG, 0, 0)));
  else mats.push(base.clone());
  // selection frame: outline + 2 cm, right at the wall (finger hit testing — in screen space, scene/electricalInput.ts)
  const sel = shape === 'post' ? base.clone().scale(S.set(0.14, 0.14, 0.01)) : base.clone().multiply(B.makeTranslation(0, 0, 0.0015)).scale(S.set(w + 0.035, bh + 0.035, 0.003));
  return { shape, mats, base, sel };
}

function Batch({ shape, mats }: { shape: ElShape; mats: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null), cap = Math.max(8, Math.ceil(mats.length / 32) * 32);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.count = mats.length; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
    wake();
  }, [mats, cap]);
  return <instancedMesh ref={ref} key={cap} args={[elShapeGeometry(shape), MAT, cap]} frustumCulled={false} raycast={() => {}} castShadow={false} receiveShadow name={`ELECTRICAL_${shape}`} />;
}

/** render counters (performance check: dragging must not rebuild all devices) */
export const elPerf = { layer: 0, preview: 0, batches: 0 };

/**
 * Preview from transient state: the device at its current place (ring colour = placement rating), highlighted active wall,
 * alignment guides. Only this component re-renders while the pointer moves.
 */
function PlacePreview({ cutTop, level }: { cutTop: number | null; level: LevelId | null }) {
  const s = usePlace((x) => x);
  elPerf.preview++;
  const view = useMemo(() => {
    // the preview belongs to the view only on its own level (level: null — walk, any): after a level change during the session
    // a previously pointed place does not stay in the scene a floor below / above
    if (!s?.at || !placementOnLevel(s.at, level)) return null;
    const p = { ...s.at, type: s.type, modules: 1 } as unknown as ElPoint, base = new THREE.Matrix4(), f = frame(p, base);
    if (!f) return null;
    const shape = shapeOfPoint(p), n = isGanged(shape) ? Math.max(1, EL_MODULES(s.type)) : 1, [w, h] = shapeExtent(shape, n, 0.6), bh = shape === 'board' ? boardHeight(0.6) : h;
    const devs = shape === 'post' ? [base.clone().scale(S.set(1, 1, f.h))] : Array.from({ length: n }, (_, i) => base.clone().multiply(B.makeTranslation((i - (n - 1) / 2) * GANG, 0, 0)));
    const ring = shape === 'post' ? null : base.clone().multiply(B.makeTranslation(0, 0, 0.001)).scale(S.set(w + 0.05, bh + 0.05, 1));
    // active wall: the whole run from floor to ceiling / section
    const run = s.at.orientation === 'wall' ? runOf(s.at) : null;
    let wall: THREE.Matrix4 | null = null;
    const lines: THREE.Matrix4[] = [];
    if (run) {
      const L = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]), mx = (run.a[0] + run.b[0]) / 2, my = (run.a[1] + run.b[1]) / 2;
      const top = Math.min(run.room.exterior ? 3 : run.room.ceilingAt(mx + run.inward[0] * 0.1, my + run.inward[1] * 0.1), cutTop === null ? 9 : cutTop - run.room.floorZ);
      const dir = new THREE.Vector3((run.b[0] - run.a[0]) / L, 0, -(run.b[1] - run.a[1]) / L), nz = new THREE.Vector3(run.inward[0], 0, -run.inward[1]);
      const mk = (z: number, sx: number, sy: number, u = 0) => new THREE.Matrix4().makeBasis(dir, Y.set(0, 1, 0), nz).setPosition(mx + run.inward[0] * 0.006 + dir.x * u, run.room.floorZ + z, -(my + run.inward[1] * 0.006) + dir.z * u).scale(S.set(sx, sy, 1));
      wall = mk(top / 2, L, top);
      for (const g of s.guides) {
        if (g.kind === 'height') lines.push(mk(g.value, L, 0.006));
        else lines.push(mk(top / 2, 0.006, top, L / 2 - g.value));          // from the left corner (end b of the run)
      }
    }
    return { shape, devs, ring, wall, lines };
  }, [s?.at, s?.type, s?.guides, cutTop, level]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { wake(); }, [view, s?.check.level]);
  if (!s || !view) return null;
  const lv = s.live ? s.check.level : 'error';
  return (
    <group name="ELECTRICAL_PREVIEW" userData={{ level: lv, mode: s.mode }}>
      {view.wall && <mesh geometry={QUAD} material={WALL_HL} matrix={view.wall} matrixAutoUpdate={false} raycast={() => {}} renderOrder={3} name="ELECTRICAL_ACTIVE_WALL" />}
      {view.lines.map((m, i) => <mesh key={i} geometry={QUAD} material={GUIDE} matrix={m} matrixAutoUpdate={false} raycast={() => {}} renderOrder={5} name="ELECTRICAL_GUIDE" />)}
      {view.ring && <mesh geometry={QUAD} material={HALO[lv]} matrix={view.ring} matrixAutoUpdate={false} raycast={() => {}} renderOrder={6} name="ELECTRICAL_GHOST_RING" />}
      {view.devs.map((m, i) => <mesh key={i} geometry={view.shape === 'board' ? boardGeometry(0.6) : elShapeGeometry(view.shape)} material={GHOST} matrix={m} matrixAutoUpdate={false} raycast={() => {}} renderOrder={7} name="ELECTRICAL_GHOST" />)}
    </group>
  );
}
const EL_MODULES = (t: ElPoint['type']) => ({ 'socket-2': 2, 'socket-3': 3 } as Partial<Record<ElPoint['type'], number>>)[t] ?? 1;

export function ElectricalLayer({ mode }: { mode: SceneMode }) {
  const docPlan = useDesign((s) => docOf(s).electrical), varPlan = useDesign((s) => extrasOf(variantOf(s)).electrical);
  const plan = useMemo(() => resolvePlan(docPlan, varPlan), [docPlan, varPlan]);
  const section = useUi((s) => s.section), layers = useUi((s) => s.elLayers), compare = useUi((s) => !!s.compare), flat = useUi((s) => s.elView === '2d');
  const sel = useUi((s) => (s.selection?.kind === 'electrical' ? s.selection.id : null));
  // a moved device (or one whose height is changing) draws a preview — its regular instance is hidden for the session
  const moving = usePlace((s) => (s && (s.mode === 'move' || s.mode === 'height') ? s.id : null));
  elPerf.layer++;
  // devices are part of the building — visible in every section; selecting, moving and adding only in ELECTRICAL mode (3D / walk)
  const show = !compare, on = show && section === 'electrical' && !flat;
  const walking = mode.kind === 'walk' || (mode.kind === 'room' && mode.roomView === 'walk');
  const list = useMemo(() => (show ? plan.points.filter((p) => {
    if (!layers[layerOf(p.type)]) return false;
    const r = elRoom(p.roomId);
    if (!r) return false;
    if (walking) return true;                                  // at eye level: all points (also behind doors and on the facade)
    if (r.exterior) return mode.kind === 'exterior' || (on && mode.level === r.level);
    // ELECTRICAL mode: the whole level even when focused on a room (dragging into an adjacent room)
    if (mode.kind === 'room') return on ? r.level === mode.level : p.roomId === mode.roomId;
    return mode.kind === 'level' && r.level === mode.level;
  }) : []), [show, on, plan, layers, mode.kind, mode.roomId, mode.level, walking]);
  const built = useMemo(() => {
    elPerf.batches++;
    const byShape = new Map<ElShape, THREE.Matrix4[]>(), ids: string[] = [], boards: { id: string; m: THREE.Matrix4; w: number }[] = [];
    let selM: THREE.Matrix4 | null = null, handle: THREE.Matrix4 | null = null;
    for (const p of list) {
      ids.push(p.id);
      if (p.id === moving) continue;
      const i = instancesOf(p);
      if (!i) continue;
      if (i.shape === 'board') boards.push({ id: p.id, m: i.mats[0], w: p.width ?? 0.6 });
      else { const a = byShape.get(i.shape) ?? []; a.push(...i.mats); byShape.set(i.shape, a); }
      if (on && p.id === sel) { selM = i.sel; if (p.orientation === 'wall') handle = i.base.clone().multiply(B.makeTranslation(0, HANDLE_UP, 0.012)); }
    }
    return { byShape: [...byShape.entries()], ids, boards, selM, handle };
  }, [list, sel, on, moving]);
  useEffect(() => { elScene.shown = on ? built.ids : []; return () => { elScene.shown = []; }; }, [built, on]);
  useEffect(() => { wake(); }, [built]);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__homeElectrical = () => ({ on, show, shown: built.ids, instances: built.ids.length, shapes: Object.fromEntries(built.byShape.map(([s, m]) => [s, m.length])), boards: built.boards.length, plan, perf: { ...elPerf },
      at: Object.fromEntries(plan.points.map((p) => { const m = measure(p); return [p.id, m ? { pos: m.pos, normal: m.normal } : null]; })) });
    return () => { delete w.__homeElectrical; };
  }, [on, show, built, plan]);
  if (!show) return null;
  const cutTop = mode.cutZ === null ? null : mode.cutZ;
  return (
    <group name="HOME_ELECTRICAL">
      {built.byShape.map(([shape, mats]) => <Batch key={shape} shape={shape} mats={mats} />)}
      {built.boards.map((b) => <mesh key={b.id} geometry={boardGeometry(b.w)} material={MAT} matrix={b.m} matrixAutoUpdate={false} raycast={() => {}} receiveShadow name={`ELECTRICAL_BOARD_${b.id}`} />)}
      {built.selM && <mesh geometry={UNIT} material={SEL} matrix={built.selM} matrixAutoUpdate={false} raycast={() => {}} name="ELECTRICAL_SELECTED" />}
      {built.handle && <mesh geometry={HANDLE_GEO} material={HANDLE} matrix={built.handle} matrixAutoUpdate={false} raycast={() => {}} renderOrder={8} name="ELECTRICAL_HANDLE" />}
      {on && <PlacePreview cutTop={cutTop} level={walking ? null : mode.level} />}
      <ElSceneInput active={on} />
    </group>
  );
}
export type { Placement };
