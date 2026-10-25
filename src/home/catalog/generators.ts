// Parametric furniture generators: a list of simple solids (parts) in item coordinates — x width, y depth (front +),
// z up; outline centre at (0, 0), bottom at z = 0. Pure TS: the same parts build the three.js mesh (src/home/three/
// furnitureGeometry.ts) and the SVG thumbnail (thumbnails.ts). Dimensions in metres; items fit exactly into w × d × h.
import type { Dims } from '../model/types';

export type Shape = 'box' | 'cyl' | 'sphere' | 'prism' | 'wheel' | 'loft';

/** cross-section of a "loft" solid at position y: bottom z0, top z1, half width at the bottom wb and at the top wt, rounding exponent p (2 — ellipse, larger — rectangle) */
export interface LoftStation { y: number; z0: number; z1: number; wb: number; wt: number; p?: number }

export interface Part {
  shape: Shape;
  slot: string; // part → material (catalog.materialSlots)
  c: [number, number, number]; // centre
  s: [number, number, number]; // size (cyl / sphere: diameter × diameter × height; wheel: width × diameter × diameter)
  rotZ?: number; // rotation about the z axis [°] (office chair base legs)
  /** prism: outline in the (y, z) plane — side section, extruded along x to width s[0] around c[0] */
  profile?: [number, number][];
  /** loft: successive cross-sections along y (smooth solid — car body); section centre at x = c[0] */
  stations?: LoftStation[];
  /** moving part (door leaf in built-in units): drawn separately and rotated about the partMotion() axis */
  move?: boolean;
}

/** "loft" cross-section points (superellipse narrowing upwards), n points, counter-clockwise in (x, z) */
export function loftRing(st: LoftStation, n = 28, cx = 0): [number, number][] {
  const p = st.p ?? 4, zc = (st.z0 + st.z1) / 2, hz = (st.z1 - st.z0) / 2, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, c = Math.cos(t), s2 = Math.sin(t);
    const u = Math.sign(c) * Math.abs(c) ** (2 / p), v = Math.sign(s2) * Math.abs(s2) ** (2 / p);
    const half = st.wb + (st.wt - st.wb) * ((v + 1) / 2);
    out.push([cx + u * half, zc + v * hz]);
  }
  return out;
}

type Gen = (d: Dims, o: Record<string, unknown>) => Part[];

const box = (slot: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rotZ?: number): Part =>
  ({ shape: 'box', slot, c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], s: [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)], ...(rotZ ? { rotZ } : {}) });
const cyl = (slot: string, x: number, y: number, z0: number, z1: number, dia: number): Part => ({ shape: 'cyl', slot, c: [x, y, (z0 + z1) / 2], s: [dia, dia, z1 - z0] });
const sph = (slot: string, x: number, y: number, z: number, dx: number, dy: number, dz: number): Part => ({ shape: 'sphere', slot, c: [x, y, z], s: [dx, dy, dz] });

/** solid from a side section (y, z) extruded along x (car body, hood) */
const prism = (slot: string, x0: number, x1: number, profile: [number, number][]): Part => {
  const ys = profile.map((p) => p[0]), zs = profile.map((p) => p[1]);
  return { shape: 'prism', slot, c: [(x0 + x1) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], s: [x1 - x0, Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)], profile };
};
/** smooth solid from cross-sections (car body) */
const loft = (slot: string, stations: LoftStation[], cx = 0): Part => {
  const ys = stations.map((q) => q.y), zs = stations.flatMap((q) => [q.z0, q.z1]), hw = Math.max(...stations.map((q) => Math.max(q.wb, q.wt)));
  return { shape: 'loft', slot, c: [cx, (Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], s: [2 * hw, Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)], stations };
};

/** wheel / disc with its axis along x (rotZ 90 — axis along y: washing machine door) */
const wheel = (slot: string, x: number, y: number, z: number, width: number, dia: number, rotZ?: number): Part => ({ shape: 'wheel', slot, c: [x, y, z], s: [width, dia, dia], ...(rotZ ? { rotZ } : {}) });

/** legs in the corners (square / round) */
function legs(slot: string, w: number, d: number, z1: number, t = 0.04, inset = 0.04, round = false): Part[] {
  const xs = [-w / 2 + inset + t / 2, w / 2 - inset - t / 2], ys = [-d / 2 + inset + t / 2, d / 2 - inset - t / 2];
  return xs.flatMap((x) => ys.map((y) => (round ? cyl(slot, x, y, 0, z1, t) : box(slot, x - t / 2, y - t / 2, 0, x + t / 2, y + t / 2, z1))));
}

const sofa: Gen = ({ w, d, h }, o) => {
  const seats = Number(o.seats ?? Math.max(1, Math.round((w - 0.4) / 0.6)));
  const arm = Math.min(0.2, w * 0.14), legH = 0.08, baseTop = 0.3, seatTop = 0.44, back = 0.2;
  const p: Part[] = [...legs('legs', w, d, legH, 0.05, 0.05)];
  p.push(box('main', -w / 2, -d / 2, legH, w / 2, d / 2, baseTop)); // base
  p.push(box('main', -w / 2, -d / 2, baseTop, w / 2, -d / 2 + back, h)); // backrest
  p.push(box('main', -w / 2, -d / 2 + back, baseTop, -w / 2 + arm, d / 2, Math.min(h, 0.62))); // armrests
  p.push(box('main', w / 2 - arm, -d / 2 + back, baseTop, w / 2, d / 2, Math.min(h, 0.62)));
  const inner = w - 2 * arm, cw = inner / seats;
  for (let i = 0; i < seats; i++) {
    const x0 = -w / 2 + arm + i * cw;
    p.push(box('main', x0 + 0.005, -d / 2 + back, baseTop, x0 + cw - 0.005, d / 2 - 0.02, seatTop)); // seat cushions
    p.push(box('main', x0 + 0.01, -d / 2 + back, seatTop, x0 + cw - 0.01, -d / 2 + back + 0.14, Math.min(h - 0.02, seatTop + 0.36))); // back cushions
  }
  return p;
};

const table: Gen = ({ w, d, h }, o) => {
  const t = Number(o.top ?? 0.04);
  if (o.round) return [cyl('main', 0, 0, h - t, h, Math.min(w, d)), cyl('legs', 0, 0, 0.02, h - t, 0.08), cyl('legs', 0, 0, 0, 0.02, Math.min(w, d) * 0.55)];
  return [box('main', -w / 2, -d / 2, h - t, w / 2, d / 2, h), ...legs('legs', w, d, h - t, 0.05, 0.06)];
};

