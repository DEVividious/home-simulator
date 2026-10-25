// Appearance of electrical points in 3D: a socket looks like a socket (frame, round recess, two holes and an earth pin),
// a switch like a switch (frame + rocker), RJ45 / TV outlets, sensors, camera, distribution board (frame), EV charger,
// ceiling points. Meshes with vertex colours — one mesh per kind, drawn with instancing. Local frame: X — along the wall,
// Y — up, Z — from the wall into the room; back of the plate at Z = 0.
// Typical fitting dimensions (81 × 81 mm frame, 71 mm pitch for multi-gang frames) — appearance only, not a choice of fittings.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ElType } from '../model/electrical';

export type ElShape = 'socket' | 'socket-ext' | 'switch' | 'rj45' | 'tv' | 'bus' | 'keypad' | 'temp' | 'camera' | 'contact' | 'board' | 'ev' | 'power3f' | 'ceil-light' | 'ceil-disc' | 'ceil-sensor' | 'post';
/** pitch of multi-gang frames [m] */
export const GANG = 0.071;
const WHITE = '#f3f3f0', FRAME = '#e6e6e2', DARK = '#1b1c1e', GREY = '#8d9094', METAL = '#b9bcc0';

function tint(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex), count = n.getAttribute('position').count, a = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  n.setAttribute('color', new THREE.BufferAttribute(a, 3)); n.deleteAttribute('uv');
  if (n !== g) g.dispose();
  return n;
}
/** box: centre (x, y), depth range z0…z1 */
const box = (w: number, h: number, z0: number, z1: number, hex: string, x = 0, y = 0) => { const g = new THREE.BoxGeometry(w, h, z1 - z0); g.translate(x, y, (z0 + z1) / 2); return tint(g, hex); };
/** cylinder along Z (perpendicular to the wall) */
const disc = (r: number, z0: number, z1: number, hex: string, x = 0, y = 0, seg = 20) => { const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1).rotateX(Math.PI / 2); g.translate(x, y, (z0 + z1) / 2); return tint(g, hex); };
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  g.computeVertexNormals();
  return g;
}
const plate = (w = 0.081, h = 0.081) => [box(w, h, 0, 0.008, FRAME), box(w - 0.012, h - 0.012, 0.008, 0.011, WHITE)];

