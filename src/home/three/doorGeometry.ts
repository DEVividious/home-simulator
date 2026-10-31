// Door geometry (three.js, no React): frame, leaf with handle, leaf matrix.
// A hinged leaf rotates about the HINGE AXIS: the origin of the leaf's local frame lies on the hinge, not in the leaf centre.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gapFrame, linePt } from '@home-sim/core/model/wallLine';
import { doorLeaves, LEAF_T, leafCount, leafWidthOf, type DoorDef } from '../model/doors';

const LEAF_COLOR = new THREE.Color('#f2f0ea'), HANDLE_COLOR = new THREE.Color('#33363b');
function tint(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/**
 * Door frame: two jambs in the wall opening on both sides of the leaf and a head above the leaf — within the wall thickness
 * (+1 cm on each side). Flush doors (`d.flush`): concealed frame — it does not protrude from the wall face (set back by 1 mm
 * to avoid z-fighting with the plaster); a separate mesh in the leaf colour draws it, so from the opening side one sees a single
 * wall plane with a gap around the leaf.
 */
export function frameGeometry(d: DoorDef): THREE.BufferGeometry | null {
  const o = d.opening, side = (o.width - d.leafWidth) / 2, top = o.height - d.height;
  if (side < 0.01 && top < 0.01) return null;
  const out = d.flush ? -0.001 : 0.01;
  const lo = Math.min(...o.faces) - out, hi = Math.max(...o.faces) + out, parts: THREE.BufferGeometry[] = [];
  const f = gapFrame(o);
  const box = (a0: number, a1: number, z0: number, z1: number) => {
    // a — along the wall, c — across it (lo…hi); LCS (x, y, z) → three (x, z, −y)
    const ac = (a0 + a1) / 2, cc = (lo + hi) / 2, [x, y] = linePt(f, ac, cc);
    const g = o.along === 'X' ? new THREE.BoxGeometry(a1 - a0, z1 - z0, hi - lo) : o.along === 'Y' ? new THREE.BoxGeometry(hi - lo, z1 - z0, a1 - a0)
      : new THREE.BoxGeometry(a1 - a0, z1 - z0, hi - lo).rotateY(Math.atan2(f.dir[1], f.dir[0]));   // a slanted wall: the box turned to it
    g.translate(x, d.floorZ + (z0 + z1) / 2, -y);
    parts.push(g);
  };
  if (side >= 0.01) { box(o.from, o.from + side, 0, o.height); box(o.to - side, o.to, 0, o.height); }
  if (top >= 0.01) box(o.from + side, o.to - side, d.height, o.height);
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

/** whether leaf i carries the handle: every leaf of a single or double door; of a bifold only the second panel (its free edge) */
const hasHandle = (d: DoorDef, i: number) => d.type !== 'folding' || i === leafCount(d) - 1;
/** leaf i in its local frame: x — from the hinge to the lock (0…width), y — up, z — thickness; handles on both sides */
export function leafGeometries(d: DoorDef, i = 0) {
  const w = leafWidthOf(d) - 0.006, h = d.height - 0.012;
  const body = tint(new THREE.BoxGeometry(w, h, LEAF_T), LEAF_COLOR); body.translate(w / 2 + 0.003, h / 2 + 0.008, 0);
  const parts: THREE.BufferGeometry[] = [body];
  // flush doors: on the opening side (face in the wall plane) only a flat pull, the handle stays on the other side.
  // Leaf z axis = closedDir × vertical → in plan (dy, −dx); the opening side is the one openDir points to
  const swing = d.closedDir && d.openDir ? Math.sign(d.closedDir[1] * d.openDir[0] - d.closedDir[0] * d.openDir[1]) || -1 : -1;
  if (hasHandle(d, i)) for (const s of [-1, 1]) {
    if (d.flush && s === swing) { const pull = tint(new THREE.BoxGeometry(0.02, 0.16, 0.006), HANDLE_COLOR); pull.translate(w - 0.05, 1.05, s * (LEAF_T / 2 + 0.003)); parts.push(pull); continue; }
    const stem = tint(new THREE.BoxGeometry(0.02, 0.02, 0.05), HANDLE_COLOR); stem.translate(w - 0.07, 1.05, s * (LEAF_T / 2 + 0.025));
    const grip = tint(new THREE.BoxGeometry(0.12, 0.018, 0.018), HANDLE_COLOR); grip.translate(w - 0.12, 1.05, s * (LEAF_T / 2 + 0.05));
    parts.push(stem, grip);
  }
  const leaf = mergeGeometries(parts); parts.forEach((g) => g.dispose());
  // hit area larger than the leaf (touch, grazing view angles)
  const hit = new THREE.BoxGeometry(w, h, 0.22); hit.translate(w / 2, h / 2, 0);
  return { leaf, hit };
}

const _x = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(), _p = new THREE.Vector3();
/** matrix of leaf i at opening t: origin on its hinge axis (hinged; a bifold's second panel: on the fold) / at the start of the
 *  leaf (sliding) */
export function leafMatrix(d: DoorDef, t: number, out = new THREE.Matrix4(), i = 0): THREE.Matrix4 {
  const s = doorLeaves(d, t)[i];
  _x.set(s.dir[0], 0, -s.dir[1]);
  _z.crossVectors(_x, _y);
  // hinged: the closed leaf face is flush with the wall face on the opening side (leaf axis set back by half the thickness into the opening)
  const k = d.hinge && d.openDir ? LEAF_T / 2 : 0, ox = d.openDir ? d.openDir[0] : 0, oy = d.openDir ? d.openDir[1] : 0;
  _p.set(s.a[0] - ox * k, d.floorZ, -(s.a[1] - oy * k));
  return out.makeBasis(_x, _y, _z).setPosition(_p);
}

