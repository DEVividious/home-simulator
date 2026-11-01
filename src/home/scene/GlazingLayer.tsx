// Gable windows of the generated shell (glazings with a polygonal outline): their frame and glazing bars in the colour and
// division the user chose in the variant (model/glazing.ts) — the core leaves these frames out of the shell and its panes stay
// there; while a bar is dragged in the card, the dragged bars. A click on the pane selects the window (its card: colour and
// bars); in the walk a long press, as with doors.
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { glazingFrameMesh, wallFrame } from '@home-sim/core/solid/frames';
import type { ShellWindow } from '@home-sim/core/solid/openings';
import { barsFor, choiceOf, glazingShapes, layoutOf, type GlazingShape } from '../model/glazing';
import { useVariant } from '../store/design';
import { useGlazingDraft } from '../store/glazingDraft';
import { ui, useUi } from '../store/ui';
import { meshGeometry, plainArrays } from '../three/coreMesh';
import { frameMaterial } from '../three/shellMaterials';
import { isNearest, longPressFired, pressStart } from './press';
import { lastWasClick } from './sceneApi';

const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide, name: 'MAT_Glazing_Hit' });

/** the outline of a window as a flat polygon in its pane plane (three.js coordinates) — the hit area */
function hitGeometry(w: ShellWindow): THREE.BufferGeometry {
  const f = wallFrame(w), d = w.depth / 2, pts = (w.outline ?? []).map(([s, t]) => new THREE.Vector3(f.o[0] + f.u[0] * s + f.n[0] * d, f.o[2] + t, -(f.o[1] + f.u[1] * s + f.n[1] * d)));
  const g = new THREE.BufferGeometry().setFromPoints(pts), idx: number[] = [];
  for (let i = 1; i + 1 < pts.length; i++) idx.push(0, i, i + 1);
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

function Glazing({ w, shape, walking }: { w: ShellWindow; shape: GlazingShape; walking: boolean }) {
  const glazing = useVariant().glazing, c = choiceOf(glazing, w.id), selected = useUi((s) => s.selection?.kind === 'window' && shape.ids.includes(s.selection.id));
  const draft = useGlazingDraft(shape.group), key = JSON.stringify([c.bars, c.transom, c.cols, c.rows]);
  const frame = useMemo(() => { const a = plainArrays(glazingFrameMesh(wallFrame(w), barsFor(w, shape, draft ?? layoutOf(shape, c)))); return a ? meshGeometry(a) : null; }, [w, shape, key, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const hit = useMemo(() => hitGeometry(w), [w]);
  useEffect(() => () => { frame?.dispose(); }, [frame]);
  useEffect(() => () => hit.dispose(), [hit]);
  const select = () => ui.set({ selection: { kind: 'window', id: w.id } });
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (!isNearest(e)) return;
    if (longPressFired()) { e.stopPropagation(); return; }
    if (walking || !lastWasClick()) return;
    e.stopPropagation();
    ui.set({ selection: selected ? null : { kind: 'window', id: w.id } });
  };
  return (
    <group name={`GLAZING_${w.id}`} userData={{ window: w.id }}>
      {frame && <mesh name={`GLAZING_FRAME_${w.id}`} geometry={frame} material={frameMaterial(c.color, selected)} castShadow receiveShadow raycast={() => {}} />}
      <mesh name={`GLAZING_HIT_${w.id}`} geometry={hit} material={HIT_MAT} onClick={click}
        onPointerDown={(e) => { if (walking && isNearest(e)) { e.stopPropagation(); pressStart(e.nativeEvent, select); } }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }} />
    </group>
  );
}

/** the gable windows of one level; the parts of a glazing split by a partition are divided over its whole width */
export function GlazingLayer({ glazings, walking }: { glazings: ShellWindow[]; walking: boolean }) {
  const shapes = useMemo(() => glazingShapes(), [glazings]);
  return <>{glazings.map((w) => { const g = shapes.find((x) => x.ids.includes(w.id)); return g ? <Glazing key={w.id} w={w} shape={g} walking={walking} /> : null; })}</>;
}