function build(shape: ElShape): THREE.BufferGeometry {
  switch (shape) {
    case 'socket': return merged([...plate(),
      disc(0.0215, 0.011, 0.0125, FRAME), disc(0.0185, 0.0125, 0.013, '#d9dad6'),                        // collar and recess bottom
      disc(0.0026, 0.013, 0.0136, DARK, -0.0095, 0, 10), disc(0.0026, 0.013, 0.0136, DARK, 0.0095, 0, 10),   // plug holes
      disc(0.0024, 0.013, 0.021, METAL, 0, 0.0105, 10)]);                                                   // earth pin
    case 'socket-ext': return merged([box(0.086, 0.09, 0, 0.03, '#d7d9db'), box(0.074, 0.074, 0.03, 0.042, '#c3c6c9'),   // surface-mounted housing
      box(0.07, 0.07, 0.042, 0.047, '#aeb2b6'), box(0.074, 0.01, 0.03, 0.05, GREY, 0, 0.037)]);              // hinged flap
    case 'switch': return merged([...plate(), box(0.056, 0.056, 0.011, 0.015, WHITE), box(0.05, 0.002, 0.015, 0.0156, '#c9cac6', 0, 0)]);
    case 'rj45': return merged([...plate(), box(0.05, 0.03, 0.011, 0.014, '#e0e0dc', 0, -0.004),
      box(0.014, 0.012, 0.014, 0.0146, DARK, -0.012, -0.004), box(0.014, 0.012, 0.014, 0.0146, DARK, 0.012, -0.004)]);
    case 'tv': return merged([...plate(), disc(0.0085, 0.011, 0.017, METAL, 0, 0, 14), disc(0.0045, 0.017, 0.0176, DARK, 0, 0, 10)]);
    case 'bus': return merged([...plate(), box(0.05, 0.05, 0.011, 0.014, '#dfe0dc'), disc(0.004, 0.014, 0.0146, '#3b82f6', 0.016, -0.016, 10)]);
    case 'keypad': return merged([box(0.13, 0.17, 0, 0.022, '#e9e9e6'), box(0.1, 0.055, 0.022, 0.0235, '#22262b', 0, 0.045),
      ...[-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => box(0.022, 0.016, 0.022, 0.0245, '#c9cac6', i * 0.03, -0.02 - j * 0.024)))]);
    case 'temp': return merged([box(0.075, 0.075, 0, 0.016, WHITE), box(0.05, 0.004, 0.016, 0.0166, '#c9cac6', 0, -0.022), box(0.05, 0.004, 0.016, 0.0166, '#c9cac6', 0, -0.03), disc(0.011, 0.016, 0.0166, '#d9dad6', 0, 0.01)]);
    case 'camera': return merged([disc(0.035, 0, 0.012, WHITE), box(0.03, 0.03, 0.012, 0.06, GREY), box(0.07, 0.07, 0.06, 0.15, WHITE), disc(0.022, 0.15, 0.156, DARK)]);
    case 'contact': return merged([box(0.02, 0.085, 0, 0.016, WHITE), box(0.014, 0.05, 0, 0.014, WHITE, 0.022, 0)]);
    case 'board': {
      // unit width 1 (scaled to the board width); symbolic height 0.75 m
      const W = 1, H = 0.75;
      return merged([box(W, H, 0, 0.012, '#dcdedf'), box(W - 0.06, H - 0.06, 0.012, 0.02, '#f0f0ee'), box(0.012, 0.05, 0.02, 0.027, GREY, W / 2 - 0.07, 0), box(W - 0.2, 0.004, 0.02, 0.0206, '#c9cac6', 0, H / 2 - 0.09)]);
    }
    case 'ev': return merged([box(0.24, 0.36, 0, 0.11, '#eeeeec'), box(0.2, 0.2, 0.11, 0.114, '#1f2226', 0, 0.05), box(0.12, 0.012, 0.114, 0.116, '#3fb950', 0, 0.12), disc(0.03, 0.11, 0.135, DARK, 0, -0.11)]);
    case 'power3f': return merged([box(0.11, 0.13, 0, 0.05, '#d24a3a'), disc(0.036, 0.05, 0.075, '#c94333'), disc(0.036, 0.075, 0.08, '#8f2a20'), box(0.07, 0.012, 0.05, 0.085, '#b33a2c', 0, 0.04)]);
    // ceiling points: Z points down (the instance matrix rotates the frame)
    case 'ceil-light': return merged([disc(0.05, 0, 0.02, WHITE), disc(0.009, 0.02, 0.07, GREY, 0, 0, 10), disc(0.032, 0.07, 0.085, '#f5f1e4'), disc(0.03, 0.085, 0.12, '#fbf6dd', 0, 0, 16)]);
    case 'ceil-disc': return merged([disc(0.09, 0, 0.03, WHITE, 0, 0, 28), disc(0.006, 0.03, 0.031, '#3b82f6', 0.06, 0, 10)]);
    case 'ceil-sensor': return merged([disc(0.045, 0, 0.012, WHITE), (() => { const g = new THREE.SphereGeometry(0.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2); g.translate(0, 0, 0.012); return tint(g, '#e9e9e6'); })()]);
    case 'post': return merged([box(0.09, 0.09, 0, 1, '#3b3e43'), box(0.1, 0.1, 0.92, 1, '#f5f1e4')]);       // post: Z = up, unit height
  }
}
const cache = new Map<ElShape, THREE.BufferGeometry>();
export function elShapeGeometry(shape: ElShape): THREE.BufferGeometry {
  let g = cache.get(shape);
  if (!g) { g = build(shape); cache.set(shape, g); }
  return g;
}
/** 3D shape for a point type and mounting */
export function shapeOf(type: ElType, orientation: 'wall' | 'ceiling' | 'free'): ElShape {
  if (orientation === 'free') return 'post';
  if (orientation === 'ceiling') return type === 'light' ? 'ceil-light' : type === 'motion' ? 'ceil-sensor' : 'ceil-disc';
  switch (type) {
    case 'socket-1': case 'socket-2': case 'socket-3': return 'socket';
    case 'socket-ext': return 'socket-ext';
    case 'switch': return 'switch';
    case 'rj45': return 'rj45';
    case 'tv': return 'tv';
    case 'board': return 'board';
    case 'ev': return 'ev';
    case 'power3f': return 'power3f';
    case 'keypad': return 'keypad';
    case 'camera': return 'camera';
    case 'contact': return 'contact';
    case 'temp': case 'motion': return 'temp';
    default: return 'bus';
  }
}
/** outline of a point on the wall [width, height] — hit area and selection frame */
export function shapeExtent(shape: ElShape, modules: number, width?: number): [number, number] {
  switch (shape) {
    case 'socket': case 'switch': case 'rj45': case 'tv': case 'bus': return [0.081 + (Math.max(1, modules) - 1) * GANG, 0.081];
    case 'socket-ext': return [0.086, 0.09];
    case 'board': return [width ?? 0.6, 0.75];
    case 'ev': return [0.24, 0.36];
    case 'power3f': return [0.11, 0.13];
    case 'keypad': return [0.13, 0.17];
    case 'camera': return [0.08, 0.08];
    case 'contact': return [0.045, 0.085];
    case 'temp': return [0.075, 0.075];
    case 'ceil-light': case 'ceil-sensor': return [0.11, 0.11];
    case 'ceil-disc': return [0.18, 0.18];
    case 'post': return [0.1, 0.1];
  }
}
/** shapes repeated in a multi-gang frame (one instance per module) */
export const isGanged = (shape: ElShape) => shape === 'socket' || shape === 'switch' || shape === 'bus';

