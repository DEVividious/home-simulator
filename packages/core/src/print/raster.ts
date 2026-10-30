// A small software rasteriser for previews without a browser or GPU (ADR 0035): RGB images, rectangles, lines and 5×7 text,
// meshes in an orthographic view with a z-buffer, Lambert shading and outlines (creases and silhouettes), drawn at twice the
// resolution and averaged down; PNG with a deflate the caller passes (the CLI: node:zlib) or uncompressed blocks. Everything
// is deterministic: the same input gives the same bytes.
import { CELL_H, CELL_W, glyph } from './font5x7.ts';

export type RGB = [number, number, number];
export interface Image { width: number; height: number; rgb: Uint8Array }

export function image(width: number, height: number, bg: RGB = [255, 255, 255]): Image {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(bg, i * 3);
  return { width, height, rgb };
}

const put = (img: Image, x: number, y: number, c: RGB) => { if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.rgb.set(c, (y * img.width + x) * 3); };

export function fillRect(img: Image, x0: number, y0: number, w: number, h: number, c: RGB): void {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) img.rgb.set(c, (y * img.width + x) * 3);
}

export function strokeRect(img: Image, x0: number, y0: number, w: number, h: number, c: RGB): void {
  fillRect(img, x0, y0, w, 1, c); fillRect(img, x0, y0 + h - 1, w, 1, c); fillRect(img, x0, y0, 1, h, c); fillRect(img, x0 + w - 1, y0, 1, h, c);
}

/** text in capitals with the 5×7 font, its top-left corner at (x, y), each font pixel `scale` pixels; returns the width drawn */
export function text(img: Image, x: number, y: number, s: string, scale: number, c: RGB): number {
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    for (let r = 0; r < CELL_H; r++) for (let b = 0; b < 5; b++) if (g[r] & (0x10 >> b)) fillRect(img, cx + b * scale, y + r * scale, scale, scale, c);
    cx += CELL_W * scale;
  }
  return cx - x;
}
export const textWidth = (s: string, scale: number): number => [...s].length * CELL_W * scale;

// ------------------------------------------------------------------ meshes
export interface DrawMesh { positions: ArrayLike<number>; index: Uint32Array; color: RGB }
/** view direction: the camera looks at the model from azimuth (from +x, counter-clockwise) and elevation above the horizon [°] */
export interface View { azimuth: number; elevation: number }

/**
 * Meshes drawn into a rectangle of the image, fitted with a margin: an orthographic view, flat shading by a light from over the
 * viewer's left shoulder, outlines where the surface folds or one surface passes behind another. Back faces are not drawn (the
 * meshes are closed, or single faces turned to the viewer).
 */
