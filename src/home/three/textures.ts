// Procedural textures (2D canvas) of built-in materials. One texture = textureExtent() metres of surface
// (pattern module × number of modules), so tile / plank / slat sizes on walls and floors are true to scale.
// Deterministic (seed from the material id), shared (cache keyed by material + layout + colour).
import * as THREE from 'three';
import { activeProfile } from '../quality/profile';
import { effectiveTexture, textureCover, textureExtent, type MaterialDef } from '../catalog/materials';
import type { FinishLayout } from '../model/types';

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

const hex = (c: string) => new THREE.Color(c);
const css = (c: THREE.Color) => `#${c.getHexString()}`;
const shade = (c: string, k: number) => { const x = hex(c); x.offsetHSL(0, 0, k); return css(x); };
const jitter = (c: string, r: () => number, amount: number) => { const x = hex(c); x.offsetHSL((r() - 0.5) * amount * 0.15, (r() - 0.5) * amount * 0.5, (r() - 0.5) * amount); return css(x); };

const PX_PER_M = 420;
/** max texture side [px] — from the quality profile */
const maxPx = () => activeProfile.current.textureMaxPx;

/** canvas size for a texture (pixels) */
export function canvasSize(m: MaterialDef, layout?: FinishLayout | null): [number, number] {
  const [w, h] = textureExtent(m, layout);
  const k = Math.min(1, maxPx() / Math.max(w * PX_PER_M, h * PX_PER_M));
  return [Math.max(64, Math.round(w * PX_PER_M * k)), Math.max(64, Math.round(h * PX_PER_M * k))];
}