const chair: Gen = ({ w, d, h }) => {
  const seat = 0.46, t = 0.035;
  return [
    ...legs('main', w, d, seat - 0.04, 0.035, 0.02),
    box('seat', -w / 2, -d / 2, seat - 0.05, w / 2, d / 2, seat),
    box('main', -w / 2, -d / 2, seat, -w / 2 + t, -d / 2 + t, h), box('main', w / 2 - t, -d / 2, seat, w / 2, -d / 2 + t, h),
    box('seat', -w / 2 + t, -d / 2, h - 0.22, w / 2 - t, -d / 2 + t, h - 0.02),
  ];
};

const bed: Gen = ({ w, d, h }, o) => {
  const mw = Math.min(w - 0.08, Number(o.mattress ?? w - 0.1)), ml = 2.0, frameTop = 0.3, matTop = 0.52, head = 0.08;
  const y0 = -d / 2 + head, mx = mw / 2;
  const p: Part[] = [...legs('legs', w, d, 0.08, 0.05, 0.03)];
  p.push(box('main', -w / 2, -d / 2 + head, 0.08, w / 2, d / 2, frameTop)); // frame
  p.push(box('main', -w / 2, -d / 2, 0.05, w / 2, -d / 2 + head, h)); // headboard
  p.push(box('mattress', -mx, y0 + 0.01, frameTop, mx, Math.min(d / 2 - 0.01, y0 + ml), matTop - 0.04));
  p.push(box('bedding', -mx - 0.02, y0 + 0.55, matTop - 0.05, mx + 0.02, Math.min(d / 2, y0 + ml + 0.02), matTop)); // duvet
  const pillows = mw >= 1.2 ? 2 : 1, pw = (mw - 0.1) / pillows;
  for (let i = 0; i < pillows; i++) { const x0 = -mx + 0.05 + i * pw; p.push(box('bedding', x0 + 0.02, y0 + 0.08, matTop - 0.04, x0 + pw - 0.02, y0 + 0.48, matTop + 0.1)); }
  return p;
};

/** carcass with fronts: drawers / doors, plinth or legs, handles */
const cabinet: Gen = ({ w, d, h }, o) => {
  // front faces 2 cm behind the outline (handles end exactly at depth d)
  const legH = o.legs ? 0.1 : 0, plinth = o.plinth ? 0.08 : 0, z0 = Math.max(legH, plinth), ft = 0.018, hd = 0.02;
  const fy = d / 2 - hd;
  const p: Part[] = [];
  if (o.legs) p.push(...legs('legs', w, d - 2 * hd, legH, 0.035, 0.04, true).map((q) => ({ ...q, c: [q.c[0], q.c[1] - hd, q.c[2]] as [number, number, number] })));
  if (o.plinth) p.push(box('accent', -w / 2 + 0.03, -d / 2 + 0.02, 0, w / 2 - 0.03, fy - 0.04, plinth));
  p.push(box('main', -w / 2, -d / 2, z0, w / 2, fy - ft, h));
  const drawers = Number(o.drawers ?? 0);
  const doors = o.doorsAuto ? Math.max(1, Math.round(w / 0.5)) : Number(o.doors ?? (drawers ? 0 : 2));
  const fh = h - z0, gap = 0.004;
  if (drawers) {
    for (let i = 0; i < drawers; i++) {
      const a = z0 + (i * fh) / drawers, b = z0 + ((i + 1) * fh) / drawers;
      p.push(box('accent', -w / 2 + gap, fy - ft, a + gap, w / 2 - gap, fy, b - gap));
      p.push(box('metal', -0.08, fy, (a + b) / 2 - 0.008, 0.08, d / 2, (a + b) / 2 + 0.008));
    }
  } else if (o.sliding) {
    p.push(box('accent', -w / 2 + gap, fy - ft, z0 + gap, gap / 2, fy, h - gap));
    p.push(box('accent', -gap / 2, fy - ft - 0.025, z0 + gap, w / 2 - gap, fy - 0.025, h - gap));
    p.push(box('metal', -0.06, fy, z0 + fh * 0.4, -0.04, d / 2, z0 + fh * 0.6), box('metal', 0.04, fy - 0.025, z0 + fh * 0.4, 0.06, fy, z0 + fh * 0.6));
  } else {
    const dw = w / doors;
    for (let i = 0; i < doors; i++) {
      const a = -w / 2 + i * dw, b = a + dw;
      p.push(box('accent', a + gap, fy - ft, z0 + gap, b - gap, fy, h - gap));
      const hx = i % 2 === 0 ? b - 0.05 : a + 0.05, hz = Math.min(z0 + fh * 0.55, z0 + 1.1);
      p.push(box('metal', hx - 0.008, fy, hz - Math.min(0.12, fh * 0.2), hx + 0.008, d / 2, hz + Math.min(0.12, fh * 0.2)));
    }
  }
  return p;
};

const desk: Gen = ({ w, d, h }) => {
  const t = 0.03, leg = 0.05;
  return [
    box('main', -w / 2, -d / 2, h - t, w / 2, d / 2, h),
    box('legs', -w / 2 + 0.04, -d / 2 + 0.05, 0, -w / 2 + 0.04 + leg, d / 2 - 0.05, 0.03), box('legs', w / 2 - 0.04 - leg, -d / 2 + 0.05, 0, w / 2 - 0.04, d / 2 - 0.05, 0.03),
    box('legs', -w / 2 + 0.04, -0.03, 0, -w / 2 + 0.04 + leg, 0.03, h - t), box('legs', w / 2 - 0.04 - leg, -0.03, 0, w / 2 - 0.04, 0.03, h - t),
    box('legs', -w / 2 + 0.06, -d / 2 + 0.06, h - t - 0.08, w / 2 - 0.06, -d / 2 + 0.08, h - t),
  ];
};