export function drawMeshes(img: Image, rx: number, ry: number, rw: number, rh: number, meshes: DrawMesh[], view: View, pad = 16): void {
  const ss = 2, W = rw * ss, H = rh * ss, az = (view.azimuth * Math.PI) / 180, el = (view.elevation * Math.PI) / 180;
  const d = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const rl = Math.hypot(d[1], d[0]) || 1, r = [-d[1] / rl, d[0] / rl, 0];
  const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
  const L = (() => { const v = [d[0] - r[0] * 0.6 + u[0] * 0.5, d[1] - r[1] * 0.6 + u[1] * 0.5, d[2] - r[2] * 0.6 + u[2] * 0.5], l = Math.hypot(v[0], v[1], v[2]); return v.map((x) => x / l); })();
  // fit
  let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity, dz0 = Infinity, dz1 = -Infinity;
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) {
    const p = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
    const sx = p[0] * r[0] + p[1] * r[1] + p[2] * r[2], sy = p[0] * u[0] + p[1] * u[1] + p[2] * u[2], dz = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
    sx0 = Math.min(sx0, sx); sx1 = Math.max(sx1, sx); sy0 = Math.min(sy0, sy); sy1 = Math.max(sy1, sy); dz0 = Math.min(dz0, dz); dz1 = Math.max(dz1, dz);
  }
  if (!Number.isFinite(sx0)) return;
  const k = Math.min((W - 2 * pad * ss) / Math.max(1e-9, sx1 - sx0), (H - 2 * pad * ss) / Math.max(1e-9, sy1 - sy0));
  const ox = W / 2 - ((sx0 + sx1) / 2) * k, oy = H / 2 + ((sy0 + sy1) / 2) * k;
  const depth = new Float32Array(W * H).fill(-Infinity), tri = new Int32Array(W * H).fill(-1), col = new Uint8Array(W * H * 3);
  const normals: number[] = [];
  let tbase = 0;
  for (const m of meshes) {
    const P = m.positions, I = m.index;
    for (let t = 0; t < I.length / 3; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      normals.push(nx, ny, nz);
      const id = tbase + t;
      if (nx * d[0] + ny * d[1] + nz * d[2] <= 1e-6) continue;
      const shade = 0.42 + 0.58 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const c3: RGB = [Math.round(m.color[0] * shade), Math.round(m.color[1] * shade), Math.round(m.color[2] * shade)];
      const scr = [a, b, c].map((v) => {
        const px = P[v], py = P[v + 1], pz = P[v + 2];
        return [ox + (px * r[0] + py * r[1] + pz * r[2]) * k, oy - (px * u[0] + py * u[1] + pz * u[2]) * k, px * d[0] + py * d[1] + pz * d[2]];
      });
      const [A, B, C] = scr, area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(area) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area, w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area, w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2], o = y * W + x;
        if (z <= depth[o]) continue;
        depth[o] = z; tri[o] = id; col.set(c3, o * 3);
      }
    }
    tbase += I.length / 3;
  }
  // outlines: a fold (normals more than 25° apart) or a jump in depth between neighbouring pixels
  const jump = (dz1 - dz0) * 0.012 + 1e-9, cosFold = Math.cos((25 * Math.PI) / 180), line = new Uint8Array(W * H);
  const differ = (o: number, q: number) => {
    const a = tri[o], b = tri[q];
    if (a === b) return false;
    if (a < 0 || b < 0) return true;
    if (Math.abs(depth[o] - depth[q]) > jump) return true;
    return normals[a * 3] * normals[b * 3] + normals[a * 3 + 1] * normals[b * 3 + 1] + normals[a * 3 + 2] * normals[b * 3 + 2] < cosFold;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = y * W + x;
    if (x + 1 < W && differ(o, o + 1)) { line[o] = 1; line[o + 1] = 1; }
    if (y + 1 < H && differ(o, o + W)) { line[o] = 1; line[o + W] = 1; }
  }
  // down to the image: average of the 2 × 2 samples (background where nothing was drawn)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const ix = rx + x, iy = ry + y;
    if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) continue;
    const bg = (iy * img.width + ix) * 3, acc = [0, 0, 0];
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const o = (y * ss + j) * W + (x * ss + i);
      const c = line[o] ? [40, 44, 52] : tri[o] >= 0 ? [col[o * 3], col[o * 3 + 1], col[o * 3 + 2]] : [img.rgb[bg], img.rgb[bg + 1], img.rgb[bg + 2]];
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    put(img, ix, iy, [Math.round(acc[0] / 4), Math.round(acc[1] / 4), Math.round(acc[2] / 4)]);
  }
}

// ------------------------------------------------------------------ PNG
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** a zlib stream of stored (uncompressed) blocks — when the caller has no deflate */
export function storedZlib(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535)), out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const s = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535)), n = s.length;
    out[o++] = i === blocks - 1 ? 1 : 0; out[o++] = n & 0xff; out[o++] = n >> 8; out[o++] = ~n & 0xff; out[o++] = (~n >> 8) & 0xff;
    out.set(s, o); o += n;
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const adler = ((b << 16) | a) >>> 0;
  out[o++] = adler >>> 24; out[o++] = (adler >>> 16) & 0xff; out[o++] = (adler >>> 8) & 0xff; out[o++] = adler & 0xff;
  return out;
}

/** the image as an 8-bit RGB PNG; `zlib` makes the zlib stream of the filtered scanlines (default: stored blocks) */
export function encodePng(img: Image, zlib: (raw: Uint8Array) => Uint8Array = storedZlib): Uint8Array {
  const { width: w, height: h } = img, raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 3)] = 0; raw.set(img.rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1); }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
