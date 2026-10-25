// Thumbnails of parametric furniture (assets/thumbnails — "auto:parametric"): an axonometric projection of the same parts the
// 3D mesh is built from (generators.ts) — SVG generated in the browser, without a renderer or binary files. Colours from the part
// materials; face shading by light direction; painting from the farthest faces (painter's algorithm).
import { generateParts, loftRing, type Part } from './generators';
import { generatorOptions, resolveDims, slotMaterials, type CatalogItem } from './furniture';
import { materialById } from './materials';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// viewer in front, slightly to the right of the item and above (local: x — width, y — front, z — up)
const VIEW = nrm([0.55, 1, 0.8]);
const RIGHT = nrm(cross([-VIEW[0], -VIEW[1], -VIEW[2]], [0, 0, 1]));
const UP = cross(RIGHT, [-VIEW[0], -VIEW[1], -VIEW[2]]);
const LIGHT = nrm([-0.35, 0.75, 1]);

interface Face { pts: [number, number][]; depth: number; color: string }

function shade(hex: string, n: V3): string {
  const k = 0.58 + 0.42 * Math.max(0, dot(n, LIGHT));
  const c = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(Math.min(255, ((c >> s) & 255) * k)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

const proj = (p: V3): [number, number] => [dot(p, RIGHT), -dot(p, UP)];

function rotZ(p: V3, c: V3, deg: number): V3 {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180, s = Math.sin(a), k = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + x * k - y * s, c[1] + x * s + y * k, p[2]];
}

function partFaces(p: Part, color: string): Face[] {
  const out: Face[] = [];
  const add = (poly: V3[], n: V3) => {
    if (dot(n, VIEW) <= 1e-6) return;
    const cen = poly.reduce((s, q) => [s[0] + q[0] / poly.length, s[1] + q[1] / poly.length, s[2] + q[2] / poly.length] as V3, [0, 0, 0] as V3);
    out.push({ pts: poly.map(proj), depth: dot(cen, VIEW), color: shade(color, n) });
  };
  const [cx, cy, cz] = p.c;
  if (p.shape === 'box') {
    const [hx, hy, hz] = [p.s[0] / 2, p.s[1] / 2, p.s[2] / 2];
    const P = (x: number, y: number, z: number) => rotZ([cx + x, cy + y, cz + z], p.c, p.rotZ ?? 0);
    const N = (n: V3) => rotZ(n, [0, 0, 0], p.rotZ ?? 0);
    add([P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)], [0, 0, 1]);
    add([P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)], N([0, 1, 0]));
    add([P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz)], N([0, -1, 0]));
    add([P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz)], N([1, 0, 0]));
    add([P(-hx, -hy, -hz), P(-hx, hy, -hz), P(-hx, hy, hz), P(-hx, -hy, hz)], N([-1, 0, 0]));
  } else if (p.shape === 'prism' && p.profile) {
    const x0 = p.c[0] - p.s[0] / 2, x1 = p.c[0] + p.s[0] / 2, P = p.profile;
    add(P.map((q) => [x1, q[0], q[1]] as V3), [1, 0, 0]);
    add(P.map((q) => [x0, q[0], q[1]] as V3), [-1, 0, 0]);
    const area = P.reduce((s2, q, i) => { const r2 = P[(i + 1) % P.length]; return s2 + q[0] * r2[1] - r2[0] * q[1]; }, 0), sg = area >= 0 ? 1 : -1;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], ey = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ey, ez) || 1;
      add([[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]], [0, (sg * ez) / l, (-sg * ey) / l]);
    }
  } else if (p.shape === 'loft' && p.stations) {
    const n = 16, rings = p.stations.map((q) => loftRing(q, n, p.c[0]).map(([x, z]) => [x, q.y, z] as V3));
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
      const a = rings[k][i], b = rings[k][(i + 1) % n], c2 = rings[k + 1][(i + 1) % n], d2 = rings[k + 1][i];
      const m: V3 = [(a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2, (a[2] + c2[2]) / 2], q = p.stations[k], ctr: V3 = [p.c[0], q.y, (q.z0 + q.z1) / 2];
      let nn = nrm(cross([c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]], [d2[0] - b[0], d2[1] - b[1], d2[2] - b[2]]));
      if (dot(nn, [m[0] - ctr[0], 0, m[2] - ctr[2]]) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      add([a, b, c2, d2], nn);
    }
  } else if (p.shape === 'wheel') {
    const n = 14, r = p.s[1] / 2, hw = p.s[0] / 2, rz = ((p.rotZ ?? 0) * Math.PI) / 180;
    const P = (x: number, a: number): V3 => { const lx = x, ly = Math.cos(a) * r; return [cx + lx * Math.cos(rz) - ly * Math.sin(rz), cy + lx * Math.sin(rz) + ly * Math.cos(rz), cz + Math.sin(a) * r]; };
    const N = (v: V3): V3 => [v[0] * Math.cos(rz) - v[1] * Math.sin(rz), v[0] * Math.sin(rz) + v[1] * Math.cos(rz), v[2]];
    const ring = (x: number) => Array.from({ length: n }, (_, i) => P(x, (i / n) * Math.PI * 2));
    add(ring(hw), N([1, 0, 0])); add(ring(-hw), N([-1, 0, 0]));
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2, m = (a + b) / 2; add([P(-hw, a), P(hw, a), P(hw, b), P(-hw, b)], N([0, Math.cos(m), Math.sin(m)])); }
  } else if (p.shape === 'cyl') {
    const n = 18, rx = p.s[0] / 2, ry = p.s[1] / 2, z0 = cz - p.s[2] / 2, z1 = cz + p.s[2] / 2;
    const ring = (z: number) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z] as V3; });
    const top = ring(z1), bot = ring(z0);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = ((i + 0.5) / n) * Math.PI * 2; add([bot[i], bot[j], top[j], top[i]], [Math.cos(a), Math.sin(a), 0]); }
    add(top, [0, 0, 1]);
  } else {
    // sphere / ellipsoid: the projected outline (ellipse) as a single face
    const n = 24, rx = Math.max(p.s[0], p.s[1]) / 2, rz = p.s[2] / 2;
    const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const q = proj(p.c); return [q[0] + Math.cos(a) * rx, q[1] + Math.sin(a) * rz] as [number, number]; });
    out.push({ pts, depth: dot(p.c, VIEW), color: shade(color, [0, 0.4, 0.9]) });
  }
  return out;
}