const officeChair: Gen = ({ w, d, h }) => {
  const seatZ = 0.48, r = Math.min(w, d) / 2;
  const p: Part[] = [];
  for (let i = 0; i < 5; i++) {
    // base leg in direction (−sin a, cos a): a box along y rotated by a
    const a = (i * 72 * Math.PI) / 180, L = r * 0.92;
    p.push({ shape: 'box', slot: 'metal', c: [(-Math.sin(a) * L) / 2, (Math.cos(a) * L) / 2, 0.06], s: [0.04, L, 0.04], rotZ: i * 72 });
    p.push(cyl('metal', -Math.sin(a) * L, Math.cos(a) * L, 0, 0.05, 0.05));
  }
  p.push(cyl('metal', 0, 0, 0.08, seatZ - 0.06, 0.05));
  p.push(box('main', -w * 0.4, -d * 0.36, seatZ - 0.07, w * 0.4, d * 0.4, seatZ));
  p.push(box('main', -w * 0.36, -d / 2, seatZ + 0.08, w * 0.36, -d / 2 + 0.08, h));
  p.push(box('metal', -0.02, -d / 2 + 0.04, seatZ, 0.02, -d * 0.36, seatZ + 0.12));
  p.push(box('metal', -w / 2, -d * 0.1, seatZ + 0.18, -w / 2 + 0.05, d * 0.25, seatZ + 0.22), box('metal', w / 2 - 0.05, -d * 0.1, seatZ + 0.18, w / 2, d * 0.25, seatZ + 0.22));
  return p;
};

const shelves: Gen = ({ w, d, h }, o) => {
  const t = o.open ? 0.035 : 0.022, n = Math.max(2, Math.round(h / 0.38));
  const p: Part[] = [];
  if (o.open) for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) for (const y of [-d / 2 + t / 2, d / 2 - t / 2]) p.push(box('main', x - t / 2, y - t / 2, 0, x + t / 2, y + t / 2, h));
  else { p.push(box('main', -w / 2, -d / 2, 0, -w / 2 + t, d / 2, h), box('main', w / 2 - t, -d / 2, 0, w / 2, d / 2, h), box('accent', -w / 2 + t, -d / 2, 0, w / 2 - t, -d / 2 + 0.008, h)); }
  for (let i = 0; i <= n; i++) {
    const z = Math.min(h - t, 0.04 + (i * (h - 0.04 - t)) / n);
    p.push(box(o.open ? 'accent' : 'main', -w / 2 + (o.open ? 0 : t), -d / 2, z, w / 2 - (o.open ? 0 : t), d / 2, z + t));
  }
  return p;
};

const rug: Gen = ({ w, d, h }, o) => (o.round ? [cyl('main', 0, 0, 0, h, Math.min(w, d))] : [box('main', -w / 2, -d / 2, 0, w / 2, d / 2, h)]);

const lamp: Gen = ({ w, h }) => [
  cyl('metal', 0, 0, 0, 0.025, w * 0.7), cyl('metal', 0, 0, 0.025, h - 0.3, 0.025), cyl('shade', 0, 0, h - 0.34, h, w),
];

const plant: Gen = ({ w, d, h }) => {
  const potH = Math.min(0.4, h * 0.32), pd = Math.min(w, d) * 0.72;
  return [cyl('pot', 0, 0, 0, potH, pd), sph('plant', 0, 0, potH + (h - potH) * 0.55, w * 0.95, d * 0.95, (h - potH) * 0.9), sph('plant', w * 0.12, -d * 0.1, potH + (h - potH) * 0.32, w * 0.6, d * 0.6, (h - potH) * 0.55)];
};

// ================================================================== kitchen, bathroom, living room, garage
const PLINTH = 0.1, FT = 0.019, FG = 0.003;

/** fronts in the band [x0, x1] × [z0, z1] (drawers / doors) with handles; yMax — outline limit: the handle ends at yMax,
 *  the front face HD = 14 mm behind it (without a handle — face at yMax) */
const HD = 0.014;
function fronts(p: Part[], x0: number, x1: number, z0: number, z1: number, yMax: number, kind: { drawers?: number; doors?: number; handle?: 'bar' | 'none' }) {
  const n = kind.drawers ?? kind.doors ?? 1, y = kind.handle === 'none' ? yMax : yMax - HD;
  for (let i = 0; i < n; i++) {
    if (kind.drawers) {
      const a = z0 + ((z1 - z0) * i) / n, b = z0 + ((z1 - z0) * (i + 1)) / n;
      p.push(box('front', x0 + FG, y - FT, a + FG, x1 - FG, y, b - FG));
      if (kind.handle !== 'none') p.push(box('metal', (x0 + x1) / 2 - Math.min(0.12, (x1 - x0) * 0.3), y, b - FG - 0.03, (x0 + x1) / 2 + Math.min(0.12, (x1 - x0) * 0.3), yMax, b - FG - 0.018));
    } else {
      const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n;
      p.push(box('front', a + FG, y - FT, z0 + FG, b - FG, y, z1 - FG));
      if (kind.handle !== 'none') { const hx = i % 2 === 0 && n > 1 ? b - 0.04 : a + 0.04, hz = Math.min(z1 - 0.12, z0 + 1.05); p.push(box('metal', hx - 0.006, y, hz - 0.1, hx + 0.006, yMax, hz + 0.1)); }
    }
  }
}

/** kitchen base unit: plinth, carcass, fronts, worktop; options: sink (with tap — the item height includes the tap,
 *  worktop at height `counter`), hob, dishwasher, drawers, worktop overhang (island) */
const kitchenBase: Gen = ({ w, d, h }, o) => {
  const ch = Number(o.counter ?? h), top = Number(o.top ?? 0.038), over = Number(o.overhang ?? 0), yF = d / 2 - over - 0.02; // front limit (with handles)
  const p: Part[] = [box('plinth', -w / 2 + 0.002, -d / 2, 0, w / 2 - 0.002, yF - 0.07, PLINTH), box('main', -w / 2, -d / 2, PLINTH, w / 2, yF - HD - FT, ch - top)];
  if (o.dishwasher) fronts(p, -w / 2, w / 2, PLINTH, ch - top, yF, { doors: 1, handle: 'none' });
  else fronts(p, -w / 2, w / 2, PLINTH, ch - top, yF, o.drawers ? { drawers: Number(o.drawers) } : { doors: w > 0.7 ? 2 : 1 });
  const lid = o.sink || o.cooktop ? 0.002 : 0;
  p.push(box('top', -w / 2, -d / 2, ch - top, w / 2, d / 2, ch - lid));
  if (o.sink) {
    const sw = Math.min(w - 0.2, 0.55), sd = Math.min(0.42, d - 0.18), cy = -d / 2 + 0.12 + sd / 2;
    p.push(box('metal', -sw / 2, cy - sd / 2, ch - lid, sw / 2, cy + sd / 2, ch));
    p.push(box('sink', -sw / 2 + 0.03, cy - sd / 2 + 0.03, ch - lid, sw / 2 - 0.03, cy + sd / 2 - 0.03, ch + 0.0005));
    p.push(cyl('metal', 0, -d / 2 + 0.06, ch, h, 0.03), box('metal', -0.012, -d / 2 + 0.06, h - 0.03, 0.012, -d / 2 + 0.26, h));
  }
  if (o.cooktop) p.push(box('cooktop', -Math.min(0.29, w / 2 - 0.05), -0.26, ch - lid, Math.min(0.29, w / 2 - 0.05), Math.min(0.26, d / 2 - over - 0.04), ch));
  return p;
};

