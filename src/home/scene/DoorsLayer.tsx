// Interior doors in the scene: frame (always kept) + leaf with handle.
// A swing leaf rotates about the HINGE AXIS (matrix from the hinge point and leaf direction — not about its centre), a sliding
// leaf moves along the wall, the panels of a sectional door run up their tracks and back under the ceiling. Animation: a short transition to the state from the doors store; frames are woken only while the
// leaf moves (on-demand rendering — wake()), no continuous rendering. Click / tap: in walk mode — open / close, in other views
// — selection (door card). "Show doors" off: leaves hidden, frames kept.
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { frameGeometry, partCount, partGeometries, partMatrix } from '../three/doorGeometry';
import { toggleDoorInWalk } from '../actions';
import { animSeconds, doorLeaves, interactiveDoors, openOf, swingArcs, type DoorDef } from '../model/doors';
import { doors, useDoors } from '../store/doors';
import { ui, useUi } from '../store/ui';
import { doorMotion } from './doorRuntime';
import { wake } from './renderLoop';
import { isNearest, longPressFired, pressStart } from './press';
import { lastWasClick } from './sceneApi';
import type { SceneMode } from './sceneMode';

// leaf with handle = one mesh (vertex colours: light leaf, dark handle) → one draw call per door
const LEAF_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, vertexColors: true, name: 'MAT_Door_Leaf' });
const LEAF_SEL = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, vertexColors: true, emissive: '#2f6fed', emissiveIntensity: 0.35, name: 'MAT_Door_Leaf_Selected' });
const FRAME_MAT = new THREE.MeshStandardMaterial({ color: '#e4e1d9', roughness: 0.6, name: 'MAT_Door_Frame' });
const FLUSH_FRAME_MAT = new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.55, name: 'MAT_Door_Frame_Flush' });
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false, name: 'MAT_Door_Hit' });
const ARC_MAT = new THREE.LineBasicMaterial({ color: '#2f6fed', transparent: true, opacity: 0.8, name: 'MAT_Door_Arc' });

function Door({ d, selected, walking, top }: { d: DoorDef; selected: boolean; walking: boolean; top: boolean }) {
  const show = useDoors((s) => s.show);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const cur = useRef(openOf(doors.get(), d.id));
  const n = partCount(d), geo = useMemo(() => Array.from({ length: n }, (_, i) => partGeometries(d, i)), [d, n]);
  // swing arcs (top view — as in an architectural plan): path of each leaf edge + the hinge
  const arcs = useMemo(() => swingArcs(d, 24).map((path, i) => {
    const pts = path.map((p) => new THREE.Vector3(p[0], d.floorZ + 0.02, -p[1]));
    const h = d.hinge ? doorLeaves(d, 0)[i].a : null;
    if (h) pts.push(new THREE.Vector3(h[0], d.floorZ + 0.02, -h[1]));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ARC_MAT);
    l.raycast = () => {}; l.renderOrder = 5; l.name = `DOOR_ARC_${d.id}${i ? `_${i}` : ''}`;
    return l;
  }), [d]);
  useEffect(() => () => { for (const g of geo) { g.leaf.dispose(); g.hit.dispose(); } for (const a of arcs) a.geometry.dispose(); }, [geo, arcs]);
  /** every leaf (panel) to the opening amount t (eased) */
  const place = (t: number) => groups.current.forEach((g, i) => { if (g) { partMatrix(d, ease(t), g.matrix, i); g.matrixWorldNeedsUpdate = true; } });
  const anim = animSeconds(d.id);
  // door state change → frames for the duration of the animation (the scene renders on demand)
  useEffect(() => doors.subscribe(() => { if (Math.abs(openOf(doors.get(), d.id) - cur.current) > 1e-4) wake(anim * 1000 + 150); }), [d, anim]);
  useEffect(() => { doorMotion.angle[d.id] = cur.current; place(cur.current); }, [d]);
  useFrame((_, dt) => {
    const target = openOf(doors.get(), d.id);
    if (!groups.current.length || cur.current === target) return;
    const step = Math.min(dt, 0.1) / anim, diff = target - cur.current;
    cur.current = Math.abs(diff) <= step ? target : cur.current + Math.sign(diff) * step;
    place(cur.current);
    doorMotion.angle[d.id] = cur.current;
    if (cur.current !== target) wake(120);
  });
  const select = () => ui.set({ selection: { kind: 'door', id: d.id } });
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!isNearest(e)) return;
    // after a long press (card) the click is ignored — and does not reach the walls behind the door (which would deselect)
    if (longPressFired()) { e.stopPropagation(); return; }
    if (!lastWasClick()) return;
    e.stopPropagation();
    if (walking) toggleDoorInWalk(d.id);
    else { const s = ui.get().selection; ui.set({ selection: s?.kind === 'door' && s.id === d.id ? null : { kind: 'door', id: d.id } }); }
  };
  return (
    <group name={`DOOR_${d.id}`} userData={{ door: d.id }}>
      {geo.map((g, i) => (
        <group key={i} ref={(el) => { groups.current[i] = el; }} matrixAutoUpdate={false} visible={show} name={`DOOR_LEAF_${d.id}${i ? `_${i}` : ''}`}>
          <mesh geometry={g.leaf} material={selected ? LEAF_SEL : LEAF_MAT} castShadow receiveShadow raycast={() => {}} />
          {show && <mesh geometry={g.hit} material={HIT_MAT} onClick={click} name={`DOOR_HIT_${d.id}${i ? `_${i}` : ''}`}
            onPointerDown={(e) => { if (walking && isNearest(e)) { e.stopPropagation(); pressStart(e.nativeEvent, select); } }}
            onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }} />}
        </group>
      ))}
      {top && show && arcs.map((a, i) => <primitive key={i} object={a} />)}
    </group>
  );
}