const cache = new Map<string, string>();

/** item thumbnail (SVG data URL) — variant / material optional */
export function furnitureThumbnail(item: CatalogItem, variant?: string | null, materialId?: string | null): string {
  if (item.runtimeModel.type === 'glb') return item.thumbnail.startsWith('/') ? item.thumbnail : placeholder(item.name);
  const key = `${item.id}|${variant ?? ''}|${materialId ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = { variant: variant ?? null, materialId: materialId ?? null };
  const dims = resolveDims(item, p);
  const mats = slotMaterials(item, p);
  const parts = generateParts(item.runtimeModel.generator ?? 'box', dims, generatorOptions(item, variant));
  const faces = parts.flatMap((q) => partFaces(q, materialById(mats[q.slot] ?? item.defaultMaterial)?.baseColor ?? '#b9bec6'));
  faces.sort((a, b) => a.depth - b.depth);
  const xs = faces.flatMap((f) => f.pts.map((q) => q[0])), ys = faces.flatMap((f) => f.pts.map((q) => q[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const size = Math.max(x1 - x0, y1 - y0), pad = size * 0.08;
  const vb = [(x0 + x1) / 2 - size / 2 - pad, (y0 + y1) / 2 - size / 2 - pad, size + 2 * pad, size + 2 * pad].map((v) => v.toFixed(4)).join(' ');
  const sw = (size * 0.006).toFixed(4);
  const body = faces.map((f) => `<polygon points="${f.pts.map((q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`).join(' ')}" fill="${f.color}" stroke="rgba(30,35,40,.28)" stroke-width="${sw}" stroke-linejoin="round"/>`).join('');
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`)}`;
  cache.set(key, url);
  return url;
}

function placeholder(name: string) {
  const t = name.slice(0, 2).toUpperCase();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="10" fill="#e8ebef"/><text x="32" y="40" font-size="20" text-anchor="middle" fill="#6e7781" font-family="sans-serif">${t}</text></svg>`)}`;
}