/** tall unit: plinth, carcass, fronts; options: oven (+ microwave), fridge, pantry */
const kitchenTall: Gen = ({ w, d, h }, o) => {
  const fy = d / 2, ff = fy - HD, p: Part[] = [box('plinth', -w / 2 + 0.002, -d / 2, 0, w / 2 - 0.002, fy - 0.07, PLINTH), box('main', -w / 2, -d / 2, PLINTH, w / 2, ff - FT, h)];
  if (o.oven) {
    fronts(p, -w / 2, w / 2, PLINTH, 0.82, fy, { drawers: 2 });
    p.push(box('appliance', -w / 2 + FG, ff - FT, 0.82, w / 2 - FG, ff, 1.42), box('glass-dark', -w / 2 + 0.06, ff, 0.88, w / 2 - 0.06, ff + 0.004, 1.3), box('metal', -w / 2 + 0.06, ff, 1.34, w / 2 - 0.06, fy, 1.36));
    if (o.microwave) { p.push(box('appliance', -w / 2 + FG, ff - FT, 1.42, w / 2 - FG, ff, 1.8), box('glass-dark', -w / 2 + 0.06, ff, 1.47, w / 2 - 0.16, ff + 0.004, 1.75)); fronts(p, -w / 2, w / 2, 1.8, h, fy, { doors: 1 }); }
    else fronts(p, -w / 2, w / 2, 1.42, h, fy, { doors: 1 });
  } else if (o.fridge) {
    fronts(p, -w / 2, w / 2, PLINTH, 0.92, fy, { doors: 1 });
    fronts(p, -w / 2, w / 2, 0.92, Math.min(h, 1.95), fy, { doors: 1 });
    if (h > 1.97) fronts(p, -w / 2, w / 2, 1.95, h, fy, { doors: 1 });
  } else {
    const split = Math.min(h, 2.0);
    fronts(p, -w / 2, w / 2, PLINTH, split, fy, { doors: w > 0.7 ? 2 : 1 });
    if (h > split + 0.1) fronts(p, -w / 2, w / 2, split, h, fy, { doors: w > 0.7 ? 2 : 1 });
  }
  return p;
};

/** wall cabinet (mounted above the worktop — elevation) */
const kitchenWall: Gen = ({ w, d, h }, o) => {
  const p: Part[] = [box('main', -w / 2, -d / 2, 0, w / 2, d / 2 - (o.open ? FT : HD + FT), h)];
  if (o.open) p.push(box('front', -w / 2 + FT, d / 2 - FT, h / 2 - 0.009, w / 2 - FT, d / 2, h / 2 + 0.009));
  else fronts(p, -w / 2, w / 2, 0, h, d / 2, o.lift ? { drawers: 1 } : { doors: w > 0.7 ? 2 : 1 });
  return p;
};

/** hood: wall chimney hood (duct at the wall) or island hood (duct in the middle, symmetric — above an island / peninsula) */
const hood: Gen = ({ w, d, h }, o) => (o.island ? [
  box('metal', -w / 2, -d / 2, 0, w / 2, d / 2, 0.07),
  prism('metal', -w / 2 + 0.02, w / 2 - 0.02, [[-d / 2, 0.07], [d / 2, 0.07], [0.16, 0.2], [-0.16, 0.2]]),
  box('metal', -0.14, -0.125, 0.2, 0.14, 0.125, h),
] : [
  box('metal', -w / 2, -d / 2, 0, w / 2, d / 2, 0.07),
  prism('metal', -w / 2 + 0.02, w / 2 - 0.02, [[-d / 2, 0.07], [d / 2, 0.07], [-d / 2 + 0.3, 0.2], [-d / 2, 0.2]]),
  box('metal', -0.14, -d / 2, 0.2, 0.14, -d / 2 + 0.25, h),
]);

/** side-by-side fridge: body, two full-height doors (the left one narrower), vertical handles at the centre line, dispenser panel */
const fridgeSbs: Gen = ({ w, d, h }) => {
  const fy = d / 2 - 0.035, door = 0.07, gap = 0.004, split = -w * 0.06;      // handles fit within the appliance depth
  return [
    box('plinth', -w / 2 + 0.02, -d / 2 + 0.05, 0, w / 2 - 0.02, fy - door - 0.02, 0.05),
    box('main', -w / 2, -d / 2, 0.05, w / 2, fy - door, h),
    box('front', -w / 2 + 0.002, fy - door, 0.06, split - gap, fy, h - 0.004),
    box('front', split + gap, fy - door, 0.06, w / 2 - 0.002, fy, h - 0.004),
    box('metal', split - 0.045, fy, 0.75, split - 0.02, fy + 0.035, 1.5),
    box('metal', split + 0.02, fy, 0.75, split + 0.045, fy + 0.035, 1.5),
    box('glass-dark', (-w / 2 + split) / 2 - 0.075, fy, 1.12, (-w / 2 + split) / 2 + 0.075, fy + 0.004, 1.36),   // water dispenser in the left door
  ];
};

/** flush pantry front: door + fixed panel like the unit fronts, sides (portal) as deep as the cabinets */
const pantryFront: Gen = ({ w, d, h }, o) => {
  const door = Math.min(w - 0.1, Number(o.door ?? 0.9)), fy = d / 2 - HD, p: Part[] = [];
  p.push(box('main', -w / 2, -d / 2, PLINTH, -w / 2 + FT, fy - FT, h), box('main', w / 2 - FT, -d / 2, PLINTH, w / 2, fy - FT, h)); // portal sides
  p.push(box('plinth', -w / 2 + FT, fy - 0.08, 0, w / 2 - FT, fy - 0.06, PLINTH)); // plinth — in line with the units
  const xd0 = o.doorSide === 'right' ? w / 2 - door : -w / 2, xd1 = xd0 + door;
  p.push({ ...box('front', xd0 + FG, fy - FT, PLINTH + FG, xd1 - FG, fy, h - FG), move: true }); // leaf (no frame — flush); opening — partMotion
  if (w - door > 0.05) { const a = o.doorSide === 'right' ? -w / 2 : xd1, b = o.doorSide === 'right' ? xd0 : w / 2; fronts(p, a, b, PLINTH, Math.min(h, 2.0), d / 2, { doors: 1 }); if (h > 2.1) fronts(p, a, b, 2.0, h, d / 2, { doors: 1 }); }
  const hx = o.doorSide === 'right' ? xd0 + 0.05 : xd1 - 0.05;
  p.push({ ...box('metal', hx - 0.006, fy, 0.75, hx + 0.006, d / 2, 1.35), move: true }); // vertical pull handle
  return p;
};