/** paints a material texture onto a canvas: (u, v) = (width, height) of the texture in metres; v grows upwards */
export function paintMaterial(ctx: CanvasRenderingContext2D, W: number, H: number, m: MaterialDef, layout?: FinishLayout | null, color?: string | null) {
  const t = effectiveTexture(m, layout), base = color || m.baseColor, r = rng(m.id + JSON.stringify(layout ?? {}));
  const [ew, eh] = textureExtent(m, layout), sx = W / ew, sy = H / eh; // px per metre
  const [nx, ny] = textureCover(m), [mw, mh] = [ew / nx, eh / ny];
  const rect = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x * sx, H - (y + h) * sy, w * sx, h * sy); };
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  const noise = (amount: number, size = 1.5) => {
    for (let i = 0; i < (W * H) / 60; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${amount * r()})`;
      ctx.fillRect(r() * W, r() * H, size, size);
    }
  };
  switch (t.type) {
    case 'tiles': case 'terrazzo': {
      const g = t.grout ?? 0, brick = t.pattern === 'brick';
      rect(0, 0, ew, eh, t.groutColor ?? shade(base, 0.1));
      for (let j = 0; j < ny; j++) for (let i = -1; i <= nx; i++) {
        const off = brick && j % 2 === 1 ? mw / 2 : 0, x = i * mw + off, y = j * mh;
        const c = t.type === 'terrazzo' ? base : jitter(base, r, t.variation ?? 0.03);
        rect(x + g / 2, y + g / 2, mw - g, mh - g, c);
        if (t.type === 'terrazzo') {
          for (let k = 0; k < 140 * (mw * mh) / 0.36; k++) {
            const cc = t.chips?.[Math.floor(r() * (t.chips?.length ?? 1))] ?? '#888888', px = x + g / 2 + r() * (mw - g), py = y + g / 2 + r() * (mh - g), s = 0.004 + r() * 0.012;
            ctx.fillStyle = cc; ctx.beginPath(); ctx.ellipse(px * sx, H - py * sy, s * sx, s * sy * (0.5 + r()), r() * Math.PI, 0, Math.PI * 2); ctx.fill();
          }
        }
        if (t.noise) for (let k = 0; k < 60; k++) { ctx.fillStyle = `rgba(0,0,0,${t.noise * r() * 0.6})`; ctx.fillRect((x + r() * mw) * sx, H - (y + r() * mh) * sy, 2, 2); }
      }
      break;
    }
    case 'planks': {
      const bw = t.boardWidth!, bl = t.boardLength!, rows = Math.round(eh / bw), gap = t.gap ?? 0.001, gc = t.gapColor ?? shade(base, -0.25);
      const offs = (j: number) => (t.pattern === 'half' ? (j % 2) * bl / 2 : t.pattern === 'third' ? (j % 3) * bl / 3 : t.pattern === 'random' ? [0, 0.37, 0.71, 0.18, 0.55][j % 5] * bl : 0);
      for (let j = 0; j < rows; j++) {
        for (let i = -1; i <= nx + 1; i++) {
          const x = i * bl - offs(j), y = j * bw, c = jitter(base, r, t.variation ?? 0.06);
          rect(x, y, bl, bw, c);
          // wood grain: streaks along the plank
          const n = Math.round(10 * (t.grain ?? 0.5));
          for (let k = 0; k < n; k++) {
            const yy = y + r() * bw, a = 0.05 + 0.1 * r();
            ctx.strokeStyle = `rgba(${r() < 0.6 ? '60,40,20' : '255,240,220'},${a * (t.grain ?? 0.5)})`;
            ctx.lineWidth = 1 + r() * 2; ctx.beginPath();
            ctx.moveTo(x * sx, H - yy * sy);
            for (let u = 0; u <= 1; u += 0.1) ctx.lineTo((x + u * bl) * sx, H - (yy + Math.sin(u * 7 + k) * bw * 0.04) * sy);
            ctx.stroke();
          }
          if (gap > 0) { rect(x, y, gap, bw, gc); }
        }
        if (gap > 0) rect(0, j * bw, ew, gap, gc);
      }
      break;
    }
    case 'brick': {
      // brick in running (half) bond: module = brick + joint, rows offset by ½ (true scale)
      const bl = t.boardLength ?? 0.25, bh = t.boardWidth ?? 0.065, j = t.grout ?? 0.01, ml = bl + j, mh = bh + j;
      rect(0, 0, ew, eh, t.groutColor ?? '#c4beb4');
      const rows = Math.round(eh / mh), cols = Math.round(ew / ml);
      for (let row = 0; row < rows; row++) for (let i = -1; i <= cols; i++) {
        const x = i * ml + (row % 2 ? ml / 2 : 0) + j / 2, y = row * mh + j / 2;
        const c = t.chips?.length ? jitter(t.chips[Math.floor(r() * t.chips.length)], r, t.variation ?? 0.06) : jitter(base, r, t.variation ?? 0.1);
        rect(x, y, bl, bh, c);
        for (let k = 0; k < 18; k++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.08 * r()})`; ctx.fillRect((x + r() * bl) * sx, H - (y + r() * bh) * sy, 2, 2); }
      }
      break;
    }
    case 'herringbone': case 'chevron': {
      paintParquet(ctx, W, H, sx, sy, ew, eh, t, base, m.id + JSON.stringify(layout ?? {}));
      break;
    }
    case 'panels': {
      const g = t.groove ?? 0.01, ins = t.inset ?? 0.08, dark = t.accent ?? shade(base, -0.12), light = shade(base, 0.06);
      rect(0, 0, ew, g, dark); rect(0, 0, g, eh, dark);
      rect(ins, ins, ew - 2 * ins, g, light); rect(ins, eh - ins - g, ew - 2 * ins, g, dark); rect(ins, ins, g, eh - 2 * ins, light); rect(ew - ins - g, ins, g, eh - 2 * ins, dark);
      break;
    }
    case 'fluted': {
      for (let i = 0; i < nx; i++) {
        const grd = ctx.createLinearGradient(i * mw * sx, 0, (i + 1) * mw * sx, 0);
        grd.addColorStop(0, shade(base, -0.12)); grd.addColorStop(0.5, shade(base, 0.08)); grd.addColorStop(1, shade(base, -0.12));
        ctx.fillStyle = grd; ctx.fillRect(i * mw * sx, 0, mw * sx + 1, H);
      }
      break;
    }
    case 'slats': {
      const sw = t.slat ?? 0.04;
      for (let i = 0; i < nx; i++) {
        rect(i * mw + sw, 0, mw - sw, eh, t.gapColor ?? '#222222');
        rect(i * mw, 0, sw, eh, jitter(base, r, 0.04));
        rect(i * mw, 0, sw * 0.12, eh, shade(base, 0.08)); rect(i * mw + sw * 0.88, 0, sw * 0.12, eh, shade(base, -0.1));
        for (let k = 0; k < 8; k++) { ctx.fillStyle = `rgba(50,30,15,${0.06 * r()})`; ctx.fillRect((i * mw + r() * sw) * sx, 0, 1, H); }
      }
      break;
    }
    case 'wallpaper': {
      const a = t.accent ?? shade(base, -0.1);
      if (t.motif === 'stripes') { rect(0, 0, ew * 0.5, eh, a); rect(ew * 0.5, 0, ew * 0.04, eh, shade(a, -0.05)); }
      else if (t.motif === 'dots') { ctx.fillStyle = a; for (const [px, py] of [[0.25, 0.25], [0.75, 0.75]]) { ctx.beginPath(); ctx.arc(px * W, py * H, Math.min(W, H) * 0.06, 0, Math.PI * 2); ctx.fill(); } }
      else { ctx.strokeStyle = a; ctx.lineWidth = Math.max(2, W * 0.03); ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W / 2, 0); ctx.lineTo(W, H / 2); ctx.lineTo(W / 2, H); ctx.closePath(); ctx.stroke(); }
      noise(0.03);
      break;
    }
    case 'weave': {
      const a = t.accent ?? shade(base, -0.05), n = Math.max(8, Math.round(ew * 220));
      ctx.fillStyle = a;
      for (let i = 0; i < n; i++) { if (i % 2) ctx.fillRect((i / n) * W, 0, W / n * 0.6, H); }
      ctx.fillStyle = `rgba(255,255,255,0.05)`;
      for (let j = 0; j < n; j++) if (j % 2) ctx.fillRect(0, (j / n) * H, W, H / n * 0.5);
      noise(0.05, 1);
      break;
    }
    case 'noise': {
      const a = t.accent ?? shade(base, -0.06), blobs = Math.round(60 / Math.max(0.05, t.scale ?? 0.3));
      for (let i = 0; i < blobs; i++) {
        const x = r() * W, y = r() * H, rr = (0.05 + r() * 0.25) * Math.min(W, H) * (t.scale ?? 0.3);
        const grd = ctx.createRadialGradient(x, y, 0, x, y, rr);
        grd.addColorStop(0, a + '66'); grd.addColorStop(1, a + '00');
        ctx.fillStyle = grd; ctx.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
      }
      noise(t.amount ?? 0.06);
      break;
    }
    case 'rug': {
      const a = t.accent ?? shade(base, -0.1);
      if (t.motif === 'stripes') { rect(0, 0, ew, eh * 0.18, a); rect(0, eh * 0.55, ew, eh * 0.08, a); }
      else if (t.motif === 'geo') { ctx.strokeStyle = a; ctx.lineWidth = W * 0.05; ctx.strokeRect(W * 0.2, H * 0.2, W * 0.6, H * 0.6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.2, H * 0.2); ctx.moveTo(W, H); ctx.lineTo(W * 0.8, H * 0.8); ctx.stroke(); }
      else if (t.motif === 'diamonds') { ctx.fillStyle = a; ctx.beginPath(); ctx.moveTo(W / 2, H * 0.1); ctx.lineTo(W * 0.9, H / 2); ctx.lineTo(W / 2, H * 0.9); ctx.lineTo(W * 0.1, H / 2); ctx.closePath(); ctx.fill(); ctx.fillStyle = base; ctx.beginPath(); ctx.arc(W / 2, H / 2, W * 0.12, 0, Math.PI * 2); ctx.fill(); }
      noise(0.12, 2);
      break;
    }
    default: break;
  }
}