/** height of the board drawn in 3D for its nominal width (proportions of a recessed cabinet; the dimension is NOT from any source) */
export const boardHeight = (width: number) => Math.max(0.8, Math.min(1.4, width * 1.8));
const boards = new Map<string, THREE.BufferGeometry>();
/**
 * Flush-mounted distribution board with a visible interior (no door): frame, dark back, DIN rails with rows of modular devices
 * (breakers, control modules with LEDs), terminal strips and a cable bundle — an illustrative look; the number and kind of
 * devices is an illustration, not a board design. Centre at (0, 0), Z from the wall.
 */
export function boardGeometry(width: number): THREE.BufferGeometry {
  const W = Math.round(width * 100) / 100, H = boardHeight(W), key = `${W}`;
  const hit = boards.get(key);
  if (hit) return hit;
  const p: THREE.BufferGeometry[] = [], fr = 0.035, z0 = 0.004;
  // frame (face flush with the wall + 12 mm), recess back
  p.push(box(W, fr, 0, 0.012, '#e8e8e5', 0, H / 2 - fr / 2), box(W, fr, 0, 0.012, '#e8e8e5', 0, -H / 2 + fr / 2), box(fr, H - 2 * fr, 0, 0.012, '#e8e8e5', -W / 2 + fr / 2, 0), box(fr, H - 2 * fr, 0, 0.012, '#e8e8e5', W / 2 - fr / 2, 0));
  p.push(box(W - 2 * fr, H - 2 * fr, 0, z0, '#26282c'));
  const ix0 = -W / 2 + fr + 0.03, ix1 = W / 2 - fr - 0.03, rows = Math.max(5, Math.round((H - 2 * fr) / 0.14)), rh = (H - 2 * fr) / rows;
  // vertical cable trunking on both sides
  p.push(box(0.02, H - 2 * fr - 0.04, z0, 0.012, '#8a8d91', -W / 2 + fr + 0.012, 0), box(0.02, H - 2 * fr - 0.04, z0, 0.012, '#8a8d91', W / 2 - fr - 0.012, 0));
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let r = 0; r < rows; r++) {
    const y = H / 2 - fr - rh * (r + 0.5);
    if (r >= rows - 1) {
      // bottom: cable bundle (blue arcs) above the cable entry
      for (let k = 0; k < 9; k++) { const x = lerpN(ix0 + 0.03, ix1 - 0.03, k / 8); p.push(box(0.012, rh * 0.8, z0, 0.014 + (k % 3) * 0.004, k % 4 === 0 ? '#9aa0a6' : '#2f6fd6', x, y)); }
      continue;
    }
    p.push(box(ix1 - ix0, 0.012, z0, 0.008, '#b5b8bc', 0, y));                                   // rail
    const kind = r < Math.ceil(rows * 0.4) ? 'mcb' : r < Math.ceil(rows * 0.65) ? 'smart' : r === rows - 2 ? 'term' : 'patch';
    let x = ix0;
    while (x < ix1 - 0.02) {
      const group = kind === 'term' ? 1 : 2 + Math.floor(rnd() * 5), mw = kind === 'smart' ? 0.036 + Math.floor(rnd() * 3) * 0.018 : kind === 'term' ? 0.008 : 0.018;
      for (let i = 0; i < group && x + mw <= ix1; i++, x += mw) {
        const cx = x + mw / 2;
        if (kind === 'mcb') {
          p.push(box(mw - 0.0012, 0.085, z0, 0.034, '#eceeed', cx, y));
          p.push(box(mw * 0.5, 0.016, 0.034, 0.04, rnd() < 0.2 ? '#c0392b' : '#2b2d31', cx, y + 0.004));                     // toggle
        } else if (kind === 'smart') {
          p.push(box(mw - 0.002, 0.09, z0, 0.036, rnd() < 0.25 ? '#6fbf4a' : '#2a2c30', cx, y));
          p.push(box(mw * 0.6, 0.006, 0.036, 0.0375, rnd() < 0.5 ? '#3fb950' : '#d24a3a', cx, y + 0.028));                   // LEDs / connectors
        } else if (kind === 'patch') {
          p.push(box(mw - 0.0015, 0.045, z0, 0.026, '#e3e4e2', cx, y)); p.push(box(mw * 0.6, 0.012, 0.026, 0.0272, '#1b1c1e', cx, y - 0.004));
        } else p.push(box(mw - 0.001, 0.05, z0, 0.03, ['#8d9094', '#8d9094', '#3f7fd0', '#c9b037', '#c0392b'][Math.floor(rnd() * 5)], cx, y));
      }
      x += kind === 'term' ? 0 : 0.012 + rnd() * 0.03;
    }
  }
  const g = merged(p);
  boards.set(key, g);
  return g;
}
const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;