/** motion of moving parts (Part.move): vertical axis at point (x, y) of item coordinates and the full opening angle [° CCW seen from above] */
export interface PartMotion { pivot: [number, number]; angle: number }
/**
 * Pantry door flush with the units: hinge on the side opposite the pull handle (at the portal side), the leaf opens INTO the
 * pantry (into the unit) by 90° and ends up along the portal side.
 */
export function partMotion(generator: string, dims: Dims, o: Record<string, unknown> = {}): PartMotion | null {
  if (generator !== 'pantryFront') return null;
  const { w, d } = dims, right = o.doorSide === 'right';
  return { pivot: [right ? w / 2 - FT - 0.006 : -w / 2 + FT + 0.006, d / 2 - HD - FT], angle: right ? 90 : -90 };
}

const barStool: Gen = ({ w, h }) => [cyl('metal', 0, 0, 0, 0.02, w * 0.9), cyl('metal', 0, 0, 0.02, h - 0.05, 0.04), cyl('metal', 0, 0, 0.28, 0.3, w * 0.7), cyl('main', 0, 0, h - 0.06, h, w)];

/** built-in bathtub: panel, rim, bottom */
const bathtub: Gen = ({ w, d, h }) => {
  const t = 0.07;
  return [
    box('front', -w / 2, -d / 2, 0, w / 2, d / 2, h - 0.03),
    box('main', -w / 2, -d / 2, h - 0.03, w / 2, -d / 2 + t, h), box('main', -w / 2, d / 2 - t, h - 0.03, w / 2, d / 2, h),
    box('main', -w / 2, -d / 2 + t, h - 0.03, -w / 2 + t, d / 2 - t, h), box('main', w / 2 - t, -d / 2 + t, h - 0.03, w / 2, d / 2 - t, h),
    box('water', -w / 2 + t, -d / 2 + t, h - 0.032, w / 2 - t, d / 2 - t, h - 0.031),
  ];
};

/** shower: tray + glass screen + rain shower head */
const shower: Gen = ({ w, d, h }) => [
  box('main', -w / 2, -d / 2, 0, w / 2, d / 2, 0.04),
  box('glass', -w / 2, d / 2 - 0.01, 0.04, w / 2 - Math.min(0.5, w * 0.45), d / 2, h - 0.05),
  box('metal', -w / 2, d / 2 - 0.012, h - 0.05, w / 2 - Math.min(0.5, w * 0.45), d / 2, h), // top profile of the screen
  cyl('metal', 0, -d / 2 + 0.04, 0.9, h - 0.15, 0.02), box('metal', -0.012, -d / 2 + 0.04, h - 0.17, 0.012, -d / 2 + 0.3, h - 0.15), cyl('metal', 0, -d / 2 + 0.3, h - 0.18, h - 0.16, 0.25),
];

/** wall-hung WC */
const toilet: Gen = ({ w, d, h }) => [
  box('front', -w / 2, -d / 2, 0, w / 2, -d / 2 + 0.12, h), // frame boxing
  box('metal', -0.12, -d / 2 + 0.12, h - 0.25, 0.12, -d / 2 + 0.125, h - 0.1), // flush button
  sph('main', 0, -d / 2 + 0.12 + (d - 0.12) * 0.5, 0.33, w * 0.95, d - 0.13, 0.22),
  box('main', -w * 0.45, -d / 2 + 0.13, 0.42, w * 0.45, d / 2 - 0.02, 0.44),
];

/** wall-hung bidet: frame boxing, bowl without a seat, deck-mounted tap */
const bidet: Gen = ({ w, d, h }) => [
  box('front', -w / 2, -d / 2, 0, w / 2, -d / 2 + 0.12, h),
  sph('main', 0, -d / 2 + 0.12 + (d - 0.12) * 0.5, 0.33, w * 0.95, d - 0.13, 0.2),
  box('main', -w * 0.42, -d / 2 + 0.13, 0.4, w * 0.42, d / 2 - 0.04, 0.415),
  cyl('metal', 0, -d / 2 + 0.2, 0.41, 0.52, 0.035), box('metal', -0.012, -d / 2 + 0.2, 0.5, 0.012, -d / 2 + 0.3, 0.52),
];

/** vanity unit with washbasin (+ optional mirror as a separate item) */
const vanity: Gen = ({ w, d, h }, o) => {
  const ch = Number(o.counter ?? h - 0.3), z0 = o.wallHung ? 0.3 : 0, p: Part[] = [box('main', -w / 2, -d / 2, z0, w / 2, d / 2 - HD - FT, ch - 0.05)];
  fronts(p, -w / 2, w / 2, z0, ch - 0.05, d / 2, { drawers: 2 });
  p.push(box('top', -w / 2, -d / 2, ch - 0.05, w / 2, d / 2, ch - 0.01));
  const bw = Math.min(w - 0.1, 0.5);
  p.push(box('basin', -bw / 2, -d / 2 + 0.06, ch - 0.01, bw / 2, d / 2 - 0.04, ch + 0.12));
  p.push(cyl('metal', 0, -d / 2 + 0.03, ch + 0.12, h, 0.03), box('metal', -0.01, -d / 2 + 0.03, h - 0.03, 0.01, -d / 2 + 0.16, h - 0.01));
  return p;
};

/** washing machine / dryer */
const washer: Gen = ({ w, d, h }) => [
  box('appliance', -w / 2, -d / 2, 0, w / 2, d / 2 - 0.035, h),
  box('appliance', -w / 2 + 0.03, d / 2 - 0.035, h - 0.12, w / 2 - 0.03, d / 2 - 0.025, h - 0.03),
  wheel('metal', 0, d / 2 - 0.02, h * 0.45, 0.03, Math.min(w, h) * 0.55, 90),
  wheel('glass-dark', 0, d / 2 - 0.006, h * 0.45, 0.01, Math.min(w, h) * 0.42, 90),
];