/**
 * Herringbone parquet at true scale. Classic: in a (u, v) frame rotated by 45°, blocks A (along u) and B (along v),
 * W = width, k = length / width: A(i, m) = [i + mk, i + mk + k] × [i − mk, i − mk + 1],
 * B(i, m) = [i + k + mk, i + k + 1 + mk] × [i + 1 − k − mk, i + 1 − mk] — periods in (x, y): √2·k·W and √2·W.
 * Chevron: columns of parallelograms (long edges at 45°, ends on the axis), alternating in both directions.
 * "double" — a block made of two strips. Block colour and grain depend on its index modulo the repeat (the texture tiles).
 */
function paintParquet(ctx: CanvasRenderingContext2D, W: number, H: number, sx: number, sy: number, ew: number, eh: number, t: ReturnType<typeof effectiveTexture>, base: string, seed: string) {
  const bw = t.boardWidth!, bl = t.boardLength!, gap = t.gap ?? 0.0012, gc = t.gapColor ?? shade(base, -0.28), dbl = t.pattern === 'double';
  const P = (x: number, y: number): [number, number] => [x * sx, H - y * sy];
  const block = (pts: [number, number][], key: string, dir: [number, number], width: number) => {
    const r = rng(seed + key);
    ctx.save();
    ctx.beginPath(); pts.forEach((p, i) => { const [X, Y] = P(p[0], p[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.closePath();
    ctx.fillStyle = jitter(base, r, t.variation ?? 0.08); ctx.fill();
    ctx.clip();
    // grain along the block
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4, nrm: [number, number] = [-dir[1], dir[0]];
    const n = Math.round(9 * (t.grain ?? 0.5)) + 2;
    for (let k = 0; k < n; k++) {
      const o = (r() - 0.5) * width, a = 0.05 + 0.1 * r();
      ctx.strokeStyle = `rgba(${r() < 0.6 ? '60,40,20' : '255,240,220'},${a * (t.grain ?? 0.5)})`;
      ctx.lineWidth = 1 + r() * 1.5; ctx.beginPath();
      for (let u = -0.6; u <= 0.6; u += 0.1) {
        const w = Math.sin(u * 9 + k) * width * 0.04, x = cx + dir[0] * u * bl + nrm[0] * (o + w), y = cy + dir[1] * u * bl + nrm[1] * (o + w);
        const [X, Y] = P(x, y); if (u <= -0.6) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }
    if (dbl) { ctx.strokeStyle = gc; ctx.lineWidth = Math.max(1, gap * sx); ctx.beginPath(); const [X0, Y0] = P(cx - dir[0] * bl, cy - dir[1] * bl), [X1, Y1] = P(cx + dir[0] * bl, cy + dir[1] * bl); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke(); }
    ctx.restore();
    // joint between blocks
    ctx.strokeStyle = gc; ctx.lineWidth = Math.max(1, gap * sx);
    ctx.beginPath(); pts.forEach((p, i) => { const [X, Y] = P(p[0], p[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.closePath(); ctx.stroke();
  };
  const mod = (a: number, b: number) => ((a % b) + b) % b;
  if (t.type === 'herringbone') {
    const k = bl / bw, s2 = Math.SQRT1_2, ny = Math.round(eh / (Math.SQRT2 * bw)), nx = Math.round(ew / (Math.SQRT2 * k * bw));
    const xy = (u: number, v: number): [number, number] => [(u - v) * s2 * bw, (u + v) * s2 * bw];
    const rect = (u0: number, u1: number, v0: number, v1: number) => [xy(u0, v0), xy(u1, v0), xy(u1, v1), xy(u0, v1)];
    const mMax = nx + 2, iLo = -Math.ceil(k) - 3, iHi = ny + Math.ceil(k) + 3;
    for (let m = -2; m <= mMax; m++) for (let i = iLo; i <= iHi; i++) {
      const o = m * k;
      block(rect(i + o, i + o + k, i - o, i - o + 1), `A${mod(i, ny)}|${mod(m, nx)}`, [s2, s2], bw);
      block(rect(i + k + o, i + k + 1 + o, i + 1 - k - o, i + 1 - o), `B${mod(i, ny)}|${mod(m, nx)}`, [-s2, s2], bw);
    }
  } else {
    const cw = bl * Math.SQRT1_2, h = bw * Math.SQRT2, nx = Math.round(ew / (2 * cw)), ny = Math.round(eh / h);
    for (let c = -2; c <= 2 * nx + 1; c++) for (let j = -Math.ceil(cw / h) - 2; j <= ny + 2; j++) {
      const x0 = c * cw, y0 = j * h, up = mod(c, 2) === 0;
      const pts: [number, number][] = up ? [[x0, y0], [x0 + cw, y0 + cw], [x0 + cw, y0 + cw + h], [x0, y0 + h]] : [[x0, y0 + cw], [x0 + cw, y0], [x0 + cw, y0 + h], [x0, y0 + cw + h]];
      block(pts, `C${mod(c, 2 * nx)}|${mod(j, ny)}`, up ? [Math.SQRT1_2, Math.SQRT1_2] : [Math.SQRT1_2, -Math.SQRT1_2], bw);
    }
  }
  void W;
}

const cache = new Map<string, THREE.CanvasTexture>();

// ------------------------------------------------------------------ PBR maps: height → normals, AO, roughness
/** types with pronounced relief (joints, gaps, grooves) — height painted with the same pattern in greyscale */
const RELIEF = new Set(['tiles', 'terrazzo', 'planks', 'herringbone', 'chevron', 'panels', 'fluted', 'slats', 'brick']);

/** "height" material: the same pattern (same random draws), light face, dark joint / gap */
function heightVariant(m: MaterialDef): MaterialDef {
  if (!RELIEF.has(m.textureSet.type)) return m;
  const t = m.textureSet;
  return { ...m, baseColor: '#c8c8c8', textureSet: { ...t, groutColor: '#262626', gapColor: '#1e1e1e', accent: t.type === 'panels' ? '#5a5a5a' : t.accent, variation: 0.02, chips: undefined } };
}

export interface PbrMaps { normal: THREE.CanvasTexture; orm: THREE.CanvasTexture }
const pbrCache = new Map<string, PbrMaps>();

/**
 * PBR maps of a material from a height map (painted with the same pattern): normals (Sobel, strength by normalScale and
 * resolution in px/m), ORM (R — AO darkening of gaps, G — roughness multiplier: joints more matte, B — 1). Size = colour
 * texture (≤ 1024 px) — no 4K / 8K textures.
 */
export function materialMaps(m: MaterialDef, layout?: FinishLayout | null): PbrMaps | null {
  if (m.textureSet.type === 'solid' || !(m.normalScale > 0) || typeof document === 'undefined') return null;
  const key = `${m.id}|${JSON.stringify(layout ?? {})}|${maxPx()}`;
  const hit = pbrCache.get(key);
  if (hit) return hit;
  const [W, H] = canvasSize(m, layout);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  paintMaterial(ctx, W, H, heightVariant(m), layout, null);
  const src = ctx.getImageData(0, 0, W, H).data, h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255;
  // normalise the height range (face = 1, deepest gap = 0)
  let lo = 1, hi = 0; for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = Math.max(0.05, hi - lo);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / span;
  const relief = RELIEF.has(m.textureSet.type);
  const k = m.normalScale * (relief ? 2.4 : 0.35); // textures without joints (concrete, fabric, plaster) — gentle relief, no blotches
  const nCv = document.createElement('canvas'); nCv.width = W; nCv.height = H;
  const oCv = document.createElement('canvas'); oCv.width = W; oCv.height = H;
  const nImg = nCv.getContext('2d')!.createImageData(W, H), oImg = oCv.getContext('2d')!.createImageData(W, H);
  const at = (x: number, y: number) => h[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y - 1) - at(x, y + 1)) * k; // v grows towards the top of the canvas
    const l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4, hv = h[y * W + x];
    nImg.data[i] = ((-dx / l) * 0.5 + 0.5) * 255; nImg.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255; nImg.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255; nImg.data[i + 3] = 255;
    oImg.data[i] = (relief ? 0.42 + 0.58 * hv : 0.85 + 0.15 * hv) * 255; oImg.data[i + 1] = (relief ? 1.0 - 0.12 * hv : 1) * 255; oImg.data[i + 2] = 255; oImg.data[i + 3] = 255;
  }
  nCv.getContext('2d')!.putImageData(nImg, 0, 0); oCv.getContext('2d')!.putImageData(oImg, 0, 0);
  const mk = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = activeProfile.current.anisotropy; return t; };
  const out = { normal: mk(nCv), orm: mk(oCv) };
  pbrCache.set(key, out);
  return out;
}
export const pbrCacheStats = () => ({ pbrMaps: pbrCache.size, colorTextures: cache.size });

/** material texture (null — solid colour, no texture) */
export function materialTexture(m: MaterialDef, layout?: FinishLayout | null, color?: string | null): THREE.CanvasTexture | null {
  if (m.textureSet.type === 'solid' || typeof document === 'undefined') return null;
  const key = `${m.id}|${JSON.stringify(layout ?? {})}|${color ?? ''}|${maxPx()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [W, H] = canvasSize(m, layout);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  paintMaterial(cv.getContext('2d')!, W, H, m, layout, color);
  const tx = new THREE.CanvasTexture(cv);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = activeProfile.current.anisotropy;
  cache.set(key, tx);
  return tx;
}

/** material thumbnail (data URL) — a 0.6 × 0.6 m tile or the whole texture when smaller */
const thumbs = new Map<string, string>();
export function materialThumbnail(m: MaterialDef, size = 96): string {
  const hit = thumbs.get(m.id);
  if (hit) return hit;
  if (typeof document === 'undefined') return '';
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  if (m.textureSet.type === 'solid') { ctx.fillStyle = m.baseColor; ctx.fillRect(0, 0, size, size); }
  else {
    const [W, H] = canvasSize(m);
    const src = document.createElement('canvas'); src.width = W; src.height = H;
    paintMaterial(src.getContext('2d')!, W, H, m);
    const [ew, eh] = textureExtent(m), show = Math.min(0.9, ew, eh), pw = (show / ew) * W, ph = (show / eh) * H;
    ctx.drawImage(src, 0, H - ph, pw, ph, 0, 0, size, size);
  }
  const g = ctx.createLinearGradient(0, 0, size, size); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const url = cv.toDataURL('image/png');
  thumbs.set(m.id, url);
  return url;
}
