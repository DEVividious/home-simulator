// Scene labels as plain DOM elements above the canvas (no drei <Html> — fewer React nodes in the scene, no unmount issues):
// a DOM layer renders the label list and a component in the scene sets their screen positions every frame.
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../model/types';
import { createStore, useStore } from '../store/createStore';
import { sceneApi } from './sceneApi';

export interface SceneLabel { id: string; pos: Vec3; text: ReactNode; kind: 'room' | 'dim' | 'tag'; onClick?: () => void; active?: boolean; testid?: string }

export const labelStore = createStore<{ labels: SceneLabel[] }>({ labels: [] });
const nodes = new Map<string, HTMLDivElement>();

/** sets the labels of a group (e.g. the rooms of a level, the dimensions of the selected furniture) */
const groups = new Map<string, SceneLabel[]>();
export function setLabels(group: string, list: SceneLabel[]) {
  groups.set(group, list);
  labelStore.set({ labels: [...groups.values()].flat() });
}

/** DOM layer (above the canvas) */
export function LabelLayer() {
  const labels = useStore(labelStore, (s) => s.labels);
  return (
    <div className="hm-labels" aria-hidden={false}>
      {labels.map((l) => (
        <div key={l.id} ref={(e) => { if (e) nodes.set(l.id, e); else nodes.delete(l.id); }}
          className={`hm-lbl hm-lbl-${l.kind}${l.active ? ' on' : ''}${l.onClick ? ' click' : ''}`} style={{ visibility: 'hidden' }}
          onClick={l.onClick} data-testid={l.testid}>{l.text}</div>
      ))}
    </div>
  );
}

/** E2E test: the largest offset [px] of a label centre from the projection of its point with the current camera */
export function labelError(): number {
  const cam = sceneApi.camera, dom = sceneApi.dom;
  if (!cam || !dom) return 0;
  cam.updateMatrixWorld();
  const r = dom.getBoundingClientRect(), p = new THREE.Vector3();
  let worst = 0;
  for (const l of labelStore.get().labels) {
    const n = nodes.get(l.id);
    if (!n || n.style.visibility !== 'visible') continue;
    p.set(l.pos[0], l.pos[2], -l.pos[1]).project(cam);
    const b = n.getBoundingClientRect();
    worst = Math.max(worst, Math.hypot(b.left + b.width / 2 - (r.left + ((p.x + 1) / 2) * r.width), b.top + b.height / 2 - (r.top + ((1 - p.y) / 2) * r.height)));
  }
  return worst;
}

const v = new THREE.Vector3();
/** label size (read once — no forced page layout in every frame) */
const sizes = new WeakMap<HTMLDivElement, [number, number, string]>();
const last = new WeakMap<HTMLDivElement, string>();

/**
 * Label projection (in the scene, every frame). The camera moves in mouse events (OrbitControls) but its matrices are only
 * refreshed by rendering — hence updateMatrixWorld() before projecting: without it labels lag a frame behind the image and
 * "jitter" while rotating. Positions rounded to whole pixels (sharp text, no flicker).
 */
export function LabelProjector() {
  const list = useRef<SceneLabel[]>(labelStore.get().labels);
  useEffect(() => { const off = labelStore.subscribe(() => { list.current = labelStore.get().labels; }); return () => { off(); }; }, []);
  useFrame(({ camera, size }) => {
    const dom = sceneApi.dom;
    if (!dom || !list.current.length) return;
    camera.updateMatrixWorld();
    for (const l of list.current) {
      const n = nodes.get(l.id);
      if (!n) continue;
      v.set(l.pos[0], l.pos[2], -l.pos[1]).project(camera);
      const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      let sz = sizes.get(n);
      if (!sz || sz[2] !== n.textContent) { sz = [n.offsetWidth, n.offsetHeight, n.textContent ?? '']; sizes.set(n, sz); }
      const t = vis ? `translate3d(${Math.round(((v.x + 1) / 2) * size.width - sz[0] / 2)}px, ${Math.round(((1 - v.y) / 2) * size.height - sz[1] / 2)}px, 0)` : 'hidden';
      if (last.get(n) === t) continue;
      last.set(n, t);
      n.style.visibility = vis ? 'visible' : 'hidden';
      if (vis) n.style.transform = t;
    }
  });
  return null;
}