/** smooth start and stop of the leaf (smoothstep over the opening amount) */
const ease = (t: number) => t * t * (3 - 2 * t);

/** doors in the scene: exterior view — only the doors to the outside (an entrance, a garage door; the interior ones are
 *  invisible from outside, needless draw calls); section / room — doors of the current level; building walk — all */
export function DoorsLayer({ mode }: { mode: SceneMode }) {
  const sel = useUi((s) => (s.selection?.kind === 'door' ? s.selection.id : null));
  const walking = mode.kind === 'walk' || (mode.kind === 'room' && mode.roomView === 'walk');
  const top = mode.kind === 'room' && mode.roomView === 'top';
  const list = useMemo(() => (mode.kind === 'exterior' ? interactiveDoors().filter((d) => d.rooms.includes('exterior')) : interactiveDoors().filter((d) => mode.kind === 'walk' || d.level === mode.level)), [mode.kind, mode.level]);
  const frames = useMemo(() => {
    const merge = (ds: typeof list) => { const parts = ds.map(frameGeometry).filter((g): g is THREE.BufferGeometry => !!g); const g = parts.length ? mergeGeometries(parts) : null; parts.forEach((p) => p.dispose()); return g; };
    // flush doors: frame hidden in the wall face, in the leaf colour (separate mesh)
    return { std: merge(list.filter((d) => !d.flush)), flush: merge(list.filter((d) => d.flush)) };
  }, [list]);
  useEffect(() => () => { frames.std?.dispose(); frames.flush?.dispose(); }, [frames]);
  return (
    <group name="HOME_DOORS">
      {frames.std && <mesh geometry={frames.std} material={FRAME_MAT} castShadow receiveShadow raycast={() => {}} name="DOOR_FRAMES" />}
      {frames.flush && <mesh geometry={frames.flush} material={FLUSH_FRAME_MAT} receiveShadow raycast={() => {}} name="DOOR_FRAMES_FLUSH" />}
      {list.map((d) => <Door key={d.id} d={d} selected={sel === d.id} walking={walking} top={top} />)}
    </group>
  );
}
