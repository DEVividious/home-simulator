// Exit signs in the walk (usability issue B8): over every exterior door and floor-level glazed door of the level at ground a
// green sign ("Exit") just inside the opening, and a green arrow on the floor pointing out — so the way out, and which glazing
// opens, can be seen from inside. A click or tap on either walks out through it (actions.ts walkOutside: the door opens first).
// Shown only while walking; the signs are hidden by walls like any object.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { t } from '../../i18n';
import { walkOutside } from '../actions';
import { exits, type Exit } from '../model/exits';
import { isNearest } from './press';
import { lastWasClick } from './sceneApi';

const GREEN = '#15803d';
/** the sign above the opening [m]: size, how far inside the inner face of the wall, gap over the head (under a low ceiling: lower) */
export const EXIT_SIGN = { w: 0.6, h: 0.22, inside: 0.1, over: 0.2 };
/** the floor arrow: from this far inside the opening to this near it [m] */
const ARROW = { from: 1.0, to: 0.2, width: 0.42 };

/** the sign texture: a green plate with a door-and-arrow pictogram and the word for "exit" in the UI language */
function signTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 140;
  const g = c.getContext('2d')!;
  g.fillStyle = GREEN; g.beginPath(); g.roundRect(4, 4, 376, 132, 18); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeRect(30, 26, 52, 88);                                                     // the door
  g.beginPath(); g.moveTo(70, 70); g.lineTo(122, 70); g.moveTo(104, 52); g.lineTo(122, 70); g.lineTo(104, 88); g.stroke();   // the arrow out
  g.fillStyle = '#ffffff'; g.font = '600 62px system-ui, sans-serif'; g.textBaseline = 'middle';
  g.fillText(label, 142, 74, 226);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/** the floor arrow as a flat shape along +x (shaft and head), length L */
function arrowGeometry(L: number, W: number): THREE.ShapeGeometry {
  const s = new THREE.Shape(), b = W * 0.22, h = Math.min(L * 0.45, W * 0.75);
  s.moveTo(0, -b); s.lineTo(L - h, -b); s.lineTo(L - h, -W / 2); s.lineTo(L, 0); s.lineTo(L - h, W / 2); s.lineTo(L - h, b); s.lineTo(0, b); s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** where a sign stands (LCS x, y, z of its centre) — also for the tests' screen probes */
export function signPosition(e: Exit): [number, number, number] {
  return [e.at[0] - e.out[0] * EXIT_SIGN.inside, e.at[1] - e.out[1] * EXIT_SIGN.inside, e.floorZ + e.head + EXIT_SIGN.over];
}
/** the middle of the floor arrow (LCS) */
export const arrowPosition = (e: Exit): [number, number, number] => { const d = (ARROW.from + ARROW.to) / 2; return [e.at[0] - e.out[0] * d, e.at[1] - e.out[1] * d, e.floorZ + 0.012]; };

export function ExitSigns({ walking }: { walking: boolean }) {
  const list = walking ? exits() : [];
  const label = t('walk.exit');
  const tex = useMemo(() => (list.length ? signTexture(label) : null), [list.length, label]);
  const arrow = useMemo(() => arrowGeometry(ARROW.from - ARROW.to, ARROW.width), []);
  const mats = useMemo(() => ({
    sign: tex ? new THREE.SpriteMaterial({ map: tex, transparent: true, name: 'MAT_Exit_Sign' }) : null,
    arrow: new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, name: 'MAT_Exit_Arrow' }),
  }), [tex]);
  useEffect(() => () => { tex?.dispose(); mats.sign?.dispose(); mats.arrow.dispose(); }, [tex, mats]);
  useEffect(() => () => arrow.dispose(), [arrow]);
  if (!list.length || !mats.sign) return null;
  const go = (id: string) => (e: { object: unknown; intersections: { object: unknown }[]; stopPropagation: () => void }) => {
    if (!isNearest(e) || !lastWasClick()) return;
    e.stopPropagation();
    walkOutside(id);
  };
  return (
    <group name="HOME_EXITS">
      {list.map((e) => {
        const [sx, sy, sz] = signPosition(e), start = ARROW.from, yaw = Math.atan2(e.out[1], e.out[0]);
        return (
          <group key={e.id} name={`HOME_EXIT_${e.id}`} userData={{ exit: e.id, kind: e.kind }}>
            <sprite position={[sx, sz, -sy]} scale={[EXIT_SIGN.w, EXIT_SIGN.h, 1]} material={mats.sign!} onClick={go(e.id)} name="HOME_EXIT_SIGN" />
            {/* the arrow: shape along +x in its plane → turned to the way out, laid on the floor (three: x, height, −y) */}
            <mesh geometry={arrow} material={mats.arrow} name="HOME_EXIT_ARROW" onClick={go(e.id)} renderOrder={1}
              position={[e.at[0] - e.out[0] * start, e.floorZ + 0.012, -(e.at[1] - e.out[1] * start)]} rotation={[-Math.PI / 2, 0, yaw]} />
          </group>
        );
      })}
    </group>
  );
}