/** corner sofa (L-shaped): chaise on the left / right */
const cornerSofa: Gen = ({ w, d, h }, o) => {
  const back = 0.2, arm = 0.18, base = 0.42, seat = 0.45, sd = Math.min(0.95, d - 0.4), side = o.side === 'left' ? -1 : 1, cw = Math.min(0.95, w * 0.4);
  const p: Part[] = [];
  p.push(box('main', -w / 2, -d / 2, 0.08, w / 2, -d / 2 + sd, base), box('main', -w / 2, -d / 2, base, w / 2, -d / 2 + back, h));
  const cx0 = side > 0 ? w / 2 - cw : -w / 2, cx1 = cx0 + cw;
  p.push(box('main', cx0, -d / 2 + sd, 0.08, cx1, d / 2, base)); // chaise
  const ax = side > 0 ? -w / 2 : w / 2 - arm;
  p.push(box('main', ax, -d / 2 + back, base, ax + arm, -d / 2 + sd, Math.min(h, 0.62)));
  p.push(box('seat', -w / 2 + (side > 0 ? arm : 0), -d / 2 + back, base, w / 2 - (side > 0 ? 0 : arm), -d / 2 + sd - 0.02, seat));
  p.push(box('seat', cx0 + 0.01, -d / 2 + sd - 0.02, base, cx1 - 0.01, d / 2 - 0.02, seat));
  p.push(...legs('legs', w, d, 0.08, 0.04, 0.04));
  return p;
};

/** TV: screen on a stand or on the wall (elevation) */
const tv: Gen = ({ w, d, h }, o) => {
  if (o.wall) return [box('frame', -w / 2, -d / 2, 0, w / 2, d / 2 - 0.001, h), box('screen', -w / 2 + 0.01, d / 2 - 0.001, 0.01, w / 2 - 0.01, d / 2, h - 0.01)];
  const sh = h - 0.12;
  return [box('frame', -w / 2, -0.02, 0.12, w / 2, 0.02, h), box('screen', -w / 2 + 0.01, 0.02, 0.13, w / 2 - 0.01, 0.021, h - 0.01), box('metal', -0.2, -d / 2, 0, 0.2, d / 2, 0.015), box('metal', -0.03, -0.015, 0.015, 0.03, 0.015, 0.12 + sh * 0.2)];
};

const pouf: Gen = ({ w, h }) => [cyl('main', 0, 0, 0, h, w)];

/** bench / bench with backrest */
const bench: Gen = ({ w, d, h }) => [box('main', -w / 2, -d / 2, h - 0.05, w / 2, d / 2, h), ...legs('legs', w, d, h - 0.05, 0.05, 0.06)];

/** mirror (on the wall — elevation) */
const mirror: Gen = ({ w, d, h }, o) => (o.round
  ? [wheel('frame', 0, -0.001, h / 2, d - 0.002, Math.min(w, h), 90), wheel('mirror', 0, 0.001, h / 2, d - 0.002, Math.min(w, h) - 0.04, 90)]
  : [box('frame', -w / 2, -d / 2, 0, w / 2, d / 2 - 0.001, h), box('mirror', -w / 2 + 0.03, d / 2 - 0.001, 0.03, w / 2 - 0.03, d / 2, h - 0.03)]);

/** dressing table: top with a drawer + mirror */
const dressingTable: Gen = ({ w, d, h }) => [
  box('main', -w / 2, -d / 2, 0.73, w / 2, d / 2, 0.76), box('front', -w / 2 + 0.05, d / 2 - 0.01, 0.6, w / 2 - 0.05, d / 2, 0.73), ...legs('legs', w, d, 0.6, 0.04, 0.03),
  box('frame', -w * 0.3, -d / 2, 0.76, w * 0.3, -d / 2 + 0.03, h), box('mirror', -w * 0.3 + 0.03, -d / 2 + 0.03, 0.79, w * 0.3 - 0.03, -d / 2 + 0.031, h - 0.03),
];

/** crib: bars */
const crib: Gen = ({ w, d, h }) => {
  const p: Part[] = [...legs('main', w, d, h, 0.04, 0), box('mattress', -w / 2 + 0.04, -d / 2 + 0.04, 0.25, w / 2 - 0.04, d / 2 - 0.04, 0.35), box('main', -w / 2 + 0.04, -d / 2 + 0.04, 0.2, w / 2 - 0.04, d / 2 - 0.04, 0.25)];
  for (const sy of [-1, 1]) p.push(box('main', -w / 2, sy * d / 2 - (sy > 0 ? 0.03 : 0), h - 0.04, w / 2, sy * d / 2 + (sy < 0 ? 0.03 : 0), h));
  for (const sx of [-1, 1]) p.push(box('main', sx * w / 2 - (sx > 0 ? 0.03 : 0), -d / 2, h - 0.04, sx * w / 2 + (sx < 0 ? 0.03 : 0), d / 2, h));
  for (let y = -d / 2 + 0.1; y < d / 2 - 0.05; y += 0.09) for (const sx of [-1, 1]) p.push(box('main', sx * (w / 2 - 0.02) - 0.01, y - 0.01, 0.25, sx * (w / 2 - 0.02) + 0.01, y + 0.01, h - 0.04));
  return p;
};

/** bunk bed */
const bunkBed: Gen = ({ w, d, h }) => {
  const p: Part[] = [...legs('main', w, d, h, 0.06, 0)];
  for (const z of [0.25, h - 0.6]) { p.push(box('main', -w / 2, -d / 2, z, w / 2, d / 2, z + 0.06), box('mattress', -w / 2 + 0.05, -d / 2 + 0.05, z + 0.06, w / 2 - 0.05, d / 2 - 0.05, z + 0.2), box('bedding', -w / 2 + 0.04, -d / 2 + 0.6, z + 0.19, w / 2 - 0.04, d / 2 - 0.05, z + 0.22)); }
  p.push(box('main', -w / 2, -d / 2, h - 0.2, -w / 2 + 0.04, d / 2, h - 0.15), box('main', w / 2 - 0.04, -d / 2, h - 0.2, w / 2, d / 2, h - 0.15));
  for (let z = 0.4; z < h - 0.5; z += 0.3) p.push(box('main', w / 2 - 0.03, d / 2 - 0.45, z, w / 2, d / 2 - 0.05, z + 0.03));
  return p;
};

/** workbench with a shelf and a pegboard */
const workbench: Gen = ({ w, d, h }) => [
  box('main', -w / 2, -d / 2, 0.86, w / 2, d / 2, 0.9), ...legs('legs', w, d, 0.86, 0.05, 0.03), box('main', -w / 2 + 0.06, -d / 2 + 0.06, 0.15, w / 2 - 0.06, d / 2 - 0.06, 0.17),
  box('accent', -w / 2, -d / 2, 0.9, w / 2, -d / 2 + 0.02, h), box('metal', -w / 2 + 0.06, -d / 2 + 0.02, 0.9, -w / 2 + 0.09, -d / 2 + 0.05, h - 0.05), box('metal', w / 2 - 0.09, -d / 2 + 0.02, 0.9, w / 2 - 0.06, -d / 2 + 0.05, h - 0.05),
];

/**
 * Fireplace: 'built-in' — floor-to-ceiling surround with an insert and glass; 'tv' — low panoramic one in a wall unit (shelf);
 * 'stove' — freestanding stove with a flue pipe. Flame — emissive material.
 */
const fireplace: Gen = ({ w, d, h }, o) => {
  const p: Part[] = [];
  if (o.style === 'stove') {
    const bw = Math.min(w, d);
    p.push(box('metal', -bw / 2, -bw / 2, 0, bw / 2, bw / 2, 0.08), cyl('metal', 0, 0, 0.08, 0.95, bw * 0.92), box('glass-dark', -bw * 0.3, bw * 0.43, 0.3, bw * 0.3, bw * 0.47, 0.75), box('fire', -bw * 0.22, bw * 0.38, 0.33, bw * 0.22, bw * 0.43, 0.6), cyl('metal', 0, 0, 0.95, h, 0.15));
    return p;
  }
  const fz0 = o.style === 'tv' ? 0.45 : 0.5, fz1 = o.style === 'tv' ? 0.9 : 1.1, fw = o.style === 'tv' ? w * 0.75 : Math.min(w - 0.3, 0.9), ff = d / 2 - 0.06; // surround face
  p.push(box('main', -w / 2, -d / 2, 0.12, w / 2, ff, h)); // surround
  p.push(box('hearth', -w / 2, -d / 2, 0, w / 2, d / 2, 0.12)); // base / hearth (projecting in front of the face)
  p.push(box('metal', -fw / 2 - 0.03, ff, fz0 - 0.03, fw / 2 + 0.03, ff + 0.005, fz1 + 0.03)); // insert frame
  p.push(box('glass-dark', -fw / 2, ff + 0.005, fz0, fw / 2, ff + 0.007, fz1));
  p.push(box('fire', -fw / 2 + 0.05, ff - 0.02, fz0 + 0.03, fw / 2 - 0.05, ff + 0.004, fz0 + (fz1 - fz0) * 0.55)); // flame
  if (o.style === 'tv') p.push(box('hearth', -w / 2, -d / 2, fz1 + 0.18, w / 2, d / 2, fz1 + 0.22)); // mantel shelf
  return p;
};

/**
 * Passenger car — a generic compact hatchback, reference dimensions: length 4.10, width 1.80 (without mirrors), height 1.45,
 * wheelbase 2.60, front overhang 0.85, wheels Ø ≈ 0.62. Body lofted from cross-sections: sloping bonnet, raked windscreen,
 * roof highest at ~⅓ of the length from the back, steep rear window with a spoiler, wheel arches, cabin narrowing upwards
 * (windows), roof in the body colour. Front of the car = +y (front of the item). Proportions scale to w × d × h.
 */
const car: Gen = ({ w, d, h }, o) => {
  const L = d, kz = h / 1.45, kw = w / 1.8, sY = (s: number) => -L / 2 + (s / 4.1) * L, Z = (z: number) => z * kz, W = (x: number) => x * kw;
  const fo = Number(o.frontOverhang ?? 0.85), wb = Number(o.wheelbase ?? 2.6), wd = Number(o.wheel ?? 0.62) * kz;
  const sF = 4.1 - fo, sR = sF - wb; // axles (distance from the back, reference car)
  const st = (s: number, z0: number, z1: number, wbh: number, wth: number, p = 4) => ({ y: sY(s), z0: Z(z0), z1: Z(z1), wb: W(wbh), wt: W(wth), p });
  // lower body: sections along the length (with wheel arches), the shoulder line drops towards the front (bonnet)
  const belt = (s: number) => (s < 0.15 ? 0.94 + s * 0.27 : s < 2.75 ? 0.98 - (s - 0.15) * 0.019 : s < 3.6 ? 0.93 - (s - 2.75) * 0.13 : 0.82 - (s - 3.6) * 0.42);
  const arch = (s: number, ax: number) => { const r = 0.37, dx = Math.abs(s - ax); return dx < r ? 0.185 + Math.sqrt(r * r - dx * dx) * 1.35 : 0.185; };
  const bottom = (s: number) => Math.max(arch(s, sR), arch(s, sF));
  const half = (s: number) => (s < 0.25 ? 0.82 + s * 0.3 : s > 3.75 ? 0.895 - (s - 3.75) * 0.33 : 0.899);
  const lower: ReturnType<typeof st>[] = [st(0, 0.33, 0.8, 0.76, 0.7, 3)];
  const ss = [0.04, 0.1, 0.18, 0.26, 0.34, 0.42, 0.52, 0.627, 0.73, 0.83, 0.92, 1.0, 1.4, 1.9, 2.4, 2.7, 2.84, 2.92, 3.0, 3.1, 3.21, 3.32, 3.42, 3.5, 3.58, 3.7, 3.82, 3.92, 3.99];
  for (const s of ss) lower.push(st(s, bottom(s) + (s < 0.1 || s > 3.9 ? 0.06 : 0), belt(s), half(s), half(s) - 0.05, s < 0.1 || s > 3.9 ? 3 : 4));
  lower.push(st(4.1, 0.3, 0.56, 0.74, 0.66, 3));
  // cabin (windows): from the spoiler to the base of the windscreen; roof highest about 1.3 m from the back
  const roofZ = (s: number) => (s < 0.28 ? 0.98 + (s - 0.12) * 2.6 : s < 1.6 ? 1.405 + Math.sin(((s - 0.28) / 1.32) * Math.PI / 2) * 0.045 : s < 2.05 ? 1.45 - (s - 1.6) * 0.09 : 1.41 - (s - 2.05) ** 1.35 * 0.62);
  const cabin = [st(0.12, 0.96, 0.985, 0.8, 0.79, 3)];
  // top edge of the windows 1.5 cm below the roof (the roof covers it — no z-fighting)
  for (const s of [0.18, 0.24, 0.3, 0.45, 0.8, 1.2, 1.6, 1.85, 2.05, 2.25, 2.45, 2.62]) cabin.push(st(s, belt(s) - 0.02, Math.min(1.45, roofZ(s)) - 0.015, 0.81, 0.62 + Math.min(0.06, Math.max(0, s - 2.0) * 0.12), 4));
  cabin.push(st(2.76, belt(2.76) - 0.02, belt(2.76) + 0.02, 0.8, 0.79, 3));
  // roof in the body colour (side, front and rear windows stay visible)
  const roof = [0.34, 0.6, 1.0, 1.4, 1.7, 1.95, 2.12].map((s) => st(s, Math.min(1.45, roofZ(s)) - 0.07, Math.min(1.45, roofZ(s)), 0.665, 0.57, 4));
  const p: Part[] = [loft('main', lower), loft('glass-dark', cabin), loft('main', roof)];
  // spoiler above the rear window, B-pillar (black), mirrors
  p.push(box('main', -W(0.6), sY(0.2), Z(1.33), W(0.6), sY(0.36), Z(1.39)));
  for (const sx of [-1, 1]) {
    p.push(box('trim', sx * W(0.79) - W(0.02), sY(1.72), Z(1.0), sx * W(0.79) + W(0.02), sY(1.8), Z(1.36)));
    p.push(box('main', sx > 0 ? W(0.79) : -W(0.899), sY(2.58), Z(1.0), sx > 0 ? W(0.899) : -W(0.79), sY(2.72), Z(1.1)));
  }
  // wheels: tyres + rims (two-tone), axles
  for (const s of [sR, sF]) for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.105);
    p.push(wheel('tyre', x, sY(s), wd / 2, 0.2, wd), wheel('metal', sx * (w / 2 - 0.1), sY(s), wd / 2, 0.2, wd * 0.7), wheel('trim', sx * (w / 2 - 0.097), sY(s), wd / 2, 0.19, wd * 0.36));
  }
  // headlights (narrow LED), grille, tail lights, number plates
  for (const sx of [-1, 1]) {
    p.push(box('lights-front', sx > 0 ? W(0.42) : -W(0.76), sY(3.92), Z(0.66), sx > 0 ? W(0.76) : -W(0.42), sY(4.0), Z(0.72)));
    p.push(box('lights-rear', sx > 0 ? W(0.5) : -W(0.82), sY(0.0), Z(0.84), sx > 0 ? W(0.82) : -W(0.5), sY(0.07), Z(0.93)));
  }
  p.push(box('trim', -W(0.36), sY(3.96), Z(0.42), W(0.36), sY(4.03), Z(0.6)), box('trim', -W(0.55), sY(3.98), Z(0.24), W(0.55), sY(4.04), Z(0.36)));
  p.push(box('plate', -W(0.26), sY(4.07), Z(0.44), W(0.26), sY(4.1), Z(0.555)), box('plate', -W(0.26), sY(0.0), Z(0.6), W(0.26), sY(0.03), Z(0.71)));
  return p;
};

/** wall shelf: a board at the top of the outline on two brackets (back against the wall: y = −d / 2) */
const wallShelf: Gen = ({ w, d, h }) => {
  const t = Math.min(0.03, h * 0.4), bx = w / 2 - Math.min(0.18, w * 0.2);
  return [box('main', -w / 2, -d / 2, h - t, w / 2, d / 2, h), ...[-bx, bx].flatMap((x) => [
    box('metal', x - 0.012, -d / 2, 0, x + 0.012, -d / 2 + 0.012, h - t), box('metal', x - 0.012, -d / 2, h - t - 0.024, x + 0.012, d / 2 - 0.03, h - t),
  ])];
};
/** wall lamp: wall plate, arm, shade */
const wallLamp: Gen = ({ w, d, h }) => [
  box('metal', -0.045, -d / 2, h * 0.3, 0.045, -d / 2 + 0.018, h * 0.62), box('metal', -0.011, -d / 2, h * 0.42, 0.011, d / 2 - w / 2, h * 0.46),
  cyl('shade', 0, d / 2 - w / 2, h * 0.38, h, w),
];

export const GENERATORS: Record<string, Gen> = {
  wallShelf, wallLamp,
  sofa, table, chair, bed, cabinet, desk, officeChair, shelves, rug, lamp, plant,
  kitchenBase, kitchenTall, kitchenWall, hood, fridgeSbs, pantryFront, barStool, bathtub, shower, toilet, bidet, vanity, washer, cornerSofa, tv, pouf, bench, mirror,
  dressingTable, crib, bunkBed, workbench, fireplace, car,
};

/** item parts; they always fit within the w × d × h outline (checked in tests) */
export function generateParts(generator: string, dims: Dims, options: Record<string, unknown> = {}): Part[] {
  const g = GENERATORS[generator];
  if (!g) return [box('main', -dims.w / 2, -dims.d / 2, 0, dims.w / 2, dims.d / 2, dims.h)];
  return g(dims, options);
}

/** box enclosing a part (with rotation rotZ) */
export function partBounds(p: Part): [number, number, number, number, number, number] {
  if (p.shape === 'loft' && p.stations) {
    const xs = p.stations.flatMap((q) => loftRing(q, 28, p.c[0]).map((r) => r[0])), ys = p.stations.map((q) => q.y), zs = p.stations.flatMap((q) => [q.z0, q.z1]);
    return [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)];
  }
  if (p.shape === 'prism' && p.profile) {
    const ys = p.profile.map((q) => q[0]), zs = p.profile.map((q) => q[1]);
    return [p.c[0] - p.s[0] / 2, Math.min(...ys), Math.min(...zs), p.c[0] + p.s[0] / 2, Math.max(...ys), Math.max(...zs)];
  }
  const a = ((p.rotZ ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hx = (p.s[0] * c + p.s[1] * s) / 2, hy = (p.s[0] * s + p.s[1] * c) / 2, hz = p.s[2] / 2;
  return [p.c[0] - hx, p.c[1] - hy, p.c[2] - hz, p.c[0] + hx, p.c[1] + hy, p.c[2] + hz];
}
